const { buildGraph, getEntitySummary } = require('../services/graphService');
const { asyncHandler } = require('../middleware/errorHandler');
const { ValidationError } = require('../utils/errors');
const { IDENTITY_FIELDS } = require('../services/identityGraphService');

// POST /api/graph/search-routes — the Phase 3 smart path.
//
// The identity graph explorer already walks shared transactions (identityGraphService
// / graphService). That is an *unweighted* reachability question, and BFS is correct
// for it. But the investigator actually asks a *shortest-path* question:
//
//   "How is THIS account connected to a known ring, and which route is most
//    suspicious?" — a shortest path on a *weighted* graph where edge cost reflects
//    how risky a link is (shared device = strong evidence; shared IP = could be a
//    coffee shop or a CGNAT range).
//
// This endpoint emits the weighted, directed, non-negative edge model and hands it
// to Node as a /search route. The search itself runs in the Python package
// (search/problem.py WeightedGraph + informed.a_star_search), so GraphExplorer
// stays the only client of the search algorithms and the same weighted graph the
// Phase 3 code uses is the graph the candidate paths are judged on.
//
// Edge cost = 1 + (0.25 * suspicious) so it is always >= 1: hop-count-to-target is
// then *admissible* (it never overestimates the true risk cost) and A* is optimal
// on a graph without re-expansion. See search/problem.py WeightedGraph docstring
// for the reasoning; edge costs below 1 break admissibility.

const { searchWeightedPath } = require('../services/searchRouteService');

// POST /api/graph/path
// Body: { from: { type, value }, to: { type, value }, maxHops, maxPaths }
const build = asyncHandler(async (req, res) => {
  const { from, to, maxHops, maxPaths } = req.body || {};

  if (!from || !to || typeof from.type !== 'string' || typeof to.type !== 'string') {
    throw new ValidationError('body must contain { from: { type, value }, to: { type, value } }');
  }
  if (!from.value || !to.value) {
    throw new ValidationError('from.value and to.value are required');
  }
  if (maxHops && (maxHops < 1 || maxHops > 50)) {
    throw new ValidationError('maxHops must be between 1 and 50');
  }
  if (maxPaths && maxPaths < 1) {
    throw new ValidationError('maxPaths must be >= 1');
  }

  const result = await searchWeightedPath({
    from: { type: from.type, value: String(from.value) },
    to: { type: to.value, value: String(to.value) },
    maxHops: Math.min(Math.max(parseInt(maxHops) || 25, 1), 50),
    maxPaths: Math.min(Math.max(parseInt(maxPaths) || 1, 1), 50),
  });

  res.json({
    success: true,
    data: result,
    // `engine` is set by the Python search, not by us: weighted-graph / A* / aStar.
    // It is the same string the phase-level compare.py prints, so a reader of the
    // codebase sees one thing — the Python package is the source of truth for all
    // search versions (BFS, A*, Dijkstra, IDA*, etc.), and the UI is a thin view.
    method: result.engine || 'aStar',
  });
});

module.exports = { build };
