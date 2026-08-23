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

module.exports = { buildGraph, searchIdentifiers, NODE_COLORS };
