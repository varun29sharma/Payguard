const express = require('express');
const router = express.Router();
const BlockList = require('../models/BlockList');
const { protect } = require('../middleware/authMiddleware');

// GET /api/blocklist
router.get('/', protect, async (req, res) => {
  try {
    const entries = await BlockList.find({ isActive: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: entries });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/blocklist — block a user or device
router.post('/', protect, async (req, res) => {
  try {
    const { type, value, reason, relatedAlertId, relatedCampaignId, expiresAt } = req.body;

    const existing = await BlockList.findOne({ type, value, isActive: true });
    if (existing) {
      return res.status(400).json({ message: `${type} ${value} is already blocked` });
    }

    const entry = await BlockList.create({
      type, value, reason,
      blockedBy: req.user.email,
      relatedAlertId, relatedCampaignId,
      expiresAt: expiresAt ? new Date(expiresAt) : null
    });

    req.app.get('io').emit('blocklist-updated', { action: 'blocked', entry });
    res.status(201).json({ success: true, data: entry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/blocklist/:id — unblock
router.delete('/:id', protect, async (req, res) => {
  try {
    const entry = await BlockList.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );
    req.app.get('io').emit('blocklist-updated', { action: 'unblocked', entry });
    res.json({ success: true, data: entry });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/blocklist/check/:type/:value
router.get('/check/:type/:value', async (req, res) => {
  try {
    const entry = await BlockList.findOne({
      type: req.params.type,
      value: req.params.value,
      isActive: true
    });
    res.json({ blocked: !!entry, entry: entry || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
