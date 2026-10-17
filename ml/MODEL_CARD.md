# Model Card — PayGuard fraud scoring

> **Status: scaffold.** Phase 0 has no model yet. Every field below is filled
> in as phases complete and must never be left as a bare point estimate: a
> single PR-AUC from one test split is an estimate with real uncertainty, and
> reporting it bare is overclaiming. Bootstrap intervals (see
> `payguard_ml.metrics.bootstrap_ci`) are mandatory.

The framing follows the standard model-card structure, narrowed to what matters
for a payments decision. It is deliberately written in the README's voice: a
model that cannot say what it does *not* do is exactly the kind of system
PayGuard exists to avoid.

---

## 1. Model details

| field | value |
|---|---|
| Model name | _(Phase 1: `logistic-v1`)_ |
| Version / artefact | _(Phase 1: `fraud-engine/src/main/resources/model-v1.json`)_ |
| Type | _(Phase 1: L2-regularised logistic regression, calibrated)_ |
| Trained by | PayGuard ML pipeline (`ml/train.py`) |
| Trained at | _pending_ |
| Deployment mode | **shadow** — records `mlScore`, does not decide |

## 2. Intended use

**Primary use.** Produce a calibrated probability that a transaction is
confirmed fraud, alongside the existing rule score, to (a) rank the analyst
review queue and (b) eventually replace the rules' mathematically-wrong
*average* aggregation with an evidence-accumulating one.

**Who consumes it.** The `04 ALERTS` queue and the `13 MODELS` screen. In
shadow mode: analysts see the score and the top contributions, but rules still
decide.

**Intended users.** Fraud analysts and engineers at a payments operator.

## 3. Out-of-scope use

Explicitly **not** intended for, and not to be relied upon for:

- **Automatic blocking** without human review or a confirmed manual backtest.
  Shadow mode exists precisely so trust is earned before power is granted.
- **Decisions about individuals' identity or creditworthiness.** This model
  scores *transactions*, not people.
- **Any population materially different from the training distribution.**
  Drift monitoring (Phase 6) is the check; its absence is a reason not to use
  the model, not a caveat.
- **Jurisdictions or rails whose transaction patterns are absent from
  training.** A model trained on card-present behaviour says nothing reliable
  about, say, wallet-to-wallet transfers.

## 4. Training data

| field | value |
|---|---|
| Source | _pending — Sparkov / PaySim / internal disputes_ |
| Rows | _pending_ |
| Date span | _pending_ |
| Fraud rate | _pending_ |
| Label provenance | **external disputes only.** Labels are never derived from `rulesTriggered` — see the `assert_no_label_from_rules` guard. |
| Fabricated fields | _pending — e.g. `deviceId` is absent from Sparkov; if synthesised, say so here and exclude it from reported results._ |
| Known biases | Real card-fraud datasets under-represent some rails and geographies; transactions with no device/IP field cannot be scored on those features. |

## 5. Features

_Pending. Must record the feature count, the point-in-time guarantee, and the
leakage test that enforces it (`ml/tests/test_leakage.py`)._

## 6. Metrics

All metrics accompanied by a **bootstrapped 95% CI** on the test split. PR-AUC
is the headline; accuracy is reported only to be explicitly dismissed.

| metric | value | 95% CI | notes |
|---|---|---|---|
| PR-AUC (average precision) | _pending_ | _pending_ | headline |
| ROC-AUC | _pending_ | _pending_ | reported, not headline |
| Precision @ operating threshold | _pending_ | _pending_ | threshold chosen from a cost model |
| Recall @ operating threshold | _pending_ | _pending_ | |
| Log-loss | _pending_ | — | |
| Expected calibration error | _pending_ | — | reliability diagram in `ml/artifacts/` |
| p99 inference latency | _pending_ | — | budget from Phase 2 |

### Subgroup performance

_Pending. Break down by amount band, city tier, merchant category, and
new-vs-returning user. State where the model underperforms rather than
aggregating the gap away._

## 7. Known failure modes

- **Cold start.** A user's first transaction has no behavioural history. The
  model must record which fallback was used (population profile vs cohort
  profile) — honesty about degraded input, not a silent guess.
- **Drift.** The realistic failure is not an error but a model that stays
  confident as the world moves. `MODEL: DRIFTING` (Phase 6) names the drifted
  features.
- **Calibration decay.** Predicted probabilities can stop matching observed
  fraud rates while the ranking still looks fine. Rolling reliability
  monitoring from dispute labels is the check.
- **Label censoring.** A fraud we block is never confirmed by a chargeback,
  so the model never learns whether it was right about exactly the cases it
  acted on. This is a selection-bias limit on every metric in section 6.
- **Blast radius.** If a score ever feeds the identity-graph cascade, one
  false positive can freeze accounts belonging to people who only shared an
  IP. Phase 6 computes and displays that radius before executing.

## 8. Ethical considerations

A false positive is not an inconvenience; in UPI it can be someone's rent or
medicine. Every threshold decision trades fraud loss against that harm, so the
cost model is written down and the analyst-capacity constraint is explicit
rather than hidden inside a default of 0.5.

## 9. What this model explicitly does not do

- It does not decide. In shadow mode it only records an opinion.
- It does not explain its own confidence beyond feature contributions; a
  calibrated probability means "0.8 means 80% of these turned out fraudulent",
  nothing more.
- It does not handle novelty. Catching an attack pattern it has never seen is
  Phase 4's per-user anomaly layer, not this model's job.
- It does not generalise across rails, currencies or populations without
  re-validation.
