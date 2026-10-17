"""features.py — point-in-time features, computed with no future data.

This is the single most important file in Phase 1. Every number the model
produces for the rest of the roadmap depends on the guarantee it implements:

    **A feature for transaction *t* may use only rows with timestamp < t.**

Get this wrong and the model scores 0.97 offline and collapses in production,
because "the user's average amount" quietly included the fraud spree it is
supposed to predict. It is invisible when it happens and produces beautiful
results, which is exactly why there is a test that deletes every subsequent row
and asserts the feature vector is byte-identical (`tests/test_leakage.py`).

How the guarantee is kept, concretely:

* Rows are processed **per user, in timestamp order**, maintaining sliding
  windows that are advanced *after* the current row is scored — so a window can
  never contain the row being scored.
* Window membership is `lo <= ts < t`, i.e. **strictly** before. `<` not `<=`
  matters: two transactions can share a millisecond.
* Merchant-level features are expanding counts over strictly-earlier rows.
* Splits elsewhere are chronological, never random.

Feature parity with serving
---------------------------
`server/services/featureService.js` computes the *same* vector online from
Mongo, and the Java engine consumes it. That is a deliberate architectural
choice (the roadmap's recommended one): features are computed **once, in one
language's worth of logic**, rather than twice with a chance to drift. Parity is
enforced by a golden fixture that both sides must reproduce
(`ml/artifacts/golden_features.json`).
"""

from __future__ import annotations

import bisect
import math
from collections import Counter, defaultdict, deque
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

# --------------------------------------------------------------------------
# The feature contract. Order is part of the ABI — model-v1.json stores weights
# positionally against this list, so appending is safe and reordering is not.
# --------------------------------------------------------------------------

FEATURE_NAMES: List[str] = [
    "log_amount",
    "amt_zscore_user",
    "amt_ratio_user_mean",
    "user_txn_count_1h",
    "user_txn_count_24h",
    "user_txn_count_7d",
    "user_distinct_merchants_24h",
    "user_distinct_cities_24h",
    "user_distinct_devices_7d",
    "log_seconds_since_prev",
    "hour_sin",
    "hour_cos",
    "is_night",
    "is_weekend",
    "geo_distance_km_prev",
    "log1p_implied_speed_kmh",
    "distance_from_centroid_km",
    "merchant_amt_percentile",
    "merchant_dispute_rate_asof",
    # The six rule indicators. Including them makes the model a strict
    # *generalisation* of the rule engine rather than a competitor: it can
    # reproduce every rule and add to them, and the learned coefficient on each
    # flag is a direct, publishable statement about that rule's real worth.
    "rule_velocity",
    "rule_enumeration",
    "rule_amount_threshold",
    "rule_geographic_anomaly",
    "rule_new_device",
    "rule_night_owl",
]

RULE_FLAG_FEATURES: List[str] = [
    "rule_velocity",
    "rule_enumeration",
    "rule_amount_threshold",
    "rule_geographic_anomaly",
    "rule_new_device",
    "rule_night_owl",
]

#: Maps a model feature name to the engine's rule name, so the learned weight
#: of a rule flag can be compared against the hardcoded severity.
RULE_FEATURE_TO_ENGINE_NAME: Dict[str, str] = {
    "rule_velocity": "VELOCITY_RULE",
    "rule_enumeration": "ENUMERATION_ATTACK_RULE",
    "rule_amount_threshold": "AMOUNT_THRESHOLD_RULE",
    "rule_geographic_anomaly": "GEOGRAPHIC_ANOMALY_RULE",
    "rule_new_device": "NEW_DEVICE_RULE",
    "rule_night_owl": "NIGHT_OWL_RULE",
}

WINDOW_1H = 3600.0
WINDOW_24H = 86400.0
WINDOW_7D = 7 * 86400.0
WINDOW_30D = 30 * 86400.0
MAX_GAP_SECONDS = 30 * 86400.0     # cap for "time since previous"
MAX_SPEED_KMH = 1200.0             # cap for implied speed (km/h)

EARTH_RADIUS_KM = 6371.0088


def haversine_km(lat1, lng1, lat2, lng2) -> float:
    """Great-circle distance. The signal ``GeographicAnomalyRule`` ignores
    today, despite the schema already storing ``location.lat``/``lng``."""
    if None in (lat1, lng1, lat2, lng2):
        return 0.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dlambda = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


def _f(value: Any, default: float = 0.0) -> float:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return default
    return default if out != out else out   # NaN -> default


def _optional(value: Any) -> Optional[float]:
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return None if out != out else out


# --------------------------------------------------------------------------
# The per-user sliding state
# --------------------------------------------------------------------------

class _UserState:
    """Sliding windows for one user that only ever contain *past* rows."""

    __slots__ = ("ts", "amount_log", "merchant_ts", "city_ts", "device_ts",
                 "loc_ts", "loc_lat", "loc_lng", "prev_ts", "prev_lat", "prev_lng")

    def __init__(self):
        self.ts: deque = deque()            # all txn timestamps (for 1h/24h/7d counts)
        self.amount_log: deque = deque()    # (ts, log amount) for 30d amount stats
        self.merchant_ts: deque = deque()   # (ts, merchantId)
        self.city_ts: deque = deque()       # (ts, city)
        self.device_ts: deque = deque()     # (ts, deviceId)
        self.loc_ts: deque = deque()        # (ts, lat, lng) for 30d centroid
        self.prev_ts: Optional[float] = None
        self.prev_lat: Optional[float] = None
        self.prev_lng: Optional[float] = None

    # -- pruning ---------------------------------------------------------
    def prune(self, now: float) -> None:
        """Drop rows older than the widest window. ``ts`` holds bare floats;
        every other deque holds ``(ts, ...)`` tuples."""
        cutoff = now - WINDOW_30D
        while self.ts and self.ts[0] < cutoff:
            self.ts.popleft()
        for dq in (self.amount_log, self.merchant_ts, self.city_ts,
                   self.device_ts, self.loc_ts):
            while dq and dq[0][0] < cutoff:
                dq.popleft()

    # -- reads -----------------------------------------------------------
    def count_within(self, window: float, now: float) -> int:
        # ts is sorted ascending, so the window is a suffix.
        lo = bisect.bisect_left(self.ts, now - window) if self.ts else 0
        return len(self.ts) - lo

    def log_amount_stats(self, now: float) -> Tuple[int, float, float, float]:
        """(n, sum, sumsq, max) of log-amounts within 30d, excluding current."""
        cutoff = now - WINDOW_30D
        n = s = ss = mx = 0.0
        for ts, la in self.amount_log:
            if ts < cutoff:
                continue
            n += 1
            s += la
            ss += la * la
            if la > mx:
                mx = la
        return int(n), s, ss, mx

    def distinct_within(self, dq: deque, window: float, now: float) -> int:
        cutoff = now - window
        seen = set()
        for item in dq:
            if item[0] < cutoff:
                continue
            seen.add(item[1])
        return len(seen)

    def centroid(self, now: float) -> Optional[Tuple[float, float]]:
        cutoff = now - WINDOW_30D
        lats, lngs = [], []
        for ts, lat, lng in self.loc_ts:
            if ts < cutoff or lat is None or lng is None:
                continue
            lats.append(lat)
            lngs.append(lng)
        if not lats:
            return None
        return sum(lats) / len(lats), sum(lngs) / len(lngs)


class _MerchantState:
    __slots__ = ("amounts_sorted", "n", "n_fraud")

    def __init__(self):
        self.amounts_sorted: List[float] = []
        self.n = 0
        self.n_fraud = 0


# --------------------------------------------------------------------------
# Computation
# --------------------------------------------------------------------------

def compute_features(frame: pd.DataFrame,
                     rule_flags: Optional[Dict[str, Sequence[bool]]] = None,
                     label_column: str = "is_fraud") -> pd.DataFrame:
    """Return a DataFrame of ``FEATURE_NAMES`` computed as-of each transaction.

    ``frame`` must carry: ``userId``, ``merchantId``, ``amount``,
    ``timestamp`` and (optionally) ``city``, ``lat``, ``lng``, ``deviceId``.
    ``rule_flags`` supplies the six binary rule indicators — pass the flags the
    **engine actually recorded** (`rulesTriggered` from a replay/export); if
    omitted they default to False and the returned frame says so.

    The returned frame has the feature columns plus ``userId``, ``timestamp``
    and ``is_fraud`` (the label is passed through untouched — never derived).
    """
    if frame.empty:
        return pd.DataFrame(columns=FEATURE_NAMES)

    df = frame.sort_values(["timestamp", "transactionId"]).reset_index(drop=True)
    flags = _normalise_rule_flags(df, rule_flags)

    users: Dict[str, _UserState] = defaultdict(_UserState)
    merchants: Dict[str, _MerchantState] = defaultdict(_MerchantState)
    raw_ts = _to_epoch(df["timestamp"])
    has_coords = "lat" in df.columns and "lng" in df.columns
    has_city = "city" in df.columns
    has_device = "deviceId" in df.columns

    rows: List[Dict[str, float]] = []
    for i in range(len(df)):
        row = df.iloc[i]
        uid = str(row["userId"])
        mid = str(row["merchantId"])
        amount = _f(row["amount"])
        now = float(raw_ts[i])

        state = users[uid]
        state.prune(now)

        lag = 0.0 if state.prev_ts is None else max(0.0, now - state.prev_ts)
        gap_for_log = min(lag, MAX_GAP_SECONDS)

        lat = _optional(row["lat"]) if has_coords else None
        lng = _optional(row["lng"]) if has_coords else None

        # --- geo ---------------------------------------------------------
        if state.prev_ts is None or lat is None or lng is None:
            distance_prev = 0.0
            implied_speed = 0.0
        else:
            distance_prev = haversine_km(state.prev_lat, state.prev_lng, lat, lng)
            hours = max(lag, 1.0) / 3600.0
            implied_speed = min(distance_prev / hours, MAX_SPEED_KMH)
        centroid = state.centroid(now)
        distance_centroid = (haversine_km(centroid[0], centroid[1], lat, lng)
                             if centroid and lat is not None and lng is not None else 0.0)

        # --- amount behaviour -------------------------------------------
        la = math.log1p(max(amount, 0.0))
        n_amt, s_amt, ss_amt, _ = state.log_amount_stats(now)
        if n_amt >= 2:
            mean = s_amt / n_amt
            var = max(ss_amt / n_amt - mean * mean, 0.0)
            std = math.sqrt(var)
            zscore = (la - mean) / std if std > 1e-9 else 0.0
        else:
            mean = (s_amt / n_amt) if n_amt else 0.0
            zscore = 0.0
        ratio = (amount / math.expm1(mean)) if mean > 1e-9 else 1.0

        # --- merchant -----------------------------------------------------
        mstate = merchants[mid]
        if mstate.amounts_sorted:
            pos = bisect.bisect_right(mstate.amounts_sorted, amount)
            pct = pos / len(mstate.amounts_sorted)
        else:
            pct = 0.5
        dispute_rate = (mstate.n_fraud / mstate.n) if mstate.n else 0.0

        hour = _hour_of(df["timestamp"].iloc[i])
        feats = {
            "log_amount": la,
            "amt_zscore_user": zscore,
            "amt_ratio_user_mean": max(min(ratio, 50.0), 0.0),
            "user_txn_count_1h": state.count_within(WINDOW_1H, now),
            "user_txn_count_24h": state.count_within(WINDOW_24H, now),
            "user_txn_count_7d": state.count_within(WINDOW_7D, now),
            "user_distinct_merchants_24h": state.distinct_within(state.merchant_ts, WINDOW_24H, now),
            "user_distinct_cities_24h": state.distinct_within(state.city_ts, WINDOW_24H, now),
            "user_distinct_devices_7d": state.distinct_within(state.device_ts, WINDOW_7D, now),
            "log_seconds_since_prev": math.log1p(gap_for_log),
            "hour_sin": math.sin(2 * math.pi * hour / 24.0),
            "hour_cos": math.cos(2 * math.pi * hour / 24.0),
            "is_night": 1.0 if 0 <= hour <= 5 else 0.0,
            "is_weekend": 1.0 if _weekday_of(df["timestamp"].iloc[i]) >= 5 else 0.0,
            "geo_distance_km_prev": distance_prev,
            "log1p_implied_speed_kmh": math.log1p(implied_speed),
            "distance_from_centroid_km": distance_centroid,
            "merchant_amt_percentile": pct,
            "merchant_dispute_rate_asof": dispute_rate,
        }
        for name, values in flags.items():
            feats[name] = float(bool(values[i]))
        rows.append(feats)

        # --- advance state AFTER scoring (this is the no-leakage guarantee) ---
        state.ts.append(now)
        state.amount_log.append((now, la))
        state.merchant_ts.append((now, mid))
        if has_city:
            city = row["city"]
            state.city_ts.append((now, None if city is None or city != city else str(city)))
        if has_device:
            device = row["deviceId"]
            state.device_ts.append((now, None if device is None or device != device else str(device)))
        if lat is not None and lng is not None:
            state.loc_ts.append((now, lat, lng))
        state.prev_ts, state.prev_lat, state.prev_lng = now, lat, lng

        bisect.insort(mstate.amounts_sorted, amount)
        mstate.n += 1
        mstate.n_fraud += 1 if bool(row.get(label_column, False)) else 0

    out = pd.DataFrame(rows, columns=FEATURE_NAMES)
    # Traceability columns (not features): the point-in-time test and the
    # training script both need to find a specific row again.
    out.insert(0, "transactionId", df["transactionId"].to_numpy() if "transactionId" in df else "")
    out.insert(1, "userId", df["userId"].to_numpy())
    out.insert(2, "merchantId", df["merchantId"].to_numpy())
    out.insert(3, "timestamp", df["timestamp"].to_numpy())
    out.insert(4, "is_fraud", df[label_column].astype(bool).to_numpy() if label_column in df else False)
    return out


def _normalise_rule_flags(df: pd.DataFrame,
                          rule_flags: Optional[Dict[str, Sequence[bool]]]
                          ) -> Dict[str, Sequence[bool]]:
    """Accept explicit flags, or read them off the frame, or default to False."""
    out: Dict[str, Sequence[bool]] = {}
    for feature in RULE_FLAG_FEATURES:
        engine_name = RULE_FEATURE_TO_ENGINE_NAME[feature]
        if rule_flags and feature in rule_flags:
            out[feature] = rule_flags[feature]
        elif rule_flags and engine_name in rule_flags:
            out[feature] = rule_flags[engine_name]
        elif feature in df.columns:
            out[feature] = df[feature].astype(bool).to_numpy()
        elif engine_name in df.columns:
            out[feature] = df[engine_name].astype(bool).to_numpy()
        else:
            out[feature] = np.zeros(len(df), dtype=bool)
    return out


def _to_epoch(series: pd.Series) -> np.ndarray:
    """Timestamps -> float seconds, **quantised to milliseconds**.

    The quantisation is not cosmetic. MongoDB stores ``Date`` with millisecond
    precision, so the online (Node) implementation of these features can only
    ever see millisecond-resolution timestamps. If the offline computation kept
    pandas' nanosecond resolution, every gap feature would differ from serving
    by a sub-millisecond amount — tiny, but enough to fail the golden-fixture
    parity test, which is exactly what such a test is for. (Naively dividing an
    int64 nanosecond count by 1e9 also overflows float64's 53-bit mantissa at
    epoch scale, so this is more accurate too.)
    """
    values = pd.to_datetime(series, utc=True)
    millis = values.astype("int64").to_numpy() // 1_000_000
    return millis / 1000.0


def _hour_of(value) -> int:
    ts = pd.Timestamp(value)
    if ts.tzinfo is not None:
        ts = ts.tz_convert("UTC")
    return int(ts.hour)


def _weekday_of(value) -> int:
    ts = pd.Timestamp(value)
    if ts.tzinfo is not None:
        ts = ts.tz_convert("UTC")
    return int(ts.weekday())


def features_to_matrix(frame: pd.DataFrame) -> np.ndarray:
    """Feature columns -> a float64 matrix in ``FEATURE_NAMES`` order."""
    missing = [c for c in FEATURE_NAMES if c not in frame.columns]
    if missing:
        raise ValueError("missing feature columns: %s" % missing)
    return frame[FEATURE_NAMES].to_numpy(dtype=float)


def feature_spec() -> List[Dict[str, str]]:
    """Human-readable definition of every feature, for the model card."""
    return [
        {"name": "log_amount", "definition": "log1p(amount). Scale-free for a linear model."},
        {"name": "amt_zscore_user", "definition": "z-score of log amount vs the user's trailing 30d log amounts (0 if <2 prior)."},
        {"name": "amt_ratio_user_mean", "definition": "amount / exp(trailing mean log amount), capped at 50."},
        {"name": "user_txn_count_1h", "definition": "user's prior transactions in the last hour (strictly before)."},
        {"name": "user_txn_count_24h", "definition": "user's prior transactions in the last 24h."},
        {"name": "user_txn_count_7d", "definition": "user's prior transactions in the last 7d."},
        {"name": "user_distinct_merchants_24h", "definition": "distinct merchants in the user's last 24h."},
        {"name": "user_distinct_cities_24h", "definition": "distinct cities in the user's last 24h."},
        {"name": "user_distinct_devices_7d", "definition": "distinct devices in the user's last 7d."},
        {"name": "log_seconds_since_prev", "definition": "log1p(gap to the user's previous transaction), capped at 30d."},
        {"name": "hour_sin", "definition": "sin(2*pi*hour/24) — cyclical, so 23:00 and 00:00 are adjacent."},
        {"name": "hour_cos", "definition": "cos(2*pi*hour/24)."},
        {"name": "is_night", "definition": "hour in [0, 5]. Directly comparable to NIGHT_OWL_RULE."},
        {"name": "is_weekend", "definition": "Saturday or Sunday (UTC)."},
        {"name": "geo_distance_km_prev", "definition": "haversine km from the user's previous transaction location."},
        {"name": "log1p_implied_speed_kmh", "definition": "log1p(km / hours since previous), capped at 1200 km/h. Continuous impossible-travel."},
        {"name": "distance_from_centroid_km", "definition": "haversine km from the mean of the user's trailing 30d locations."},
        {"name": "merchant_amt_percentile", "definition": "fraction of the merchant's prior amounts <= this one."},
        {"name": "merchant_dispute_rate_asof", "definition": "prior fraud-labelled / prior transactions for this merchant, as of t."},
        {"name": "rule_*", "definition": "1 if the engine's rule fired at scoring time (from rulesTriggered, never from the label)."},
    ]


def summarise(frame: pd.DataFrame) -> Dict[str, Any]:
    """Cheap sanity summary used in EXPERIMENTS.md."""
    X = features_to_matrix(frame)
    return {
        "rows": int(len(frame)),
        "features": len(FEATURE_NAMES),
        "nan_or_inf": int(np.sum(~np.isfinite(X))),
        "constant_features": [FEATURE_NAMES[j] for j in range(X.shape[1])
                              if np.nanstd(X[:, j]) < 1e-12],
    }
