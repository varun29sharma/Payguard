# `ml-service/` — the model sidecar

A fourth service (FastAPI, port 8000), added in Phase 2 for one reason: **a
boosted forest does not export to a JSON of weights.** Phase 1's logistic model
is a vector of numbers and runs inside the Java engine with no new
infrastructure. The Phase 2 winner is a LightGBM booster, so it needs a process.

## Run

```bash
cd ml-service
python3 -m venv --system-site-packages .venv
./.venv/bin/pip install -r requirements.txt
ML_MODEL_PATH=../ml/artifacts/gbm-v1.txt ./.venv/bin/uvicorn app:app --port 8000
```

The artefact is produced by the offline pipeline:

```bash
cd ml && ./.venv/bin/python compare_models.py --csv data/canonical_sparkov.csv
```

## Endpoints

| method | path | purpose |
|---|---|---|
| `GET` | `/health` | readiness, model version, feature count, whether explanations and the rule checker are available |
| `POST` | `/score` | one vector → calibrated probability + top-5 SHAP contributions |
| `POST` | `/score/batch` | many vectors (offline rescoring) |
| `POST` | `/rules/consistency` | Phase 3: static analysis of a rule set — dead configurations, vacuous rules, subsumption |

### Why `/rules/consistency` lives here

The rule checker (`ml/payguard_ml/rulelogic.py`) is pure standard library — no
model, no numpy — so it does not *need* this service. It is reached through the
sidecar for the same reason features are not recomputed here: the checker the
product runs is then the exact code the offline tests exercise. A JavaScript
reimplementation would be a second implementation of a rule, free to drift from
the first.

Consequently the endpoint answers **independently of the model**: it does not
check that an artefact loaded (the engine's defaults are still worth checking on
a machine with no model) and it reports `available: false` with a reason when it
cannot run. It never returns an empty issue list as a substitute for an answer —
a silent all-clear on a fraud rule that can never fire is the failure this
feature exists to prevent.

## The design rules it inherits

- **Features are not computed here.** Node computes them once and sends the
  vector. A sidecar that recomputed features would be a second implementation of
  the contract and a second chance to drift.
- **Nothing here can block an authorisation.** Every failure is a 503 (or a 422
  on a feature-length mismatch), and the Node caller records
  `mlEngine='fallback'` and continues. The same honesty pattern as
  `ENGINE: FALLBACK` in the dashboard.
- **Every score arrives with reasons.** TreeSHAP contributions are returned with
  each score, so the Alerts screen can say *why* — the promise the product
  already makes for rules, kept for a black-box model.

## Verified behaviour

```bash
curl -s localhost:8000/health
# {"ready":true,"reason":null,"version":"gbm-v1","featureCount":25,"explainable":true,...}

curl -s -X POST localhost:8000/score -H 'content-type: application/json' \
  -d '{"features": [ ...25 numbers... ]}'
# {"probability":0.97,"version":"gbm-v1","engine":"model","contributions":[...]}
```
