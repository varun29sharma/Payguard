# PAYGUARD<span style="color:#FF3B00">!</span>

**Real-time fraud intelligence for UPI & payment networks.**

Every transaction gets a decision. Nothing gets deleted. And the platform is honest about it — when the scoring engine is down, it says so, openly, instead of pretending everything is fine.

---

## The restaurant

Think of PayGuard as a fine-dining restaurant where every dish is inspected before it leaves the kitchen — and where the health inspector's reports come back to the chef so the menu gets better.

| The restaurant | PayGuard | What it does |
|---|---|---|
| **The dining room** | React dashboard | A clean, Swiss-editorial floor where the maître d' (analyst) watches every table in real time — new dishes, rejected plates, suspicious activity — the moment it happens. |
| **The maître d'** | Node.js + Express API | Takes every order (transaction), checks the black book, sends each dish to the kitchen for inspection, and only lets an order out that passes. |
| **The kitchen** | Java scoring engine | A dedicated Spring Boot kitchen where six specialist inspectors evaluate every dish before it's served. |
| **The recipe book** | Runtime rule configuration | The head chef rewrites thresholds — portion sizes, speed limits, opening hours — live, without retraining the kitchen. The kitchen reads the recipe with every dish it cooks. |
| **The tasting room** | Backtest harness | Before changing the menu, the chef tries the new recipe against *yesterday's actual diners*: what would have been flagged, blocked, or missed. |
| **The health inspector** | Dispute / chargeback loop | Official confirmation that a meal was bad. The kitchen's catch-rate per inspector is then measured against reality — of the fraud we now know about, who caught it? |
| **The suspicious cash-out** | Mule detection | A server who collects cash from many tables and hands most of it to one courier within a shift is flagged. Staff sharing a locker are one operation. |
| **The security guard** | Auth, API keys, rate limits, security headers | Only staff and trusted delivery partners get in, and the door stops brute-force key guessing. |
| **The black book & family tree** | Blocklist + identity graph | Ban one guest and everyone who ever shared their table, credit card, phone, or device is turned away too — one block stops the whole ring. |
| **The kitchen display** | Socket.IO | Every dish's fate appears on the floor instantly: `new-transaction`, `new-fraud-alert`, `engine-health`, `mule-ring-new` — all pushed live. |

---

## The kitchen: six inspectors

Each dish (transaction) passes six specialist inspectors before it's served. Their thresholds live in the recipe book (MongoDB) and can be tuned at runtime:

| Inspector | Rule | Catches |
|---|---|---|
| **Portion-size checker** | `AMOUNT_THRESHOLD_RULE` | A single dish above a high-value threshold (default ₹1,00,000) — classic payout / account-takeover signal. |
| **Speed checker** | `VELOCITY_RULE` | More than N dishes from one table inside the window (default 5 in 60s) — automated draining. |
| **Micro-sampling checker** | `ENUMERATION_ATTACK_RULE` | 8+ micro-orders (≤ ₹50) in 30 minutes — card-probing / enumeration. |
| **Impossible-travel checker** | `GEOGRAPHIC_ANOMALY_RULE` | One guest ordering from two different cities within two hours — NFC relay / card sharing. |
| **Unfamiliar-face checker** | `NEW_DEVICE_RULE` | A regular ordering from a device they've never used — account takeover (remembered after first sighting). |
| **After-hours checker** | `NIGHT_OWL_RULE` | Orders between 00:00–05:00 local — bots and attackers operating outside the victim's timezone. |

Every dish gets a **fraud score** (0–100): 0–39 **clear**, 40–69 **review** (an alert is raised for the analyst), 70+ **blocked** (rejected at the door). And every dish is recorded forever — the ledger is immutable, and a blocked entity's pending orders are rejected mid-flight (Bug #2, never a blocked transaction reported as success).

If the kitchen is ever unreachable, the maître d' doesn't fake it: dishes are let through marked **fallback**, the UI shows a blinking **ENGINE: FALLBACK**, and every unscored dish is tagged so analysts know which records carry real signals.

---

## The dining room: ten screens

| # | Screen | You can |
|---|---|---|
| 01 | **Home** | A bamlab-style editorial landing page — what PayGuard is, why it exists, and one-click demo access. |
| 02 | **Operations** | The live control room: stat cards, transaction-volume chart, status donut, rule breakdown, and the live transaction feed (latest 30, with a full CSV export). |
| 03 | **Intel** | Coordinated threat campaigns — device-sharing, scam-merchant networks, enumeration waves, relay fraud, account-takeover bursts — each with severity and exposure. |
| 04 | **Alerts** | The triage queue: resolve, mark false positive, block the user/device, escalate — every action audited. |
| 05 | **Simulator** | Fire synthetic attack waves (enumeration, velocity, relay, mule ring…) and watch live scoring. |
| 06 | **Blocklist** | The black book: locked entities with reasons and the immutable audit trail of every block. |
| 07 | **Rules** | Tune the engine at runtime — enable/disable rules, change scores and thresholds. Applies to the *next* transaction, no restart. |
| 08 | **Backtest** | Replay real history through a proposed rule change: before/after detection rates, per-rule coverage, and a false-positive proxy from analyst labels. |
| 09 | **Disputes** | Ingest chargebacks as ground truth: labels confirmed fraud, then reports *per-rule detection rates* — of the fraud we now know about, what did each rule catch? |
| 10 | **Mules** | Laundering rings: accounts receiving from many senders and forwarding most of it on within 24h, clustered by shared identity — with one-click identity-graph ring blocks. |

The whole UI is a light/dark-switchable **Swiss-editorial design**: warm paper, black ink, hairline rules, one vermillion accent reserved for danger. No shadows, no gimmicks — the data does the talking.

---

## Architecture

Three services, one pipeline:

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
                         └───┬────────────┬───────────┘
                             │ /score     │ /backtest
                         ┌───▼────────────▼───────────┐
                         │  fraud-engine/  Spring Boot │
                         │  the kitchen — 6 rules      │
                         │  stateless, config per      │
                         │  request, fresh instances   │
                         │  per backtest run           │
                         └────────────────────────────┘
                             MongoDB: transactions,
                             alerts, blocks, rules,
                             disputes, mule rings
```

**Design decisions that matter:**

- **The engine is a pure function.** Configuration travels with every scoring request — a fleet of engine instances can never serve stale rules, and backtests run on *fresh rule instances* so replayed history never pollutes live scoring state.
- **The identity graph is the unfair advantage.** Blocking a user traces every device, IP, fingerprint and email that ever touched their transactions and locks them all — a fraud ring can't just switch accounts.
- **The event bus decouples everything.** One bus → one socket bridge → the UI. Adding a live event touches one file.
- **Nothing is ever deleted.** Blocks are atomic cascades (reject queued txns → auto-resolve alerts → immutable logs), and every analyst action lands in the audit trail.
- **Security is real:** machine ingest requires an API key, analysts use JWTs, the blocklist checker is authenticated, auth endpoints are rate-limited, and `helmet` hardens every response.

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

(or click **USE DEMO** on the sign-in page — it's one click). The simulator's **Mule ring** scenario + a few **Disputes** ingestions will populate every screen with believable data within a minute.

> **Notes for this environment** — the sandbox injects `PORT=0`, which shadows `server/.env`; pin it as above. Mongo credentials live in `server/.env` (gitignored). See `replit.md` for the full environment walkthrough.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React 19 + Vite + Tailwind** | Fast HMR, clean component tree, editorial design system in one place. |
| API + real-time | **Node.js + Express + Socket.IO** | The orchestration layer: auth, ingest, detection, events — one language end to end. |
| Scoring | **Java + Spring Boot** | A separate, independently-scalable scoring microservice — the "kitchen" that chefs tune, not rebuild. |
| Data | **MongoDB + Mongoose** | Flexible identity graph, atomic cascades, immutable logs. |
| Security | **helmet, express-rate-limit, bcrypt, JWT** | Headers, brute-force ceilings, hashed secrets, stateless sessions. |

---

## Honest production notes

PayGuard is built as a demo-grade platform with production-shaped bones. Before running it against real money:

- **Rotate the demo API key** (`pg_live_demo_…`, seeded on boot) and gate rule-config / blocklist mutations behind an admin role.
- **Rule state is per-instance memory.** Velocity, enumeration, geo and new-device windows live in the engine's RAM — persist them for multi-instance deployments.
- **The rules are heuristics, not models.** They catch known patterns brilliantly; per-user behavioral baselines (ML anomaly scoring) are the natural next layer, and the backtest + dispute loop is the harness to prove them before they ship.

---

*PayGuard — the room knows before you do.*
