### How good are the rules, actually?

_Source: `synthetic-demo` · n=20000 · positives=250 (1.250%) · generated 2026-10-11T09:45:40+00:00_

| metric | value |
|---|---|
| Precision | 0.039 |
| Recall | 0.832 |
| F1 | 0.074 |
| **PR-AUC (average precision)** | **0.2560** |
| ROC-AUC | 0.8798 |
| Log-loss (severity read as a probability) | 0.1770 |
| Calibration error (ECE) | 0.1084 |
| Flag rate | 26.725% |
| Accuracy | 0.7410 _(meaningless here)_ |

Confusion matrix (fraud = positive): `TP=208 FP=5137 FN=42 TN=14613`

**Per-rule precision and recall** — the half the detection endpoint cannot show:

| rule | fired | caught | false alarms | recall | precision |
|---|---:|---:|---:|---:|---:|
| `NEW_DEVICE_RULE` | 150 | 150 | 0 | 0.600 | 1.000 |
| `GEOGRAPHIC_ANOMALY_RULE` | 383 | 132 | 251 | 0.528 | 0.345 |
| `NIGHT_OWL_RULE` | 4986 | 48 | 4938 | 0.192 | 0.010 |
| `ENUMERATION_ATTACK_RULE` | 44 | 44 | 0 | 0.176 | 1.000 |
| `AMOUNT_THRESHOLD_RULE` | 14 | 11 | 3 | 0.044 | 0.786 |
| `VELOCITY_RULE` | 10 | 10 | 0 | 0.040 | 1.000 |

**Flaw 1, as a table** — averaging evidence is not monotone:

| fired rules | scores | average | status | log-odds | status |
|---|---|---|---|---|---|
| AMOUNT_THRESHOLD_RULE alone | [65] | 65 | review | 82 | blocked |
| AMOUNT_THRESHOLD + NIGHT_OWL | [65, 40] | 52 | review | 92 | blocked |
| IMPOSSIBLE_TRAVEL alone (GEO) | [80] | 80 | blocked | 90 | blocked |
| GEO + NIGHT_OWL | [80, 40] | 60 | review | 95 | blocked |
| GEO + NIGHT_OWL + VELOCITY + AMOUNT | [80, 40, 60, 65] | 61 | review | 100 | blocked |

_Notation: no city column -> GEOGRAPHIC_ANOMALY_RULE coverage limited_

_Guards: Labels come from disputes/dataset — never from rulesTriggered. Rules are evaluated on their live decision, not a re-tuned version._
