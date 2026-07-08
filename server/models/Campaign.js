const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      'DEVICE_FINGERPRINT',
      'MERCHANT_CLUSTER',
      'ENUMERATION_CAMPAIGN',
      'RELAY_FRAUD',
      'ACCOUNT_TAKEOVER_WAVE'
    ],
    required: true
  },
  severity: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'HIGH'
  },
  title: { type: String, required: true },
  description: { type: String, required: true },
  affectedUsers: [String],
  alertIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FraudAlert' }],
  alertCount: { type: Number, default: 0 },
  totalAmount: { type: Number, default: 0 },
  commonAttribute: {
    key: String,
    value: String
  },
  status: {
    type: String,
    enum: ['active', 'investigating', 'contained', 'dismissed'],
    default: 'active'
  },
  investigatedBy: String,
  containedAt: Date,
  detectedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

campaignSchema.index({ type: 1, status: 1 });
campaignSchema.index({ detectedAt: -1 });

module.exports = mongoose.model('Campaign', campaignSchema);
