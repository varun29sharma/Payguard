const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const { protect } = require('../middleware/authMiddleware');

// GET /api/campaigns — all campaigns (filter by status)
router.get('/', protect, async (req, res) => {
  try {
    const { status = 'active' } = req.query;
    const filter = status === 'all' ? {} : { status };
    const campaigns = await Campaign.find(filter)
      .sort({ detectedAt: -1 })
      .limit(50);
    res.json({ success: true, data: campaigns });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/campaigns/stats — campaign type breakdown
router.get('/stats', protect, async (req, res) => {
  try {
    const stats = await Campaign.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 }, totalAmount: { $sum: '$totalAmount' } } }
    ]);
    const total = await Campaign.countDocuments({ status: 'active' });
    const critical = await Campaign.countDocuments({ status: 'active', severity: 'CRITICAL' });
    res.json({ success: true, data: stats, total, critical });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/campaigns/:id/status — update campaign status
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { status } = req.body;
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      {
        status,
        investigatedBy: req.user.email,
        ...(status === 'contained' ? { containedAt: new Date() } : {})
      },
      { new: true }
    );
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    req.app.get('io').emit('campaign-updated', campaign);
    res.json({ success: true, data: campaign });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
