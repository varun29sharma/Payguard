/**
 * muleController.js — thin wrapper over muleDetectorService.
 */
const muleDetectorService = require('../services/muleDetectorService');
const { asyncHandler } = require('../middleware/errorHandler');

// GET /api/mules — laundering rings + aggregate stats.
const list = asyncHandler(async (req, res) => {
  const data = await muleDetectorService.listMuleRings(req.query.limit);
  res.json({ success: true, data });
});

// POST /api/mules/:ringId/block — freeze every account in the ring via the
// identity-graph cascade (one block traces the shared device/IP/… and locks
// the whole operation).
const block = asyncHandler(async (req, res) => {
  const blockedBy = req.user ? req.user.email : 'api';
  const result = await muleDetectorService.blockMuleRing(req.params.ringId, blockedBy);
  res.json({ success: true, data: result });
});

module.exports = { list, block };
