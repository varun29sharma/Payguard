/**
 * transactionController.js
 * Thin controller — all fraud/blocklist logic lives in services/transactionService.js.
 * Analytics endpoints (stats/timeline/heatmap/rule-breakdown) stay here since
 * they're simple read queries, not business logic.
 */

const Transaction = require('../models/Transaction');
const transactionService = require('../services/transactionService');
const { asyncHandler } = require('../middleware/errorHandler');

// POST /api/transactions
const createTransaction = asyncHandler(async (req, res) => {
  const result = await transactionService.createTransaction(req.body);

  if (result.outcome === 'blocked_final') {
    // Bug #2: the entity was blocked while this transaction was in flight —
    // it must never be reported as successful, even though it was recorded.
    return res.status(403).json({
      success: false, blocked: true,
      message: 'Transaction aborted — the associated entity was blocked while this transaction was being processed.',
      data: result.transaction,
    });
  }

  if (result.outcome === 'blocked_initial') {
    return res.status(200).json({ success: true, blocked: true, data: result.transaction });
  }

  res.status(201).json({ success: true, data: result.transaction, alert: result.alert || undefined });
});

// GET /api/transactions
const getTransactions = asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const status = req.query.status;
  const userId = req.query.userId;

  const filter = {};
  if (status) filter.fraudStatus = status;
  if (userId) filter.userId = userId;

  const [transactions, total] = await Promise.all([
    Transaction.find(filter)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    Transaction.countDocuments(filter)
  ]);

  res.json({
    success: true,
    data: transactions,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) }
  });
});

// GET /api/transactions/stats
const getStats = asyncHandler(async (req, res) => {
  const [total, flagged, blocked, rejected, scoreAgg] = await Promise.all([
    Transaction.countDocuments(),
    Transaction.countDocuments({ fraudStatus: 'review' }),
    Transaction.countDocuments({ fraudStatus: 'blocked' }),
    Transaction.countDocuments({ fraudStatus: 'rejected' }),
    Transaction.aggregate([
      { $group: { _id: null, avg: { $avg: '$fraudScore' }, max: { $max: '$fraudScore' } } }
    ])
  ]);

  res.json({
    total,
    flagged,
    blocked,
    rejected,
    clear: total - flagged - blocked - rejected,
    avgFraudScore: Math.round(scoreAgg[0]?.avg || 0),
    maxFraudScore: scoreAgg[0]?.max || 0
  });
});

// GET /api/transactions/timeline/:userId
const getUserTimeline = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const hours = parseInt(req.query.hours) || 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const transactions = await Transaction.find({
    userId,
    timestamp: { $gte: since }
  }).sort({ timestamp: 1 });

  const hourlyRisk = transactions.reduce((acc, t) => {
    const hour = new Date(t.timestamp).getHours();
    if (!acc[hour]) acc[hour] = { hour, count: 0, maxScore: 0, flagged: 0 };
    acc[hour].count++;
    acc[hour].maxScore = Math.max(acc[hour].maxScore, t.fraudScore);
    if (t.fraudStatus !== 'clear') acc[hour].flagged++;
    return acc;
  }, {});

  res.json({
    success: true,
    data: transactions,
    hourlyRisk: Object.values(hourlyRisk),
    summary: {
      total: transactions.length,
      flagged: transactions.filter(t => t.fraudStatus !== 'clear').length,
      totalAmount: transactions.reduce((s, t) => s + t.amount, 0),
      avgScore: transactions.length ?
        Math.round(transactions.reduce((s, t) => s + t.fraudScore, 0) / transactions.length) : 0
    }
  });
});

// GET /api/transactions/heatmap
const getHeatmap = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const flagged = await Transaction.find({
    fraudStatus: { $ne: 'clear' },
    'location.city': { $exists: true },
    timestamp: { $gte: since }
  }).select('location fraudScore fraudStatus amount timestamp');

  const cityData = flagged.reduce((acc, t) => {
    const city = t.location?.city;
    if (!city) return acc;
    if (!acc[city]) {
      acc[city] = {
        city,
        lat: t.location.lat,
        lng: t.location.lng,
        count: 0,
        blocked: 0,
        review: 0,
        totalAmount: 0,
        avgScore: 0,
        scores: []
      };
    }
    acc[city].count++;
    if (t.fraudStatus === 'blocked') acc[city].blocked++;
    if (t.fraudStatus === 'review') acc[city].review++;
    acc[city].totalAmount += t.amount;
    acc[city].scores.push(t.fraudScore);
    return acc;
  }, {});

  const result = Object.values(cityData).map(c => ({
    ...c,
    avgScore: Math.round(c.scores.reduce((s, n) => s + n, 0) / c.scores.length),
    scores: undefined
  }));

  res.json({ success: true, data: result });
});

// GET /api/transactions/rule-breakdown
const getRuleBreakdown = asyncHandler(async (req, res) => {
  const result = await Transaction.aggregate([
    { $unwind: '$rulesTriggered' },
    { $group: {
      _id: '$rulesTriggered.ruleName',
      count: { $sum: 1 },
      avgScore: { $avg: '$rulesTriggered.score' }
    }},
    { $sort: { count: -1 } }
  ]);
  res.json({ success: true, data: result });
});

module.exports = {
  createTransaction, getTransactions, getStats,
  getUserTimeline, getHeatmap, getRuleBreakdown
};
