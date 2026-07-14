const mongoose = require('mongoose');

// Immutable trail of every analyst action (block/unblock/resolve/escalate).
// Application code only ever inserts here — see services/auditLogService.js.
const auditLogSchema = new mongoose.Schema({
  analyst: { type: String, required: true, index: true },
  action: { type: String, required: true, index: true },
  oldValue: { type: mongoose.Schema.Types.Mixed },
  newValue: { type: mongoose.Schema.Types.Mixed },
  reason: { type: String },
  affectedIds: [{ type: String }],
}, { timestamps: true });

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
