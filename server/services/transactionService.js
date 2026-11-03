/**
 * transactionService.js — the heart of PayGuard. Every transaction that
 * enters the system goes through createTransaction() below, in 4 steps:
 *
 *   1. BLOCKLIST CHECK  — is any identifier (user, device, IP, ...) banned?
 *   2. FRAUD SCORING    — ask the Java engine for a score (rules decide).
 *   3. RE-CHECK         — check the blocklist AGAIN, just before saving.
 *                         Step 2 takes time (a network call). If an analyst
 *                         blocked this user while scoring was happening,
 *                         step 1's answer is stale — so we ask again.
 *   4. SAVE + ALERT     — save the transaction; if it is not "clear",
 *                         create a FraudAlert for the analyst queue.
 *
 * If the Java engine is down, the transaction is still saved, marked
 * scoringEngine: 'fallback' with score 0 — the system says openly that it
 * was NOT scored, instead of pretending it was checked and passed.
 */
const { v4: uuidv4 } = require('uuid');
const Transaction = require('../models/Transaction');
const FraudAlert = require('../models/FraudAlert');
const { callFraudEngine } = require('../utils/fraudEngineClient');
const { recordScoringFallback } = require('./engineHealthService');
const { detectCampaigns } = require('./campaignDetector');
const { isAnyIdentifierBlocked } = require('./blocklistService');
const { extractIdentifiers } = require('./identityGraphService');
const { eventBus, EVENTS } = require('../events/eventBus');
const { ValidationError } = require('../utils/errors');

const REQUIRED_FIELDS = ['userId', 'merchantId', 'amount'];
const OPTIONAL_IDENTITY_FIELDS = ['deviceId', 'accountId', 'fingerprint', 'sessionId', 'ipAddress', 'walletId', 'email', 'phone'];

// A client clock can be a few seconds behind the server; that is not "backdating".
const TIMESTAMP_SKEW_MS = 5 * 1000;

/**
 * Decide the transaction's timestamp.
 * - No timestamp given        -> use now.
 * - Timestamp in the future   -> reject (invalid).
 * - Old (historical) timestamp -> only allowed for API-key callers, who use it
 *   to replay past transactions. A normal logged-in session may not backdate,
 *   because that would let someone insert a transaction behind a rule window.
 */
const parseTimestamp = (raw, { allowPastTimestamp = false } = {}) => {
  if (raw === undefined || raw === null || raw === '') return new Date();
  const parsed = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError('timestamp must be a parseable date (ISO-8601 recommended)');
  }
  const now = Date.now();
  if (parsed.getTime() > now + TIMESTAMP_SKEW_MS) {
    throw new ValidationError('timestamp cannot be in the future');
  }
  if (parsed.getTime() < now - TIMESTAMP_SKEW_MS && !allowPastTimestamp) {
    throw new ValidationError('historical timestamps require API-key authentication (x-api-key)');
  }
  return parsed;
};

/**
 * Validate the request body and build the clean transaction input object.
 * Throws ValidationError on the first problem found.
 * beneficiaryId is the person who RECEIVED the money (used by mule
 * detection). It is deliberately not an identity field of the payer, so
 * blocking a payer never auto-blocks everyone they paid.
 */
const buildTransactionInput = (body, options = {}) => {
  for (const field of REQUIRED_FIELDS) {
    if (body[field] === undefined || body[field] === null || body[field] === '') {
      throw new ValidationError(`${field} is required`);
    }
  }
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) throw new ValidationError('amount must be a positive, finite number');

  const input = {
    timestamp: parseTimestamp(body.timestamp, options),
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
  if (body.beneficiaryId !== undefined && body.beneficiaryId !== null && body.beneficiaryId !== '') {
    input.beneficiaryId = String(body.beneficiaryId);
  }
  return input;
};

/**
 * Save a transaction as rejected because of a blocklist hit.
 * It is still SAVED (score 100, status 'blocked') — nothing in PayGuard is
 * ever silently dropped, so there is always a record of the attempt.
 */
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
 * Run one transaction through the 4-step pipeline described at the top.
 * Returns { outcome, transaction, alert? } where outcome is:
 *   'blocked_initial' — blocked at step 1 (never scored)
 *   'blocked_final'   — blocked at step 3 (blocked WHILE being scored;
 *                       the controller must answer 403, never 201)
 *   'created'         — scored and saved normally
 */
const createTransaction = async (body, options = {}) => {
  const input = buildTransactionInput(body, options);
  const identifiers = extractIdentifiers(input);

  // STEP 1 — blocklist check.
  const initialBlock = await isAnyIdentifierBlocked(identifiers);
  if (initialBlock) {
    const transaction = await rejectTransaction(input, initialBlock);
    return { outcome: 'blocked_initial', transaction };
  }

  // STEP 2 — fraud scoring by the Java engine (3-second timeout inside
  // callFraudEngine). If the engine is unreachable, fall back to score 0 /
  // 'clear' but RECORD the fallback so the dashboard can show it.
  const draft = { transactionId: uuidv4(), ...input };
  let fraudResult = { score: 0, status: 'clear', rulesTriggered: [] };
  let scoringEngine = 'engine';
  try {
    fraudResult = await callFraudEngine(draft);
  } catch (error) {
    scoringEngine = 'fallback';
    console.warn('Fraud engine unavailable, defaulting to clear:', error.message);
    recordScoringFallback(error.code || error.message || 'unknown error');
  }

  // STEP 3 — final blocklist re-check (closes the race described above).
  const finalBlock = await isAnyIdentifierBlocked(identifiers);
  if (finalBlock) {
    const transaction = await rejectTransaction(input, finalBlock);
    return { outcome: 'blocked_final', transaction };
  }

  // STEP 4 — save, and create an alert if the verdict is not 'clear'.
  const transaction = await Transaction.create({
    ...draft,
    fraudScore: fraudResult.score,
    fraudStatus: fraudResult.status,
    rulesTriggered: fraudResult.rulesTriggered,
    scoringEngine,
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
    // Give the alert a response deadline based on its score.
    const { ensureSLA } = require('./caseService');
    await ensureSLA(alert);
    eventBus.emit(EVENTS.NEW_FRAUD_ALERT, { alert, transaction });
    eventBus.emit(EVENTS.REVIEW_QUEUE_UPDATED, { added: [transaction._id] });
    // Look for a coordinated campaign this alert may be part of (async).
    setImmediate(() => detectCampaigns().catch((err) => console.error('Campaign detection error:', err.message)));
  }

  // Keep the merchant's risk profile up to date (async, not on the hot path).
  setImmediate(() => {
    const { upsertFromTransaction } = require('./merchantService');
    upsertFromTransaction(transaction).catch(err => console.error('Merchant update error:', err.message));
  });

  eventBus.emit(EVENTS.NEW_TRANSACTION, transaction);
  return { outcome: 'created', transaction, alert };
};

module.exports = { createTransaction, buildTransactionInput };
