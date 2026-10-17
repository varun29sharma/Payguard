#!/usr/bin/env python
"""train_logistic.py — train, calibrate, evaluate and export the Phase 1 model.

    # fixture (no data, no server) — produces a real artefact from fake data
    python train_logistic.py --synthetic --n 40000

    # real data: a canonical CSV, e.g. written by run_baseline.py's replay
    python train_logistic.py --csv data/canonical_sparkov.csv

Writes, into ml/artifacts/:
    model-v1.json          the artefact the Java engine loads
    logistic-report.md     the markdown table for EXPERIMENTS.md / README
    logistic-report.json   everything, machine-readable
    pr-curve.png, reliability.png

The exported model is a *shadow* model: the Java engine records its opinion on
every transaction and the rules keep deciding.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Optional

import numpy as np
import pandas as pd

from payguard_ml import dataset, features, metrics, training


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--synthetic", action="store_true", help="use the synthetic fixture")
    source.add_argument("--csv", help="canonical DataFrame CSV (must include is_fraud)")
    p.add_argument("--n", type=int, default=40_000)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--l2", type=float, default=1.0)
    p.add_argument("--calibration", choices=("platt", "isotonic", "none"), default="platt")
    p.add_argument("--no-feature-selection", action="store_true")
    p.add_argument("--selection-k", type=int, default=12)
    p.add_argument("--fraud-cost", type=float, default=training.DEFAULT_FRAUD_COST)
    p.add_argument("--alert-cost", type=float, default=training.DEFAULT_ALERT_COST)
    p.add_argument("--precision-target", type=float, default=training.DEFAULT_PRECISION_TARGET)
    p.add_argument("--outdir", default=os.path.join(os.path.dirname(__file__), "artifacts"))
    return p


def load_frame(args) -> pd.DataFrame:
    if args.synthetic:
        frame = dataset.load_synthetic(n=args.n, seed=args.seed)
        # Give the fixture the six rule flags the engine would have recorded,
        # using the faithful stand-in (never the label).
        from payguard_ml.baseline import simulate_rule_engine
        return simulate_rule_engine(frame)
    frame = pd.read_csv(args.csv, parse_dates=["timestamp"])
    return frame


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    os.makedirs(args.outdir, exist_ok=True)

    frame = load_frame(args)
    print("Data: %s" % dataset.describe(frame))
    if args.synthetic:
        print(">>> FIXTURE: these numbers are a smoke test, not a result.")

    feat = features.compute_features(frame)
    print("Features: %s" % features.summarise(feat))

    trained = training.train_logistic(
        feat,
        l2=args.l2,
        calibration_method=args.calibration,
        run_feature_selection=not args.no_feature_selection,
        selection_k=args.selection_k,
        fraud_cost=args.fraud_cost,
        alert_cost=args.alert_cost,
        precision_target=args.precision_target,
    )

    payload = training.export_model(trained, os.path.join(args.outdir, "model-v1.json"),
                                    metadata={"source": "synthetic" if args.synthetic else args.csv,
                                              "rows": int(len(feat))})
    report_md = training.render_report(trained)
    with open(os.path.join(args.outdir, "logistic-report.json"), "w", encoding="utf-8") as fh:
        json.dump(trained.to_dict(), fh, indent=2, default=str)
    with open(os.path.join(args.outdir, "logistic-report.md"), "w", encoding="utf-8") as fh:
        fh.write(report_md + "\n")

    _plots(trained, args.outdir)

    print()
    print(report_md)
    print("Exported %d features, %d weights -> %s"
          % (len(payload["features"]), len(payload["weights"]),
             os.path.join(args.outdir, "model-v1.json")))
    return 0


def _plots(trained, outdir: str) -> None:
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception as exc:  # plotting is a nicety, not the deliverable
        print("(skipping plots: %s)" % exc)
        return

    y = trained.split.test["is_fraud"].astype(bool).to_numpy()
    p = trained.predict_proba(trained.split.test)
    p_raw = trained.model.predict_proba(features.features_to_matrix(trained.split.test))

    precision, recall, _ = metrics.precision_recall_curve(y, p)
    plt.figure(figsize=(6, 5))
    plt.plot(recall, precision, label="model (PR-AUC=%.3f, calibrated)" % metrics.average_precision(y, p))
    plt.plot(recall, metrics.precision_recall_curve(y, p_raw)[0], "--",
             label="model (uncalibrated)")
    plt.axhline(y.mean(), ls=":", c="grey", label="random (%.4f)" % y.mean())
    plt.xlabel("recall"); plt.ylabel("precision")
    plt.title("Precision–recall on the held-out final 20%")
    plt.legend(); plt.tight_layout()
    plt.savefig(os.path.join(outdir, "pr-curve.png"), dpi=120)
    plt.close()

    pred, obs, _ = metrics.calibration_curve(y, p, n_bins=10, strategy="quantile")
    pred_raw, obs_raw, _ = metrics.calibration_curve(y, p_raw, n_bins=10, strategy="quantile")
    plt.figure(figsize=(5, 5))
    plt.plot([0, 1], [0, 1], ls="--", c="grey", label="perfect")
    plt.plot(pred_raw, obs_raw, "s--", label="uncalibrated (ECE=%.3f)" %
             metrics.expected_calibration_error(y, p_raw))
    plt.plot(pred, obs, "o-", label="calibrated (ECE=%.3f)" %
             metrics.expected_calibration_error(y, p))
    plt.xlabel("predicted probability"); plt.ylabel("observed fraud rate")
    plt.title("Reliability diagram")
    plt.legend(); plt.tight_layout()
    plt.savefig(os.path.join(outdir, "reliability.png"), dpi=120)
    plt.close()


if __name__ == "__main__":
    raise SystemExit(main())
