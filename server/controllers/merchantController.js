/**
 * merchantController.js — merchant risk profile endpoints.
 *
 *   GET  /api/merchants          list merchants with filters
 *   GET  /api/merchants/stats    aggregate risk statistics
 *   GET  /api/merchants/mcc      MCC distribution
 *   GET  /api/merchants/:id      single merchant with analytics
 *   PATCH /api/merchants/:id     update merchant notes / status
 */
const merchantService = require('../services/merchantService');
const Merchant = require('../models/Merchant');
const { asyncHandler } = require('../middleware/errorHandler');
const { NotFoundError, ValidationError } = require('../utils/errors');

// GET /api/merchants
const list = asyncHandler(async (req, res) => {
  const { riskTier, mcc, status, sortBy, sortOrder, page, limit } = req.query;
  const result = await merchantService.listMerchants({
    riskTier, mcc, status, sortBy, sortOrder,
    page: parseInt(page) || 1,
    limit: Math.min(parseInt(limit) || 50, 200),
  });
  res.json({ success: true, data: result.merchants, pagination: { page: result.page, limit: result.limit, total: result.total } });
});

// GET /api/merchants/stats
const stats = asyncHandler(async (req, res) => {
  const data = await merchantService.getRiskStats();
  res.json({ success: true, data });
});

// GET /api/merchants/mcc
const mccDistribution = asyncHandler(async (req, res) => {
  const data = await merchantService.getMCCDistribution();
  res.json({ success: true, data });
});

// GET /api/merchants/:id
const get = asyncHandler(async (req, res) => {
  const merchant = await merchantService.getMerchant(req.params.id);
  if (!merchant) throw new NotFoundError('Merchant not found');
  res.json({ success: true, data: merchant });
});

// PATCH /api/merchants/:id
const update = asyncHandler(async (req, res) => {
  const { name, mcc, status, notes } = req.body;
  const merchant = await Merchant.findOne({ merchantId: req.params.id });
  if (!merchant) throw new NotFoundError('Merchant not found');

  if (name !== undefined) merchant.name = name;
  if (mcc !== undefined) {
    merchant.mcc = mcc;
    merchant.mccCategory = merchantService.MCC_CODES[String(mcc).padStart(4, '0')] || null;
  }
  if (status !== undefined) {
    if (!['active', 'suspended', 'closed'].includes(status)) {
      throw new ValidationError('status must be active, suspended, or closed');
    }
    merchant.status = status;
  }
  if (notes) {
    merchant.notes.push({
      text: notes,
      author: req.user?.email || 'system',
      timestamp: new Date(),
    });
  }

  await merchant.save();
  res.json({ success: true, data: merchant });
});

module.exports = { list, stats, mccDistribution, get, update };
