# PAYGUARD<span style="color:#FF3B00">!</span>

**Real-time fraud intelligence for UPI & payment networks.**

Every transaction gets a decision. Nothing gets deleted. And the platform is honest about it — when the scoring engine is down, it says so, openly, instead of pretending everything is fine.

---

## Table of contents

1. [The one-minute read](#the-one-minute-read)
2. [The restaurant — the master analogy](#the-restaurant)
3. [The menu of problems](#the-menu-of-problems)
4. [The kitchen — the Java scoring engine](#the-kitchen)
5. [The maître d' — the Node server](#the-maître-d)
6. [The black book & family tree — blocklist and identity graph](#the-black-book--family-tree)
7. [The recipe book — runtime rule configuration](#the-recipe-book)
8. [The tasting room — the backtest harness](#the-tasting-room)
9. [The health inspector — disputes and detection rates](#the-health-inspector)
10. [The cash-out watch — mule detection](#the-cash-out-watch)
11. [The security guard — auth, rate limits, headers](#the-security-guard)
12. [The dining room — the ten screens](#the-dining-room)
13. [A dish's journey — one transaction, end to end](#a-dishs-journey)
14. [Architecture](#architecture)
15. [Quick start](#quick-start)
16. [Production notes](#production-notes)
17. [Summary](#summary)

---

## The one-minute read

PayGuard is a three-part fraud-intelligence platform for payment networks. A **Java scoring engine** evaluates every transaction against six fraud rules before it commits; a **Node.js API** orchestrates the pipeline, blocks fraud rings through an identity graph, and detects laundering patterns; and a **React dashboard** gives the analyst a calm, real-time view of everything — with runtime-tunable rules, a backtest harness to prove rule changes before deploying them, and a dispute loop that measures how well the system actually catches the fraud it now knows about.

The whole thing is built like a fine-dining restaurant, and every part of the system maps to something in that restaurant. That analogy is the skeleton of this document — read it once and the architecture stays with you.

---

## The restaurant

Think of PayGuard as a fine-dining restaurant where every dish is inspected before it leaves the kitchen, the recipe book can be rewritten live, and the health inspector's reports come back to the chef so the menu keeps improving.

| The restaurant | PayGuard | What it does |
|---|---|---|
| **The dining room** | React dashboard | A clean, Swiss-editorial floor where the maître d' (analyst) watches every table in real time — new dishes, rejected plates, suspicious activity — the moment it happens. |
| **The maître d'** | Node.js + Express API | Takes every order (transaction), checks the black book, sends each dish to the kitchen for inspection, and only lets an order out that passes — with a final re-check at the door so a dish blocked mid-flight is never reported as served. |
| **The kitchen** | Java scoring engine | A dedicated Spring Boot kitchen where six specialist inspectors evaluate every dish before it's served. |
| **The recipe book** | Runtime rule configuration | The head chef rewrites thresholds — portion sizes, speed limits, opening hours — live, without retraining the kitchen. The kitchen reads the recipe with every dish it cooks. |
| **The tasting room** | Backtest harness | Before changing the menu, the chef tries the new recipe against *yesterday's actual diners*: what would have been flagged, blocked, or missed. |
| **The health inspector** | Dispute / chargeback loop | Official confirmation that a meal was bad. The kitchen's catch-rate per inspector is then measured against reality — of the fraud we now know about, who caught it? |
| **The suspicious cash-out** | Mule detection | A server who collects cash from many tables and hands most of it to one courier within a shift is flagged. Staff sharing a locker are one operation. |
| **The black book & family tree** | Blocklist + identity graph | Ban one guest and everyone who ever shared their table, credit card, phone, or device is turned away too — one block stops the whole ring. |
| **The security guard** | Auth, API keys, rate limits, security headers | Only staff and trusted delivery partners get in, and the door stops brute-force key guessing. |
| **The kitchen display** | Socket.IO | Every dish's fate appears on the floor instantly — new transactions, alerts, engine health, mule rings — all pushed live. |
| **The ledger** | MongoDB | Every order ever taken is recorded permanently: transactions, alerts, blocks, rule configs, disputes, rings. Nothing is ever deleted. |

Every section below is one of these characters, in depth.

---

## The menu of problems

Why does a restaurant need six inspectors at all? Because the fraud this system defends against is not one thing — it's a menu of distinct, well-studied attacks, and each one has a signature.

- **Enumeration / card testing.** Attackers probe card numbers with many tiny transactions (under ₹50 — deliberately below classic velocity limits) until one succeeds. *Signature: a burst of micro-transactions.*
- **Velocity abuse.** A compromised account is drained with many rapid transactions before the victim notices. *Signature: more orders from one table than any human could place.*
- **High-value payouts.** Account-takeover attackers move large amounts in a single shot. *Signature: one dish far above the guest's normal spend.*
- **NFC relay / card sharing.** A card's data is replayed from a geographically distant location moments after a legitimate use. *Signature: one guest "ordering" from two cities at once.*
- **Account takeover.** An attacker logs in from their own hardware. *Signature: a regular ordering from a device they've never used.*
- **Bots.** Automated scripts operate outside human hours. *Signature: activity in the dead of night.*
- **Mule laundering.** Money is received from many victims and quickly forwarded to a single beneficiary — the mule keeps a cut. *Signature: receive-and-forward within hours, across many senders.*

The kitchen's six inspectors exist to catch these signatures. The identity graph, the dispute loop, and the mule detector exist to catch the *rings* those signatures form.

---

## The kitchen

The kitchen is the **Java + Spring Boot microservice** (`fraud-engine/`, port 8080) — a separate process so it can scale and be tuned independently of the rest of the system. It exposes two endpoints:

- `POST /api/fraud/score` — evaluate one transaction, return a score and the rules that fired.
- `POST /api/fraud/backtest` — replay a batch of historical transactions under a candidate configuration (used by the tasting room).
- `GET /api/fraud/health` — report the kitchen's status, uptime, and the rules it can enforce.

### The six inspectors

| Inspector | Rule | Default threshold | Score | Catches |
|---|---|---|---|---|
| **Portion-size checker** | `AMOUNT_THRESHOLD_RULE` | amount > ₹1,00,000 | 65 | High-value payouts |
| **Speed checker** | `VELOCITY_RULE` | > 5 transactions in 60s per user | 60 | Velocity abuse, account draining |
| **Micro-sampling checker** | `ENUMERATION_ATTACK_RULE` | ≥ 8 micro-transactions (≤ ₹50) in 30 min | 75 | Card testing / enumeration |
| **Impossible-travel checker** | `GEOGRAPHIC_ANOMALY_RULE` | 2+ cities within 120 min per user | 80 | NFC relay / card sharing |
| **Unfamiliar-face checker** | `NEW_DEVICE_RULE` | first use of a device for a user | 55 | Account takeover |
| **After-hours checker** | `NIGHT_OWL_RULE` | between 00:00–05:00 local | 40 | Bots, off-hours scripts |

### How a dish is scored

Each inspector examines the transaction and either passes it (no signal) or raises a flag with a **severity score**. The dish's final fraud score is the **average of every rule that fired**:

- **0–39 → `clear`** — served normally.
- **40–69 → `review`** — served, but an **alert** is raised for the analyst (this is what fills the triage queue).
- **70+ → `blocked`** — refused at the door.

Two rules carry their own state: the speed checker and micro-sampling checker keep a sliding window of recent transactions per user, and the unfamiliar-face checker *remembers* devices it has seen so legitimate repeat orders don't re-trigger it.

### Why the kitchen is a pure function

The kitchen holds no configuration of its own. Every scoring request carries the current rule configuration (see [the recipe book](#the-recipe-book)), so a fleet of kitchen instances can never serve stale rules, and a config change applies to the very next transaction — no restart, no redeploy.

And critically: when the tasting room runs a backtest, the kitchen **builds brand-new inspector instances per run**. Replayed history never touches the live inspectors' sliding windows, and the backtest is a clean, isolated "what-if."

---

## The maître d'

The maître d' is the **Node.js + Express server** (`server/`, port 3000). It runs the floor: it takes every order, knows the black book, talks to the kitchen, and decides what actually leaves. It also runs the real-time display, the detectors, and the analytics.

### The four-step service pipeline

Every transaction passes through the same four steps in `services/transactionService.js`:

1. **The black book check.** Every identifier on the order (user, device, IP, fingerprint, email, phone, …) is checked against the blocklist. If any is blocked, the dish is rejected immediately with a `BLOCK_LIST` flag at score 100 — it never reaches the kitchen.
2. **The kitchen's verdict.** The order is sent to the Java engine for scoring (3-second timeout). If the kitchen is unreachable, the maître d' does **not** fake a verdict — it serves the dish marked `scoringEngine: 'fallback'`, records the fallback, and the UI shows a blinking **ENGINE: FALLBACK** so everyone knows these orders were let through unscored.
3. **The final re-check.** The moment before commit, the black book is checked *again*. This closes the race window: if the entity was blocked *while* the dish was being scored, the dish is rejected mid-flight and **never reported as successful** — a blocked transaction is never reported as served (a real bug this architecture was rebuilt to fix).
4. **The commit.** The transaction is saved with its score, status, triggered rules, and scoring source. If it scored `review` or `blocked`, a **FraudAlert** is created for the triage queue, and campaign detection is nudged.

### The event bus and the kitchen display

All domain events — `NEW_TRANSACTION`, `NEW_FRAUD_ALERT`, `BLOCK_CREATED`, `ENGINE_HEALTH`, `MULE_RING_NEW`, `DISPUTE_INGESTED`, and more — are emitted onto a **central event bus** (`events/eventBus.js`). One bridge (`events/socketBridge.js`) forwards them to **Socket.IO**, so the dining room updates the moment anything happens. Adding a new live event touches exactly one file.

### The detectives

The maître d' also runs periodic detectives on a schedule:

- **Campaign detection** (every 60s) — scans recent fraud alerts for coordinated patterns: a device shared across many accounts, a merchant cluster, an enumeration wave, a relay-fraud cluster, or a velocity burst. Each becomes a **Campaign** with severity and exposure.
- **Mule detection** (every 45s) — sees [the cash-out watch](#the-cash-out-watch).

---

## The black book & family tree

The **blocklist** (`BlockList` model + `services/blocklistService.js`) is the black book of banned entities. But the maître d' keeps something more powerful: a **family tree** of who is connected to whom.

The **identity graph** (`services/identityGraphService.js`) treats every identifier — user, device, IP, account, fingerprint, session, wallet, email, phone — as a node, and every transaction as evidence that all its identifiers belong to the same person or operation. When you block one identifier, the graph runs a **breadth-first traversal to a fixed point**: it finds every transaction touching that identifier, collects every other identifier on those transactions, and repeats until no new identifiers surface.

The result: **blocking one user blocks their device, their IP, their card fingerprint, their email — and every other account that ever shared any of them.** A fraud ring can't just switch accounts. This cascade is atomic: queued transactions touching any blocked identifier are rejected, open alerts are auto-resolved, and everything is written to an immutable audit trail (`AuditLog`, `BlockedActivityLog`). **Nothing is ever deleted** — blocked entities, rejected transactions, and resolved alerts are archived permanently for regulators and review.

---

## The recipe book

Rules are not hardcoded in the kitchen — they live in **MongoDB** (`RuleConfig` model), managed by the maître d', and shipped with every scoring request.

- **`GET /api/rules`** lists all six rules with their current enabled state, severity, and thresholds (DB values overlaid on built-in defaults, so the list is always complete).
- **`PUT /api/rules/:ruleName`** updates `{ enabled?, score?, parameters? }` — disable a rule entirely, change its severity, or tune its thresholds (`minAmount`, `maxTransactions`, `windowSeconds`, `windowMinutes`, `startHour`/`endHour`, …).

The Node server keeps a 5-second cache so the per-transaction hot path doesn't hit Mongo every time, and invalidates it the moment a config changes. Because the config travels *with* each request, the change is live on the **very next transaction** — the head chef rewrote the recipe, and the kitchen reads it with the next dish. There is no restart, no redeploy, no version skew across a fleet.

The **`07 RULES`** screen is the chef's workstation: one card per rule, with an on/off toggle, severity field, and threshold inputs.

---

## The tasting room

Before the head chef commits a new recipe to the menu, they try it on *yesterday's actual diners*. That's the **backtest harness** (`POST /api/backtest`).

### How it works

1. You propose a change to one rule — e.g. "lower `minAmount` from ₹1,00,000 to ₹50,000", or "disable `NIGHT_OWL_RULE`".
2. The maître d' pulls a chronological sample of real transactions (last 24h / 7d / 30d, up to 2,000).
3. It replays that sample through the kitchen **twice**: once with the **current** recipe (baseline) and once with the **proposed** recipe (candidate). Each replay runs on fresh, isolated rule instances, so both runs start from a clean state and the comparison is apples-to-apples.
4. It reports what would have happened.

### What it reports

- **Headline deltas** — flagged before → after, blocked before → after, average score before → after.
- **Would newly flag / would stop flagging** — the transactions whose fate changes under the candidate.
- **Per-rule coverage** — how many times each rule would trigger under both recipes.
- **A false-positive proxy** — derived from real analyst labels: alerts resolved as `false_positive` mean an analyst decided the flag was wrong; `resolved`/`escalated` mean it was actioned. The harness counts both among candidate-flagged transactions, plus how many candidate flags are unlabeled (the honest "we don't know yet" bucket).
- **A per-transaction table** — recorded reality vs baseline replay vs candidate replay, row by row.

The **`08 BACKTEST`** screen is the tasting room: pick a rule, tweak it, pick a window, and see the before/after in one click. This is what turns rule tuning from guesswork into evidence — and it's the same evidence a bank or regulator would want before a rules change ships.

---

## The health inspector

The **dispute / chargeback loop** (`09 DISPUTES`) closes the circle. A dispute is *external ground truth*: the cardholder or issuer confirms that a past transaction was fraud. That confirmation lets the system answer the question every fraud platform is judged on — *of the fraud we now know about, what did each rule actually catch at scoring time?*

### Ingesting a dispute

`POST /api/disputes` with `{ transactionId, reason, status, notes }`:

- The dispute is recorded immutably in the `Dispute` ledger (who filed it, when, why).
- If the reason is fraud-type (`fraud`, `unauthorized`, `stolen_card`, `account_takeover`) **or** the dispute was `lost` (the issuer sided with the cardholder — money returned), the transaction is labelled **confirmed fraud** (`isConfirmedFraud` on the `Transaction`).
- Non-fraud disputes (duplicate charge, goods not received, …) are recorded but don't label — a customer complaint is not evidence of fraud.
- Unknown transaction → 404; exact duplicate dispute → 409; unauthenticated → 401.

### The detection report

`GET /api/disputes/detection` computes, over all confirmed-fraud transactions:

- **Caught at scoring time** vs **missed** (scored clear), and the overall detection rate.
- The **average score at the time** for caught vs missed.
- A **per-rule detection rate** table: of the fraud we now know about, how many times did each inspector catch it?

Crucially, this uses the rules that *actually* fired when the transaction was scored — stored history, not hindsight. If a confirmed-fraud transaction was scored clear, the report shows it as a miss, with an average score of 0, and no rule gets credit for catching it. That is the honest feedback loop: the health inspector's reports come back to the chef, and underperforming rules become visible — ready for the tasting room to fix.

---

## The cash-out watch

**Mule accounts** are the #1 laundering pattern in UPI networks: an account receives money from many victims and quickly forwards most of it to a single beneficiary, keeping a small cut. The **mule detector** (`services/muleDetectorService.js`, runs every 45s) automates the watch.

### Ingestion

Person-to-person transfers can now carry a `beneficiaryId` — the *recipient* of the funds, distinct from the payer's identity fields. This is how the system sees money flowing *into* an account, not just out of it. (Deliberately not part of the payer's identity graph: blocking a payer should never auto-block everyone they paid.)

### Detection

Over a 24-hour window, an account is flagged when **all** of these hold:

- It **received** at least ₹10,000 (as a beneficiary).
- The money came from **≥ 2 distinct senders** (victims, not one friend).
- It **forwarded** at least 60% of what it took in (the chain — the mule keeps a cut and moves the rest).
- Money came *in* before it went *out* (receive-then-forward, not a normal payer).

### Rings

Flagged accounts are then clustered into **rings** by shared identity — the same device, IP, fingerprint, or email used by several mules means *one operation, not N mules*. The detector uses union-find over the accounts' transaction identifiers. The result is a `MuleRing`: accounts, total received vs forwarded, senders and beneficiaries, the identifiers that tie them together, and a capped evidence trail of receive/forward legs.

### The one-click block

**`POST /api/mules/:ringId/block`** freezes every account in the ring — and because each block goes through the identity graph, the cascade locks the devices and IPs the ring shared. The ring's status becomes `blocked`, and any future transaction touching a ring member or its infrastructure is rejected with `BLOCK_LIST`. The **`10 MULES`** screen shows each ring with its flow, chain ratio, and evidence — and the block button. The simulator includes a "Mule ring" burst scenario that generates this pattern on demand.

---

## The security guard

The ingest surface used to answer anyone. Now it's locked down:

- **Analyst sessions** — every dashboard call carries a **JWT**; the frontend's axios instance attaches it automatically.
- **Machine ingest** — `POST /api/transactions` and `POST /api/disputes` accept a valid analyst JWT **or** an active **API key** (`x-api-key` header) via the `protectOrApiKey` guard — the credential a real payment switch would use. Keys are stored **bcrypt-hashed** (`ApiKey` model) with last-used tracking; a `demo-ingest` key is seeded on boot and documented.
- **The black book is private** — `GET /api/blocklist/check/:type/:value` previously revealed blocklist state to anyone; it now requires a JWT.
- **Rate limiting** — `/api/auth/login` and `/api/auth/register` are limited to **20 requests / 15 min per IP** (brute-force protection), and the whole `/api` surface to **1000 / 15 min** as a flood backstop.
- **Headers** — `helmet()` sets CSP, `X-Content-Type-Options`, `X-Frame-Options`, Referrer-Policy, HSTS, and the COOP/CORP family on every response.

---

## The dining room

The frontend is a **React 19 + Vite** app (`client/`, port 5173) styled as a **Swiss-editorial restaurant** — warm paper, black ink, hairline rules, one vermillion accent reserved for danger. It's light/dark switchable, and the data does the talking. Ten screens:

| # | Screen | The dining-room view |
|---|---|---|
| 01 | **Home** | The landing page: what PayGuard is, the principle ("every transaction gets a decision, nothing gets deleted"), the six capabilities, and one-click demo access. |
| 02 | **Operations** | The live control room: stat cards, a transaction-volume chart, a status donut, rule-trigger breakdown, and the live feed (latest 30 transactions, with a **CSV export** of the full history). |
| 03 | **Intel** | Threat campaigns as numbered editorial cards — device sharing, scam-merchant networks, enumeration waves, relay fraud, ATO bursts — with severity, exposure, and actions. |
| 04 | **Alerts** | The triage queue: resolve, mark false positive, block the user/device, escalate — every decision audited. |
| 05 | **Simulator** | Fire synthetic attack waves (enumeration, velocity, high-amount, new-device, relay, **mule ring**) and watch live scoring — the workbench for demos and testing. |
| 06 | **Blocklist** | The black book: locked entities with reasons, plus the immutable audit trail of every block and unblock. |
| 07 | **Rules** | The recipe book: tune every rule at runtime — enabled state, severity, thresholds — applied to the next transaction. |
| 08 | **Backtest** | The tasting room: replay real history through a proposed change and see before/after detection rates. |
| 09 | **Disputes** | The health inspector's desk: ingest chargebacks as ground truth, then read the per-rule detection report. |
| 10 | **Mules** | The cash-out watch: laundering rings with evidence, chain ratios, and one-click identity-graph block. |

The sidebar keeps the whole floor navigable: `01 HOME … 10 MULES`, with live status (socket connection + engine health) always in view, and a **Disengage** button for the analyst.

---

## A dish's journey

Here's one transaction, end to end, so the pieces connect.

**The order.** At 2:58 AM, `USER_12` places a ₹2,50,000 order from a device they've never used, in a city they were last seen in two hours ago *in a different city*.

1. **Step 1 — black book.** The maître d' checks `USER_12`, the device, and the location identifiers. Clean — not banned.
2. **Step 2 — the kitchen.** The order is sent to the Java engine with the current recipe. Three inspectors raise their hands:
   - Portion-size checker: ₹2,50,000 > ₹1,00,000 → **65**.
   - Impossible-travel checker: two cities within 120 min → **80**.
   - Unfamiliar-face checker: never-seen device → **55**.
   
   Final score: (65 + 80 + 55) / 3 = **66** → `review`. (Had the after-hours checker also been the deciding factor, the average would climb toward blocked — the design makes near-blocked orders reviewable rather than binary.)
3. **Step 3 — final re-check.** Still clean at commit. The dish is served, scored 66, and an **alert** lands in the triage queue; the event bus pushes it to the dining room instantly.
4. **The analyst.** The maître d' reviews the alert, decides it's fraud, and **blocks** `USER_12`. The identity graph traces the device, IP, and fingerprint the user shared — every account that ever touched them is frozen too, and the block is written to the immutable audit trail.
5. **The health inspector.** The cardholder files a chargeback. The analyst ingests it (`09 DISPUTES`) with reason `unauthorized`. The transaction is labelled **confirmed fraud** — and the detection report now credits the impossible-travel checker with one catch, while showing any confirmed-fraud transaction that scored clear as a miss.
6. **The tasting room.** If the analyst wants to catch this pattern earlier, they open `08 BACKTEST`, propose tightening the impossible-travel window, and replay the last 24 hours of real transactions to see exactly how many more dishes would have been flagged — before changing the recipe for real.

That's the whole system in one order: **detect → alert → decide → block the ring → confirm with ground truth → measure and improve.**

---

## Architecture

```
                         ┌────────────────────────────┐
                         │  client/  React + Vite     │
                         │  the dining room (10 rooms)│
                         └──────────────┬─────────────┘
                                        │ REST + Socket.IO (JWT)
                         ┌──────────────▼─────────────┐
                         │  server/  Node + Express   │
                         │  the maître d'             │
                         │  · 4-step ingest pipeline  │
                         │  · identity-graph blocking │
                         │  · campaign + mule detectors│
                         │  · rule config + backtest  │
                         │  · disputes, audit trail   │
                         │  · rate limits, helmet     │
                         └───┬────────────┬───────────┘
                             │ /score     │ /backtest
                         ┌───▼────────────▼───────────┐
                         │  fraud-engine/  Spring Boot │
                         │  the kitchen — 6 rules      │
                         │  stateless: config per      │
                         │  request, fresh instances   │
                         │  per backtest run           │
                         └────────────────────────────┘
                             MongoDB — the ledger:
                             User · Transaction · FraudAlert
                             BlockList · BlockedActivityLog
                             AuditLog · Campaign · RuleConfig
                             ApiKey · Dispute · MuleRing
```

**The ledger (data model).** Everything the restaurant knows lives in MongoDB:

- `User` — analysts, roles, credentials.
- `Transaction` — every order ever: payer identity fields, `beneficiaryId`, amount, location, score, status, triggered rules, `scoringEngine` (engine vs fallback), and `isConfirmedFraud` / dispute reason.
- `FraudAlert` — review-queue items: the transaction, identity context, score, rules, and status (`open` / `resolved` / `false_positive` / `escalated`) with optimistic concurrency.
- `BlockList` + `BlockedActivityLog` — locked entities and the immutable record of every block cascade.
- `AuditLog` — every analyst action, written once, never edited.
- `Campaign` — detected attack campaigns with severity and exposure.
- `RuleConfig` — the recipe book.
- `ApiKey` — hashed machine-ingest keys.
- `Dispute` — the health inspector's reports.
- `MuleRing` — laundering rings with evidence.

---

## Quick start

Three services, three terminals:

```bash
# 1. The kitchen — Java scoring engine (port 8080)
cd fraud-engine
./mvnw package
java -jar target/fraud-engine-0.0.1-SNAPSHOT.jar

# 2. The maître d' — API + real-time (port 3000)
cd server
npm install
PORT=3000 node index.js        # PORT=3000 matters: some shells inject PORT=0

# 3. The dining room — frontend (port 5173)
cd client
npm install
npm run dev
```

Open **http://localhost:5173** and sign in with the demo account:

```
demo@payguard.io  /  payguard-demo
```

Or click **USE DEMO** — it's one click. Then:

1. **Operations** — watch live transactions stream in (or use the simulator).
2. **Simulator → Mule ring** — generate the laundering pattern, then open **Mules** and block the ring.
3. **Disputes** — grab a transaction id from the live feed and ingest a chargeback; the detection report populates.
4. **Backtest** — propose lowering `AMOUNT_THRESHOLD_RULE`'s `minAmount` and see what would have been flagged.
5. **Rules** — disable a rule and watch the very next transaction stop triggering it.

> **Environment notes.** This sandbox injects `PORT=0`, which shadows `server/.env` — pin it as shown. Mongo credentials live in `server/.env` (gitignored). The machine-ingest demo API key is `pg_live_demo_5f3c2a9e1b7d84a6` (bcrypt-hashed in the `ApiKey` collection). See `replit.md` for the full environment walkthrough.

---

## Production notes

PayGuard is built as a demo-grade platform with production-shaped bones. Before it faces real money:

- **Rotate the seeded credentials** — the demo analyst password and the demo API key are well-known; gate rule-config, ring-block, and blocklist mutations behind an admin role.
- **Persist rule state** — the kitchen's sliding windows (velocity, enumeration, geo, new-device) live in engine memory; persist them for multi-instance deployments and restart resilience.
- **The rules are heuristics, not models** — they catch known patterns brilliantly. Per-user behavioral baselines (ML anomaly scoring) are the natural next layer, and the tasting room + health inspector are the harness to prove them before they ship.
- **Monitor the fallback** — when the engine is down the system says so and lets dishes through marked fallback; in production, that signal should page someone.

---

## Summary

PayGuard is a restaurant where every dish is inspected, the recipe book can be rewritten live, the tasting room proves changes before they ship, and the health inspector's reports come back to the chef. Six inspectors in the kitchen catch the classic fraud signatures; the maître d' orchestrates a four-step pipeline and blocks rings through the identity graph's family tree; the cash-out watch catches mule laundering; the dispute loop measures what actually got caught; and the dining room presents it all in a calm, real-time, Swiss-editorial interface — with security at the door and an immutable ledger of everything that ever happened.

**The room knows before you do.**
