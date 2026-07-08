const express = require('express');
const router  = express.Router();
const {
  getAlerts,
  resolveAlert,
  blockUser,
  blockDevice,
  escalateAlert,
} = require('../controllers/alertController');
const { protect } = require('../middleware/authMiddleware');

router.get('/',                        protect, getAlerts);
router.patch('/:id/resolve',           protect, resolveAlert);
router.post('/:id/block-user',         protect, blockUser);
router.post('/:id/block-device',       protect, blockDevice);
router.post('/:id/escalate',           protect, escalateAlert);

module.exports = router;
