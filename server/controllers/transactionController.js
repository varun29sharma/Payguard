/**
 * UPDATED transactionController.js
 * - Check BlockList before processing any transaction
 * - Trigger campaign detection after creating a fraud alert
 * - Add richer analytics endpoints
 */

const Transaction = require('../models/Transaction');
const FraudAlert = require('../models/FraudAlert');
const BlockList = require('../models/BlockList');
const { callFraudEngine } = require('../utils/fraudEngineClient');
const { detectCampaigns } = require('../services/campaignDetector');
const { v4: uuidv4 } = require('uuid');

// POST /api/transactions
const createTransaction = async (req, res) => {
  try {
    const { userId, merchantId, amount, currency, location, deviceId } = req.body;

    // ── BLOCK CHECK ──────────────────────────────────────────────────────────
    const [userBlocked, deviceBlocked] = await Promise.all([
      BlockList.findOne({ type: 'userId', value: userId, isActive: true }),
      deviceId ? BlockList.findOne({ type: 'deviceId', value: deviceId, isActive: true }) : null
    ]);

    if (userBlocked || deviceBlocked) {
      const blockEntry = userBlocked || deviceBlocked;
      const blocked = await Transaction.create({
        transactionId: uuidv4(),
        userId, merchantId, amount,
        currency: currency || 'INR',
        location, deviceId,
        fraudScore: 100,
        fraudStatus: 'blocked',
        rulesTriggered: [{
          ruleName: 'BLOCK_LIST',
          score: 100,
          reason: `Manually blocked: ${blockEntry.reason}`
        }]
      });

      const io = req.app.get('io');
      io.emit('new-transaction', blocked);
      io.emit('blocked-transaction', {
        transaction: blocked,
        blockReason: blockEntry.reason,
        blockedBy: blockEntry.blockedBy
      });

      return res.status(200).json({ success: true, data: blocked, blocked: true });
    }

    // ── NORMAL FLOW ──────────────────────────────────────────────────────────
    const transaction = new Transaction({
      transactionId: uuidv4(),
      userId, merchantId, amount,
      currency: currency || 'INR',
      location, deviceId,
      timestamp: new Date()
    });

    let fraudResult = { score: 0, status: 'clear', rulesTriggered: [] };
    try {
      fraudResult = await callFraudEngine(transaction);
    } catch (e) {
      console.warn('Fraud engine unavailable, defaulting to clear');
    }

    transaction.fraudScore = fraudResult.score;
    transaction.fraudStatus = fraudResult.status;
    transaction.rulesTriggered = fraudResult.rulesTriggered;

    const saved = await transaction.save();

    // Create alert for non-clear transactions
    let alert = null;
    if (fraudResult.status !== 'clear') {
      alert = await FraudAlert.create({
        transaction: saved._id,
        userId: saved.userId,
        merchantId: saved.merchantId,
        deviceId: saved.deviceId,
        amount: saved.amount,
        location: saved.location,
        fraudScore: fraudResult.score,
        rulesTriggered: fraudResult.rulesTriggered
      });

      const io = req.app.get('io');
      setImmediate(() => detectCampaigns(io));
      io.emit('new-fraud-alert', { alert, transaction: saved });
    }

    const io = req.app.get('io');
    io.emit('new-transaction', saved);

    res.status(201).json({ success: true, data: saved });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/transactions
const getTransactions = async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/transactions/stats
const getStats = async (req, res) => {
  try {
    const [total, flagged, blocked, scoreAgg] = await Promise.all([
      Transaction.countDocuments(),
      Transaction.countDocuments({ fraudStatus: 'review' }),
      Transaction.countDocuments({ fraudStatus: 'blocked' }),
      Transaction.aggregate([
        { $group: { _id: null, avg: { $avg: '$fraudScore' }, max: { $max: '$fraudScore' } } }
      ])
    ]);

    res.json({
      total,
      flagged,
      blocked,
      clear: total - flagged - blocked,
      avgFraudScore: Math.round(scoreAgg[0]?.avg || 0),
      maxFraudScore: scoreAgg[0]?.max || 0
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/transactions/timeline/:userId
const getUserTimeline = async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/transactions/heatmap
const getHeatmap = async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/transactions/rule-breakdown
const getRuleBreakdown = async (req, res) => {
  try {
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
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  createTransaction, getTransactions, getStats,
  getUserTimeline, getHeatmap, getRuleBreakdown
};
