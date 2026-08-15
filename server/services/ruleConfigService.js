/**
 * ruleConfigService.js — owns the runtime configuration of the fraud engine's
 * rules. Config lives in MongoDB (managed here, in Node), and the scoring
 * client ships a snapshot with every request to the Java engine
 * (see utils/fraudEngineClient.js), so thresholds and enable/disable flags
 * change instantly without redeploying or restarting the engine.
 *
 * The values below mirror the Java engine's built-in defaults, so the API can
 * always present a complete, readable configuration even for rules that were
 * never customized.
 */
const RuleConfig = require('../models/RuleConfig');
const { ValidationError } = require('../utils/errors');

const DEFAULT_RULES = [
  {
    ruleName: 'VELOCITY_RULE',
    enabled: true,
    score: 60,
    parameters: { maxTransactions: 5, windowSeconds: 60 },
  },
  {
    ruleName: 'ENUMERATION_ATTACK_RULE',
    enabled: true,
    score: 75,
    parameters: { microAmountThreshold: 50, maxMicroTxns: 8, windowSeconds: 1800 },
  },
  {
    ruleName: 'AMOUNT_THRESHOLD_RULE',
    enabled: true,
    score: 65,
    parameters: { minAmount: 100000 },
  },
  {
    ruleName: 'GEOGRAPHIC_ANOMALY_RULE',
    enabled: true,
    score: 80,
    parameters: { windowMinutes: 120 },
  },
  {
    ruleName: 'NEW_DEVICE_RULE',
    enabled: true,
    score: 55,
    parameters: {},
  },
  {
    ruleName: 'NIGHT_OWL_RULE',
    enabled: true,
    score: 40,
    parameters: { startHour: 0, endHour: 5 },
  },
];

const KNOWN_RULE_NAMES = new Set(DEFAULT_RULES.map(r => r.ruleName));

// Short-TTL cache so the per-transaction scoring path doesn't query Mongo on
// every single request. Updates invalidate it immediately.
const CACHE_TTL_MS = 5 * 1000;
let cache = null;
let cacheAt = 0;

const invalidateCache = () => { cache = null; cacheAt = 0; };

/**
 * Returns the full rule configuration: DB rows overlaid on defaults, so the
 * response always contains every rule with complete parameters.
 */
const getRuleConfigs = async () => {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_TTL_MS) return cache;

  const dbRows = await RuleConfig.find().lean();
  const byName = new Map(dbRows.map(r => [r.ruleName, r]));

  const result = DEFAULT_RULES.map(def => {
    const row = byName.get(def.ruleName);
    if (!row) {
      return { ...def, parameters: { ...def.parameters }, isDefault: true, updatedAt: null };
    }
    return {
      ruleName: def.ruleName,
      enabled: row.enabled !== false,
      score: row.score ?? def.score,
      parameters: { ...def.parameters, ...(row.parameters || {}) },
      isDefault: false,
      updatedAt: row.updatedAt || null,
    };
  });

  cache = result;
  cacheAt = Date.now();
  return result;
};

/**
 * Idempotent boot-time seed: inserts a DB row per rule (only if missing) so
 * rules exist in Mongo and are easy to find/update from day one.
 */
const ensureDefaultRules = async () => {
  for (const def of DEFAULT_RULES) {
    await RuleConfig.updateOne(
      { ruleName: def.ruleName },
      { $setOnInsert: { ruleName: def.ruleName, enabled: def.enabled, score: def.score, parameters: def.parameters } },
      { upsert: true },
    );
  }
  invalidateCache();
};

/**
 * Applies a partial update ({ enabled?, score?, parameters? }) to one rule.
 * Rejects unknown rule names so typos can't silently create phantom configs.
 */
const updateRuleConfig = async (ruleName, patch) => {
  if (!KNOWN_RULE_NAMES.has(ruleName)) {
    throw new ValidationError(`Unknown rule '${ruleName}' — known: ${[...KNOWN_RULE_NAMES].join(', ')}`);
  }

  const update = {};
  if (patch.enabled !== undefined) update.enabled = patch.enabled === true || patch.enabled === 'true';
  if (patch.score !== undefined && patch.score !== null && patch.score !== '') {
    const n = Number(patch.score);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new ValidationError('score must be a number between 0 and 100');
    }
    update.score = n;
  }
  if (patch.parameters !== undefined && patch.parameters !== null) {
    update.parameters = patch.parameters;
  }

  await RuleConfig.updateOne({ ruleName }, { $set: update }, { upsert: true });
  invalidateCache();

  const fresh = await getRuleConfigs();
  return fresh.find(r => r.ruleName === ruleName);
};

module.exports = { getRuleConfigs, ensureDefaultRules, updateRuleConfig, DEFAULT_RULES };
