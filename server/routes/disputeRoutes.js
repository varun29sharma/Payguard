/**
 * disputeRoutes.js — dispute/chargeback loop.
 *
 *   POST /api/disputes           ingest a dispute (JWT or API key)
 *   GET  /api/disputes           recent disputes
 *   GET  /api/disputes/detection per-rule detection rates over confirmed fraud
 */
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { protectOrApiKey } = require('../middleware/apiKeyAuth');
const { ingest, list, detection } = require('../controllers/disputeController');

router.post('/',          protectOrApiKey, ingest);
router.get('/',           protect, list);
router.get('/detection',  protect, detection);

module.exports = router;
