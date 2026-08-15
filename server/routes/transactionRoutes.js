const express = require('express');
const router  = express.Router();
const {
  createTransaction,
  getTransactions,
  getTransactionsExport,
  getStats,
  getUserTimeline,
  getHeatmap,
  getRuleBreakdown,
} = require('../controllers/transactionController');
const { protect } = require('../middleware/authMiddleware');
const { protectOrApiKey } = require('../middleware/apiKeyAuth');

// Ingest accepts a valid analyst JWT (simulator / browser) OR an active
// API key via x-api-key (payment switches / integrations). No anonymous posts.
router.post('/',                    protectOrApiKey, createTransaction);
router.get('/',          protect,   getTransactions);
router.get('/export',    protect,   getTransactionsExport);
router.get('/stats',     protect,   getStats);
router.get('/heatmap',   protect,   getHeatmap);
router.get('/rule-breakdown', protect, getRuleBreakdown);
router.get('/timeline/:userId', protect, getUserTimeline);

module.exports = router;
