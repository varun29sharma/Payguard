#!/usr/bin/env python
"""run_baseline.py — produce the honest rule baseline, three ways.

    # 1. Smoke-test the reporting path with no data and no server (synthetic).
    python run_baseline.py --synthetic --n 20000

    # 2. The real thing: replay a labelled dataset through PayGuard, then score.
    python run_baseline.py --replay-csv data/sparkov.csv --kind sparkov \
        --limit 50000 --base-url http://localhost:3000 --api-key "$PAYGUID_API_KEY"

    # 3. Or read an existing export (GET /api/transactions/export) directly.
    python run_baseline.py --export-csv data/export.csv

Option 1 is a fixture and is labelled `synthetic-demo`; its numbers are not
results. Options 2 and 3 produce the number the README quotes.
"""

from __future__ import annotations

import argparse
import os
import sys

from payguard_ml import baseline, dataset, metrics, replay


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    source = p.add_mutually_exclusive_group(required=True)
    source.add_argument("--synthetic", action="store_true",
                        help="run the no-server smoke test (not a result)")
    source.add_argument("--replay-csv", help="labelled CSV to replay through the API")
    source.add_argument("--export-csv", help="PayGuard transactions export to score")

    p.add_argument("--kind", choices=dataset.DATASET_KINDS, default="sparkov")
    p.add_argument("--n", type=int, default=20_000, help="rows for --synthetic")
    p.add_argument("--limit", type=int, default=None, help="replay only the earliest N rows")
    p.add_argument("--device-mode", choices=("null", "synthetic"), default="null",
                   help="how to fill identifiers the dataset lacks (default: honest null)")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--base-url", default=os.environ.get("PAYGUID_URL", "http://localhost:3000"))
    p.add_argument("--api-key", default=os.environ.get("PAYGUID_API_KEY"))
    p.add_argument("--sleep-ms", type=float, default=0.0)
    p.add_argument("--outdir", default=os.path.join(os.path.dirname(__file__), "artifacts"))
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    os.makedirs(args.outdir, exist_ok=True)
    json_path = os.path.join(args.outdir, "baseline.json")
    md_path = os.path.join(args.outdir, "baseline.md")

    if args.synthetic:
        print("Running the SYNTHETIC smoke test (numbers are not results).")
        result = baseline.demo_baseline(n=args.n, seed=args.seed)
    elif args.export_csv:
        print("Scoring an existing PayGuard export: %s" % args.export_csv)
        result = baseline.baseline_from_export(args.export_csv)
    else:
        if not args.api_key:
            print("error: --replay-csv needs --api-key (or PAYGUID_API_KEY in the "
                  "environment). Create one via POST /api/keys.", file=sys.stderr)
            return 2
        print("Mapping %s as kind=%s (device_mode=%s) ..."
              % (args.replay_csv, args.kind, args.device_mode))
        frame = dataset.load_csv(args.replay_csv, kind=args.kind,
                                 device_mode=args.device_mode, limit=args.limit)
        print("  %s" % dataset.describe(frame))
        transactions = _frame_to_transactions(frame)
        replay.assert_chronological(transactions)
        client = replay.ReplayClient(base_url=args.base_url, api_key=args.api_key)
        print("Replaying through %s ..." % args.base_url)
        report = replay.replay_transactions(transactions, client,
                                            limit=None, sleep_ms=args.sleep_ms)
        print("  %s" % report.to_dict())
        # These two checks are Phase 0's "Verification" checkbox.
        replay.verify_timestamp_roundtrip(report)
        replay.assert_no_label_from_rules(report.outcomes)
        result = baseline.baseline_from_replay(report)

    baseline.write_reports(result, json_path=json_path, markdown_path=md_path)
    print()
    print(metrics.format_report({**result.metrics, "n": result.n,
                                 "positives": result.positives,
                                 "prevalence": result.prevalence}))
    print()
    print(baseline.render_markdown(result))
    print("Wrote %s and %s" % (json_path, md_path))
    return 0


def _frame_to_transactions(frame):
    """Rehydrate canonical transactions from a canonical DataFrame."""
    from payguard_ml.schema import CanonicalTransaction

    out = []
    for _, row in frame.iterrows():
        out.append(CanonicalTransaction(
            transactionId=row["transactionId"],
            userId=row["userId"],
            merchantId=row["merchantId"],
            amount=float(row["amount"]),
            currency=row.get("currency") or "INR",
            timestamp=row["timestamp"].to_pydatetime()
            if hasattr(row["timestamp"], "to_pydatetime") else row["timestamp"],
            city=row.get("city"),
            lat=_maybe_float(row.get("lat")),
            lng=_maybe_float(row.get("lng")),
            is_fraud=bool(row["is_fraud"]),
            source=str(row.get("source") or "unknown"),
            deviceId=row.get("deviceId") if isinstance(row.get("deviceId"), str) else None,
            beneficiaryId=row.get("beneficiaryId") if isinstance(row.get("beneficiaryId"), str) else None,
        ))
    return out


def _maybe_float(value):
    try:
        if value is None or value != value:  # NaN
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    raise SystemExit(main())
