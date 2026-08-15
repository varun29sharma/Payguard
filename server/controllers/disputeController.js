/**
 * disputeController.js — thin wrapper over disputeService; all logic lives
 * in the service so the ingest + detection-rate behaviour is unit-testable.
 */
const disputeService = require('../services/disputeService');
const { asyncHandler } = require('../middleware/errorHandler');

// POST /api/disputes — ingest a dispute/chargeback for an existing transaction.
const ingest = asyncHandler(async (req, res) => {
  const filedBy = req.user ? req.user.email : (req.apiKey ? `api-key:${req.apiKey.name}` : 'api');
  const result = await disputeService.ingestDispute({ ...req.body, filedBy });
  res.status(201).json({ success: true, data: result });
});

// GET /api/disputes — recent disputes.
const list = asyncHandler(async (req, res) => {
  const disputes = await disputeService.listDisputes(req.query.limit);
  res.json({ success: true, data: disputes });
});

// GET /api/disputes/detection — per-rule detection rates over confirmed fraud.
const detection = asyncHandler(async (req, res) => {
  const rates = await disputeService.getDetectionRates();
  res.json({ success: true, data: rates });
});

module.exports = { ingest, list, detection };
