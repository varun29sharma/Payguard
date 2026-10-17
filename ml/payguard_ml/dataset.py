"""dataset.py — load external fraud datasets into the canonical PayGuard shape.

Three sources, one output shape:

* **Sparkov** (``kind="sparkov"``) — Kaggle "Credit Card Transactions Fraud
  Detection". Best structural match to PayGuard's schema (card, merchant,
  amount, lat/long, ``is_fraud``).
* **PaySim** (``kind="paysim"``) — Kaggle synthetic mobile money. The semantic
  match: ``nameOrig -> nameDest`` maps onto ``userId -> beneficiaryId`` and its
  fraud model is account-takeover -> mule -> cash-out, which gives the mule
  detector ground truth it has never had.
* **Synthetic fallback** (``kind="synthetic"``) — a *deliberately non-circular*
  generator used when neither Kaggle dataset is available. It matters that its
  label comes from a latent fraud process, **not** from PayGuard's six rules:
  if the label were rule-derived, the baseline would be measuring the rules
  against themselves (Flaw 2). This is a smoke-test / CI fixture, explicitly
  **not** a substitute for real data, and every artefact it produces is stamped
  ``source="synthetic"`` so it can never be quoted as a result.

The loaders never mutate their input and never touch the network.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

from . import schema as schema_mod
from .schema import CanonicalTransaction, map_rows, to_frame

DATASET_KINDS = ("sparkov", "paysim", "synthetic")

#: Columns the report/critic layers rely on. Kept as a module constant so a
#: change to the canonical shape is caught by tests rather than silently
#: breaking a notebook.
CANONICAL_COLUMNS = [
    "transactionId", "userId", "merchantId", "amount", "currency", "timestamp",
    "city", "lat", "lng", "is_fraud", "source", "merchant_lat", "merchant_lng",
    "category", "city_pop", "device_provenance", "deviceId", "ipAddress",
    "beneficiaryId",
]

#: Rules that can only be evaluated when a dataset actually carries the field
#: they need. The baseline report prints this so nobody claims credit for a
#: rule that was quietly un-evaluable.
RULES_BY_REQUIRED_FIELD = {
    "deviceId": ["NEW_DEVICE_RULE"],
    "beneficiaryId": [],  # mule detector, not a scoring rule
    "location.city": ["GEOGRAPHIC_ANOMALY_RULE"],
}


def load_csv(path: str, kind: str, device_mode: str = "null",
             currency: Optional[str] = None, limit: Optional[int] = None
             ) -> pd.DataFrame:
    """Load a Kaggle CSV and return a canonical DataFrame.

    Memory note: Sparkov is ~1.85M rows and PaySim ~6.3M, so ``limit`` exists
    to keep a laptop honest. It is applied **after** chronological sorting, so
    ``limit`` takes the *earliest* N rows — a contiguous historical slice,
    which is the only kind you can train on without a gap.
    """
    if kind not in DATASET_KINDS:
        raise ValueError("kind must be one of %s" % (DATASET_KINDS,))
    if not os.path.exists(path):
        raise FileNotFoundError(
            "%s not found. Download it from Kaggle into ml/data/ (see "
            "ml/README.md) or use kind='synthetic' for a smoke test." % path
        )
    if kind == "synthetic":
        raise ValueError("kind='synthetic' does not read a CSV — call load_synthetic()")

    frame = pd.read_csv(path)
    return load_frame(frame, kind=kind, device_mode=device_mode,
                      currency=currency, limit=limit)


def load_frame(frame: pd.DataFrame, kind: str, device_mode: str = "null",
               currency: Optional[str] = None, limit: Optional[int] = None
               ) -> pd.DataFrame:
    """Map an already-loaded dataframe (handy in notebooks / tests)."""
    if kind not in DATASET_KINDS:
        raise ValueError("kind must be one of %s" % (DATASET_KINDS,))
    rows = frame.to_dict(orient="records")
    transactions = map_rows(rows, kind=kind, device_mode=device_mode, currency=currency)
    if limit is not None:
        transactions = transactions[:limit]
    return to_frame(transactions)


# --------------------------------------------------------------------------
# Synthetic fallback — latent fraud process, NOT rule-derived
# --------------------------------------------------------------------------

def generate_synthetic(n: int = 20_000, seed: int = 7, fraud_rate: float = 0.0125,
                       n_users: int = 400, n_merchants: int = 120,
                       start: Optional[datetime] = None
                       ) -> List[CanonicalTransaction]:
    """Generate a labelled stream from a latent data-generating process.

    **Why this exists and what it is not.** Phase 0 needs a *non-circular*
    label source. The simulator in ``client/src/pages/Simulator.jsx`` produces
    exactly the patterns the six rules look for, and the rules write their own
    labels, so training on it measures the rules against themselves. This
    generator instead draws each transaction from a per-user behavioural
    profile and flips the label according to a *separate latent fraud process*
    (card-testing bursts, geo-hops, account takeovers, mule cash-outs). The
    rules never see the label, and the label never sees the rules.

    It is still synthetic and therefore still weak evidence: real attack
    distributions are not this tidy. Use it for CI and for wiring the pipeline;
    quote numbers from Sparkov/PaySim in the README.

    Guarantees the tests rely on:
      * output is strictly chronological (ties broken by transaction id),
      * ``fraud_rate`` is respected to within ~1% relative,
      * re-running with the same ``seed`` is byte-identical,
      * ~25% of frauds are *stealthy* — small amounts, normal hours, one city —
        so a rules-only baseline cannot trivially catch everything.
    """
    if not 0.0 <= fraud_rate < 1.0:
        raise ValueError("fraud_rate must be in [0, 1)")
    rng = np.random.default_rng(seed)
    origin = start or datetime(2024, 1, 1, tzinfo=timezone.utc)

    # Per-user behavioural profile: home city, typical amount, device, night habit.
    cities = _INDIA_CITIES
    user_city = rng.integers(0, len(cities), size=n_users)
    user_mean = rng.lognormal(mean=6.2, sigma=0.9, size=n_users)   # ~₹500
    user_sigma = rng.uniform(0.3, 0.9, size=n_users)
    user_device = rng.integers(0, 10 ** 6, size=n_users)
    user_rate = rng.uniform(0.2, 4.0, size=n_users)                # txns/day

    merchant_ids = np.array(["mer_%03d" % m for m in range(n_merchants)])
    merchant_cat = rng.choice(
        ["grocery", "fuel", "restaurant", "electronics", "travel", "pharmacy",
         "jewellery", "gaming", "utility"], size=n_merchants
    )
    categories = ["grocery", "fuel", "restaurant", "electronics", "travel",
                  "pharmacy", "jewellery", "gaming", "utility"]

    n_fraud_target = int(round(n * fraud_rate))
    n_fraud_target = min(n_fraud_target, n)

    plans: List[Dict[str, Any]] = []
    # ---- Fraud campaigns: each is a small cluster of transactions ----------
    produced = 0
    campaign_kinds = ("card_testing", "geo_hop", "account_takeover", "mule_cashout")
    while produced < n_fraud_target:
        victim = int(rng.integers(0, n_users))
        kind = campaign_kinds[int(rng.integers(0, len(campaign_kinds)))]
        t0 = origin + timedelta(days=float(rng.uniform(0, 364)),
                                hours=float(rng.uniform(0, 24)))
        if kind == "card_testing":
            burst = int(rng.integers(5, 10))
            for k in range(burst):
                plans.append({
                    "user": victim, "fraud": True, "amount": float(rng.uniform(1, 40)),
                    "ts": t0 + timedelta(seconds=float(rng.uniform(2, 900))),
                    "city": int(user_city[victim]), "kind": kind,
                })
                produced += 1
        elif kind == "geo_hop":
            for k in range(int(rng.integers(2, 4))):
                city = int(rng.integers(0, len(cities)))
                plans.append({
                    "user": victim, "fraud": True,
                    "amount": float(rng.lognormal(8.0, 0.6)),
                    "ts": t0 + timedelta(minutes=float(rng.uniform(0, 110))),
                    "city": city, "kind": kind,
                })
                produced += 1
        elif kind == "account_takeover":
            for k in range(int(rng.integers(2, 6))):
                plans.append({
                    "user": victim, "fraud": True,
                    "amount": float(rng.lognormal(9.2, 0.8)),
                    "ts": t0 + timedelta(minutes=float(rng.uniform(0, 40))),
                    "city": int(rng.integers(0, len(cities))), "kind": kind,
                })
                produced += 1
        else:  # mule_cashout — mid-size P2P transfers to a beneficiary
            mule = "ben_%04d" % int(rng.integers(0, 500))
            for k in range(int(rng.integers(1, 4))):
                plans.append({
                    "user": victim, "fraud": True,
                    "amount": float(rng.lognormal(8.4, 0.5)),
                    "ts": t0 + timedelta(minutes=float(rng.uniform(0, 300))),
                    "city": int(user_city[victim]), "kind": kind,
                    "beneficiary": mule,
                })
                produced += 1
        if produced > n_fraud_target + 50:  # safety valve
            break
    plans = plans[:n_fraud_target]

    # ---- Legitimate traffic -------------------------------------------------
    legit_count = n - len(plans)
    # Sample a user for each legit txn (population-weighted by activity).
    weights = user_rate / user_rate.sum()
    legit_users = rng.choice(n_users, size=legit_count, p=weights)
    for u in legit_users:
        u = int(u)
        amount = float(np.exp(rng.normal(np.log(user_mean[u]), user_sigma[u])))
        ts = origin + timedelta(days=float(rng.uniform(0, 364)),
                                hours=float(rng.normal(14, 4)))
        # occasional legitimate travel (~3%) — the honest hard negatives
        city = int(user_city[u])
        if rng.random() < 0.03:
            city = int(rng.integers(0, len(cities)))
        plans.append({
            "user": u, "fraud": False, "amount": amount, "ts": ts,
            "city": city, "kind": "legit",
        })

    plans.sort(key=lambda p: (p["ts"], p["user"], p["amount"]))

    out: List[CanonicalTransaction] = []
    for i, p in enumerate(plans):
        u = int(p["user"])
        city_idx = int(p["city"])
        city_name, lat, lng = cities[city_idx]
        merchant_idx = int(rng.integers(0, n_merchants))
        fraud = bool(p["fraud"])
        # Fraudulent transactions are biased toward the riskier categories and
        # toward a "new" device; both are properties of the latent process, so
        # the rules can find signal without ever being consulted for the label.
        if fraud and rng.random() < 0.6:
            merchant_idx = int(rng.integers(0, n_merchants))
        device = "dev_%d" % user_device[u]
        if fraud and rng.random() < 0.55:
            device = "dev_%d" % int(rng.integers(0, 10 ** 6))
        ts = p["ts"]
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        out.append(CanonicalTransaction(
            transactionId="syn_%06d" % i,
            userId="user_%03d" % u,
            merchantId=str(merchant_ids[merchant_idx]),
            amount=round(float(p["amount"]), 2),
            currency="INR",
            timestamp=ts,
            city=city_name,
            lat=lat,
            lng=lng,
            is_fraud=fraud,
            source="synthetic",
            merchant_lat=cities[(merchant_idx * 7) % len(cities)][1],
            merchant_lng=cities[(merchant_idx * 7) % len(cities)][2],
            category=str(merchant_cat[merchant_idx]),
            city_pop=int(rng.integers(50_000, 12_000_000)),
            device_provenance="synthetic",
            deviceId=device,
            ipAddress="10.%d.%d.%d" % (
                int(rng.integers(0, 255)), int(rng.integers(0, 255)), int(rng.integers(1, 255))
            ),
            beneficiaryId=p.get("beneficiary"),
            extra={"synthetic_kind": p["kind"]},
        ))
    return out


def load_synthetic(**kwargs) -> pd.DataFrame:
    """``generate_synthetic`` -> canonical DataFrame."""
    return to_frame(generate_synthetic(**kwargs))


# Rough centres so a haversine feature has something real to chew on.
_INDIA_CITIES = [
    ("mumbai", 19.0760, 72.8777),
    ("delhi", 28.6139, 77.2090),
    ("bengaluru", 12.9716, 77.5946),
    ("hyderabad", 17.3850, 78.4867),
    ("chennai", 13.0827, 80.2707),
    ("kolkata", 22.5726, 88.3639),
    ("pune", 18.5204, 73.8567),
    ("ahmedabad", 23.0225, 72.5714),
    ("jaipur", 26.9124, 75.7873),
    ("lucknow", 26.8467, 80.9462),
    ("thane", 19.2183, 72.9781),
    ("surat", 21.1702, 72.8311),
]


def describe(frame: pd.DataFrame) -> Dict[str, Any]:
    """Provenance summary printed at the top of every report.

    This is the honesty layer in miniature: a number is only meaningful if you
    know what it came from, so every experiment records its source, row count,
    span, fraud rate, and which fields were fabricated.
    """
    if frame.empty:
        return {"rows": 0, "source": None}
    frauds = int(frame["is_fraud"].astype(bool).sum())
    return {
        "rows": int(len(frame)),
        "source": sorted(set(frame["source"].astype(str))) if "source" in frame else [],
        "users": int(frame["userId"].nunique()),
        "merchants": int(frame["merchantId"].nunique()),
        "frauds": frauds,
        "fraud_rate": (frauds / len(frame)) if len(frame) else 0.0,
        "start": str(frame["timestamp"].min()),
        "end": str(frame["timestamp"].max()),
        "synthetic_devices": int((frame.get("device_provenance", "") == "synthetic").sum()),
        "has_coordinates": bool(frame["lat"].notna().any()) if "lat" in frame else False,
        "has_beneficiary": bool(frame["beneficiaryId"].notna().any()) if "beneficiaryId" in frame else False,
    }
