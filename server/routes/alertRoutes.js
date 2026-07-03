const express = require("express");
const router = express.Router();
const { protect } = require("../middleware/authMiddleware");
const FraudAlert = require("../models/FraudAlert");

// GET /api/alerts
router.get("/", protect, async (req, res) => {
  try {
    const alerts = await FraudAlert.find().sort({ createdAt: -1 });
    res.json({ success: true, data: alerts });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// PATCH /api/alerts/:id/resolve
router.patch("/:id/resolve", protect, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["resolved", "false_positive"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    const alert = await FraudAlert.findById(req.params.id);
    if (!alert) {
      return res.status(404).json({ message: "Alert not found" });
    }
    alert.status = status;
    alert.resolvedBy = req.user?.id || "system";
    await alert.save();
    res.json({ success: true, data: alert });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;
