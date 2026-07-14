const express = require('express');
const router = express.Router();
const BlockList = require('../models/BlockList');
const blocklistService = require('../services/blocklistService');
const { protect } = require('../middleware/authMiddleware');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError } = require('../utils/errors');
const { IDENTITY_FIELDS } = require('../services/identityGraphService');

// GET /api/blocklist
router.get('/', protect, asyncHandler(async (req, res) => {
  const entries = await BlockList.find({ isActive: true }).sort({ createdAt: -1 });
  res.json({ success: true, data: entries });
}));

// POST /api/blocklist — manually block any identifier type. `type` is
// whitelisted against IDENTITY_FIELDS and `value` is forced to a string
// before ever touching a Mongo query, so this can't be used for NoSQL
// injection (e.g. passing an object as `value` to smuggle in an operator).
router.post('/', protect, asyncHandler(async (req, res) => {
  const { type, value, reason, relatedAlertId, relatedCampaignId, expiresAt } = req.body;

  if (typeof type !== 'string' || !IDENTITY_FIELDS.includes(type)) {
    throw new ValidationError(`type must be one of: ${IDENTITY_FIELDS.join(', ')}`);
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new ValidationError('value is required and must be a string');
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new ValidationError('reason is required');
  }

  const result = await blocklistService.blockEntity({
    seedIdentifiers: { [type]: value },
    reason, blockedBy: req.user.email,
    relatedAlertId, relatedCampaignId, expiresAt,
  });
  res.status(201).json({ success: true, data: result });
}));

// DELETE /api/blocklist/:id — unblock
router.delete('/:id', protect, asyncHandler(async (req, res) => {
  const entry = await blocklistService.unblockEntity({ blockListId: req.params.id, unblockedBy: req.user.email });
  res.json({ success: true, data: entry });
}));

// GET /api/blocklist/check/:type/:value
router.get('/check/:type/:value', asyncHandler(async (req, res) => {
  const { type, value } = req.params;
  if (!IDENTITY_FIELDS.includes(type)) throw new ValidationError(`type must be one of: ${IDENTITY_FIELDS.join(', ')}`);
  const entry = await BlockList.findOne({ type, value: String(value), isActive: true });
  res.json({ blocked: !!entry, entry: entry || null });
}));

module.exports = router;
