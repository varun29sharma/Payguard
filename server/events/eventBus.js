const EventEmitter = require('events');

/**
 * Central event bus (Bug #3 fix). Controllers/services emit domain events
 * here instead of reaching into `req.app.get('io')` and calling `io.emit(...)`
 * inline all over the codebase. `events/socketBridge.js` is the single place
 * that subscribes to these events and forwards them onto Socket.IO, so
 * adding/renaming a socket event now means touching one file, not N.
 */
class PayGuardEventBus extends EventEmitter {}
const eventBus = new PayGuardEventBus();
eventBus.setMaxListeners(50);

const EVENTS = Object.freeze({
  BLOCK_CREATED: 'BLOCK_CREATED',
  BLOCK_REMOVED: 'BLOCK_REMOVED',
  TRANSACTION_UPDATED: 'TRANSACTION_UPDATED',
  TRANSACTION_REJECTED: 'TRANSACTION_REJECTED',
  REVIEW_QUEUE_UPDATED: 'REVIEW_QUEUE_UPDATED',
  ANALYST_ACTION_LOGGED: 'ANALYST_ACTION_LOGGED',
  NEW_TRANSACTION: 'NEW_TRANSACTION',
  NEW_FRAUD_ALERT: 'NEW_FRAUD_ALERT',
  ALERT_UPDATED: 'ALERT_UPDATED',
  ALERT_ESCALATED: 'ALERT_ESCALATED',
  CAMPAIGN_NEW: 'CAMPAIGN_NEW',
  CAMPAIGN_UPDATED: 'CAMPAIGN_UPDATED',
  ENGINE_HEALTH: 'ENGINE_HEALTH',
  DISPUTE_INGESTED: 'DISPUTE_INGESTED',
  MULE_RING_NEW: 'MULE_RING_NEW',
  MULE_RING_UPDATED: 'MULE_RING_UPDATED',
  CASE_NOTE_ADDED: 'CASE_NOTE_ADDED',
  CASE_ASSIGNED: 'CASE_ASSIGNED',
  SLA_BREACHED: 'SLA_BREACHED',
  MERCHANT_CREATED: 'MERCHANT_CREATED',
  MERCHANT_TIER_CHANGED: 'MERCHANT_TIER_CHANGED',
});

module.exports = { eventBus, EVENTS };
