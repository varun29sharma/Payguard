/**
 * UPDATED alertController.js
 * Adds: blockUser, blockDevice, escalateAlert, and enhanced getAlerts
 */

const FraudAlert = require('../models/FraudAlert');
const BlockList = require('../models/BlockList');
const Transaction = require('../models/Transaction');

// GET /api/alerts
const getAlerts = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = status && status !== 'all' ? { status } : {};

    const [alerts, total] = await Promise.all([
      FraudAlert.find(filter)
        .populate('transaction')
        .sort({ createdAt: -1 })
        .skip((parseInt(page) - 1) * parseInt(limit))
        .limit(parseInt(limit)),
      FraudAlert.countDocuments(filter)
    ]);

    res.json({
      success: true,
      data: alerts,
      pagination: { page: parseInt(page), limit: parseInt(limit), total }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH /api/alerts/:id/resolve
const resolveAlert = async (req, res) => {
  try {
    const { status } = req.body;
    const alert = await FraudAlert.findByIdAndUpdate(
      req.params.id,
      { status, resolvedBy: req.user.email, resolvedAt: new Date() },
      { new: true }
    ).populate('transaction');

    req.app.get('io').emit('alert-updated', alert);
    res.json({ success: true, data: alert });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/alerts/:id/block-user
const blockUser = async (req, res) => {
  try {
    const alert = await FraudAlert.findById(req.params.id).populate('transaction');
    if (!alert) return res.status(404).json({ message: 'Alert not found' });

    const { reason, expiresAt } = req.body;
    const userId = alert.userId;

    const existing = await BlockList.findOne({ type: 'userId', value: userId, isActive: true });
    if (existing) {
      return res.status(400).json({ message: `User ${userId} is already blocked` });
    }

    const block = await BlockList.create({
      type: 'userId',
      value: userId,
      reason: reason || `Blocked from alert — fraud score: ${alert.fraudScore}`,
      blockedBy: req.user.email,
      relatedAlertId: alert._id
    });

    await FraudAlert.findByIdAndUpdate(alert._id, {
      status: 'resolved',
      resolvedBy: req.user.email,
      resolvedAt: new Date()
    });

    const io = req.app.get('io');
    io.emit('blocklist-updated', { action: 'blocked', entry: block });
    io.emit('alert-updated', { ...alert.toObject(), status: 'resolved' });

    res.json({ success: true, data: block });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/alerts/:id/block-device
const blockDevice = async (req, res) => {
  try {
    const alert = await FraudAlert.findById(req.params.id).populate('transaction');
    if (!alert) return res.status(404).json({ message: 'Alert not found' });

    const deviceId = alert.deviceId || alert.transaction?.deviceId;
    if (!deviceId || deviceId === 'unknown') {
      return res.status(400).json({ message: 'No device ID associated with this alert' });
    }

    const { reason } = req.body;

    const existing = await BlockList.findOne({ type: 'deviceId', value: deviceId, isActive: true });
    if (existing) {
      return res.status(400).json({ message: `Device ${deviceId} is already blocked` });
    }

    const block = await BlockList.create({
      type: 'deviceId',
      value: deviceId,
      reason: reason || `Device blocked — fraud score: ${alert.fraudScore}`,
      blockedBy: req.user.email,
      relatedAlertId: alert._id
    });

    req.app.get('io').emit('blocklist-updated', { action: 'blocked', entry: block });
    res.json({ success: true, data: block });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/alerts/:id/escalate
const escalateAlert = async (req, res) => {
  try {
    const { notes } = req.body;
    const alert = await FraudAlert.findByIdAndUpdate(
      req.params.id,
      {
        status: 'escalated',
        escalatedBy: req.user.email,
        escalatedAt: new Date(),
        escalationNotes: notes
      },
      { new: true }
    ).populate('transaction');

    req.app.get('io').emit('alert-updated', alert);
    req.app.get('io').emit('alert-escalated', alert);

    res.json({ success: true, data: alert });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { getAlerts, resolveAlert, blockUser, blockDevice, escalateAlert };
