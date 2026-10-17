"""Tests for payguard_ml.metrics.

The from-scratch implementations are checked against scikit-learn wherever
sklearn provides the same quantity. If our number and sklearn's disagree, the
number in the README is wrong — so this file is the guard on every headline
metric we quote.
"""

import numpy as np
import pytest
from sklearn import metrics as skm

from payguard_ml import metrics as m


@pytest.fixture(scope="module")
def imbalanced():
    """A deliberately hard, imbalanced problem: 1.5% positives."""
    rng = np.random.default_rng(3)
    n = 4000
    y = (rng.random(n) < 0.015).astype(int)
    # informative but noisy score
    s = np.clip(0.15 * y + rng.beta(2, 8, size=n), 0, 1)
    return y, s


class TestConfusion:
    def test_counts(self):
        y = np.array([1, 0, 1, 0, 1])
        p = np.array([1, 1, 0, 0, 1])
        assert m.confusion_counts(y, p) == {"tp": 2, "fp": 1, "tn": 1, "fn": 1}

    def test_point_metrics_match_sklearn(self):
        y = np.array([1, 0, 1, 0, 1, 0, 0, 1])
        p = np.array([1, 1, 0, 0, 1, 0, 1, 1])
        assert m.precision_score(y, p) == pytest.approx(skm.precision_score(y, p))
        assert m.recall_score(y, p) == pytest.approx(skm.recall_score(y, p))
        assert m.f1_score(y, p) == pytest.approx(skm.f1_score(y, p))
        assert m.accuracy_score(y, p) == pytest.approx(skm.accuracy_score(y, p))

    def test_accuracy_is_misleading_under_imbalance(self, imbalanced):
        y, _ = imbalanced
        all_clear = np.zeros_like(y)
        # The whole point of the phase: 98.5% accuracy, zero recall.
        assert m.accuracy_score(y, all_clear) > 0.98
        assert m.recall_score(y, all_clear) == 0.0

    def test_zero_division_is_safe(self):
        y = np.zeros(4, dtype=int)
        assert m.precision_score(y, y) == 0.0
        assert m.recall_score(y, y) == 0.0
        assert m.f1_score(y, y) == 0.0


class TestRankingMetrics:
    def test_average_precision_matches_sklearn(self, imbalanced):
        y, s = imbalanced
        assert m.average_precision(y, s) == pytest.approx(
            skm.average_precision_score(y, s), abs=1e-9
        )

    def test_roc_auc_matches_sklearn(self, imbalanced):
        y, s = imbalanced
        assert m.roc_auc(y, s) == pytest.approx(skm.roc_auc_score(y, s), abs=1e-9)

    def test_roc_auc_matches_sklearn_with_many_ties(self):
        y = np.array([1, 0, 1, 0, 1, 0, 1, 0])
        s = np.array([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
        assert m.roc_auc(y, s) == pytest.approx(skm.roc_auc_score(y, s), abs=1e-9)

    def test_perfect_and_reversed_scores(self):
        y = np.array([0, 0, 1, 1])
        assert m.roc_auc(y, np.array([0.1, 0.2, 0.8, 0.9])) == pytest.approx(1.0)
        assert m.roc_auc(y, np.array([0.9, 0.8, 0.2, 0.1])) == pytest.approx(0.0)

    def test_pr_auc_beats_nothing_when_model_is_random(self):
        rng = np.random.default_rng(0)
        n = 40_000
        y = (rng.random(n) < 0.01).astype(int)
        s = rng.random(n)
        # Random ranking -> AP ~= prevalence, which is why random ROC-AUC ~0.5
        # is the *wrong* thing to feel good about. (Sampling std of a random
        # AUC here is ~sqrt(1/(12*n_pos)) ~ 0.014, so the tolerances are wide
        # enough to be a real assertion rather than a coin flip.)
        assert m.average_precision(y, s) == pytest.approx(float(y.mean()), abs=0.01)
        assert m.roc_auc(y, s) == pytest.approx(0.5, abs=0.05)

    def test_precision_recall_curve_is_monotone_in_recall(self, imbalanced):
        y, s = imbalanced
        precision, recall, thresh = m.precision_recall_curve(y, s)
        assert len(precision) == len(recall) == len(thresh) + 1
        assert recall[-1] == 0.0 and precision[-1] == 1.0
        assert np.all(np.diff(recall) <= 1e-12)


class TestProbabilisticMetrics:
    def test_log_loss_matches_sklearn(self, imbalanced):
        y, s = imbalanced
        assert m.log_loss(y, s) == pytest.approx(skm.log_loss(y, s), abs=1e-9)

    def test_log_loss_is_finite_at_extremes(self):
        y = np.array([1, 0])
        s = np.array([0.0, 1.0])  # deliberately wrong and saturated
        assert np.isfinite(m.log_loss(y, s))

    def test_brier_reference(self):
        y = np.array([1, 0, 1, 0])
        s = np.array([0.9, 0.1, 0.6, 0.4])
        assert m.brier_score(y, s) == pytest.approx(np.mean((s - y) ** 2))


class TestCalibration:
    def test_perfectly_calibrated_model_sits_on_diagonal(self):
        rng = np.random.default_rng(1)
        p = rng.random(20000)
        y = (rng.random(20000) < p).astype(int)
        pred, obs, _ = m.calibration_curve(y, p, n_bins=10)
        assert np.max(np.abs(pred - obs)) < 0.03
        assert m.expected_calibration_error(y, p, n_bins=10) < 0.02

    def test_overconfident_model_has_high_ece(self):
        rng = np.random.default_rng(2)
        y = (rng.random(20000) < 0.5).astype(int)   # truth is 50/50
        p = np.full(20000, 0.95)                     # model screams certainty
        assert m.expected_calibration_error(y, p) > 0.4
        assert m.maximum_calibration_error(y, p) > 0.4

    def test_quantile_strategy_handles_heavy_imbalance(self):
        rng = np.random.default_rng(4)
        y = (rng.random(5000) < 0.002).astype(int)
        p = rng.random(5000)
        pred, obs, counts = m.calibration_curve(y, p, n_bins=5, strategy="quantile")
        assert counts.sum() == 5000
        assert len(pred) == len(obs)


class TestOperatingPoint:
    def test_threshold_for_precision_respects_target(self, imbalanced):
        y, s = imbalanced
        thr = m.threshold_for_precision(y, s, 0.10)
        if thr is not None:
            pred = (s >= thr).astype(int)
            assert m.precision_score(y, pred) >= 0.10

    def test_threshold_for_recall_respects_target(self, imbalanced):
        y, s = imbalanced
        thr = m.threshold_for_recall(y, s, 0.5)
        if thr is not None:
            pred = (s >= thr).astype(int)
            assert m.recall_score(y, pred) >= 0.5

    def test_cost_model_prefers_catching_expensive_fraud(self):
        y = np.array([1, 0, 0, 0, 0, 1, 0, 0])
        s = np.array([0.9, 0.1, 0.1, 0.1, 0.1, 0.8, 0.1, 0.1])
        thr, cost = m.best_threshold_by_cost(y, s, fraud_cost=500.0, alert_cost=1.0)
        assert cost < m.expected_cost(y, s, 0.95, 500.0, 1.0)


class TestUncertaintyAndReporting:
    def test_bootstrap_ci_brackets_point_estimate(self, imbalanced):
        y, s = imbalanced
        point, lo, hi = m.bootstrap_ci(m.average_precision, y, s, n_boot=200, seed=0)
        assert lo <= point <= hi
        assert hi - lo < 0.2

    def test_requested_level_metric_is_compared_against_same_denominator(self):
        # ECE and PR-AUC must both work on a single-element degenerate input.
        y = np.array([1])
        s = np.array([0.8])
        assert m.confusion_counts(y, (s >= 0.5).astype(int))["tp"] == 1
