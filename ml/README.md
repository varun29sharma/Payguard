# `ml/` — the PayGuard ML workspace

A fourth top-level component, parallel to `client/`, `server/` and
`fraud-engine/`. It holds everything that turns PayGuard from a rules engine
into a measured fraud-intelligence platform: the data pipeline, the from-scratch
models, the evaluation reports, and the experiment log.

The rule it operates under, from `ROADMAP-AIML.md`:

> Everything here is measured against an **honest** baseline. Labels come from
> outside the rule engine. Aggregates never see the future. If a number cannot
> state where it came from, it does not get reported.

---

## Layout

```
ml/
├── payguard_ml/
│   ├── schema.py       external dataset row -> POST /api/transactions body
│   ├── dataset.py      Sparkov / PaySim / synthetic loaders -> canonical frame
│   ├── replay.py       drive the ingest + dispute APIs chronologically
│   ├── metrics.py      confusion matrix, PR/ROC, calibration — from scratch
│   ├── baseline.py     the honest rule baseline + Flaw 1 counterexample
│   ├── features.py     point-in-time features (no future leakage)   [Phase 1]
│   ├── logistic.py     logistic regression from scratch (GD + Newton) [Phase 1]
│   ├── calibration.py  Platt / isotonic + reliability diagrams      [Phase 1]
│   ├── trees.py        ID3 from scratch                             [Phase 2]
│   ├── compare.py      seven-model comparison on one split          [Phase 2]
│   └── rulelogic.py    resolution-refutation rule checks            [Phase 3]
├── search/             UNIT-I search algorithms (BFS…A*, IDA*)      [Phase 3]
├── notebooks/          00-baseline.ipynb, …
├── tests/              pytest — the guard on every advertised number
├── scripts/            run_baseline.py, run_training.py, …
├── artifacts/          generated reports/plots (gitignored)
├── data/               raw datasets (gitignored — they are large)
├── EXPERIMENTS.md      one entry per model: split, metric, lesson
├── MODEL_CARD.md       provenance, intended use, metrics, failure modes
└── requirements.txt
```

## Setup

```bash
cd ml
python3 -m venv --system-site-packages .venv   # inherit numpy/pandas/xgboost
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m pytest                   # 89 tests, ~2s
```

The venv uses `--system-site-packages` because the heavy scientific stack
(numpy, pandas, scikit-learn, xgboost, lightgbm) is often already present at
the system level and reinstalling it wastes minutes on every fresh checkout.
If your system Python is bare, drop the flag and install everything from
`requirements.txt`.

## Getting real data

Neither Kaggle dataset is committed (they are hundreds of MB). Download into
`ml/data/`:

| dataset                                                  | where                             | how it is used                                                                                                                                                                       |
| -------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sparkov** — "Credit Card Transactions Fraud Detection" | Kaggle (Brandon Harris generator) | Phase 0 baseline + Phase 1 features. Maps field-for-field onto PayGuard's schema, and carries `merch_lat`/`merch_long` so a real merchant-distance feature is possible.              |
| **PaySim** — synthetic mobile money                      | Kaggle                            | Phase 4 ring discovery + mule-detector validation. `nameOrig -> nameDest` becomes `userId -> beneficiaryId`, so its `isFraud` is ground truth for a detector that has never had any. |
| **IEEE-CIS**                                             | Kaggle (Vesta)                    | Phase 2, for stress-testing feature engineering against a hard leaderboard.                                                                                                          |

**Verify the column names against the dataset page before building a loader.**
`payguard_ml/schema.py` documents the mapping it expects; if a column differs,
adjust the mapping, not the plan.

### No data / no time? Use the synthetic fixture

```bash
./.venv/bin/python run_baseline.py --synthetic --n 20000
```

This is a **smoke test, not a result.** Its labels come from a latent
data-generating process (card-testing bursts, geo-hops, takeovers, mule
cash-outs) and never from the rules — which is the whole point — but the
distribution is tidy and the numbers are labelled `synthetic-demo` everywhere
they appear so they cannot be mistaken for findings.

## Running the honest baseline

```bash
# 1. bring up fraud-engine + server + mongo, then create an API key
# 2. replay the dataset through the real ingest path and read the baseline
./.venv/bin/python run_baseline.py \
    --replay-csv data/sparkov.csv --kind sparkov --limit 50000 \
    --base-url http://localhost:3000 --api-key "$PAYGUID_API_KEY"
```

What that does, and why it is the right shape:

1. **Maps** each row to a `POST /api/transactions` body (`schema.py`).
2. **Replays chronologically with real timestamps** through the API-key machine
   ingest path — the same four-step pipeline as live traffic, scored by the real
   Java engine with the live rule config.
3. **Feeds labels back as disputes** (`reason: unauthorized`), so
   `disputeService` sets `isConfirmedFraud` from external truth. The
   circularity is broken using endpoints that already existed.
4. **Verifies** that replayed timestamps match the source (the Phase 0
   prerequisite), that the replay was chronological, and that no label came
   from `rulesTriggered` — then computes confusion matrix, precision, recall,
   F1, PR-AUC, ROC-AUC, calibration error, and per-rule precision/recall.

Output lands in `ml/artifacts/baseline.{json,md}`; the markdown is designed to
be pasted straight into the README.

## The tests are the guard on every number

`ml/tests/` is not decoration. `test_metrics.py` asserts the from-scratch
metrics equal scikit-learn's to 1e-9 — if they ever disagree, the headline
number in the README is wrong. `test_baseline.py` asserts the averaging flaw
still reproduces, so nobody "fixes" the Java without understanding it.
`test_leakage.py` (Phase 1) deletes every row after a transaction and asserts
the feature vector is byte-identical.
