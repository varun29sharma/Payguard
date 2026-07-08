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
  deviceId: { type: String },
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
  timestamps: true
});

fraudAlertSchema.index({ createdAt: -1 });
fraudAlertSchema.index({ fraudScore: -1 });

module.exports = mongoose.model('FraudAlert', fraudAlertSchema);
