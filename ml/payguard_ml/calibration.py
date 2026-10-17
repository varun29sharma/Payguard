"""calibration.py — make the probability mean what it says.

An uncalibrated score of 0.8 is a ranking, not a probability. A *calibrated*
0.8 means: of all transactions scored 0.8, about 80% turn out fraudulent.

This matters more than it sounds, and it is deeply on-brand for PayGuard. The
product's whole identity is that it tells the truth about its own state — it
blinks ``ENGINE: FALLBACK`` when the engine is down. A score that *looks* like a
probability but isn't one is the ML version of lying about your state, and it is
the failure mode that is most dangerous precisely because nobody notices.

Two standard post-hoc methods, both needing only a **held-out** set:

* **Platt scaling** — fit a 1-D logistic regression on the model's log-odds.
  Params: 2. Safe with little data. Can only *stretch and shift*, never
  reorder, so it cannot change the ranking (and therefore cannot change
  PR-AUC).
* **Isotonic regression** — a monotone step function fitted by PAVA. Far more
  flexible (can fix arbitrary miscalibration) and far more prone to overfitting
  with few positives, which is exactly the regime fraud lives in.

Gradient-boosted trees arrive badly calibrated by default (probabilities pushed
to the extremes); logistic regression is usually close. Comparing their
reliability diagrams before and after is one of the clearest illustrations of
the difference between optimising a *ranking* and estimating a *probability*.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import numpy as np

from .logistic import LogisticRegressionScratch

EPS = 1e-6


def _logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(p, dtype=float), EPS, 1 - EPS)
    return np.log(p / (1 - p))


def pava(y: np.ndarray, w: Optional[np.ndarray] = None) -> np.ndarray:
    """Pool-Adjacent-Violators: the least-squares non-decreasing fit.

    Returns values in input order. ``w`` defaults to unit weights.
    """
    y = np.asarray(y, dtype=float)
    if w is None:
        w = np.ones_like(y)
    else:
        w = np.asarray(w, dtype=float)
    if len(y) == 0:
        return y

    blocks = []  # each: [sum(y*w), sum(w)]
    for value, weight in zip(y, w):
        blocks.append([value * weight, weight])
        while len(blocks) > 1 and (blocks[-2][0] / blocks[-2][1]) > (blocks[-1][0] / blocks[-1][1]):
            s2, w2 = blocks.pop()
            s1, w1 = blocks.pop()
            blocks.append([s1 + s2, w1 + w2])

    out = np.empty_like(y)
    idx = 0
    for s, weight in blocks:
        # Blocks carry total weight; with unit weights this is the block size.
        size = int(round(weight))
        # Guard against float weights: fall back to distributing proportionally.
        if size <= 0:
            size = 1
        end = min(idx + size, len(out))
        out[idx:end] = s / weight
        idx = end
    if idx < len(out):
        # Rounding left a remainder; extend the last block's value.
        out[idx:] = out[idx - 1] if idx > 0 else 0.0
    return out


@dataclass
class PlattScaling:
    """Logistic recalibration of a score. Monotone, so the ranking is unchanged."""

    l2: float = 0.0
    model: Optional[LogisticRegressionScratch] = None

    def fit(self, scores, y) -> "PlattScaling":
        s = _logit(scores) if _looks_like_probabilities(scores) else np.asarray(scores, dtype=float).ravel()
        y = np.asarray(y, dtype=float).ravel()
        if len(np.unique(y)) < 2:
            raise ValueError("calibration needs both classes")
        model = LogisticRegressionScratch(method="newton", l2=self.l2, standardize=False)
        model.fit(s.reshape(-1, 1), y)
        self.model = model
        return self

    def predict(self, scores) -> np.ndarray:
        if self.model is None:
            raise RuntimeError("fit the calibrator first")
        s = _logit(scores) if _looks_like_probabilities(scores) else np.asarray(scores, dtype=float).ravel()
        return self.model.predict_proba(s.reshape(-1, 1))


@dataclass
class IsotonicCalibration:
    """PAVA-based monotone recalibration. Flexible; needs data to be safe."""

    _x: Optional[np.ndarray] = None
    _y: Optional[np.ndarray] = None
    out_of_bounds: str = "clip"

    def fit(self, scores, y) -> "IsotonicCalibration":
        s = np.asarray(scores, dtype=float).ravel()
        y = np.asarray(y, dtype=float).ravel()
        order = np.argsort(s, kind="mergesort")
        fitted = pava(y[order])
        # Collapse to one value per distinct score for stable interpolation.
        s_sorted = s[order]
        distinct = np.r_[np.diff(s_sorted) != 0, True]
        # Average the fitted block value across ties.
        xs, ys = [], []
        start = 0
        for i in range(len(s_sorted)):
            if distinct[i]:
                xs.append(s_sorted[start])
                ys.append(float(np.mean(fitted[start:i + 1])))
                start = i + 1
        self._x = np.array(xs, dtype=float)
        self._y = np.clip(np.array(ys, dtype=float), 0.0, 1.0)
        return self

    def predict(self, scores) -> np.ndarray:
        if self._x is None:
            raise RuntimeError("fit the calibrator first")
        s = np.asarray(scores, dtype=float).ravel()
        if len(self._x) == 1:
            return np.full_like(s, float(self._y[0]))
        return np.interp(s, self._x, self._y)


def _looks_like_probabilities(scores) -> bool:
    s = np.asarray(scores, dtype=float)
    if s.size == 0:
        return True
    lo, hi = float(np.min(s)), float(np.max(s))
    return lo >= -1e-9 and hi <= 1 + 1e-9


def fit_calibrator(method: str, scores, y):
    """``method`` in {'platt', 'isotonic', 'none'}."""
    if method == "none":
        return _IdentityCalibrator()
    if method == "platt":
        return PlattScaling().fit(scores, y)
    if method == "isotonic":
        return IsotonicCalibration().fit(scores, y)
    raise ValueError("unknown calibration method %r" % (method,))


@dataclass
class _IdentityCalibrator:
    out_of_bounds: str = "clip"

    def predict(self, scores) -> np.ndarray:
        return np.asarray(scores, dtype=float).ravel()


def reliability_table(scores, y, n_bins: int = 10, strategy: str = "quantile"):
    """Convenience wrapper returning predicted-vs-observed plus counts."""
    from .metrics import calibration_curve

    return calibration_curve(np.asarray(y), np.asarray(scores), n_bins=n_bins, strategy=strategy)
