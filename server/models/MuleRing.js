const mongoose = require("mongoose");

/**
 * MuleRing — a detected laundering ring: accounts that received funds from
 * multiple senders and forwarded most of it on within 24 hours, clustered by
 * shared identity (device/IP/fingerprint/…). See services/muleDetectorService.js.
 */
const muleRingSchema = new mongoose.Schema(
  {
    accounts: { type: [String], required: true, index: true },
    status: { type: String, enum: ['open', 'blocked', 'dismissed'], default: 'open', index: true },
    totalReceived: { type: Number, default: 0 },
    totalForwarded: { type: Number, default: 0 },
    receivedFrom: { type: [String], default: [] },   // distinct inbound senders
    forwardedTo: { type: [String], default: [] },     // distinct outbound beneficiaries
    // Identifiers shared across ring members (what ties the accounts together).
    sharedIdentifiers: { type: mongoose.Schema.Types.Mixed, default: {} },
    // Sample of the transactions that constitute the pattern (receive/forward legs).
    evidence: [{
      transactionId: String,
      kind: { type: String, enum: ['receive', 'forward'] },
      userId: String,
      beneficiaryId: String,
      amount: Number,
      timestamp: Date,
    }],
    firstSeenAt: { type: Date },
    lastSeenAt: { type: Date },
    blockedAt: { type: Date },
    blockedBy: { type: String },
  },
  { timestamps: true },
);

muleRingSchema.index({ status: 1, lastSeenAt: -1 });

module.exports = mongoose.model("MuleRing", muleRingSchema);
