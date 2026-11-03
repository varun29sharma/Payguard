# PayGuard

Real-time fraud detection for payment transactions. Every transaction is checked against a blocklist and scored by a set of fraud rules before it is saved. Transactions that look suspicious create an alert for a human analyst, who can block the user — and, through an identity graph, every account connected to them.

This README is written in plain technical language on purpose: every term here is the term used in the code. For a function-by-function walkthrough, see **FUNCTION-GUIDE.md**.

## Architecture — 3 services + 1 offline script

| Part | Folder | Stack | Port | Job |
|---|---|---|---|---|
| Dashboard | `client/` | React + Vite | 5173 | Analyst UI: live feed, alerts, rules, simulator |
| API server | `server/` | Node.js + Express, MongoDB, Socket.IO | 3000 | Orchestrates everything: auth, blocklist, pipeline, alerts |
| Fraud engine | `fraud-engine/` | Java 17 + Spring Boot | 8080 | Scores one transaction against 6 rules |
| ML experiment | `ml/` | Python (standard library only) | — | Offline only. Shows how a model would learn from labelled data. Not part of the live system. |

## How a transaction flows through the system

`server/services/transactionService.js` → `createTransaction()`:

1. **Blocklist check.** All identifiers on the transaction (user, device, account, fingerprint, session, IP, wallet, email, phone) are checked against the blocklist. A hit is saved as `blocked` with score 100 and never reaches the engine.
2. **Scoring.** The transaction is sent to the Java engine (`POST /api/fraud/score`, 3-second timeout) together with the current rule configuration. If the engine is down, the transaction is saved with score 0 and `scoringEngine: 'fallback'` — visibly unscored, never silently passed off as checked.
3. **Blocklist re-check.** Scoring takes time. If the user was blocked *while* scoring was in progress, the step-1 answer is stale, so the blocklist is checked again immediately before saving. A hit here means the API answers 403.
4. **Save + alert.** The transaction is saved with its score and the rules that fired. If the status is not `clear`, a `FraudAlert` is created and pushed to the dashboard in real time via an event bus → Socket.IO.

## The fraud engine (Java)

Six rules, one class each, all implementing the same interface (`FraudRule.evaluate()`) — this is the Strategy pattern: adding a rule means adding one class, nothing else changes.

| Rule | Fires when | Score |
|---|---|---|
| `AMOUNT_THRESHOLD_RULE` | amount > ₹1,00,000 | 65 |
| `VELOCITY_RULE` | more than 5 transactions in 60 seconds from one user | 60 |
| `ENUMERATION_ATTACK_RULE` | 8 or more transactions of ≤ ₹50 in 30 minutes (card testing) | 75 |
| `GEOGRAPHIC_ANOMALY_RULE` | same user in 2 different cities within 120 minutes | 80 |
| `NEW_DEVICE_RULE` | device never seen before for this user | 55 |
| `NIGHT_OWL_RULE` | transaction between 00:00 and 05:00 local time | 40 |

**Final score = the highest score of the rules that fired** (0 if none fired). Status: 0–39 `clear`, 40–69 `review`, 70–100 `blocked`.

Why the maximum and not the average: an earlier version averaged the fired rules' scores, which meant *more* evidence could produce a *lower* score (impossible travel alone = 80 → blocked; impossible travel + night rule = (80+40)/2 = 60 → review). Each rule's score already means "this signal alone is this serious", so the strongest signal decides.

Four rules are stateful: velocity, enumeration, geographic and new-device keep per-user history in in-memory maps. That is simple and fast, and it means the state is lost on restart and not shared between engine instances — a known limitation, listed below.

**Rule configuration is not hardcoded.** Thresholds, scores and on/off flags live in MongoDB and are edited from the dashboard (`07 Rules` screen). The Node server sends the current config with *every* scoring request, so a change applies to the very next transaction with no restart. The engine itself stores no config.

**Backtest.** `POST /api/fraud/backtest` replays past transactions through a proposed config so an analyst can see the effect of a change before applying it. Each replay uses brand-new rule instances, so replayed history cannot pollute the live rules' state.

## The API server (Node.js)

- **Auth:** analysts log in with email/password (bcrypt) and get a JWT. Machine clients (e.g. a payment switch sending transactions) use an API key in the `x-api-key` header instead; keys are stored bcrypt-hashed. Login/register are rate-limited (20 requests / 15 min per IP); the whole API has a 1000 / 15 min backstop. `helmet` sets security headers.
- **Identity graph & cascade blocking** (`services/identityGraphService.js`, `services/blocklistService.js`): identifiers that appear together on a transaction are treated as belonging to the same operation. Blocking one identifier runs a breadth-first search (up to 5 rounds) collecting every connected identifier, and blocks them all — one block stops a whole fraud ring.
- **Campaign detection** (`services/campaignDetector.js`, every 60 s): groups recent alerts into coordinated attacks (e.g. one device shared by many accounts).
- **Mule detection** (`services/muleDetectorService.js`, every 45 s): flags accounts that in 24 h received ≥ ₹10,000 from ≥ 2 different senders and forwarded ≥ 60% of it; flagged accounts sharing identifiers are clustered into rings with union-find.
- **Disputes** (`services/disputeService.js`): a chargeback is external proof of fraud. Ingesting one marks the transaction `isConfirmedFraud`, and the detection report measures, per rule, how much of the now-known fraud each rule actually caught at scoring time.
- **Merchants** (`services/merchantService.js`): a risk profile per merchant (volume, fraud rate, dispute rate, risk tier), updated after each transaction.
- **Cases** (`services/caseService.js`): alerts get a priority and response deadline (SLA) based on their score; breaches are flagged automatically.

## Data model (MongoDB)

`User` (analysts) · `Transaction` · `FraudAlert` · `BlockList` · `BlockedActivityLog` · `AuditLog` · `Campaign` · `RuleConfig` · `ApiKey` · `Dispute` · `MuleRing` · `Merchant`

Nothing is deleted: blocked attempts, resolved alerts and audit entries are kept as records.

## The dashboard (React)

12 screens: Home, Operations (live feed + charts), Intel (campaigns), Alerts (triage queue), Simulator (generate attack patterns), Blocklist, Rules, Backtest, Disputes, Mules, Merchants, Graph (identity-graph explorer). All live updates arrive over Socket.IO — the UI never polls.

## Quick start

```bash
# 1. Fraud engine (Java, port 8080)
cd fraud-engine && ./mvnw package -DskipTests
java -jar target/fraud-engine-0.0.1-SNAPSHOT.jar

# 2. API server (Node, port 3000) — needs MongoDB; set MONGO_URI and JWT_SECRET in server/.env
cd server && npm install && node index.js

# 3. Dashboard (React, port 5173)
cd client && npm install && npm run dev
```

Or `./start-all.sh` (starts all three; build the engine jar first).

A demo analyst account is seeded on first boot so the app can be tried immediately. **Change or remove the seeded demo credentials and the seeded demo API key before any real deployment** — they exist only for local demos. Never commit a real `server/.env`.

## The Python part

`ml/simple_model.py` — one file, standard library only, ~200 lines. It generates labelled sample transactions, converts each to 4 features, trains a logistic regression by gradient descent, and reports accuracy, precision and recall on held-out data. Run it: `python3 ml/simple_model.py`. It is an offline learning experiment; the live system does not call it.

## Known limitations (say these before an interviewer finds them)

- **A `blocked` score is a label, not a declined payment.** Transactions scoring 70+ are saved and create an alert; the only hard rejection (403) is a blocklist hit. In a real payment system, `blocked` would stop the authorisation.
- **Rule state is in the Java engine's memory.** Restarts clear it, and multiple engine instances would not share it. Production would move it to Redis or a database.
- **Thresholds are hand-chosen**, not learned from data. `ml/` is the start of measuring how well they actually work.
- **Rule-config changes are authenticated but not role-gated.** Production should make them admin-only.

## Tests

```bash
cd fraud-engine && ./mvnw test     # Java: rule tests (e.g. NightOwl midnight wrap-around)
cd server && npm test              # Node: transaction input validation
python3 ml/simple_model.py         # Python: trains and evaluates, prints metrics
```
