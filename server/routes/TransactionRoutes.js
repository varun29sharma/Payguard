const express = require("express");
const router = express.Router();
const {
  createTransaction,
  getTransactions,
  getStats,
} = require("../controllers/transactionController");

const { protect } = require("../middleware/authMiddleware");

router.post("/", createTransaction);
router.get("/", protect, getTransactions);
router.get("/stats", protect, getStats);

module.exports = router;
