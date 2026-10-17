/**
 * featureService.js — the ONLINE half of the feature contract.
 *
 * Architectural decision worth stating plainly: features are computed **once**,
 * here in Node, as of the transaction's own timestamp, and the resulting vector
 * is handed to *both* the Java engine (which runs the linear model) and the
 * ml-service sidecar. The alternative — computing them again inside the Java
 * engine — is exactly how training/serving skew happens: two implementations of
 * forty fiddly definitions, drifting apart silently until the model is scored
 * on features it was never trained on.
 *
 * The offline (training) half lives in `ml/payguard_ml/features.py`. Parity is
 * enforced by a golden fixture (`ml/artifacts/golden_features.json`) that both
 * sides must reproduce — see `server/test/featureParity.test.js`.
 *
 * The point-in-time rule is the whole ballgame: a feature for transaction *t*
 * may use **only rows strictly before t**. `computeFeatures` is a pure function
 * of already-filtered history, so that rule is enforced by the caller
 * (`buildFeatures`) and *provable* by the parity test.
 */

'use strict';

/** Feature order is an ABI: `model-v1.json` stores weights positionally. */
const FEATURE_NAMES = [
  'log_amount',
  'amt_zscore_user',
  'amt_ratio_user_mean',
  'user_txn_count_1h',
  'user_txn_count_24h',
  'user_txn_count_7d',
  'user_distinct_merchants_24h',
  'user_distinct_cities_24h',
  'user_distinct_devices_7d',
  'log_seconds_since_prev',
  'hour_sin',
  'hour_cos',
  'is_night',
  'is_weekend',
  'geo_distance_km_prev',
  'log1p_implied_speed_kmh',
  'distance_from_centroid_km',
  'merchant_amt_percentile',
  'merchant_dispute_rate_asof',
  'rule_velocity',
  'rule_enumeration',
  'rule_amount_threshold',
  'rule_geographic_anomaly',
  'rule_new_device',
  'rule_night_owl',
];

const RULE_FEATURE_TO_ENGINE_NAME = {
  rule_velocity: 'VELOCITY_RULE',
  rule_enumeration: 'ENUMERATION_ATTACK_RULE',
  rule_amount_threshold: 'AMOUNT_THRESHOLD_RULE',
  rule_geographic_anomaly: 'GEOGRAPHIC_ANOMALY_RULE',
  rule_new_device: 'NEW_DEVICE_RULE',
  rule_night_owl: 'NIGHT_OWL_RULE',
};

const WINDOW_1H = 3600;
const WINDOW_24H = 86400;
const WINDOW_7D = 7 * 86400;
const WINDOW_30D = 30 * 86400;
const MAX_GAP_SECONDS = 30 * 86400;
const MAX_SPEED_KMH = 1200;
const EARTH_RADIUS_KM = 6371.0088;

/** Milliseconds epoch for a Date|string|number, or NaN. */
const toMillis = (value) => {
  if (value === null || value === undefined) return NaN;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
};

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const optionalNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Great-circle distance in km. The signal `GeographicAnomalyRule` ignores
 * today even though the schema stores the coordinates it needs.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some((v) => v === null || v === undefined)) return 0;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = p2 - p1;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Lower bound index of `needle` in a sorted ascending array. */
function lowerBound(arr, needle) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < needle) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Upper bound index of `needle` in a sorted ascending array. */
function upperBound(arr, needle) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= needle) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const distinctCount = (rows, keyFn, sinceMillis) => {
  const seen = new Set();
  for (const row of rows) {
    if (toMillis(row.timestamp) < sinceMillis) continue;
    const key = keyFn(row);
    seen.add(key === null || key === undefined ? null : String(key));
  }
  return seen.size;
};

/**
 * Pure feature computation.
 *
 * @param {object} input
 * @param {object} input.transaction   the row being scored
 * @param {Array}  input.userHistory   same user's prior rows within 30d (ts < t)
 * @param {object|null} input.userPrevious the user's most recent prior row, however old
 * @param {Array}  input.merchantHistory the merchant's prior rows (all time)
 * @returns {Array<number>} vector in FEATURE_NAMES order
 */
function computeFeatures({ transaction, userHistory = [], userPrevious = null, merchantHistory = [] }) {
  const nowMs = toMillis(transaction.timestamp);
  const amount = toNumber(transaction.amount, 0);
  const la = Math.log1p(Math.max(amount, 0));

  // ---- prior rows, all strictly before `nowMs` -------------------------
  const priors = userHistory.filter((r) => toMillis(r.timestamp) < nowMs).slice();
  priors.sort((a, b) => toMillis(a.timestamp) - toMillis(b.timestamp));

  const prev = (() => {
    let best = null;
    let bestMs = -Infinity;
    for (const row of priors) {
      const ms = toMillis(row.timestamp);
      if (ms > bestMs) { best = row; bestMs = ms; }
    }
    if (userPrevious) {
      const ms = toMillis(userPrevious.timestamp);
      if (Number.isFinite(ms) && ms < nowMs && ms > bestMs) { best = userPrevious; }
    }
    return best;
  })();

  const lag = prev ? Math.max(0, (nowMs - toMillis(prev.timestamp)) / 1000) : 0;
  const gapForLog = Math.min(lag, MAX_GAP_SECONDS);

  // ---- geo -------------------------------------------------------------
  const lat = optionalNumber(transaction.location?.lat);
  const lng = optionalNumber(transaction.location?.lng);
  const prevLat = prev ? optionalNumber(prev.location?.lat) : null;
  const prevLng = prev ? optionalNumber(prev.location?.lng) : null;

  let distancePrev = 0;
  let impliedSpeed = 0;
  if (prev && lat !== null && lng !== null && prevLat !== null && prevLng !== null) {
    distancePrev = haversineKm(prevLat, prevLng, lat, lng);
    const hours = Math.max(lag, 1) / 3600;
    impliedSpeed = Math.min(distancePrev / hours, MAX_SPEED_KMH);
  }

  const centroidSince = nowMs - WINDOW_30D * 1000;
  let cLatSum = 0;
  let cLngSum = 0;
  let cN = 0;
  for (const row of priors) {
    if (toMillis(row.timestamp) < centroidSince) continue;
    const rLat = optionalNumber(row.location?.lat);
    const rLng = optionalNumber(row.location?.lng);
    if (rLat === null || rLng === null) continue;
    cLatSum += rLat; cLngSum += rLng; cN += 1;
  }
  const distanceCentroid = (cN > 0 && lat !== null && lng !== null)
    ? haversineKm(cLatSum / cN, cLngSum / cN, lat, lng)
    : 0;

  // ---- amount behaviour ------------------------------------------------
  const amtSince = nowMs - WINDOW_30D * 1000;
  let aN = 0; let aSum = 0; let aSumSq = 0;
  for (const row of priors) {
    if (toMillis(row.timestamp) < amtSince) continue;
    const v = Math.log1p(Math.max(toNumber(row.amount, 0), 0));
    aN += 1; aSum += v; aSumSq += v * v;
  }
  let zscore = 0;
  let meanLog = aN > 0 ? aSum / aN : 0;
  if (aN >= 2) {
    const variance = Math.max(aSumSq / aN - meanLog * meanLog, 0);
    const std = Math.sqrt(variance);
    zscore = std > 1e-9 ? (la - meanLog) / std : 0;
  }
  let ratio = meanLog > 1e-9 ? amount / Math.expm1(meanLog) : 1;
  ratio = Math.max(Math.min(ratio, 50), 0);

  // ---- velocity / distinct counts --------------------------------------
  const userPrior = priors;
  const countWithin = (window) => userPrior.filter((r) => toMillis(r.timestamp) >= nowMs - window * 1000).length;

  // ---- merchant --------------------------------------------------------
  const merchantPriors = merchantHistory.filter((r) => toMillis(r.timestamp) < nowMs);
  let merchantPct = 0.5;
  let disputeRate = 0;
  if (merchantPriors.length) {
    const amounts = merchantPriors.map((r) => toNumber(r.amount, 0)).sort((a, b) => a - b);
    merchantPct = upperBound(amounts, amount) / amounts.length;
    const frauds = merchantPriors.filter((r) => r.isConfirmedFraud === true).length;
    disputeRate = frauds / merchantPriors.length;
  }

  const when = new Date(nowMs);
  const hour = when.getUTCHours();
  const weekday = when.getUTCDay(); // 0 = Sunday
  const isWeekend = (weekday === 0 || weekday === 6) ? 1 : 0;

  const fired = new Set(
    (transaction.rulesTriggered || [])
      .map((r) => (typeof r === 'string' ? r : r && r.ruleName))
      .filter(Boolean),
  );

  const values = {
    log_amount: la,
    amt_zscore_user: zscore,
    amt_ratio_user_mean: ratio,
    user_txn_count_1h: countWithin(WINDOW_1H),
    user_txn_count_24h: countWithin(WINDOW_24H),
    user_txn_count_7d: countWithin(WINDOW_7D),
    user_distinct_merchants_24h: distinctCount(userPrior, (r) => r.merchantId, nowMs - WINDOW_24H * 1000),
    user_distinct_cities_24h: distinctCount(userPrior, (r) => (r.location || {}).city, nowMs - WINDOW_24H * 1000),
    user_distinct_devices_7d: distinctCount(userPrior, (r) => r.deviceId, nowMs - WINDOW_7D * 1000),
    log_seconds_since_prev: Math.log1p(gapForLog),
    hour_sin: Math.sin((2 * Math.PI * hour) / 24),
    hour_cos: Math.cos((2 * Math.PI * hour) / 24),
    is_night: (hour >= 0 && hour <= 5) ? 1 : 0,
    is_weekend: isWeekend,
    geo_distance_km_prev: distancePrev,
    log1p_implied_speed_kmh: Math.log1p(impliedSpeed),
    distance_from_centroid_km: distanceCentroid,
    merchant_amt_percentile: merchantPct,
    merchant_dispute_rate_asof: disputeRate,
  };
  for (const [feature, engineName] of Object.entries(RULE_FEATURE_TO_ENGINE_NAME)) {
    values[feature] = fired.has(engineName) ? 1 : 0;
  }
  return FEATURE_NAMES.map((name) => values[name]);
}

/** Feature name -> value, for debugging and the Models screen. */
function computeFeatureMap(input) {
  const vector = computeFeatures(input);
  const map = {};
  FEATURE_NAMES.forEach((name, i) => { map[name] = vector[i]; });
  return map;
}

// --------------------------------------------------------------------------
// Mongo-backed assembly
// --------------------------------------------------------------------------

/**
 * Assembles the history the pure function needs, from Mongo, strictly as-of the
 * transaction's timestamp. Every query carries `timestamp: { $lt: t }` — the
 * point-in-time guarantee is enforced at the data-access layer, not trusted to
 * the caller.
 *
 * Cold start: a brand-new user has no history at all, so every behavioural
 * feature is zero and the model leans on the transaction's own properties and
 * the rule flags. That degraded state is *recorded* rather than hidden
 * (`hasHistory`), because "I scored this with no prior data" is exactly the
 * kind of thing the platform is supposed to say out loud.
 */
async function buildFeatures(transaction, deps = {}) {
  const Transaction = deps.Transaction || require('../models/Transaction');
  const at = new Date(transaction.timestamp);
  const user = String(transaction.userId);
  const merchant = String(transaction.merchantId);
  const since30d = new Date(at.getTime() - WINDOW_30D * 1000);

  const HISTORY_FIELDS = 'userId merchantId amount timestamp location deviceId isConfirmedFraud rulesTriggered';

  const [userHistory, userPrevious, merchantHistory] = await Promise.all([
    Transaction.find({ userId: user, timestamp: { $gte: since30d, $lt: at } })
      .select(HISTORY_FIELDS).sort({ timestamp: 1 }).lean(),
    Transaction.findOne({ userId: user, timestamp: { $lt: at } })
      .select(HISTORY_FIELDS).sort({ timestamp: -1 }).lean(),
    Transaction.find({ merchantId: merchant, timestamp: { $lt: at } })
      .select(HISTORY_FIELDS).limit(5000).lean(),
  ]);

  const vector = computeFeatures({
    transaction,
    userHistory,
    userPrevious,
    merchantHistory,
  });

  return {
    features: vector,
    featureNames: FEATURE_NAMES,
    hasHistory: userHistory.length > 0,
    historySize: userHistory.length,
  };
}

/**
 * Convenience: build the feature vector from in-memory rows (used by the parity
 * test and by any caller that already holds the history).
 */
function buildFeaturesFromRows(transaction, { userHistory = [], userPrevious = null, merchantHistory = [] }) {
  return computeFeatures({ transaction, userHistory, userPrevious, merchantHistory });
}

module.exports = {
  FEATURE_NAMES,
  RULE_FEATURE_TO_ENGINE_NAME,
  computeFeatures,
  computeFeatureMap,
  buildFeatures,
  buildFeaturesFromRows,
  haversineKm,
};
