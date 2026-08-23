/**
 * FraudAlert.js — fraud alerts with full case management.
 *
 * Case management fields:
 *  - assignedTo / assignedAt: who's working this case
 *  - priority: P1 (critical) — P4 (low), auto-set from fraud score if unset
 *  - sla: { deadlineAt, breachedAt } — tracks SLA compliance
 *  - notes: immutable timeline of analyst notes (each has author, text, timestamp)
 *  - status now includes 'investigating' for the in-progress workflow
 *  - transitions: open → investigating → escalated → resolved/false_positive
 */
const mongoose = require('mongoose');

const caseNoteSchema = new mongoose.Schema({
  author: { type: String, required: true },
  text:   { type: String, required: true },
  type:   { type: String, enum: ['note', 'status_change', 'assignment', 'system'], default: 'note' },
  // Snapshot of what changed (for status_change and assignment notes)
  meta:   { type: mongoose.Schema.Types.Mixed },
}, { timestamps: true });

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
    enum: ['open', 'investigating', 'resolved', 'false_positive', 'escalated', 'reopened'],
    default: 'open',
    index: true
  },
  rulesTriggered: [{ ruleName: String, score: Number, reason: String }],
  resolvedBy: { type: String },
  resolvedAt: { type: Date },
  escalatedBy: { type: String },
  escalatedAt: { type: Date },
  escalationNotes: { type: String },

  // ── Case management ──────────────────────────────────────────
  assignedTo:   { type: String, index: true, sparse: true },
  assignedAt:   { type: Date },
  priority: {
    type: String,
    enum: ['P1', 'P2', 'P3', 'P4'],
    default: 'P3',
    index: true,
  },
  sla: {
    deadlineAt: { type: Date },   // when the case MUST be resolved by
    breachedAt: { type: Date },   // when SLA was breached (set by monitor)
  },
  notes: [caseNoteSchema],
}, {
  timestamps: true,
  optimisticConcurrency: true,
});

fraudAlertSchema.index({ createdAt: -1 });
fraudAlertSchema.index({ fraudScore: -1 });
fraudAlertSchema.index({ assignedTo: 1, status: 1 });
fraudAlertSchema.index({ 'sla.deadlineAt': 1, status: 1 });

module.exports = mongoose.model('FraudAlert', fraudAlertSchema);
