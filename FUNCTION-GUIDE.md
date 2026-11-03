# PayGuard — Function Guide

How to use this in an interview: for any file they open, you should be able to say (1) what the file is for, (2) what each function does, (3) why it is written that way. That is all this document is — file by file, in the order a transaction flows.

---

# Part 1 — Java fraud engine (`fraud-engine/`)

The engine's whole job: **input** one transaction + rule config, **output** a score, a status, and the list of rules that fired. It stores no transactions and no config.

## The contract first

### `rules/FraudRule.java` — the interface every rule implements
- `evaluate(transaction, config)` → returns `Optional<RuleResult>`: a result **if the rule fired**, `Optional.empty()` if it did not. Optional is used instead of `null` so "did not fire" can never cause a NullPointerException.
- `getRuleName()` → the rule's name, e.g. `"VELOCITY_RULE"`. The scoring service uses it to find the rule's config.

*Interview line:* "Every rule has the same shape, so the scoring service treats them uniformly — that's the Strategy pattern. Adding a rule = adding one class."

### `model/TransactionRequest.java` — what a transaction looks like to the engine
Plain data class (getters/setters): ids, amount, timestamp, deviceId, location, and the list of `RuleConfig` for this request. Jackson annotations map the JSON the Node server sends onto these fields.

### `model/RuleConfig.java` — one rule's settings for one request
Fields: `ruleName`, `enabled`, `score`, `parameters` (a map).
- `scoreOrDefault(d)` → the configured score, or `d` if none was configured.
- `intParam / longParam / doubleParam / boolParam(key, default)` → read one threshold from the parameters map, with a fallback. Rules call e.g. `config.intParam("maxTransactions", 5)`, so every threshold has a safe built-in default even if the database config is incomplete.

### `model/FraudResult.java` — what the engine answers
Fields: `score` (0–100), `status` (`clear` / `review` / `blocked`), `rulesTriggered` — a list of `RuleResult` (ruleName, score, human-readable reason). The reason matters: every decision arrives with an explanation an analyst can read.

## The decision

### `service/FraudScoringService.java`
- Constructor: Spring injects **all** classes implementing `FraudRule` as one list. The service never names a concrete rule.
- `score(txn)`:
  1. For each rule, `resolveConfig()` finds that rule's config inside the request; a disabled rule is skipped entirely.
  2. `evaluate()` each remaining rule, collect the ones that fired.
  3. **Final score = maximum fired score** (0 if none). *Why not the average the old code used: averaging lets a weak extra signal drag a strong verdict down — 80 alone is blocked, 80 averaged with 40 is 60, only review. More evidence must never look safer.*
  4. Bands: ≥70 `blocked`, ≥40 `review`, else `clear`.
- `resolveConfig(txn, ruleName)`: linear scan of the request's config list; returns a default "enabled, built-in values" config when a rule is absent — never null, so rules can rely on it.

### `controller/FraudController.java` — the HTTP surface
- `scoreTransaction()` → `POST /api/fraud/score`: hand the request to `FraudScoringService.score()`, return the result.
- `backtest()` → `POST /api/fraud/backtest`: convert the JSON body into typed config + transaction lists, call `BacktestService.replay()`, return results with a count and duration.
- `castRuleConfigs()` / `ruleConfigFromMap()` / `castTransactions()`: the backtest body arrives as untyped maps; these convert them into `RuleConfig` / `TransactionRequest` objects. Malformed rows are skipped rather than failing the whole run.
- `health()` → `GET /api/fraud/health`: status, uptime, and the sorted list of active rule names. The Node server polls this to show "engine up / engine fallback" on the dashboard.

### `service/BacktestService.java`
- `freshRules()` → builds **brand-new instances** of all 6 rules.
- `replay(config, transactions)` → creates a scoring service over those fresh rules, attaches the candidate config to each transaction, scores them in order, returns one result row per transaction.
- *Why fresh instances:* 4 rules keep per-user history in memory (see below). Replaying history through the live rule objects would both pollute live detection and corrupt the replay. Fresh instances = a clean, isolated "what if".

## The 6 rules — `rules/`

Each `evaluate()` follows the same pattern: check its one condition → return a `RuleResult` with the configured score and a reason string, or `Optional.empty()`.

| Class | Condition (defaults) | State it keeps |
|---|---|---|
| `AmountThresholdRule` | `amount > minAmount` (₹1,00,000) | none — pure check on this transaction |
| `VelocityRule` | more than `maxTransactions` (5) from this user within `windowSeconds` (60) | map: user → list of recent timestamps. On each call it first drops timestamps older than the window (a sliding window), then counts. |
| `EnumerationAttackRule` | at least `maxMicroTxns` (8) transactions of ≤ `microAmountThreshold` (₹50) within 30 min — the signature of card-number testing | map: user → timestamps of micro transactions |
| `GeographicAnomalyRule` | user's current city differs from another sighting within `windowMinutes` (120) — "impossible travel" | map: user → list of (city, time) sightings; `cityOf()` extracts the city from the request location |
| `NewDeviceRule` | device id not in the set of devices this user has used before | map: user → set of known device ids. First use fires *and is remembered*, so the same device does not fire twice. |
| `NightOwlRule` | transaction hour inside the configured window (00:00–05:00) | none. Note the midnight-wrap case: a window like 22:00–05:00 means `hour >= 22 OR hour <= 5`. It is tested in `NightOwlRuleTest` because the plain-interval version of this check made the rule silently never fire. |

State uses `ConcurrentHashMap` because Spring rule beans are singletons shared across request threads.

### `FraudEngineApplication.java`
`main()` — starts Spring Boot. Nothing else; all wiring is by annotations (`@Service`, `@Component`, `@RestController`).

---

# Part 2 — Node.js server (`server/`)

The server's job: **orchestrate**. It owns the database, the blocklist, the pipeline, and the real-time events. It does not score transactions itself — it asks the Java engine.

## The pipeline (learn this file first)

### `services/transactionService.js`
- `parseTimestamp(raw, { allowPastTimestamp })` → decides the transaction's time. Future timestamps are rejected; old timestamps are accepted only from API-key callers (replay), because letting a normal session backdate a transaction would let it slip behind rule windows.
- `buildTransactionInput(body)` → validation + cleaning. Checks required fields (`userId`, `merchantId`, `amount`), converts amount to a number, defaults currency to INR, copies any identity fields present. `beneficiaryId` (who received the money) is kept **separate** from the payer's identity fields — blocking a payer must never auto-block the people they paid.
- `rejectTransaction(input, blockEntry)` → saves a blocked attempt (score 100, rule `BLOCK_LIST`) and emits events. Blocked attempts are saved, not dropped — there is always a record.
- `createTransaction(body)` → the 4 steps:
  1. `extractIdentifiers()` + `isAnyIdentifierBlocked()` → blocked? save-and-return.
  2. `callFraudEngine()` → score. On error: score 0, `scoringEngine = 'fallback'`, and the fallback is recorded so the UI can display it.
  3. Blocklist check **again** → a block created during step 2 must still catch this transaction (race condition; the controller answers 403 for this outcome).
  4. Save. If status ≠ `clear`: create a `FraudAlert`, assign its SLA via `caseService.ensureSLA()`, emit events, and nudge campaign detection. Merchant profile update runs fire-and-forget via `setImmediate` so it never slows the response.

*Test:* `test/transactionInput.test.js` tests `buildTransactionInput` directly (it is pure — no DB), using Node's built-in test runner. Run `npm test`.

### `utils/fraudEngineClient.js`
- `callFraudEngine(transaction)` → fetches the current rule configs, builds the payload (transaction + configs), POSTs to the engine with a 3-second timeout, returns `{ score, status, rulesTriggered }`. *This is where "config travels with every request" actually happens.*
- `checkFraudEngineHealth()` → GETs the engine's `/health`; never throws — returns `{ up: false, ... }` when unreachable, so callers can degrade instead of crashing.

### `services/engineHealthService.js`
Polls the engine health on an interval, keeps the last known state, records scoring fallbacks (`recordScoringFallback()`), and emits `ENGINE_HEALTH` events when availability changes — this powers the dashboard's engine indicator.

## Blocking and the identity graph

### `services/identityGraphService.js`
- `extractIdentifiers(source)` → pulls the 9 identity fields (user, device, account, fingerprint, session, IP, wallet, email, phone) out of any object, skipping empty/"unknown" values.
- `buildConnectedIdentifiers(seeds)` → **breadth-first search to a fixed point**: find all transactions touching the seed identifiers, collect every other identifier on those transactions, repeat with the new ones (max 5 rounds) until nothing new appears. This connected set is "the ring".

### `services/blocklistService.js`
- `isAnyIdentifierBlocked(identifiers)` → is any of these on the blocklist? Used in pipeline steps 1 and 3.
- The block operation: create `BlockList` entries for the seed **and the whole connected set**, reject queued transactions touching them, auto-resolve their open alerts, and write `AuditLog` + `BlockedActivityLog` entries. Nothing is deleted; blocks are archived records.

## Detectors (background jobs started in `index.js`)

### `services/campaignDetector.js` — `detectCampaigns()` (every 60 s)
Scans recent alerts for coordinated patterns (a device shared across many accounts, a merchant cluster, an enumeration wave) and creates/updates `Campaign` records with severity and exposure.

### `services/muleDetectorService.js` — `detectMuleRings()` (every 45 s)
For each account, over 24 h: received ≥ ₹10,000 **and** from ≥ 2 distinct senders **and** forwarded ≥ 60% of it **and** money arrived before it left. Flagged accounts are clustered into `MuleRing`s by shared identifiers using **union-find** (each shared device/IP merges two accounts into one set). `POST /api/mules/:ringId/block` blocks a whole ring through the blocklist cascade.

### `services/caseService.js`
- `ensureSLA(alert)` → sets the alert's priority and response deadline from its score.
- `checkSLABreaches()` (every 60 s) → marks open alerts whose deadline passed as breached.

### `services/merchantService.js`
- `upsertFromTransaction(txn)` → updates the merchant's running totals (volume, flagged count, dispute count) and recomputes its risk tier after each transaction.

### `services/disputeService.js`
- Ingest: validate → reject unknown transaction (404) and exact duplicates (409) → save the `Dispute` → if the reason is a fraud type or the dispute was lost, set `isConfirmedFraud = true` on the transaction (external ground truth).
- Detection report: over all confirmed-fraud transactions, count caught-at-scoring-time vs missed, overall and **per rule** — using the rules that actually fired back then, stored on the transaction, not recomputed hindsight.

### `services/ruleConfigService.js`
- `DEFAULT_RULES` → the 6 rules with their built-in defaults (mirrors the Java defaults).
- `getRuleConfigs()` → DB rows merged over defaults (so the list is always complete), with a 5-second in-memory cache that updates invalidate immediately.
- `ensureDefaultRules()` → idempotent boot-time seed (insert each rule only if missing).
- `updateRuleConfig(ruleName, patch)` → validates (known rule name; score 0–100), upserts, invalidates the cache.

### `services/graphService.js`
Builds the node/edge graph (identifiers as nodes, shared transactions as edges) that the dashboard's Graph screen renders with d3-force. Distinct from `identityGraphService`: that one answers "what is connected" for blocking; this one answers "show it to me" for visualisation.

### `services/auditLogService.js`
One helper that writes an immutable `AuditLog` entry (who did what, when) — called by block, alert and rule-change actions.

## HTTP layer — thin by design

**Controllers** (`controllers/`) translate HTTP ↔ services. They contain no business logic worth naming beyond their endpoint's name:
- `authController` — `generateToken()` (sign a JWT), `register`, `login` (bcrypt compare).
- `transactionController` — `createTransaction` (maps pipeline outcome to 201 / 403), `getTransactions`, `getTransactionsExport` (CSV, via `csvEscape()`), `getStats`, `getUserTimeline`, `getHeatmap`, `getRuleBreakdown`.
- `alertController` — list alerts; analyst actions: `resolveAlert`, `blockUser`, `blockDevice`, `escalateAlert`, plus case actions (`assignCase`, `addNote`, `setPriority`, `transitionCaseStatus`, `getTimeline`).
- `backtestController` — `runBacktest()`: load past transactions, `replay()` them through the engine twice (current config vs proposed config), `summarize()` both runs, return the difference (newly flagged, no longer flagged, per-rule counts).
- `disputeController`, `merchantController`, `muleController`, `graphController`, campaign/blocklist handlers — same pattern: parse request → call the service of the same name → return JSON.

**Routes** (`routes/`) map URLs to controllers and attach middleware (`protect` = JWT required, `protectOrApiKey` = JWT or machine API key). One file per resource, mounted in `index.js`.

**Middleware** (`middleware/`):
- `authMiddleware.protect` → verify JWT, attach `req.user`, 401 if invalid.
- `apiKeyAuth` → find the API key by hash comparison (bcrypt) for machine ingest.
- `socketAuth` → same JWT check for the Socket.IO handshake.
- `rateLimiters` → 20/15 min on auth endpoints, 1000/15 min API-wide.
- `errorHandler` → converts thrown errors (e.g. `ValidationError` from `utils/errors.js`) into consistent JSON responses; `asyncHandler` wraps async controllers so rejections reach it.

**Events** (`events/`): services emit domain events on `eventBus.js` (a Node `EventEmitter` with named constants). `socketBridge.js` is the *only* place that forwards bus events to Socket.IO clients, and it throttles stats broadcasts (`scheduleStatsBroadcast()`). Adding a live UI event = emit in a service + one line in the bridge.

**Models** (`models/`): one Mongoose schema per collection — `Transaction` (the central record: identity fields, amount, score, status, rules triggered, scoring source, confirmed-fraud flag), `FraudAlert`, `BlockList`, `RuleConfig`, `User`, `ApiKey`, `Dispute`, `Campaign`, `MuleRing`, `Merchant`, `AuditLog`, `BlockedActivityLog`.

**`index.js`** — boot order: load env → connect MongoDB → seed demo user, demo API key and default rules (all idempotent) → middleware (helmet, CORS, JSON, rate limit) → mount routes → error handler → Socket.IO with auth + bridge → start the three background jobs (engine health, campaigns every 60 s, mules every 45 s, SLA every 60 s) → listen on port 3000.

**`config/db.js`** — `connectDB()`: connect Mongoose to `MONGO_URI`, log and exit on failure.

---

# Part 3 — Python (`ml/simple_model.py`)

One file, standard library only, offline. Its job: demonstrate that a model can *learn* the same patterns the Java rules encode, and measure it honestly. The live system never calls it.

| Function | Purpose |
|---|---|
| `make_sample_data(count, seed)` | Generates labelled transactions. Fraud probability rises with large amount, night hour, many recent transactions, new device — the same signals as the rules. Fixed seed = same data every run, so results are reproducible. |
| `to_features(txn)` | Converts a transaction into 4 numbers in ~0–1 range: amount/200000, is-night (0/1), recent-count/12, new-device (0/1). Scaling matters because gradient descent is sensitive to feature size — an unscaled rupee amount would swamp the 0/1 features. |
| `sigmoid(z)` | Squashes any number into a probability: `1 / (1 + e^-z)`. |
| `train(rows, epochs, learning_rate)` | Gradient descent. For each row: predict, compute `error = prediction − actual`, nudge each weight by `−learning_rate × error × feature`, and the bias by `−learning_rate × error`. After training, a weight's sign/size says how much that feature raises fraud risk. |
| `predict(weights, bias, features)` | `sigmoid(bias + Σ weightᵢ × featureᵢ)` — the probability this transaction is fraud. |
| `evaluate(weights, bias, rows)` | On **held-out** data (the model never trained on it): accuracy, precision (of what we flagged, how much was real — false alarms cost analyst time), recall (of real fraud, how much we caught). |
| `main()` | 80/20 train/test split → train → print learned weights and metrics. States plainly that the data is synthetic, so the numbers demonstrate the method, not real-world performance. |

Typical output: all four weights come out positive (the model rediscovered the planted patterns), accuracy ≈ 0.68, precision ≈ 0.62, recall ≈ 0.57.

*Interview line:* "The rules are the product. The Python file is the experiment that shows how you'd replace hand-chosen thresholds with learned weights later — and how you'd measure whether that's actually better, using precision and recall instead of accuracy, because fraud is rare and accuracy rewards predicting 'not fraud' for everything."

---

# Part 4 — React dashboard (`client/src/`), briefly

- `api/axiosConfig.js` — one axios instance; attaches the JWT to every request.
- `api/socket.js` — the Socket.IO client connection.
- `context/AuthContext.jsx` / `ThemeContext.jsx` — logged-in user and light/dark theme, shared app-wide.
- `components/shared/` — the components pages actually use: `Layout` (sidebar + frame), `Sidebar`, `StatCard`, `StatusBadge`, `FraudScore`, `Skeleton`.
- `components/GraphExplorer/ForceGraph.jsx` — d3-force rendering of the identity graph.
- `pages/` — one file per screen (12): `HomePage`, `Dashboard` (operations), `Intelligence` (campaigns), `Alerts`, `Simulator` (fires synthetic attack bursts at the API so the whole pipeline can be demoed), `BlockList`, `Rules`, `Backtest`, `Disputes`, `Mules`, `Merchants`, `GraphExplorer`, `LoginPage`.
- `hooks/useEngineHealth.js` — subscribes to engine-health socket events; `hooks/useCountUp.js` — animated number counters; `utils/ruleMeta.js` — display names/descriptions for the 6 rules, used by the Rules and Backtest screens.
