/**
 * muleRoutes.js — mule-account laundering rings.
 *
 *   GET  /api/mules              rings + aggregate stats
 *   POST /api/mules/:ringId/block  freeze every account in the ring
 */
const express = require('express');
const router  = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { list, block } = require('../controllers/muleController');

router.get('/',             protect, list);
router.post('/:ringId/block', protect, block);

module.exports = router;
