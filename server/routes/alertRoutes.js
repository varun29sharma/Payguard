const express = require('express');
const router  = express.Router();
const {
  getAlerts,
  resolveAlert,
  blockUser,
  blockDevice,
  escalateAlert,
  assignCase,
  addNote,
  setPriority,
  transitionCaseStatus,
  getCaseStats,
  getTimeline,
} = require('../controllers/alertController');
const { protect } = require('../middleware/authMiddleware');

router.get('/',                        protect, getAlerts);
router.get('/stats/cases',             protect, getCaseStats);
router.patch('/:id/resolve',           protect, resolveAlert);
router.post('/:id/block-user',         protect, blockUser);
router.post('/:id/block-device',       protect, blockDevice);
router.post('/:id/escalate',           protect, escalateAlert);

// Case management
router.post('/:id/assign',             protect, assignCase);
router.post('/:id/notes',              protect, addNote);
router.patch('/:id/priority',          protect, setPriority);
router.patch('/:id/status',            protect, transitionCaseStatus);
router.get('/:id/timeline',            protect, getTimeline);

module.exports = router;
