const mongoose = require('mongoose');
const BlockList = require('../models/BlockList');
const Transaction = require('../models/Transaction');
const FraudAlert = require('../models/FraudAlert');
const BlockedActivityLog = require('../models/BlockedActivityLog');
const { eventBus, EVENTS } = require('../events/eventBus');
const { recordAudit } = require('./auditLogService');
const { ValidationError, NotFoundError, ConflictError } = require('../utils/errors');
const {
  IDENTITY_FIELDS,
  buildConnectedIdentifiers,
  identifiersToPairs,
  matchAnyIdentifierQuery,
} = require('./identityGraphService');

// Maps the brief's PENDING / UNDER_REVIEW / FLAGGED vocabulary onto this
// app's existing queue status. If more granular statuses are added later,
// list them here — this is the one place that defines "still in the queue".
const QUEUE_STATUSES = ['review'];
const REJECTED_STATUS = 'rejected';

const withOptionalTransaction = async (work) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    // Standalone Mongo (no replica set) can't run multi-document
    // transactions. Fall back to best-effort sequential writes rather than
    // hard-failing the whole feature — the partial unique index on BlockList
    // still prevents duplicate active blocks even without a session.
    if (/Transaction numbers|IllegalOperation|replica set|not supported/i.test(err.message || '')) {
      console.warn('MongoDB transactions unavailable, falling back to sequential writes:', err.message);
      return work(null);
    }
    throw err;
  } finally {
    session.endSession();
  }
};

/**
 * Atomically blocks every identifier connected to the given seed identifiers
 * (Bug #4) and immediately rejects every transaction still sitting in the
 * review queue for any of them (Bug #1) — no manual cleanup step required.
 * Nothing is ever deleted: rejected transactions and resolved alerts stay in
 * place, and a permanent snapshot is written to BlockedActivityLog.
 */
const blockEntity = async ({ seedIdentifiers, reason, blockedBy, relatedAlertId, relatedCampaignId, expiresAt }) => {
  if (!reason || !blockedBy) throw new ValidationError('reason and blockedBy are required to block an entity');

  const connected = await buildConnectedIdentifiers(seedIdentifiers);
  const pairs = identifiersToPairs(connected);
  if (!pairs.length) throw new ValidationError('No valid identifiers provided to block');

  return withOptionalTransaction(async (session) => {
    const opts = session ? { session } : undefined;

    // 1) Create a BlockList entry per identifier that isn't already actively
    // blocked. We check-then-insert rather than insert-and-catch-E11000:
    // inside a multi-document Mongo transaction, a single failed write
    // (even one caught by application code) marks the whole session
    // aborted, so every later operation in this same withTransaction() call
    // would fail too. Pre-checking keeps the happy path (re-blocking an
    // already-blocked entity) from poisoning the transaction.
    const existingQuery = { isActive: true, $or: pairs.map(({ type, value }) => ({ type, value })) };
    const existing = session
      ? await BlockList.find(existingQuery).session(session)
      : await BlockList.find(existingQuery);
    const alreadyBlocked = new Set(existing.map((e) => `${e.type}:${e.value}`));

    const createdEntries = [...existing];
    for (const { type, value } of pairs) {
      if (alreadyBlocked.has(`${type}:${value}`)) continue;
      try {
        const [entry] = await BlockList.create([{
          type, value, reason, blockedBy, relatedAlertId, relatedCampaignId,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        }], opts);
        createdEntries.push(entry);
      } catch (err) {
        // A genuine race (another request blocked the same identifier
        // between our check and this insert) — surface it so the caller can
        // retry, rather than silently continuing inside a now-poisoned
        // transaction session.
        if (err.code !== 11000) throw err;
        throw new ConflictError(`"${value}" (${type}) was just blocked by another request — please retry.`);
      }
    }

    // 2) Reject every transaction still in the review queue for any
    // connected identifier — closes the "block user, their pending
    // transactions stay untouched" gap.
    const identifierQuery = matchAnyIdentifierQuery(connected);
    const queueQuery = { ...identifierQuery, fraudStatus: { $in: QUEUE_STATUSES } };
    const affectedTransactions = session
      ? await Transaction.find(queueQuery).session(session)
      : await Transaction.find(queueQuery);

    const transactionsAffected = [];
    for (const txn of affectedTransactions) {
      const matchedOn = IDENTITY_FIELDS.filter((f) => connected.has(f) && txn[f] && connected.get(f).has(String(txn[f])));
      transactionsAffected.push({
        transaction: txn._id, transactionId: txn.transactionId,
        previousStatus: txn.fraudStatus, newStatus: REJECTED_STATUS,
        amount: txn.amount, merchantId: txn.merchantId, matchedOn,
      });
      txn.fraudStatus = REJECTED_STATUS;
      txn.rulesTriggered = [...(txn.rulesTriggered || []), { ruleName: 'ENTITY_BLOCKED', score: 100, reason }];
      await txn.save(opts);
    }

    // 3) Resolve any open alerts tied to those identifiers instead of
    // leaving them stuck in the workbench queue forever.
    const alertQuery = { ...identifierQuery, status: 'open' };
    const openAlerts = session ? await FraudAlert.find(alertQuery).session(session) : await FraudAlert.find(alertQuery);
    for (const alert of openAlerts) {
      alert.status = 'resolved';
      alert.resolvedBy = blockedBy;
      alert.resolvedAt = new Date();
      await alert.save(opts);
    }

    // 4) Preserve everything — nothing is deleted, per product decision.
    const [activityLog] = await BlockedActivityLog.create([{
      identifiers: pairs, reason, blockedBy, relatedAlertId, relatedCampaignId,
      blockListEntryIds: createdEntries.map((e) => e._id),
      transactionsAffected, alertsAffected: openAlerts.map((a) => a._id),
    }], opts);

    await recordAudit({
      analyst: blockedBy, action: 'BLOCK_ENTITY',
      oldValue: null, newValue: { identifiers: pairs, reason },
      reason, affectedIds: [
        ...createdEntries.map((e) => String(e._id)),
        ...transactionsAffected.map((t) => String(t.transaction)),
        ...openAlerts.map((a) => String(a._id)),
      ],
    }, session);

    const result = {
      entries: createdEntries,
      transactionsRejected: transactionsAffected.length,
      alertsResolved: openAlerts.length,
      activityLogId: activityLog._id,
    };

    eventBus.emit(EVENTS.BLOCK_CREATED, result);
    if (transactionsAffected.length) {
      eventBus.emit(EVENTS.REVIEW_QUEUE_UPDATED, { removed: transactionsAffected.map((t) => t.transaction) });
    }
    for (const t of transactionsAffected) {
      eventBus.emit(EVENTS.TRANSACTION_UPDATED, { transactionId: t.transaction, fraudStatus: REJECTED_STATUS });
    }

    return result;
  });
};

const unblockEntity = async ({ blockListId, unblockedBy }) => {
  const entry = await BlockList.findById(blockListId);
  if (!entry) throw new NotFoundError('Block list entry not found');
  entry.isActive = false;
  await entry.save();

  await recordAudit({
    analyst: unblockedBy, action: 'UNBLOCK_ENTITY',
    oldValue: { isActive: true }, newValue: { isActive: false },
    reason: 'Manual unblock', affectedIds: [String(entry._id)],
  });
  eventBus.emit(EVENTS.BLOCK_REMOVED, { entry });
  return entry;
};

/**
 * Bug #2 fix — final authorization checkpoint. Re-checks the blocklist for
 * every identifier on a transaction right before it's allowed to commit,
 * closing the race window between the initial check and fraud scoring.
 */
const isAnyIdentifierBlocked = async (identifiers) => {
  const pairs = Object.entries(identifiers).filter(([, v]) => v);
  if (!pairs.length) return null;
  const or = pairs.map(([type, value]) => ({ type, value: String(value), isActive: true }));
  return BlockList.findOne({ $or: or });
};

module.exports = { blockEntity, unblockEntity, isAnyIdentifierBlocked };
