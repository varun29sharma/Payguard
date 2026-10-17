/**
 * ruleRoutes.js — management API for the fraud engine's runtime rule config.
 *
 *   GET /api/rules              list all rules with current config (DB + defaults)
 *   GET /api/rules/consistency  static analysis of the *current* config (Phase 3)
 *   PUT /api/rules/:ruleName    update { enabled?, score?, parameters? }
 *
 * Changes apply to the very next scoring request — the Node client ships the
 * config with each transaction (see utils/fraudEngineClient.js), so there is
 * no engine restart or redeploy involved.
 *
 * NOTE: currently gated by authentication only. In production, mutating rule
 * config should be admin-only — add an admin role check here.
 */
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');
const ruleConfigService = require('../services/ruleConfigService');

router.get('/', protect, asyncHandler(async (req, res) => {
  const rules = await ruleConfigService.getRuleConfigs();
  res.json({ success: true, data: rules });
}));

// Declared BEFORE '/:ruleName' so Express does not route "consistency" into the
// rule-name parameter.
router.get('/consistency', protect, asyncHandler(async (req, res) => {
  const analysis = await ruleConfigService.checkRuleConsistency();
  // 200 either way: "the checker is unavailable" is a valid, honest answer and
  // the UI has to be able to render it. `available` is the field that matters.
  res.json({ success: true, data: analysis });
}));

router.put('/:ruleName', protect, asyncHandler(async (req, res) => {
  const updated = await ruleConfigService.updateRuleConfig(req.params.ruleName, req.body || {});
  res.json({ success: true, data: updated });
}));

module.exports = router;
