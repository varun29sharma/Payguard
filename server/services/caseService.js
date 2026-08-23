/**
 * caseService.js — case management workflow for fraud alerts.
 *
 * Turns the flat alert queue into a proper investigation case: assignment,
 * priority, SLA deadlines, analyst notes timeline, and controlled status
 * transitions with audit logging.
 *
 * SLA policy (auto-applied on alert creation or manual priority set):
 *   P1 (critical, score ≥ 80): 1 hour
 *   P2 (high,     score ≥ 60): 4 hours
 *   P3 (medium,   score ≥ 40): 24 hours
 *   P4 (low,      score < 40): 72 hours
 *
 * Status transitions (enforced):
 *   open         → investigating, resolved, false_positive, escalated, reopened
 *   investigating → resolved, false_positive, escalated, reopened
 *   escalated     → investigating, resolved, false_positive, reopened
 *   reopened      → investigating, resolved, false_positive, escalated
 *   resolved      → reopened
 *   false_positive → reopened
 */
const FraudAlert = require('../models/FraudAlert');
const { eventBus, EVENTS } = require('../events/eventBus');
const { recordAudit } = require('./auditLogService');
const { NotFoundError, ValidationError } = require('../utils/errors');

// SLA windows per priority (milliseconds).
const SLA_WINDOWS = {
  P1: 1  * 60 * 60 * 1000,   // 1 hour
  P2: 4  * 60 * 60 * 1000,   // 4 hours
  P3: 24 * 60 * 60 * 1000,   // 24 hours
  P4: 72 * 60 * 60 * 1000,   // 72 hours
};

// Valid transitions: from → Set(allowed targets)
const VALID_TRANSITIONS = {
  open:            new Set(['investigating', 'resolved', 'false_positive', 'escalated', 'reopened']),
  investigating:   new Set(['resolved', 'false_positive', 'escalated', 'reopened']),
  escalated:       new Set(['investigating', 'resolved', 'false_positive', 'reopened']),
  reopened:        new Set(['investigating', 'resolved', 'false_positive', 'escalated']),
  resolved:        new Set(['reopened']),
  false_positive:  new Set(['reopened']),
};

/** Derive priority from fraud score if not explicitly set. */
const derivePriority = (score) => {
  if (score >= 80) return 'P1';
  if (score >= 60) return 'P2';
  if (score >= 40) return 'P3';
  return 'P4';
};

/** Compute SLA deadline from priority + current time. */
const computeDeadline = (priority, from = new Date()) => {
  const window = SLA_WINDOWS[priority] || SLA_WINDOWS.P3;
  return new Date(from.getTime() + window);
};

// ── Assign ────────────────────────────────────────────────────

const assignCase = async (alertId, { assignedTo, analyst }) => {
  if (!assignedTo) throw new ValidationError('assignedTo is required');
  const alert = await FraudAlert.findById(alertId);
  if (!alert) throw new NotFoundError('Alert not found');

  const oldAssignee = alert.assignedTo || null;
  alert.assignedTo = assignedTo;
  alert.assignedAt = new Date();

  // Auto-transition to investigating on first assignment if still open
  if (alert.status === 'open') {
    alert.status = 'investigating';
    alert.notes.push({
      author: analyst,
      text: `Status changed from open to investigating (auto on assignment)`,
      type: 'status_change',
      meta: { from: 'open', to: 'investigating' },
    });
  }

  alert.notes.push({
    author: analyst,
    text: oldAssignee ? `Reassigned from ${oldAssignee} to ${assignedTo}` : `Assigned to ${assignedTo}`,
    type: 'assignment',
    meta: { from: oldAssignee, to: assignedTo },
  });

  await alert.save();
  await alert.populate('transaction');

  await recordAudit({
    analyst, action: 'ASSIGN_CASE',
    oldValue: { assignedTo: oldAssignee },
    newValue: { assignedTo },
    affectedIds: [String(alert._id)],
  });

  eventBus.emit(EVENTS.CASE_ASSIGNED, { alert, assignedTo, from: oldAssignee });
  eventBus.emit(EVENTS.ALERT_UPDATED, alert);

  return alert;
};

// ── Add note ──────────────────────────────────────────────────

const addNote = async (alertId, { text, author, type = 'note' }) => {
  if (!text || !text.trim()) throw new ValidationError('Note text is required');
  const alert = await FraudAlert.findById(alertId);
  if (!alert) throw new NotFoundError('Alert not found');

  alert.notes.push({ author, text: text.trim(), type });
  await alert.save();
  await alert.populate('transaction');

  eventBus.emit(EVENTS.CASE_NOTE_ADDED, { alert, note: alert.notes[alert.notes.length - 1] });

  return alert.notes[alert.notes.length - 1];
};

// ── Set priority ──────────────────────────────────────────────

const setPriority = async (alertId, { priority, analyst }) => {
  const allowed = ['P1', 'P2', 'P3', 'P4'];
  if (!allowed.includes(priority)) throw new ValidationError(`priority must be one of: ${allowed.join(', ')}`);

  const alert = await FraudAlert.findById(alertId);
  if (!alert) throw new NotFoundError('Alert not found');

  const oldPriority = alert.priority;
  alert.priority = priority;
  alert.sla.deadlineAt = computeDeadline(priority);

  // Clear breach if priority was upgraded
  if (['P1', 'P2'].includes(priority) && alert.sla.breachedAt) {
    alert.sla.breachedAt = null;
  }

  alert.notes.push({
    author: analyst,
    text: `Priority changed from ${oldPriority} to ${priority}`,
    type: 'status_change',
    meta: { from: oldPriority, to: priority, deadlineAt: alert.sla.deadlineAt },
  });

  await alert.save();
  await alert.populate('transaction');

  eventBus.emit(EVENTS.ALERT_UPDATED, alert);
  return alert;
};

// ── Status transition ─────────────────────────────────────────

const transitionStatus = async (alertId, { status, analyst, reason }) => {
  const alert = await FraudAlert.findById(alertId);
  if (!alert) throw new NotFoundError('Alert not found');

  const allowed = VALID_TRANSITIONS[alert.status];
  if (!allowed || !allowed.has(status)) {
    throw new ValidationError(`Cannot transition from "${alert.status}" to "${status}". Allowed: ${[...VALID_TRANSITIONS[alert.status] || []].join(', ')}`);
  }

  const oldStatus = alert.status;
  alert.status = status;

  // Resolve / false_positive fields
  if (status === 'resolved') {
    alert.resolvedBy = analyst;
    alert.resolvedAt = new Date();
  } else if (status === 'false_positive') {
    alert.resolvedBy = analyst;
    alert.resolvedAt = new Date();
  } else if (status === 'escalated') {
    alert.escalatedBy = analyst;
    alert.escalatedAt = new Date();
    alert.escalationNotes = reason;
  }

  alert.notes.push({
    author: analyst,
    text: `Status changed from ${oldStatus} to ${status}${reason ? `: ${reason}` : ''}`,
    type: 'status_change',
    meta: { from: oldStatus, to: status, reason },
  });

  await alert.save();
  await alert.populate('transaction');

  await recordAudit({
    analyst, action: 'TRANSITION_CASE',
    oldValue: { status: oldStatus },
    newValue: { status },
    reason,
    affectedIds: [String(alert._id)],
  });

  if (status === 'escalated') {
    eventBus.emit(EVENTS.ALERT_ESCALATED, alert);
  }
  eventBus.emit(EVENTS.ALERT_UPDATED, alert);

  return alert;
};

// ── SLA monitoring (called by interval) ───────────────────────

const checkSLABreaches = async () => {
  const now = new Date();
  const breached = await FraudAlert.find({
    status: { $in: ['open', 'investigating', 'escalated', 'reopened'] },
    'sla.deadlineAt': { $lte: now },
    'sla.breachedAt': null,
  }).populate('transaction');

  for (const alert of breached) {
    alert.sla.breachedAt = now;
    alert.notes.push({
      author: 'system',
      text: `SLA breached — deadline was ${alert.sla.deadlineAt.toISOString()}`,
      type: 'system',
      meta: { deadlineAt: alert.sla.deadlineAt, breachedAt: now },
    });
    await alert.save();
    eventBus.emit(EVENTS.SLA_BREACHED, { alert });
    eventBus.emit(EVENTS.ALERT_UPDATED, alert);
  }

  return breached.length;
};

// ── Ensure SLA on alert creation (called by transactionService) ──

const ensureSLA = async (alert) => {
  if (!alert.sla || !alert.sla.deadlineAt) {
    const priority = alert.priority || derivePriority(alert.fraudScore);
    alert.priority = priority;
    alert.sla = { deadlineAt: computeDeadline(priority) };
    await alert.save();
  }
  return alert;
};

// ── Stats for the case dashboard ──────────────────────────────

const getCaseStats = async () => {
  const pipeline = [
    {
      $facet: {
        byStatus: [
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ],
        byPriority: [
          { $match: { status: { $in: ['open', 'investigating', 'escalated', 'reopened'] } } },
          { $group: { _id: '$priority', count: { $sum: 1 } } },
        ],
        slaBreaches: [
          { $match: { 'sla.breachedAt': { $ne: null }, status: { $in: ['open', 'investigating', 'escalated', 'reopened'] } } },
          { $count: 'count' },
        ],
        unassigned: [
          { $match: { status: { $in: ['open', 'investigating', 'reopened'] }, assignedTo: { $exists: false } } },
          { $count: 'count' },
        ],
        avgNotes: [
          { $match: { notes: { $exists: true, $ne: [] } } },
          { $project: { noteCount: { $size: '$notes' } } },
          { $group: { _id: null, avg: { $avg: '$noteCount' } } },
        ],
      },
    },
  ];

  const [result] = await FraudAlert.aggregate(pipeline);

  const statusMap = {};
  (result.byStatus || []).forEach(s => { statusMap[s._id] = s.count; });

  const priorityMap = {};
  (result.byPriority || []).forEach(p => { priorityMap[p._id] = p.count; });

  return {
    byStatus: statusMap,
    byPriority: priorityMap,
    slaBreached: result.slaBreaches?.[0]?.count || 0,
    unassigned: result.unassigned?.[0]?.count || 0,
    avgNotesPerCase: Math.round((result.avgNotes?.[0]?.avg || 0) * 10) / 10,
  };
};

module.exports = {
  assignCase,
  addNote,
  setPriority,
  transitionStatus,
  checkSLABreaches,
  ensureSLA,
  getCaseStats,
  derivePriority,
  computeDeadline,
  SLA_WINDOWS,
};
