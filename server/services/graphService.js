/**
 * graphService.js — identity graph export for force-directed visualization.
 *
 * Builds a graph of connected identifiers (users ↔ devices ↔ IPs ↔ fingerprints
 * etc.) by traversing shared transactions. Returns nodes + edges suitable for
 * D3-force rendering.
 */
const Transaction = require('../models/Transaction');
const BlockList = require('../models/BlockList');
const FraudAlert = require('../models/FraudAlert');
const { IDENTITY_FIELDS } = require('./identityGraphService');

const NODE_COLORS = {
  userId:      '#6366f1', // indigo
  deviceId:    '#f59e0b', // amber
  ipAddress:   '#10b981', // emerald
  fingerprint: '#ec4899', // pink
  accountId:   '#8b5cf6', // violet
  sessionId:   '#06b6d4', // cyan
  walletId:    '#f97316', // orange
  email:       '#ef4444', // red
  phone:       '#14b8a6', // teal
  transaction: '#64748b', // slate
};

/**
 * Build graph starting from seed identifiers, expanding outward via shared
 * transactions. Returns { nodes, edges } for D3-force layout.
 *
 * @param {Object} seedIdentifiers - e.g. { userId: 'USER_1' }
 * @param {Object} opts - { depth: 2, maxNodes: 200, includeTransactions: true }
 */
const buildGraph = async (seedIdentifiers, { depth = 2, maxNodes = 200, includeTransactions = true } = {}) => {
  const nodes = new Map(); // `${type}:${value}` -> node
  const edges = [];        // { source, target, type, transactionId?, amount? }
  const visitedTxns = new Set();

  // Seed from the provided identifiers
  for (const [type, value] of Object.entries(seedIdentifiers)) {
    if (!IDENTITY_FIELDS.includes(type) || !value) continue;
    const id = `${type}:${value}`;
    if (!nodes.has(id)) {
      nodes.set(id, { id, type, value, txCount: 0, fraudScore: 0, blocked: false, flagged: false });
    }
  }

  if (nodes.size === 0) return { nodes: [], edges: [] };

  // BFS expansion
  for (let iter = 0; iter < depth; iter++) {
    if (nodes.size >= maxNodes) break;

    // Collect all identifier values to query
    const queryParts = [];
    for (const [nodeId, node] of nodes.entries()) {
      const nodeType = nodeId.split(':')[0];
      if (IDENTITY_FIELDS.includes(nodeType)) {
        queryParts.push({ [nodeType]: node.value });
      }
    }
    if (!queryParts.length) break;

    // Find transactions matching any known identifier
    const txns = await Transaction.find({ $or: queryParts })
      .sort({ createdAt: -1 })
      .limit(Math.max(100, maxNodes * 2))
      .select(`${IDENTITY_FIELDS.join(' ')} transactionId amount fraudScore fraudStatus createdAt`)
      .lean();

    let added = false;
    for (const txn of txns) {
      if (visitedTxns.has(txn.transactionId)) continue;
      visitedTxns.add(txn.transactionId);

      // Collect all identifiers on this transaction
      const txnIdentifiers = [];
      for (const field of IDENTITY_FIELDS) {
        const val = txn[field];
        if (val && val !== 'unknown' && val !== '') {
          txnIdentifiers.push(`${field}:${val}`);
        }
      }

      // Add transaction node if requested
      if (includeTransactions && nodes.size < maxNodes) {
        const txnNodeId = `transaction:${txn.transactionId}`;
        if (!nodes.has(txnNodeId)) {
          nodes.set(txnNodeId, {
            id: txnNodeId,
            type: 'transaction',
            value: txn.transactionId.slice(0, 8),
            txCount: 1,
            fraudScore: txn.fraudScore || 0,
            amount: txn.amount,
            fraudStatus: txn.fraudStatus,
            timestamp: txn.createdAt,
            blocked: false,
            flagged: txn.fraudStatus !== 'clear',
          });
          // Connect each identifier to the transaction node
          for (const nid of txnIdentifiers) {
            if (nodes.has(nid)) {
              edges.push({ source: nid, target: txnNodeId, type: 'transacted' });
            }
          }
          added = true;
        }
      }

      // Add identifier nodes + edges between them
      for (let i = 0; i < txnIdentifiers.length; i++) {
        const a = txnIdentifiers[i];
        if (!nodes.has(a) && nodes.size < maxNodes) {
          const [aType, ...aValParts] = a.split(':');
          const aVal = aValParts.join(':');
          nodes.set(a, { id: a, type: aType, value: aVal, txCount: 0, fraudScore: 0, blocked: false, flagged: false });
          added = true;
        }

        // Edge between identifier and transaction
        if (includeTransactions && nodes.has(`transaction:${txn.transactionId}`)) {
          // Already added above
        }

        // Edges between co-occurring identifiers
        for (let j = i + 1; j < txnIdentifiers.length; j++) {
          const b = txnIdentifiers[j];
          if (!nodes.has(b) && nodes.size < maxNodes) {
            const [bType, ...bValParts] = b.split(':');
            const bVal = bValParts.join(':');
            nodes.set(b, { id: b, type: bType, value: bVal, txCount: 0, fraudScore: 0, blocked: false, flagged: false });
            added = true;
          }
          // Add edge if both exist and not already present
          if (nodes.has(a) && nodes.has(b)) {
            const edgeKey = [a, b].sort().join('|');
            if (!edges.find(e => [`${e.source}`, `${e.target}`].sort().join('|') === edgeKey)) {
              edges.push({ source: a, target: b, type: 'shared_txn', transactionId: txn.transactionId, amount: txn.amount });
            }
          }
        }
      }
    }

    if (!added) break;
  }

  // Enrich nodes with blocked/flagged status
  const nodeValues = new Map();
  for (const [id, node] of nodes) {
    if (node.type === 'transaction') continue;
    if (!nodeValues.has(node.type)) nodeValues.set(node.type, []);
    nodeValues.get(node.type).push(node.value);
  }

  // Check blocklist
  const blockQuery = [];
  for (const [type, values] of nodeValues) {
    if (IDENTITY_FIELDS.includes(type) && values.length) {
      blockQuery.push({ type, value: { $in: values } });
    }
  }
  if (blockQuery.length) {
    const blocked = await BlockList.find({ $or: blockQuery, isActive: true }).select('type value').lean();
    for (const b of blocked) {
      const nodeId = `${b.type}:${b.value}`;
      if (nodes.has(nodeId)) nodes.get(nodeId).blocked = true;
    }
  }

  // Check fraud alerts
  const alertQuery = [];
  for (const [type, values] of nodeValues) {
    if (IDENTITY_FIELDS.includes(type) && values.length) {
      alertQuery.push({ [type]: { $in: values } });
    }
  }
  if (alertQuery.length) {
    const alerts = await FraudAlert.find({ $or: alertQuery, status: { $in: ['open', 'investigating', 'escalated'] } })
      .select('userId deviceId ipAddress fingerprint accountId')
      .lean();
    for (const alert of alerts) {
      for (const field of IDENTITY_FIELDS) {
        if (alert[field]) {
          const nodeId = `${field}:${alert[field]}`;
          if (nodes.has(nodeId)) nodes.get(nodeId).flagged = true;
        }
      }
    }
  }

  // Update transaction counts per identifier
  for (const edge of edges) {
    const srcId = typeof edge.source === 'object' ? edge.source.id : edge.source;
    const tgtId = typeof edge.target === 'object' ? edge.target.id : edge.target;
    if (srcId && nodes.has(srcId)) nodes.get(srcId).txCount = (nodes.get(srcId).txCount || 0) + 1;
    if (tgtId && nodes.has(tgtId)) nodes.get(tgtId).txCount = (nodes.get(tgtId).txCount || 0) + 1;
  }

  return {
    nodes: [...nodes.values()],
    edges,
    stats: {
      totalNodes: nodes.size,
      identifierNodes: [...nodes.values()].filter(n => n.type !== 'transaction').length,
      transactionNodes: [...nodes.values()].filter(n => n.type === 'transaction').length,
      edges: edges.length,
      blocked: [...nodes.values()].filter(n => n.blocked).length,
      flagged: [...nodes.values()].filter(n => n.flagged).length,
    },
  };
};

/**
 * Quick search: find transactions matching a partial identifier value.
 */
const searchIdentifiers = async (query, limit = 20) => {
  if (!query || query.length < 2) return [];

  const regex = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const or = IDENTITY_FIELDS.map(field => ({ [field]: regex }));

  const txns = await Transaction.find({ $or: or })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select(`${IDENTITY_FIELDS.join(' ')} transactionId amount fraudScore fraudStatus`)
    .lean();

  const results = new Map();
  for (const txn of txns) {
    for (const field of IDENTITY_FIELDS) {
      const val = txn[field];
      if (val && regex.test(val)) {
        const key = `${field}:${val}`;
        if (!results.has(key)) {
          results.set(key, {
            type: field,
            value: val,
            sampleTxn: txn.transactionId,
            fraudScore: txn.fraudScore,
            fraudStatus: txn.fraudStatus,
          });
        }
      }
    }
  }

  return [...results.values()].slice(0, limit);
};

/**
 * Get a rich summary for a specific entity (identifier node) in the graph.
 * Includes transaction history, risk metrics, connected entities, and timeline.
 */
const getEntitySummary = async (type, value) => {
  if (!IDENTITY_FIELDS.includes(type) || !value) return null;

  // Find all transactions for this entity
  const txns = await Transaction.find({ [type]: value })
    .sort({ createdAt: -1 })
    .limit(100)
    .select(`${IDENTITY_FIELDS.join(' ')} transactionId amount fraudScore fraudStatus createdAt merchantId`) // noSON
    .lean();

  if (!txns.length) return null;

  // Aggregate metrics
  const totalAmount = txns.reduce((sum, t) => sum + (t.amount || 0), 0);
  const flaggedCount = txns.filter(t => t.fraudStatus !== 'clear').length;
  const blockedCount = txns.filter(t => t.fraudStatus === 'blocked').length;
  const avgScore = txns.length ? Math.round(txns.reduce((sum, t) => sum + (t.fraudScore || 0), 0) / txns.length) : 0;
  const maxScore = Math.max(...txns.map(t => t.fraudScore || 0));

  // Unique counterparties (other identifiers on same transactions)
  const counterparties = new Map();
  for (const txn of txns) {
    for (const field of IDENTITY_FIELDS) {
      if (field !== type && txn[field]) {
        const key = `${field}:${txn[field]}`;
        counterparties.set(key, { type: field, value: txn[field], count: (counterparties.get(key)?.count || 0) + 1 });
      }
    }
  }

  // Unique merchants
  const merchants = new Map();
  for (const txn of txns) {
    if (txn.merchantId) merchants.set(txn.merchantId, (merchants.get(txn.merchantId) || 0) + 1);
  }

  // Hourly distribution
  const hourly = new Array(24).fill(0);
  txns.forEach(t => { hourly[new Date(t.createdAt).getHours()]++; });
  const peakHour = hourly.indexOf(Math.max(...hourly));

  // Time range
  const firstSeen = txns[txns.length - 1]?.createdAt;
  const lastSeen = txns[0]?.createdAt;

  // Check blocklist status
  const blockEntry = await BlockList.findOne({ type, value, isActive: true }).lean();

  // Check fraud alerts
  const alertQuery = { [type]: value, status: { $in: ['open', 'investigating', 'escalated'] } };
  const alerts = await FraudAlert.find(alertQuery).select('fraudScore status priority createdAt').lean();

  // Risk assessment
  let riskLevel = 'low';
  if (blockEntry || maxScore >= 80) riskLevel = 'critical';
  else if (alerts.length > 0 || maxScore >= 60) riskLevel = 'high';
  else if (flaggedCount > 0 || avgScore >= 30) riskLevel = 'medium';

  return {
    type,
    value,
    summary: {
      totalTransactions: txns.length,
      totalAmount,
      flaggedCount,
      blockedCount,
      clearCount: txns.length - flaggedCount - blockedCount,
      avgScore,
      maxScore,
      uniqueCounterparties: counterparties.size,
      uniqueMerchants: merchants.size,
      peakHour,
      firstSeen,
      lastSeen,
    },
    riskLevel,
    blockStatus: blockEntry ? { reason: blockEntry.reason, blockedBy: blockEntry.blockedBy, blockedAt: blockEntry.createdAt } : null,
    activeAlerts: alerts.map(a => ({ score: a.fraudScore, status: a.status, priority: a.priority, createdAt: a.createdAt })),
    topCounterparties: [...counterparties.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    topMerchants: [...merchants.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id, count]) => ({ merchantId: id, count })),
    hourlyDistribution: hourly,
    recentTransactions: txns.slice(0, 10).map(t => ({
      transactionId: t.transactionId,
      amount: t.amount,
      fraudScore: t.fraudScore,
      fraudStatus: t.fraudStatus,
      merchantId: t.merchantId,
      timestamp: t.createdAt,
    })),
  };
};

module.exports = { buildGraph, searchIdentifiers, getEntitySummary, NODE_COLORS };
