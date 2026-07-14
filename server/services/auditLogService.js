const AuditLog = require('../models/AuditLog');
const { eventBus, EVENTS } = require('../events/eventBus');

/**
 * Records every analyst-initiated state change (block, unblock, resolve,
 * escalate, ...) to an immutable audit trail. Nothing ever updates or
 * deletes an AuditLog row from application code — it's write-once by design.
 */
const recordAudit = async ({ analyst, action, oldValue, newValue, reason, affectedIds = [] }, session) => {
  const [entry] = await AuditLog.create(
    [{ analyst, action, oldValue, newValue, reason, affectedIds }],
    session ? { session } : undefined,
  );
  eventBus.emit(EVENTS.ANALYST_ACTION_LOGGED, entry);
  return entry;
};

module.exports = { recordAudit };
