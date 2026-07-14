/**
 * UPDATED FraudAlert.js
 * Adds: merchantId, deviceId, amount, location, escalation fields
 */
const mongoose = require('mongoose');

const fraudAlertSchema = new mongoose.Schema({
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction',
    required: true
  },
  userId: { type: String, required: true, index: true },
  merchantId: { type: String },
  deviceId: { type: String, index: true },
  accountId: { type: String, index: true, sparse: true },
  fingerprint: { type: String, index: true, sparse: true },
  sessionId: { type: String, index: true, sparse: true },
  ipAddress: { type: String, index: true, sparse: true },
  walletId: { type: String, index: true, sparse: true },
  email: { type: String, index: true, sparse: true },
  phone: { type: String, index: true, sparse: true },
  amount: { type: Number },
  location: {
    city: String,
    lat: Number,
    lng: Number
  },
  fraudScore: { type: Number, required: true },
  status: {
    type: String,
    enum: ['open', 'resolved', 'false_positive', 'escalated'],
    default: 'open',
    index: true
  },
  rulesTriggered: [{ ruleName: String, score: Number, reason: String }],
  resolvedBy: { type: String },
  resolvedAt: { type: Date },
  escalatedBy: { type: String },
  escalatedAt: { type: Date },
  escalationNotes: { type: String }
}, {
  timestamps: true,
  // Optimistic concurrency: two analysts racing to resolve/escalate the same
  // alert now get a VersionError (mapped to HTTP 409) on the loser instead of
  // silently overwriting each other's decision.
  optimisticConcurrency: true,
});

fraudAlertSchema.index({ createdAt: -1 });
fraudAlertSchema.index({ fraudScore: -1 });

module.exports = mongoose.model('FraudAlert', fraudAlertSchema);
