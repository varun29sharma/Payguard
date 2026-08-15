const mongoose = require("mongoose");

/**
 * Runtime configuration for one fraud-engine rule. The Node server owns this
 * table and ships a snapshot with every scoring request (see
 * fraudEngineClient.js), so operators can tune the Java engine without
 * redeploying it.
 *
 *   enabled:    false disables the rule for all scoring,
 *   score:      severity override (null = rule's built-in default),
 *   parameters: rule-specific thresholds, e.g. AMOUNT_THRESHOLD_RULE
 *               -> { minAmount: 250000 }.
 */
const ruleConfigSchema = new mongoose.Schema(
  {
    ruleName: { type: String, required: true, unique: true, index: true },
    enabled:  { type: Boolean, default: true },
    score:    { type: Number, default: null },
    parameters: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

module.exports = mongoose.model("RuleConfig", ruleConfigSchema);
