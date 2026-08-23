/**
 * graphController.js — identity graph explorer endpoints.
 *
 *   POST /api/graph/build      build graph from seed identifiers
 *   GET  /api/graph/search     search for identifier values
 */
const { buildGraph, searchIdentifiers, getEntitySummary } = require('../services/graphService');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError } = require('../utils/errors');
const { IDENTITY_FIELDS } = require('../services/identityGraphService');

// POST /api/graph/build
const build = asyncHandler(async (req, res) => {
  const { seed, depth, maxNodes, includeTransactions } = req.body;

  if (!seed || typeof seed !== 'object') {
    throw new ValidationError('seed must be an object with at least one identifier field');
  }

  const validSeed = {};
  for (const [key, val] of Object.entries(seed)) {
    if (IDENTITY_FIELDS.includes(key) && val && typeof val === 'string') {
      validSeed[key] = val;
    }
  }
  if (Object.keys(validSeed).length === 0) {
    throw new ValidationError(`seed must contain at least one of: ${IDENTITY_FIELDS.join(', ')}`);
  }

  const graph = await buildGraph(validSeed, {
    depth: Math.min(Math.max(parseInt(depth) || 2, 1), 4),
    maxNodes: Math.min(Math.max(parseInt(maxNodes) || 200, 10), 500),
    includeTransactions: includeTransactions !== false,
  });

  res.json({ success: true, data: graph });
});

// GET /api/graph/search
const search = asyncHandler(async (req, res) => {
  const { q } = req.query;
  if (!q || String(q).length < 2) {
    throw new ValidationError('q (query) must be at least 2 characters');
  }
  const results = await searchIdentifiers(String(q), parseInt(req.query.limit) || 20);
  res.json({ success: true, data: results });
});

// GET /api/graph/entity/:type/:value
const entitySummary = asyncHandler(async (req, res) => {
  const { type, value } = req.params;
  const summary = await getEntitySummary(type, value);
  if (!summary) throw new ValidationError('Entity not found or no transactions');
  res.json({ success: true, data: summary });
});

module.exports = { build, search, entitySummary };
