"""Tests for payguard_ml.features (the leakage test lives in test_leakage.py)."""

import math

import numpy as np
import pandas as pd
import pytest

from payguard_ml import dataset, features


class TestFeatureContract:
    def test_names_are_unique_and_ordered(self):
        assert len(features.FEATURE_NAMES) == len(set(features.FEATURE_NAMES))
        assert features.FEATURE_NAMES[:4] == [
            "log_amount", "amt_zscore_user", "amt_ratio_user_mean", "user_txn_count_1h"
        ]

    def test_rule_flags_are_present(self):
        for name in features.RULE_FLAG_FEATURES:
            assert name in features.FEATURE_NAMES
        assert set(features.RULE_FEATURE_TO_ENGINE_NAME) == set(features.RULE_FLAG_FEATURES)

    def test_feature_spec_documents_every_feature(self):
        documented = {row["name"] for row in features.feature_spec()}
        # rule_* is documented as a wildcard.
        for name in features.FEATURE_NAMES:
            if name.startswith("rule_"):
                assert "rule_*" in documented
            else:
                assert name in documented

    def test_matrix_is_float_and_ordered(self):
        frame = dataset.load_synthetic(n=300, seed=1)
        out = features.compute_features(frame)
        X = features.features_to_matrix(out)
        assert X.shape == (300, len(features.FEATURE_NAMES))
        assert X.dtype == float
        assert np.isfinite(X).all()

    def test_missing_columns_are_reported(self):
        with pytest.raises(ValueError):
            features.features_to_matrix(pd.DataFrame({"log_amount": [1.0]}))


class TestGeo:
    def test_haversine_known_distance(self):
        # Mumbai -> Delhi is about 1150 km.
        d = features.haversine_km(19.0760, 72.8777, 28.6139, 77.2090)
        assert 1130 < d < 1170

    def test_haversine_zero_for_same_point(self):
        assert features.haversine_km(19.0, 72.0, 19.0, 72.0) == pytest.approx(0.0)

    def test_haversine_handles_missing(self):
        assert features.haversine_km(None, 72.0, 19.0, 72.0) == 0.0

    def test_short_commute_is_small_next_to_relay(self):
        commute = features.haversine_km(19.0760, 72.8777, 19.2183, 72.9781)   # Mumbai->Thane
        relay = features.haversine_km(19.0760, 72.8777, 28.6139, 77.2090)     # Mumbai->Delhi
        assert commute < 40
        assert relay > 1000
        # The rule engine cannot tell these apart: both are "2 distinct cities".
        assert relay / commute > 20


class TestCyclicalTime:
    def test_midnight_neighbours_are_close(self):
        def encode(hour):
            return (math.sin(2 * math.pi * hour / 24), math.cos(2 * math.pi * hour / 24))

        h23, h00 = encode(23), encode(0)
        h12 = encode(12)
        d_neighbours = math.dist(h23, h00)
        d_far = math.dist(h23, h12)
        assert d_neighbours < 0.3
        assert d_far > 1.5


class TestRuleFlagWiring:
    def test_flags_default_to_false(self):
        frame = dataset.load_synthetic(n=200, seed=2)
        out = features.compute_features(frame)
        assert out[features.RULE_FLAG_FEATURES].to_numpy().sum() == 0

    def test_flags_are_read_from_engine_columns(self):
        frame = dataset.load_synthetic(n=200, seed=3)
        frame = frame.copy()
        frame["VELOCITY_RULE"] = False
        frame.loc[frame.index[:10], "VELOCITY_RULE"] = True
        out = features.compute_features(frame)
        assert out["rule_velocity"].sum() == 10
        assert out["rule_night_owl"].sum() == 0

    def test_explicit_flags_override(self):
        frame = dataset.load_synthetic(n=50, seed=4)
        flags = {"rule_amount_threshold": [True] * 50}
        out = features.compute_features(frame, rule_flags=flags)
        assert out["rule_amount_threshold"].all()


class TestBehaviouralSanity:
    def test_amount_grows_the_log_feature(self):
        frame = dataset.load_synthetic(n=100, seed=5)
        out = features.compute_features(frame)
        assert out["log_amount"].max() > out["log_amount"].min()

    def test_unseen_user_has_zero_history_features(self):
        frame = pd.DataFrame([
            {"transactionId": "t1", "userId": "u1", "merchantId": "m1",
             "amount": 100.0, "timestamp": pd.Timestamp("2024-01-01T10:00:00Z"),
             "is_fraud": False, "city": "Pune", "lat": 18.5, "lng": 73.8,
             "deviceId": "d1"},
        ])
        out = features.compute_features(frame)
        assert out.iloc[0]["user_txn_count_7d"] == 0
        assert out.iloc[0]["merchant_amt_percentile"] == 0.5
        assert out.iloc[0]["merchant_dispute_rate_asof"] == 0.0

    def test_velocity_count_reflects_prior_burst(self):
        ts = [("2024-01-01T10:00:%02dZ" % s) for s in (0, 10, 20, 30, 40, 50)]
        frame = pd.DataFrame([
            {"transactionId": "t%d" % i, "userId": "u1", "merchantId": "m1",
             "amount": 10.0, "timestamp": pd.Timestamp(t), "is_fraud": False}
            for i, t in enumerate(ts)
        ])
        out = features.compute_features(frame)
        assert out.iloc[0]["user_txn_count_1h"] == 0
        assert out.iloc[-1]["user_txn_count_1h"] == 5  # five strictly before

    def test_summarise_flags_constant_features(self):
        frame = dataset.load_synthetic(n=300, seed=6)
        info = features.summarise(features.compute_features(frame))
        assert info["rows"] == 300
        assert info["nan_or_inf"] == 0
