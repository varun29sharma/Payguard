"""Tests for payguard_ml.logistic — the from-scratch implementation."""

import numpy as np
import pytest
from sklearn.linear_model import LogisticRegression

from payguard_ml import logistic


@pytest.fixture(scope="module")
def blob():
    """A separable-ish two-class problem with a known-ish boundary."""
    rng = np.random.default_rng(0)
    n = 3000
    X = rng.normal(size=(n, 4))
    true_w = np.array([1.2, -0.8, 0.5, 0.0])
    z = X @ true_w + rng.normal(scale=0.8, size=n)
    y = (z > 0).astype(float)
    return X, y, true_w


class TestSigmoid:
    def test_is_stable_at_extremes(self):
        z = np.array([-1000.0, 1000.0])
        out = logistic.sigmoid(z)
        assert out[0] == 0.0
        assert out[1] == 1.0
        assert np.isfinite(out).all()

    def test_matches_naive_at_zero(self):
        assert logistic.sigmoid(0.0) == pytest.approx(0.5)


class TestGradient:
    def test_gradient_check_passes(self, blob):
        X, y, _ = blob
        rng = np.random.default_rng(1)
        w = rng.normal(size=X.shape[1])
        b = 0.3
        err = logistic.LogisticRegressionScratch.gradient_check(X, y, w, b, l2=0.7)
        assert err < 1e-5

    def test_analytic_gradient_matches_definition(self):
        # Mean form: grad = X^T (p - y) / n + l2 w
        X = np.array([[1.0, 0.0], [0.0, 1.0], [1.0, 1.0], [2.0, -1.0]])
        y = np.array([1.0, 0.0, 1.0, 0.0])
        w = np.array([0.1, -0.2])
        b = 0.05
        n = len(y)
        p = logistic.sigmoid(X @ w + b)
        expected_w = X.T @ (p - y) / n + 0.3 * w
        grad_w, grad_b = logistic.log_loss_gradient(X, y, w, b, l2=0.3)
        assert np.allclose(grad_w, expected_w)
        assert grad_b == pytest.approx(float(np.sum(p - y) / n))

    def test_gradient_is_zero_at_optimum_for_tiny_problem(self):
        # Perfectly separable, no regularisation: gradient shrinks toward zero.
        X = np.array([[3.0], [-3.0]])
        y = np.array([1.0, 0.0])
        w = np.array([10.0])
        grad_w, _ = logistic.log_loss_gradient(X, y, w, 0.0, l2=0.0)
        assert abs(grad_w[0]) < 1e-3


class TestSolvers:
    def test_newton_converges_quickly(self, blob):
        X, y, _ = blob
        model = logistic.LogisticRegressionScratch(method="newton").fit(X, y)
        assert model.history.converged
        assert model.history.iterations <= 12

    def test_gd_converges(self, blob):
        X, y, _ = blob
        model = logistic.LogisticRegressionScratch(method="gd", lr=0.5, max_iter=2000).fit(X, y)
        assert model.history.final < model.history.objective[0]

    def test_both_solvers_agree(self, blob):
        X, y, _ = blob
        newt = logistic.LogisticRegressionScratch(method="newton").fit(X, y)
        gd = logistic.LogisticRegressionScratch(method="gd", lr=0.5, max_iter=5000).fit(X, y)
        p_newt = newt.predict_proba(X)
        p_gd = gd.predict_proba(X)
        assert np.max(np.abs(p_newt - p_gd)) < 1e-3

    def test_rejects_unknown_method(self):
        with pytest.raises(ValueError):
            logistic.LogisticRegressionScratch(method="magic")

    def test_rejects_single_class(self):
        with pytest.raises(ValueError):
            logistic.LogisticRegressionScratch().fit(np.ones((5, 2)), np.ones(5))


class TestComparisonToSklearn:
    def test_coefficients_are_close(self, blob):
        X, y, _ = blob
        ours = logistic.LogisticRegressionScratch(method="newton", l2=0.0).fit(X, y)
        theirs = LogisticRegression(penalty=None, max_iter=5000).fit(X, y)
        # Coefficients live on the original feature scale, so they are directly comparable.
        assert np.allclose(ours.coef_, theirs.coef_[0], atol=5e-2)
        assert ours.intercept_ == pytest.approx(theirs.intercept_[0], abs=5e-2)

    def test_predictions_are_close(self, blob):
        X, y, _ = blob
        ours = logistic.LogisticRegressionScratch(method="newton", l2=0.0).fit(X, y)
        theirs = LogisticRegression(penalty=None, max_iter=5000).fit(X, y)
        assert np.mean(ours.predict(X) == theirs.predict(X)) > 0.99


class TestImbalanceHandling:
    def test_balanced_weights_help_recall(self):
        rng = np.random.default_rng(7)
        n = 4000
        X = rng.normal(size=(n, 3))
        z = X[:, 0] * 2.0
        y = (z + rng.normal(scale=1.0, size=n) > 3.5).astype(float)  # ~6% positives
        assert 0.02 < y.mean() < 0.10

        plain = logistic.LogisticRegressionScratch(l2=1.0).fit(X, y)
        balanced = logistic.LogisticRegressionScratch(l2=1.0, class_weight="balanced").fit(X, y)

        def recall(m):
            pred = m.predict(X)
            return float(np.sum((pred == 1) & (y == 1)) / max(1, np.sum(y == 1)))

        assert recall(balanced) > recall(plain)

    def test_rejects_unknown_class_weight(self):
        X = np.array([[0.0], [1.0]])
        y = np.array([0.0, 1.0])
        with pytest.raises(ValueError):
            logistic.LogisticRegressionScratch(class_weight="magic").fit(X, y)


class TestSerialisation:
    def test_round_trip_preserves_predictions(self, blob):
        X, y, _ = blob
        model = logistic.LogisticRegressionScratch().fit(X, y)
        payload = model.to_dict(["a", "b", "c", "d"])
        restored = logistic.LogisticRegressionScratch.from_dict(payload)
        assert np.allclose(model.predict_proba(X), restored.predict_proba(X))

    def test_exported_shape_matches_the_java_scorer(self, blob):
        X, y, _ = blob
        model = logistic.LogisticRegressionScratch().fit(X, y)
        payload = model.to_dict(["a", "b", "c", "d"])
        assert set(payload) >= {"version", "features", "weights", "intercept"}
        assert len(payload["weights"]) == len(payload["features"]) == 4

    def test_rejects_fit_before_predict(self):
        with pytest.raises(RuntimeError):
            logistic.LogisticRegressionScratch().predict_proba(np.ones((1, 2)))
