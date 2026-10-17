"""logistic.py — logistic regression from scratch (batch GD **and** Newton/IRLS).

The roadmap is explicit that this is written before sklearn is used, and the
reason is not nostalgia. Writing it by hand is where you discover that

    grad = sum_i (y_i - h(x_i)) x_i

is *identical in form* to the least-squares gradient despite a completely
different model — the fact the GLM framing explains, and the fact that answers
"why does gradient descent look the same for regression and classification?".

Two solvers, deliberately:

* **Batch gradient descent** — the general-purpose option, and the one whose
  learning curves you actually watch.
* **Newton's method / IRLS** — quadratic convergence, typically ~5 iterations
  where GD needs thousands, at O(d^3) per step for the Hessian solve.

Objective (**mean form**, so ``l2`` is scale-free and directly comparable to
sklearn's ``C = 1/l2``):

    J(w, b) = (1/n) * sum_i [ -y_i log h_i - (1-y_i) log(1-h_i) ]
              + (l2 / 2) * ||w||^2

    grad_w  = X^T (h - y) / n  + l2 * w
    grad_b  = sum_i (h_i - y_i) / n
    Hessian = X^T diag(h (1 - h)) X / n + l2 * I

Getting this scale right is not cosmetic. A *sum*-form objective with ``l2=1``
makes the penalty negligible (the data term grows with n), so on the
near-separable data fraud models love, the MLE sits at infinity, Newton
overshoots, and the coefficients diverge to ``inf`` — which is exactly how a
model that looked fine on a learning curve silently turns into a coin flip.
The mean form + damped Newton step makes that impossible.

``gradient_check`` is provided because a hand-derived backward pass without a
finite-difference check is a guess.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

EPS = 1e-12


def sigmoid(z):
    """Numerically stable logistic function.

    The branch avoids ``exp`` overflow for large negative ``z``: the naive
    ``1/(1+exp(-z))`` overflows to inf and then silently returns 0, which kills
    the gradient.
    """
    z = np.asarray(z, dtype=float)
    out = np.empty_like(z)
    pos = z >= 0
    out[pos] = 1.0 / (1.0 + np.exp(-z[pos]))
    ez = np.exp(z[~pos])
    out[~pos] = ez / (1.0 + ez)
    return out


def log_loss_gradient(X, y, w, b, l2: float = 0.0, weights=None):
    """Mean-form gradient ``(grad_w, grad_b)`` of the objective above."""
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float)
    n = len(y)
    sw = np.ones(n) if weights is None else np.asarray(weights, dtype=float)
    p = sigmoid(X @ w + b)
    residual = sw * (p - y)
    grad_w = X.T @ residual / n + l2 * w
    grad_b = float(np.sum(residual) / n)
    return grad_w, grad_b


def objective(X, y, w, b, l2: float = 0.0, weights=None) -> float:
    """Mean regularised negative log-likelihood (what both solvers minimise)."""
    X = np.asarray(X, dtype=float)
    y = np.asarray(y, dtype=float)
    n = len(y)
    sw = np.ones(n) if weights is None else np.asarray(weights, dtype=float)
    z = X @ w + b
    # log(1 + exp(z)) computed stably: max(z,0) + log1p(exp(-|z|))
    ll = y * z - (np.maximum(z, 0.0) + np.log1p(np.exp(-np.abs(z))))
    return float(-np.sum(sw * ll) / n + 0.5 * l2 * float(w @ w))


def numerical_gradient(X, y, w, b, l2: float = 0.0, eps: float = 1e-6, weights=None):
    """Finite-difference gradient — the reference the analytic one is checked against."""
    X = np.asarray(X, dtype=float)
    w = np.asarray(w, dtype=float)
    grad_w = np.zeros_like(w)
    for j in range(len(w)):
        w_plus = w.copy(); w_plus[j] += eps
        w_minus = w.copy(); w_minus[j] -= eps
        grad_w[j] = (objective(X, y, w_plus, b, l2, weights)
                     - objective(X, y, w_minus, b, l2, weights)) / (2 * eps)
    grad_b = (objective(X, y, w, b + eps, l2, weights)
              - objective(X, y, w, b - eps, l2, weights)) / (2 * eps)
    return grad_w, grad_b


@dataclass
class FitHistory:
    iterations: int = 0
    converged: bool = False
    objective: List[float] = field(default_factory=list)

    @property
    def final(self) -> Optional[float]:
        return self.objective[-1] if self.objective else None


class LogisticRegressionScratch:
    """L2-regularised logistic regression with GD and Newton solvers.

    Deliberately small and readable — this is the artefact that proves the
    gradient was derived, not called. Everything downstream uses sklearn.
    """

    def __init__(self, method: str = "newton", l2: float = 1.0,
                 lr: float = 1.0, max_iter: int = 100, tol: float = 1e-8,
                 standardize: bool = True, class_weight: Optional[str] = None,
                 fit_intercept: bool = True, verbose: bool = False):
        if method not in ("gd", "newton"):
            raise ValueError("method must be 'gd' or 'newton'")
        self.method = method
        self.l2 = float(l2)
        self.lr = float(lr)
        self.max_iter = int(max_iter)
        self.tol = float(tol)
        self.standardize = bool(standardize)
        self.class_weight = class_weight
        self.fit_intercept = bool(fit_intercept)
        self.verbose = verbose

        self.coef_: Optional[np.ndarray] = None
        self.intercept_: float = 0.0
        self.mean_: Optional[np.ndarray] = None
        self.scale_: Optional[np.ndarray] = None
        self.history = FitHistory()

    # -- preprocessing ---------------------------------------------------
    def _standardize_fit(self, X: np.ndarray) -> None:
        if self.standardize:
            self.mean_ = X.mean(axis=0)
            scale = X.std(axis=0)
            scale[scale < 1e-12] = 1.0
            self.scale_ = scale
        else:
            self.mean_ = np.zeros(X.shape[1])
            self.scale_ = np.ones(X.shape[1])

    def _transform(self, X: np.ndarray) -> np.ndarray:
        if self.mean_ is None or self.scale_ is None:
            raise RuntimeError("call fit() first")
        return (X - self.mean_) / self.scale_

    def _sample_weights(self, y: np.ndarray) -> np.ndarray:
        """``class_weight='balanced'`` — the honest alternative to SMOTE.

        Weights positives by n/(2*n_pos) and negatives by n/(2*n_neg), so the
        two classes contribute equally to the loss without inventing synthetic
        minority points. The weights sum to n, so the mean-form objective keeps
        its scale.
        """
        n = len(y)
        n_pos = float(np.sum(y == 1))
        n_neg = float(np.sum(y == 0))
        if self.class_weight in (None, "none"):
            return np.ones(n)
        if self.class_weight != "balanced":
            raise ValueError("class_weight must be None or 'balanced'")
        if n_pos == 0 or n_neg == 0:
            return np.ones(n)
        return np.where(y == 1, n / (2.0 * n_pos), n / (2.0 * n_neg))

    # -- fitting ---------------------------------------------------------
    def fit(self, X, y) -> "LogisticRegressionScratch":
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float).ravel()
        if X.ndim != 2:
            raise ValueError("X must be 2-D")
        if len(X) != len(y):
            raise ValueError("X and y must have the same length")
        if len(np.unique(y)) < 2:
            raise ValueError("y must contain both classes to fit logistic regression")

        self._standardize_fit(X)
        Xs = self._transform(X)
        sw = self._sample_weights(y)
        self.history = FitHistory()

        if self.method == "newton":
            self._fit_newton(Xs, y, sw)
        else:
            self._fit_gd(Xs, y, sw)
        return self

    def _grad(self, Xs, y, sw, w, b):
        return log_loss_gradient(Xs, y, w, b, self.l2, weights=sw)

    def _obj(self, Xs, y, sw, w, b) -> float:
        return objective(Xs, y, w, b, self.l2, weights=sw)

    def _fit_gd(self, Xs, y, sw) -> None:
        w = np.zeros(Xs.shape[1])
        b = 0.0
        prev = None
        for it in range(1, self.max_iter + 1):
            grad_w, grad_b = self._grad(Xs, y, sw, w, b)
            w = w - self.lr * grad_w
            if self.fit_intercept:
                b = b - self.lr * grad_b
            if not (np.isfinite(w).all() and math.isfinite(b)):
                raise FloatingPointError("gradient descent diverged — lower the learning rate")
            obj = self._obj(Xs, y, sw, w, b)
            self.history.objective.append(obj)
            self.history.iterations = it
            if self.verbose and (it % 100 == 0 or it == 1):
                print("  gd iter %4d  objective %.8f" % (it, obj))
            if prev is not None and abs(prev - obj) <= self.tol * max(1.0, abs(prev)):
                self.history.converged = True
                break
            prev = obj
        self._store(w, b)

    def _fit_newton(self, Xs, y, sw) -> None:
        """IRLS with a damped step. Converges in a handful of iterations;
        each step is O(d^3) because of the Hessian solve."""
        n, d = Xs.shape
        w = np.zeros(d)
        b = 0.0
        current = self._obj(Xs, y, sw, w, b)

        for it in range(1, self.max_iter + 1):
            p = sigmoid(Xs @ w + b)
            s = sw * p * (1.0 - p)
            grad_w, grad_b = self._grad(Xs, y, sw, w, b)
            if not np.isfinite(grad_w).all():
                break
            H = (Xs * s[:, None]).T @ Xs / n + self.l2 * np.eye(d)
            # A tiny ridge keeps the solve well-posed even if l2 = 0 and the
            # design is rank-deficient — much better than a NaN coefficient.
            H = H + 1e-9 * np.eye(d)
            try:
                step_w = np.linalg.solve(H, grad_w)
            except np.linalg.LinAlgError:
                step_w = np.linalg.lstsq(H, grad_w, rcond=None)[0]
            step_b = grad_b / (float(np.sum(s)) / n + 1e-12) if self.fit_intercept else 0.0

            # Damped (backtracking) step: never accept a step that increases the
            # objective. Without this, near-separable data sends Newton straight
            # to infinity.
            accepted = False
            scale = 1.0
            for _ in range(30):
                w_try = w - scale * step_w
                b_try = b - scale * step_b
                cand = self._obj(Xs, y, sw, w_try, b_try)
                if np.isfinite(cand) and cand <= current + 1e-12:
                    w, b, current = w_try, b_try, cand
                    accepted = True
                    break
                scale *= 0.5
            if not accepted:
                break

            self.history.objective.append(current)
            self.history.iterations = it
            if self.verbose:
                print("  newton iter %2d  objective %.8f  scale %.3g" % (it, current, scale))
            if np.max(np.abs(scale * step_w)) < self.tol:
                self.history.converged = True
                break
        self._store(w, b)

    def _store(self, w: np.ndarray, b: float) -> None:
        # Express coefficients on the ORIGINAL feature scale so the exported
        # model is usable without the training-time standardisation constants.
        if self.standardize:
            self.coef_ = w / self.scale_
            self.intercept_ = float(b - float(np.sum(w * self.mean_ / self.scale_)))
        else:
            self.coef_ = w.copy()
            self.intercept_ = float(b)

    # -- inference -------------------------------------------------------
    def decision_function(self, X) -> np.ndarray:
        if self.coef_ is None:
            raise RuntimeError("call fit() before scoring")
        X = np.asarray(X, dtype=float)
        if X.ndim == 1:
            X = X.reshape(1, -1)
        return X @ self.coef_ + self.intercept_

    def predict_proba(self, X) -> np.ndarray:
        return sigmoid(self.decision_function(X))

    def predict(self, X, threshold: float = 0.5) -> np.ndarray:
        return (self.predict_proba(X) >= threshold).astype(int)

    # -- diagnostics -----------------------------------------------------
    @staticmethod
    def gradient_check(X, y, w, b, l2: float = 0.0, eps: float = 1e-6,
                       tol: float = 1e-5, weights=None) -> float:
        """Max relative difference between analytic and finite-difference gradients."""
        ga_w, ga_b = log_loss_gradient(X, y, w, b, l2, weights)
        gn_w, gn_b = numerical_gradient(X, y, w, b, l2, eps, weights)
        denom = np.maximum(1.0, np.abs(ga_w) + np.abs(gn_w))
        rel_w = float(np.max(np.abs(ga_w - gn_w) / denom)) if len(ga_w) else 0.0
        rel_b = abs(ga_b - gn_b) / max(1.0, abs(ga_b) + abs(gn_b))
        worst = max(rel_w, rel_b)
        if worst > tol:
            raise AssertionError("gradient check failed: max relative error %.3e" % worst)
        return worst

    def to_dict(self, feature_names: Sequence[str], metadata: Optional[Dict[str, Any]] = None
                ) -> Dict[str, Any]:
        """Serialise to the exact shape ``LogisticModelScorer.java`` consumes.

        Coefficients are on the original feature scale, so the Java side needs
        no standardisation constants — ``sigmoid(w.x + b)`` is the whole scorer.
        """
        if self.coef_ is None:
            raise RuntimeError("call fit() first")
        payload = {
            "version": "1",
            "features": list(feature_names),
            "weights": [float(v) for v in self.coef_],
            "intercept": float(self.intercept_),
            "l2": self.l2,
            "solver": self.method,
            "iterations": self.history.iterations,
            "converged": self.history.converged,
        }
        if metadata:
            payload["metadata"] = metadata
        return payload

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "LogisticRegressionScratch":
        model = cls(standardize=False)
        model.coef_ = np.asarray(payload["weights"], dtype=float)
        model.intercept_ = float(payload["intercept"])
        model.mean_ = np.zeros(len(model.coef_))
        model.scale_ = np.ones(len(model.coef_))
        return model


def load_model(path: str) -> LogisticRegressionScratch:
    with open(path, "r", encoding="utf-8") as fh:
        return LogisticRegressionScratch.from_dict(json.load(fh))


def save_model(model: LogisticRegressionScratch, path: str, feature_names: Sequence[str],
               metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    payload = model.to_dict(feature_names, metadata)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    return payload
