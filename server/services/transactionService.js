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

// Tolerated clock skew. A client that stamps its own `timestamp` locally can
// be a second or two behind the server (and the simulator builds `new Date()`
// in the browser), so a couple of seconds in the past is not "backdating".
const TIMESTAMP_SKEW_MS = 5 * 1000;

/**
 * Resolves the transaction timestamp. Precedence:
 *   1. a caller-supplied `timestamp` (historical replay, external feeds),
 *   2. wall-clock ingest time.
 *
 * A caller-supplied timestamp must be parseable and not in the future.
 * Historical (past) timestamps are only accepted on the API-key path —
 * `allowPastTimestamp` is set by the controller from `req.apiKey`. Rationale:
 * backdating is required for ML replay but is also an audit-integrity concern:
 * a compromised analyst session should not be able to insert a transaction
 * dated into the past to slip behind a rule window.
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
  // P2P recipient — the account that received the funds (mule detection needs
  // to see inbound flows, not just who paid). Not an identity of the payer,
  // so deliberately NOT part of OPTIONAL_IDENTITY_FIELDS / the blocklist graph.
  if (body.beneficiaryId !== undefined && body.beneficiaryId !== null && body.beneficiaryId !== '') {
    input.beneficiaryId = String(body.beneficiaryId);
  }
  return input;
};

/**
 * Decide which shadow ML score to persist, preferring the sidecar.
 *
 * Two honest implementations exist and the choice between them is recorded:
 *   - `mlSource: 'sidecar'` — the Phase 2 boosted model, with SHAP reasons
 *   - `mlSource: 'engine'`  — the Phase 1 logistic model inside the Java engine,
 *                             which is also the fallback when the sidecar is down
 *   - `mlSource: 'none'`    — nothing scored it, and `mlEngine` says why
 *
 * `mlEngine` keeps the same three honest states used everywhere else in the
 * platform: 'model', 'skipped' (no features), 'fallback' (nothing available).
 */
const resolveMlShadow = (fraudResult, mlOutcome, mlFallbackReason) => {
  if (mlOutcome && mlOutcome.ok) {
    return {
      mlScore: mlOutcome.probability,
      mlVersion: mlOutcome.version || null,
      mlEngine: 'model',
      mlSource: 'sidecar',
      mlLatencyMs: mlOutcome.latencyMs,
      mlContributions: mlOutcome.contributions || [],
    };
  }
  if (typeof fraudResult.mlProbability === 'number') {
    return {
      mlScore: fraudResult.mlProbability,
      mlVersion: fraudResult.mlVersion || null,
      mlEngine: 'model',
      mlSource: 'engine',
      mlLatencyMs: null,
      mlContributions: Array.isArray(fraudResult.mlContributions) ? fraudResult.mlContributions : [],
    };
  }
  return {
    mlScore: null,
    mlVersion: null,
    mlEngine: fraudResult.mlEngine || (mlFallbackReason ? 'disabled' : 'fallback'),
    mlSource: 'none',
    mlLatencyMs: mlOutcome ? mlOutcome.latencyMs : null,
    mlContributions: [],
  };
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
const createTransaction = async (body, options = {}) => {
  const input = buildTransactionInput(body, options);
  const identifiers = extractIdentifiers(input);

  // STEP 1 — initial blocklist check.
  const initialBlock = await isAnyIdentifierBlocked(identifiers);
  if (initialBlock) {
    const transaction = await rejectTransaction(input, initialBlock);
    return { outcome: 'blocked_initial', transaction };
  }

  // STEP 2 — fraud scoring (network round-trip; this is the race window).
  // `input.timestamp` is the caller-supplied or ingest-time instant, so the
  // engine's stateful windows (velocity / enumeration / geo / night-owl) see
  // the real transaction time rather than the replay time.
  const draft = { transactionId: uuidv4(), ...input };

  // STEP 2a — ML features (shadow layer). Built here, once, and shared with the
  // Java engine (and later the ml-service), so there is exactly one
  // implementation of the feature contract. Pure point-in-time: the query
  // inside buildFeatures only ever reads rows strictly earlier than this
  // transaction, with no fallback to "current" state.
  let mlFeatures = null;
  let mlFallbackReason = null;
  try {
    const { buildFeatures } = require('./featureService');
    const built = await buildFeatures(draft);
    mlFeatures = built.features;
  } catch (e) {
    // A missing feature vector must never block an authorisation. The engine
    // then reports mlEngine='skipped'; the rules are untouched.
    mlFallbackReason = e.message;
    console.warn('ML feature computation unavailable (rules unaffected):', e.message);
  }

  // STEP 2b — score with the rules engine AND the ML sidecar IN PARALLEL.
  //
  // Parallel, not sequential, on purpose: the model must not add latency to the
  // authorisation path, it only fills in a field. The sidecar gets a tight
  // 150ms budget (vs the engine's 3s) and is allowed to fail — see the honest
  // mlEngine/mlSource states below. Nothing the ML layer does can change
  // `fraudStatus`; the rules decide.
  const { scoreWithMlService } = require('../utils/mlServiceClient');
  const [engineOutcome, mlOutcome] = await Promise.all([
    callFraudEngine(draft, mlFeatures)
      .then((result) => ({ ok: true, result }))
      .catch((error) => ({ ok: false, error })),
    scoreWithMlService(mlFeatures, { timeoutMs: 150 }),
  ]);

  let fraudResult = { score: 0, status: 'clear', rulesTriggered: [], mlProbability: null };
  let scoringEngine = 'engine';
  if (engineOutcome.ok) {
    fraudResult = engineOutcome.result;
  } else {
    // Engine down/overloaded — record the fallback so the UI can flag that
    // transactions are being let through unscored, then default to clear.
    scoringEngine = 'fallback';
    console.warn('Fraud engine unavailable, defaulting to clear:', engineOutcome.error.message);
    recordScoringFallback(engineOutcome.error.code || engineOutcome.error.message || 'unknown error');
  }

  const ml = resolveMlShadow(fraudResult, mlOutcome, mlFallbackReason);

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
    scoringEngine,
    // Shadow ML opinion. `mlEngine` says whether a score exists; `mlSource`
    // says which implementation produced it. Both are recorded so a reader can
    // never mistake a fallback for a model score.
    mlScore: ml.mlScore,
    mlVersion: ml.mlVersion,
    mlEngine: ml.mlEngine,
    mlSource: ml.mlSource,
    mlLatencyMs: ml.mlLatencyMs,
    mlContributions: ml.mlContributions,
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
    // Auto-assign SLA deadline based on fraud score → priority mapping.
    const { ensureSLA } = require('./caseService');
    await ensureSLA(alert);
    eventBus.emit(EVENTS.NEW_FRAUD_ALERT, { alert, transaction });
    eventBus.emit(EVENTS.REVIEW_QUEUE_UPDATED, { added: [transaction._id] });
    setImmediate(() => detectCampaigns().catch((err) => console.error('Campaign detection error:', err.message)));
  }

  // Update merchant risk profile (fire-and-forget)
  setImmediate(() => {
    const { upsertFromTransaction } = require('./merchantService');
    upsertFromTransaction(transaction).catch(err => console.error('Merchant update error:', err.message));
  });

  eventBus.emit(EVENTS.NEW_TRANSACTION, transaction);
  return { outcome: 'created', transaction, alert };
};

module.exports = { createTransaction, buildTransactionInput };
