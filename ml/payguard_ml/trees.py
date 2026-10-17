"""trees.py — ID3 from scratch.

Your syllabus names **ID3** explicitly (UNIT-III) and Tom Mitchell chapter 3 is
its canonical treatment, so it gets implemented rather than imported. Two
reasons beyond the exam:

* Splitting on maximum **information gain** by hand is how gradient boosting
  stops being magic. Boosting is a sequence of such splits fitted to gradients;
  once you have built one tree's split logic you know what the ensemble is doing.
* It makes the bias-variance story concrete. An unpruned ID3 tree grows until
  every leaf is pure — zero training error, terrible test error. Watching that
  happen is a better lesson than reading about overfitting.

Faithful to ID3 where it matters, widened where the data demands:

* **Categorical** features split multi-way (ID3 proper): one branch per value.
* **Continuous** features split at a threshold (C4.5's practical extension),
  chosen by maximising information gain over candidate thresholds. Fraud
  features are almost all continuous, so pure categorical ID3 would be useless
  here — and knowing *why* the extension exists is itself exam material.

Splitting criterion — information gain::

    H(S)  = -sum_c p_c log2 p_c
    H(S|A) = sum_v (|S_v| / |S|) H(S_v)
    IG(S, A) = H(S) - H(S|A)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

EPS = 1e-12


def entropy(y: Sequence[float]) -> float:
    """Shannon entropy in bits. 0 for a pure node, 1.0 for a 50/50 binary node."""
    y = np.asarray(y, dtype=float).ravel()
    if len(y) == 0:
        return 0.0
    _, counts = np.unique(y, return_counts=True)
    p = counts / len(y)
    return float(-np.sum(p * np.log2(np.maximum(p, EPS))))


def information_gain(y: Sequence[float], partition: Sequence[Sequence[int]]) -> float:
    """``H(parent) - weighted mean H(children)`` for a given partition of indices."""
    y = np.asarray(y, dtype=float).ravel()
    n = len(y)
    if n == 0:
        return 0.0
    parent = entropy(y)
    children = 0.0
    for idx in partition:
        idx = np.asarray(idx, dtype=int)
        if len(idx) == 0:
            continue
        children += (len(idx) / n) * entropy(y[idx])
    return float(parent - children)


def best_threshold(x: Sequence[float], y: Sequence[float]) -> Tuple[Optional[float], float]:
    """Best binary split point for a continuous feature, by information gain.

    Only midpoints between adjacent *distinct* sorted values are candidates —
    O(n log n) instead of O(n^2), and provably sufficient: gain is constant
    between consecutive observed values.
    """
    x = np.asarray(x, dtype=float).ravel()
    y = np.asarray(y, dtype=float).ravel()
    order = np.argsort(x, kind="mergesort")
    xs, ys = x[order], y[order]
    if len(np.unique(xs)) < 2:
        return None, 0.0

    split_points = np.where(np.diff(xs) != 0)[0]
    best_gain, best_t = 0.0, None
    parent_indices = np.arange(len(y))
    for i in split_points:
        left = parent_indices[: i + 1]
        right = parent_indices[i + 1:]
        gain = information_gain(y[order], [left, right])
        if gain > best_gain + 1e-12:
            best_gain, best_t = gain, float((xs[i] + xs[i + 1]) / 2.0)
    return best_t, best_gain


def best_threshold_from_candidates(x, y, candidates) -> Tuple[Optional[float], float]:
    """Information gain for each supplied candidate threshold; best wins.

    Used when a node is large enough that scanning every adjacent pair is
    wasteful: gain varies slowly with the cut point, so quantile-spaced
    candidates lose almost nothing and cost O(k * n) instead of O(n log n) with
    a huge constant.
    """
    x = np.asarray(x, dtype=float).ravel()
    y = np.asarray(y, dtype=float).ravel()
    indices = np.arange(len(y))
    best_gain, best_t = 0.0, None
    for t in np.unique(candidates):
        mask = x <= t
        if not np.any(mask) or np.all(mask):
            continue
        gain = information_gain(y, [indices[mask], indices[~mask]])
        if gain > best_gain + 1e-12:
            best_gain, best_t = gain, float(t)
    return best_t, best_gain


def best_categorical(x: Sequence[Any], y: Sequence[float]) -> Tuple[Optional[List[Any]], float]:
    """Best multi-way split for a categorical feature, by information gain."""
    x = np.asarray(x, dtype=object).ravel()
    y = np.asarray(y, dtype=float).ravel()
    values = {}
    for i, v in enumerate(x):
        values.setdefault(v, []).append(i)
    if len(values) < 2:
        return None, 0.0
    categories = sorted(values, key=lambda k: str(k))
    partition = [values[c] for c in categories]
    return categories, information_gain(y, partition)


@dataclass
class Split:
    feature_index: int
    feature_name: str
    kind: str                      # "threshold" | "categorical"
    threshold: Optional[float] = None
    categories: Optional[List[Any]] = None
    gain: float = 0.0


@dataclass
class Node:
    """A tree node — either a decision or a leaf."""

    prediction: float = 0.0
    probability: float = 0.0
    n_samples: int = 0
    split: Optional[Split] = None
    children: Dict[Any, "Node"] = field(default_factory=dict)
    depth: int = 0

    @property
    def is_leaf(self) -> bool:
        return self.split is None


class DecisionTreeID3:
    """ID3 with threshold splits for continuous features, depth/data limits, pruning by gain.

    The limits are the point of the exercise: an ID3 tree with no limits fully
    memorises the training set. ``max_depth``, ``min_samples_split`` and
    ``min_gain`` are the three knobs that trade training purity for
    generalisation, and the learning curve in ``compare.py`` shows the effect.
    """

    def __init__(self, max_depth: int = 6, min_samples_split: int = 20,
                 min_gain: float = 1e-4, max_threshold_candidates: int = 64,
                 task: str = "classification"):
        if task not in ("classification",):
            raise ValueError("only classification is supported here")
        self.max_depth = max_depth
        self.min_samples_split = min_samples_split
        self.min_gain = min_gain
        self.max_threshold_candidates = max_threshold_candidates
        self.root: Optional[Node] = None
        self.feature_names: List[str] = []
        self.n_features: int = 0

    # -- fitting ---------------------------------------------------------
    def fit(self, X, y, feature_names: Optional[Sequence[str]] = None,
            categorical: Optional[Sequence[bool]] = None) -> "DecisionTreeID3":
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=float).ravel()
        if X.ndim != 2:
            raise ValueError("X must be 2-D")
        self.n_features = X.shape[1]
        self.feature_names = list(feature_names) if feature_names else [
            "f%d" % i for i in range(self.n_features)
        ]
        self.categorical = list(categorical) if categorical else [False] * self.n_features
        self.root = self._build(X, y, depth=0)
        return self

    def _build(self, X: np.ndarray, y: np.ndarray, depth: int) -> Node:
        node = Node(prediction=float(np.mean(y)), probability=float(np.mean(y)),
                    n_samples=len(y), depth=depth)

        # Base cases: pure enough, too deep, or too small to split.
        if depth >= self.max_depth or len(y) < self.min_samples_split:
            return node
        if len(np.unique(y)) < 2:      # already pure
            return node

        split = self._best_split(X, y)
        if split is None or split.gain < self.min_gain:
            return node
        node.split = split

        if split.kind == "threshold":
            mask = X[:, split.feature_index] <= split.threshold
            subsets = {True: mask, False: ~mask}
        else:
            column = X[:, split.feature_index]
            subsets = {cat: column == cat for cat in split.categories}

        for key, mask in subsets.items():
            if not np.any(mask):
                # An empty branch: keep the parent's prediction rather than
                # inventing one. (ID3 proper would re-derive the attribute set.)
                node.children[key] = Node(prediction=node.prediction,
                                          probability=node.probability, n_samples=0,
                                          depth=depth + 1)
                continue
            node.children[key] = self._build(X[mask], y[mask], depth + 1)
        return node

    def _best_split(self, X: np.ndarray, y: np.ndarray) -> Optional[Split]:
        best: Optional[Split] = None
        for j in range(self.n_features):
            column = X[:, j]
            if self.categorical[j] and len(np.unique(column)) <= self.max_threshold_candidates:
                categories, gain = best_categorical(column, y)
                if categories is not None and (best is None or gain > best.gain):
                    best = Split(j, self.feature_names[j], "categorical",
                                 categories=categories, gain=gain)
            else:
                if len(column) > self.max_threshold_candidates * 4:
                    # Large node: quantile-spaced candidate cut points. Gain
                    # varies slowly with the cut point, so this loses almost
                    # nothing and keeps a from-scratch tree usable as a baseline.
                    quantiles = np.quantile(
                        column, np.linspace(0, 1, self.max_threshold_candidates + 2)[1:-1]
                    )
                    threshold, gain = best_threshold_from_candidates(column, y, quantiles)
                else:
                    threshold, gain = best_threshold(column, y)
                if threshold is not None and (best is None or gain > best.gain):
                    best = Split(j, self.feature_names[j], "threshold", threshold=threshold, gain=gain)
        return best

    # -- inference -------------------------------------------------------
    def _leaf_for(self, node: Node, row: np.ndarray) -> Node:
        while not node.is_leaf:
            split = node.split
            value = row[split.feature_index]
            if split.kind == "threshold":
                key = bool(value <= split.threshold)
            else:
                key = value
                if key not in node.children:
                    # Unseen category at predict time — fall back to the node's own
                    # prediction, which is the standard, honest behaviour.
                    return node
            node = node.children[key]
        return node

    def predict_proba(self, X) -> np.ndarray:
        X = np.asarray(X, dtype=float)
        if self.root is None:
            raise RuntimeError("call fit() first")
        return np.array([self._leaf_for(self.root, row).probability for row in X])

    def predict(self, X, threshold: float = 0.5) -> np.ndarray:
        return (self.predict_proba(X) >= threshold).astype(int)

    # -- explanation -----------------------------------------------------
    def export_text(self, max_lines: int = 200) -> str:
        if self.root is None:
            return "(unfitted)"
        lines: List[str] = []

        def walk(node: Node, prefix: str) -> None:
            if len(lines) >= max_lines:
                return
            split = node.split
            if node.is_leaf:
                lines.append("%s-> p(fraud)=%.3f (n=%d)" % (prefix, node.probability, node.n_samples))
                return
            if split.kind == "threshold":
                lines.append("%s[%s <= %.5g] gain=%.4f" % (prefix, split.feature_name, split.threshold, split.gain))
                walk(node.children[True], prefix + "  ")
                lines.append("%s[%s >  %.5g]" % (prefix, split.feature_name, split.threshold))
                walk(node.children[False], prefix + "  ")
            else:
                lines.append("%s[%s in %s] gain=%.4f" % (prefix, split.feature_name, split.categories, split.gain))
                for cat, child in node.children.items():
                    lines.append("%s  (%s)" % (prefix, cat))
                    walk(child, prefix + "    ")

        walk(self.root, "")
        if len(lines) >= max_lines:
            lines.append("... (truncated)")
        return "\n".join(lines)

    def feature_importances(self) -> Dict[str, float]:
        """Gain-weighted importance, normalised — summed over internal nodes.

        Deliberately simple: this is what a from-scratch tree can offer honestly.
        The production explainability story is SHAP (``compare.py``); this exists
        so the from-scratch implementation is self-contained.
        """
        totals = {name: 0.0 for name in self.feature_names}
        total_gain = 0.0

        def walk(node: Node) -> None:
            if node.is_leaf:
                return
            weight = node.n_samples * node.split.gain
            totals[node.split.feature_name] += weight
            total_gain += weight
            for child in node.children.values():
                walk(child)

        walk(self.root)
        if total_gain <= 0:
            return totals
        return {k: v / total_gain for k, v in totals.items()}
