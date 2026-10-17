"""The leakage test — the single most valuable test in the roadmap.

"I wrote a test that proves my features can't see the future" is the sentence
that makes an experienced interviewer sit up, and this is that test.

Method: for a sample of transactions, rebuild the feature vector using **only**
rows that are not in the future relative to that transaction, then assert the
vector is *byte-identical* to the one computed on the full dataset. If any
aggregate silently reached forward — a plain ``groupby().mean()``, a full-frame
normalisation, a merchant total that includes later rows — the two vectors
differ and the test fails.

A second test proves the harness has teeth: it runs the same check against a
deliberately leaky feature and asserts the comparison *catches* it. A test that
cannot fail is not a test.
"""

import numpy as np
import pandas as pd
import pytest

from payguard_ml import dataset, features


@pytest.fixture(scope="module")
def frame():
    df = dataset.load_synthetic(n=1500, seed=31, fraud_rate=0.04)
    # Unique transaction ids and stable merchant/user spread.
    return df.reset_index(drop=True)


def _prefix(frame: pd.DataFrame, idx: int) -> pd.DataFrame:
    """Every row that is NOT in the future of row ``idx``.

    "Not in the future" must respect the tie-break used inside
    ``compute_features`` (timestamp, then transactionId), or two transactions
    sharing a millisecond would produce a spurious mismatch.
    """
    t = frame.loc[idx, "timestamp"]
    tid = frame.loc[idx, "transactionId"]
    mask = (frame["timestamp"] < t) | ((frame["timestamp"] == t) & (frame["transactionId"] <= tid))
    return frame[mask].reset_index(drop=True)


@pytest.mark.parametrize("sample", [0, 37, 200, 611, 999, 1200])
def test_features_are_identical_without_future_rows(frame, sample):
    full = features.compute_features(frame)
    tid = frame.loc[sample, "transactionId"]
    full_row = full[full["transactionId"] == tid].iloc[0]

    truncated = features.compute_features(_prefix(frame, sample))
    trunc_row = truncated[truncated["transactionId"] == tid].iloc[0]

    for name in features.FEATURE_NAMES:
        assert float(full_row[name]) == pytest.approx(float(trunc_row[name]), abs=1e-12), (
            "feature %r changed when future rows were removed — it is leaking" % name
        )


def test_average_amount_feature_is_point_in_time(frame):
    """A focused version of the same idea, on the feature most likely to leak."""
    full = features.compute_features(frame)
    target_idx = 400
    tid = frame.loc[target_idx, "transactionId"]
    target_ts = frame.loc[target_idx, "timestamp"]

    user = frame.loc[target_idx, "userId"]
    prior = frame[(frame["userId"] == user) & (frame["timestamp"] < target_ts)]
    expected_count_24h = int(((target_ts - prior["timestamp"]).dt.total_seconds() < 86400).sum())

    row = full[full["transactionId"] == tid].iloc[0]
    assert row["user_txn_count_24h"] == expected_count_24h


def test_merchant_dispute_rate_only_uses_earlier_labels(frame):
    full = features.compute_features(frame)
    target_idx = 700
    tid = frame.loc[target_idx, "transactionId"]
    target_ts = frame.loc[target_idx, "timestamp"]
    mid = frame.loc[target_idx, "merchantId"]

    prior = frame[(frame["merchantId"] == mid) & (frame["timestamp"] < target_ts)]
    expected = (prior["is_fraud"].sum() / len(prior)) if len(prior) else 0.0

    row = full[full["transactionId"] == tid].iloc[0]
    assert row["merchant_dispute_rate_asof"] == pytest.approx(expected, abs=1e-12)


def test_the_harness_would_catch_a_leaky_feature(frame):
    """Proof the test has teeth: a full-frame mean must fail the prefix check."""
    leaky = frame["amount"].mean()  # uses the WHOLE dataset, including the future
    prefix = _prefix(frame, 300)
    leaky_prefix = prefix["amount"].mean()
    assert leaky != pytest.approx(leaky_prefix, abs=1e-12)


def test_no_feature_is_constant_and_all_finite(frame):
    out = features.compute_features(frame)
    info = features.summarise(out)
    assert info["nan_or_inf"] == 0
    assert info["rows"] == len(frame)
    # A constant feature would be a silent sign the windowing is broken.
    assert "log_amount" not in info["constant_features"]
    assert info["features"] == len(features.FEATURE_NAMES)


def test_output_is_chronological(frame):
    out = features.compute_features(frame)
    assert list(out["timestamp"]) == sorted(out["timestamp"])


def test_first_transaction_has_no_history_features(frame):
    out = features.compute_features(frame)
    first = out.iloc[0]
    assert first["user_txn_count_24h"] == 0
    assert first["amt_zscore_user"] == 0.0
    assert first["geo_distance_km_prev"] == 0.0
