const { eventBus, EVENTS } = require('./eventBus');
const Transaction = require('../models/Transaction');

// The wire event names the existing frontend already listens for. Keeping
// these stable means the socket-event *contract* with the client doesn't
// change even though every emit now flows through the eventBus first.
const WIRE_EVENTS = {
  [EVENTS.NEW_TRANSACTION]: 'new-transaction',
  [EVENTS.NEW_FRAUD_ALERT]: 'new-fraud-alert',
  [EVENTS.ALERT_UPDATED]: 'alert-updated',
  [EVENTS.ALERT_ESCALATED]: 'alert-escalated',
  [EVENTS.CAMPAIGN_NEW]: 'new-campaign',
  [EVENTS.CAMPAIGN_UPDATED]: 'campaign-updated',
  [EVENTS.TRANSACTION_REJECTED]: 'blocked-transaction',
  [EVENTS.ANALYST_ACTION_LOGGED]: 'analyst-action-logged',
};

let statsTimer = null;
const scheduleStatsBroadcast = (io) => {
  if (statsTimer) return;
  statsTimer = setTimeout(async () => {
    statsTimer = null;
    try {
      const [total, review, blocked, rejected] = await Promise.all([
        Transaction.countDocuments(),
        Transaction.countDocuments({ fraudStatus: 'review' }),
        Transaction.countDocuments({ fraudStatus: 'blocked' }),
        Transaction.countDocuments({ fraudStatus: 'rejected' }),
      ]);
      io.emit('dashboard-stats-updated', {
        total, review, blocked, rejected, clear: total - review - blocked - rejected,
      });
    } catch (err) {
      console.error('Dashboard stats broadcast failed:', err.message);
    }
  }, 400);
};

/**
 * Wires the event bus to a live Socket.IO server. Call this once, right
 * after `io` is created in index.js.
 */
const attachSocketBridge = (io) => {
  for (const [busEvent, wireEvent] of Object.entries(WIRE_EVENTS)) {
    eventBus.on(busEvent, (payload) => io.emit(wireEvent, payload));
  }

  eventBus.on(EVENTS.BLOCK_CREATED, (payload) => {
    io.emit('blocklist-updated', { action: 'blocked', entries: payload.entries, result: payload });
  });
  eventBus.on(EVENTS.BLOCK_REMOVED, (payload) => {
    io.emit('blocklist-updated', { action: 'unblocked', entry: payload.entry });
  });
  eventBus.on(EVENTS.TRANSACTION_UPDATED, (payload) => io.emit('transaction-updated', payload));
  eventBus.on(EVENTS.REVIEW_QUEUE_UPDATED, (payload) => io.emit('review-queue-updated', payload));

  // Any event that changes the shape of the transaction pool schedules a
  // (debounced) refresh of the dashboard summary counters.
  [
    EVENTS.NEW_TRANSACTION, EVENTS.TRANSACTION_UPDATED, EVENTS.TRANSACTION_REJECTED,
    EVENTS.BLOCK_CREATED, EVENTS.REVIEW_QUEUE_UPDATED,
  ].forEach((evt) => eventBus.on(evt, () => scheduleStatsBroadcast(io)));
};

module.exports = { attachSocketBridge };
