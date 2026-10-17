### Logistic regression vs the rules

_Chronological split: train 18000 rows (fraud 1.139%) · val 6000 (1.283%) · test 6000 (1.550%)_

| metric | uncalibrated | calibrated |
|---|---|---|
| pr_auc | 0.9362 | 0.9362 |
| roc_auc | 0.9967 | 0.9967 |
| precision | 0.0155 | 0.4378 |
| recall | 1.0000 | 0.9462 |
| f1 | 0.0305 | 0.5986 |
| log_loss | 0.2128 | 0.0128 |
| brier | 0.0409 | 0.0030 |
| ece | 0.1837 | 0.0022 |

PR-AUC 95% CI (bootstrap): [0.8905, 0.9675]

Operating threshold **0.0239** chosen by *precision_target* (cost model: 130100, precision target: 0.023920773532735157)

**What we guessed vs what the data says** (learned coefficient on each rule flag):

| rule | hardcoded severity | learned coefficient | verdict |
|---|---:|---:|---|
| `NEW_DEVICE_RULE` | 55 | +2.364 | strong |
| `ENUMERATION_ATTACK_RULE` | 75 | +0.822 | useful |
| `GEOGRAPHIC_ANOMALY_RULE` | 80 | +0.764 | useful |
| `VELOCITY_RULE` | 60 | +0.294 | weak |
| `AMOUNT_THRESHOLD_RULE` | 65 | +0.099 | weak |
| `NIGHT_OWL_RULE` | 40 | +0.010 | weak |

**Learning curve** (train vs val PR-AUC against training size):

| train rows | train PR-AUC | val PR-AUC | gap |
|---:|---:|---:|---:|
| 1800 | 0.6752 | 0.8756 | -0.2003 |
| 4500 | 0.7673 | 0.8640 | -0.0967 |
| 9000 | 0.8217 | 0.8467 | -0.0250 |
| 13500 | 0.8485 | 0.8543 | -0.0057 |
| 18000 | 0.8410 | 0.8601 | -0.0191 |

