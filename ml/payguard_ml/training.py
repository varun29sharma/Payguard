"""training.py — the Phase 1 pipeline: split, fit, calibrate, select, ship.

Everything here is deliberately explicit rather than wrapped in a
``Pipeline`` abstraction, because the *decisions* are the deliverable:

* **Chronological split, never random.** Train on the earliest 60%, validate on
  the next 20%, test on the final 20%. A random ``train_test_split`` on
  transaction data lets the model see the future (it can learn "this user's
  average is high" from transactions that happened after the one being scored).
* **Threshold from an operating point, not 0.5.** 0.5 is a default, not a
  decision. We pick it from a precision target the analyst team can absorb and
  from a cost model — and report both.
* **Calibration on the validation set**, then measure it, because shipping an
  uncalibrated score dressed as a probability is a system lying about itself.
* **Feature selection three ways** (UNIT-III): mutual-information filtering,
  sequential forward selection, recursive feature elimination — and we report
  where they disagree, because the disagreement is the interesting part.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from . import calibration as C
from . import features as F
from . import logistic as L
from . import metrics as M

# Analyst-capacity and cost assumptions. Documented because they are *choices*:
# every one of them moves the operating point.
DEFAULT_FRAUD_COST = 20_000.0   # average fraud loss when missed (currency units)
DEFAULT_ALERT_COST = 150.0      # analyst-minutes + customer friction per alert
DEFAULT_PRECISION_TARGET = 0.35


@dataclass
class Split:
    train: pd.DataFrame
    val: pd.DataFrame
    test: pd.DataFrame
    train_end: Optional[pd.Timestamp] = None
    val_end: Optional[pd.Timestamp] = None

    def describe(self) -> Dict[str, Any]:
        return {
            "train_rows": int(len(self.train)),
            "val_rows": int(len(self.val)),
            "test_rows": int(len(self.test)),
            "train_end": str(self.train_end),
            "val_end": str(self.val_end),
            "train_fraud_rate": float(self.train["is_fraud"].mean()) if len(self.train) else 0.0,
            "val_fraud_rate": float(self.val["is_fraud"].mean()) if len(self.val) else 0.0,
            "test_fraud_rate": float(self.test["is_fraud"].mean()) if len(self.test) else 0.0,
        }


def chronological_split(frame: pd.DataFrame,
                        fractions: Tuple[float, float, float] = (0.6, 0.2, 0.2)) -> Split:
    """Split by time. The only split that is valid for transaction data."""
    if not np.isclose(sum(fractions), 1.0):
        raise ValueError("fractions must sum to 1")
    df = frame.sort_values("timestamp").reset_index(drop=True)
    n = len(df)
    n_train = int(n * fractions[0])
    n_val = int(n * fractions[1])
    train = df.iloc[:n_train]
    val = df.iloc[n_train:n_train + n_val]
    test = df.iloc[n_train + n_val:]
    return Split(
        train=train, val=val, test=test,
        train_end=train["timestamp"].max() if len(train) else None,
        val_end=val["timestamp"].max() if len(val) else None,
    )


def _X(frame: pd.DataFrame) -> np.ndarray:
    return F.features_to_matrix(frame)


def _y(frame: pd.DataFrame) -> np.ndarray:
    return frame["is_fraud"].astype(int).to_numpy()


# --------------------------------------------------------------------------
# Feature selection — UNIT-III, all three methods
# --------------------------------------------------------------------------

def select_univariate(X, y, names: Sequence[str], k: int = 12,
                      seed: int = 0) -> List[str]:
    """Filter method: rank by mutual information, keep the top ``k``.

    Mutual information rather than correlation, because correlation only sees
    linear dependence and several of these features are deliberately non-linear
    (``log1p_implied_speed_kmh``, ``user_distinct_devices_7d``).
    """
    from sklearn.feature_selection import mutual_info_classif

    mi = mutual_info_classif(X, y, random_state=seed)
    order = np.argsort(-mi)
    return [names[i] for i in order[:k]]


def select_sequential_forward(X, y, X_val, y_val, names: Sequence[str],
                              k: int = 12, scorer=None) -> List[str]:
    """Wrapper method: greedily add the feature that most improves val PR-AUC.

    Expensive (O(k * d) fits) but the only method that accounts for feature
    *interactions*, which is exactly what a fraud model is full of.
    """
    from sklearn.linear_model import LogisticRegression

    if scorer is None:
        scorer = M.average_precision
    chosen: List[str] = []
    remaining = list(range(len(names)))
    best_score = -1.0
    while remaining and len(chosen) < k:
        round_best = None
        for j in remaining:
            cols = chosen + [j]
            model = LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0)
            model.fit(X[:, cols], y)
            score = scorer(y_val, model.predict_proba(X_val[:, cols])[:, 1])
            if round_best is None or score > round_best[0]:
                round_best = (score, j)
        if round_best is None or round_best[0] <= best_score:
            break
        best_score, j = round_best
        chosen.append(j)
        remaining.remove(j)
    return [names[j] for j in chosen]


def select_recursive_elimination(X, y, names: Sequence[str], k: int = 12,
                                 seed: int = 0) -> List[str]:
    """Embedded method: fit, drop the least important coefficient, repeat."""
    from sklearn.linear_model import LogisticRegression

    keep = list(range(len(names)))
    while len(keep) > k:
        model = LogisticRegression(max_iter=2000, class_weight="balanced", C=1.0)
        model.fit(X[:, keep], y)
        # Scale-relative magnitude so a large-magnitude feature is not
        # automatically "important".
        importance = np.abs(model.coef_[0]) * X[:, keep].std(axis=0)
        drop = int(np.argmin(importance))
        keep.pop(drop)
    return [names[j] for j in keep]


def compare_feature_selection(X, y, X_val, y_val, names, k: int = 12) -> Dict[str, Any]:
    """Run all three and report agreement — the point is where they disagree."""
    uni = select_univariate(X, y, names, k)
    sfs = select_sequential_forward(X, y, X_val, y_val, names, k)
    rfe = select_recursive_elimination(X, y, names, k)
    sets = {"univariate_mi": set(uni), "sequential_forward": set(sfs), "rfe": set(rfe)}
    common = set.intersection(*sets.values()) if sets else set()
    return {
        "univariate_mi": uni,
        "sequential_forward": sfs,
        "recursive_elimination": rfe,
        "kept_by_all_three": sorted(common),
        "selected_by_none": sorted(set(names) - set.union(*sets.values())) if sets else [],
    }


# --------------------------------------------------------------------------
# Evaluation + operating point
# --------------------------------------------------------------------------

def evaluate(y_true, proba, threshold: float = 0.5, n_bins: int = 10) -> Dict[str, Any]:
    report = M.summary_report(y_true, proba, threshold=threshold, n_bins=n_bins)
    point, lo, hi = M.bootstrap_ci(M.average_precision, y_true, proba, n_boot=300, seed=0)
    report["pr_auc_ci"] = [lo, hi]
    report["pr_auc_point"] = point
    return report


def choose_threshold(y_val, p_val, fraud_cost: float = DEFAULT_FRAUD_COST,
                     alert_cost: float = DEFAULT_ALERT_COST,
                     precision_target: float = DEFAULT_PRECISION_TARGET) -> Dict[str, Any]:
    """Two defensible approaches, both reported.

    * **Cost model** — minimise ``FN * fraud_cost + (TP + FP) * alert_cost``.
      Connects the metric to money, which is what the problem is about.
    * **Capacity** — the lowest threshold whose precision clears a target the
      analyst team can absorb ("we can handle ~N alerts/day at >=P precision").
    """
    cost_threshold, cost = M.best_threshold_by_cost(y_val, p_val, fraud_cost, alert_cost)
    precision_threshold = M.threshold_for_precision(y_val, p_val, precision_target)
    chosen = precision_threshold if precision_threshold is not None else cost_threshold
    return {
        "cost_model": {
            "threshold": cost_threshold,
            "expected_cost": cost,
            "fraud_cost": fraud_cost,
            "alert_cost": alert_cost,
        },
        "precision_target": {
            "threshold": precision_threshold,
            "target": precision_target,
        },
        "chosen": chosen,
        "chosen_basis": "precision_target" if precision_threshold is not None else "cost_model",
    }


# --------------------------------------------------------------------------
# The pipeline
# --------------------------------------------------------------------------

@dataclass
class TrainedModel:
    model: Any
    calibrator: Any
    threshold: float
    feature_names: List[str]
    split: Split
    val_metrics: Dict[str, Any]
    test_metrics: Dict[str, Any]
    uncalibrated_test_metrics: Dict[str, Any]
    threshold_choice: Dict[str, Any]
    feature_selection: Dict[str, Any]
    learned_vs_guessed: List[Dict[str, Any]]
    learning_curve: List[Dict[str, Any]]
    artifacts: Dict[str, Any] = field(default_factory=dict)

    def predict_proba(self, frame: pd.DataFrame) -> np.ndarray:
        return self.calibrator.predict(self.model.predict_proba(_X(frame)))

    def to_dict(self) -> Dict[str, Any]:
        return {
            "split": self.split.describe(),
            "threshold": self.threshold,
            "threshold_choice": self.threshold_choice,
            "val_metrics": self.val_metrics,
            "test_metrics": self.test_metrics,
            "uncalibrated_test_metrics": self.uncalibrated_test_metrics,
            "feature_selection": self.feature_selection,
            "learned_vs_guessed": self.learned_vs_guessed,
            "learning_curve": self.learning_curve,
            "artifacts": self.artifacts,
        }


def learned_vs_guessed(model: L.LogisticRegressionScratch,
                       names: Sequence[str]) -> List[Dict[str, Any]]:
    """The Phase 1 verification table: what we guessed vs what the data says.

    For each rule flag, compare the **learned** coefficient against the
    hardcoded severity the rule engine assigns. A positive coefficient means the
    signal genuinely predicts confirmed fraud; a coefficient near zero means the
    rule is nearly worthless; a large one means the hand-picked score
    understated it. This table is publishable on its own.
    """
    from .baseline import DEFAULT_SEVERITIES

    coef = dict(zip(names, model.coef_))
    rows = []
    for feature, engine_name in F.RULE_FEATURE_TO_ENGINE_NAME.items():
        rows.append({
            "rule": engine_name,
            "feature": feature,
            "guessed_severity": DEFAULT_SEVERITIES.get(engine_name),
            "learned_coefficient": float(coef.get(feature, 0.0)),
            "verdict": _verdict(coef.get(feature, 0.0)),
        })
    rows.sort(key=lambda r: -abs(r["learned_coefficient"]))
    return rows


def _verdict(coef: float) -> str:
    if coef <= 0.01:
        return "near-worthless (no positive evidence)"
    if coef < 0.5:
        return "weak"
    if coef < 1.5:
        return "useful"
    return "strong"


def learning_curve(model_factory, frame: pd.DataFrame, val: pd.DataFrame,
                   fractions: Sequence[float] = (0.1, 0.25, 0.5, 0.75, 1.0),
                   seed: int = 0) -> List[Dict[str, Any]]:
    """Train on growing *prefixes* of the training period, evaluate on a fixed
    validation period. Time-ordered, so it is a real learning curve and not a
    cross-validated illusion.

    The diagnostic: if train and validation scores converge, more data will not
    help (variance-limited would show a persistent gap); if they are far apart,
    the model is overfitting and regularisation or more data will help.
    """
    df = frame.sort_values("timestamp").reset_index(drop=True)
    points = []
    for frac in fractions:
        n = max(50, int(len(df) * frac))
        subset = df.iloc[:n]
        X, y = _X(subset), _y(subset)
        if len(np.unique(y)) < 2:
            continue
        model = model_factory()
        model.fit(X, y)
        train_score = M.average_precision(y, model.predict_proba(X))
        val_score = M.average_precision(_y(val), model.predict_proba(_X(val)))
        points.append({
            "train_rows": n,
            "train_pr_auc": float(train_score),
            "val_pr_auc": float(val_score),
            "gap": float(train_score - val_score),
        })
    return points


def train_logistic(feature_frame: pd.DataFrame, *,
                   fractions: Tuple[float, float, float] = (0.6, 0.2, 0.2),
                   l2: float = 1.0,
                   calibration_method: str = "platt",
                   run_feature_selection: bool = True,
                   selection_k: int = 12,
                   fraud_cost: float = DEFAULT_FRAUD_COST,
                   alert_cost: float = DEFAULT_ALERT_COST,
                   precision_target: float = DEFAULT_PRECISION_TARGET,
                   learning_curve_fractions: Sequence[float] = (0.1, 0.25, 0.5, 0.75, 1.0),
                   seed: int = 0) -> TrainedModel:
    """Fit, calibrate, select, and evaluate — the whole Phase 1 pipeline."""
    split = chronological_split(feature_frame, fractions)
    names = list(F.FEATURE_NAMES)
    Xtr, ytr = _X(split.train), _y(split.train)
    Xva, yva = _X(split.val), _y(split.val)
    Xte, yte = _X(split.test), _y(split.test)

    started = time.time()
    model = L.LogisticRegressionScratch(method="newton", l2=l2, class_weight="balanced")
    model.fit(Xtr, ytr)
    fit_seconds = time.time() - started

    # Calibrate on the VALIDATION set (never the test set).
    p_va = model.predict_proba(Xva)
    calibrator = C.fit_calibrator(calibration_method, p_va, yva)

    threshold_choice = choose_threshold(yva, calibrator.predict(p_va),
                                        fraud_cost=fraud_cost, alert_cost=alert_cost,
                                        precision_target=precision_target)
    threshold = float(threshold_choice["chosen"])

    val_metrics = evaluate(yva, calibrator.predict(p_va), threshold)
    p_te_uncal = model.predict_proba(Xte)
    uncal_test = evaluate(yte, p_te_uncal, threshold)
    test_metrics = evaluate(yte, calibrator.predict(p_te_uncal), threshold)

    selection: Dict[str, Any] = {}
    if run_feature_selection:
        selection = compare_feature_selection(Xtr, ytr, Xva, yva, names, k=selection_k)

    curve = learning_curve(
        lambda: L.LogisticRegressionScratch(method="newton", l2=l2, class_weight="balanced")
        if len(split.train) >= 50 else L.LogisticRegressionScratch(l2=l2, class_weight="balanced"),
        split.train, split.val, fractions=learning_curve_fractions, seed=seed,
    )

    return TrainedModel(
        model=model, calibrator=calibrator, threshold=threshold, feature_names=names,
        split=split, val_metrics=val_metrics, test_metrics=test_metrics,
        uncalibrated_test_metrics=uncal_test, threshold_choice=threshold_choice,
        feature_selection=selection, learned_vs_guessed=learned_vs_guessed(model, names),
        learning_curve=curve,
        artifacts={"fit_seconds": fit_seconds, "calibration_method": calibration_method},
    )


def export_model(trained: TrainedModel, path: str,
                 metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Write ``model-v1.json`` in the shape ``LogisticModelScorer.java`` reads.

    Includes the *calibration* parameters too, because the shipped artefact must
    produce the calibrated probability, not the raw one. Platt is two numbers
    (a slope and an intercept on the log-odds), so it inlines cleanly.
    """
    meta = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "calibration": trained.artifacts.get("calibration_method", "none"),
        "threshold": trained.threshold,
        "test_pr_auc": trained.test_metrics.get("pr_auc"),
        "test_pr_auc_ci": trained.test_metrics.get("pr_auc_ci"),
        "test_roc_auc": trained.test_metrics.get("roc_auc"),
        "notes": ("Shadow mode. Records mlScore/mlContributions; the rule engine "
                  "still decides. Weights are on the original feature scale, so "
                  "scoring is sigmoid(w.x + b)."),
    }
    if metadata:
        meta.update(metadata)

    payload = trained.model.to_dict(trained.feature_names, meta)
    payload["calibration"] = _calibration_payload(trained.calibrator)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
    return payload


def _calibration_payload(calibrator) -> Dict[str, Any]:
    """Serialise the calibrator.

    Platt: slope/intercept in log-odds space, so Java can apply it in ~4 lines.
    Isotonic: the breakpoints, which Java can binary-search. Anything else:
    identity, stated explicitly.
    """
    if isinstance(calibrator, C.PlattScaling) and calibrator.model is not None:
        m = calibrator.model
        return {"method": "platt",
                "slope": float(m.coef_[0]),
                "intercept": float(m.intercept_)}
    if isinstance(calibrator, C.IsotonicCalibration) and calibrator._x is not None:
        return {"method": "isotonic",
                "x": [float(v) for v in calibrator._x],
                "y": [float(v) for v in calibrator._y]}
    return {"method": "none"}


def render_report(trained: TrainedModel) -> str:
    """Markdown summary for EXPERIMENTS.md / the README."""
    t = trained.test_metrics
    lines = ["### Logistic regression vs the rules", ""]
    s = trained.split.describe()
    lines.append("_Chronological split: train %d rows (fraud %.3f%%) · val %d (%.3f%%) · "
                 "test %d (%.3f%%)_" % (
                     s["train_rows"], 100 * s["train_fraud_rate"],
                     s["val_rows"], 100 * s["val_fraud_rate"],
                     s["test_rows"], 100 * s["test_fraud_rate"]))
    lines.append("")
    lines.append("| metric | uncalibrated | calibrated |")
    lines.append("|---|---|---|")
    for key in ("pr_auc", "roc_auc", "precision", "recall", "f1", "log_loss", "brier", "ece"):
        lines.append("| %s | %.4f | %.4f |" % (
            key, trained.uncalibrated_test_metrics[key], t[key]))
    lines.append("")
    lines.append("PR-AUC 95%% CI (bootstrap): [%.4f, %.4f]" % tuple(t["pr_auc_ci"]))
    lines.append("")
    lines.append("Operating threshold **%.4f** chosen by *%s* "
                 "(cost model: %.0f, precision target: %s)" % (
                     trained.threshold, trained.threshold_choice["chosen_basis"],
                     trained.threshold_choice["cost_model"]["expected_cost"],
                     trained.threshold_choice["precision_target"]["threshold"]))
    lines.append("")
    lines.append("**What we guessed vs what the data says** (learned coefficient on "
                 "each rule flag):")
    lines.append("")
    lines.append("| rule | hardcoded severity | learned coefficient | verdict |")
    lines.append("|---|---:|---:|---|")
    for row in trained.learned_vs_guessed:
        lines.append("| `%s` | %s | %+.3f | %s |" % (
            row["rule"], row["guessed_severity"], row["learned_coefficient"], row["verdict"]))
    lines.append("")
    if trained.feature_selection:
        fs = trained.feature_selection
        lines.append("**Feature selection (UNIT-III)** — kept by all three methods: "
                     "`%s`" % "`, `".join(fs["kept_by_all_three"]))
        lines.append("")
        for method in ("univariate_mi", "sequential_forward", "recursive_elimination"):
            lines.append("- `%s`: %s" % (method, ", ".join(fs[method])))
        lines.append("")
    if trained.learning_curve:
        lines.append("**Learning curve** (train vs val PR-AUC against training size):")
        lines.append("")
        lines.append("| train rows | train PR-AUC | val PR-AUC | gap |")
        lines.append("|---:|---:|---:|---:|")
        for point in trained.learning_curve:
            lines.append("| %d | %.4f | %.4f | %.4f |" % (
                point["train_rows"], point["train_pr_auc"], point["val_pr_auc"], point["gap"]))
        lines.append("")
    return "\n".join(lines)
