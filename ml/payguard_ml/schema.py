"""schema.py — map an externally-labelled dataset row onto PayGuard's ingest shape.

The whole ML roadmap rests on one claim: labels must come from outside the
rule engine, or the model just learns to imitate the rules (Flaw 2). Getting a
real dataset *into* PayGuard is therefore the first real engineering task, and
this module is where it happens.

Design decisions, each of them deliberate:

1. **The mapping is a pure function.** ``map_*`` takes one dataset row and
   returns a ``CanonicalTransaction``; nothing touches the network or the DB.
   That makes it trivially unit-testable and means the same code path serves
   the notebook, the replay script and the tests.

2. **Missing fields are handled honestly, not fabricated.** Sparkov has no
   ``deviceId`` and no ``ipAddress``. Fabricating a device and then evaluating
   ``NEW_DEVICE_RULE`` against that fabrication would be Flaw 2 one level
   deeper, so the default ``device_mode`` is ``"null"`` — the field is simply
   absent and the report says which rules could not be evaluated. A
   ``"synthetic"`` mode exists for pipeline smoke-testing and is *loudly*
   tagged with provenance so nobody accidentally reports a rule as working.

3. **Currency is data, not a constant.** PayGuard defaults to INR, but Sparkov
   amounts are not rupees. Stamping ``INR`` on them would make the amount
   thresholds (``AMOUNT_THRESHOLD_RULE`` at 1,00,000) meaningless. We carry the
   source currency and document the unit mismatch rather than hiding it.
"""

from __future__ import annotations

import dataclasses
import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Mapping, Optional

PAYGUID_SCHEMA_VERSION = "1.0"

#: How to populate identifier fields the dataset does not carry.
#:   "null"      — leave absent (default; honest)
#:   "synthetic" — derive deterministically per cardholder (pipeline smoke-tests only)
DEVICE_MODES = ("null", "synthetic")

#: Sparkov's ``trans_date_trans_time`` is a naive local string.
_SPARKOV_TS_FORMATS = (
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%d %H:%M",
)

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# PaySim's ``step`` is 1 hour from an arbitrary origin. Anchoring it to a fixed
# date keeps replays reproducible across machines and runs; the absolute date
# does not matter, only the intervals between events (which is what the
# sliding-window rules consume). 2019-01-01 is the PaySim paper's own origin.
PAYSIM_ORIGIN = datetime(2019, 1, 1, tzinfo=timezone.utc)
PAYSIM_STEP = timedelta(hours=1)


def _slug(text: Any, default: str = "unknown") -> str:
    """Deterministic, URL/identifier-safe slug. Used for merchant ids."""
    if text is None:
        return default
    s = re.sub(r"[^a-z0-9]+", "_", str(text).strip().lower()).strip("_")
    return s or default


def _stable_int(key: str, modulus: int) -> int:
    """Stable hash of a string -> int in [0, modulus). ``hash()`` is salted per
    process and therefore useless for reproducible synthetic values."""
    if modulus <= 1:
        return 0
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
    return int(digest[:16], 16) % modulus


def _as_float(value: Any) -> Optional[float]:
    if value is None:
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    # pandas gives us NaN for missing numerics; NaN is not a usable coordinate.
    if f != f:  # NaN
        return None
    return f


def _clean_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in ("nan", "none", "null", "unknown"):
        return None
    return s


def parse_timestamp(value: Any) -> datetime:
    """Parse a dataset timestamp into a timezone-aware UTC datetime.

    Accepts ISO strings, ``"YYYY-MM-DD HH:MM:SS"``, epoch seconds and existing
    datetimes. Naive values are *assumed UTC* — the Sparkov generator does not
    record a timezone, and for a fraud model what matters is the ordering and
    the intervals, both of which survive a consistent offset.
    """
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return _EPOCH + timedelta(seconds=float(value))
    s = _clean_str(value)
    if s is None:
        raise ValueError("timestamp is missing")
    candidate = s.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        pass
    for fmt in _SPARKOV_TS_FORMATS:
        try:
            return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    raise ValueError("unparseable timestamp: %r" % (value,))


def _synthesise_device(user_id: str, ts: datetime) -> str:
    """Deterministic device id for a user.

    A user keeps one device for roughly a week, then sometimes rotates. The
    intent is only to give the *pipeline* something to carry — it is not a
    claim about real device churn, and any evaluation that uses it is tagged
    with ``device_provenance="synthetic"`` so the honesty layer can exclude it.
    """
    epoch_week = int(ts.timestamp() // (7 * 24 * 3600))
    # ~1 in 6 weeks the user is on a new device.
    generation = epoch_week if _stable_int("%s|%d" % (user_id, epoch_week), 6) == 0 else 0
    return "dev_%s_%d" % (_stable_int(user_id, 10 ** 8), generation)


@dataclass
class CanonicalTransaction:
    """One externally-labelled transaction in a dataset-agnostic shape.

    Mirrors what PayGuard's ``POST /api/transactions`` accepts, plus the
    ground-truth label and enough provenance to write an honest report.
    """

    transactionId: str
    userId: str
    merchantId: str
    amount: float
    currency: str
    timestamp: datetime
    city: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    is_fraud: bool = False

    # provenance / extras (not sent to PayGuard)
    source: str = "unknown"
    merchant_lat: Optional[float] = None
    merchant_lng: Optional[float] = None
    category: Optional[str] = None
    city_pop: Optional[int] = None
    device_provenance: str = "absent"

    # optional identity / P2P fields
    deviceId: Optional[str] = None
    ipAddress: Optional[str] = None
    beneficiaryId: Optional[str] = None

    extra: Dict[str, Any] = field(default_factory=dict)

    def to_payguard_body(self) -> Dict[str, Any]:
        """The JSON body for ``POST /api/transactions``.

        Only fields PayGuard actually models are emitted. ``transactionId`` is
        included so a replay is idempotent-ish and, more importantly, so a
        dispute can reference the exact transaction later.
        """
        body: Dict[str, Any] = {
            "transactionId": self.transactionId,
            "userId": self.userId,
            "merchantId": self.merchantId,
            "amount": float(self.amount),
            "currency": self.currency,
            "timestamp": self.timestamp.astimezone(timezone.utc).isoformat(),
        }
        location: Dict[str, Any] = {}
        if self.city:
            location["city"] = self.city
        if self.lat is not None:
            location["lat"] = self.lat
        if self.lng is not None:
            location["lng"] = self.lng
        if location:
            body["location"] = location
        if self.deviceId:
            body["deviceId"] = self.deviceId
        if self.ipAddress:
            body["ipAddress"] = self.ipAddress
        if self.beneficiaryId:
            body["beneficiaryId"] = self.beneficiaryId
        return body

    def to_record(self) -> Dict[str, Any]:
        """Flat dict for a DataFrame — body fields plus label + provenance."""
        record = {
            "transactionId": self.transactionId,
            "userId": self.userId,
            "merchantId": self.merchantId,
            "amount": float(self.amount),
            "currency": self.currency,
            "timestamp": self.timestamp,
            "city": self.city,
            "lat": self.lat,
            "lng": self.lng,
            "is_fraud": bool(self.is_fraud),
            "source": self.source,
            "merchant_lat": self.merchant_lat,
            "merchant_lng": self.merchant_lng,
            "category": self.category,
            "city_pop": self.city_pop,
            "device_provenance": self.device_provenance,
            "deviceId": self.deviceId,
            "ipAddress": self.ipAddress,
            "beneficiaryId": self.beneficiaryId,
        }
        record.update(self.extra)
        return record


# --------------------------------------------------------------------------
# Sparkov / "Credit Card Transactions Fraud Detection"
# --------------------------------------------------------------------------

def map_sparkov(row: Mapping[str, Any], device_mode: str = "null",
                currency: str = "USD") -> CanonicalTransaction:
    """Map one Sparkov row onto the canonical shape.

    Field mapping::

        cc_num      -> userId        (the cardholder; PayGuard has no card entity)
        merchant    -> merchantId
        amt         -> amount
        lat/long    -> location.{lat,lng}
        city        -> location.city
        trans_num   -> transactionId
        is_fraud    -> is_fraud      (ground truth we care about)

    ``merch_lat``/``merch_long`` are kept as extras so Phase 1 can compute a
    real merchant-distance feature — the signal ``GEOGRAPHIC_ANOMALY_RULE``
    ignores today.
    """
    if device_mode not in DEVICE_MODES:
        raise ValueError("device_mode must be one of %s" % (DEVICE_MODES,))

    cc_num = _clean_str(row.get("cc_num")) or "unknown_card"
    user_id = "cc_%s" % cc_num
    ts = parse_timestamp(row.get("trans_date_trans_time") or row.get("unix_time"))

    merchant_raw = _clean_str(row.get("merchant")) or "unknown_merchant"
    trans_num = _clean_str(row.get("trans_num")) or "sparkov_%s" % _stable_int(
        "%s|%s" % (cc_num, row.get("unix_time")), 10 ** 12
    )

    device_id = None
    provenance = "absent"
    if device_mode == "synthetic":
        device_id = _synthesise_device(user_id, ts)
        provenance = "synthetic"

    return CanonicalTransaction(
        transactionId=trans_num,
        userId=user_id,
        merchantId=_slug(merchant_raw),
        amount=float(row.get("amt") or 0.0),
        currency=currency,
        timestamp=ts,
        city=_clean_str(row.get("city")),
        lat=_as_float(row.get("lat")),
        lng=_as_float(row.get("long")),
        is_fraud=str(row.get("is_fraud", 0)).strip() in ("1", "True", "true"),
        source="sparkov",
        merchant_lat=_as_float(row.get("merch_lat")),
        merchant_lng=_as_float(row.get("merch_long")),
        category=_slug(row.get("category"), default=None) if row.get("category") else None,
        city_pop=int(row["city_pop"]) if _as_float(row.get("city_pop")) is not None else None,
        device_provenance=provenance,
        deviceId=device_id,
        extra={
            "state": _clean_str(row.get("state")),
            "job": _clean_str(row.get("job")),
        },
    )


# --------------------------------------------------------------------------
# PaySim / synthetic mobile-money
# --------------------------------------------------------------------------

def map_paysim(row: Mapping[str, Any], device_mode: str = "null",
               currency: str = "USD") -> CanonicalTransaction:
    """Map one PaySim row onto the canonical shape.

    PaySim is the semantic match: ``nameOrig`` pays ``nameDest``, and its fraud
    model is literally "take over an account, transfer to a mule, cash out".
    That makes ``beneficiaryId`` — the field PayGuard already built for the mule
    detector — the natural home for ``nameDest``, and it means PaySim's
    ``isFraud`` gives us the first-ever ground truth to evaluate the mule
    detector against.
    """
    if device_mode not in DEVICE_MODES:
        raise ValueError("device_mode must be one of %s" % (DEVICE_MODES,))

    step = int(float(row.get("step") or 0))
    ts = PAYSIM_ORIGIN + step * PAYSIM_STEP
    txn_type = _slug(row.get("type"), default="transfer")
    origin = _clean_str(row.get("nameOrig")) or "unknown_origin"

    # PaySim has no transaction id; derive a stable one from the row so a
    # dispute can reference it and reruns are byte-identical.
    fingerprint = "%s|%s|%s|%s|%s" % (
        step, origin, row.get("nameDest"), row.get("amount"), row.get("type")
    )
    txn_id = "paysim_%d_%s" % (step, _stable_int(fingerprint, 10 ** 12))

    device_id = None
    provenance = "absent"
    if device_mode == "synthetic":
        device_id = _synthesise_device(origin, ts)
        provenance = "synthetic"

    return CanonicalTransaction(
        transactionId=txn_id,
        userId=origin,
        merchantId="paysim_%s" % txn_type,
        amount=float(row.get("amount") or 0.0),
        currency=currency,
        timestamp=ts,
        city=None,
        lat=None,
        lng=None,
        is_fraud=str(row.get("isFraud", 0)).strip() in ("1", "True", "true"),
        source="paysim",
        device_provenance=provenance,
        deviceId=device_id,
        beneficiaryId=_clean_str(row.get("nameDest")),
        extra={
            "paysim_step": step,
            "paysim_type": txn_type,
            "oldbalanceOrg": _as_float(row.get("oldbalanceOrg")),
            "newbalanceOrig": _as_float(row.get("newbalanceOrig")),
            "oldbalanceDest": _as_float(row.get("oldbalanceDest")),
            "newbalanceDest": _as_float(row.get("newbalanceDest")),
            "isFlaggedFraud": str(row.get("isFlaggedFraud", 0)).strip() in ("1", "True", "true"),
        },
    )


MAPPER_BY_KIND = {
    "sparkov": map_sparkov,
    "paysim": map_paysim,
}


def map_rows(rows: Iterable[Mapping[str, Any]], kind: str,
             device_mode: str = "null", currency: Optional[str] = None
             ) -> List[CanonicalTransaction]:
    """Map many rows for a named dataset kind."""
    try:
        mapper = MAPPER_BY_KIND[kind]
    except KeyError:
        raise ValueError("unknown dataset kind %r (known: %s)"
                         % (kind, ", ".join(sorted(MAPPER_BY_KIND))))
    default_currency = {"sparkov": "USD", "paysim": "USD"}[kind]
    out = [mapper(r, device_mode=device_mode, currency=currency or default_currency)
           for r in rows]
    # Chronological is the only order that is safe to replay in.
    out.sort(key=lambda t: t.timestamp)
    return out


def to_frame(transactions: Iterable[CanonicalTransaction]):
    """Canonical transactions -> a pandas DataFrame (frame columns are stable)."""
    import pandas as pd  # local import: the rest of schema.py must not need pandas

    records = [t.to_record() for t in transactions]
    if not records:
        return pd.DataFrame()
    return pd.DataFrame.from_records(records)


def dataclass_fields() -> List[str]:
    """Exposed for tests that assert the canonical shape is stable."""
    return [f.name for f in dataclasses.fields(CanonicalTransaction)]
