"""Tests for payguard_ml.dataset."""

import numpy as np
import pandas as pd
import pytest

from payguard_ml import dataset
from payguard_ml.schema import CanonicalTransaction


class TestSyntheticGenerator:
    def test_is_chronological(self):
        txs = dataset.generate_synthetic(n=2000, seed=11)
        ts = [t.timestamp for t in txs]
        assert ts == sorted(ts)

    def test_is_deterministic_for_a_seed(self):
        a = dataset.generate_synthetic(n=500, seed=42)
        b = dataset.generate_synthetic(n=500, seed=42)
        assert [t.transactionId for t in a] == [t.transactionId for t in b]
        assert [t.amount for t in a] == [t.amount for t in b]
        assert [t.is_fraud for t in a] == [t.is_fraud for t in b]

    def test_different_seed_gives_different_data(self):
        a = dataset.generate_synthetic(n=500, seed=1)
        b = dataset.generate_synthetic(n=500, seed=2)
        assert [t.amount for t in a] != [t.amount for t in b]

    def test_fraud_rate_is_respected(self):
        txs = dataset.generate_synthetic(n=10_000, seed=5, fraud_rate=0.02)
        rate = sum(t.is_fraud for t in txs) / len(txs)
        assert 0.018 < rate < 0.022

    def test_labels_are_not_all_one_kind(self):
        txs = dataset.generate_synthetic(n=4000, seed=9, fraud_rate=0.03)
        assert 0 < sum(t.is_fraud for t in txs) < len(txs)

    def test_device_provenance_is_marked_synthetic(self):
        txs = dataset.generate_synthetic(n=200, seed=3)
        assert all(t.device_provenance == "synthetic" for t in txs)
        assert all(t.source == "synthetic" for t in txs)

    def test_rejects_bad_fraud_rate(self):
        with pytest.raises(ValueError):
            dataset.generate_synthetic(n=10, fraud_rate=1.5)

    def test_frame_has_expected_columns(self):
        frame = dataset.load_synthetic(n=300, seed=8)
        for col in ["userId", "merchantId", "amount", "timestamp", "is_fraud", "source"]:
            assert col in frame.columns
        assert pd.api.types.is_datetime64_any_dtype(frame["timestamp"])


class TestLoadFrame:
    def test_loads_sparkov_shaped_frame(self):
        frame = pd.DataFrame([{
            "trans_date_trans_time": "2020-01-01 10:00:00",
            "cc_num": "1", "merchant": "Shop A", "category": "grocery", "amt": 12.5,
            "city": "Pune", "lat": 18.5, "long": 73.8, "city_pop": 1000,
            "trans_num": "t1", "merch_lat": 18.6, "merch_long": 73.9, "is_fraud": 0,
        }])
        out = dataset.load_frame(frame, kind="sparkov")
        assert len(out) == 1
        assert out.iloc[0]["userId"] == "cc_1"

    def test_load_csv_rejects_unknown_kind(self, tmp_path):
        with pytest.raises(ValueError):
            dataset.load_csv(str(tmp_path / "x.csv"), kind="nope")

    def test_load_csv_gives_actionable_error_when_missing(self, tmp_path):
        with pytest.raises(FileNotFoundError) as exc:
            dataset.load_csv(str(tmp_path / "missing.csv"), kind="sparkov")
        assert "Kaggle" in str(exc.value)

    def test_limit_takes_the_earliest_rows(self):
        frame = pd.DataFrame([
            {"trans_date_trans_time": "2020-01-0%d 10:00:00" % d, "cc_num": "1",
             "merchant": "Shop", "category": "grocery", "amt": 1.0, "city": "Pune",
             "lat": 18.5, "long": 73.8, "city_pop": 1000, "trans_num": "t%d" % d,
             "merch_lat": 18.6, "merch_long": 73.9, "is_fraud": 0}
            for d in range(1, 6)
        ])
        out = dataset.load_frame(frame, kind="sparkov", limit=2)
        assert list(out["transactionId"]) == ["t1", "t2"]


class TestDescribe:
    def test_describe_reports_provenance(self):
        frame = dataset.load_synthetic(n=1000, seed=13)
        info = dataset.describe(frame)
        assert info["rows"] == 1000
        assert info["source"] == ["synthetic"]
        assert info["frauds"] > 0
        assert 0 < info["fraud_rate"] < 1

    def test_describe_handles_empty(self):
        assert dataset.describe(pd.DataFrame())["rows"] == 0


class TestFixtureGuard:
    def test_generator_does_not_consult_the_rules(self):
        """A structural guard: the generator must not import the rule engine or
        any scoring code. Its labels come from the latent process only."""
        import inspect
        source = inspect.getsource(dataset.generate_synthetic)
        for forbidden in ("FraudScoringService", "rulesTriggered", "fraudScore", "callFraudEngine"):
            assert forbidden not in source

    def test_canonical_columns_present(self):
        tx = CanonicalTransaction(
            transactionId="x", userId="u", merchantId="m", amount=1.0,
            currency="INR", timestamp=dataset.datetime.now(dataset.timezone.utc),
        )
        for col in ("transactionId", "userId", "merchantId", "amount", "timestamp"):
            assert col in tx.to_record()
