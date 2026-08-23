/**
 * disputeService.js — dispute/chargeback ingestion and detection-rate reporting.
 *
 * A dispute is external ground truth. When one arrives for a transaction we
 * didn't catch (or did), it either confirms our fraud labels or exposes a
 * miss. `ingestDispute` records the dispute immutably and labels the
 * transaction; `getDetectionRates` then answers the question the whole
 * platform is built for: "of the fraud we now KNOW about, what did each rule
 * catch at scoring time?"
 */
const Dispute = require('../models/Dispute');
const Transaction = require('../models/Transaction');
const { eventBus, EVENTS } = require('../events/eventBus');
const { ValidationError, ConflictError, NotFoundError } = require('../utils/errors');

// Reasons that mean the transaction WAS fraud. Anything else (duplicate,
// not_received, product issues) is a merchant/customer problem, not fraud.
const FRAUD_REASONS = ['fraud', 'unauthorized', 'stolen_card', 'account_takeover'];

const ALLOWED_REASONS = [...FRAUD_REASONS, 'duplicate', 'not_received', 'product_not_as_described', 'other'];
const ALLOWED_STATUSES = ['open', 'won', 'lost', 'closed'];

const isFraudReason = (reason) => FRAUD_REASONS.includes(String(reason).toLowerCase());
// Lost disputes: the issuer sided with the cardholder — money returned, fraud confirmed.
const isFraudOutcome = (status) => String(status).toLowerCase() === 'lost';

/**
 * Records a dispute and labels the underlying transaction as confirmed fraud
 * when the dispute is fraud-type or lost. Returns the updated transaction.
 */
const ingestDispute = async ({ transactionId, reason, status, amount, notes, filedBy }) => {
  if (!transactionId || typeof transactionId !== 'string' || !transactionId.trim()) {
    throw new ValidationError('transactionId is required');
  }
  if (!ALLOWED_REASONS.includes(reason)) {
    throw new ValidationError(`reason must be one of: ${ALLOWED_REASONS.join(', ')}`);
  }
  if (!ALLOWED_STATUSES.includes(status)) {
    throw new ValidationError(`status must be one of: ${ALLOWED_STATUSES.join(', ')}`);
  }

  const transaction = await Transaction.findOne({ transactionId });
  if (!transaction) {
    throw new NotFoundError(`No transaction with id '${transactionId}' — disputes must reference an ingested transaction.`);
  }

  const fraudConfirmed = isFraudReason(reason) || isFraudOutcome(status);

  const existing = await Dispute.findOne({ transactionId, reason, status });
  if (existing) {
    throw new ConflictError('A dispute with this transaction, reason and status already exists.');
  }

  const dispute = await Dispute.create({
    transactionId,
    reason,
    status,
    amount: amount !== undefined ? Number(amount) : transaction.amount,
    notes,
    fraudConfirmed,
    filedBy: filedBy || 'api',
  });

  if (fraudConfirmed) {
    transaction.isConfirmedFraud = true;
    transaction.disputeReason = reason;
    transaction.disputedAt = new Date();
    await transaction.save();
  }

  eventBus.emit(EVENTS.DISPUTE_INGESTED, { dispute, transaction });

  // Update merchant dispute rate (fire-and-forget)
  if (transaction.merchantId) {
    setImmediate(() => {
      const { recordDispute } = require('./merchantService');
      recordDispute(transaction.merchantId, fraudConfirmed).catch(err => console.error('Merchant dispute update error:', err.message));
    });
  }

  return { dispute, transaction };
};

/**
 * Per-rule detection rates over all confirmed-fraud transactions.
 * "Caught at scoring time" uses the rules actually triggered when the
 * transaction was scored (stored rulesTriggered + fraudStatus), i.e. what
 * the live engine decided — no replay, no hindsight.
 */
const getDetectionRates = async () => {
  const confirmed = await Transaction.find({ isConfirmedFraud: true }).lean();
  const total = confirmed.length;

  const caught = confirmed.filter(t => t.fraudStatus !== 'clear');
  const missed = confirmed.filter(t => t.fraudStatus === 'clear');

  const byRule = {};
  confirmed.forEach(t => {
    (t.rulesTriggered || []).forEach(r => {
      byRule[r.ruleName] = (byRule[r.ruleName] || 0) + 1;
    });
  });

  const avg = (arr, key) => arr.length
    ? Math.round(arr.reduce((s, t) => s + (t[key] || 0), 0) / arr.length)
    : 0;

  const rules = Object.entries(byRule)
    .map(([ruleName, count]) => ({
      ruleName,
      caught: count,
      detectionRate: total ? Math.round((count / total) * 100) : 0,
    }))
    .sort((a, b) => b.caught - a.caught);

  return {
    total,
    caught: caught.length,
    missed: missed.length,
    detectionRate: total ? Math.round((caught.length / total) * 100) : 0,
    avgScoreAtTime: avg(confirmed, 'fraudScore'),
    avgScoreCaught: avg(caught, 'fraudScore'),
    avgScoreMissed: avg(missed, 'fraudScore'),
    byReason: confirmed.reduce((acc, t) => {
      const r = t.disputeReason || 'unknown';
      acc[r] = (acc[r] || 0) + 1;
      return acc;
    }, {}),
    rules,
  };
};

const listDisputes = async (limit = 50) => {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  return Dispute.find().sort({ createdAt: -1 }).limit(safeLimit).lean();
};

module.exports = { ingestDispute, getDetectionRates, listDisputes, ALLOWED_REASONS, ALLOWED_STATUSES };
