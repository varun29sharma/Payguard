const Transaction = require("../models/Transaction");
const FraudAlert = require("../models/FraudAlert");
const { v4: uuidv4 } = require("uuid");
const { callFraudEngine } = require("../utils/fraudEngineClient");
//POST /api/transactions - ingest a new transaction
const createTransaction = async (req, res) => {
  try {
    const { userId, merchantId, amount, currency, location, deviceId } =
      req.body;
    const transaction = new Transaction({
      transactionId: uuidv4(),
      userId,
      merchantId,
      amount,
      currency: currency || "INR",
      location,
      deviceId,
      timestamp: new Date(),
    });
    let fraudResult = {
      score: 0,
      status: "clear",
      fraudStatus: "clear",
      rulesTriggered: [],
    };
    try {
      fraudResult = await callFraudEngine(transaction);
    } catch (e) {
      console.warn("Fraud engine unavailable, defaulting to clear.");
    }
    const fraudStatus =
      fraudResult.fraudStatus || fraudResult.status || "clear";
    transaction.fraudScore = fraudResult.score || 0;
    transaction.fraudStatus = fraudStatus;
    transaction.rulesTriggered = fraudResult.rulesTriggered || [];

    const saved = await transaction.save();

    if (fraudStatus !== "clear") {
      const alert = await FraudAlert.create({
        transaction: saved._id,
        userId: saved.userId,
        fraudScore: transaction.fraudScore,
        rulesTriggered: transaction.rulesTriggered,
      });
      const io = req.app.get("io");
      io.emit("new-fraud-alert", { alert, transaction: saved });
    }
    const io = req.app.get("io");
    io.emit("new-transaction", saved);

    res.status(201).json({ success: true, data: saved });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
// GET /api/transcations - paginated list
const getTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const [transactions, total] = await Promise.all([
      Transaction.find().sort({ timestamp: -1 }).skip(skip).limit(limit),
      Transaction.countDocuments(),
    ]);
    res.json({
      success: true,
      data: transactions,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
//GET /api/transcations/stats - for the dashboard charts

const getStats = async (req, res) => {
  try {
    const [total, flagged, blocked, avgResult] = await Promise.all([
      Transaction.countDocuments(),
      Transaction.countDocuments({ fraudStatus: "review" }),
      Transaction.countDocuments({ fraudStatus: "blocked" }),
      Transaction.aggregate([
        { $group: { _id: null, avg: { $avg: "$fraudScore" } } },
      ]),
    ]);
    const avgFraudScore = avgResult[0]?.avg || 0;
    res.json({
      total,
      flagged,
      blocked,
      clear: total - flagged - blocked,
      avgFraudScore,
    });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
module.exports = { createTransaction, getTransactions, getStats };
