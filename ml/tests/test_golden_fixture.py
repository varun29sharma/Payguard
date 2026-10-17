"""Python side of the golden-fixture contract.

`ml/artifacts/golden_features.json` is generated once and must be reproduced by
three implementations:

* **Python** (this file) — the offline feature computation used for training.
* **Node** (`server/test/featureParity.test.js`) — the online feature computation used for serving.
* **Java** (`LogisticModelScorerTest`) — the scoring of the *same weights*, so
  the sigmoid + Platt application cannot drift either.

The fixture also carries each row's calibrated probability, so the model
artefact is pinned, not just the features.
"""

import json
import os

import pandas as pd
import pytest

from payguard_ml import features
from payguard_ml.baseline import RULE_NAMES

FIXTURE = os.path.join(os.path.dirname(__file__), "..", "artifacts", "golden_features.json")
TOLERANCE = 1e-9


@pytest.fixture(scope="module")
def fixture():
    if not os.path.exists(FIXTURE):
        pytest.skip("golden fixture missing — run `python make_golden_fixture.py`")
    with open(FIXTURE, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _frame_from_stream(stream):
    records = []
    for row in stream:
        location = row.get("location") or {}
        fired = {r.get("ruleName") for r in (row.get("rulesTriggered") or [])}
        record = {
            "transactionId": row["transactionId"],
            "userId": row["userId"],
            "merchantId": row["merchantId"],
            "amount": row["amount"],
            "timestamp": pd.Timestamp(row["timestamp"]),
            "city": location.get("city"),
            "lat": location.get("lat"),
            "lng": location.get("lng"),
            "deviceId": row.get("deviceId"),
            "is_fraud": bool(row.get("isConfirmedFraud", False)),
        }
        for name in RULE_NAMES:
            record[name] = name in fired
        records.append(record)
    return pd.DataFrame(records)


def test_fixture_feature_order_matches_the_contract(fixture):
    assert fixture["feature_names"] == list(features.FEATURE_NAMES)


def test_python_reproduces_every_expected_vector(fixture):
    frame = _frame_from_stream(fixture["stream"])
    computed = features.compute_features(frame)
    by_id = {row["transactionId"]: row for _, row in computed.iterrows()}

    worst = (0.0, None)
    for entry in fixture["expected"]:
        row = by_id[entry["transactionId"]]
        for name, expected in zip(fixture["feature_names"], entry["vector"]):
            got = float(row[name])
            diff = abs(got - expected)
            if diff > worst[0]:
                worst = (diff, (entry["transactionId"], name, got, expected))
    assert worst[0] <= TOLERANCE, "feature drift: %s" % (worst[1],)


def test_fixture_carries_model_probabilities(fixture):
    with_probability = [e for e in fixture["expected"] if "probability" in e]
    assert with_probability, "fixture has no probabilities — regenerate with model-v1.json present"
    model_version = fixture.get("model_version")
    assert model_version is not None
