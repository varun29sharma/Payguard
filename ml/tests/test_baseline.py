"""Tests for payguard_ml.baseline — the honest rule baseline and Flaw 1."""

import pandas as pd
import pytest

from payguard_ml import baseline, dataset


class TestAveragingFlaw:
    def test_reproduces_the_java_aggregation(self):
        # FraudScoringService.score: int(mean(fired scores)); 65 -> 65.
        assert baseline.averaging_aggregate([65]) == 65
        assert baseline.averaging_aggregate([]) == 0

    def test_more_evidence_can_mean_less_suspicion(self):
        alone = baseline.averaging_aggregate([80])
        with_weak_signal = baseline.averaging_aggregate([80, 40])
        assert alone == 80
        assert with_weak_signal == 60           # (80+40)/2, truncated
        assert with_weak_signal < alone          # the defect, in one line

    def test_a_firing_rule_can_downgrade_the_status(self):
        alone = baseline._status(baseline.averaging_aggregate([80]))
        with_weak = baseline._status(baseline.averaging_aggregate([80, 40]))
        assert alone == "blocked"
        assert with_weak == "review"
        assert with_weak != alone

    def test_three_weak_signals_dilute_further(self):
        assert baseline.averaging_aggregate([80, 40, 30]) < \
            baseline.averaging_aggregate([80, 40])


class TestAccumulatingAggregate:
    def test_weights_are_positive_for_every_firing_rule(self):
        # The trap: logit(score/100) is negative below 50.
        for score in (1, 20, 40, 55, 80, 100):
            assert baseline.severity_to_weight(score) > 0

    def test_is_monotone_in_added_evidence(self):
        base = [80]
        assert baseline.accumulating_aggregate(base + [40]) >= \
            baseline.accumulating_aggregate(base)
        assert baseline.accumulating_aggregate([65] + [40]) >= \
            baseline.accumulating_aggregate([65])

    def test_never_downgrades_the_status(self):
        alone = baseline._status(baseline.accumulating_aggregate([80]))
        with_weak = baseline._status(baseline.accumulating_aggregate([80, 40]))
        assert alone == "blocked"
        assert with_weak == "blocked"

    def test_counterexample_table_has_the_key_case(self):
        rows = baseline.averaging_flaw_counterexample()
        geo = next(r for r in rows if "GEO + NIGHT_OWL" == r["case"])
        assert geo["averaged_status"] == "review"
        assert geo["accumulated_status"] == "blocked"


class TestBaselineFromFrame:
    @pytest.fixture()
    def frame(self):
        y = [1, 1, 0, 0, 0, 0, 0, 0, 0, 0]
        flagged = [1, 0, 1, 0, 0, 0, 0, 0, 0, 0]
        amount_fired = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0]
        data = {
            "is_fraud": y,
            "flagged": flagged,
            "fraudScore": [65, 0, 20, 0, 0, 0, 0, 0, 0, 0],
            "AMOUNT_THRESHOLD_RULE": amount_fired,
        }
        for rule in baseline.RULE_NAMES:
            data.setdefault(rule, [0] * len(y))
        return pd.DataFrame(data)

    def test_confusion_and_rates(self, frame):
        result = baseline.baseline_from_frame(frame, source="unit-test")
        m = result.metrics
        assert m["confusion"] == {"tp": 1, "fp": 1, "tn": 7, "fn": 1}
        assert m["precision"] == pytest.approx(0.5)
        assert m["recall"] == pytest.approx(0.5)

    def test_per_rule_precision_and_recall(self, frame):
        result = baseline.baseline_from_frame(frame, source="unit-test")
        amount = next(r for r in result.per_rule if r["rule"] == "AMOUNT_THRESHOLD_RULE")
        assert amount["fired"] == 3
        assert amount["caught"] == 2
        assert amount["false_alarms"] == 1
        assert amount["recall"] == pytest.approx(1.0)
        assert amount["precision"] == pytest.approx(2 / 3)

    def test_all_six_rules_are_reported(self, frame):
        result = baseline.baseline_from_frame(frame, source="unit-test")
        assert {r["rule"] for r in result.per_rule} == set(baseline.RULE_NAMES)

    def test_flags_state_labels_are_not_rule_derived(self, frame):
        result = baseline.baseline_from_frame(frame, source="unit-test")
        assert any("rulesTriggered" in f for f in result.flags)

    def test_derives_flag_from_score_when_flag_absent(self, frame):
        trimmed = frame.drop(columns=["flagged"])
        result = baseline.baseline_from_frame(trimmed, source="unit-test")
        # fraudScore 65 >= 40 review threshold → flagged.
        assert result.metrics["confusion"]["tp"] == 1

    def test_rejects_empty_frame(self):
        with pytest.raises(ValueError):
            baseline.baseline_from_frame(pd.DataFrame(), source="x")

    def test_requires_a_decision_column(self):
        with pytest.raises(ValueError):
            baseline.baseline_from_frame(pd.DataFrame({"is_fraud": [0, 1]}), source="x")


class TestExportParsing:
    def test_round_trip(self, tmp_path):
        path = tmp_path / "export.csv"
        path.write_text(
            "timestamp,transactionId,userId,fraudScore,fraudStatus,isConfirmedFraud,rulesTriggered\n"
            "2024-01-01T00:00:00Z,t1,u1,72,blocked,true,VELOCITY_RULE:60; NIGHT_OWL_RULE:40\n"
            "2024-01-01T00:00:01Z,t2,u2,0,clear,false,\n",
            encoding="utf-8",
        )
        frame = baseline.parse_export_csv(str(path))
        assert len(frame) == 2
        assert frame.iloc[0]["is_fraud"] == True  # noqa: E712
        assert frame.iloc[0]["VELOCITY_RULE"] == True  # noqa: E712
        assert frame.iloc[0]["NIGHT_OWL_RULE"] == True  # noqa: E712
        assert frame.iloc[1]["is_fraud"] == False  # noqa: E712

    def test_baseline_from_export(self, tmp_path):
        path = tmp_path / "export.csv"
        path.write_text(
            "timestamp,transactionId,userId,fraudScore,fraudStatus,isConfirmedFraud,rulesTriggered\n"
            "2024-01-01T00:00:00Z,t1,u1,72,blocked,true,VELOCITY_RULE:60\n"
            "2024-01-01T00:00:01Z,t2,u2,0,clear,true,\n"
            "2024-01-01T00:00:02Z,t3,u3,45,review,false,AMOUNT_THRESHOLD_RULE:65\n",
            encoding="utf-8",
        )
        result = baseline.baseline_from_export(str(path))
        assert result.n == 3
        assert result.positives == 2
        assert result.metrics["confusion"]["tp"] == 1   # t1 caught
        assert result.metrics["confusion"]["fn"] == 1   # t2 missed


class TestRendering:
    def test_markdown_contains_the_headline(self):
        result = baseline.demo_baseline(n=2000, seed=1)
        text = baseline.render_markdown(result)
        assert "PR-AUC" in text
        assert "Per-rule precision and recall" in text
        assert "averaging evidence is not monotone" in text

    def test_demo_baseline_is_labelled_synthetic(self):
        result = baseline.demo_baseline(n=1000, seed=2)
        assert result.source == "synthetic-demo"

    def test_write_reports(self, tmp_path):
        result = baseline.demo_baseline(n=1000, seed=3)
        baseline.write_reports(
            result,
            json_path=str(tmp_path / "b.json"),
            markdown_path=str(tmp_path / "b.md"),
        )
        assert (tmp_path / "b.json").exists()
        assert "PR-AUC" in (tmp_path / "b.md").read_text(encoding="utf-8")


class TestNoFutureLeakageInReplayFrame:
    def test_rules_from_replay_uses_dataset_label(self):
        from payguard_ml import replay, schema
        out = replay.ReplayOutcome(
            source_transaction_id="x", payguard_transaction_id="x",
            source_timestamp=dataset.generate_synthetic(n=1, seed=1)[0].timestamp,
            stored_timestamp=None, status_code=201, fraud_status="review",
            fraud_score=60, rules_triggered=["VELOCITY_RULE"], is_fraud_label=True,
            dispute_posted=True,
        )
        frame = baseline.rules_from_replay(replay.ReplayReport(outcomes=[out]))
        assert bool(frame.iloc[0]["is_fraud"]) is True
        assert bool(frame.iloc[0]["VELOCITY_RULE"]) is True
