### The model that wins

_Chronological split: train 24000 · val 8000 · test 8000 (fraud 1.688% in test)_

| model | PR-AUC | ROC-AUC | precision | recall | F1 | log-loss | ECE | p99 ms | size KB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `random_forest` | 0.9414 | 0.9986 | 0.777 | 0.904 | 0.836 | 0.0107 | 0.0010 | 14.28 | 1681 |
| `adaboost` | 0.9414 | 0.9984 | 0.953 | 0.896 | 0.924 | 0.0107 | 0.0013 | 15.22 | 109 |
| `xgboost` | 0.9392 | 0.9948 | 0.152 | 0.993 | 0.264 | 0.0124 | 0.0018 | 0.42 | 572 |
| `lightgbm` | 0.9391 | 0.9971 | 0.107 | 1.000 | 0.194 | 0.0111 | 0.0016 | 0.40 | 1028 |
| `id3_from_scratch` | 0.9212 | 0.9868 | 0.413 | 0.956 | 0.577 | 0.0178 | 0.0022 | 0.01 | 3 |
| `logistic_regression` | 0.9192 | 0.9976 | 0.440 | 0.985 | 0.609 | 0.0581 | 0.0314 | 0.07 | 1 |
| `decision_tree_sklearn` | 0.7875 | 0.9309 | 0.477 | 0.844 | 0.610 | 0.0812 | 0.0184 | 0.06 | 5 |
| `naive_bayes` | 0.7495 | 0.9944 | 0.432 | 0.941 | 0.592 | 0.3438 | 0.0298 | 0.07 | 1 |
| `rules (baseline)` | 0.0169 | 0.5000 | 0.000 | 0.000 | 0.000 | 0.2331 | 0.0169 | 0.01 | 1 |

Best by PR-AUC: **random_forest** — but read the p99 and size columns before believing it is free.

- `random_forest`: ECE 0.0102 before calibration, 0.0010 after (PR-AUC 0.9574 → 0.9414 — monotone calibration reorders nothing)
- `adaboost`: ECE 0.3276 before calibration, 0.0013 after (PR-AUC 0.9707 → 0.9414 — monotone calibration reorders nothing)
- `xgboost`: ECE 0.0017 before calibration, 0.0018 after (PR-AUC 0.9666 → 0.9392 — monotone calibration reorders nothing)
- `lightgbm`: ECE 0.0019 before calibration, 0.0016 after (PR-AUC 0.9651 → 0.9391 — monotone calibration reorders nothing)


### Calibration before/after (lightgbm)

```json
{
  "before": {
    "ece": 0.00188370899993719,
    "log_loss": 0.013607938552710412,
    "pr_auc": 0.9651398809922036
  },
  "after": {
    "ece": 0.0016351756032079853,
    "log_loss": 0.011103107039492495,
    "pr_auc": 0.9391443981469649
  },
  "note": "isotonic is monotone, so PR-AUC is ~unchanged while calibration improves \u2014 ranking and probability are different jobs"
}
```

### Naive Bayes, and why the independence assumption costs it

**The assumption:** features are conditionally independent given the class — for each feature, P(x_i | y) is estimated as if no other feature existed

| | PR-AUC | log-loss | ECE | share p<0.01 or p>0.99 | mean &#124;log-odds&#124; |
|---|---:|---:|---:|---:|---:|
| Naive Bayes | 0.7495 | 0.3438 | 0.0298 | 99.1% | 26.6 |
| logistic (reference) | 0.9570 | 0.0540 | 0.0273 | 81.8% | 8.0 |

Log-loss here is **6.4× worse** than the linear reference. Note the ECE column barely moves: ECE averages error over bins; when nearly all predictions fall in the two extreme bins it understates the damage, so log-loss and the extreme share are the load-bearing numbers.

**Correlation within class** (the assumption is about features *given the label*):

| class | rows | max &#124;r&#124; | mean &#124;r&#124; | strongest pair |
|---|---:|---:|---:|---|
| fraud | 261 | 1.000 | 0.243 | `is_night` ↔ `rule_night_owl` (r = +1.000) |
| legit | 23739 | 1.000 | 0.077 | `is_night` ↔ `rule_night_owl` (r = +1.000) |

**Duplicate columns** (|r| ≈ 1 within class) — a feature-set defect, not just an NB problem: the same fact reaches the model twice, so any per-feature attribution splits one effect across two names.

- `is_night` ↔ `rule_night_owl` (r = +1.000)
- `user_txn_count_24h` ↔ `user_distinct_merchants_24h` (r = +0.999)

**The ablation:** collapse each correlated cluster to one representative, refit, and compare against removing the same *number* of the least redundant features (`merchant_dispute_rate_asof`, `is_weekend`, `rule_velocity`, `rule_amount_threshold`, `hour_sin`, `hour_cos`, `amt_ratio_user_mean`, `rule_new_device`). Same count leaves in each arm, so the only difference is whether what left was redundant.

| variant | PR-AUC | log-loss | ECE |
|---|---:|---:|---:|
| all features | 0.7495 | 0.3438 | 0.0298 |
| minus correlated (`user_txn_count_24h`, `user_distinct_merchants_24h`, `log_seconds_since_prev`, `merchant_amt_percentile`, `log_amount`, `user_txn_count_1h`, `user_txn_count_7d`, `user_distinct_devices_7d`) | 0.7601 | 0.2071 | 0.0222 |
| minus equally many uncorrelated | 0.3573 | 0.5198 | 0.0494 |

The comparison that means something is the last two rows, not the first column: the same *number* of features leaves in each, so the only difference is whether the ones that left were correlated.

**So what:** Naive Bayes' conditional-independence assumption is violated here. Its evidence is multiplied once per *feature* instead of once per *fact*, so 99.1% of its predictions land below 0.01 or above 0.99 (logistic: 81.8%) and its mean |log-odds| is 26.6 against logistic's 8.0. The cost shows up in log-loss (0.3438 vs 0.0540, 6.4× worse) more than in ECE (0.0298 vs 0.0273), because ECE averages over bins and most of its mass is in the same two bins. The ablation isolates the double-counting: dropping one feature from each strongly correlated pair gives log-loss 0.2071, while dropping the same number of *uncorrelated* features gives 0.5198. Removing redundant evidence helps more than removing independent evidence, which is what a double-count looks like.

