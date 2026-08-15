/**
 * backtestController.js — replay harness for rule changes.
 *
 * The analyst proposes a change to one rule (thresholds / score / enabled).
 * We replay the historical transaction stream through the Java engine twice:
 *   1. baseline  — the CURRENT rule configuration (what's live today),
 *   2. candidate — the proposed configuration (what would be live).
 *
 * Each replay runs on fresh, isolated engine state (see BacktestService in
 * the fraud-engine), so it never touches the live scoring windows. We then
 * compare per-transaction outcomes and report detection deltas plus a
 * false-positive proxy derived from real analyst labels: alerts resolved as
 * 'false_positive' mean an analyst decided the flag was wrong.
 */
const axios = require('axios');
const Transaction = require('../models/Transaction');
const FraudAlert = require('../models/FraudAlert');
const ruleConfigService = require('../services/ruleConfigService');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError, AppError } = require('../utils/errors');

const FRAUD_ENGINE_URL = (process.env.FRAUD_ENGINE_URL || 'http://localhost:8080').replace(/\/$/, '');
const MAX_LIMIT = 2000;
const TABLE_CAP = 200;

const isFlagged = (status) => status !== 'clear';

const replay = async (config, transactions) => {
  const payload = {
    rules: config,
    transactions: transactions.map(t => ({
      transactionId: t.transactionId,
      userId: t.userId,
      merchantId: t.merchantId,
      amount: t.amount,
      timestamp: t.timestamp,
      deviceId: t.deviceId || 'unknown',
      location: t.location || {},
    })),
  };
  let data;
  try {
    const res = await axios.post(`${FRAUD_ENGINE_URL}/api/fraud/backtest`, payload, { timeout: 60000 });
    data = res.data;
  } catch (err) {
    throw new AppError('Fraud engine unavailable — backtest requires the engine to be running.', 503);
  }
  if (!data || !Array.isArray(data.data)) {
    throw new AppError('Fraud engine returned an invalid backtest response.', 502);
  }
  return data.data;
};

const summarize = (rows, statusKey, scoreKey, ruleKey) => {
  const flagged = rows.filter(r => isFlagged(r[statusKey])).length;
  const blocked = rows.filter(r => r[statusKey] === 'blocked').length;
  const avgScore = rows.length
    ? Math.round(rows.reduce((s, r) => s + (r[scoreKey] || 0), 0) / rows.length)
    : 0;
  const byRule = {};
  rows.forEach(r => {
    (r[ruleKey] || []).forEach(name => {
      byRule[name] = (byRule[name] || 0) + 1;
    });
  });
  return { flagged, blocked, flaggedRate: rows.length ? Math.round((flagged / rows.length) * 100) : 0, avgScore, byRule };
};

const runBacktest = asyncHandler(async (req, res) => {
  const { ruleName, changes = {}, windowHours = 168, limit = 500 } = req.body || {};

  if (!ruleName) throw new ValidationError('ruleName is required');
  const known = ruleConfigService.DEFAULT_RULES.map(r => r.ruleName);
  if (!known.includes(ruleName)) {
    throw new ValidationError(`Unknown rule '${ruleName}' — known: ${known.join(', ')}`);
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 10), MAX_LIMIT);
  const since = new Date(Date.now() - (parseInt(windowHours, 10) || 168) * 60 * 60 * 1000);

  const transactions = await Transaction.find({ timestamp: { $gte: since } })
    .sort({ timestamp: 1 }) // chronological — stateful rules need replay order
    .limit(safeLimit)
    .lean();
  if (transactions.length === 0) {
    throw new ValidationError('No transactions in the selected window — run the simulator first.');
  }

  // Baseline = live config; candidate = live config with the proposed change.
  const baseline = await ruleConfigService.getRuleConfigs();
  const candidate = baseline.map(rule => {
    if (rule.ruleName !== ruleName) return rule;
    const next = { ...rule, parameters: { ...rule.parameters } };
    if (changes.enabled !== undefined) next.enabled = changes.enabled === true || changes.enabled === 'true';
    if (changes.score !== undefined && changes.score !== null && changes.score !== '') {
      next.score = Number(changes.score);
    }
    if (changes.parameters) {
      Object.entries(changes.parameters).forEach(([k, v]) => {
        const n = Number(v);
        next.parameters[k] = (v !== '' && Number.isFinite(n)) ? n : next.parameters[k];
      });
    }
    return next;
  });

  const startedAt = Date.now();
  const [baseResults, candResults] = await Promise.all([
    replay(baseline, transactions),
    replay(candidate, transactions),
  ]);

  // Analyst labels: alerts mark transactions as false_positive (wrong flag),
  // resolved (confirmed/actioned) or escalated.
  const ids = transactions.map(t => t._id);
  const alerts = await FraudAlert.find({ transaction: { $in: ids } })
    .select('transaction status')
    .lean();
  const labelByTxn = new Map(alerts.map(a => [String(a.transaction), a.status]));

  // Per-transaction table (recorded reality vs both replays).
  const rows = transactions.map((t, i) => ({
    transactionId: t.transactionId,
    userId: t.userId,
    amount: t.amount,
    city: t.location?.city || null,
    recordedStatus: t.fraudStatus,
    recordedScore: t.fraudScore || 0,
    recordedRules: (t.rulesTriggered || []).map(r => r.ruleName),
    baselineStatus: baseResults[i]?.status || 'clear',
    baselineScore: baseResults[i]?.score || 0,
    baselineRules: (baseResults[i]?.rulesTriggered || []).map(r => r.ruleName),
    candidateStatus: candResults[i]?.status || 'clear',
    candidateScore: candResults[i]?.score || 0,
    candidateRules: (candResults[i]?.rulesTriggered || []).map(r => r.ruleName),
    label: labelByTxn.get(String(t._id)) || null,
  }));

  const recorded = summarize(rows, 'recordedStatus', 'recordedScore', 'recordedRules');
  const baselineSum = summarize(rows, 'baselineStatus', 'baselineScore', 'baselineRules');
  const candidateSum = summarize(rows, 'candidateStatus', 'candidateScore', 'candidateRules');

  // Before/after deltas (candidate vs baseline replay).
  const deltas = {
    newlyFlagged: rows.filter(r => !isFlagged(r.baselineStatus) && isFlagged(r.candidateStatus)).length,
    unFlagged:    rows.filter(r => isFlagged(r.baselineStatus) && !isFlagged(r.candidateStatus)).length,
    newlyBlocked: rows.filter(r => r.baselineStatus !== 'blocked' && r.candidateStatus === 'blocked').length,
    unBlocked:    rows.filter(r => r.baselineStatus === 'blocked' && r.candidateStatus !== 'blocked').length,
  };

  // False-positive proxy from analyst dispositions, restricted to transactions
  // the candidate would flag.
  const flaggedByCandidate = rows.filter(r => isFlagged(r.candidateStatus));
  const falsePositive = {
    confirmedFalsePositive: flaggedByCandidate.filter(r => r.label === 'false_positive').length,
    confirmedTrue:          flaggedByCandidate.filter(r => r.label === 'resolved' || r.label === 'escalated').length,
    unlabeled:              flaggedByCandidate.filter(r => !r.label).length,
  };

  res.json({
    success: true,
    meta: {
      ruleName, windowHours: parseInt(windowHours, 10) || 168, sampleSize: rows.length,
      durationMs: Date.now() - startedAt,
    },
    recorded,
    baseline: baselineSum,
    candidate: candidateSum,
    deltas,
    falsePositive,
    transactions: rows.slice(0, TABLE_CAP),
  });
});

module.exports = { runBacktest };
