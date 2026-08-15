/**
 * engineHealthService.js — keeps a live view of the Java fraud engine's
 * availability and of how transactions are actually being scored.
 *
 * Why this exists: transactionService.js falls back to a `clear` score when
 * the engine is unreachable (see utils/fraudEngineClient.js). Without a
 * heartbeat, analysts have no way to tell that every transaction is being
 * let through unscored. This service:
 *   - polls /api/fraud/health on an interval and caches the result,
 *   - records every scoring fallback (with reason + count),
 *   - emits ENGINE_HEALTH on the event bus whenever state changes, which the
 *     socket bridge forwards to the UI as 'engine-health'.
 *
 * The polling interval is deliberately modest (10s) — it's a status beacon,
 * not a hot path.
 */
const { checkFraudEngineHealth } = require('../utils/fraudEngineClient');
const { eventBus, EVENTS } = require('../events/eventBus');

const POLL_INTERVAL_MS = 10 * 1000;

const state = {
  up: null,            // null = not checked yet
  latencyMs: null,
  rules: [],
  service: 'payguard-fraud-engine',
  checkedAt: null,
  lastFallbackAt: null, // last time a scoring call fell back to 'clear'
  fallbackReason: null,
  fallbackCount: 0,
};

let monitorTimer = null;

const emitState = () => {
  eventBus.emit(EVENTS.ENGINE_HEALTH, { ...state });
};

const refresh = async () => {
  const snapshot = await checkFraudEngineHealth();
  const changed = snapshot.up !== state.up || snapshot.rules.length !== state.rules.length;
  state.up = snapshot.up;
  state.latencyMs = snapshot.latencyMs;
  state.rules = snapshot.rules;
  state.service = snapshot.service;
  state.checkedAt = snapshot.checkedAt;
  if (changed) emitState();
};

/**
 * Call this from transactionService whenever the engine call throws — the
 * transaction will be recorded as clear-scored, and the UI needs to know the
 * system is running in degraded (fallback) mode.
 */
const recordScoringFallback = (reason) => {
  state.lastFallbackAt = new Date();
  state.fallbackReason = reason || 'fraud engine unreachable';
  state.fallbackCount += 1;
  emitState();
};

const getEngineHealth = () => ({ ...state });

const startEngineHealthMonitor = (intervalMs = POLL_INTERVAL_MS) => {
  if (monitorTimer) return;
  refresh(); // immediate first probe
  monitorTimer = setInterval(refresh, intervalMs);
  monitorTimer.unref?.();
};

module.exports = { startEngineHealthMonitor, getEngineHealth, recordScoringFallback, refresh };
