const jwt = require("jsonwebtoken");
const User = require("../models/User");

const protect = async (req, res, next) => {
  let token;

  if (
    //JWT is sent in the authroization header as "Bearer e2tygqwhdjknsa...."
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }
  if (!token) {
    return res.status(401).json({ message: "Not authorised — no token" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attach user to request object
    req.user = await User.findById(decoded.id).select("-password");
    // Guard against valid tokens from deleted/non-existent users
    if (!req.user) {
      return res
        .status(401)
        .json({ message: "Not authorised — user no longer exists" });
    }
    next();
  } catch (error) {
    res.status(401).json({ message: "Not authorised — invalid token" });
  }
};

module.exports = { protect };
