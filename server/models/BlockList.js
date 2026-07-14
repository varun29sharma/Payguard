const mongoose = require('mongoose');

// Every identifier type the identity graph can traverse (see
// services/identityGraphService.js) must be blockable, not just userId/deviceId.
const IDENTITY_TYPES = ['userId', 'deviceId', 'accountId', 'fingerprint', 'sessionId', 'ipAddress', 'walletId', 'email', 'phone'];

const blockListSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: IDENTITY_TYPES,
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

// Partial unique index: at most one ACTIVE block per (type, value) pair.
// This makes "block the same entity twice" a database-level guarantee
// instead of an app-level check-then-insert race condition.
blockListSchema.index(
  { type: 1, value: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model('BlockList', blockListSchema);
module.exports.IDENTITY_TYPES = IDENTITY_TYPES;
