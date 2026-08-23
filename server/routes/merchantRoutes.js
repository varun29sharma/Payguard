/**
 * merchantRoutes.js — merchant risk profile endpoints.
 *
 *   GET  /api/merchants          list merchants with filters
 *   GET  /api/merchants/stats    aggregate risk statistics
 *   GET  /api/merchants/mcc      MCC distribution
 *   GET  /api/merchants/:id      single merchant with analytics
 *   PATCH /api/merchants/:id     update merchant notes / status
 */
const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { list, stats, mccDistribution, get, update } = require('../controllers/merchantController');

router.get('/stats',  protect, stats);
router.get('/mcc',    protect, mccDistribution);
router.get('/',       protect, list);
router.get('/:id',    protect, get);
router.patch('/:id',  protect, update);

module.exports = router;
