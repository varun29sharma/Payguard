const mongoose = require('mongoose');

/**
 * Per the product decision: blocking an entity must NEVER delete its
 * transactions. Instead every transaction/alert touched by a block gets
 * archived here as a permanent audit record, while the Transaction document
 * itself just moves to fraudStatus:'rejected' (see services/blocklistService.js).
 */
const blockedActivityLogSchema = new mongoose.Schema({
  identifiers: [{
    type: { type: String, required: true },
    value: { type: String, required: true },
  }],
  reason: { type: String, required: true },
  blockedBy: { type: String, required: true },
  relatedAlertId: { type: mongoose.Schema.Types.ObjectId, ref: 'FraudAlert' },
  relatedCampaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  blockListEntryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'BlockList' }],
  transactionsAffected: [{
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    transactionId: String,
    previousStatus: String,
    newStatus: String,
    amount: Number,
    merchantId: String,
    matchedOn: [String],
  }],
  alertsAffected: [{ type: mongoose.Schema.Types.ObjectId, ref: 'FraudAlert' }],
}, { timestamps: true });

blockedActivityLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('BlockedActivityLog', blockedActivityLogSchema);
