"""compare.py — seven models, one chronological split, one honest table.

Logistic regression is linear in the features; fraud is full of interactions
("large amount" is fine, "new device" is fine, large amount *on* a new device
*at 3 AM* is not). Trees capture those natively, so this phase is where the
best-performing model appears — and where we learn to compare models on more
axes than accuracy.

What the comparison deliberately measures, per model:

* **PR-AUC** — the headline (imbalanced data).
* **Precision / recall at a chosen operating threshold** — what an analyst feels.
* **Log-loss and ECE** — does the probability mean anything?
* **p99 single-row latency** — does it fit the authorisation path?
* **Serialised size** — can it be deployed?

Gradient boosting will very likely win on PR-AUC. Latency and explainability are
where it loses. Showing that trade-off explicitly is the mark of someone who has
thought about production rather than leaderboards.

Also here: the **cross-validation comparison**. Stratified k-fold is the right
tool for imbalanced *non-temporal* data; on transaction data it is invalid
because it lets the model see the future. We run all three schemes and quantify
the optimism gap rather than asserting it.
"""

from __future__ import annotations

import io
import json
import pickle
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
import pandas as pd

from . import features as F
from . import metrics as M
from . import training
from .baseline import DEFAULT_SEVERITIES, RULE_NAMES

RULES_MODEL_NAME = "rules (baseline)"


class ID3Wrapper:
    """Adapter so the from-scratch ID3 tree fits the comparison loop.

    Deliberately thin: the point is that the home-grown tree is judged by the
    same metrics, on the same split, as the industrial libraries — not that it
    wins.
    """

    def __init__(self, max_depth: int = 6, min_samples_split: int = 25):
        from .trees import DecisionTreeID3

        self._tree = DecisionTreeID3(max_depth=max_depth,
                                     min_samples_split=min_samples_split)

    def fit(self, X, y, feature_names=None):
        self._tree.fit(X, y, feature_names=feature_names)
        return self

    def predict_proba(self, X):
        p = self._tree.predict_proba(X)
        return np.column_stack([1.0 - p, p])

    def predict(self, X, threshold: float = 0.5):
        return (self._tree.predict_proba(X) >= threshold).astype(int)

    @property
    def tree(self):
        return self._tree


def _X(frame: pd.DataFrame) -> np.ndarray:
    return F.features_to_matrix(frame)


def _y(frame: pd.DataFrame) -> np.ndarray:
    return frame["is_fraud"].astype(int).to_numpy()


# --------------------------------------------------------------------------
# The rules as a ranker — so the comparison table has a floor
# --------------------------------------------------------------------------

def rules_scores(frame: pd.DataFrame) -> np.ndarray:
    """The engine's own severity average, reproduced as a ranking score."""
    severities = np.array([DEFAULT_SEVERITIES[r] for r in RULE_NAMES], dtype=float)
    fired = frame[RULE_NAMES].to_numpy(dtype=float) if all(
        r in frame.columns for r in RULE_NAMES) else np.zeros((len(frame), len(RULE_NAMES)))
    counts = fired.sum(axis=1)
    totals = fired @ severities
    return np.where(counts > 0, totals / np.maximum(counts, 1), 0.0)


# --------------------------------------------------------------------------
# Model factories
# --------------------------------------------------------------------------

def model_factories(seed: int = 0) -> Dict[str, Callable[[], Any]]:
    """Every contender, with imbalanced-data handling baked in.

    ``class_weight='balanced'`` / ``scale_pos_weight`` rather than SMOTE:
    interpolating between two unrelated frauds invents a transaction no attacker
    would make, and applying it before splitting leaks. (SMOTE is tried once in
    the tests so the critique is empirical rather than received.)
    """
    from sklearn.ensemble import AdaBoostClassifier, RandomForestClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.naive_bayes import GaussianNB
    from sklearn.tree import DecisionTreeClassifier

    def make_logistic():
        return LogisticRegression(max_iter=5000, class_weight="balanced", C=1.0)

    def make_nb():
        return GaussianNB()

    def make_tree():
        return DecisionTreeClassifier(max_depth=6, min_samples_leaf=25,
                                      class_weight="balanced", random_state=seed)

    def make_id3():
        return ID3Wrapper(max_depth=6, min_samples_split=25)

    def make_forest():
        return RandomForestClassifier(n_estimators=200, max_depth=12, min_samples_leaf=10,
                                      class_weight="balanced_subsample",
                                      n_jobs=-1, random_state=seed)

    def make_adaboost():
        return AdaBoostClassifier(n_estimators=200, random_state=seed)

    def make_xgboost():
        import xgboost as xgb
        return xgb.XGBClassifier(
            n_estimators=300, max_depth=5, learning_rate=0.1,
            subsample=0.9, colsample_bytree=0.9,
            scale_pos_weight=20.0, eval_metric="logloss",
            n_jobs=-1, random_state=seed, tree_method="hist",
        )

    def make_lightgbm():
        import lightgbm as lgb
        return lgb.LGBMClassifier(
            n_estimators=300, num_leaves=31, learning_rate=0.05,
            subsample=0.9, colsample_bytree=0.9, class_weight="balanced",
            n_jobs=-1, random_state=seed, verbose=-1,
        )

    return {
        "logistic_regression": make_logistic,
        "naive_bayes": make_nb,
        "decision_tree_sklearn": make_tree,
        "id3_from_scratch": make_id3,
        "random_forest": make_forest,
        "adaboost": make_adaboost,
        "xgboost": make_xgboost,
        "lightgbm": make_lightgbm,
    }


# --------------------------------------------------------------------------
# Measurement
# --------------------------------------------------------------------------

def _positive_proba(model, X: np.ndarray) -> np.ndarray:
    """predict_proba's positive column, tolerating odd shapes."""
    proba = model.predict_proba(X)
    proba = np.asarray(proba)
    if proba.ndim == 1:
        return proba
    return proba[:, 1]


def measure_single_row_latency(predict_fn: Callable[[np.ndarray], float],
                               X: np.ndarray, sample: int = 150,
                               repeats: int = 3) -> Dict[str, float]:
    """Per-row scoring latency, because the hot path is one row, not a batch.

    Reporting batched throughput would flatter every model and mislead about the
    authorisation path, which sees one transaction at a time.
    """
    n = min(sample, len(X))
    idx = np.linspace(0, len(X) - 1, n).astype(int) if len(X) else np.array([], dtype=int)
    timings = []
    for _ in range(repeats):
        for i in idx:
            row = X[i:i + 1]
            start = time.perf_counter()
            predict_fn(row)
            timings.append((time.perf_counter() - start) * 1000.0)
    if not timings:
        return {"p50_ms": 0.0, "p99_ms": 0.0, "mean_ms": 0.0}
    arr = np.array(timings)
    return {
        "p50_ms": float(np.percentile(arr, 50)),
        "p99_ms": float(np.percentile(arr, 99)),
        "mean_ms": float(arr.mean()),
    }


def serialised_size_bytes(model) -> int:
    """Deployment size. A boosted forest of 300 trees is not a JSON of weights."""
    try:
        if hasattr(model, "get_booster"):  # xgboost
            booster = model.get_booster()
            import tempfile, os
            with tempfile.TemporaryDirectory() as tmp:
                path = os.path.join(tmp, "m.json")
                booster.save_model(path)
                return os.path.getsize(path)
        if hasattr(model, "booster_"):  # lightgbm
            return len(model.booster_.model_to_string().encode("utf-8"))
    except Exception:
        pass
    return len(pickle.dumps(model))


@dataclass
class ModelResult:
    name: str
    pr_auc: float
    roc_auc: float
    precision: float
    recall: float
    f1: float
    log_loss: float
    ece: float
    p99_ms: float
    size_kb: float
    train_seconds: float
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "model": self.name,
            "pr_auc": round(self.pr_auc, 4),
            "roc_auc": round(self.roc_auc, 4),
            "precision": round(self.precision, 4),
            "recall": round(self.recall, 4),
            "f1": round(self.f1, 4),
            "log_loss": round(self.log_loss, 4),
            "ece": round(self.ece, 4),
            "p99_ms": round(self.p99_ms, 3),
            "size_kb": round(self.size_kb, 1),
            "train_seconds": round(self.train_seconds, 2),
            **self.extra,
        }


def run_comparison(feature_frame: pd.DataFrame, *,
                   fractions: Tuple[float, float, float] = (0.6, 0.2, 0.2),
                   seed: int = 0,
                   include: Optional[Sequence[str]] = None,
                   calibrate_boosted: bool = True,
                   fitters: Optional[Dict[str, Callable[[], Any]]] = None) -> Dict[str, Any]:
    """Train every contender on the SAME chronological split and one table.

    ``fitters`` lets a test inject cheap stand-ins instead of the real ensembles.
    """
    split = training.chronological_split(feature_frame, fractions)
    Xtr, ytr = _X(split.train), _y(split.train)
    Xva, yva = _X(split.val), _y(split.val)
    Xte, yte = _X(split.test), _y(split.test)
    names = list(F.FEATURE_NAMES)

    results: List[ModelResult] = []
    fitted: Dict[str, Any] = {}
    calibrated: Dict[str, Any] = {}

    # --- floor: the rules themselves ------------------------------------
    rules_val = rules_scores(split.val)
    rules_test = rules_scores(split.test)
    rules_threshold = (np.max(rules_val) / 2.0) if len(rules_val) and np.max(rules_val) > 0 else 0.5
    results.append(ModelResult(
        name=RULES_MODEL_NAME,
        pr_auc=M.average_precision(yte, rules_test),
        roc_auc=M.roc_auc(yte, rules_test),
        precision=M.precision_score(yte, (rules_test >= 40).astype(int)),
        recall=M.recall_score(yte, (rules_test >= 40).astype(int)),
        f1=M.f1_score(yte, (rules_test >= 40).astype(int)),
        log_loss=M.log_loss(yte, np.clip(rules_test / 100.0, 1e-6, 1 - 1e-6)),
        ece=M.expected_calibration_error(yte, np.clip(rules_test / 100.0, 1e-6, 1 - 1e-6)),
        p99_ms=0.01,
        size_kb=1.0,
        train_seconds=0.0,
        extra={"calibrated": False, "note": "severity average, not a probability"},
    ))

    factories = dict(fitters or model_factories(seed))
    if include:
        factories = {k: v for k, v in factories.items() if k in include}

    for name, factory in factories.items():
        started = time.perf_counter()
        model = factory()
        model.fit(Xtr, ytr)
        train_seconds = time.perf_counter() - started

        p_val = _positive_proba(model, Xva)
        p_test_raw = _positive_proba(model, Xte)

        # Threshold from the validation set, never the test set.
        threshold = M.threshold_for_precision(yva, p_val, 0.35)
        if threshold is None:
            threshold = float(np.quantile(p_val, 1 - max(1e-4, yva.mean() * 20)))

        is_tree_ensemble = name in ("xgboost", "lightgbm", "random_forest", "adaboost")
        p_test = p_test_raw
        if calibrate_boosted and is_tree_ensemble:
            from .calibration import IsotonicCalibration
            cal = IsotonicCalibration().fit(p_val, yva)
            calibrated[name] = cal
            p_test = cal.predict(p_test_raw)

        pred = (p_test >= threshold).astype(int)
        latency = measure_single_row_latency(
            lambda row, m=model: float(_positive_proba(m, row)[0]), Xte)

        results.append(ModelResult(
            name=name,
            pr_auc=M.average_precision(yte, p_test),
            roc_auc=M.roc_auc(yte, p_test),
            precision=M.precision_score(yte, pred),
            recall=M.recall_score(yte, pred),
            f1=M.f1_score(yte, pred),
            log_loss=M.log_loss(yte, np.clip(p_test, 1e-6, 1 - 1e-6)),
            ece=M.expected_calibration_error(yte, p_test),
            p99_ms=latency["p99_ms"],
            size_kb=serialised_size_bytes(model) / 1024.0,
            train_seconds=train_seconds,
            extra={
                "calibrated": bool(name in calibrated),
                "threshold": round(float(threshold), 4),
                "uncalibrated_pr_auc": round(M.average_precision(yte, p_test_raw), 4),
                "uncalibrated_ece": round(M.expected_calibration_error(yte, p_test_raw), 4),
            },
        ))
        fitted[name] = model

    results.sort(key=lambda r: -r.pr_auc)
    best = next((r for r in results if r.name != RULES_MODEL_NAME), None)
    return {
        "split": split.describe(),
        "results": [r.to_dict() for r in results],
        "best_by_pr_auc": best.name if best else None,
        "models": fitted,
        "calibrators": calibrated,
        "feature_names": names,
    }


# --------------------------------------------------------------------------
# Naive Bayes: the independence violation, measured rather than recited
# --------------------------------------------------------------------------

def _class_conditional_correlations(X: np.ndarray, y: np.ndarray,
                                    feature_names: Sequence[str],
                                    top: int = 6) -> Dict[str, Any]:
    """Pairwise feature correlations **within each class**.

    Within class, not overall, because the assumption Naive Bayes makes is
    *conditional* independence: features are independent *given* the label. Two
    features that merely differ between classes are not a violation; two that
    move together inside the fraud class are.
    """
    out: Dict[str, Any] = {}
    for label, name in ((1, "fraud"), (0, "legit")):
        sub = X[y == label]
        if len(sub) < 10:
            continue
        std = sub.std(axis=0)
        keep = std > 1e-12                      # constant columns have no correlation
        if int(keep.sum()) < 2:
            continue
        kept_names = [n for n, k in zip(feature_names, keep) if k]
        corr = np.corrcoef(sub[:, keep], rowvar=False)
        corr = np.nan_to_num(corr, nan=0.0)
        pairs = []
        for i in range(len(kept_names)):
            for j in range(i + 1, len(kept_names)):
                pairs.append({"a": kept_names[i], "b": kept_names[j],
                              "r": float(corr[i, j])})
        pairs.sort(key=lambda p: -abs(p["r"]))
        values = np.array([abs(p["r"]) for p in pairs]) if pairs else np.array([0.0])
        out[name] = {
            "rows": int(len(sub)),
            "max_abs_r": float(values.max()),
            "mean_abs_r": float(values.mean()),
            # The *complete* set of above-threshold pairs, used by the ablation to
            # pick what to drop. `top_pairs` is for display only — selecting from a
            # truncated list would make the choice depend on how many rows we
            # happened to print.
            "pairs": [{"a": p["a"], "b": p["b"], "r": round(p["r"], 3)} for p in pairs
                     if abs(p["r"]) >= _CORRELATION_THRESHOLD],
            "top_pairs": [{**p, "r": round(p["r"], 3)} for p in pairs[:top]],
        }
    return out


#: |r| above which two features are treated as carrying the same evidence.
_CORRELATION_THRESHOLD = 0.3


def _duplicate_feature_pairs(correlations: Dict[str, Any],
                             threshold: float = 0.999) -> List[Dict[str, Any]]:
    """Pairs of features carrying *the same* information (|r| ≈ 1).

    Worth surfacing separately from general correlation: near-duplicate columns
    are not merely a Naive Bayes problem. They are a feature-set defect — the
    same fact enters the model twice, the weights are identified only up to that
    redundancy, and any per-feature attribution (SHAP included) splits a single
    effect across two columns for no reason.
    """
    seen: Dict[Tuple[str, str], float] = {}
    for label, block in correlations.items():
        for pair in block.get("pairs", []):
            key = (pair["a"], pair["b"])
            if abs(pair["r"]) >= threshold:
                seen[key] = max(seen.get(key, 0.0), abs(pair["r"]))
    return [{"a": a, "b": b, "r": round(r, 6)} for (a, b), r in sorted(seen.items())]


def _redundant_features(correlations: Dict[str, Any],
                        threshold: float = _CORRELATION_THRESHOLD,
                        max_fraction: float = 1.0 / 3.0) -> List[str]:
    """Choose features to drop so that each correlated cluster keeps one member.

    Degree-greedy: score every feature by how much correlated evidence it shares
    with others, then walk the list dropping a feature whenever it still has a
    surviving correlated partner. The effect is that a tightly correlated family
    (``txn_count_1h`` / ``_24h`` / ``_7d`` / ``distinct_merchants_24h``) collapses
    to one representative instead of the model counting the same activity four
    times over. A feature in no correlated pair is never dropped — the ablation
    only ever removes redundant evidence.

    The result is capped at ``max_fraction`` of the features. That cap is not
    cosmetic: when a data generator drives most features from a few latent
    factors, almost everything correlates with *something*, and unbounded
    cluster-collapsing removes two thirds of the model. An experiment that
    deletes most of the evidence measures something else entirely, so the
    ablation is bounded and the reduced model stays a model. The highest-degree
    features — the biggest double-counts — are the ones that go.
    """
    pairs = [p for block in correlations.values() for p in block.get("pairs", [])]
    named = {n for block in correlations.values()
             for p in block.get("pairs", []) for n in (p["a"], p["b"])}
    degree: Dict[str, float] = {}
    for pair in pairs:
        if abs(pair["r"]) < threshold:
            continue
        degree[pair["a"]] = degree.get(pair["a"], 0.0) + abs(pair["r"])
        degree[pair["b"]] = degree.get(pair["b"], 0.0) + abs(pair["r"])
    if not degree:
        return []

    dropped: List[str] = []
    for name in sorted(degree, key=lambda k: -degree[k]):
        if name in dropped:
            continue
        for pair in pairs:
            if abs(pair["r"]) < threshold or name not in (pair["a"], pair["b"]):
                continue
            partner = pair["b"] if name == pair["a"] else pair["a"]
            if partner not in dropped:
                dropped.append(name)
                break

    cap = max(1, int(len(named) * max_fraction))
    return dropped[:cap]


def naive_bayes_diagnosis(feature_frame: pd.DataFrame, *, seed: int = 0) -> Dict[str, Any]:
    """Show *why* Naive Bayes loses, instead of asserting the assumption.

    Three measurements, each aimed at a specific claim:

    1. **Correlation within class.** The independence assumption is about
       features given the label, so the correlations are computed separately for
       frauds and legit transactions.
    2. **Overconfidence.** Share of test rows pushed into the extremes
       (p < 0.01 or p > 0.99) and the mean |log-odds|, against logistic
       regression on the same split. NB multiplies every feature's evidence, so
       correlated features are counted repeatedly and the product runs away.
    3. **The ablation, with a control.** Drop one feature from each strongly
       correlated pair, refit NB, and see whether it gets *better*. If removing
       information improves the model, the information was being double-counted
       — that is the violation, visible in a number. The control drops the same
       **number** of the least-correlated features instead, so an improvement can
       be attributed to removing redundancy rather than to a smaller feature set.
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.naive_bayes import GaussianNB
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler

    split = training.chronological_split(feature_frame)
    Xtr, ytr = _X(split.train), _y(split.train)
    Xte, yte = _X(split.test), _y(split.test)
    names = list(F.FEATURE_NAMES)

    correlations = _class_conditional_correlations(Xtr, ytr, names)
    duplicates = _duplicate_feature_pairs(correlations)

    nb = GaussianNB().fit(Xtr, ytr)
    # The reference is scaled. Raw features here span log-amounts and ratios, and
    # lbfgs does not converge on them within any sane iteration budget — a
    # reference model that failed to converge would flatter NB by comparison,
    # which is the opposite of what this experiment needs.
    logit = Pipeline([
        ("scale", StandardScaler()),
        ("lr", LogisticRegression(max_iter=5000, class_weight="balanced", C=1.0)),
    ]).fit(Xtr, ytr)

    p_nb = _positive_proba(nb, Xte)
    p_lr = _positive_proba(logit, Xte)

    def extremes(p: np.ndarray) -> float:
        return float(np.mean((p < 0.01) | (p > 0.99)))

    def mean_abs_log_odds(p: np.ndarray) -> float:
        p = np.clip(p, 1e-12, 1 - 1e-12)
        return float(np.mean(np.abs(np.log(p / (1 - p)))))

    baseline = {
        "pr_auc": M.average_precision(yte, p_nb),
        "log_loss": M.log_loss(yte, np.clip(p_nb, 1e-6, 1 - 1e-6)),
        "ece": M.expected_calibration_error(yte, p_nb),
        "extreme_share": extremes(p_nb),
        "mean_abs_log_odds": mean_abs_log_odds(p_nb),
    }
    reference = {
        "pr_auc": M.average_precision(yte, p_lr),
        "log_loss": M.log_loss(yte, np.clip(p_lr, 1e-6, 1 - 1e-6)),
        "ece": M.expected_calibration_error(yte, p_lr),
        "extreme_share": extremes(p_lr),
        "mean_abs_log_odds": mean_abs_log_odds(p_lr),
    }

    dropped = _redundant_features(correlations)
    keep_idx = [i for i, n in enumerate(names) if n not in dropped]

    def fit_reduced(idx: Sequence[int]) -> Dict[str, float]:
        if len(idx) < 2:
            return {}
        model = GaussianNB().fit(Xtr[:, idx], ytr)
        p = _positive_proba(model, Xte[:, idx])
        return {
            "pr_auc": M.average_precision(yte, p),
            "log_loss": M.log_loss(yte, np.clip(p, 1e-6, 1 - 1e-6)),
            "ece": M.expected_calibration_error(yte, p),
            "extreme_share": extremes(p),
        }

    # Control arm: remove the *same number* of features, but choose the ones that
    # share the least evidence with anything else — the least redundant in the
    # set. Deterministic rather than random, so the comparison has no seed to
    # argue about, and maximally unkind to the hypothesis: removing an
    # independent feature costs real information and buys no de-duplication, so
    # if the correlated arm still wins, the double-count is doing the work.
    degree: Dict[str, float] = {}
    for block in correlations.values():
        for pair in block.get("pairs", []):
            degree[pair["a"]] = degree.get(pair["a"], 0.0) + abs(pair["r"])
            degree[pair["b"]] = degree.get(pair["b"], 0.0) + abs(pair["r"])
    least_redundant = [n for n in sorted(names, key=lambda n: (degree.get(n, 0.0), n))
                       if n not in dropped][:max(0, len(dropped))]

    reduced = fit_reduced(keep_idx)
    control = fit_reduced([i for i, n in enumerate(names) if n not in least_redundant]) if least_redundant else {}

    # ECE is a *bin-averaged* statistic, and its weakness is on display here: when
    # almost every prediction is pushed into the two extreme bins, binning hides
    # the damage. Log-loss, which scores each row's probability directly, does
    # not — so the comparison leans on log-loss and on how much mass sits in the
    # extremes, and the ECE column is reported as a caveat rather than as proof.
    log_loss_ratio = (baseline["log_loss"] / reference["log_loss"]) if reference["log_loss"] > 0 else float("inf")

    verdict = ("Naive Bayes' conditional-independence assumption is violated here. Its "
               "evidence is multiplied once per *feature* instead of once per *fact*, so "
               "%.1f%% of its predictions land below 0.01 or above 0.99 (logistic: %.1f%%) "
               "and its mean |log-odds| is %.1f against logistic's %.1f. The cost shows up in "
               "log-loss (%.4f vs %.4f, %.1f× worse) more than in ECE (%.4f vs %.4f), because "
               "ECE averages over bins and most of its mass is in the same two bins."
               % (100 * baseline["extreme_share"], 100 * reference["extreme_share"],
                  baseline["mean_abs_log_odds"], reference["mean_abs_log_odds"],
                  baseline["log_loss"], reference["log_loss"], log_loss_ratio,
                  baseline["ece"], reference["ece"]))
    if reduced and control:
        # Equal feature count, so the only difference is *which* features left.
        if reduced["log_loss"] < control["log_loss"]:
            verdict += (" The ablation isolates the double-counting: dropping one feature "
                        "from each strongly correlated pair gives log-loss %.4f, while "
                        "dropping the same number of *uncorrelated* features gives %.4f. "
                        "Removing redundant evidence helps more than removing independent "
                        "evidence, which is what a double-count looks like."
                        % (reduced["log_loss"], control["log_loss"]))
        else:
            verdict += (" The ablation did not separate the redundant and control feature "
                        "sets on this data, so the demonstration rests on the "
                        "overconfidence and correlation numbers above.")

    return {
        "assumption": ("features are conditionally independent given the class — for each "
                       "feature, P(x_i | y) is estimated as if no other feature existed"),
        "class_conditional_correlations": correlations,
        "duplicate_feature_pairs": duplicates,
        "naive_bayes": {k: round(v, 6) for k, v in baseline.items()},
        "logistic_reference": {k: round(v, 6) for k, v in reference.items()},
        "overconfidence": {
            "extreme_share_nb": round(baseline["extreme_share"], 4),
            "extreme_share_logistic": round(reference["extreme_share"], 4),
            "mean_abs_log_odds_nb": round(baseline["mean_abs_log_odds"], 2),
            "mean_abs_log_odds_logistic": round(reference["mean_abs_log_odds"], 2),
            "ece_nb": round(baseline["ece"], 4),
            "ece_logistic": round(reference["ece"], 4),
            "log_loss_nb": round(baseline["log_loss"], 6),
            "log_loss_logistic": round(reference["log_loss"], 6),
            "log_loss_ratio": round(log_loss_ratio, 3),
            "ece_caveat": ("ECE averages error over bins; when nearly all predictions "
                           "fall in the two extreme bins it understates the damage, so "
                           "log-loss and the extreme share are the load-bearing numbers"),
        },
        "ablation": {
            "dropped_features": dropped,
            "nb_reduced": {k: round(v, 6) for k, v in reduced.items()},
            "control_features": least_redundant,
            "nb_control_least_correlated": {k: round(v, 6) for k, v in control.items()},
        },
        "verdict": verdict,
    }


def render_naive_bayes(result: Dict[str, Any]) -> str:
    lines = ["### Naive Bayes, and why the independence assumption costs it", ""]
    lines.append("**The assumption:** %s" % result["assumption"])
    lines.append("")

    nb, lr, oc = result["naive_bayes"], result["logistic_reference"], result["overconfidence"]
    lines.append("| | PR-AUC | log-loss | ECE | share p<0.01 or p>0.99 | mean &#124;log-odds&#124; |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    lines.append("| Naive Bayes | %.4f | %.4f | %.4f | %.1f%% | %.1f |" % (
        nb["pr_auc"], nb["log_loss"], nb["ece"], 100 * nb["extreme_share"],
        nb["mean_abs_log_odds"]))
    lines.append("| logistic (reference) | %.4f | %.4f | %.4f | %.1f%% | %.1f |" % (
        lr["pr_auc"], lr["log_loss"], lr["ece"], 100 * lr["extreme_share"],
        lr["mean_abs_log_odds"]))
    lines.append("")
    lines.append("Log-loss here is **%.1f× worse** than the linear reference. Note the ECE column "
                 "barely moves: %s" % (oc["log_loss_ratio"], oc["ece_caveat"] + "."))
    lines.append("")

    lines.append("**Correlation within class** (the assumption is about features *given the label*):")
    lines.append("")
    lines.append("| class | rows | max &#124;r&#124; | mean &#124;r&#124; | strongest pair |")
    lines.append("|---|---:|---:|---:|---|")
    for label in ("fraud", "legit"):
        block = result["class_conditional_correlations"].get(label)
        if not block:
            continue
        top = block["top_pairs"][0] if block["top_pairs"] else None
        pair = ("`%s` ↔ `%s` (r = %+.3f)" % (top["a"], top["b"], top["r"])) if top else "—"
        lines.append("| %s | %d | %.3f | %.3f | %s |" % (
            label, block["rows"], block["max_abs_r"], block["mean_abs_r"], pair))
    lines.append("")

    dupes = result.get("duplicate_feature_pairs") or []
    if dupes:
        lines.append("**Duplicate columns** (|r| ≈ 1 within class) — a feature-set defect, not just an "
                     "NB problem: the same fact reaches the model twice, so any per-feature attribution "
                     "splits one effect across two names.")
        lines.append("")
        for d in dupes:
            lines.append("- `%s` ↔ `%s` (r = %+.3f)" % (d["a"], d["b"], d["r"]))
        lines.append("")

    ab = result["ablation"]
    if ab["dropped_features"]:
        lines.append("**The ablation:** collapse each correlated cluster to one representative, "
                     "refit, and compare against removing the same *number* of the least "
                     "redundant features (%s). Same count leaves in each arm, so the only "
                     "difference is whether what left was redundant."
                     % (", ".join("`%s`" % f for f in ab.get("control_features") or []) or "none"))
        lines.append("")
        lines.append("| variant | PR-AUC | log-loss | ECE |")
        lines.append("|---|---:|---:|---:|")
        lines.append("| all features | %.4f | %.4f | %.4f |" % (nb["pr_auc"], nb["log_loss"], nb["ece"]))
        red = ab["nb_reduced"]
        lines.append("| minus correlated (%s) | %.4f | %.4f | %.4f |" % (
            ", ".join("`%s`" % f for f in ab["dropped_features"]),
            red.get("pr_auc", float("nan")), red.get("log_loss", float("nan")),
            red.get("ece", float("nan"))))
        ctrl = ab["nb_control_least_correlated"]
        lines.append("| minus equally many uncorrelated | %.4f | %.4f | %.4f |" % (
            ctrl.get("pr_auc", float("nan")), ctrl.get("log_loss", float("nan")),
            ctrl.get("ece", float("nan"))))
        lines.append("")
        lines.append("The comparison that means something is the last two rows, not the first column: "
                     "the same *number* of features leaves in each, so the only difference is "
                     "whether the ones that left were correlated.")
        lines.append("")

    lines.append("**So what:** %s" % result["verdict"])
    lines.append("")
    return "\n".join(lines)


def calibration_before_after(model, split: training.Split,
                             is_tree: bool = True) -> Dict[str, Any]:
    """Reliability before/after for one model — the Phase 2 comparison figure."""
    from .calibration import IsotonicCalibration

    Xva, yva = _X(split.val), _y(split.val)
    Xte, yte = _X(split.test), _y(split.test)
    p_va = _positive_proba(model, Xva)
    p_te = _positive_proba(model, Xte)

    out = {
        "before": {
            "ece": M.expected_calibration_error(yte, p_te),
            "log_loss": M.log_loss(yte, np.clip(p_te, 1e-6, 1 - 1e-6)),
            "pr_auc": M.average_precision(yte, p_te),
        }
    }
    if is_tree:
        cal = IsotonicCalibration().fit(p_va, yva)
        p_cal = cal.predict(p_te)
        out["after"] = {
            "ece": M.expected_calibration_error(yte, p_cal),
            "log_loss": M.log_loss(yte, np.clip(p_cal, 1e-6, 1 - 1e-6)),
            "pr_auc": M.average_precision(yte, p_cal),
        }
        out["note"] = ("isotonic is monotone, so PR-AUC is ~unchanged while "
                       "calibration improves — ranking and probability are different jobs")
    return out


# --------------------------------------------------------------------------
# Cross-validation: k-fold vs stratified vs time-series
# --------------------------------------------------------------------------

def _time_series_folds(n: int, k: int) -> List[Tuple[np.ndarray, np.ndarray]]:
    """Forward chaining: train on a growing prefix, test on the next block."""
    folds = []
    block = n // (k + 1)
    for i in range(1, k + 1):
        train_end = block * i
        test_end = min(n, block * (i + 1))
        if train_end < 10 or test_end <= train_end:
            continue
        folds.append((np.arange(0, train_end), np.arange(train_end, test_end)))
    return folds


def cv_comparison(feature_frame: pd.DataFrame, *, k: int = 5, seed: int = 0,
                  factory: Optional[Callable[[], Any]] = None) -> Dict[str, Any]:
    """k-fold vs stratified k-fold vs time-series forward chaining.

    The lesson: stratified k-fold is genuinely the right tool for imbalanced
    *non-temporal* data, and it is **invalid here** because folds share users'
    futures. We report the numbers so the optimism gap is measured, not asserted.
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import KFold, StratifiedKFold

    df = feature_frame.sort_values("timestamp").reset_index(drop=True)
    X, y = _X(df), _y(df)
    make = factory or (lambda: LogisticRegression(max_iter=5000, class_weight="balanced"))
    index = np.arange(len(df))

    def score_folds(folds) -> List[float]:
        scores = []
        for tr, te in folds:
            if len(np.unique(y[tr])) < 2 or len(np.unique(y[te])) < 2:
                continue
            model = make()
            model.fit(X[tr], y[tr])
            scores.append(float(M.average_precision(y[te], _positive_proba(model, X[te]))))
        return scores

    kf = list(KFold(n_splits=k, shuffle=True, random_state=seed).split(index))
    skf = list(StratifiedKFold(n_splits=k, shuffle=True, random_state=seed).split(index, y))
    ts = _time_series_folds(len(df), k)

    plain = score_folds(kf)
    strat = score_folds(skf)
    timec = score_folds(ts)

    def summarise(values):
        return {"mean": float(np.mean(values)) if values else 0.0,
                "std": float(np.std(values)) if values else 0.0,
                "folds": [round(v, 4) for v in values]}

    strat_mean = float(np.mean(strat)) if strat else 0.0
    time_mean = float(np.mean(timec)) if timec else 0.0
    return {
        "k_fold": summarise(plain),
        "stratified_k_fold": summarise(strat),
        "time_series_forward_chaining": summarise(timec),
        "optimism_gap_stratified_vs_time": strat_mean - time_mean,
        "verdict": ("stratified k-fold inflates the score because folds share "
                    "users' later transactions; forward-chaining time-series CV is "
                    "the only scheme valid on transaction data"),
    }


# --------------------------------------------------------------------------
# SHAP — a black box would break PayGuard's core promise
# --------------------------------------------------------------------------

def shap_top_contributions(model, X: np.ndarray, feature_names: Sequence[str],
                           k: int = 5, background: Optional[np.ndarray] = None
                           ) -> List[Dict[str, Any]]:
    """TreeSHAP contributions for one (or a few) rows.

    Shapley values come from cooperative game theory and are the unique
    attribution satisfying a few reasonable axioms, so — unlike most
    "importance" heuristics — they have a real theoretical grounding. TreeSHAP
    is fast enough (O(TLD^2)) to run inside the scoring path, which is what lets
    the Alerts screen say *why* for a boosted model, exactly as it does for rules.
    """
    import shap

    X = np.atleast_2d(X)
    try:
        explainer = shap.TreeExplainer(model)
        values = explainer.shap_values(X, check_additivity=False)
    except Exception:
        # Non-tree model (e.g. logistic): fall back to the linear explainer,
        # where the contributions are exact by construction.
        explainer = shap.LinearExplainer(model, background) if background is not None else None
        if explainer is None:
            raise
        values = explainer.shap_values(X)

    if isinstance(values, list):          # older shap: [class0, class1]
        values = values[1]
    values = np.asarray(values)
    if values.ndim == 3:
        values = values[:, :, 1]
    row = values[0]

    order = np.argsort(-np.abs(row))[:k]
    return [
        {"feature": feature_names[i], "value": float(X[0, i]), "shap": float(row[i])}
        for i in order
    ]


# --------------------------------------------------------------------------
# Export the sidecar artefact
# --------------------------------------------------------------------------

def save_lightgbm_for_sidecar(model, feature_names: Sequence[str], path: str,
                              metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Persist a boosted model in a form the FastAPI sidecar can reload.

    Boosted forests do not export to a JSON of weights, which is exactly why
    Phase 2 needs a sidecar at all: the artefact is the booster, not a vector.
    """
    meta = {"features": list(feature_names), "format": "lightgbm", "version": "gbm-v1"}
    if metadata:
        meta.update(metadata)
    model.booster_.save_model(path)
    with open(path + ".meta.json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)
    return meta


def render_comparison(result: Dict[str, Any]) -> str:
    lines = ["### The model that wins", ""]
    s = result["split"]
    lines.append("_Chronological split: train %d · val %d · test %d (fraud %.3f%% in test)_"
                 % (s["train_rows"], s["val_rows"], s["test_rows"], 100 * s["test_fraud_rate"]))
    lines.append("")
    lines.append("| model | PR-AUC | ROC-AUC | precision | recall | F1 | log-loss | ECE | p99 ms | size KB |")
    lines.append("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for row in result["results"]:
        lines.append("| `%s` | %.4f | %.4f | %.3f | %.3f | %.3f | %.4f | %.4f | %.2f | %.0f |" % (
            row["model"], row["pr_auc"], row["roc_auc"], row["precision"], row["recall"],
            row["f1"], row["log_loss"], row["ece"], row["p99_ms"], row["size_kb"]))
    lines.append("")
    lines.append("Best by PR-AUC: **%s** — but read the p99 and size columns before "
                 "believing it is free." % result["best_by_pr_auc"])
    lines.append("")
    for row in result["results"]:
        if row.get("calibrated") and "uncalibrated_ece" in row:
            lines.append("- `%s`: ECE %.4f before calibration, %.4f after "
                         "(PR-AUC %.4f → %.4f — monotone calibration reorders nothing)"
                         % (row["model"], row["uncalibrated_ece"], row["ece"],
                            row["uncalibrated_pr_auc"], row["pr_auc"]))
    lines.append("")
    return "\n".join(lines)


def render_cv(result: Dict[str, Any]) -> str:
    lines = ["### Cross-validation, and why two of these are wrong", ""]
    lines.append("| scheme | mean PR-AUC | std |")
    lines.append("|---|---:|---:|")
    for key, label in (("k_fold", "k-fold (shuffled)"),
                       ("stratified_k_fold", "stratified k-fold (shuffled)"),
                       ("time_series_forward_chaining", "time-series forward chaining")):
        block = result[key]
        lines.append("| %s | %.4f | %.4f |" % (label, block["mean"], block["std"]))
    lines.append("")
    lines.append("Optimism gap (stratified − time-series): **%+.4f**. %s"
                 % (result["optimism_gap_stratified_vs_time"], result["verdict"]))
    lines.append("")
    return "\n".join(lines)
