#!/usr/bin/env python
"""compare_models.py — the Phase 2 seven-model comparison.

    python compare_models.py --synthetic --n 40000
    python compare_models.py --csv data/canonical_sparkov.csv

Writes into ml/artifacts/:
    comparison.json / comparison.md   the table
    cv-comparison.json                k-fold vs stratified vs time-series
    naive-bayes.json                  the independence violation, measured
    gbm-v1.txt(+.meta.json)           the LightGBM artefact the sidecar loads
    id3-tree.txt                      the from-scratch tree, printed
"""

from __future__ import annotations

import argparse
import json
import os

from payguard_ml import compare, dataset, features, training


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--synthetic", action="store_true")
    source.add_argument("--csv")
    p.add_argument("--n", type=int, default=40_000)
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--skip-cv", action="store_true")
    p.add_argument("--skip-shap", action="store_true")
    p.add_argument("--outdir", default=os.path.join(os.path.dirname(__file__), "artifacts"))
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    os.makedirs(args.outdir, exist_ok=True)

    if args.synthetic:
        from payguard_ml.baseline import simulate_rule_engine
        frame = simulate_rule_engine(dataset.load_synthetic(n=args.n, seed=args.seed))
        print(">>> FIXTURE: these numbers are a smoke test, not a result.")
    else:
        import pandas as pd
        frame = pd.read_csv(args.csv, parse_dates=["timestamp"])

    print("Data: %s" % dataset.describe(frame))
    feat = features.compute_features(frame)
    print("Features: %s" % features.summarise(feat))

    result = compare.run_comparison(feat, seed=args.seed)
    report = compare.render_comparison(result)
    with open(os.path.join(args.outdir, "comparison.json"), "w", encoding="utf-8") as fh:
        json.dump({k: v for k, v in result.items() if k not in ("models", "calibrators")},
                  fh, indent=2, default=str)
    with open(os.path.join(args.outdir, "comparison.md"), "w", encoding="utf-8") as fh:
        fh.write(report + "\n")
    print()
    print(report)

    # --- ID3, printed so the from-scratch tree is inspectable -------------
    split = training.chronological_split(feat)
    id3 = compare.ID3Wrapper(max_depth=4, min_samples_split=40)
    id3.fit(features.features_to_matrix(split.train),
            split.train["is_fraud"].astype(int).to_numpy(),
            feature_names=list(features.FEATURE_NAMES))
    tree_text = id3.tree.export_text(max_lines=60)
    with open(os.path.join(args.outdir, "id3-tree.txt"), "w", encoding="utf-8") as fh:
        fh.write(tree_text + "\n")
    print("### ID3 (from scratch), depth 4\n")
    print(tree_text)
    print()

    if not args.skip_cv:
        cv = compare.cv_comparison(feat, seed=args.seed)
        with open(os.path.join(args.outdir, "cv-comparison.json"), "w", encoding="utf-8") as fh:
            json.dump(cv, fh, indent=2)
        cv_text = compare.render_cv(cv)
        print(cv_text)
        with open(os.path.join(args.outdir, "comparison.md"), "a", encoding="utf-8") as fh:
            fh.write("\n" + cv_text + "\n")

    # --- calibration before/after for the boosted winner ------------------
    lgbm = result["models"].get("lightgbm")
    if lgbm is not None:
        cal = compare.calibration_before_after(lgbm, split, is_tree=True)
        print("### Calibration before/after (lightgbm)\n")
        print(json.dumps(cal, indent=2))
        with open(os.path.join(args.outdir, "comparison.md"), "a", encoding="utf-8") as fh:
            fh.write("\n### Calibration before/after (lightgbm)\n\n```json\n%s\n```\n"
                     % json.dumps(cal, indent=2))

        # --- Naive Bayes: the independence violation, measured -----------
        nb_diag = compare.naive_bayes_diagnosis(feat, seed=args.seed)
        nb_text = compare.render_naive_bayes(nb_diag)
        with open(os.path.join(args.outdir, "naive-bayes.json"), "w", encoding="utf-8") as fh:
            json.dump(nb_diag, fh, indent=2)
        print(nb_text)
        with open(os.path.join(args.outdir, "comparison.md"), "a", encoding="utf-8") as fh:
            fh.write("\n" + nb_text + "\n")

        if not args.skip_shap:
            X_test = features.features_to_matrix(split.test)
            contrib = compare.shap_top_contributions(lgbm, X_test, features.FEATURE_NAMES, k=5)
            print("\n### SHAP top-5 for one scored transaction\n")
            for c in contrib:
                print("  %-32s value=%-10.4g shap=%+.4f" % (c["feature"], c["value"], c["shap"]))
            with open(os.path.join(args.outdir, "shap-example.json"), "w", encoding="utf-8") as fh:
                json.dump(contrib, fh, indent=2)

        # Artefact the ml-service sidecar reloads.
        meta = compare.save_lightgbm_for_sidecar(
            lgbm, features.FEATURE_NAMES,
            os.path.join(args.outdir, "gbm-v1.txt"),
            metadata={"source": "synthetic" if args.synthetic else args.csv,
                      "rows": int(len(feat)),
                      "test_pr_auc": next((r["pr_auc"] for r in result["results"]
                                           if r["model"] == "lightgbm"), None)},
        )
        print("\nSaved sidecar artefact: %s (%s)"
              % (os.path.join(args.outdir, "gbm-v1.txt"), meta["format"]))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
