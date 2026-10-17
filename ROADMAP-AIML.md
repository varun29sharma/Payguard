# PayGuard × AIML — the roadmap

**From a rules engine to a calibrated, honest, measured fraud-intelligence platform — while mastering the AIML syllabus and CS229 along the way.**

Written 2026-08-26. Budget: **10–15 hrs/week for ~26 weeks** (≈310 focused hours). Seven phases.

---

## Table of contents

1. [Read this first](#read-this-first)
2. [The two flaws that are your whole opportunity](#the-two-flaws)
3. [Five bugs found while reading the code](#five-bugs-found-while-reading-the-code)
4. [Why PayGuard is a rare ML testbed](#why-payguard-is-rare)
5. [The honest scope conversation](#the-honest-scope-conversation)
6. [How the syllabus maps to the build](#syllabus-map)
7. [CS229 lecture map](#cs229-map)
8. [The weekly rhythm](#the-weekly-rhythm)
9. [Phase 0 — Honest data and a baseline you trust](#phase-0)
10. [Phase 1 — Logistic regression replaces the average](#phase-1)
11. [Phase 2 — Trees, ensembles, and the model that wins](#phase-2)
12. [Phase 3 — Exam consolidation and the AI units](#phase-3)
13. [Phase 4 — Unsupervised: catching the unknown](#phase-4)
14. [Phase 5 — Deep learning where it earns its place](#phase-5)
15. [Phase 6 — The honesty layer, and ship it](#phase-6)
16. [The interview layer](#the-interview-layer)
17. [Failure modes to avoid](#failure-modes)
18. [What to cut if you fall behind](#what-to-cut)

---

## Read this first

You are in a better position than you probably realise, and the reason is not the React dashboard or the Java microservice. It is this paragraph, which you already wrote in your own README:

> **The rules are heuristics, not models** — they catch known patterns brilliantly. Per-user behavioral baselines (ML anomaly scoring) are the natural next layer, and the tasting room + health inspector are the harness to prove them before they ship.

You diagnosed the gap and, without necessarily meaning to, you built the scaffolding that ML needs before you built the ML. Most people do it the other way round: they train a model in a notebook, get an AUC, and have nowhere to put it. You have somewhere to put it, a way to prove it, and a design philosophy that will make it good.

So this roadmap is not "learn ML, then bolt a model onto PayGuard." It is one project. Every algorithm in the syllabus gets learned because a specific part of PayGuard needs it, and the parts that PayGuard genuinely doesn't need are marked exam-only rather than dressed up as features. Decorative ML is worse than no ML — an interviewer can smell it, and you'll know it too.

---

## The two flaws

Two things in the current codebase are wrong. Both are excellent news, because a project whose ML layer *fixes a real, demonstrable flaw* is worth ten projects whose ML layer is an unmotivated `model.predict()`.

### Flaw 1: averaging rule scores means more evidence can mean less suspicion

In `fraud-engine/src/main/java/com/payguard/fraud_engine/service/FraudScoringService.java`:

```java
int finalScore = triggered.isEmpty() ? 0 : (int) triggered.stream()
        .mapToInt(FraudResult.RuleResult::getScore)
        .average()
        .orElse(0);
```

The final score is the **mean** of every rule that fired. Work through what that implies.

A ₹2,50,000 transaction fires `AMOUNT_THRESHOLD_RULE` alone: score 65 → `review`. Now suppose the same transaction *also* happens at 3 AM, so `NIGHT_OWL_RULE` (40) fires too. The new score is (65+40)/2 = 52.5, truncated by the `(int)` cast to **52**. More evidence of fraud, lower score. Add a third weak signal and it drops further.

The pathological case is sharper. Impossible travel (80) alone → **blocked**. Impossible travel plus night-owl → (80+40)/2 = 60 → **review**. A rule firing has moved the transaction into a strictly more permissive band. Your README's worked example even brushes past this: it notes that had the after-hours checker fired too "the average would climb toward blocked," but with an 80/55/65 mix at 66, adding a 40 gives 240/4 = 60 — it drops.

One precision note, since a reviewer will check: `fraudStatus: 'blocked'` is currently a *label plus an alert*, not a declined authorisation. Both `review` and `blocked` commit the transaction and return 201; the only genuine 403 is a blocklist hit. So the cost of this flaw today is misrouted triage and a distorted risk ordering rather than fraud being let through a gate that should have stopped it. That's still a real cost — the whole point of the score is to rank what an analyst looks at — but describe it accurately rather than dramatically. (It also means that if you ever *do* wire `blocked` to a decline, this bug becomes a live money bug. Fixing it first is the right order.)

This isn't a bug you can patch with better thresholds. It's the wrong aggregation function. Evidence should **accumulate**, and the mathematically correct way to accumulate independent evidence is to add log-odds, not average scores:

```
log( P(fraud) / P(not fraud) )  =  b + w₁x₁ + w₂x₂ + ... + wₙxₙ
```

where `xᵢ` is 1 if rule *i* fired and `wᵢ` is the **learned** weight of that rule's evidence. Push that sum through a sigmoid and you get a probability. Each additional firing rule with a positive weight can only increase the score. That is logistic regression, it is CS229 Lecture 3, and it is a drop-in replacement for **four lines of Java**.

The weights being *learned* matters too. Right now the numbers 65, 60, 75, 80, 55, 40 are somebody's guesses. After Phase 1 they are estimates from data about how much each signal actually predicts confirmed fraud. You will very likely discover that `NIGHT_OWL_RULE` is nearly worthless (lots of legitimate late-night UPI activity in India) while `GEOGRAPHIC_ANOMALY_RULE` is worth far more than 80 implies. Finding that out and being able to prove it is the project.

### Flaw 2: the simulator's data cannot train anything

`client/src/pages/Simulator.jsx` generates transactions like this:

```js
case 'enumeration': return { ...base, userId: 'USER_1', amount: Math.random() * 10 + 1 };
case 'high_amount': return { ...base, amount: Math.floor(Math.random() * 200000) + 50000 };
```

The simulator produces exactly the patterns the six rules were written to catch. If you train a model on simulator traffic and take your labels from the rules that fired, you have built a circular system: the model learns to imitate the rules, scores ~0.99 AUC, and has learned nothing about fraud. You will have measured your rules against themselves.

This is the single most common fatal flaw in student fraud-detection projects, and it is the first thing a sharp interviewer probes: *"where did your labels come from?"* If the answer is "the heuristic I'm trying to beat," the conversation is over.

**Phase 0 exists entirely to fix this,** by replaying a real, externally-labelled dataset through PayGuard's own ingest API so that `isConfirmedFraud` is populated from ground truth that the rules had no hand in creating. Everything else depends on getting this right, which is why it comes first and why you should not skip ahead.

---

## Five bugs found while reading the code

Not part of the roadmap, but they turned up while checking that every claim above was accurate, and they're each worth a small commit. Two of them block or corrupt ML work, so fix those first.

**1. The ingest API discards the timestamp.** `transactionService.js` hardcodes `timestamp: new Date()` and doesn't whitelist a caller-supplied one, so replayed historical data all lands as "now." This **blocks Phase 0** — details and fix in that phase. Note the inconsistency: the Java engine accepts a timestamp and the backtest path forwards it; only live ingest throws it away.

**2. `NightOwlRule` can never fire for a real night window.** The check is `if (hour < startHour || hour > endHour) return empty` — a plain interval test with no wrap-around. So `startHour: 22, endHour: 5` is unsatisfiable, and the rule silently never triggers while showing as enabled. The current default (0–5) happens not to wrap, which is why nobody has noticed.

**3. `merchantService` has a unit mismatch in the dispute rate.** `recordDispute` writes a percentage (`* 10000 / 100`), `computeRiskScore` reads it as a fraction (`* 600`, commented "≥5% disputes = 30"). A 5% dispute rate therefore contributes the full 30 points instead of 0.05 × 600. The merchant risk tiering is currently wrong for any merchant with disputes.

**4. `GeographicAnomalyRule` ignores the coordinates it already has.** The schema stores `location.lat` and `location.lng`, but the rule reads only `location.city` and counts distinct strings. It cannot distinguish a 30km commute from a 1,150km relay. Free signal, already collected, unused.

**5. The README's screen inventory is stale.** It documents ten screens and "`01 HOME … 10 MULES`", but the sidebar now has twelve — `11 MERCHANTS` and `12 GRAPH` arrived later. Several page headers also disagree with the sidebar's numbering (`Alerts.jsx` says "02 — Alerts"; the sidebar says 04). Small, but the README is the best thing about this repo and inconsistency makes it read as unmaintained.

---

## Why PayGuard is rare

Before the phases, be clear about what you already have, because you should reuse it rather than rebuild it in a notebook.

| What ML needs | What you already built | Where |
|---|---|---|
| **Ground-truth labels** | Dispute ingestion sets `isConfirmedFraud` on the transaction — for fraud-type reasons *or* a lost dispute (the issuer sided with the cardholder) | `server/services/disputeService.js` |
| **An evaluation harness** | Backtest replays real history through baseline vs candidate config, chronologically, on isolated state | `server/controllers/backtestController.js` |
| **Recall reporting** | `getDetectionRates()` computes caught/missed and per-rule detection rate over confirmed fraud | `disputeService.js` |
| **A false-positive signal** | Analyst-resolved `false_positive` alert labels, with an honest "unlabeled" bucket | `backtestController.js` |
| **A data ingress for real datasets** | API-key machine ingest (`x-api-key`, bcrypt-hashed) on `POST /api/transactions` | `server/middleware/apiKeyAuth.js` |
| **Graph features** | Identity-graph BFS over 9 identifier types, to a fixed point or 5 rounds, whichever comes first | `server/services/identityGraphService.js` |
| **A clustering baseline** | Union-find mule-ring clustering by shared identifiers | `server/services/muleDetectorService.js` |
| **The shadow-mode pattern** | `scoringEngine: 'engine' \| 'fallback'` — recording *how* a decision was made, and being honest when degraded | `server/models/Transaction.js` |
| **Feature-rich schema** | userId, merchantId, amount, city/lat/lng, deviceId, ip, fingerprint, session, wallet, email, phone, beneficiaryId, timestamp | `Transaction.js` |

That last row deserves attention. `beneficiaryId` — the recipient of a P2P transfer, deliberately kept out of the payer's identity graph — is exactly the field that makes money-flow modelling possible. Most transaction datasets don't have it. You built it for the mule detector, and it will turn out to be one of your highest-signal feature sources.

And the `scoringEngine` field is the pattern to copy for everything in this roadmap. The reason PayGuard is a good product is that it tells the truth about its own state. Your ML layer must do the same: record `mlScore` and `mlVersion` on every transaction, report when the model is operating outside its training distribution, and never let a model silently replace a rule without the evidence to justify it.

---

## The honest scope conversation

You asked to master ML, DL, and AI, ace the exam, and ship a genuinely useful product, in 10–15 hrs/week.

Three of those four are achievable. All four are not, and I'd rather say so now than let you discover it in month four.

Here is the arithmetic. 12 hrs/week × 26 weeks ≈ **310 hours**. Genuine mastery of classical ML alone — the kind where you can derive the algorithms, not just call them — is conventionally reckoned at 300–500 hours. Deep learning is another 300+. Classical AI (search, logic, planning) is another 100+. Add a production build on top and you're looking at four times your budget.

So what 310 hours *can* buy, spent well:

- **Deep, derivable command of classical ML.** Linear and logistic regression from scratch, GLMs, bias-variance, regularisation, trees, ensembles, SVMs and the dual, PCA, clustering, evaluation under class imbalance. Not "I did a Kaggle tutorial" — actually able to derive the logistic gradient on a whiteboard and explain why PR-AUC beats ROC-AUC at 0.2% positives. **This is the single highest-return investment for placements**, because it is what interviews are actually about.
- **Working, honest fluency in deep learning.** Backprop derived and implemented from scratch, an MLP and a sequence model trained and evaluated, and — importantly — the judgment to know that gradient boosting usually beats neural nets on tabular fraud data, plus the experimental evidence to say so. That's not mastery of DL. It's enough to be useful and credible, and it's the right stopping point given your budget.
- **Exam-complete coverage of the AI units** (search, logic, resolution), with two small genuine builds so the knowledge sticks rather than evaporating after the SEE.
- **A shipped, deployed, deeply-measured product** that fixes a real flaw with real data.

What you are *deliberately not* getting: research-level DL, transformers from scratch, RL beyond the exam plus one honest bandit, MLOps at scale, or breadth across CV and NLP. Those are the right things to sacrifice. A hiring manager looking at one candidate with a calibrated fraud model in shadow mode with drift monitoring, and another with six half-finished Kaggle notebooks and a Coursera certificate, is not going to hesitate.

**One timing assumption to check.** `U23PC520IT` looks like a 5th-semester course, so I've assumed your SEE lands somewhere in **November–December 2026** and placed the exam-consolidation phase (Phase 3) at weeks 12–14 to land just before it. If your exam is earlier or later, shift Phase 3 — it's deliberately self-contained so it can move without disturbing the build phases around it.

---

## Syllabus map

Every syllabus topic, where it gets learned, and whether it becomes a real feature or stays exam-only. Being honest in this table is what keeps the project free of decorative ML.

| Unit | Topic | Phase | In the product? |
|---|---|---|---|
| I | Intro to AI, intelligent systems, sub-areas, applications | 3 | Exam only |
| I | BFS, DFS, DFID, bidirectional search | 3 | **Yes** — identity-graph traversal already uses BFS; you'll articulate why |
| I | Hill climbing, beam, best-first, branch & bound | 3 | Exam only (implemented in a scratch repo) |
| I | **A\*, IDA\*** | 3 | **Yes** — "shortest high-risk path to a known ring" in GraphExplorer |
| II | Propositional calculus & logic | 3 | **Yes** — rule configs *are* propositional clauses |
| II | **Resolution refutation** | 3 | **Yes** — detect dead/contradictory/subsumed rule configs |
| II | Predicate logic, unification, logic programming | 3 | Exam only |
| II | Types of learning, applications of ML | 0 | Framing |
| II | **Linear regression** | 1 | Indirectly — the gradient-descent machinery you'll derive first |
| II | **Logistic regression** | 1 | **Yes — the centrepiece.** Replaces the score average |
| II | **Bias-variance trade-off** | 1 | **Yes** — learning curves, regularisation path |
| II | **Data preprocessing** (cleaning, integration, reduction, transformation) | 0 | **Yes** — the external-dataset → PayGuard-schema pipeline |
| II | MSE, RMSE, R² | 1 | Exam only (regression metrics; you have a classification problem) |
| II | **Log-loss, confusion matrix, accuracy, precision, recall, F1** | 0–1 | **Yes** — extends the existing detection report |
| II | **PR curve, ROC curve, AUC** | 0–1 | **Yes** — the Models screen; PR-AUC is your headline metric |
| III | **Decision trees, ID3, overfitting** | 2 | Learned from scratch; GBM is the shipped descendant |
| III | k-Nearest Neighbour | 2 | Exam only — plus an honest note on why kNN fails here |
| III | **SVM, dual formulation, kernels** | 2, 4 | **Yes** — one-class SVM for per-user anomaly baselines |
| III | **Feature selection** (sequential, univariate, elimination) | 1 | **Yes** — all three, compared, on your real feature set |
| III | Feature extraction — text (tf, tf-idf) | 2 | Small: tf-idf over merchant names/categories |
| III | Feature extraction — image (patches, connectivity graph) | 2 | Exam only — no images in PayGuard. Don't fake it |
| III | **Dimensionality reduction — PCA** | 4 | **Yes** — entity embeddings before clustering |
| III | Recommendation systems (content-based, collaborative filtering) | 4 | Stretch — one weak-but-honest feature, or exam-only |
| IV | **Perceptron, learning Boolean functions** | 5 | Learned from scratch (XOR → why hidden layers) |
| IV | **MLP, backpropagation** | 5 | Derived and implemented from scratch in numpy |
| IV | **Cross-validation, k-fold, stratified k-fold** | 2 | **Yes** — *and* why you use time-based CV instead here |
| IV | **Intro to deep learning** | 5 | **Yes** — GRU sequence model over per-user history |
| IV | **Bayes theorem, MAP, MLE** | 3 | **Yes** — the probabilistic derivation of logistic regression |
| IV | **Naive Bayes** | 3 | **Yes** — as a fast baseline in the comparison table |
| IV | Bayesian belief networks | 3 | Exam only |
| V | **Bagging, AdaBoost, Random Forest** | 2 | **Yes** — and gradient boosting, the likely production winner |
| V | **k-Means, DBSCAN, hierarchical clustering** | 4 | **Yes** — DBSCAN finds rings union-find misses |
| V | **Rand, ARI, homogeneity, completeness, V-measure, MI, NMI** | 4 | **Yes** — validating discovered rings against ground truth |
| V | **RL: the learning task, Q-learning** | 6 | Exam in full; product gets a **contextual bandit** for alert triage, plus a written argument for why full RL is inappropriate here |

Two entries above are worth flagging as deliberate refusals. **Image feature extraction** has no place in PayGuard — there are no images. **Recommendation systems** are a genuine stretch; the only defensible framing is user–merchant collaborative filtering as an anomaly signal ("this pairing is unusual given behaviourally similar users"), and if time is tight you should learn it for the exam and leave it out of the product. Saying "I considered it and it didn't fit" is a stronger answer than a shoehorned recommender.

---

## CS229 map

You've finished the first three lectures, which puts you through linear regression, gradient descent, the normal equations, the probabilistic interpretation of least squares, locally weighted regression, and the beginnings of logistic regression and Newton's method. Good place to be — you're about to hit the single most relevant lecture in the course for this project.

| CS229 lectures | Content | Syllabus | Phase |
|---|---|---|---|
| 1–3 ✅ done | Linear regression, GD/SGD, normal equations, probabilistic interpretation, LWR, logistic regression, Newton | UNIT-II | 0–1 |
| **4** | **Perceptron, exponential family, GLMs, softmax** | UNIT-II, IV | **1** |
| 5–6 | GDA, Naive Bayes, Laplace smoothing, generative vs discriminative | UNIT-IV | 1, 3 |
| 7–8 | Kernels, SVM, the dual, SMO | UNIT-III | 2, 4 |
| 9–10 | Bias-variance, regularisation, model selection, learning theory | UNIT-II, IV | 1–2 |
| 11–12 | Decision trees, ensembles, bagging/boosting, intro to neural nets | UNIT-III, V | 2 |
| 13 | Backprop, deep learning practice | UNIT-IV | 5 |
| 14–15 | Unsupervised: k-means, EM, GMM, PCA, ICA | UNIT-III, V | 4 |
| 16–20 | MDPs, value/policy iteration, Q-learning, policy gradient | UNIT-V | 6 |

Three things about CS229 that matter more than the lecture order:

**The problem sets are the course.** Watching CS229 without doing the psets produces a comfortable feeling of understanding that evaporates the moment someone asks you to derive something. The psets and the official course notes (Ng's handouts, which are better written than the lectures are spoken) are where the learning happens. Budget for them explicitly — that's why the weekly rhythm below allocates theory time in blocks, not in passive-watching minutes.

**CS229 will not cover two of your five units.** There is essentially nothing on search or logic (UNIT-I, UNIT-II's first half) — that's Russell & Norvig and Saroj Kaushik territory, and it's why Phase 3 exists. Trees and ensembles also get lighter treatment in CS229 than your UNIT-III/V demands; Tom Mitchell chapter 3 is the canonical ID3 reference and matches your syllabus wording exactly.

**Don't let CS229's pace set yours.** It's a 10-week course taught to full-time students. At 12 hrs/week split with a build, you'll take longer, and that's correct. Depth per lecture beats lectures per week.

---

## The weekly rhythm

The structure matters more than the total. A suggested 12-hour week:

- **Two theory blocks, ~2.5h each (5h).** One CS229 lecture *plus* the corresponding notes *plus* attempting the relevant pset problems. Not three lectures back to back.
- **Two build blocks, ~3h each (6h).** Implement in PayGuard what you learned. Long enough to get into the code properly; a 45-minute build session on a three-service app is mostly startup cost.
- **One writing block, ~1h.** Write down what you learned and what you built — into the notebook, the README, or a phase log. This is not overhead.

That last hour is the one people cut, and it's the one that compounds. Three reasons: writing an explanation is how you discover you didn't understand something; interviews are conducted in prose, not code, so the skill you're rehearsing *is* the skill being tested; and your README is already the best thing about this repo, doing real work in making the project legible to anyone who finds it. Keep feeding it.

One habit worth adopting from the start: **keep a `ml/EXPERIMENTS.md` log.** Every model you train, the split you used, the metric you got, and one line on what you learned. Six months of that file is both an interview asset and the only reliable defence against the "wait, was that number from the version with leakage?" problem that eats weeks.

---

## Phase 0

### Honest data and a baseline you trust
**Weeks 1–3 · ~35h · The prerequisite for everything else**

The goal of this phase is not a model. It is a number: **how well do your six rules actually perform against fraud they were not designed to catch?** Everything after this is measured against that number, so if this phase is wrong, all of it is wrong.

#### Learn (≈15h)

Consolidate CS229 1–3 and push into **Lecture 4** (perceptron, exponential family, GLMs, softmax). Lecture 4 is where logistic regression stops being a formula and starts being a member of a family — that framing is what lets you answer "why sigmoid?" in an interview with something better than "because it squashes to (0,1)."

Alongside: get genuinely fluent in numpy and pandas. Not tutorial-fluent — able to do a grouped rolling window with a time offset without looking it up, because that is 80% of fraud feature engineering. Then sklearn's API conventions (`fit`/`transform`/`predict_proba`, `Pipeline`, `ColumnTransformer`) and matplotlib enough to make a PR curve you're not embarrassed by.

Syllabus: **UNIT-II data preprocessing** (cleaning, integration, reduction, transformation) and the full **evaluation-metrics block** (confusion matrix, accuracy, precision, recall, F1, log-loss, PR, ROC, AUC). Learn these now, properly, before you have a model — because the metric decisions you make here determine whether the next five months measure anything real.

The one idea to internalise above all others: **accuracy is a lie on imbalanced data.** If 0.5% of transactions are fraud, predicting "clear" for everything scores 99.5% accuracy and catches nothing. Fraud is the canonical imbalanced problem, and your headline metric should be **PR-AUC (average precision)**, not accuracy and not ROC-AUC. The reason ROC-AUC misleads: its x-axis is false-positive *rate*, which is normalised by the enormous number of true negatives, so a model can look excellent while flooding analysts with false positives. Precision cares about the absolute count of false alarms, which is what actually costs money and customer trust.

#### Get real data (≈8h)

You need externally-labelled transaction data. Four candidates, in order of fit to PayGuard's schema:

**Sparkov / "Credit Card Transactions Fraud Detection"** (Kaggle, from Brandon Harris's generator) is the best structural match. It carries `trans_date_trans_time`, `cc_num`, `merchant`, `category`, `amt`, `city`, `lat`/`long`, `merch_lat`/`merch_long`, `city_pop`, and `is_fraud`. That maps onto PayGuard almost field-for-field: `cc_num → userId`, `merchant → merchantId`, `amt → amount`, `lat/long → location`. It even lets you compute real geographic distance features, which is exactly what `GEOGRAPHIC_ANOMALY_RULE` is guessing at.

**PaySim** (Kaggle, synthetic mobile-money data derived from real African mobile money logs) is the best *semantic* match, and I'd argue the more interesting one. Its transaction types include `TRANSFER` and `CASH_OUT`, its `nameOrig`/`nameDest` map directly onto your `userId`/`beneficiaryId`, and — this is the good part — its fraud model is literally *"take over an account, transfer the money to a mule, cash out."* That means **PaySim gives you ground truth to evaluate your mule detector against**, which nobody's student project ever has. Your `beneficiaryId` field, built for the mule detector, is the reason you can use this dataset at all.

**IEEE-CIS Fraud Detection** (Kaggle, from Vesta) is the hard, realistic one: hundreds of features, genuine anonymised production data, a well-documented leaderboard to sanity-check against. Save it for Phase 2 when you want to know whether your feature engineering is any good.

**The ULB credit-card dataset** (~285k transactions, ~0.17% fraud) is the classic imbalance teaching set, but its features are anonymised PCA components (V1–V28), so there's no feature-engineering story and nothing maps to PayGuard's schema. Use it for one afternoon to feel what 0.17% positives does to your metrics, then move on.

> **A caveat I owe you:** my web access is blocked in this session, so I'm describing these datasets from memory. The row counts, fraud rates, and exact column names above are approximately right but **verify each against the actual dataset page before building your loader.** If a column name differs, the schema mapping is the thing to adjust, not the plan.

**Recommendation: start with Sparkov, add PaySim in Phase 4** when you get to ring detection and clustering validation.

#### Build (≈12h)

> ### ⚠ Prerequisite: the ingest API discards timestamps
>
> Do this before anything else in Phase 0, because the rest of the phase silently produces garbage without it.
>
> In `server/services/transactionService.js`:
> ```js
> const draft = { transactionId: uuidv4(), ...input, timestamp: new Date() };
> ```
> `timestamp` is hardcoded to wall-clock ingest time, and `buildTransactionInput` doesn't whitelist a caller-supplied one. So if you replay two years of Sparkov data through `POST /api/transactions`, **every row lands with a timestamp of "right now."**
>
> Ordering your POSTs correctly does not save you. Chronological *order* survives; the *intervals* are destroyed. And the intervals are what four of your six rules are made of: `VELOCITY` (>5 in 60s) and `ENUMERATION` (≥8 micro-txns in 30 min) will fire on nearly everything, `GEOGRAPHIC_ANOMALY` (2+ cities in 120 min) will fire constantly, and `NIGHT_OWL` will report the hour you ran the script rather than the hour of the transaction. Your baseline would be meaningless, and because it would look *plausible* — lots of alerts, high flag rate — you might not notice for weeks.
>
> Note the asymmetry, which is a genuine latent inconsistency worth fixing regardless of ML: the Java engine **does** accept a timestamp (`TransactionRequest.java` has `@JsonAlias("timestamp")`) and the backtest path **does** forward it. Only the live ingest path throws it away.
>
> **The fix** is to whitelist `timestamp` in `buildTransactionInput`, defaulting to `new Date()` when absent so nothing existing changes. Validate it's a parseable date, and consider gating "timestamps in the past" behind the API-key path so a compromised analyst session can't backdate a transaction. That last consideration is exactly the kind of thing to mention in an interview — you noticed the feature you needed was also an audit-integrity concern.

Then create the ML workspace as a fourth top-level directory, parallel to your existing three services:

```
ml/
├── data/                    # gitignored — raw datasets are large
├── notebooks/
│   └── 00-baseline.ipynb
├── payguard_ml/
│   ├── schema.py            # external dataset → PayGuard Transaction shape
│   ├── replay.py            # POST into PayGuard via the API key
│   └── metrics.py           # confusion matrix, PR, ROC, calibration
├── EXPERIMENTS.md
└── requirements.txt
```

Then the step that makes this whole roadmap work:

**1. Map the external dataset to PayGuard's schema** (`schema.py`). A pure function from a dataset row to a `POST /api/transactions` body. Handle the honest gaps explicitly — Sparkov has no `deviceId`, so either synthesise one deterministically per cardholder (with an occasional realistic device change) or leave it null and accept that `NEW_DEVICE_RULE` can't be evaluated on this dataset. Write down which you chose and why. Fabricating a field and then evaluating a rule against your fabrication is Flaw 2 all over again, one level deeper.

**2. Replay it through the front door** (`replay.py`). Use the `x-api-key` machine-ingest path you already built — that's what it's for, and it means the data arrives through the same four-step pipeline as live traffic, gets scored by the real Java engine with the real live config, and lands in Mongo with `rulesTriggered` populated. Replay **chronologically and with real timestamps** (see the prerequisite above), because your velocity, enumeration, and geo rules hold sliding-window state that both the order *and* the intervals feed.

**3. Feed ground truth in as disputes.** For every row where `is_fraud == 1`, `POST /api/disputes` with reason `unauthorized`. Your `disputeService` then sets `isConfirmedFraud = true`. The labels now come from the dataset, not from your rules — the circularity is broken, and you did it without writing a single new API.

This is the elegant part of Phase 0 and worth pausing on: you are turning your product's own ingest and dispute APIs into an ML data pipeline. No new services, no new endpoints, nothing to maintain. If an interviewer asks how you got labelled data into a live system, "I replayed a labelled dataset through the production ingest path and fed the labels back as chargebacks, which is exactly how real ground truth arrives in a real payments system" is a very good answer.

**4. Measure the rules honestly.** Call `GET /api/disputes/detection` — the report you already built now tells you something real. Then compute in the notebook what that endpoint doesn't yet: the full confusion matrix, precision, recall, F1, PR-AUC, ROC-AUC, and a per-rule precision (not just recall — the existing report gives you catch counts but not how often each rule cried wolf).

#### The result to expect, and why it's good news

Your rules will probably do **poorly** — my guess is recall somewhere in the 20–50% range with unimpressive precision, because they were tuned against a simulator that generates their own trigger patterns. `NIGHT_OWL_RULE` will likely be near-useless. `AMOUNT_THRESHOLD_RULE` at ₹1,00,000 will miss most real fraud, because real card fraud is overwhelmingly *small* — testing transactions and modest purchases that don't trip alarms.

Do not be disheartened by this and above all **do not tune the rules to fix it.** That gap is your project's entire thesis. Write it into the README as a section — "How good are the rules, actually?" — with the real numbers in a table. A project that honestly reports its own baseline as mediocre and then improves it measurably is dramatically more credible than one that reports 0.99 AUC.

#### Done when

- [ ] **`timestamp` accepted on ingest** — the prerequisite; nothing else in this phase is valid without it
- [ ] A real labelled dataset is replayed into PayGuard with `isConfirmedFraud` set from external truth
- [ ] `00-baseline.ipynb` reports confusion matrix, precision, recall, F1, PR-AUC, ROC-AUC for the rule engine
- [ ] Per-rule **precision and recall** table (the existing report gives you recall only — precision needs the flagged-but-not-fraud denominator, which is never currently queried)
- [ ] The "How good are the rules, actually?" README section, with real numbers
- [ ] `EXPERIMENTS.md` started; `MODEL_CARD.md` scaffolded
- [ ] **Verification:** assert replayed timestamps in Mongo match the source dataset, that replay is chronological, and that no `isConfirmedFraud` label was derived from `rulesTriggered`

---

## Phase 1

### Logistic regression replaces the average
**Weeks 4–7 · ~50h · The centrepiece**

If you complete only one phase after Phase 0, make it this one. At the end of it you will have replaced a mathematically-wrong aggregation with a calibrated, interpretable, learned model — deployed inside your existing Java engine, with **no new services** — and you will be able to prove it beats the rules on externally-labelled data using a harness you built before you knew you'd need it.

#### Learn (≈20h)

CS229 **4–6** and **9–10**: GLMs, the exponential family, softmax; then GDA and Naive Bayes (generative vs discriminative — a classic interview question, and the "why logistic regression rather than Naive Bayes here?" answer lives in it); then bias-variance, regularisation, and model selection.

Do these three things by hand, on paper:

1. **Derive the logistic-regression gradient.** Start from the Bernoulli likelihood, take logs, differentiate. You should end up at the strikingly clean `∇ = Σ(y⁽ⁱ⁾ − h(x⁽ⁱ⁾))x⁽ⁱ⁾` and understand why it looks identical to the least-squares gradient despite a completely different model — the GLM framing from Lecture 4 explains it, and being able to explain *that* is a genuine depth signal.
2. **Derive it as MAP estimation** with a Gaussian prior on the weights, and see L2 regularisation fall out of the prior. This is your **UNIT-IV MAP/MLE** content arriving early and in context, which is much better than meeting it as a definition to memorise.
3. **Implement it from scratch in numpy** — batch gradient descent first, then Newton's method (IRLS). Watch Newton converge in ~5 iterations where GD takes thousands, and understand the trade (Hessian inversion is O(d³)). Then switch to sklearn for everything downstream, having earned the right to.

Syllabus: **UNIT-II** logistic regression, bias-variance, preprocessing, all metrics. **UNIT-III** feature selection.

#### Build: features (≈18h)

This is where the real work is. Models are commodities; features are where fraud detection is won. You have ~10 raw fields and need ~40 informative ones.

**Per-user behavioural features** (trailing windows, per `userId`): amount z-score against the user's trailing mean and standard deviation; transaction count in the last 1h / 24h / 7d; distinct devices, cities, and merchants in the last 24h / 7d; seconds since the user's previous transaction; ratio of this amount to their trailing median; count of *distinct* merchant categories in 24h.

**Velocity and geography:** kilometres from the user's previous transaction location (haversine); **implied speed in km/h** — distance divided by time since last transaction, which is a far better impossible-travel signal than your current "2+ cities in 120 min" because it's continuous rather than a cliff edge; distance from the user's historical centroid.

Worth noticing here: your `Transaction` schema stores `location.lat` and `location.lng`, but `GeographicAnomalyRule.java` reads only `location.city`. You are already collecting the coordinates and throwing away the signal — the rule can't distinguish Mumbai→Thane (a 30km commute) from Mumbai→Delhi (1,150km) because it only counts distinct city strings. Actual haversine distance and implied km/h are strictly more informative and cost you nothing to compute. This is a good, small, self-contained first feature.

**Temporal:** hour of day encoded as `sin(2πh/24)`, `cos(2πh/24)` — cyclical encoding matters, because raw hour tells a linear model that 23:00 and 00:00 are 23 units apart when they're adjacent; day of week; is-weekend; a night flag for comparison against `NIGHT_OWL_RULE`.

**Merchant features:** this amount's percentile within the merchant's own distribution; merchant category, target- or frequency-encoded; merchant age in your data; and the merchant's historical dispute rate — **but read the warning below before using that one**.

> **Do not read `Merchant.disputeRate` directly as a feature.** It's a single mutable scalar, overwritten in place by `merchantService.recordDispute` on every dispute. There's no history and no snapshot, so the value you read while building a training set reflects *today's* disputes — including disputes filed after the transaction you're scoring. That is textbook leakage, and it would be an especially embarrassing instance of it because Phase 1 spends a page warning about exactly this.
>
> The fix is to compute the merchant's dispute rate **as of each transaction's timestamp** from the `Dispute` collection directly, as an expanding count over time. If you want the live field to be usable later, add a dated `disputeRateHistory` (or event-source it from `Dispute`) so point-in-time reads are possible.
>
> While you're in there: `recordDispute` writes the rate as a percentage (`* 10000 / 100`) but `computeRiskScore` consumes it as a fraction (`* 600`, with a comment saying "≥5% disputes = 30"). So a 5% dispute rate contributes 30 out of a possible 30 instead of 0.05 × 600. That's a live unit bug in the risk tiering, unrelated to ML, and worth a separate small commit.

**Graph features** (from `identityGraphService`) — in real fraud systems these are consistently among the strongest, and almost no student project has them: size of the connected component containing this transaction's identifiers; count of distinct users sharing this device; count of distinct users sharing this IP; whether any identifier has ever been within *k* hops of a blocked entity; degree of the device node. (Note the existing traversal caps at 5 rounds rather than running to a true fixed point — fine for blocking, but be aware of it if you use component size as a feature, since it's a lower bound.)

**The six rule indicators:** binary flags for each rule that fired. Including these is what makes the model a strict generalisation of the rule engine rather than a competitor to it — the model can learn to reproduce the rules *and* add to them, and the learned coefficient on each flag is a direct, publishable statement about that rule's real evidential worth.

#### The one thing you must get right: no future data

Every feature above must be computed using **only data strictly before the transaction's own timestamp**. Get this wrong and every number you produce for the rest of the roadmap is fiction. This is the most common way fraud ML projects fail, it is invisible when it happens, and it produces beautiful results.

The trap is subtle. "The user's average transaction amount" computed over the whole dataset includes transactions from *after* the one you're scoring — including, often, the fraud spree itself. Your model learns "this user's average is unusually high" as a fraud signal, scores 0.97 AUC offline, and collapses in production because at decision time that future doesn't exist.

Your Java rules already do this correctly with sliding windows, which is a real architectural advantage. Preserve it in Python:

- Use **as-of / point-in-time joins**: sort by timestamp, compute expanding or rolling aggregates with `groupby().shift()`, never a plain `groupby().mean()` over the full frame.
- **Split chronologically**, never randomly. Train on the earliest ~60%, validate on the next ~20%, test on the final ~20%. Random `train_test_split` on transaction data lets the model see the future, full stop.
- **Write a leakage test.** Take a transaction, recompute its features with all subsequent rows deleted, and assert the feature vector is byte-identical. Put it in CI. This single test is worth more than any model you'll train, and "I wrote a test that proves my features can't see the future" is a sentence that will make an experienced interviewer sit up.

#### Build: train, calibrate, ship (≈12h)

**Handle imbalance** with `class_weight='balanced'` (or a tuned `scale_pos_weight`) plus **threshold tuning on the PR curve** — not with SMOTE. Be ready to explain why: SMOTE interpolates between minority points, and in fraud data the minority class isn't a contiguous blob, it's many small distinct attack modes, so interpolating between two unrelated frauds invents a transaction that no attacker would ever make. Worse, applying it before splitting leaks. Class weights plus threshold movement is simpler, sounder, and usually wins. Try SMOTE once so your critique is empirical rather than received.

**Pick the threshold from the operating point you want**, not 0.5. 0.5 is a default, not a decision. Two better approaches, both worth doing: fix a precision target the analyst team can absorb ("we can handle 100 alerts/day at ≥40% precision") and read the threshold off the PR curve; or build a **cost model** — expected loss = (false negatives × average fraud amount) + (false positives × (analyst-minutes + customer-friction cost)) — and minimise it. The cost model is more work and much more impressive, because it connects the metric to money, which is what the problem is actually about.

**Calibrate the output.** This matters more than it sounds and it's deeply on-brand for PayGuard. An uncalibrated score of 0.8 means nothing; a *calibrated* 0.8 means that of all transactions scored 0.8, about 80% turn out fraudulent. Use Platt scaling or isotonic regression on the validation set, then plot a **reliability diagram** (predicted probability bucketed against observed fraud rate — a perfect model sits on the diagonal). Almost no student project calibrates, and calibration is precisely the ML expression of your product's existing philosophy: a score that *looks* like a probability but isn't one is a system lying about its own confidence.

**Study bias-variance empirically:** learning curves (train vs validation score against training-set size — does more data help, or are you variance-limited?), and the L1/L2 regularisation path. L1 driving coefficients to exactly zero is **UNIT-III feature selection** happening in front of you; do the syllabus's three explicit methods too (univariate filtering by mutual information, sequential forward selection, recursive feature elimination) and compare which features each keeps. When they disagree, that disagreement is interesting and worth a paragraph.

**Then ship it — and here's the design call that makes this phase cheap.** A logistic regression model *is* a vector of numbers. You don't need a Python service to run one. So:

1. Export the trained model to `fraud-engine/src/main/resources/model-v1.json` — feature names, weights, intercept, plus the mean/std used for standardisation.
2. Add `LogisticModelScorer.java` that loads it and computes `sigmoid(w·x + b)`.
3. Add `FeatureExtractor.java` to compute the feature vector, reusing the sliding-window state the rules already maintain.
4. Return `mlProbability` alongside the existing rule score, plus `topContributions` — the per-feature `wᵢxᵢ` terms sorted by absolute value. **A linear model gives you exact explainability for free**, which means the ML layer keeps the promise the rest of the product makes: every decision comes with reasons.

Add `mlScore`, `mlVersion`, and `mlContributions` to the `Transaction` model. Then — critically — **run in shadow mode.** Record the model's opinion on every transaction; let the rules keep deciding. You now have a live A/B on real traffic with zero risk, and you can prove the model is better *before* trusting it with anyone's money. This is how models are actually deployed in production at serious companies, and doing it this way is a stronger signal than the model itself.

#### Done when

- [ ] Logistic regression implemented from scratch (GD + Newton), gradient derived by hand
- [ ] ~40 point-in-time features with a passing leakage test in CI
- [ ] Chronological train/val/test split
- [ ] Calibrated probabilities with a reliability diagram
- [ ] Threshold chosen from a PR curve or cost model, with the reasoning written down
- [ ] All three UNIT-III feature-selection methods run and compared
- [ ] `model-v1.json` shipped; `LogisticModelScorer.java` scoring live in shadow mode
- [ ] `mlScore` / `mlContributions` recorded on every transaction
- [ ] README section: "Why averaging rule scores is wrong" with the concrete 80+40=60 counterexample
- [ ] **Verification:** the learned coefficient on each rule flag, compared against its hardcoded score — a table of "what we guessed vs what the data says"

---

## Phase 2

### Trees, ensembles, and the model that wins
**Weeks 8–11 · ~50h**

Logistic regression is linear in the features; fraud is full of interactions ("large amount" is fine, "new device" is fine, large amount *on* a new device *at* 3 AM is not). Trees capture those natively. This phase is where you get your best-performing model — and where you learn to compare models on more axes than accuracy.

#### Learn (≈22h)

CS229 **7–8** (kernels, SVM, the dual — derive the dual with Lagrange multipliers, understand the kernel trick as an inner product in an implicit feature space) and **11–12** (trees, ensembles). Tom Mitchell chapter 3 for ID3 specifically — your syllabus names ID3 and Mitchell is where its canonical treatment lives.

Understand and be able to reproduce: entropy and information gain (compute both by hand on a small table); why ID3 overfits and what pruning does; the bias-variance story behind ensembles — **bagging reduces variance** by averaging decorrelated high-variance learners, **boosting reduces bias** by sequentially fitting the residual. That distinction is a very common interview question and most candidates fumble it.

**AdaBoost** properly: the exponential loss, the weight update, why it focuses on hard examples. Then **random forests** (bagging + feature subsampling for decorrelation) and **gradient boosting** (fitting the gradient of the loss, which generalises AdaBoost).

**kNN** (UNIT-III) — learn it, then write down honestly why it's a poor fit here: at 0.2% positives the *k* nearest neighbours of a fraud are almost all legitimate, the curse of dimensionality wrecks distance metrics at 40+ features, and per-query cost scales with the dataset, which is unacceptable in a synchronous scoring path with a 3-second timeout. Knowing when *not* to use an algorithm is the part of the syllabus that exams don't test and interviews do.

#### Build (≈28h)

**Implement ID3 from scratch** on a small discretised subset — recursive splitting on maximum information gain, a depth limit, printable tree. It's a satisfying afternoon, it's directly examinable, and it makes gradient boosting stop being magic.

**Then train the real contenders** and compare on one honest table: rules baseline (Phase 0) · logistic regression (Phase 1) · Naive Bayes · decision tree · random forest · AdaBoost · **XGBoost/LightGBM**. Same chronological split, same metrics: PR-AUC as headline, plus precision and recall at your chosen operating threshold, log-loss, calibration error, p99 inference latency, and model size. Gradient boosting will very likely win on PR-AUC. Latency and explainability cost are where it loses, and showing that trade-off explicitly is the mark of someone who has thought about production rather than leaderboards.

Note that boosted trees come out **badly calibrated** by default — they push probabilities toward the extremes. Calibrate again (isotonic on the validation set), and compare reliability diagrams before and after. That gradient boosting needs calibration while logistic regression barely does is a nice, concrete illustration of the difference between optimising a ranking and estimating a probability.

**SHAP for explainability.** A boosted forest is a black box, and a black box breaks PayGuard's core promise. TreeSHAP is fast enough to run in the scoring path and gives per-feature contributions with a real theoretical grounding (Shapley values from cooperative game theory — the unique attribution satisfying a few reasonable axioms). Return the top 5 contributions with every score so the Alerts screen can say *why*, exactly as it does for rules today.

**Now you need the Python sidecar.** A boosted forest won't export to a JSON of weights, so add a fourth service:

```
ml-service/          # FastAPI, port 8000
├── app.py           # POST /score, POST /score/batch, GET /health
├── models/          # versioned artefacts
└── features.py      # must match the Java FeatureExtractor exactly
```

Wire it into `transactionService.js` **in parallel** with the Java engine (`Promise.all`), with a tight timeout (~100ms) and — this is the part that fits your architecture — the same honest fallback the Java engine already has. Add `mlEngine: 'model' | 'fallback'` mirroring `scoringEngine`. When the model service is down, the platform says so instead of pretending. That symmetry isn't decoration; it means a reader of your code sees one consistent idea applied twice.

**The feature-parity problem is real and worth naming.** You now compute features in two places — `FeatureExtractor.java` and `features.py` — and if they ever drift, your model is scored on features it wasn't trained on (training/serving skew, one of the great silent killers in production ML). Two defences: a shared golden-fixture test (the same JSON input through both, asserting identical vectors), and a decision about long-term ownership. The clean long-term answer is that features are computed **once** in Node and passed to both engines. Consider making that refactor now while it's cheap.

**Model selection (UNIT-IV):** run k-fold and stratified k-fold, then explain in the README why **neither is valid here** and you use forward-chaining time-series CV instead (fold 1: train weeks 1–4, test 5; fold 2: train 1–5, test 6; …). Stratified k-fold is genuinely the right tool for imbalanced *non-temporal* data — so demonstrate it on a shuffled version, show that it gives an optimistically inflated score, and quantify the gap. That comparison is the whole lesson, and it's a much better README section than a definition.

**Then build the `13 MODELS` screen** in the existing Swiss-editorial style: current model version and training date, live rules-vs-model agreement matrix on today's traffic, PR curve, reliability diagram, and the top-20 feature importances. This is the screen you'll open in an interview.

(Numbering note: your sidebar numbers positionally and now has **twelve** entries, not the ten the README describes — `11 MERCHANTS` and `12 GRAPH` were added after the README was written. So a Models screen is 13. Worth a five-minute README fix while you're here: the screens table omits Merchants and Graph, and several page headers disagree with the sidebar's numbering — `Alerts.jsx` says "02 — Alerts" while the sidebar shows 04. A reviewer comparing the two will notice, and it's the kind of small inconsistency that makes an otherwise excellent README feel unmaintained.)

#### Done when

- [ ] ID3 implemented from scratch; entropy and information gain computed by hand at least once
- [ ] Seven-model comparison table: PR-AUC, precision/recall at threshold, log-loss, calibration error, p99 latency, size
- [ ] Boosted model calibrated; before/after reliability diagrams
- [ ] SHAP top-5 contributions returned with every score
- [ ] `ml-service/` FastAPI sidecar live, called in parallel, with honest `mlEngine: 'fallback'`
- [ ] Golden-fixture test asserting Java and Python feature parity
- [ ] k-fold vs stratified k-fold vs time-series CV compared, with the optimism gap quantified
- [ ] `13 MODELS` screen shipped (and the README's stale ten-screen table brought up to date)
- [ ] **Verification:** shadow-mode agreement analysis — on real traffic, where do rules and model disagree, and on the dispute-labelled subset, who was right?

---

## Phase 3

### Exam consolidation and the AI units
**Weeks 12–14 · ~35h · Time this to land just before your SEE**

This phase is deliberately movable — it's the one that should sit immediately before your exam, wherever that falls. It's mostly exam-facing, but it carries two small builds that make the AI half of the course real instead of something you forget in January. Both are genuinely useful features, which is the test I'm applying throughout: if it wouldn't survive a code review on its own merits, it doesn't go in.

#### UNIT-I: search (≈12h)

Implement the whole family in one small Python package with a shared interface, on two problems (8-puzzle and a grid maze with walls) so you can compare them on the same ground:

```
ml/search/
├── problem.py       # State, actions, cost, goal_test, heuristic
├── uninformed.py    # BFS, DFS, DFID, bidirectional
├── informed.py      # hill climbing, beam, best-first, branch & bound, A*, IDA*
└── compare.py       # nodes expanded, path cost, peak memory, time
```

Instrument every one to report nodes expanded and peak frontier size. Seeing DFID use O(d) memory to get BFS's optimality, and A* expand a tenth of the nodes with a decent heuristic, teaches the material in a way that reading the pseudocode does not.

Understand for the exam, and be able to state precisely: completeness and optimality for each; **admissibility** (never overestimates) versus **consistency/monotonicity** (satisfies the triangle inequality) and why A\* with an admissible heuristic on a tree is optimal but needs consistency for graph search without re-expansion; why hill climbing gets stuck on local maxima, plateaus, and ridges; why beam search is incomplete; how IDA\* trades repeated work for linear memory.

**The build: A\* in GraphExplorer.** Your `identityGraphService` already does BFS to a fixed point for the block cascade — that's an unweighted reachability question, and BFS is correct for it. But an investigator has a different question: *"how is this account connected to that known mule ring, and by what route?"* That's a shortest-path problem on a weighted graph where edge cost should reflect how suspicious a link is (a shared device is strong evidence; a shared IP could be a coffee shop or a CGNAT range and is weak). Give each edge type a cost, use hop-count-to-target as the heuristic, and run A\* to return the single most-suspicious path.

Add it to the existing force-directed GraphExplorer as a highlighted path. It's a real investigator feature, it directly demonstrates UNIT-I, and it gives you an honest answer to "where does classical AI show up in your project?" that isn't a stretch. Be careful about heuristic admissibility here — if edge costs can drop below 1, hop count stops being admissible and you lose the optimality guarantee. Working that out yourself is exactly the exercise.

#### UNIT-II: logic (≈10h)

Propositional calculus, CNF conversion, **resolution refutation** (to prove `KB ⊨ α`, show `KB ∪ {¬α}` is unsatisfiable), then predicate logic, unification, and Horn clauses / logic programming. Do many proofs by hand — resolution is a mechanical procedure and the exam will reward fluency, which only comes from repetition.

**The build: a rule-consistency checker.** Your `RuleConfig` documents *are* propositional formulae. `AMOUNT_THRESHOLD_RULE` with `minAmount: 100000` is the literal "amount > 100000". Once you see rules as clauses, you can reason about them automatically and catch real operator errors:

- **Dead configurations** — a threshold combination that can never fire. Encode the constraints, run resolution, and if you derive a contradiction the rule is unsatisfiable and will never trigger. The Rules screen should say so, loudly, because a silently dead fraud rule is a security hole that looks like a working control.

  There's a real one waiting for you here. `NightOwlRule.java` tests `if (hour < startHour || hour > endHour) return empty` — a plain interval check. So a night window expressed the way any operator would naturally express it, `startHour: 22, endHour: 5`, is **unsatisfiable**: no hour is simultaneously ≥ 22 and ≤ 5. The rule silently never fires, the Rules screen shows it enabled and green, and nobody finds out. (Note that `startHour == endHour` is *not* the bug — that fires for exactly that one hour, which is degenerate but well-defined. The bug is any window that wraps midnight, which is every window a night-owl rule actually wants.) Finding a genuine wrap-around bug via a logic checker you built for a course unit is a very good story.
- **Subsumption** — one rule's firing set contains another's, so the second adds nothing. Redundant rules distort the score average (Flaw 1) and clutter the analyst's reasons.
- **Contradictory intent** — configs where enabling one rule makes another unreachable.

This is a small, real, genuinely useful feature that almost nobody builds, and it's the honest way to show UNIT-II in a payments product. Surface warnings on the `07 RULES` screen next to the toggle.

#### UNIT-IV: Bayesian block (≈8h)

Bayes theorem, MLE vs MAP (you already met these deriving L2 regularisation from a Gaussian prior in Phase 1 — connect the two explicitly, it's the same idea), the **Naive Bayes** classifier with Laplace smoothing, and Bayesian belief networks (conditional independence, d-separation, computing a joint from the local factorisation).

Naive Bayes earns a place in the product as a baseline in the Phase 2 comparison table, and it's instructive to show *why* it underperforms: its conditional-independence assumption is badly violated in fraud, where features are heavily correlated (amount, merchant category, and time of day are not independent given the class). Demonstrating that empirically — showing NB's probabilities are wildly overconfident because it multiplies correlated evidence as though it were independent — is a better exam answer than reciting the assumption.

#### Exam craft (≈5h)

Past papers under timed conditions. A hand-written one-page summary per unit — writing them by hand is not nostalgia, it's that the compression forces you to decide what matters. A formula sheet: entropy and information gain, the logistic gradient, Bayes rule, precision/recall/F1, A\* cost, resolution rule, k-means objective, Q-learning update.

Also worth doing: for each unit, write down the **one thing you'd be embarrassed not to know**, and check you know it cold.

#### Done when

- [ ] All UNIT-I search algorithms implemented and compared on shared problems
- [ ] A\* suspicious-path search live in GraphExplorer, with admissibility reasoned through
- [ ] Rule-consistency checker (dead configs, subsumption) surfacing warnings on `07 RULES`
- [ ] Naive Bayes in the comparison table, with its independence violation demonstrated
- [ ] Per-unit summaries and formula sheet written by hand; past papers done timed
- [ ] **Verification:** unit tests confirming your A\* returns the same path as Dijkstra on the same weighted graph — if it doesn't, your heuristic isn't admissible

---

## Phase 4

### Unsupervised: catching the unknown
**Weeks 15–18 · ~45h**

Rules catch fraud you anticipated. Supervised models catch fraud that resembles labelled history. Neither catches a new attack pattern on day one — and in fraud, novelty is the adversary's entire strategy, because they adapt specifically to whatever you deployed last quarter. This phase adds the layer that flags "this doesn't look like anything," which is also the layer your README already promised ("per-user behavioral baselines").

#### Learn (≈20h)

CS229 **14–15**. **k-means** (Lloyd's algorithm, why it converges, why it's sensitive to initialisation, k-means++, choosing *k* by elbow and silhouette, and why it assumes spherical equal-variance clusters — an assumption that fraud rings violate). **DBSCAN** (density-reachability, `eps` and `minPts`, why it finds arbitrary shapes, handles noise natively, and doesn't need *k* specified — all three properties make it the right tool for fraud rings, which are irregular, embedded in noise, and of unknown number). **Hierarchical/agglomerative** clustering, linkage criteria, reading a dendrogram. Then **PCA**, derived properly as maximising projected variance, equivalently the eigendecomposition of the covariance matrix, equivalently minimising reconstruction error — and its relationship to SVD.

Clustering evaluation (**UNIT-V**, and unusually specific in your syllabus so learn all of it): Rand index, **Adjusted** Rand index (and why the adjustment for chance matters — plain RI is high for random assignments when clusters are unbalanced), homogeneity, completeness, and V-measure as their harmonic mean, mutual information, and normalised MI. You'll use ARI and NMI for real below.

Also revisit **SVM's dual and kernels** from Phase 2, because **one-class SVM** is the direct application: fit a boundary around the normal data, flag what falls outside. This is UNIT-III's SVM content doing genuine work.

#### Build (≈25h)

**1. Per-user behavioural baselines** — the thing your README named. For each user with enough history, fit a small profile (robust mean and covariance over amount, hour, merchant category distribution, typical location) and score each new transaction by Mahalanobis distance from that user's own normal. Compare three approaches: the Gaussian/Mahalanobis profile, **Isolation Forest** (isolate points with fewer random splits — fast, handles high dimensions, no distribution assumption), and **one-class SVM** with an RBF kernel.

The important measurement is not the anomaly score itself but the **lift**: feed the anomaly score in as a feature to your Phase 2 supervised model and measure whether PR-AUC improves. If it doesn't, say so — an honest negative result belongs in `EXPERIMENTS.md` and in the README. Anomaly scores frequently *don't* help a well-featured supervised model, because good behavioural features already capture most of what they measure; discovering that yourself and reporting it is worth more than a feature you added because it sounded good.

Note the cold-start problem explicitly: a user's first transaction has no baseline. What do you do? (Sensible answer: fall back to a population-level or cohort-level profile and record which was used — the same honesty pattern again.)

**2. Ring discovery beyond exact identifiers.** This is the strongest piece in the phase. Your `muleDetectorService` clusters accounts by union-find over **shared exact identifiers** — same device, IP, fingerprint, or email. That's precise and it's fast, but it misses the ring that's careful: different devices, different IPs, no shared email, yet behaving identically (similar amounts, similar timing, same merchant set, same chain ratio, same in-then-out pattern).

So: build a feature vector per account (behavioural + graph features), reduce with **PCA**, cluster with **DBSCAN**, and see what you find. Then compare the discovered clusters against the union-find rings — DBSCAN should recover most of the known rings *plus* additional behavioural rings that share no identifier. **Validate against PaySim's ground truth using ARI and NMI**, which is exactly what those metrics are for and exactly why PaySim was worth the setup cost in Phase 0.

If this works — and it should — you have a measurable, defensible result: *"union-find over shared identifiers found N rings; DBSCAN over behavioural embeddings found N+M, and the M additional ones were confirmed fraud in ground truth at rate X."* That is a real finding, it's the kind of thing that goes in a write-up, and it's well beyond typical undergraduate project scope.

Surface them on the `10 MULES` screen with a badge distinguishing identifier-linked rings from behavioural ones, since an investigator should know which kind of evidence they're looking at.

**3. Recommendation systems (UNIT-III) — the honest stretch.** This is the weakest syllabus fit in the whole course for your project, and I'd rather say that than invent a use case. The one defensible framing: treat the user–merchant matrix as a collaborative-filtering problem and use it as an *anomaly* signal — "given users behaviourally similar to this one, how surprising is a transaction with this merchant?" Low predicted affinity becomes a feature. It's a legitimate technique (it's roughly how some real card-fraud systems use merchant embeddings), but it's a small effect and a lot of machinery.

Do it as one feature, measure the lift, and if it's negligible, cut it and note why. If you're behind schedule, learn it for the exam and skip the build entirely. Content-based versus collaborative filtering, the cold-start problem, and matrix factorisation are all straightforward exam material.

#### Done when

- [ ] Per-user baselines via Mahalanobis, Isolation Forest, and one-class SVM, compared
- [ ] Anomaly score fed into the supervised model with lift measured (honestly, including if it's zero)
- [ ] Cold-start behaviour defined and recorded
- [ ] PCA + DBSCAN behavioural ring discovery, compared against union-find rings
- [ ] Ring clustering validated against ground truth with ARI, NMI, homogeneity, completeness, V-measure
- [ ] Behavioural rings surfaced on `10 MULES`, badged distinctly
- [ ] Collaborative-filtering feature attempted and measured, or explicitly cut with reasoning
- [ ] **Verification:** for every additional ring DBSCAN found, check the ground-truth label — how many were real?

---

## Phase 5

### Deep learning where it earns its place
**Weeks 19–22 · ~45h**

The honest framing for this phase, which you should also put in your README: **on tabular fraud data, gradient boosting usually beats neural networks.** This is well-established, it's not controversial, and knowing it is a signal of judgment. So the goal here is not to make deep learning win. It's to learn it properly, apply it where it genuinely has an edge, and be able to report a negative result where it doesn't.

That last part is worth stating plainly: an interviewer who hears *"I trained an MLP, it lost to XGBoost by 4 points of PR-AUC, and here's why that's expected on tabular data"* learns far more about you than one who hears *"I used deep learning."*

#### Learn (≈22h)

CS229 **13**, plus your UNIT-IV content. **The perceptron** and its learning rule; **learning Boolean functions** — implement AND, OR, NOT with a single perceptron, then fail to implement XOR, then understand exactly why (not linearly separable) and how a hidden layer fixes it. Your syllabus names this explicitly and it's the cleanest possible motivation for depth.

Then **derive backpropagation by hand** for a two-layer network. Not the chain rule in the abstract — actual matrices, actual dimensions, on paper, and then **implement it from scratch in numpy** with no autograd: forward pass, loss, backward pass, parameter update, and a gradient check against finite differences. The gradient check is the part people skip and the part that proves you got it right.

Then PyTorch, and the practical layer: initialisation (why Xavier/He, what happens with zeros or too-large values), activations (why ReLU replaced sigmoid in hidden layers — vanishing gradients), batch norm, dropout, Adam vs SGD with momentum, learning-rate schedules, early stopping.

#### Build (≈23h)

**1. An MLP on your tabular features.** Same split, same metrics, honest comparison against XGBoost. Try reasonably hard — tune width, depth, dropout, learning rate; use embeddings for high-cardinality categoricals (merchant), which is the one genuinely neural trick that helps on tabular data. Then report what happened. Expect it to land close to but below the boosted trees, at higher latency and worse explainability.

**2. A sequence model over per-user history — where DL can genuinely win.** This is the interesting build. Flat features summarise a user's history into aggregates; a sequence model reads the history *in order* and can learn patterns that aggregates destroy. "Three small transactions then one large one" and "one large then three small" produce identical 24h aggregates and are completely different stories — one is card testing followed by the payoff, the other is normal.

Concretely: for each transaction, take the user's previous *N* (say 20) transactions as a sequence of `(log amount, Δt since previous, merchant-category embedding, device-changed flag, city-changed flag, implied km/h)`, feed it to a **GRU** (or a small Transformer encoder — 2 layers, 4 heads is plenty), concatenate the final hidden state with the current transaction's static features, and predict fraud.

The same leakage discipline applies with extra force: the sequence must contain **only transactions strictly before** the one being scored. Sequence models make leakage easy and invisible — one off-by-one in your windowing and you're feeding the model its own answer. Extend the Phase 1 leakage test to cover sequence construction.

This may genuinely beat gradient boosting, especially on velocity- and enumeration-type fraud where ordering is the signal. If it does, that's a real result worth writing up. If it beats XGBoost on *some* attack types and loses overall, that's even more interesting — an ensemble of the two, or routing by transaction type, becomes a legitimate design discussion.

**3. Optionally, an autoencoder for unsupervised anomaly detection.** Train only on legitimate transactions, flag high reconstruction error. This is a proper deep-learning approach to extreme imbalance (you never need fraud labels to train it) and it connects Phase 4 to Phase 5. Compare it against Isolation Forest — the classical method often wins, which is itself the lesson.

**4. Stretch, only if genuinely ahead: a graph neural network.** GraphSAGE over your identity graph, learning node embeddings that capture ring structure, fed as features to the supervised model. This is the highest-ceiling idea in the entire roadmap — GNNs on transaction graphs are close to the state of the art in real fraud detection, and your identity graph is already built. It's also the most likely thing to consume three weeks. Only start it if Phases 0–4 are genuinely complete.

**5. Face the deployment reality.** Whatever wins, it has to run inside a payment authorisation path. Measure p99 latency honestly, batched and unbatched. If the sequence model needs 200ms and your budget is 100ms, you have three options, and articulating them is the valuable part: trace/quantise the model and re-measure; keep it as an **offline batch scorer** that maintains a per-user risk embedding which the fast online model reads (a very common real architecture — precompute the expensive part, look it up in the hot path); or accept the latency for a filtered subset of high-value transactions only. Pick one, justify it, write it down.

#### Done when

- [ ] Perceptron implemented; XOR failure demonstrated and explained
- [ ] Backprop derived on paper and implemented from scratch in numpy, with a passing gradient check
- [ ] MLP trained and honestly compared against XGBoost, including a negative result if that's the outcome
- [ ] GRU/Transformer sequence model over per-user history, with sequence-level leakage test
- [ ] p99 latency measured for every candidate; a deployment decision made and justified
- [ ] `EXPERIMENTS.md` records what lost as well as what won
- [ ] **Verification:** gradient check against finite differences; and confirm the sequence for transaction *t* contains nothing from *t* or later

---

## Phase 6

### The honesty layer, and ship it
**Weeks 23–26 · ~45h**

This is the phase that makes the project *lovely* rather than merely impressive, and it's the one most people never reach because they're still tuning hyperparameters. Everything here extends the design philosophy already in your README — that a system should tell the truth about its own state — into the ML layer, where almost nobody does it.

#### The honesty features (≈22h)

**1. Drift monitoring — `MODEL: DRIFTING`.** Your platform already blinks `ENGINE: FALLBACK` when the Java engine is unreachable. A model has a subtler failure mode: it keeps returning confident scores while the world moves away from its training distribution. Nothing errors. Nothing alerts. Performance quietly rots.

So monitor it. Compute **population stability index** (or KL divergence) per feature between the training distribution and the last 24 hours of live traffic, and per-feature drift on the score distribution itself. Above a threshold, show `MODEL: DRIFTING` in the sidebar next to the existing engine-health indicator, and say *which features* drifted. That last detail is what makes it actionable rather than decorative.

This is the single most on-brand feature you could possibly add, it's a genuine production concern that separates people who have deployed models from people who have trained them, and the visual parallel with `ENGINE: FALLBACK` will make the point instantly to anyone looking at the screen.

**2. Calibration monitoring.** Drift tells you the inputs changed; calibration tells you whether the outputs are still trustworthy. Maintain a rolling reliability diagram from dispute labels as they arrive, and alert when predicted probabilities stop matching observed fraud rates. A model that has quietly become overconfident is more dangerous than one that's obviously broken, because people still believe it.

**3. Abstention — the model saying "I don't know."** When predictive uncertainty is high (near the threshold, or in a sparse region of feature space, or the user has almost no history), route to human review instead of auto-deciding. Then measure the coverage/accuracy trade-off: what fraction do you abstain on, and how much does accuracy improve on the rest? Your platform already has an honest "unlabeled — we don't know yet" bucket in the backtest report; this is the same instinct applied at decision time.

**4. Bound the collateral damage of the identity-graph cascade.** This one matters most and is the most humane thing in the roadmap.

Your block cascade is powerful: block one identifier, and BFS-to-fixed-point freezes every account that ever shared a device, IP, fingerprint, or email. Against a fraud ring, that's exactly right. But consider a shared family device, a college hostel's NAT'd IP, a cyber-café, or a CGNAT range covering thousands of subscribers. One block could freeze dozens of innocent people's payment ability — and in UPI, that's someone's rent, medicine, or groceries. A false positive here is not an inconvenience; it's real harm to a real person who has done nothing.

So before executing a cascade, compute and show it: **"this block will freeze 14 accounts, 3 of which have no fraud signal and no shared device — only a shared IP."** Require explicit confirmation above a threshold. Log the projected blast radius on every block for later audit. Optionally weight the traversal so weak-evidence edge types (IP alone) don't propagate as far as strong ones (device fingerprint), which is the same edge-cost thinking as your Phase 3 A\* work.

Nobody builds this. It's the feature that shows you understand that a fraud system operates on people, not rows. And it turns precision from an abstract metric into something with a human unit.

**5. A model card.** `MODEL_CARD.md`: training data and its provenance, intended use, out-of-scope use, metrics with confidence intervals (bootstrap them — a single PR-AUC number from one test split is a point estimate with real uncertainty, and reporting it bare is overclaiming), known failure modes, subgroups where it underperforms, and what it explicitly does not do. Write it in the README's existing voice.

#### Reinforcement learning, honestly (≈10h)

**For the exam, learn it properly:** the MDP formalism (states, actions, transitions, rewards, discount factor), the learning task, value and policy iteration, the Bellman equations, Q-learning and its update rule, and exploration/exploitation with ε-greedy. CS229 16–20. This is examinable UNIT-V content and you need it cold.

**For the product, be honest.** Full RL is the wrong tool for the block/allow decision, and the reasons are worth writing out in your README because articulating them demonstrates more understanding than a working Q-learner would:

- **You cannot safely explore.** RL learns by trying actions and observing rewards. The exploratory action here is "allow a transaction you believe is fraudulent to see what happens," which means losing real money and harming a real customer. There is no safe exploration policy in a payment authorisation path.
- **The feedback is censored, not just delayed.** When you block a transaction you never learn whether it was actually fraud — the counterfactual is unobservable. Your reward signal exists only for the actions you *didn't* take, which is a selection-bias problem, not merely a sparse-reward problem.
- **Chargebacks arrive weeks later**, so even the observable rewards are badly delayed relative to the decision.
- **It's not really sequential.** The core decisioning problem is per-transaction classification. Dressing it up as an MDP adds machinery without adding capability.

**But there is one genuinely good RL fit in PayGuard**, and it's a problem you already have: **alert triage as a contextual bandit.** Your `04 ALERTS` screen is a queue, analyst time is finite, and most alerts are false positives. Which alert should the analyst look at *next* to maximise confirmed fraud caught per analyst-hour?

That's a contextual bandit: context = alert features, action = which alert to surface, reward = whether investigation confirmed fraud (via the dispute loop and analyst resolution labels you already collect). Implement **LinUCB** or Thompson sampling, and evaluate it **offline by replaying historical alerts against known outcomes** — no live exploration required, which neatly sidesteps the safe-exploration problem above. That's the honest, defensible application, it addresses a real operational constraint, and it's a much better answer than a bolted-on Q-learner.

#### Ship it (≈13h)

A repo nobody runs is a repo nobody is impressed by.

**Dockerise all four services** and write a `docker-compose.yml` that brings up client, server, fraud-engine, ml-service, and Mongo with one command, with seeded demo data so the dashboard has something to show immediately. Your current README needs three terminals and a `PORT=3000` workaround; one command is the difference between someone trying it and someone closing the tab.

**Deploy it live** with seeded data and a demo login. A URL in your CV converts a repo into something people actually look at.

**Record a 3-minute walkthrough**: live traffic, the model scoring in shadow mode, a rules-vs-model disagreement where the model was right, an A\* path from an account to a known ring, a DBSCAN behavioural ring, a block showing its blast radius, and the drift banner. Three minutes, no talking over dead air.

**Write it up.** A post — "What the rules missed: putting a calibrated model behind a fraud engine" — covering the averaging flaw, the circular-labels trap, the leakage test, the honest baseline, the shadow-mode comparison, and what the learned weights revealed about the hand-picked rule scores. Writing it forces you to find the holes in your own reasoning, and a written artifact travels further than a repo link.

#### Done when

- [ ] PSI/KL drift monitoring with a `MODEL: DRIFTING` indicator naming the drifted features
- [ ] Rolling calibration monitoring from dispute labels
- [ ] Abstention with a measured coverage/accuracy trade-off
- [ ] Blast-radius preview and confirmation on identity-graph cascades, logged per block
- [ ] `MODEL_CARD.md` with bootstrapped confidence intervals
- [ ] RL learned fully for the exam; contextual bandit for alert triage, evaluated by offline replay
- [ ] README section on why full RL is inappropriate for the decisioning path
- [ ] `docker compose up` brings up everything with seeded data
- [ ] Deployed live with a demo login; 3-minute video recorded; write-up published
- [ ] **Verification:** fresh-clone test — wipe everything, clone, `docker compose up`, confirm a working dashboard. Then have someone else try it without your help

---

## The interview layer

The project is the evidence; the interview is where it gets converted. For each phase, rehearse crisp answers to these six, because they're the ones that actually get asked:

1. **Why this model?** ("Logistic regression first because a linear model's weights are directly interpretable and deploy as a JSON of numbers inside the existing Java service — no new infrastructure. Gradient boosting second because fraud is full of feature interactions a linear model can't express, and I could pay for the explainability with SHAP.")
2. **What's your metric and why?** ("PR-AUC. Fraud is under 1% of transactions, so accuracy is meaningless and ROC-AUC flatters the model because its false-positive rate is normalised by a huge true-negative count. Precision reflects the absolute number of false alarms, which is what actually costs analyst hours and customer trust.")
3. **Where's the leakage risk?** ("Two places. Temporal — I split chronologically, never randomly, because random splits let the model see the future. And feature-level — every aggregate is a point-in-time computation, with a CI test that deletes all subsequent rows and asserts the feature vector is unchanged.")
4. **What's the latency budget and do you meet it?** ("The Node server times the Java engine out at 3s; the model service at 100ms. p99 for the boosted model is Xms. The sequence model didn't fit, so it runs as a batch scorer maintaining a per-user risk embedding the online model reads.")
5. **What happens when it's wrong?** ("Both directions matter. A false negative is a fraud loss. A false positive blocks a real person's payment — and because blocking cascades through the identity graph, it can freeze accounts belonging to people who share an IP. So I compute and display the blast radius before a cascade executes.")
6. **How would you know it degraded?** ("PSI per feature against the training distribution, a rolling reliability diagram from chargeback labels, and a `MODEL: DRIFTING` banner naming the drifted features. The failure mode I care about isn't the model erroring — it's the model staying confident while the world moves.")

And be able to do these five cold, on a whiteboard, with no notes:

- Derive the logistic-regression gradient from the Bernoulli likelihood
- Explain bias-variance, and diagnose which one you have from a learning curve
- Explain why PR-AUC beats ROC-AUC under heavy imbalance
- Explain why random k-fold is invalid on temporal data, and what to do instead
- Explain the difference between bagging and boosting in terms of bias and variance

Those five come up constantly, in roughly that order of frequency.

---

## Failure modes

The specific ways this goes wrong, in rough order of likelihood:

**Training on simulator data.** [Flaw 2](#the-two-flaws). It will feel productive and it teaches nothing. Phase 0 exists to prevent it.

**Random train/test split.** Guarantees inflated results and a model that fails in production. Chronological splits, always.

**Feature leakage.** The quiet killer. Any aggregate that touches data at or after the transaction's timestamp invalidates everything downstream. Write the test in Phase 1 and keep it in CI.

**Breadth over depth.** Six tutorials, four Kaggle notebooks, three certificates, nothing finished. One project taken to real depth beats all of it for placements, and this repo is already good enough to be that project.

**Watching CS229 without doing the psets.** Produces a comfortable illusion of understanding that collapses under the first "derive it" question.

**Letting the model become a black box.** Your product's identity is that every decision comes with reasons. An unexplainable model doesn't just miss a nice-to-have — it breaks the thing that makes PayGuard good. SHAP is not optional.

**Chasing architectures on tabular data.** A transformer will not beat LightGBM on 40 tabular features, and trying is a month you don't have. The sequence model in Phase 5 is worth doing because ordering is genuine extra signal, not because it's a transformer.

**Tuning the rules to make the baseline look better.** The gap between rule performance and model performance *is* the project. Protect it.

**Letting the README rot.** It's currently the best thing about the repo — a 31KB document with a sustained analogy and a real point of view. That does real work in making a stranger care. Every phase should add to it.

**Skipping Phase 6 because Phase 5 was interesting.** The honesty layer is what makes this memorable rather than competent. If you have to choose, ship Phase 6 and cut Phase 5 down to the from-scratch backprop and an honest negative result.

---

## What to cut

If you fall behind — and at 10–15 hrs/week with a semester running alongside, you likely will somewhere — cut in this order:

1. **The GNN stretch** in Phase 5. High ceiling, high cost, entirely optional.
2. **Recommendation systems** in Phase 4. Weakest genuine fit. Learn it for the exam, skip the build.
3. **The autoencoder** in Phase 5. Isolation Forest already covers unsupervised anomaly.
4. **The MLP** in Phase 5, down to just backprop-from-scratch plus the honest negative result. Keep the sequence model if you can, since it's the part with a real edge.
5. **The one-class SVM** in Phase 4. Mahalanobis plus Isolation Forest is sufficient coverage; learn the dual for the exam regardless.

**Protect at all costs:** Phase 0 (honest data), Phase 1 (logistic regression, calibration, shadow mode), Phase 2 (ensembles, SHAP, the comparison table), Phase 3 (your exam), and Phase 6's drift monitoring and blast-radius bound.

That protected core is a complete, honest, deployed system that fixes a real flaw with real data and knows when it's failing. It beats a half-finished transformer every single time — in interviews, and in being something you're actually proud of.

---

## A closing note

The reason this project can be genuinely lovely and not just technically impressive is already written into it. Your README says the platform "is honest about it — when the scoring engine is down, it says so, openly, instead of pretending everything is fine." That's a real point of view, and it's rarer than good code.

Machine learning is where that value gets tested hardest, because ML makes it *so easy* to be dishonest without meaning to be: circular labels, leaked features, random splits, uncalibrated scores that look like probabilities, silent drift, a black box that can't say why. Every one of those is a system pretending everything is fine.

So the thread running through all seven phases is the same as the thread already running through PayGuard: **build the fraud model that admits what it doesn't know.** Calibrated, so its confidence means something. Explainable, so every decision comes with reasons. Shadow-tested, so it earns trust before it gets power. Drift-monitored, so it says when it's lost. Abstaining, when it should defer to a human. And bounded, so it remembers that on the other side of a false positive is a person who needed to pay for something.

That's the project. It's a lot, and it's achievable, and the version of it that exists in six months will be better than what's described here — because you'll have learned things in Phase 2 that change what you'd build in Phase 4. Treat this document as a live one and edit it as you go.

Start with Phase 0. Get real data in and find out how good your rules actually are. Everything else follows from that number.
