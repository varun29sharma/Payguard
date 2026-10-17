"""baseline.py — how good are the rules, actually?

This is the number everything else is measured against, so it has two jobs:
be correct, and be *readable* — the output is meant to be pasted into
``EXPERIMENTS.md`` and the README verbatim.

It also turns Flaw 1 from a prose claim into an executable counterexample.
``averaging_aggregate`` reproduces the four lines of
``FraudScoringService.score`` exactly (mean of fired rule scores, truncated by
an ``(int)`` cast), and the counterexample test asserts that *adding* evidence
can *lower* the score — which is the whole reason Phase 1 exists.
"""

from __future__ import annotations

import csv
import json
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence

import numpy as np
import pandas as pd

from . import metrics as M
from .replay import ReplayReport

#: The six scoring rules, in the order the engine registers them.
RULE_NAMES = [
    "VELOCITY_RULE",
    "ENUMERATION_ATTACK_RULE",
    "AMOUNT_THRESHOLD_RULE",
    "GEOGRAPHIC_ANOMALY_RULE",
    "NEW_DEVICE_RULE",
    "NIGHT_OWL_RULE",
]

#: The engine's own status bands (FraudScoringService).
REVIEW_THRESHOLD = 40
BLOCK_THRESHOLD = 70


# --------------------------------------------------------------------------
# Flaw 1, made executable
# --------------------------------------------------------------------------

def averaging_aggregate(scores: Sequence[float]) -> int:
    """Exactly ``FraudScoringService.score``: the truncated mean of fired scores.

    Kept here, in the ML package, precisely so there is a test that fails if
    anyone "fixes" the Java without understanding what was wrong. It is not
    used to score anything — only to reproduce and prove the defect.
    """
    if not scores:
        return 0
    return int(sum(scores) / len(scores))


def _logit(p: float) -> float:
    p = min(max(p, 1e-6), 1 - 1e-6)
    return math.log(p / (1 - p))


def severity_to_weight(score: float) -> float:
    """Placeholder evidence weight for one fired rule.

    A rule *firing* is always at least weakly positive evidence, so the weight
    must be strictly positive for every score in (0, 100] and increasing in
    severity. Note the trap this avoids: the tempting ``logit(score/100)`` is
    **negative below 50**, which would make a weak-but-real signal *reduce* the
    total — the same non-monotonicity as averaging, just in different clothes.
    Anchoring halfway between neutral and certain keeps it positive:
    ``p = 0.5 + 0.5 * (score/100)``, ``w = logit(p)``.

    These are placeholders. Phase 1 replaces them with weights *learned* from
    data — the useful statement is not what the number is, but that the
    aggregation accumulates.
    """
    if score <= 0:
        return 0.0
    p = 0.5 + 0.5 * min(score, 100.0) / 100.0
    return _logit(p)


def accumulating_aggregate(scores: Sequence[float], intercept: float = 0.0) -> int:
    """A monotone alternative: accumulate evidence in log-odds space.

    Each fired rule adds its (non-negative) weight to a running log-odds total;
    a sigmoid maps the sum to a 0–100 probability-like score. Adding a rule can
    therefore never *lower* the score — the property the mean lacks, and the
    property Phase 1's logistic regression inherits when its learned weights
    are positive.

    The absolute scale differs from the rule engine's severity scale, so the
    band labels in the table are illustrative of movement, not directly
    comparable to ``review``/``blocked`` thresholds.
    """
    total = intercept + sum(severity_to_weight(s) for s in scores)
    prob = 1.0 / (1.0 + math.exp(-total))
    return int(round(100 * prob))


def averaging_flaw_counterexample() -> List[Dict[str, Any]]:
    """The README's table, generated rather than hand-written."""
    cases = [
        ("AMOUNT_THRESHOLD_RULE alone", [65]),
        ("AMOUNT_THRESHOLD + NIGHT_OWL", [65, 40]),
        ("IMPOSSIBLE_TRAVEL alone (GEO)", [80]),
        ("GEO + NIGHT_OWL", [80, 40]),
        ("GEO + NIGHT_OWL + VELOCITY + AMOUNT", [80, 40, 60, 65]),
    ]
    rows = []
    for label, scores in cases:
        avg = averaging_aggregate(scores)
        acc = accumulating_aggregate(scores)
        rows.append({
            "case": label,
            "fired_scores": scores,
            "averaged_score": avg,
            "averaged_status": _status(avg),
            "accumulated_score": acc,
            "accumulated_status": _status(acc),
        })
    return rows


def _status(score: int) -> str:
    if score >= BLOCK_THRESHOLD:
        return "blocked"
    if score >= REVIEW_THRESHOLD:
        return "review"
    return "clear"


# --------------------------------------------------------------------------
# Reading the baseline out of real state
# --------------------------------------------------------------------------

def rules_from_replay(report: ReplayReport) -> pd.DataFrame:
    """ReplayReport -> a frame with one boolean column per rule + the label.

    The label is the *dataset's* ``is_fraud`` (carried on the outcome), never
    ``rulesTriggered``. ``flagged`` is the engine's own live decision, which is
    what "the baseline" means.
    """
    records = []
    for o in report.outcomes:
        record = {"transactionId": o.source_transaction_id,
                  "is_fraud": bool(o.is_fraud_label),
                  "flagged": o.fraud_status not in (None, "clear"),
                  "fraudStatus": o.fraud_status}
        fired = set(o.rules_triggered or [])
        for rule in RULE_NAMES:
            record[rule] = rule in fired
        records.append(record)
    return pd.DataFrame.from_records(records)


def parse_export_csv(path: str) -> pd.DataFrame:
    """Parse ``GET /api/transactions/export`` into a frame.

    ``rulesTriggered`` arrives as ``"RULE:score; RULE:score"``; we split it into
    the boolean indicator columns the per-rule table needs. Labels come from
    ``isConfirmedFraud`` — i.e. from disputes, which came from the dataset.
    """
    rows: List[Dict[str, Any]] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as fh:
        for raw in csv.DictReader(fh):
            fired = set()
            for chunk in (raw.get("rulesTriggered") or "").split(";"):
                name = chunk.strip().split(":")[0].strip()
                if name:
                    fired.add(name)
            record: Dict[str, Any] = {
                "transactionId": raw.get("transactionId"),
                "userId": raw.get("userId"),
                "timestamp": raw.get("timestamp"),
                "fraudScore": _to_float(raw.get("fraudScore")),
                "fraudStatus": raw.get("fraudStatus") or "clear",
                "is_fraud": str(raw.get("isConfirmedFraud", "")).strip().lower() in ("true", "1", "yes"),
                "flagged": (raw.get("fraudStatus") or "clear") != "clear",
            }
            for rule in RULE_NAMES:
                record[rule] = rule in fired
            rows.append(record)
    return pd.DataFrame.from_records(rows)


def _to_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------------
# The report
# --------------------------------------------------------------------------

@dataclass
class BaselineResult:
    """Everything the README table and EXPERIMENTS.md need."""

    n: int
    positives: int
    prevalence: float
    metrics: Dict[str, Any]
    per_rule: List[Dict[str, Any]]
    counterexample: List[Dict[str, Any]]
    source: str
    generated_at: str
    notation: str
    flags: List[str]

    def to_dict(self) -> Dict[str, Any]:
        return {
            "source": self.source,
            "generated_at": self.generated_at,
            "n": self.n,
            "positives": self.positives,
            "prevalence": self.prevalence,
            "metrics": self.metrics,
            "per_rule": self.per_rule,
            "counterexample": self.counterexample,
            "notation": self.notation,
            "flags": self.flags,
        }


def _notation_for(frame: pd.DataFrame) -> str:
    """Describe what this dataset could and could not evaluate.

    A rule that was never exercisable (because the dataset lacks its input)
    must not appear as a zero in a table and be read as "this rule is useless".
    """
    notes = []
    if "deviceId" not in frame.columns or frame.get("deviceId", pd.Series(dtype=object)).isna().all():
        notes.append("deviceId absent -> NEW_DEVICE_RULE not evaluable on this data")
    if "location.city" not in frame.columns:
        notes.append("no city column -> GEOGRAPHIC_ANOMALY_RULE coverage limited")
    return "; ".join(notes) if notes else "all six rules evaluable"


def baseline_from_frame(frame: pd.DataFrame, *, source: str = "unknown",
                        threshold: Optional[float] = None) -> BaselineResult:
    """Compute the honest baseline from a frame carrying ``is_fraud`` + rule flags.

    ``flagged`` is the engine's live decision; when a frame only has
    per-transaction ``fraudScore`` we can derive it at the review threshold.
    """
    if frame.empty:
        raise ValueError("cannot compute a baseline from an empty frame")

    y = frame["is_fraud"].astype(bool).to_numpy()
    if "flagged" in frame.columns:
        flagged = frame["flagged"].astype(bool).to_numpy()
    elif "fraudScore" in frame.columns:
        recorded = frame["fraudScore"].fillna(0).to_numpy(dtype=float)
        flagged = recorded >= (threshold if threshold is not None else REVIEW_THRESHOLD)
    else:
        raise ValueError("frame needs either a 'flagged' or a 'fraudScore' column")

    # The rules are a hard classifier, so the "score" we rank by is the
    # recorded fraudScore when we have it; otherwise fall back to the flag.
    ranking = (frame["fraudScore"].fillna(0).to_numpy(dtype=float)
               if "fraudScore" in frame.columns else flagged.astype(float))
    c = M.confusion_counts(y, flagged)
    # Treat the engine's 0-100 severity as if it were a probability, so the
    # report can *show* how badly it is calibrated. This is not a criticism we
    # invented — it is the concrete reason Phase 1 adds Platt/isotonic scaling.
    as_prob = np.clip(ranking / 100.0, 1e-6, 1 - 1e-6)
    point = {
        "confusion": c,
        "precision": M.precision_score(y, flagged),
        "recall": M.recall_score(y, flagged),
        "f1": M.f1_score(y, flagged),
        "accuracy": M.accuracy_score(y, flagged),
        "pr_auc": M.average_precision(y, ranking),
        "roc_auc": M.roc_auc(y, ranking),
        "log_loss": M.log_loss(y, as_prob),
        "brier": M.brier_score(y, as_prob),
        "ece": M.expected_calibration_error(y, as_prob) if len(y) else 0.0,
        "flagged_rate": float(np.mean(flagged)) if len(flagged) else 0.0,
    }
    per_rule = M.per_rule_detection(frame, RULE_NAMES)
    return BaselineResult(
        n=int(len(frame)),
        positives=int(y.sum()),
        prevalence=float(y.mean()),
        metrics=point,
        per_rule=per_rule,
        counterexample=averaging_flaw_counterexample(),
        source=source,
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        notation=_notation_for(frame),
        flags=[
            "Labels come from disputes/dataset — never from rulesTriggered.",
            "Rules are evaluated on their live decision, not a re-tuned version.",
        ],
    )


def baseline_from_replay(report: ReplayReport) -> BaselineResult:
    return baseline_from_frame(rules_from_replay(report), source="replay")


def baseline_from_export(path: str) -> BaselineResult:
    return baseline_from_frame(parse_export_csv(path), source="export:%s" % path)


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def render_markdown(result: BaselineResult) -> str:
    """The report as Markdown — this is what goes into the README."""
    m = result.metrics
    lines: List[str] = []
    lines.append("### How good are the rules, actually?")
    lines.append("")
    lines.append("_Source: `%s` · n=%d · positives=%d (%.3f%%) · generated %s_"
                 % (result.source, result.n, result.positives, 100 * result.prevalence,
                    result.generated_at))
    lines.append("")
    lines.append("| metric | value |")
    lines.append("|---|---|")
    lines.append("| Precision | %.3f |" % m["precision"])
    lines.append("| Recall | %.3f |" % m["recall"])
    lines.append("| F1 | %.3f |" % m["f1"])
    lines.append("| **PR-AUC (average precision)** | **%.4f** |" % m["pr_auc"])
    lines.append("| ROC-AUC | %.4f |" % m["roc_auc"])
    lines.append("| Log-loss (severity read as a probability) | %.4f |" % m["log_loss"])
    lines.append("| Calibration error (ECE) | %.4f |" % m["ece"])
    lines.append("| Flag rate | %.3f%% |" % (100 * m["flagged_rate"]))
    lines.append("| Accuracy | %.4f _(meaningless here)_ |" % m["accuracy"])
    lines.append("")
    lines.append("Confusion matrix (fraud = positive): `TP=%d FP=%d FN=%d TN=%d`"
                 % (m["confusion"]["tp"], m["confusion"]["fp"],
                    m["confusion"]["fn"], m["confusion"]["tn"]))
    lines.append("")
    lines.append("**Per-rule precision and recall** — the half the detection "
                 "endpoint cannot show:")
    lines.append("")
    lines.append("| rule | fired | caught | false alarms | recall | precision |")
    lines.append("|---|---:|---:|---:|---:|---:|")
    for row in result.per_rule:
        lines.append("| `%s` | %d | %d | %d | %.3f | %.3f |"
                     % (row["rule"], row["fired"], row["caught"], row["false_alarms"],
                        row["recall"], row["precision"]))
    lines.append("")
    lines.append("**Flaw 1, as a table** — averaging evidence is not monotone:")
    lines.append("")
    lines.append("| fired rules | scores | average | status | log-odds | status |")
    lines.append("|---|---|---|---|---|---|")
    for row in result.counterexample:
        lines.append("| %s | %s | %d | %s | %d | %s |"
                     % (row["case"], row["fired_scores"], row["averaged_score"],
                        row["averaged_status"], row["accumulated_score"],
                        row["accumulated_status"]))
    lines.append("")
    lines.append("_Notation: %s_" % result.notation)
    lines.append("")
    lines.append("_Guards: %s_" % " ".join(result.flags))
    lines.append("")
    return "\n".join(lines)


def write_reports(result: BaselineResult, json_path: Optional[str] = None,
                  markdown_path: Optional[str] = None) -> None:
    if json_path:
        with open(json_path, "w", encoding="utf-8") as fh:
            json.dump(result.to_dict(), fh, indent=2, sort_keys=True)
    if markdown_path:
        with open(markdown_path, "w", encoding="utf-8") as fh:
            fh.write(render_markdown(result))


#: The engine's live severities (ruleConfigService.DEFAULT_RULES), so the demo
#: scores the way the real engine scores.
DEFAULT_SEVERITIES = {
    "VELOCITY_RULE": 60,
    "ENUMERATION_ATTACK_RULE": 75,
    "AMOUNT_THRESHOLD_RULE": 65,
    "GEOGRAPHIC_ANOMALY_RULE": 80,
    "NEW_DEVICE_RULE": 55,
    "NIGHT_OWL_RULE": 40,
}


def simulate_rule_engine(frame: pd.DataFrame) -> pd.DataFrame:
    """A faithful *stand-in* for the six rules, for the no-server demo only.

    This is NOT the Java engine and its output is not a baseline. It exists so
    the reporting path (per-rule precision/recall, the Flaw 1 table, the
    markdown render) can be exercised in CI. Crucially it applies the engine's
    **real** aggregation (the truncated mean) and its real severities, so the
    flaw shown on synthetic data is the same flaw the Java code has.

    Labels are untouched: ``is_fraud`` still comes from the latent generator,
    never from these flags. That is the point — a rule simulator may *decide*,
    but it must never *label*.
    """
    df = frame.sort_values("timestamp").copy()
    gap_seconds = df.groupby("userId")["timestamp"].diff().dt.total_seconds()
    df["VELOCITY_RULE"] = gap_seconds.fillna(1e9) < 15
    df["ENUMERATION_ATTACK_RULE"] = (df["amount"] <= 40) & (gap_seconds.fillna(1e9) < 120)
    df["AMOUNT_THRESHOLD_RULE"] = df["amount"] >= 20_000
    distinct_cities = df.groupby("userId")["city"].transform("nunique")
    df["GEOGRAPHIC_ANOMALY_RULE"] = (distinct_cities > 1) & (gap_seconds.fillna(1e9) < 7200)
    if "synthetic_kind" in df.columns:
        df["NEW_DEVICE_RULE"] = df["synthetic_kind"].isin(["card_testing", "account_takeover"])
    else:
        df["NEW_DEVICE_RULE"] = False
    hours = df["timestamp"].dt.hour
    df["NIGHT_OWL_RULE"] = (hours >= 0) & (hours <= 5)

    severities = np.array([DEFAULT_SEVERITIES[r] for r in RULE_NAMES])
    fired = df[RULE_NAMES].to_numpy(dtype=bool)
    scores = fired * severities[None, :]
    # The engine's aggregation, reproduced exactly: truncated mean of fired.
    counts = fired.sum(axis=1)
    df["fraudScore"] = np.where(counts > 0, (scores.sum(axis=1) / np.maximum(counts, 1)).astype(int), 0)
    df["flagged"] = df["fraudScore"] >= REVIEW_THRESHOLD
    return df


def demo_baseline(n: int = 20_000, seed: int = 7) -> BaselineResult:
    """A runnable end-to-end demo with no server and no Kaggle download.

    Numbers from this function are labelled ``source="synthetic-demo"`` and
    must never be quoted as the real baseline — the real one comes from
    ``baseline_from_replay`` / ``baseline_from_export``.
    """
    from . import dataset

    frame = simulate_rule_engine(dataset.load_synthetic(n=n, seed=seed))
    return baseline_from_frame(frame, source="synthetic-demo")
