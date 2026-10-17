#!/usr/bin/env python
"""make_golden_fixture.py — write the shared feature-parity fixture.

Features are computed in Python (offline, for training) and in Node (online, for
serving). Two implementations of 25 fiddly point-in-time definitions *will*
drift, and when they do the model is silently scored on features it was never
trained on — training/serving skew, one of the great silent killers in
production ML.

This script writes the contract both sides must satisfy:

    ml/artifacts/golden_features.json
      { feature_names, stream: [...rows...], expected: [{transactionId, vector}] }

`ml/tests/test_golden_fixture.py` asserts Python still reproduces `expected`.
`server/test/featureParity.test.js` asserts Node reproduces the same `expected`
from the same `stream`. If either side changes a definition, one of them fails.

Regenerate after *any* deliberate change to the feature contract:

    ./.venv/bin/python make_golden_fixture.py
"""

from __future__ import annotations

import json
import math
import os
import sys
from datetime import timezone
from typing import Any, Dict, List, Optional

import pandas as pd

from payguard_ml import features
from payguard_ml.baseline import RULE_NAMES, simulate_rule_engine

OUTPUT = os.path.join(os.path.dirname(__file__), "artifacts", "golden_features.json")
MODEL = os.path.join(os.path.dirname(__file__), "artifacts", "model-v1.json")

# Small and hand-controlled: enough rows to exercise every window and both a
# cold-start user and a returning one, few enough to read if it ever fails.
N_ROWS = 120
SEED = 20240101


def build_stream() -> pd.DataFrame:
    """A deterministic stream with unique timestamps (no tie-break ambiguity)."""
    from payguard_ml.dataset import load_synthetic

    frame = load_synthetic(n=N_ROWS, seed=SEED, fraud_rate=0.05, n_users=12, n_merchants=8)
    frame = frame.sort_values(["timestamp", "transactionId"]).reset_index(drop=True)
    # Force uniqueness so "prior" is unambiguous for both implementations.
    frame["timestamp"] = pd.to_datetime(frame["timestamp"], utc=True)
    if frame["timestamp"].duplicated().any():
        offsets = pd.to_timedelta(range(len(frame)), unit="s")
        frame["timestamp"] = frame["timestamp"] + offsets
    frame = simulate_rule_engine(frame)  # rule flags from the faithful stand-in
    return frame


def to_stream_row(row: pd.Series) -> Dict[str, Any]:
    fired = [name for name in RULE_NAMES if bool(row.get(name, False))]
    location: Dict[str, Any] = {}
    if row.get("city") is not None and row.get("city") == row.get("city"):
        location["city"] = str(row["city"])
    if row.get("lat") is not None and row.get("lat") == row.get("lat"):
        location["lat"] = float(row["lat"])
    if row.get("lng") is not None and row.get("lng") == row.get("lng"):
        location["lng"] = float(row["lng"])
    return {
        "transactionId": str(row["transactionId"]),
        "userId": str(row["userId"]),
        "merchantId": str(row["merchantId"]),
        "amount": float(row["amount"]),
        # Millisecond precision only: MongoDB stores Date at ms, and ECMAScript
        # Date parsing only accepts exactly 3 fractional digits.
        "timestamp": row["timestamp"].to_pydatetime().astimezone(timezone.utc).isoformat(timespec="milliseconds"),
        "location": location,
        "deviceId": None if row.get("deviceId") != row.get("deviceId") else str(row.get("deviceId")),
        # The Node implementation reads the label as isConfirmedFraud (what the
        # Dispute loop writes); Python reads is_fraud. They must be the same
        # value for the merchant dispute-rate feature to agree.
        "isConfirmedFraud": bool(row["is_fraud"]),
        "rulesTriggered": [{"ruleName": name} for name in fired],
    }


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    ez = math.exp(z)
    return ez / (1.0 + ez)


def _logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def score_with_artifact(vector: List[float], artifact: Dict[str, Any]) -> Optional[float]:
    """Compute the calibrated probability exactly as LogisticModelScorer.java does.

    Included so the golden fixture pins the *scorer* as well as the features: if
    Java's sigmoid/Platt application drifts from Python's, the Java test fails.
    """
    if not artifact or not artifact.get("weights"):
        return None
    weights = artifact["weights"]
    if len(weights) != len(vector):
        return None
    linear = float(artifact["intercept"]) + sum(w * x for w, x in zip(weights, vector))
    raw = _sigmoid(linear)
    calibration = artifact.get("calibration") or {}
    method = calibration.get("method", "none")
    if method == "platt":
        return _sigmoid(float(calibration["slope"]) * _logit(raw) + float(calibration["intercept"]))
    if method == "isotonic":
        xs = calibration.get("x", [])
        ys = calibration.get("y", [])
        if not xs:
            return raw
        return float(min(max(raw, xs[0]), xs[-1]))  # clamp; interpolation tested in Java
    return raw


def main() -> int:
    frame = build_stream()
    computed = features.compute_features(frame)
    feature_names = list(features.FEATURE_NAMES)

    artifact: Dict[str, Any] = {}
    if os.path.exists(MODEL):
        with open(MODEL, "r", encoding="utf-8") as fh:
            artifact = json.load(fh)
        if artifact.get("features") != feature_names:
            print("WARNING: model-v1.json feature order differs from features.py; "
                  "scores are omitted from the fixture.", file=sys.stderr)
            artifact = {}

    stream: List[Dict[str, Any]] = [to_stream_row(row) for _, row in frame.iterrows()]
    by_id = {row["transactionId"]: i for i, row in enumerate(stream)}

    expected = []
    for _, row in computed.iterrows():
        tid = str(row["transactionId"])
        if tid not in by_id:
            continue
        vector = [float(row[name]) for name in feature_names]
        entry = {"transactionId": tid, "vector": vector}
        probability = score_with_artifact(vector, artifact)
        if probability is not None:
            entry["probability"] = probability
        expected.append(entry)

    payload = {
        "generated_by": "ml/make_golden_fixture.py",
        "n_rows": len(stream),
        "feature_names": feature_names,
        "model_version": artifact.get("version"),
        "stream": stream,
        "expected": expected,
    }
    os.makedirs(os.path.dirname(OUTPUT), exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=1)
    print("Wrote %s (%d rows, %d features)" % (OUTPUT, len(stream), len(feature_names)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
