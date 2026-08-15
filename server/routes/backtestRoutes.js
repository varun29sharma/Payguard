/**
 * backtestRoutes.js — replay harness for rule changes.
 *
 *   POST /api/backtest
 *     body: { ruleName, changes: { enabled?, score?, parameters? },
 *             windowHours?, limit? }
 *   Replays the historical stream under the current config and the proposed
 *   config, and reports detection deltas + a false-positive proxy derived
 *   from analyst alert dispositions.
 */
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { runBacktest } = require('../controllers/backtestController');

router.post('/', protect, runBacktest);

module.exports = router;
