# PayGuard — Fraud Intelligence Platform

Real-time fraud detection dashboard for UPI/payment networks. Detects enumeration attacks, relay fraud, and account-takeover campaigns.

## Architecture

Three-part project (imported from GitHub):

- **client/** — React 19 + Vite frontend (UI, dashboard, auth screens). Served on port 5000.
- **server/** — Express + MongoDB (Mongoose) API + Socket.IO. Runs on port 3000 (internal).
- **fraud-engine/** — Java Spring Boot fraud-scoring microservice (Maven) on port 8080. **Wired end-to-end** — the Node server calls `/api/fraud/score` for every transaction (`FRAUD_ENGINE_URL` in `server/.env`) and polls `/api/fraud/health` every 10s; if the engine is down, transactions fall back to a `clear` score and the UI shows an `ENGINE: FALLBACK` indicator (see `server/services/engineHealthService.js` and `GET /api/system/health`). Build with `./mvnw package` then `java -jar target/fraud-engine-0.0.1-SNAPSHOT.jar`.

## Running it

Two workflows:
- `Frontend` — `cd client && npm run dev` (Vite dev server, port 5000, this is what the user sees)
- `Backend` — `cd server && npm run dev` (nodemon, port 3000, internal only)

The frontend's Vite dev server proxies `/api/*` and `/socket.io/*` to the backend on `localhost:3000`, so the browser only ever talks to port 5000 (same-origin — no CORS needed). This means `VITE_API_URL=/api` and `VITE_SOCKET_URL=/` in `client/.env` are relative, not absolute URLs.

## Environment / secrets

- `MONGO_URI` and `JWT_SECRET` live in `server/.env` (as in the original imported repo). The user was asked twice to move these into real encrypted Replit Secrets and declined both times, so they were left in `.env` to keep the app runnable rather than blocking setup.
- A new random `JWT_SECRET` was generated to replace the original placeholder value (`supersecretkey_changethis_to_something_long_random`).
- **Security note:** The MongoDB Atlas connection string in `server/.env` has real credentials that were already committed to git history in the imported repo. **Recommend rotating the MongoDB Atlas password** and moving both values into Replit Secrets when convenient — see follow-up task "Rotate the MongoDB Atlas password that was exposed in git history".
- `server/.env` also holds non-sensitive config: `PORT`, `FRAUD_ENGINE_URL`, `NODE_ENV`, `CLIENT_URL` (now `http://localhost:5000` to match the frontend's actual port).

## Notes from setup

- Fixed a filename case bug: `server/routes/TransactionRoutes.js` was renamed to `transactionRoutes.js` to match the `require('./routes/transactionRoutes')` call in `server/index.js` (backend crashed on boot otherwise).
- **Port caveat:** some sandboxes inject `PORT=0` ("pick any free port"), which wins over `server/.env`'s `PORT=3000` because dotenv doesn't override existing env vars — the server then binds a random port and the frontend proxy breaks. Start it as `PORT=3000 node index.js` in that case.
- The Java `fraud-engine` DTOs were de-Lomboked (`TransactionRequest`, `FraudResult`) because Lombok's annotation processor doesn't run on JDK 26 in this environment; plain-Java getters/setters/builder keep the call sites unchanged.
- **Runtime rule config:** rule thresholds and enable/disable flags live in MongoDB (`server/models/RuleConfig.js` + `server/services/ruleConfigService.js`) and are shipped with every scoring request — `PUT /api/rules/:ruleName` (`{ enabled?, score?, parameters? }`) changes the engine's behavior on the very next transaction, no restart. Manage it in the UI at `07 RULES` in the sidebar, or via `GET /api/rules`.
- **Backtest harness:** `POST /api/backtest` (`{ ruleName, changes, windowHours?, limit? }`) replays the historical stream through the Java engine twice — current config (baseline) vs proposed config (candidate) — on fresh, isolated engine state (`BacktestService` news up new rule instances per run, so live scoring windows are untouched). Reports detection deltas, per-rule coverage, and an analyst-label false-positive proxy (alerts resolved as `false_positive`). UI: `08 BACKTEST` in the sidebar.
- **Security hardening:** `POST /api/transactions` now requires a JWT or an API key (`x-api-key` header); `GET /api/blocklist/check/:type/:value` requires a JWT. Demo ingest key seeded on boot: `pg_live_demo_5f3c2a9e1b7d84a6` (bcrypt-hashed in the `ApiKey` collection — disable/rotate for production). Auth endpoints are rate-limited to 20 req/15 min per IP, the whole `/api` surface to 1000 req/15 min, and `helmet` security headers are on. Simulator/dashboard keep working because the frontend always sends the analyst JWT.
- **Dispute/chargeback loop:** `POST /api/disputes` (`{ transactionId, reason, status, amount?, notes? }`, JWT or API key) ingests external ground truth. Fraud-type reasons (fraud/unauthorized/stolen_card/account_takeover) or a `lost` status label the transaction as confirmed fraud (`isConfirmedFraud` on the Transaction). `GET /api/disputes/detection` then reports per-rule detection rates over confirmed fraud — how many of the frauds we now know about each rule caught at scoring time. UI: `09 DISPUTES` in the sidebar (ingest form + report + ledger).
- **Mule detection:** ingest P2P transfers with an optional `beneficiaryId` (the recipient); `services/muleDetectorService.js` runs every 45s and flags accounts that received ≥ ₹10k from ≥ 2 senders and forwarded ≥ 60% of it on within 24h (receive-then-forward). Flagged accounts sharing a device/IP/fingerprint are clustered into rings (`MuleRing` model); `POST /api/mules/:ringId/block` freezes the whole ring via the identity-graph cascade. UI: `10 MULES` in the sidebar; simulator has a "Mule ring" burst scenario.

## User preferences

(none recorded yet)
