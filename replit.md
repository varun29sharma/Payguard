# PayGuard — Fraud Intelligence Platform

Real-time fraud detection dashboard for UPI/payment networks. Detects enumeration attacks, relay fraud, and account-takeover campaigns.

## Architecture

Three-part project (imported from GitHub):

- **client/** — React 19 + Vite frontend (UI, dashboard, auth screens). Served on port 5000.
- **server/** — Express + MongoDB (Mongoose) API + Socket.IO. Runs on port 3000 (internal).
- **fraud-engine/** — Java Spring Boot fraud-scoring microservice (Maven). **Not set up yet** — the client/server are wired to run without it for now (see `FRAUD_ENGINE_URL` in `server/.env`, currently unused since nothing calls it in this setup pass).

## Running it

Two workflows:
- `Frontend` — `cd client && npm run dev` (Vite dev server, port 5000, this is what the user sees)
- `Backend` — `cd server && npm run dev` (nodemon, port 3000, internal only)

The frontend's Vite dev server proxies `/api/*` and `/socket.io/*` to the backend on `localhost:3000`, so the browser only ever talks to port 5000 (same-origin — no CORS needed). This means `VITE_API_URL=/api` and `VITE_SOCKET_URL=/` in `client/.env` are relative, not absolute URLs.

## Environment / secrets

- `MONGO_URI` and `JWT_SECRET` are stored as Replit environment variables (shared), not in `server/.env`.
  - **Security note:** The imported repo had a live MongoDB Atlas connection string and a placeholder JWT secret committed in plaintext in `server/.env`. The Mongo URI was kept as-is (the user declined to rotate it when asked) but moved out of the tracked file. A new random `JWT_SECRET` was generated. **Recommend rotating the MongoDB Atlas password** since the original credential was exposed in git history.
- `server/.env` still holds non-sensitive config: `PORT`, `FRAUD_ENGINE_URL`, `NODE_ENV`, `CLIENT_URL`.

## Notes from setup

- Fixed a filename case bug: `server/routes/TransactionRoutes.js` was renamed to `transactionRoutes.js` to match the `require('./routes/transactionRoutes')` call in `server/index.js` (backend crashed on boot otherwise).
- The Java `fraud-engine` (Spring Boot) was intentionally left unconfigured per the user's request to skip it for now.

## User preferences

(none recorded yet)
