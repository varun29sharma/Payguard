const { v4: uuidv4 } = require('uuid');
const Transaction = require('../models/Transaction');
const FraudAlert = require('../models/FraudAlert');
const { callFraudEngine } = require('../utils/fraudEngineClient');
const { detectCampaigns } = require('./campaignDetector');
const { isAnyIdentifierBlocked } = require('./blocklistService');
const { extractIdentifiers } = require('./identityGraphService');
const { eventBus, EVENTS } = require('../events/eventBus');
const { ValidationError } = require('../utils/errors');

const REQUIRED_FIELDS = ['userId', 'merchantId', 'amount'];
const OPTIONAL_IDENTITY_FIELDS = ['deviceId', 'accountId', 'fingerprint', 'sessionId', 'ipAddress', 'walletId', 'email', 'phone'];

const buildTransactionInput = (body) => {
  for (const field of REQUIRED_FIELDS) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      throw new ValidationError(`${field} is required`);
    }
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new ValidationError('amount must be a positive, finite number');

  const input = {
    userId: String(body.userId),
    merchantId: String(body.merchantId),
    amount,
    currency: body.currency ? String(body.currency) : 'INR',
    location: body.location && typeof body.location === 'object'
      ? { city: body.location.city, lat: body.location.lat, lng: body.location.lng }
      : undefined,
  };
  for (const field of OPTIONAL_IDENTITY_FIELDS) {
    if (body[field] !== undefined && body[field] !== null && body[field] !== '') input[field] = String(body[field]);
  }
  return input;
};

const rejectTransaction = async (input, blockEntry) => {
  const rejected = await Transaction.create({
    transactionId: uuidv4(),
    ...input,
    fraudScore: 100,
    fraudStatus: 'blocked',
    rulesTriggered: [{ ruleName: 'BLOCK_LIST', score: 100, reason: `Blocked: ${blockEntry.reason}` }],
  });
  eventBus.emit(EVENTS.NEW_TRANSACTION, rejected);
  eventBus.emit(EVENTS.TRANSACTION_REJECTED, { transaction: rejected, blockReason: blockEntry.reason, blockedBy: blockEntry.blockedBy });
  return rejected;
};

/**
 * Returns { outcome: 'blocked_initial' | 'blocked_final' | 'created', transaction, alert? }.
 * `blocked_final` means the entity was blocked *during* fraud scoring — the
 * caller must respond 403, never 200/201 (Bug #2: no blocked transaction
 * should ever succeed, even under a race).
 */
const createTransaction = async (body) => {
  const input = buildTransactionInput(body);
  const identifiers = extractIdentifiers(input);

  // STEP 1 — initial blocklist check.
  const initialBlock = await isAnyIdentifierBlocked(identifiers);
  if (initialBlock) {
    const transaction = await rejectTransaction(input, initialBlock);
    return { outcome: 'blocked_initial', transaction };
  }

  // STEP 2 — fraud scoring (network round-trip; this is the race window).
  const draft = { transactionId: uuidv4(), ...input, timestamp: new Date() };
  let fraudResult = { score: 0, status: 'clear', rulesTriggered: [] };
  try {
    fraudResult = await callFraudEngine(draft);
  } catch (e) {
    console.warn('Fraud engine unavailable, defaulting to clear:', e.message);
  }

  // STEP 3 — FINAL AUTHORIZATION CHECKPOINT (Bug #2). Re-check right before
  // commit so a block created mid-flight still catches this transaction.
  const finalBlock = await isAnyIdentifierBlocked(identifiers);
  if (finalBlock) {
    const transaction = await rejectTransaction(input, finalBlock);
    return { outcome: 'blocked_final', transaction };
  }

  // STEP 4 — commit.
  const transaction = await Transaction.create({
    ...draft,
    fraudScore: fraudResult.score,
    fraudStatus: fraudResult.status,
    rulesTriggered: fraudResult.rulesTriggered,
  });

  let alert = null;
  if (fraudResult.status !== 'clear') {
    alert = await FraudAlert.create({
      transaction: transaction._id,
      userId: transaction.userId, merchantId: transaction.merchantId, deviceId: transaction.deviceId,
      accountId: transaction.accountId, fingerprint: transaction.fingerprint, sessionId: transaction.sessionId,
      ipAddress: transaction.ipAddress, walletId: transaction.walletId, email: transaction.email, phone: transaction.phone,
      amount: transaction.amount, location: transaction.location,
      fraudScore: fraudResult.score, rulesTriggered: fraudResult.rulesTriggered,
    });
    eventBus.emit(EVENTS.NEW_FRAUD_ALERT, { alert, transaction });
    eventBus.emit(EVENTS.REVIEW_QUEUE_UPDATED, { added: [transaction._id] });
    setImmediate(() => detectCampaigns().catch((err) => console.error('Campaign detection error:', err.message)));
  }

  eventBus.emit(EVENTS.NEW_TRANSACTION, transaction);
  return { outcome: 'created', transaction, alert };
};

module.exports = { createTransaction };
