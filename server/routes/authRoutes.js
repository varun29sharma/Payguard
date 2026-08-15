const express = require("express");
const router = express.Router();
const { register, login } = require("../controllers/authController");
const { authLimiter } = require("../middleware/rateLimiters");
//testing purpose
// router.post("/register", (req, res) => {
//   res.json({ message: "Express routing is completely fine!" });
// });

// Both endpoints are brute-force targets — strict per-IP limits.
router.post("/register", authLimiter, register);
router.post("/login",    authLimiter, login);

module.exports = router;
