/**
 * muleDetectorService.js — mule-account detection.
 *
 * The #1 fraud pattern in UPI/payment networks: a mule account receives money
 * from victims (multiple distinct senders) and quickly forwards most of it to
 * a beneficiary, keeping a small cut. This detector:
 *
 *   1. Looks back 24h and finds accounts that RECEIVED funds
 *      (`beneficiaryId` present) and also FORWARDED funds (appeared as payer),
 *      where the forwarded amount chains to the received amount (>= 60%),
 *      money came in before it went out, and the money arrived from multiple
 *      distinct senders — the classic mule profile.
 *   2. Clusters flagged accounts into RINGS by shared identity — the same
 *      device / IP / fingerprint / email used by several mules means one
 *      operation, not N mules. This is where the identity graph pays off:
 *      blocking one ring member's identifiers cascades to the whole ring.
 *   3. Persists/updates MuleRing documents and emits socket events, so the
 *      UI shows live laundering rings with a one-click "block ring".
 */
const Transaction = require('../models/Transaction');
const MuleRing = require('../models/MuleRing');
const { eventBus, EVENTS } = require('../events/eventBus');

const MULE_WINDOW_MS = 24 * 60 * 60 * 1000;   // 24h look-back
const MIN_RECEIVE_TOTAL = 10_000;             // must take in >= this much
const MIN_DISTINCT_SENDERS = 2;               // money from >= this many payers
const MIN_FORWARD_RATIO = 0.6;                // must send on >= 60% of what it took in
const EVIDENCE_CAP = 30;                      // evidence rows stored per ring

// Identifier types used to tie separate accounts into one ring. (userId is the
// account itself; beneficiaryId is its counterparty, not its identity.)
const RING_LINK_FIELDS = ['deviceId', 'ipAddress', 'fingerprint', 'email', 'phone', 'accountId', 'walletId', 'sessionId'];

const safeId = (v) => (v === undefined || v === null || v === '' || v === 'unknown' ? null : String(v));

const aggregateInbound = (txns) => {
  const byAccount = {};
  for (const t of txns) {
    const acct = safeId(t.beneficiaryId);
    if (!acct) continue;
    if (!byAccount[acct]) {
      byAccount[acct] = { receivedTotal: 0, receivedCount: 0, senders: new Set(), earliest: null, latest: null, txns: [] };
    }
    const a = byAccount[acct];
    a.receivedTotal += t.amount || 0;
    a.receivedCount += 1;
    a.senders.add(String(t.userId));
    a.earliest = a.earliest === null || t.timestamp < a.earliest ? t.timestamp : a.earliest;
    a.latest = a.latest === null || t.timestamp > a.latest ? t.timestamp : a.latest;
    a.txns.push({ transactionId: t.transactionId, kind: 'receive', userId: t.userId, beneficiaryId: t.beneficiaryId, amount: t.amount, timestamp: t.timestamp });
  }
  return byAccount;
};

const aggregateOutbound = (txns) => {
  const byAccount = {};
  for (const t of txns) {
    const acct = safeId(t.userId);
    if (!acct) continue;
    if (!byAccount[acct]) {
      byAccount[acct] = { forwardedTotal: 0, forwardedCount: 0, beneficiaries: new Set(), earliest: null, txns: [] };
    }
    const a = byAccount[acct];
    a.forwardedTotal += t.amount || 0;
    a.forwardedCount += 1;
    a.beneficiaries.add(safeId(t.beneficiaryId) || String(t.merchantId));
    a.earliest = a.earliest === null || t.timestamp < a.earliest ? t.timestamp : a.earliest;
    a.txns.push({ transactionId: t.transactionId, kind: 'forward', userId: t.userId, beneficiaryId: safeId(t.beneficiaryId) || t.merchantId, amount: t.amount, timestamp: t.timestamp });
  }
  return byAccount;
};

/** Union-find over accounts sharing any identity value in the window. */
const clusterBySharedIdentity = (accounts, accountTxns) => {
  const parent = new Map(accounts.map(a => [a, a]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const valueToAccounts = new Map();
  for (const acct of accounts) {
    for (const t of accountTxns.get(acct) || []) {
      for (const field of RING_LINK_FIELDS) {
        const v = safeId(t[field]);
        if (!v) continue;
        if (!valueToAccounts.has(`${field}:${v}`)) valueToAccounts.set(`${field}:${v}`, []);
        valueToAccounts.get(`${field}:${v}`).forEach(other => union(acct, other));
        valueToAccounts.get(`${field}:${v}`).push(acct);
      }
    }
  }

  const groups = new Map();
  for (const acct of accounts) {
    const root = find(acct);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(acct);
  }
  return [...groups.values()];
};

const detectMuleRings = async () => {
  const since = new Date(Date.now() - MULE_WINDOW_MS);
  const txns = await Transaction.find({ timestamp: { $gte: since } }).lean();

  const inbound = aggregateInbound(txns);
  const outbound = aggregateOutbound(txns);

  // Flag accounts that both received and forwarded, with the mule profile.
  const flagged = [];
  for (const [account, rec] of Object.entries(inbound)) {
    const fwd = outbound[account];
    if (!fwd) continue;
    if (rec.receivedTotal < MIN_RECEIVE_TOTAL) continue;
    if (rec.senders.size < MIN_DISTINCT_SENDERS) continue;
    if (fwd.forwardedTotal < MIN_FORWARD_RATIO * rec.receivedTotal) continue;
    // Money must have come IN before it went OUT (receive-then-forward).
    if (!(fwd.earliest && rec.earliest && fwd.earliest >= rec.earliest)) continue;
    flagged.push({
      account,
      receivedTotal: Math.round(rec.receivedTotal),
      receivedCount: rec.receivedCount,
      senders: [...rec.senders],
      forwardedTotal: Math.round(fwd.forwardedTotal),
      forwardedCount: fwd.forwardedCount,
      beneficiaries: [...fwd.beneficiaries].filter(Boolean),
      earliest: rec.earliest,
      latest: fwd.earliest,
      txns: [...rec.txns, ...fwd.txns],
    });
  }

  if (flagged.length === 0) return;

  // Do not re-flag accounts already tracked by ANY ring — an account frozen
  // by a blocked ring stays frozen; its (rejected) post-block transactions
  // must not spin up a duplicate ring every cycle.
  const existingRings = await MuleRing.find().lean();
  const covered = new Set(existingRings.flatMap(r => r.accounts));

  const candidates = flagged.filter(f => !covered.has(f.account));
  if (candidates.length === 0) return;

  // Per-account transaction list (for ring linking via shared identity).
  const accountTxns = new Map();
  for (const c of candidates) {
    accountTxns.set(c.account, txns.filter(t => String(t.userId) === c.account || safeId(t.beneficiaryId) === c.account));
  }

  const rings = clusterBySharedIdentity(candidates.map(c => c.account), accountTxns);

  for (const accounts of rings) {
    const members = candidates.filter(c => accounts.includes(c.account));
    const allTxns = members.flatMap(m => m.txns);
    const shared = {};
    for (const field of RING_LINK_FIELDS) {
      const values = new Set();
      for (const acct of accounts) {
        for (const t of accountTxns.get(acct) || []) {
          const v = safeId(t[field]);
          if (v) values.add(v);
        }
      }
      if (values.size) shared[field] = [...values];
    }

    const accountKey = accounts.slice().sort().join('|');
    const existing = existingRings.find(r => r.accounts.slice().sort().join('|') === accountKey);

    const data = {
      accounts,
      totalReceived: members.reduce((s, m) => s + m.receivedTotal, 0),
      totalForwarded: members.reduce((s, m) => s + m.forwardedTotal, 0),
      receivedFrom: [...new Set(members.flatMap(m => m.senders))],
      forwardedTo: [...new Set(members.flatMap(m => m.beneficiaries))],
      sharedIdentifiers: shared,
      evidence: allTxns.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).slice(0, EVIDENCE_CAP),
      firstSeenAt: new Date(Math.min(...allTxns.map(t => new Date(t.timestamp)))),
      lastSeenAt: new Date(Math.max(...allTxns.map(t => new Date(t.timestamp)))),
    };

    if (existing) {
      const updated = await MuleRing.findByIdAndUpdate(existing._id, data, { new: true });
      eventBus.emit(EVENTS.MULE_RING_UPDATED, updated);
    } else {
      const saved = await MuleRing.create(data);
      eventBus.emit(EVENTS.MULE_RING_NEW, saved);
    }
  }
};

/**
 * Blocks every account in a ring via the identity-graph cascade: blocking one
 * account traces the devices/IPs/fingerprints it shared and locks the whole
 * operation. Marks the ring blocked.
 */
const blockMuleRing = async (ringId, blockedBy) => {
  const blocklistService = require('./blocklistService');
  const ring = await MuleRing.findById(ringId);
  if (!ring) {
    const { NotFoundError } = require('../utils/errors');
    throw new NotFoundError('Ring not found');
  }
  if (ring.status === 'blocked') return { ring, blockedCount: 0 };

  const results = [];
  for (const account of ring.accounts) {
    const result = await blocklistService.blockEntity({
      seedIdentifiers: { userId: account },
      reason: `Mule ring ${ring._id} — receive-and-forward laundering`,
      blockedBy,
    });
    results.push(result);
  }

  ring.status = 'blocked';
  ring.blockedAt = new Date();
  ring.blockedBy = blockedBy;
  await ring.save();
  eventBus.emit(EVENTS.MULE_RING_UPDATED, ring);

  return { ring, blockedCount: ring.accounts.length, entries: results };
};

const listMuleRings = async (limit = 50) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const rings = await MuleRing.find().sort({ lastSeenAt: -1 }).limit(safeLimit).lean();
  const stats = {
    active: rings.filter(r => r.status === 'open').length,
    blocked: rings.filter(r => r.status === 'blocked').length,
    accounts: rings.reduce((s, r) => s + r.accounts.length, 0),
    totalReceived: rings.reduce((s, r) => s + r.totalReceived, 0),
  };
  return { rings, stats };
};

module.exports = { detectMuleRings, blockMuleRing, listMuleRings };
