/**
 * alertController.js
 * Thin controller — blocking logic (identity-graph traversal, cascading
 * transaction rejection, audit logging) lives in services/blocklistService.js.
 */

const FraudAlert = require('../models/FraudAlert');
const blocklistService = require('../services/blocklistService');
const caseService = require('../services/caseService');
const { recordAudit } = require('../services/auditLogService');
const { eventBus, EVENTS } = require('../events/eventBus');
const { asyncHandler } = require('../middleware/errorHandler');
const { NotFoundError, ValidationError } = require('../utils/errors');

const RESOLVE_STATUSES = ['resolved', 'false_positive'];

// GET /api/alerts
const getAlerts = asyncHandler(async (req, res) => {
  const { status, page = 1, limit = 20 } = req.query;
  const filter = status && status !== 'all' ? { status } : {};

  const [alerts, total] = await Promise.all([
    FraudAlert.find(filter)
      .populate('transaction')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit)),
    FraudAlert.countDocuments(filter)
  ]);

  res.json({
    success: true,
    data: alerts,
    pagination: { page: parseInt(page), limit: parseInt(limit), total }
  });
});

// PATCH /api/alerts/:id/resolve
const resolveAlert = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!RESOLVE_STATUSES.includes(status)) {
    throw new ValidationError(`status must be one of: ${RESOLVE_STATUSES.join(', ')}`);
  }

  // Fetch + save (rather than findByIdAndUpdate) so Mongoose's
  // optimisticConcurrency check applies — two analysts resolving the same
  // alert at once now get a 409 on the loser instead of a silent overwrite.
  const alert = await FraudAlert.findById(req.params.id);
  if (!alert) throw new NotFoundError('Alert not found');
  const oldStatus = alert.status;

  alert.status = status;
  alert.resolvedBy = req.user.email;
  alert.resolvedAt = new Date();
  await alert.save();
  await alert.populate('transaction');

  await recordAudit({
    analyst: req.user.email, action: 'RESOLVE_ALERT',
    oldValue: { status: oldStatus }, newValue: { status },
    reason: req.body.reason, affectedIds: [String(alert._id)],
  });
  eventBus.emit(EVENTS.ALERT_UPDATED, alert);

  res.json({ success: true, data: alert });
});

// POST /api/alerts/:id/block-user
const blockUser = asyncHandler(async (req, res) => {
  const alert = await FraudAlert.findById(req.params.id).populate('transaction');
  if (!alert) throw new NotFoundError('Alert not found');

  const { reason, expiresAt } = req.body;
  const result = await blocklistService.blockEntity({
    seedIdentifiers: { userId: alert.userId },
    reason: reason || `Blocked from alert — fraud score: ${alert.fraudScore}`,
    blockedBy: req.user.email,
    relatedAlertId: alert._id,
    expiresAt,
  });

  eventBus.emit(EVENTS.ALERT_UPDATED, { ...alert.toObject(), status: 'resolved' });
  res.json({ success: true, data: result });
});

// POST /api/alerts/:id/block-device
const blockDevice = asyncHandler(async (req, res) => {
  const alert = await FraudAlert.findById(req.params.id).populate('transaction');
  if (!alert) throw new NotFoundError('Alert not found');

  const deviceId = alert.deviceId || alert.transaction?.deviceId;
  if (!deviceId || deviceId === 'unknown') throw new ValidationError('No device ID associated with this alert');

  const result = await blocklistService.blockEntity({
    seedIdentifiers: { deviceId },
    reason: req.body.reason || `Device blocked — fraud score: ${alert.fraudScore}`,
    blockedBy: req.user.email,
    relatedAlertId: alert._id,
  });

  res.json({ success: true, data: result });
});

// POST /api/alerts/:id/escalate
const escalateAlert = asyncHandler(async (req, res) => {
  const { notes } = req.body;
  const alert = await FraudAlert.findById(req.params.id);
  if (!alert) throw new NotFoundError('Alert not found');

  alert.status = 'escalated';
  alert.escalatedBy = req.user.email;
  alert.escalatedAt = new Date();
  alert.escalationNotes = notes;
  await alert.save();
  await alert.populate('transaction');

  await recordAudit({
    analyst: req.user.email, action: 'ESCALATE_ALERT',
    oldValue: null, newValue: { notes }, reason: notes, affectedIds: [String(alert._id)],
  });
  eventBus.emit(EVENTS.ALERT_UPDATED, alert);
  eventBus.emit(EVENTS.ALERT_ESCALATED, alert);

  res.json({ success: true, data: alert });
});

// ── Case management endpoints ─────────────────────────────────

// POST /api/alerts/:id/assign
const assignCase = asyncHandler(async (req, res) => {
  const alert = await caseService.assignCase(req.params.id, {
    assignedTo: req.body.assignedTo,
    analyst: req.user.email,
  });
  res.json({ success: true, data: alert });
});

// POST /api/alerts/:id/notes
const addNote = asyncHandler(async (req, res) => {
  const note = await caseService.addNote(req.params.id, {
    text: req.body.text,
    author: req.user.email,
    type: req.body.type || 'note',
  });
  res.json({ success: true, data: note });
});

// PATCH /api/alerts/:id/priority
const setPriority = asyncHandler(async (req, res) => {
  const alert = await caseService.setPriority(req.params.id, {
    priority: req.body.priority,
    analyst: req.user.email,
  });
  res.json({ success: true, data: alert });
});

// PATCH /api/alerts/:id/status
const transitionCaseStatus = asyncHandler(async (req, res) => {
  const alert = await caseService.transitionStatus(req.params.id, {
    status: req.body.status,
    analyst: req.user.email,
    reason: req.body.reason,
  });
  res.json({ success: true, data: alert });
});

// GET /api/alerts/stats/cases
const getCaseStats = asyncHandler(async (req, res) => {
  const stats = await caseService.getCaseStats();
  res.json({ success: true, data: stats });
});

// GET /api/alerts/:id/timeline
const getTimeline = asyncHandler(async (req, res) => {
  const alert = await FraudAlert.findById(req.params.id);
  if (!alert) throw new NotFoundError('Alert not found');
  const entries = (alert.notes || []).map(n => ({
    type: n.type || 'note',
    text: n.text,
    author: n.author,
    meta: n.meta,
    timestamp: n.createdAt || n.timestamp,
  }));
  if (alert.sla?.deadlineAt) entries.push({ type: 'sla_set', text: `SLA deadline: ${alert.sla.deadlineAt}`, timestamp: alert.sla.createdAt || alert.sla.deadlineAt });
  if (alert.sla?.breachedAt) entries.push({ type: 'sla_breached', text: 'SLA breached', timestamp: alert.sla.breachedAt });
  entries.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
  res.json({ success: true, data: entries });
});

module.exports = { getAlerts, resolveAlert, blockUser, blockDevice, escalateAlert, assignCase, addNote, setPriority, transitionCaseStatus, getCaseStats, getTimeline };
