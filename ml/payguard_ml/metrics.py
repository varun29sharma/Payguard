"""metrics.py — evaluation primitives, implemented from scratch on numpy.

Why not just call scikit-learn? Two reasons, and both are worth defending:

1. **The roadmap names these as syllabus content** (UNIT-II: confusion matrix,
   accuracy, precision, recall, F1, log-loss, PR/ROC). Deriving them once, by
   hand, is the difference between "I called ``roc_auc_score``" and "I know why
   ROC-AUC flatters an imbalanced model".
2. **The headline number has to be defensible.** The one metric that decides
   whether the model ships is PR-AUC / average precision, and it is easy to
   compute several subtly different things that all call themselves "AUC".
   Having the exact definition in the repo (and tested against sklearn in
   ``tests/test_metrics.py``) means the number in the README is trustworthy.

Everything here takes 1-D numpy arrays: ``y_true`` in {0, 1}, ``y_score`` any
monotone risk score (probability, log-odds, raw margin). Ties are handled
correctly — a dataset can easily contain thousands of identical scores.
"""

from __future__ import annotations

from typing import Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

EPS = 1e-12


def _as_arrays(y_true, y_score=None):
    y = np.asarray(y_true, dtype=float).ravel()
    if y_score is None:
        return y
    s = np.asarray(y_score, dtype=float).ravel()
    if y.shape != s.shape:
        raise ValueError("y_true and y_score must have the same length")
    return y, s


def _check_binary(y: np.ndarray) -> None:
    if y.size and not np.isin(y, (0.0, 1.0)).all():
        raise ValueError("y_true must contain only 0/1 labels")


# --------------------------------------------------------------------------
# Confusion matrix and the point metrics
# --------------------------------------------------------------------------

def confusion_counts(y_true, y_pred) -> Dict[str, int]:
    """Return tp / fp / tn / fn. The 2x2 table everything else is built from.

    Convention: the **positive class is fraud**. So a false positive is a
    legitimate transaction the system flagged, which costs analyst time and
    customer friction; a false negative is fraud it let through, which costs
    money. Both are real costs — which is why we never report a single number
    without the confusion matrix next to it.
    """
    y, p = _as_arrays(y_true, y_pred)
    _check_binary(y)
    p = (p > 0.5).astype(float) if p.dtype.kind == "f" and not np.isin(p, (0.0, 1.0)).all() else p
    _check_binary(p)
    tp = int(np.sum((y == 1) & (p == 1)))
    fp = int(np.sum((y == 0) & (p == 1)))
    tn = int(np.sum((y == 0) & (p == 0)))
    fn = int(np.sum((y == 1) & (p == 0)))
    return {"tp": tp, "fp": fp, "tn": tn, "fn": fn}


def precision_score(y_true, y_pred) -> float:
    c = confusion_counts(y_true, y_pred)
    denom = c["tp"] + c["fp"]
    return c["tp"] / denom if denom else 0.0


def recall_score(y_true, y_pred) -> float:
    c = confusion_counts(y_true, y_pred)
    denom = c["tp"] + c["fn"]
    return c["tp"] / denom if denom else 0.0


def f1_score(y_true, y_pred) -> float:
    p = precision_score(y_true, y_pred)
    r = recall_score(y_true, y_pred)
    return (2 * p * r / (p + r)) if (p + r) else 0.0


def accuracy_score(y_true, y_pred) -> float:
    """Included only so the report can *show* that it is a lie here: at 0.2%
    positives, predicting "clear" for everything scores 99.8%."""
    c = confusion_counts(y_true, y_pred)
    total = sum(c.values())
    return (c["tp"] + c["tn"]) / total if total else 0.0


def balanced_accuracy(y_true, y_pred) -> float:
    c = confusion_counts(y_true, y_pred)
    tpr = c["tp"] / (c["tp"] + c["fn"]) if (c["tp"] + c["fn"]) else 0.0
    tnr = c["tn"] / (c["tn"] + c["fp"]) if (c["tn"] + c["fp"]) else 0.0
    return 0.5 * (tpr + tnr)


def log_loss(y_true, y_score) -> float:
    """Mean negative log-likelihood of the true label under ``y_score``.

    Clipped away from 0/1: a single confidently-wrong probability would
    otherwise send the loss to infinity, which is mathematically correct and
    operationally useless as a summary statistic.
    """
    y, s = _as_arrays(y_true, y_score)
    s = np.clip(s, EPS, 1.0 - EPS)
    return float(-np.mean(y * np.log(s) + (1 - y) * np.log(1 - s)))


def brier_score(y_true, y_score) -> float:
    """Mean squared error of the probabilities. Unlike log-loss it is bounded,
    so it is a gentler calibration summary."""
    y, s = _as_arrays(y_true, y_score)
    return float(np.mean((s - y) ** 2))


# --------------------------------------------------------------------------
# Ranking metrics — the ones that actually decide the ship
# --------------------------------------------------------------------------

def _binary_clf_curve(y_true, y_score):
    """Cumulative tp/fp at every distinct score — the shared core of the PR and
    ROC curves, matching ``sklearn.metrics._ranking._binary_clf_curve`` so the
    curves (and every metric derived from them) agree with sklearn exactly.

    Returns ``(tp, fp, thresholds)``, one entry per distinct score, with the
    threshold array *ascending* after the final reversal.
    """
    y, s = _as_arrays(y_true, y_score)
    _check_binary(y)
    order = np.argsort(-s, kind="mergesort")
    y_sorted = y[order]
    s_sorted = s[order]
    tp = np.cumsum(y_sorted)
    fp = np.cumsum(1.0 - y_sorted)
    # One point per tie-group: the last index of each group of equal scores.
    distinct = np.r_[np.diff(s_sorted) != 0, True]
    return tp[distinct], fp[distinct], s_sorted[distinct]


def precision_recall_curve(y_true, y_score) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Precision/recall at every distinct threshold.

    Ordering and sentinels follow ``sklearn.metrics.precision_recall_curve``
    exactly: thresholds are **ascending**, recall runs from 1 down to 0, and one
    sentinel point (precision 1, recall 0) is appended. That ordering is what
    makes the step-wise average precision below equal sklearn's.
    """
    tp, fp, thresholds = _binary_clf_curve(y_true, y_score)
    with np.errstate(divide="ignore", invalid="ignore"):
        precision = np.where(tp + fp > 0, tp / (tp + fp), 1.0)
    total_pos = tp[-1] if tp.size else 0.0
    recall = (tp / total_pos) if total_pos > 0 else np.zeros_like(tp)

    if tp.size == 0:
        return np.array([1.0]), np.array([0.0]), np.array([])

    # Stop when full recall is attained, then reverse: recall descends 1 -> 0.
    last_ind = int(np.searchsorted(tp, tp[-1]))
    sl = slice(last_ind, None, -1)
    precision = precision[sl]
    recall = recall[sl]
    thresholds = thresholds[sl]
    return np.hstack((precision, 1.0)), np.hstack((recall, 0.0)), thresholds


def average_precision(y_true, y_score) -> float:
    """PR-AUC — the roadmap's headline metric.

    Computed as the step-wise area under the PR curve:
    ``AP = sum_k (R_k - R_{k-1}) * P_k``. This is the exact definition used by
    ``sklearn.metrics.average_precision_score`` (and asserts equal to it in the
    tests), not an approximation by trapezoid — trapezoid over PR curves
    silently *rewards* a model for the (unreachable) region near recall 0.
    """
    y, s = _as_arrays(y_true, y_score)
    if np.sum(y) == 0:
        return 0.0
    precision, recall, _ = precision_recall_curve(y, s)
    return float(-np.sum(np.diff(recall) * precision[:-1]))


def roc_curve(y_true, y_score) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(fpr, tpr, thresholds), thresholds ascending — sklearn's ordering, so a
    plotted ROC curve runs the right way."""
    tp, fp, thresholds = _binary_clf_curve(y_true, y_score)
    pos = tp[-1] if tp.size else 0.0
    neg = fp[-1] if fp.size else 0.0
    tpr = (tp / pos) if pos > 0 else np.zeros_like(tp)
    fpr = (fp / neg) if neg > 0 else np.zeros_like(fp)
    return fpr[::-1], tpr[::-1], thresholds[::-1]


def roc_auc(y_true, y_score) -> float:
    """ROC-AUC via the Mann–Whitney U statistic with average ranks for ties.

    Equivalent to the trapezoid area under the ROC curve, but computed by
    ranking rather than trapezoid integration so ties are exact.
    """
    y, s = _as_arrays(y_true, y_score)
    _check_binary(y)
    n_pos = float(np.sum(y == 1))
    n_neg = float(np.sum(y == 0))
    if n_pos == 0 or n_neg == 0:
        return 0.5
    order = np.argsort(s, kind="mergesort")
    ranks = np.empty(len(s), dtype=float)
    sorted_s = s[order]
    i = 0
    while i < len(s):
        j = i
        while j + 1 < len(s) and sorted_s[j + 1] == sorted_s[i]:
            j += 1
        avg_rank = 0.5 * (i + j) + 1.0  # ranks are 1-based
        ranks[order[i:j + 1]] = avg_rank
        i = j + 1
    rank_sum_pos = float(np.sum(ranks[y == 1]))
    return (rank_sum_pos - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)


# --------------------------------------------------------------------------
# Operating-point selection
# --------------------------------------------------------------------------

def threshold_for_precision(y_true, y_score, target_precision: float) -> Optional[float]:
    """Lowest threshold (most recall) whose precision is >= target.

    This is how a *real* cut-off gets chosen: not 0.5, and not argmax-F1, but
    "the analyst team can absorb N alerts/day at >=P precision".
    """
    y, s = _as_arrays(y_true, y_score)
    precision, recall, thresholds = precision_recall_curve(y, s)
    if thresholds.size == 0:
        return None
    # Thresholds ascend, so precision rises with the index. The lowest
    # threshold that still clears the target is therefore the FIRST feasible
    # index — which is also the highest-recall feasible point.
    feasible = np.where(precision[:-1] >= target_precision)[0]
    if feasible.size == 0:
        return None
    return float(thresholds[feasible[0]])


def threshold_for_recall(y_true, y_score, target_recall: float) -> Optional[float]:
    """Highest threshold (fewest false alarms) whose recall is >= target."""
    y, s = _as_arrays(y_true, y_score)
    _, recall, thresholds = precision_recall_curve(y, s)
    if thresholds.size == 0:
        return None
    # Recall descends with the index, so the condition holds on a prefix; the
    # highest threshold that still clears the target is the LAST feasible index
    # — i.e. the fewest alerts consistent with the recall we must hit.
    feasible = np.where(recall[:-1] >= target_recall)[0]
    if feasible.size == 0:
        return None
    return float(thresholds[feasible[-1]])


def expected_cost(y_true, y_score, threshold: float,
                  fraud_cost: float, alert_cost: float) -> float:
    """Expected loss in currency units at a threshold.

    ``fraud_cost``      — average loss when a fraud is missed (false negative)
    ``alert_cost``      — cost of investigating one alert (false or true positive)

    The roadmap asks for a cost model rather than a metric; the reason is that
    this connects the decision to money, which is what the problem is about.
    Note the asymmetry: a fraud we miss costs the full transaction amount, an
    alert costs analyst-minutes plus customer friction.
    """
    y, s = _as_arrays(y_true, y_score)
    pred = (s >= threshold).astype(float)
    c = confusion_counts(y, pred)
    return c["fn"] * fraud_cost + (c["tp"] + c["fp"]) * alert_cost


def best_threshold_by_cost(y_true, y_score, fraud_cost: float, alert_cost: float
                           ) -> Tuple[float, float]:
    """Threshold minimising ``expected_cost``, searched over the observed scores."""
    y, s = _as_arrays(y_true, y_score)
    candidates = np.unique(np.r_[s, np.nextafter(s.max(), np.inf)] if s.size else [0.5])
    best_t, best_c = 0.5, float("inf")
    for t in candidates:
        c = expected_cost(y, s, float(t), fraud_cost, alert_cost)
        if c < best_c:
            best_t, best_c = float(t), c
    return best_t, best_c


# --------------------------------------------------------------------------
# Calibration
# --------------------------------------------------------------------------

def calibration_curve(y_true, y_score, n_bins: int = 10,
                      strategy: str = "uniform") -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Data for a reliability diagram.

    Bins the predicted probabilities and reports, per bin, the mean predicted
    probability and the observed fraud rate. A perfectly calibrated model sits
    exactly on the diagonal: "of everything I scored 0.8, 80% should be fraud".

    ``strategy="quantile"`` puts an equal number of transactions in each bin,
    which matters at 0.2% positives where most uniform bins would be empty of
    fraud and the diagram would look reassuring for the wrong reason.
    """
    y, s = _as_arrays(y_true, y_score)
    if not 0 < n_bins <= 100:
        raise ValueError("n_bins must be in (0, 100]")
    edges = np.linspace(0.0, 1.0, n_bins + 1)
    if strategy == "quantile" and s.size:
        edges = np.unique(np.quantile(s, np.linspace(0.0, 1.0, n_bins + 1)))
    idx = np.clip(np.digitize(s, edges[1:-1], right=False), 0, len(edges) - 2)

    mean_pred, frac_pos, counts = [], [], []
    for b in range(len(edges) - 1):
        mask = idx == b
        if not np.any(mask):
            continue
        mean_pred.append(float(np.mean(s[mask])))
        frac_pos.append(float(np.mean(y[mask])))
        counts.append(int(np.sum(mask)))
    return np.array(mean_pred), np.array(frac_pos), np.array(counts)


def expected_calibration_error(y_true, y_score, n_bins: int = 10) -> float:
    """Weighted mean |observed - predicted| across bins. One number for
    "how much does this model's confidence lie?"."""
    y, s = _as_arrays(y_true, y_score)
    if y.size == 0:
        return 0.0
    mean_pred, frac_pos, counts = calibration_curve(y, s, n_bins=n_bins)
    if counts.size == 0:
        return 0.0
    weights = counts / counts.sum()
    return float(np.sum(weights * np.abs(frac_pos - mean_pred)))


def maximum_calibration_error(y_true, y_score, n_bins: int = 10) -> float:
    y, s = _as_arrays(y_true, y_score)
    mean_pred, frac_pos, counts = calibration_curve(y, s, n_bins=n_bins)
    if counts.size == 0:
        return 0.0
    return float(np.max(np.abs(frac_pos - mean_pred)))


# --------------------------------------------------------------------------
# Uncertainty + per-rule reporting
# --------------------------------------------------------------------------

def bootstrap_ci(metric, y_true, y_score, n_boot: int = 1000,
                 alpha: float = 0.05, seed: int = 0) -> Tuple[float, float, float]:
    """Bootstrap confidence interval for a point estimate.

    A single PR-AUC from one test split is a point estimate with real
    uncertainty; reporting it bare is overclaiming. Resampling is the cheapest
    honest alternative. Returns ``(point, lo, hi)``.
    """
    y, s = _as_arrays(y_true, y_score)
    rng = np.random.default_rng(seed)
    n = len(y)
    point = float(metric(y, s))
    if n == 0:
        return point, point, point
    samples = np.empty(n_boot, dtype=float)
    for b in range(n_boot):
        idx = rng.integers(0, n, size=n)
        samples[b] = metric(y[idx], s[idx])
    lo = float(np.quantile(samples, alpha / 2))
    hi = float(np.quantile(samples, 1 - alpha / 2))
    return point, lo, hi


def per_rule_detection(frame, rule_columns: Sequence[str],
                       label_column: str = "is_fraud") -> List[Dict[str, object]]:
    """Per-rule **precision and recall** — the table the existing detection
    endpoint cannot produce.

    ``getDetectionRates()`` gives catch counts over confirmed fraud, which is
    recall. It never divides by how often a rule fired, so it cannot tell you
    when a rule cried wolf. Precision is the other half of "is this rule worth
    keeping", and it is exactly what the learned weights in Phase 1 will put a
    number on.

    ``frame`` is a pandas DataFrame with boolean 0/1 columns per rule and the
    ground-truth label.
    """
    import pandas as pd

    labels = frame[label_column].astype(bool).to_numpy()
    total_pos = int(labels.sum())
    out = []
    for rule in rule_columns:
        if rule not in frame.columns:
            continue
        fired = frame[rule].astype(bool).to_numpy()
        tp = int(np.sum(fired & labels))
        fp = int(np.sum(fired & ~labels))
        out.append({
            "rule": rule,
            "fired": int(fired.sum()),
            "caught": tp,
            "false_alarms": fp,
            "recall": (tp / total_pos) if total_pos else 0.0,
            "precision": (tp / (tp + fp)) if (tp + fp) else 0.0,
        })
    out.sort(key=lambda r: (-r["recall"], -r["precision"]))
    return out


def summary_report(y_true, y_score, threshold: float = 0.5,
                   n_bins: int = 10) -> Dict[str, object]:
    """One dict with everything the baseline/model reports need."""
    y, s = _as_arrays(y_true, y_score)
    pred = (s >= threshold).astype(float)
    c = confusion_counts(y, pred)
    return {
        "n": int(len(y)),
        "positives": int(y.sum()),
        "prevalence": float(y.mean()) if len(y) else 0.0,
        "threshold": float(threshold),
        "confusion": c,
        "precision": precision_score(y, pred),
        "recall": recall_score(y, pred),
        "f1": f1_score(y, pred),
        "accuracy": accuracy_score(y, pred),
        "balanced_accuracy": balanced_accuracy(y, pred),
        "pr_auc": average_precision(y, s),
        "roc_auc": roc_auc(y, s),
        "log_loss": log_loss(y, s),
        "brier": brier_score(y, s),
        "ece": expected_calibration_error(y, s, n_bins=n_bins),
    }


def format_report(report: Dict[str, object]) -> str:
    """Human-readable block for the notebook / EXPERIMENTS.md."""
    lines = [
        "n=%s  positives=%s (%.3f%%)" % (
            report["n"], report["positives"], 100.0 * float(report["prevalence"])
        ),
        "confusion      %s" % (report["confusion"],),
        "precision      %.3f" % report["precision"],
        "recall         %.3f" % report["recall"],
        "f1             %.3f" % report["f1"],
        "PR-AUC         %.4f   <- headline metric" % report["pr_auc"],
        "ROC-AUC        %.4f" % report["roc_auc"],
        "log-loss       %.4f" % report["log_loss"],
        "Brier          %.4f" % report["brier"],
        "ECE            %.4f" % report["ece"],
        "accuracy       %.4f   <- meaningless at %.3f%% positives" % (
            report["accuracy"], 100.0 * float(report["prevalence"])
        ),
    ]
    return "\n".join(lines)
