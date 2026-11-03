const axios = require("axios");
const ruleConfigService = require('../services/ruleConfigService');
// this calls the Spring Boot fraud scoring service and returns a fraudResult.
// If the fraud engine is unavailable, the caller falls back to clear.
const FRAUD_ENGINE_URL = (
  process.env.FRAUD_ENGINE_URL || "http://localhost:8080"
).replace(/\/$/, "");

const callFraudEngine = async (transaction) => {
  // Ship the current rule configuration with every scoring request — the Java
  // engine reads it per request (enabled flags, severity overrides, custom
  // thresholds), so operator changes apply instantly with no restart.
  const rules = await ruleConfigService.getRuleConfigs();
  const payload = {
    transactionId: transaction.transactionId,
    userId: transaction.userId,
    merchantId: transaction.merchantId,
    amount: transaction.amount,
    timestamp: transaction.timestamp,
    deviceId: transaction.deviceId || "unknown",
    location: transaction.location || {},
    rules,
  };
  // 3 sec timeout for sending the request; failure means clear.
  const response = await axios.post(
    `${FRAUD_ENGINE_URL}/api/fraud/score`,
    payload,
    { timeout: 3000 },
  );
  return response.data; // { score:72,status:'blocked',rulesTriggered: [...] }
};

/**
 * Probes the fraud engine's /api/fraud/health endpoint. Resolves with a
 * snapshot of engine state (never throws):
 * { up, latencyMs, rules, checkedAt } — `up:false` when unreachable.
 * Used by services/engineHealthService.js to keep the UI informed about
 * whether transactions are being scored by the real engine or falling back.
 */
const checkFraudEngineHealth = async () => {
  const startedAt = Date.now();
  try {
    const response = await axios.get(`${FRAUD_ENGINE_URL}/api/fraud/health`, { timeout: 2000 });
    const body = response.data || {};
    return {
      up: true,
      latencyMs: Date.now() - startedAt,
      rules: Array.isArray(body.activeRules) ? body.activeRules : [],
      service: body.service || 'payguard-fraud-engine',
      checkedAt: new Date(),
    };
  } catch (err) {
    return {
      up: false,
      latencyMs: Date.now() - startedAt,
      rules: [],
      service: 'payguard-fraud-engine',
      checkedAt: new Date(),
    };
  }
};

module.exports = { callFraudEngine, checkFraudEngineHealth };
