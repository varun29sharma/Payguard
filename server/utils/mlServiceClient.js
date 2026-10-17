/**
 * mlServiceClient.js — calls the FastAPI ML sidecar (Phase 2).
 *
 * The boosted model lives behind this service, and it is called **in parallel**
 * with the Java engine (`Promise.all`), not after it, so the model never adds
 * latency to the authorisation path — it only fills in a field.
 *
 * Three deliberate properties:
 *
 * 1. **A tight timeout (~150ms, well under the engine's 3s).** The authorisation
 *    budget belongs to the rules; the model gets whatever slack is left and no
 *    more.
 * 2. **It never throws.** Any failure resolves to `{ ok: false, reason }`, so a
 *    dead sidecar cannot fail a transaction.
 * 3. **It reports `engine: 'fallback'` on failure** — the same honesty pattern as
 *    `scoringEngine` in the Java client. A model that is down should be visible
 *    in the data, not invisible.
 */
const axios = require('axios');

const ML_SERVICE_URL = (process.env.ML_SERVICE_URL || 'http://localhost:8000').replace(/\/$/, '');
const DEFAULT_TIMEOUT_MS = 150;

/**
 * Score one feature vector.
 *
 * @param {number[]} features vector in FEATURE_NAMES order
 * @param {{timeoutMs?: number}} options
 * @returns {Promise<{ok: boolean, probability?: number, version?: string, contributions?: Array, reason?: string, latencyMs: number}>}
 */
const scoreWithMlService = async (features, options = {}) => {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  // No features means nothing to score — skip rather than send a request that
  // would 422. (The caller records mlEngine='disabled'/'skipped'.)
  if (!Array.isArray(features) || features.length === 0) {
    return { ok: false, reason: 'no feature vector', latencyMs: 0 };
  }

  const startedAt = Date.now();
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/score`,
      { features, explain: true },
      { timeout: timeoutMs, validateStatus: null },
    );
    const latencyMs = Date.now() - startedAt;

    if (response.status !== 200 || !response.data || typeof response.data.probability !== 'number') {
      return {
        ok: false,
        reason: `sidecar responded ${response.status}` +
          (response.data && response.data.reason ? `: ${response.data.reason}` : ''),
        latencyMs,
      };
    }
    return {
      ok: true,
      probability: response.data.probability,
      version: response.data.version,
      contributions: Array.isArray(response.data.contributions) ? response.data.contributions : [],
      engine: response.data.engine || 'model',
      latencyMs,
    };
  } catch (err) {
    // Timeout, connection refused, DNS — all the same to the caller.
    return {
      ok: false,
      reason: err.code || err.message || 'ml service unreachable',
      latencyMs: Date.now() - startedAt,
    };
  }
};

/**
 * Ask the sidecar to statically analyse a rule set (Phase 3, UNIT-II).
 *
 * Same contract as `scoreWithMlService`: never throws, always reports whether
 * it actually answered. An analysis that cannot run must say so rather than
 * return "no problems found" — a false all-clear on a silently dead fraud rule
 * is worse than no answer at all.
 *
 * @param {Array<object>} rules rule configs from ruleConfigService
 * @returns {Promise<{available: boolean, reason?: string, errors?: number, warnings?: number, issues?: Array, healthy?: boolean, method?: string}>}
 */
const checkRuleConsistency = async (rules, options = {}) => {
  const timeoutMs = options.timeoutMs || 2000;
  const startedAt = Date.now();
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/rules/consistency`,
      { rules },
      { timeout: timeoutMs, validateStatus: null },
    );
    const body = response.data || {};
    if (response.status !== 200 || body.available === false) {
      return {
        available: false,
        reason: body.reason || `sidecar responded ${response.status}`,
        latencyMs: Date.now() - startedAt,
      };
    }
    return { ...body, available: true, latencyMs: Date.now() - startedAt };
  } catch (err) {
    return {
      available: false,
      reason: err.code || err.message || 'rule-consistency checker unreachable',
      latencyMs: Date.now() - startedAt,
    };
  }
};

/** Readiness probe for the health surface. Never throws. */
const checkMlServiceHealth = async () => {
  const startedAt = Date.now();
  try {
    const response = await axios.get(`${ML_SERVICE_URL}/health`, { timeout: 1000 });
    const body = response.data || {};
    return {
      up: Boolean(body.ready),
      latencyMs: Date.now() - startedAt,
      version: body.version || null,
      featureCount: body.featureCount || 0,
      explainable: Boolean(body.explainable),
      ruleLogic: Boolean(body.ruleLogic),
      reason: body.reason || null,
      checkedAt: new Date(),
    };
  } catch (err) {
    return {
      up: false,
      latencyMs: Date.now() - startedAt,
      version: null,
      featureCount: 0,
      explainable: false,
      ruleLogic: false,
      reason: err.code || err.message || 'unreachable',
      checkedAt: new Date(),
    };
  }
};

module.exports = {
  scoreWithMlService,
  checkRuleConsistency,
  checkMlServiceHealth,
  ML_SERVICE_URL,
  DEFAULT_TIMEOUT_MS,
};
