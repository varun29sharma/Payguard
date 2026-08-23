/**
 * graphRoutes.js — identity graph explorer.
 *
 *   POST /api/graph/build      build graph from seed identifiers
 *   GET  /api/graph/search     search for identifier values
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { build, search, entitySummary } = require('../controllers/graphController');

router.post('/build',            protect, build);
router.get('/search',            protect, search);
router.get('/entity/:type/:value', protect, entitySummary);

module.exports = router;
