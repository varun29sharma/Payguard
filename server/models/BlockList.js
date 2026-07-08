const mongoose = require('mongoose');

const blockListSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['userId', 'deviceId'],
    required: true
  },
  value: {
    type: String,
    required: true,
    index: true
  },
  reason: { type: String, required: true },
  blockedBy: { type: String, required: true },
  relatedAlertId: { type: mongoose.Schema.Types.ObjectId, ref: 'FraudAlert' },
  relatedCampaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  expiresAt: { type: Date },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true
});

blockListSchema.index({ type: 1, value: 1, isActive: 1 });

module.exports = mongoose.model('BlockList', blockListSchema);
