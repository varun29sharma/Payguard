# PayGuard — Change Log & Architecture Deep Dive

This document explains, in depth, every structural change made during the
backend rebuild and the frontend visual redesign: **why** each piece exists,
**what bug or gap it closes**, and **how** the pieces fit together. It is
meant to be read alongside the code, not instead of it.

> Scope note: the Java `fraud-engine/` service was intentionally left
> unwired in this pass. `transactionService.js` calls it defensively and
> falls back to a `clear` score if it's unreachable — see
> [Fraud scoring fallback](#fraud-scoring-fallback) below.

---

## 1. Why the backend was rebuilt

Before this pass, the fraud-review flow had four concrete correctness bugs:

| # | Bug | Symptom |
|---|-----|---------|
| 1 | **Blocking didn't clean up the queue** | Blocking a user/device left their already-submitted, still-pending transactions sitting untouched in the review queue. |
| 2 | **Race condition at commit time** | A transaction could be scored and committed successfully *while* a block for the same identity was being created concurrently — the block would "win" logically but the transaction still succeeded. |
| 3 | **Socket emission scattered everywhere** | `io.emit(...)` calls were inlined across controllers and services, so `req.app.get('io')` had to be threaded through the whole call stack, and every new real-time event meant editing N files. |
| 4 | **Fragmented entity blocking** | Blocking a `userId` did nothing for the device, IP, or card fingerprint that same fraud ring was also using — so blocking one account didn't stop the other identifiers of the same actor. |

Alongside these, there was an explicit product requirement: **blocked
entities' transactions must never be deleted** — only archived/marked
rejected, so there's always a permanent record of what happened and why.

The fix for all four bugs, plus the "never delete" rule, required touching
the same core path (transaction creation → fraud scoring → blocklist
enforcement), so it was done as one coherent rebuild rather than four
separate patches.

---

## 2. New building blocks

### 2.1 Typed errors — `server/utils/errors.js`

```js
class AppError extends Error {
  constructor(message, statusCode, details) { ... this.statusCode = statusCode; ... }
}
class ValidationError extends AppError   { constructor(m,d){ super(m,400,d);} }
class ConflictError extends AppError     { constructor(m,d){ super(m,409,d);} }
class AuthorizationError extends AppError{ constructor(m,d){ super(m,403,d);} }
class FraudRuleError extends AppError    { constructor(m,d){ super(m,422,d);} }
class NotFoundError extends AppError     { constructor(m,d){ super(m,404,d);} }
```

**Purpose of each piece:**
- `AppError` is the base class every "expected" error extends. It carries an
  HTTP `statusCode` and optional `details` so the thrower doesn't need to
  know anything about Express — it just `throw`s a typed error.
- Each subclass fixes the status code for its category (400 for bad input,
  409 for "someone/something already did this", 403 for "not allowed", 404
  for "doesn't exist", 422 for "a fraud rule rejected this").
- `Error.captureStackTrace` keeps stack traces pointing at the throw site,
  not at the `AppError` constructor, which matters when reading logs.

**Why this exists:** before this, every route did its own
`try { ... } catch (e) { res.status(500).json(...) }`, which meant
validation failures were being reported as 500s and callers couldn't
distinguish "your input was bad" from "the server broke."

### 2.2 Global error handler — `server/middleware/errorHandler.js`

```js
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
```
Wraps any `async` route/controller function. If the wrapped function throws
or its returned promise rejects, the error is forwarded to `next(err)`
instead of crashing the Node process or being silently swallowed by a
missing `try/catch`. Every controller in the app is now written as a plain
`async` function and wrapped in `asyncHandler` at export time — no
controller has its own `try/catch` for HTTP-level error translation anymore.

```js
const errorHandler = (err, req, res, next) => {
  if (err instanceof AppError) { ...maps statusCode/name/message/details... }
  if (err.name === 'ValidationError' && err.errors) { ...Mongoose schema validation -> 400... }
  if (err.name === 'CastError') { ...bad ObjectId -> 400... }
  if (err.code === 11000) { ...Mongo duplicate key -> 409... }
  if (err.name === 'VersionError') { ...optimistic-concurrency conflict -> 409... }
  console.error('Unhandled error:', err);
  res.status(500).json({ ... }); // last resort, hides message in production
};
```
This is registered **last** in `server/index.js` (`app.use(errorHandler)`),
which is an Express requirement — an error-handling middleware only fires if
it's the last one registered and takes 4 arguments. It gives one place that
decides how every category of failure becomes an HTTP response, including
failure modes that weren't even anticipated when a given route was written
(e.g. a duplicate key error thrown by a schema-level unique index).

### 2.3 Event bus — `server/events/eventBus.js` + `server/events/socketBridge.js`

**The problem this solves:** originally, services and controllers called
`req.app.get('io').emit(...)` directly, which meant:
- Every function that might need to notify the frontend had to receive `io`
  as a parameter or dig it out of `req.app`.
- Testing/business logic was coupled to Socket.IO being initialized.
- The list of "what events exist and what do they mean" was smeared across
  the whole codebase instead of living in one place.

`eventBus.js`:
```js
class PayGuardEventBus extends EventEmitter {}
const eventBus = new PayGuardEventBus();
const EVENTS = Object.freeze({ BLOCK_CREATED: 'BLOCK_CREATED', ... });
```
A plain Node `EventEmitter` singleton. `EVENTS` is a frozen object so typos
in event names fail at property-access time rather than silently creating a
new, never-listened-to string. Services now just call
`eventBus.emit(EVENTS.NEW_TRANSACTION, transaction)` — no `io`, no `req`.

`socketBridge.js`:
```js
const WIRE_EVENTS = {
  [EVENTS.NEW_TRANSACTION]: 'new-transaction',
  [EVENTS.NEW_FRAUD_ALERT]: 'new-fraud-alert',
  ...
};
const attachSocketBridge = (io) => {
  for (const [busEvent, wireEvent] of Object.entries(WIRE_EVENTS)) {
    eventBus.on(busEvent, (payload) => io.emit(wireEvent, payload));
  }
  ...
};
```
This is the **only** file that knows Socket.IO exists. It subscribes to the
internal `eventBus` and re-emits onto the real `io` server using the exact
same wire event names (`'new-transaction'`, `'new-fraud-alert'`, etc.) the
frontend already listened for — so the client-visible contract didn't
change, only the internal plumbing. It also runs a debounced (400ms)
`scheduleStatsBroadcast(io)` whenever anything changes the transaction pool
shape, so the dashboard's live counters update without every mutation site
needing to know how to recompute stats.

`server/index.js` wires this up once, right after the `io` server and
before any routes: `attachSocketBridge(io)`.

### 2.4 Socket authentication — `server/middleware/socketAuth.js`

```js
const socketAuthMiddleware = (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) { socket.user = null; return next(); }
  try { socket.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch (err) { next(new Error('Unauthorized socket connection')); }
};
```
- No token → connection is allowed but anonymous (`socket.user = null`).
  This keeps any client that hasn't sent a token from being hard-broken.
- A token that **is** present must verify. A forged or expired token is
  rejected outright (the handshake fails) rather than silently treated as
  anonymous — this is the actual security boundary.
- Registered via `io.use(socketAuthMiddleware)` in `index.js`, so it runs on
  every socket connection attempt before any event handlers.

### 2.5 Identity graph — `server/services/identityGraphService.js`

This is the fix for **Bug #4 (fragmented blocking)**.

```js
const IDENTITY_FIELDS = ['userId','deviceId','accountId','fingerprint','sessionId','ipAddress','walletId','email','phone'];
```
The single list of "things PayGuard can block." Adding a new identifier type
(e.g. a new payment rail's wallet ID) means adding it here *and* to the
`BlockList` schema's `type` enum — nowhere else in the codebase.

```js
const buildConnectedIdentifiers = async (seedIdentifiers, { maxIterations = 5 } = {}) => {
  const known = new Map(); // field -> Set(values)
  ...
  addAll(seedIdentifiers);
  for (let i = 0; i < maxIterations; i++) {
    const or = [...build $or query from everything known so far...];
    const matches = await Transaction.find({ $or: or }).select(IDENTITY_FIELDS.join(' ')).lean();
    let changed = false;
    for (const match of matches) if (addAll(extractIdentifiers(match))) changed = true;
    if (!changed) break;
  }
  return known;
};
```
This is a **breadth-first fixed-point traversal** over the `Transaction`
collection: start from the seed identifier(s) (e.g. `{ userId: 'u123' }'`),
find every transaction that touches any known identifier, pull in every
*other* identifier those transactions carried (device, IP, card
fingerprint, etc.), and repeat until a pass adds nothing new or
`maxIterations` (5) is hit. The iteration cap exists so a degenerate,
extremely well-connected fraud ring can't turn one block request into an
unbounded query loop.

**Concretely:** blocking `userId: "u123"` now also blocks every device, IP,
account, and card fingerprint that ever appeared on the same transaction as
that user — closing the loophole where a fraud ring just switches to a
sibling account after their primary one gets blocked.

`identifiersToPairs` / `matchAnyIdentifierQuery` are small pure-function
adapters: the former turns the internal `Map<field, Set<value>>` into a flat
`[{type, value}]` list (for writing `BlockList` documents), the latter turns
it into a Mongo `$or` query (for finding transactions/alerts that match any
connected identifier).

### 2.6 Audit trail — `server/services/auditLogService.js` + `AuditLog`/`BlockedActivityLog` models

```js
const recordAudit = async ({ analyst, action, oldValue, newValue, reason, affectedIds = [] }, session) => {
  const [entry] = await AuditLog.create([{ analyst, action, oldValue, newValue, reason, affectedIds }], session ? { session } : undefined);
  eventBus.emit(EVENTS.ANALYST_ACTION_LOGGED, entry);
  return entry;
};
```
Every analyst-initiated mutation (block, unblock, resolve, escalate) writes
one `AuditLog` row. Nothing in the application ever updates or deletes an
`AuditLog` document — it's write-once by construction (no route exists that
could mutate one). `BlockedActivityLog` is the companion model specific to
blocking: it stores a full snapshot of *which* identifiers were blocked,
*which* transactions got rejected as a result, and *which* alerts got
auto-resolved, in one immutable document — this is what makes "nothing is
ever deleted, only archived" auditable rather than just a promise.

### 2.7 Blocklist service — `server/services/blocklistService.js`

This is the fix for **Bug #1 (queue cleanup)** and the transaction-safety
work, all in one atomic operation: `blockEntity(...)`.

**Step 0 — transaction wrapper:**
```js
const withOptionalTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => { result = await work(session); });
    return result;
  } catch (err) {
    if (/Transaction numbers|IllegalOperation|replica set|not supported/i.test(err.message || '')) {
      return work(null); // standalone Mongo (no replica set) — fall back to sequential writes
    }
    throw err;
  } finally { session.endSession(); }
};
```
MongoDB multi-document transactions require a replica set. Rather than hard
failing in a standalone dev environment, this detects that specific failure
mode and falls back to sequential (non-atomic) writes — the partial unique
index on `BlockList` (see below) still prevents duplicate active blocks even
without a session, so the important invariant holds either way.

**Step 1 — check-then-insert, never insert-and-catch:**
```js
const existing = await BlockList.find(existingQuery)...;
const alreadyBlocked = new Set(existing.map(e => `${e.type}:${e.value}`));
for (const { type, value } of pairs) {
  if (alreadyBlocked.has(`${type}:${value}`)) continue;
  try { const [entry] = await BlockList.create([...], opts); createdEntries.push(entry); }
  catch (err) {
    if (err.code !== 11000) throw err;
    throw new ConflictError(`"${value}" (${type}) was just blocked by another request — please retry.`);
  }
}
```
**This is a bug we found and fixed while testing, not something in the
original brief.** Inside a MongoDB multi-document transaction
(`session.withTransaction`), if *any* write inside the transaction throws —
even a duplicate-key error caught and handled by application code — the
whole session is marked aborted server-side. Every subsequent operation in
that same transaction then fails too, even ones that have nothing to do
with the original error. The original approach (insert, catch E11000,
continue) looked correct in isolation but silently poisoned the rest of the
`blockEntity` call whenever an analyst re-blocked something already active
(a very common happy-path action, e.g. clicking "block" twice). The fix is
to check what's already active *before* attempting any insert, so the
common case never touches the catch block at all — only a genuine race
(two requests blocking the same identifier in the same instant) reaches the
`catch`, and at that point it's correctly reported as a `409 Conflict` for
the caller to retry, instead of being swallowed.

**Step 2 — reject queued transactions (Bug #1 fix):**
```js
const queueQuery = { ...identifierQuery, fraudStatus: { $in: ['review'] } };
const affectedTransactions = await Transaction.find(queueQuery)...;
for (const txn of affectedTransactions) {
  txn.fraudStatus = 'rejected';
  txn.rulesTriggered = [...(txn.rulesTriggered||[]), { ruleName: 'ENTITY_BLOCKED', score: 100, reason }];
  await txn.save(opts);
}
```
Every transaction still sitting in the review queue for *any* connected
identifier gets immediately marked `rejected` (never deleted) and tagged
with an `ENTITY_BLOCKED` rule entry explaining why. This is what closes the
"blocked a user, but their 3 pending transactions just sat there" gap.

**Step 3 — auto-resolve open alerts:** any `FraudAlert` still `open` for a
connected identifier is marked `resolved` with `resolvedBy`/`resolvedAt` set
— so blocking doesn't leave orphaned alerts stuck in the workbench queue.

**Step 4 — permanent record:** one `BlockedActivityLog` document captures
the full result (which identifiers, which transactions, which alerts, which
audit entry) and `recordAudit(...)` writes the `BLOCK_ENTITY` audit row.
Finally the function emits `BLOCK_CREATED`, `REVIEW_QUEUE_UPDATED`, and one
`TRANSACTION_UPDATED` per affected transaction on the event bus — this is
what makes the frontend's review queue and blocklist pages update live
without a page refresh.

`isAnyIdentifierBlocked(identifiers)` is the read-only helper used at both
authorization checkpoints in `transactionService.js` (see below) — it's a
single indexed `$or` lookup against `BlockList` for `isActive: true`.

### 2.8 Transaction service — `server/services/transactionService.js`

This is the fix for **Bug #2 (the commit-time race)**.

```
STEP 1 — initial blocklist check       (fast, cheap, catches the common case)
STEP 2 — fraud scoring                 (network round-trip — the race window)
STEP 3 — FINAL AUTHORIZATION CHECKPOINT (re-check right before commit)
STEP 4 — commit
```
The critical addition is **Step 3**. Before this fix, a transaction was
checked against the blocklist once, then scored by the fraud engine (a
network call that takes real time), then committed — meaning if a block was
created for that same identity *during* the scoring call, the transaction
would still commit successfully, because nothing re-checked after the
network round-trip. Now `isAnyIdentifierBlocked(identifiers)` is called a
second time immediately before `Transaction.create(...)`, and if it now
matches, the transaction is rejected instead of committed
(`outcome: 'blocked_final'`) — the caller (the controller) maps this to an
HTTP `403`, distinct from `'blocked_initial'` (`200`, blocked immediately,
no race involved) and `'created'` (`201`, genuinely clear).

```js
if (fraudResult.status !== 'clear') {
  alert = await FraudAlert.create({...});
  eventBus.emit(EVENTS.NEW_FRAUD_ALERT, { alert, transaction });
  eventBus.emit(EVENTS.REVIEW_QUEUE_UPDATED, { added: [transaction._id] });
  setImmediate(() => detectCampaigns().catch(...));
}
```
A non-clear transaction creates a `FraudAlert` and schedules campaign
detection on the next event-loop tick (`setImmediate`) so it doesn't block
the HTTP response.

#### Fraud scoring fallback
```js
try { fraudResult = await callFraudEngine(draft); }
catch (e) { console.warn('Fraud engine unavailable, defaulting to clear:', e.message); }
```
The Java `fraud-engine/` service is intentionally not wired up in this
environment. Rather than the whole transaction endpoint failing whenever
it's unreachable, scoring defaults to `{ score: 0, status: 'clear' }` and a
warning is logged — transactions still flow end-to-end (create → dashboard
→ socket update) for testing the rest of the pipeline, they just won't show
non-zero fraud scores until the engine is actually deployed.

### 2.9 Data model changes

**`Transaction` (`server/models/Transaction.js`):**
- Added the full identity-graph field set (`accountId`, `fingerprint`,
  `sessionId`, `ipAddress`, `walletId`, `email`, `phone`) as optional,
  `sparse`-indexed fields — optional so existing callers that don't send
  them keep working unchanged; indexed because they're each a lookup key
  for `identityGraphService`.
- Added `'rejected'` to the `fraudStatus` enum — the new terminal state for
  "touched a blocked entity," distinct from `'blocked'` (flagged by
  scoring) and never a delete.
- Added a compound index `{ fraudStatus: 1, createdAt: -1 }` — the review
  queue listing (filter by status, sort by recency) is the hottest query in
  the app; this keeps it off a full collection scan as data grows.

**`BlockList` (`server/models/BlockList.js`):**
- Expanded the `type` enum to every identity field, not just `userId` /
  `deviceId`.
- Replaced a plain compound index with a **partial unique index**:
  ```js
  blockListSchema.index({ type: 1, value: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
  ```
  This makes "you can't have two *active* blocks for the same
  `(type, value)`" a database-level guarantee, not just an application-level
  check — even the fallback (non-transactional) write path from
  `withOptionalTransaction` can't violate it. It's "partial" so a
  previously-unblocked (`isActive: false`) entry doesn't collide with a
  fresh block of the same value.

**`FraudAlert` (`server/models/FraudAlert.js`):**
- Added the same identity fields (for identity-graph queries against
  alerts, e.g. "resolve every open alert touching this identity").
- Added `optimisticConcurrency: true` — see the alert controller below.

### 2.10 Controllers — thin, delegate to services

`transactionController.js` and `alertController.js` were rewritten to be
thin: they parse the request, call a service function, and map the
service's result to an HTTP response. All business logic (fraud scoring
sequencing, blocklist cascades, audit writes) lives in `services/`.

```js
// transactionController.createTransaction
const result = await transactionService.createTransaction(req.body);
if (result.outcome === 'blocked_final') return res.status(403).json({...});   // race caught at commit
if (result.outcome === 'blocked_initial') return res.status(200).json({...}); // caught immediately
res.status(201).json({...});                                                   // genuinely created
```

```js
// alertController.resolveAlert — fetch + mutate + save, not findByIdAndUpdate
const alert = await FraudAlert.findById(req.params.id);
alert.status = status; alert.resolvedBy = req.user.email; alert.resolvedAt = new Date();
await alert.save(); // <-- this is where optimisticConcurrency kicks in
```
`findByIdAndUpdate` bypasses Mongoose's document versioning, so two analysts
resolving the same alert simultaneously would silently overwrite each
other. Fetch-mutate-`.save()` means the second `.save()` call throws a
`VersionError` (mapped to `409 Conflict` by the global error handler),
telling the losing analyst to refresh and retry instead of silently losing
their action.

`blockUser` / `blockDevice` in `alertController.js` are now one-liners that
build a `seedIdentifiers` object and call `blocklistService.blockEntity` —
all the cascading logic lives in the service, not duplicated per-endpoint.

### 2.11 Route-level input hardening — `server/routes/blockListRoutes.js`

```js
if (typeof type !== 'string' || !IDENTITY_FIELDS.includes(type)) {
  throw new ValidationError(`type must be one of: ${IDENTITY_FIELDS.join(', ')}`);
}
if (typeof value !== 'string' || !value.trim()) throw new ValidationError('value is required and must be a string');
```
The generic "block any identifier" endpoint whitelists `type` against the
same `IDENTITY_FIELDS` list the identity graph uses, and forces `value` to
a plain string before it ever reaches a Mongo query. This defends against a
NoSQL-injection pattern where a caller passes an object (e.g.
`{ "$ne": null }`) as `value` to smuggle a query operator into what should
be a plain equality match.

### 2.12 `server/index.js` wiring

Three additions, in this order, all before routes are mounted:
1. `io.use(socketAuthMiddleware)` — every socket connection is authenticated
   (or explicitly anonymous) before any event handler runs.
2. `attachSocketBridge(io)` — the event bus starts forwarding to real
   sockets.
3. `app.use(errorHandler)` — registered **last**, after every route, so it
   catches everything upstream.

`campaignDetector.js`'s periodic interval call changed from
`detectCampaigns(io)` to `detectCampaigns()` — it now emits
`CAMPAIGN_NEW` / `CAMPAIGN_UPDATED` through the event bus instead of taking
`io` as a parameter, consistent with every other service.

---

## 3. Frontend compatibility patches (backend rebuild support)

The backend changes above didn't change any *route paths*, but they did
change two things the frontend needed to adapt to:

1. **One authenticated socket instead of many raw ones.**
   `client/src/api/socket.js` now exports `getSocket()` / `resetSocket()` —
   a single shared `Socket.IO` connection created once, carrying the
   current JWT in `auth.token` at handshake time (matching
   `socketAuthMiddleware` above). Every page that previously called
   `io(SOCKET_URL)` directly (`useSocket.js`, `Layout.jsx`, `Alerts.jsx`,
   `Simulator.jsx`, `Dashboard.jsx`, `Intelligence.jsx`) now calls
   `getSocket()` instead, and their cleanup calls `socket.off(handlerFn)`
   for their own named handlers rather than `socket.disconnect()` — so one
   page unmounting doesn't kill the shared connection for every other page.
   `AuthContext.jsx` calls `resetSocket()` on login/logout so the socket
   reconnects with the new token (or drops back to anonymous) immediately.
2. **Block responses are now cascade results, not single records.**
   Blocking now returns `{ entries, transactionsRejected, alertsResolved,
   activityLogId }` instead of one new `BlockList` row. `BlockList.jsx`'s
   `add()` now calls `load()` to refetch the full list instead of
   hand-patching local state with the old single-entry shape, and
   `Alerts.jsx`'s block actions log `transactionsRejected` /
   `alertsResolved` counts to reflect what actually happened.

---

## 4. Frontend visual redesign

### 4.1 Creative direction

**Concept:** *PayGuard Precinct* — the fraud dashboard is reframed as a
retro, 16-bit "operations precinct" that analysts patrol room-to-room,
rather than a conventional admin/SaaS dashboard. The visual language is
CRT-terminal-meets-command-center: chunky pixel borders, hard drop shadows,
scanline overlays, and pixel/monospace type — deliberately *not*
corporate-blue-on-white.

**Why a game-like framing:** fraud analysts spend hours a day in this tool
triaging alerts, which is repetitive, high-stakes work. Giving the app a
living "precinct" identity — a receptionist character who visibly reacts to
what's happening — makes the state of the system legible at a glance (calm
vs. alert) and gives the tool a personality worth checking regularly,
instead of it being purely a data grid.

### 4.2 Design tokens — `client/src/index.css`

```css
@theme {
  --font-pixel: "Pixelify Sans", sans-serif;   /* UI labels, buttons, nav */
  --font-vt: "VT323", monospace;               /* large display headings */
  --font-mono: "JetBrains Mono", monospace;    /* body copy, tabular data */

  --color-brand: #00ffcc;                      /* signature neon teal — "nominal" state */
  --color-bg-primary: #050508;                 /* near-black CRT background */
  --color-bg-card: #0d0d16;                    /* terminal block surface */
  ...
}
```
All colors and fonts are declared once as CSS custom properties (Tailwind
v4's `@theme` block) rather than hardcoded per-component, so the whole
palette can be retuned from one file. `--color-brand` (`#00ffcc`) is the
signature color — it means "system nominal" everywhere it appears (status
text, active nav item, live-connection indicator), with amber/red reserved
for review/blocked states so the palette itself communicates fraud-severity
semantics.

```css
.pixel-box    { border: 2px solid ...; box-shadow: 4px 4px 0 0 rgba(0,0,0,0.8); }
.pixel-btn    { ...; transition: transform 0.1s, box-shadow 0.1s; }
.pixel-btn:active:not(:disabled) { transform: translate(2px, 2px); box-shadow: 0 0 0 0 ...; }
.crt-overlay  { background: linear-gradient(...) ; background-size: 100% 4px; } /* scanlines */
```
- `.pixel-box` / `.pixel-btn` give every card and button the same hard
  drop-shadow-and-2px-border language, standing in for a "chunky sprite"
  feel without needing actual bitmap UI chrome.
- The `:active` state on `.pixel-btn` moves the button by the same offset
  as its shadow and removes the shadow — a physical "pressed into the
  screen" effect that reads instantly as tactile, 8-bit-game feedback.
- `.crt-overlay` is a fixed, full-viewport horizontal-line gradient
  repeated every 4px — a subtle scanline texture over the whole app that
  reinforces the "old terminal" read without hurting text legibility.
- `@keyframes bob / shake / blink` are the three states used to animate the
  receptionist and status text with plain CSS — no spritesheet or animation
  library needed, since these are static generated images being moved, not
  frame-by-frame sprites.

### 4.3 Generated pixel-art assets — `client/src/assets/pixel/`

Three images were generated to anchor the identity:
- `receptionist_idle.png` — calm state, shown by default.
- `receptionist_alert.png` — agitated state, swapped in when a fraud alert
  fires.
- `bg_tile.png` — a seamless floor/background texture tiled behind the
  layout via CSS `background-repeat`.

They're rendered with `image-rendering: pixelated` (set globally on `body`
in `index.css`) so scaling never blurs them — a hard requirement for pixel
art to read correctly at different sizes.

### 4.4 Dashboard → "Main Operations Hub" (`client/src/pages/Dashboard.jsx`)

The redesign's core interaction: the receptionist avatar is **driven by
real socket events**, not decorative.

```jsx
const [isAlert, setIsAlert] = useState(false);
...
const handleNewFraudAlert = ({ transaction }) => {
  setIsAlert(true);
  setTimeout(() => setIsAlert(false), 4000);
  ...update stats counters from the real transaction payload...
};
s.on('new-transaction', handleNewTransaction);
s.on('new-fraud-alert', handleNewFraudAlert);
```
```jsx
<img
  src={isAlert ? receptionistAlert : receptionistIdle}
  className={isAlert ? 'animate-shake' : 'animate-bob'}
  style={{ imageRendering: 'pixelated' }}
/>
...
STATUS: <span className={isAlert ? 'text-red-400 animate-blink' : 'text-brand'}>
  {isAlert ? 'ALERT CONDITION RED' : 'NOMINAL'}
</span>
```
When the existing `new-fraud-alert` socket event fires (unchanged event
name/payload from the backend), the avatar swaps to its alert sprite,
switches from a slow idle "bob" animation to a fast "shake," the status
line flips to a blinking "ALERT CONDITION RED," and it automatically reverts
to idle after 4 seconds if nothing new comes in. This is a direct,
non-decorative mapping from live data to visual state — exactly the
"avatars reflect real data flow" requirement.

The stat cards, live transaction feed (`TxRow`), rule-trigger breakdown, and
charts underneath keep their exact original data source (`api.get(...)` and
the same socket handlers) — only their presentation was rebuilt into the
pixel-terminal visual language (`pixel-box` cards, `RuleTag` pill badges
colored per rule, monospace tabular numbers).

### 4.5 Other rooms

- **Alerts → "Review Dept"** (`pages/Alerts.jsx`): the triage queue,
  restyled with the same terminal card language; block actions now surface
  the cascade counts (`transactionsRejected`, `alertsResolved`) returned by
  the new `blocklistService`.
- **Intelligence → "Intel Room"** (`pages/Intelligence.jsx`): active fraud
  campaigns (device-fingerprint attacks, merchant clusters, enumeration,
  relay fraud), same data source, restyled as terminal readouts.
- **Simulator → "Workbench"** (`pages/Simulator.jsx`): lets analysts fire
  test transactions and watch live scoring stream in via the same socket
  events, restyled as a terminal console.
- **BlockList → "Block Registry"** (`pages/BlockList.jsx`): currently
  blocked identities plus the permanent activity log — refetches after
  every block/unblock (see §3) to reflect cascade results accurately.
- **Login** (`pages/LoginPage.jsx`): reimagined as a "secure terminal" entry
  screen (`bg_tile.png` background, `SECURE_TERM_01` framing, `UPLINK_ID` /
  `ACCESS_CODE` field labels, `ENGAGE` submit button) instead of a generic
  form, so the tone is set from the very first screen.

### 4.6 Navigation — `client/src/components/shared/Sidebar.jsx`

```jsx
const NAV = [
  { to: '/dashboard',    label: 'HUB / HQ',       sub: 'Operations Core' },
  { to: '/intelligence', label: 'INTEL ROOM',     sub: 'Threat Campaigns' },
  { to: '/alerts',       label: 'REVIEW DEPT',    sub: 'Active Alerts' },
  { to: '/simulator',    label: 'WORKBENCH',      sub: 'Simulations' },
  { to: '/blocklist',    label: 'BLOCK REGISTRY', sub: 'Locked Entities' },
];
```
The sidebar is framed as "PRECINCT COMMS" — a directory of rooms, each with
a one-line description of its purpose, rather than a generic icon-plus-label
nav list. The live socket-connection indicator (`LINK ESTABLISHED` /
`LINK LOST...`) uses the same brand-teal/red semantics as the rest of the
app. The active route gets a pressed-in visual (shifted by its own shadow
offset, exactly mirroring the `.pixel-btn:active` physical-press language)
so "which room you're in" reads the same way as "a button being held down."

### 4.7 What did not change

- No route paths, API endpoint URLs, or socket event names changed.
- No business logic moved into the frontend — every page still gets its
  data from the same REST calls and socket events as before the redesign.
- `src/api/axiosConfig.js`, `src/context/AuthContext.jsx`'s auth flow, and
  `src/App.jsx`'s route protection were reused as-is.

---

## 5. Verification performed

- Registered/logged in a test analyst account; created transactions via the
  API (defaulting to `clear` since the fraud engine isn't wired up).
- Blocked a device through the generic `/api/blocklist` endpoint and
  confirmed identity-graph traversal correctly pulled in the linked
  `userId` and `ipAddress` as well.
- Confirmed re-blocking an already-blocked entity is idempotent (no crash,
  no poisoned transaction) — this is the check-then-insert fix from §2.7.
- Confirmed a new transaction from an already-blocked user+device is
  immediately rejected (`fraudStatus: 'blocked'`, `fraudScore: 100`).
- Confirmed unblocking works and clears the active block.
- `npx vite build` completes with no errors; both the `Frontend` and
  `Backend` workflows start cleanly with no console errors.

## 6. Explicitly out of scope

- The Java `fraud-engine/` service remains unwired — `transactionService`
  falls back to a `clear` score if it's unreachable (see §2.8). Wiring it
  up is a separate, larger task.
- No secrets or credentials were rotated as part of this work.
