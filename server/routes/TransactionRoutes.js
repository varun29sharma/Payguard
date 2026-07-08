const express = require('express');
const router  = express.Router();
const {
  createTransaction,
  getTransactions,
  getStats,
  getUserTimeline,
  getHeatmap,
  getRuleBreakdown,
} = require('../controllers/transactionController');
const { protect } = require('../middleware/authMiddleware');

router.post('/',                    createTransaction);
router.get('/',          protect,   getTransactions);
router.get('/stats',     protect,   getStats);
router.get('/heatmap',   protect,   getHeatmap);
router.get('/rule-breakdown', protect, getRuleBreakdown);
router.get('/timeline/:userId', protect, getUserTimeline);

module.exports = router;
