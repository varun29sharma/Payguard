"""Tests for payguard_ml.calibration."""

import numpy as np
import pytest

from payguard_ml import calibration, metrics


class TestPAVA:
    def test_produces_a_monotone_sequence(self):
        y = np.array([0.1, 0.4, 0.2, 0.3, 0.9, 0.5])
        out = calibration.pava(y)
        assert np.all(np.diff(out) >= -1e-12)

    def test_pools_only_adjacent_violators(self):
        # [0.1, 0.4, 0.2]: 0.4 > 0.2 violates, so pool those two to 0.3.
        # 0.1 does not violate against 0.3, so it stays put.
        out = calibration.pava(np.array([0.1, 0.4, 0.2]))
        assert out[0] == pytest.approx(0.1)
        assert out[1] == out[2] == pytest.approx(0.3)

    def test_pools_a_fully_decreasing_sequence(self):
        out = calibration.pava(np.array([0.5, 0.4, 0.3]))
        assert np.allclose(out, 0.4)

    def test_already_monotone_is_unchanged(self):
        y = np.array([0.1, 0.2, 0.3, 0.9])
        assert np.allclose(calibration.pava(y), y)

    def test_handles_empty(self):
        assert len(calibration.pava(np.array([]))) == 0


@pytest.fixture(scope="module")
def miscalibrated():
    """Scores that rank well but are wildly overconfident, as GBM output often is."""
    rng = np.random.default_rng(3)
    n = 20_000
    latent = rng.normal(size=n)
    y = (rng.random(n) < 1 / (1 + np.exp(-latent))).astype(float)
    # Squash the score toward the extremes: ranking intact, probabilities wrong.
    scores = 1 / (1 + np.exp(-3.0 * latent))
    return scores, y


class TestPlatt:
    def test_reduces_calibration_error(self, miscalibrated):
        scores, y = miscalibrated
        before = metrics.expected_calibration_error(y, scores)
        cal = calibration.PlattScaling().fit(scores, y)
        after = metrics.expected_calibration_error(y, cal.predict(scores))
        assert after < before

    def test_is_monotone_so_ranking_is_unchanged(self, miscalibrated):
        scores, y = miscalibrated
        cal = calibration.PlattScaling().fit(scores, y)
        out = cal.predict(scores)
        order = np.argsort(scores)
        assert np.all(np.diff(out[order]) >= -1e-12)

    def test_output_is_in_unit_interval(self, miscalibrated):
        scores, y = miscalibrated
        out = calibration.PlattScaling().fit(scores, y).predict(scores)
        assert out.min() >= 0.0 and out.max() <= 1.0


class TestIsotonic:
    def test_reduces_calibration_error(self, miscalibrated):
        scores, y = miscalibrated
        before = metrics.expected_calibration_error(y, scores)
        cal = calibration.IsotonicCalibration().fit(scores, y)
        after = metrics.expected_calibration_error(y, cal.predict(scores))
        assert after < before

    def test_is_monotone(self, miscalibrated):
        scores, y = miscalibrated
        cal = calibration.IsotonicCalibration().fit(scores, y)
        out = cal.predict(scores)
        order = np.argsort(scores)
        assert np.all(np.diff(out[order]) >= -1e-12)

    def test_handles_many_tied_scores(self):
        scores = np.array([0.1, 0.1, 0.1, 0.5, 0.5, 0.9, 0.9])
        y = np.array([0, 0, 1, 0, 1, 1, 1])
        cal = calibration.IsotonicCalibration().fit(scores, y)
        out = cal.predict(scores)
        assert len(out) == len(scores)
        assert np.all((out >= 0) & (out <= 1))

    def test_single_distinct_score_is_safe(self):
        scores = np.array([0.5, 0.5, 0.5])
        y = np.array([1, 0, 1])
        out = calibration.IsotonicCalibration().fit(scores, y).predict(np.array([0.2, 0.5, 0.9]))
        assert len(out) == 3


class TestDispatcher:
    def test_platt_isotonic_none(self, miscalibrated):
        scores, y = miscalibrated
        for method in ("platt", "isotonic", "none"):
            cal = calibration.fit_calibrator(method, scores, y)
            out = cal.predict(scores)
            assert len(out) == len(scores)

    def test_rejects_unknown_method(self):
        with pytest.raises(ValueError):
            calibration.fit_calibrator("magic", np.array([0.1, 0.9]), np.array([0, 1]))

    def test_raises_on_single_class(self):
        with pytest.raises(ValueError):
            calibration.PlattScaling().fit(np.array([0.1, 0.2]), np.array([1, 1]))

    def test_accepts_raw_logits_as_well_as_probabilities(self):
        rng = np.random.default_rng(0)
        y = (rng.random(500) < 0.5).astype(float)
        logits = rng.normal(size=500) * 3
        cal = calibration.PlattScaling().fit(logits, y)
        out = cal.predict(logits)
        assert out.min() >= 0 and out.max() <= 1
