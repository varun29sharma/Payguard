const express = require("express");
const router = express.Router();
const { register, login } = require("../controllers/authController");
//testing purpose
// router.post("/register", (req, res) => {
//   res.json({ message: "Express routing is completely fine!" });
// });

router.post("/register", register);
router.post("/login", login);

module.exports = router;
