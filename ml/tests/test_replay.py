"""Tests for payguard_ml.replay.

These run entirely in ``dry_run`` mode, so they need no running stack. That is
itself a design goal: the pipeline's correctness (ordering, timestamp
round-trip, dispute wiring) is testable in CI; only the final end-to-end pass
needs the three services up.
"""

import json

import pytest

from payguard_ml import dataset, replay
from payguard_ml.schema import CanonicalTransaction


@pytest.fixture()
def transactions():
    return dataset.generate_synthetic(n=400, seed=21, fraud_rate=0.05)


class TestReplayDryRun:
    def test_writes_jsonl_and_reports_counts(self, tmp_path, transactions):
        out = tmp_path / "replay.jsonl"
        report = replay.replay_transactions(
            transactions, dry_run_path=str(out), progress_every=0
        )
        rows = replay.load_dry_run(str(out))
        assert len(rows) == len(transactions)
        assert report.posted == len(transactions)
        assert report.failed == 0
        assert report.dry_run is True
        assert report.disputes_posted == sum(1 for t in transactions if t.is_fraud)

    def test_replays_chronologically_even_from_shuffled_input(self, tmp_path, transactions):
        shuffled = list(reversed(transactions))
        out = tmp_path / "replay.jsonl"
        report = replay.replay_transactions(shuffled, dry_run_path=str(out), progress_every=0)
        stamps = [o.source_timestamp for o in report.outcomes]
        assert stamps == sorted(stamps)
        replay.assert_chronological([o for o in report.outcomes])  # sanity on the helper

    def test_timestamp_round_trip_is_verified(self, tmp_path, transactions):
        out = tmp_path / "replay.jsonl"
        report = replay.replay_transactions(transactions, dry_run_path=str(out), progress_every=0)
        replay.verify_timestamp_roundtrip(report, tolerance_ms=1.0)

    def test_round_trip_check_catches_a_corrupted_timestamp(self, tmp_path, transactions):
        out = tmp_path / "replay.jsonl"
        report = replay.replay_transactions(
            transactions[:20], dry_run_path=str(out), progress_every=0
        )
        # Simulate the original bug: the ingest stamped "now" instead of the
        # caller's timestamp.
        from payguard_ml import schema
        for outcome in report.outcomes:
            outcome.stored_timestamp = schema.parse_timestamp("2026-01-01T00:00:00Z")
        with pytest.raises(AssertionError) as exc:
            replay.verify_timestamp_roundtrip(report, tolerance_ms=1000.0)
        assert "round-trip failed" in str(exc.value)

    def test_body_in_jsonl_carries_timestamp(self, tmp_path, transactions):
        out = tmp_path / "replay.jsonl"
        replay.replay_transactions(transactions, dry_run_path=str(out), progress_every=0)
        rows = replay.load_dry_run(str(out))
        assert "timestamp" in rows[0]["body"]
        assert rows[0]["body"]["timestamp"].endswith("+00:00")

    def test_no_label_derived_from_rules(self, tmp_path, transactions):
        out = tmp_path / "replay.jsonl"
        report = replay.replay_transactions(transactions, dry_run_path=str(out), progress_every=0)
        replay.assert_no_label_from_rules(report.outcomes)

    def test_requires_client_or_dry_run(self, transactions):
        with pytest.raises(ValueError):
            replay.replay_transactions(transactions, progress_every=0)

    def test_limit_replays_earliest(self, tmp_path, transactions):
        out = tmp_path / "replay.jsonl"
        report = replay.replay_transactions(
            transactions, dry_run_path=str(out), limit=25, progress_every=0
        )
        assert len(report.outcomes) == 25


class TestVerificationHelpers:
    def test_assert_chronological_detects_disorder(self):
        a = dataset.generate_synthetic(n=10, seed=1)
        with pytest.raises(AssertionError):
            replay.assert_chronological(list(reversed(a)))

    def test_no_label_from_rules_allows_disputed_rule_hits(self, transactions):
        out = replay.ReplayOutcome(
            source_transaction_id="x", payguard_transaction_id="x",
            source_timestamp=transactions[0].timestamp, stored_timestamp=None,
            status_code=201, fraud_status="review", fraud_score=60,
            rules_triggered=["AMOUNT_THRESHOLD_RULE"], is_fraud_label=True,
            dispute_posted=True,
        )
        replay.assert_no_label_from_rules([out])

    def test_no_label_from_rules_flags_rule_derived_label(self, transactions):
        out = replay.ReplayOutcome(
            source_transaction_id="x", payguard_transaction_id="x",
            source_timestamp=transactions[0].timestamp, stored_timestamp=None,
            status_code=201, fraud_status="review", fraud_score=60,
            rules_triggered=["AMOUNT_THRESHOLD_RULE"], is_fraud_label=True,
            dispute_posted=False,
        )
        with pytest.raises(AssertionError):
            replay.assert_no_label_from_rules([out])
