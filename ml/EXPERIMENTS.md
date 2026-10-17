# EXPERIMENTS — the running log

> One entry per trained model: the split, the metric, and **one line on what it
> taught us**. The roadmap is explicit that this file is the only reliable
> defence against the "wait, was that number from the version with leakage?"
> problem that eats weeks, so nothing gets recorded here without its
> provenance.

**Conventions**

- Every number is reported with its **source** (`synthetic`, `sparkov`,
  `paysim`) and its **split** (chronological by default — random splits are
  never valid here).
- `PR-AUC` means step-wise average precision (`payguard_ml.metrics.average_precision`),
  tested equal to `sklearn.metrics.average_precision_score`. ROC-AUC is
  reported alongside but is **not** the headline.
- Numbers whose source is `synthetic` are pipeline smoke-tests and must not be
  quoted in the README as results.
- Negative results are entries too. A feature that didn't help is a finding.

---

## 2026-10-11 — Phase 0 harness stood up

**What was built.** `payguard_ml.{schema,dataset,replay,metrics,baseline}`:
external dataset → ingest body mapping, chronological replay through the
API-key ingest path with labels fed back as disputes, from-scratch evaluation
metrics, and the rule-baseline report.

**Verification run**

| check | result |
|---|---|
| `pytest ml/tests` | 89 passed |
| metrics vs sklearn (AP, ROC-AUC, log-loss, precision/recall/F1) | equal to 1e-9 |
| replay dry-run: chronological? | yes (asserted) |
| replay dry-run: timestamp round-trip? | 0 ms drift (asserted) |
| replay dry-run: label derived from `rulesTriggered`? | no (asserted) |

**Learned.** The timestamp prerequisite is the whole phase. A dry run can only
prove the *mapping* is correct; proving the *ingest* keeps the timestamp needs
a real replay, which is why `verify_timestamp_roundtrip` compares the timestamp
in the POST response against the one we sent rather than trusting the code.

**Not yet done.** The real baseline number requires either a Kaggle download
(Sparkov) or a running `fraud-engine + server + mongo` stack to replay into.
The command is:

```bash
# 1. bring the stack up, create an API key, then:
cd ml && ./.venv/bin/python run_baseline.py --replay-csv data/sparkov.csv \
    --kind sparkov --limit 50000 --api-key "$PAYGUID_API_KEY"
```

Until that runs, the "How good are the rules, actually?" table in the README
carries an explicit `PENDING — needs real data` marker rather than a synthetic
number dressed up as a result.

---

## Template

```
## YYYY-MM-DD — <model / experiment name>

**Data.** source, rows, date span, fraud rate, device mode
**Split.** train/val/test boundaries by date; CV scheme if any
**Features.** count + notable ones; anything purposefully excluded and why
**Model.** algorithm + hyperparameters
**Results.** table (PR-AUC headline, precision@threshold, recall@threshold,
  log-loss, ECE, p99 latency, model size)
**Verdict.** ship / reject / needs work — in one sentence
**Learned.** one line. If it didn't teach anything, it doesn't belong here.
**Artifacts.** paths under ml/artifacts/
```
