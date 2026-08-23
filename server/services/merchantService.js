/**
 * merchantService.js — merchant risk profiling and analytics.
 *
 * Every transaction creates/updates a merchant profile. Disputes update the
 * dispute rate. Risk tiers are recalculated on each update using a composite
 * score from dispute rate, fraud rate, average fraud score, and volume anomalies.
 */
const Merchant = require('../models/Merchant');
const Transaction = require('../models/Transaction');
const Dispute = require('../models/Dispute');
const { MCC_CODES } = require('../models/Merchant');
const { eventBus, EVENTS } = require('../events/eventBus');
const { ValidationError } = require('../utils/errors');

// ── Risk tier thresholds ─────────────────────────────────────
const TIER_THRESHOLDS = {
  low:      { maxRiskScore: 30 },
  medium:   { maxRiskScore: 60 },
  high:     { maxRiskScore: 80 },
  critical: { maxRiskScore: 100 },
};

const TIER_ORDER = ['low', 'medium', 'high', 'critical'];

/**
 * Compute a composite risk score (0–100) from a merchant's metrics.
 * Weighted: dispute rate (30%), fraud rate (25%), avg fraud score (25%),
 * volume spike (10%), high-value concentration (10%).
 */
const computeRiskScore = (merchant) => {
  let score = 0;

  // Dispute rate contribution (0–30)
  // 0% disputes = 0, ≥5% disputes = 30
  score += Math.min(30, (merchant.disputeRate || 0) * 600);

  // Fraud rate contribution (0–25)
  const fraudRate = merchant.totalTransactions > 0
    ? (merchant.flaggedTransactions || 0) / merchant.totalTransactions
    : 0;
  score += Math.min(25, fraudRate * 50);

  // Average fraud score contribution (0–25)
  // avgScore 0 = 0, avgScore 80 = 25
  score += Math.min(25, (merchant.avgFraudScore || 0) * 0.3125);

  // Velocity anomaly (0–10)
  if (merchant.velocityAnomaly) score += 10;
  if (merchant.suddenSpike) score += 10;

  return Math.min(100, Math.round(score));
};

/**
 * Map risk score to tier.
 */
const scoreToTier = (score) => {
  if (score >= TIER_THRESHOLDS.critical.maxRiskScore - 20) return 'critical';
  if (score >= TIER_THRESHOLDS.high.maxRiskScore - 20) return 'high';
  if (score >= TIER_THRESHOLDS.medium.maxRiskScore - 20) return 'medium';
  return 'low';
};

/**
 * Look up MCC category from code.
 */
const lookupMCC = (code) => {
  if (!code) return null;
  return MCC_CODES[String(code).padStart(4, '0')] || null;
};

/**
 * Derive MCC from merchant ID (common patterns in demo data).
 */
const inferMCCFromMerchantId = (merchantId) => {
  const id = String(merchantId).toLowerCase();
  if (id.includes('grocery') || id.includes('super')) return '5411';
  if (id.includes('gas') || id.includes('fuel')) return '5541';
  if (id.includes('restaurant') || id.includes('food') || id.includes('dine')) return '5812';
  if (id.includes('fast') || id.includes('cafe')) return '5814';
  if (id.includes('pharm') || id.includes('drug')) return '5912';
  if (id.includes('jewel')) return '5944';
  if (id.includes('electronics') || id.includes('tech')) return '5732';
  if (id.includes('clothing') || id.includes('fashion') || id.includes('apparel')) return '5651';
  if (id.includes('hotel') || id.includes('motel') || id.includes('travel')) return '7011';
  if (id.includes('salon') || id.includes('beauty')) return '7230';
  if (id.includes('cash') || id.includes('atm')) return '6011';
  if (id.includes('gambl') || id.includes('casino')) return '7995';
  return null;
};

/**
 * Create or update a merchant profile from a transaction.
 * Called during transaction ingest (fire-and-forget).
 */
const upsertFromTransaction = async (transaction) => {
  try {
    const { merchantId, amount, fraudScore, fraudStatus, timestamp } = transaction;
    if (!merchantId) return;

    const existing = await Merchant.findOne({ merchantId });
    const isNew = !existing;

    const mccCode = existing?.mcc || inferMCCFromMerchantId(merchantId) || null;

    if (isNew) {
      const merchant = await Merchant.create({
        merchantId,
        mcc: mccCode,
        mccCategory: lookupMCC(mccCode),
        totalTransactions: 1,
        totalAmount: amount,
        uniqueCustomers: 1,
        flaggedTransactions: fraudStatus !== 'clear' ? 1 : 0,
        blockedTransactions: fraudStatus === 'blocked' ? 1 : 0,
        avgFraudScore: fraudScore,
        maxFraudScore: fraudScore,
        lastTransactionAt: timestamp || new Date(),
      });
      eventBus.emit(EVENTS.MERCHANT_CREATED, { merchant });
      return merchant;
    }

    // Update running aggregates
    const update = {
      $inc: {
        totalTransactions: 1,
        totalAmount: amount,
        flaggedTransactions: fraudStatus !== 'clear' ? 1 : 0,
        blockedTransactions: fraudStatus === 'blocked' ? 1 : 0,
      },
      $set: {
        lastTransactionAt: timestamp || new Date(),
        mcc: mccCode || existing.mcc,
        mccCategory: lookupMCC(mccCode || existing.mcc),
      },
    };

    // Recalculate avg fraud score incrementally
    const n = existing.totalTransactions || 0;
    const newAvg = ((existing.avgFraudScore || 0) * n + fraudScore) / (n + 1);
    update.$set.avgFraudScore = Math.round(newAvg * 100) / 100;
    if (fraudScore > (existing.maxFraudScore || 0)) {
      update.$set.maxFraudScore = fraudScore;
    }

    const merchant = await Merchant.findOneAndUpdate(
      { merchantId },
      update,
      { new: true, runValidators: true }
    );

    // Recompute risk score + tier
    const riskScore = computeRiskScore(merchant);
    if (riskScore !== merchant.riskScore || scoreToTier(riskScore) !== merchant.riskTier) {
      const oldTier = merchant.riskTier;
      merchant.riskScore = riskScore;
      merchant.riskTier = scoreToTier(riskScore);
      await merchant.save();
      if (oldTier !== merchant.riskTier) {
        eventBus.emit(EVENTS.MERCHANT_TIER_CHANGED, {
          merchantId,
          oldTier,
          newTier: merchant.riskTier,
          riskScore,
        });
      }
    }

    return merchant;
  } catch (err) {
    console.error('Merchant upsert error:', err.message);
  }
};

/**
 * Update merchant dispute rates when a dispute is ingested.
 * Called from disputeService after a dispute is recorded.
 */
const recordDispute = async (merchantId, isFraud = false) => {
  try {
    const merchant = await Merchant.findOne({ merchantId });
    if (!merchant) return;

    merchant.$inc = {
      totalDisputes: 1,
      fraudDisputes: isFraud ? 1 : 0,
    };

    // Recalculate dispute rate from actual data (disputes / transactions)
    const disputeCount = (merchant.totalDisputes || 0) + 1;
    const fraudCount = (merchant.fraudDisputes || 0) + (isFraud ? 1 : 0);
    const txnCount = merchant.totalTransactions || 1;

    const updated = await Merchant.findOneAndUpdate(
      { merchantId },
      {
        $inc: { totalDisputes: 1, fraudDisputes: isFraud ? 1 : 0 },
        $set: { disputeRate: Math.round((disputeCount / txnCount) * 10000) / 100 },
      },
      { new: true, runValidators: true }
    );

    // Recalculate risk score
    if (updated) {
      const riskScore = computeRiskScore(updated);
      const oldTier = updated.riskTier;
      updated.riskScore = riskScore;
      updated.riskTier = scoreToTier(riskScore);
      await updated.save();
      if (oldTier !== updated.riskTier) {
        eventBus.emit(EVENTS.MERCHANT_TIER_CHANGED, {
          merchantId,
          oldTier,
          newTier: updated.riskTier,
          riskScore,
        });
      }
    }
  } catch (err) {
    console.error('Merchant dispute update error:', err.message);
  }
};

/**
 * Get merchant profile with full analytics.
 */
const getMerchant = async (merchantId) => {
  const merchant = await Merchant.findOne({ merchantId });
  if (!merchant) return null;

  // Fetch recent transaction distribution for time-series
  const recentTxns = await Transaction.find({ merchantId })
    .sort({ createdAt: -1 })
    .limit(100)
    .select('amount fraudScore fraudStatus createdAt');

  // Per-status breakdown
  const statusCounts = { clear: 0, review: 0, blocked: 0 };
  recentTxns.forEach(t => {
    statusCounts[t.fraudStatus] = (statusCounts[t.fraudStatus] || 0) + 1;
  });

  // Amount distribution
  const amounts = recentTxns.map(t => t.amount).sort((a, b) => a - b);
  const amountStats = {
    min: amounts[0] || 0,
    max: amounts[amounts.length - 1] || 0,
    median: amounts[Math.floor(amounts.length / 2)] || 0,
    p95: amounts[Math.floor(amounts.length * 0.95)] || 0,
  };

  // Hourly distribution
  const hourly = new Array(24).fill(0);
  recentTxns.forEach(t => {
    const h = new Date(t.createdAt).getHours();
    hourly[h]++;
  });

  // Dispute history
  const disputes = await Dispute.find({ transactionId: { $in: [] } }).limit(0);
  const merchantDisputes = await Dispute.aggregate([
    { $lookup: { from: 'transactions', localField: 'transactionId', foreignField: 'transactionId', as: 'txn' } },
    { $unwind: { path: '$txn', preserveNullAndEmptyArrays: false } },
    { $match: { 'txn.merchantId': merchantId } },
    { $sort: { createdAt: -1 } },
    { $limit: 20 },
    { $project: { transactionId: 1, reason: 1, status: 1, amount: 1, fraudConfirmed: 1, createdAt: 1 } },
  ]);

  return {
    ...merchant.toObject(),
    analytics: {
      statusCounts,
      amountStats,
      hourlyDistribution: hourly,
      recentDisputes: merchantDisputes,
    },
  };
};

/**
 * List all merchants with filtering and sorting.
 */
const listMerchants = async ({ riskTier, mcc, status, sortBy = 'riskScore', sortOrder = 'desc', page = 1, limit = 50 } = {}) => {
  const filter = {};
  if (riskTier) filter.riskTier = riskTier;
  if (mcc) filter.mcc = mcc;
  if (status) filter.status = status;

  const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

  const [merchants, total] = await Promise.all([
    Merchant.find(filter)
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit),
    Merchant.countDocuments(filter),
  ]);

  return { merchants, total, page, limit };
};

/**
 * Get aggregate risk statistics.
 */
const getRiskStats = async () => {
  const [tierCounts, avgRiskScore, totalMerchants, highRisk, topDisputeRate] = await Promise.all([
    Merchant.aggregate([
      { $group: { _id: '$riskTier', count: { $sum: 1 } } },
    ]),
    Merchant.aggregate([
      { $group: { _id: null, avg: { $avg: '$riskScore' } } },
    ]),
    Merchant.countDocuments(),
    Merchant.countDocuments({ riskTier: { $in: ['high', 'critical'] } }),
    Merchant.find().sort({ disputeRate: -1 }).limit(5).select('merchantId disputeRate totalDisputes riskTier mcc'),
  ]);

  const byTier = {};
  tierCounts.forEach(t => { byTier[t._id] = t.count; });

  return {
    totalMerchants,
    byTier: { low: 0, medium: 0, high: 0, critical: 0, ...byTier },
    highRisk,
    avgRiskScore: Math.round((avgRiskScore[0]?.avg || 0) * 100) / 100,
    topDisputeRate,
  };
};

/**
 * Get MCC distribution across all merchants.
 */
const getMCCDistribution = async () => {
  const dist = await Merchant.aggregate([
    { $match: { mcc: { $ne: null } } },
    { $group: { _id: '$mcc', count: { $sum: 1 }, avgRisk: { $avg: '$riskScore' }, totalTxns: { $sum: '$totalTransactions' } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
  ]);

  return dist.map(d => ({
    mcc: d._id,
    category: MCC_CODES[d._id] || 'Unknown',
    merchantCount: d.count,
    avgRiskScore: Math.round(d.avgRisk * 100) / 100,
    totalTransactions: d.totalTxns,
  }));
};

module.exports = {
  upsertFromTransaction,
  recordDispute,
  getMerchant,
  listMerchants,
  getRiskStats,
  getMCCDistribution,
  computeRiskScore,
  MCC_CODES,
};
