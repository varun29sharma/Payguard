/**
 * apiKeyAuth.js — machine-to-machine authentication for the transaction
 * ingest surface.
 *
 * Real payment switches don't hold analyst JWTs; they authenticate with an
 * API key sent in the `x-api-key` header. `protectOrApiKey` accepts either:
 *   - a valid analyst JWT (Bearer token, used by the browser/simulator), or
 *   - an active API key (x-api-key header, used by integrations).
 * This keeps the analyst UI working while making the ingest surface usable —
 * and auditable — by external systems.
 */
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const ApiKey = require("../models/ApiKey");

const extractBearer = (req) => {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
};

const verifyJwt = async (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id).select("-password");
  return user || null;
};

const verifyApiKey = async (provided) => {
  if (!provided || typeof provided !== "string") return null;
  const keys = await ApiKey.find({ active: true }).lean();
  for (const k of keys) {
    if (await bcrypt.compare(provided, k.keyHash)) {
      // Cheap touch so operators can see which keys are actually in use.
      ApiKey.updateOne({ _id: k._id }, { lastUsedAt: new Date() }).catch(() => {});
      return k;
    }
  }
  return null;
};

/**
 * Requires EITHER a valid analyst JWT or an active API key. Attaches:
 *   req.user  — when authenticated via JWT,
 *   req.apiKey — when authenticated via x-api-key.
 */
const protectOrApiKey = async (req, res, next) => {
  const token = extractBearer(req);
  if (token) {
    try {
      const user = await verifyJwt(token);
      if (user) {
        req.user = user;
        return next();
      }
    } catch (err) {
      // fall through to API-key path
    }
  }

  const apiKey = await verifyApiKey(req.headers["x-api-key"]);
  if (apiKey) {
    req.apiKey = apiKey;
    return next();
  }

  return res.status(401).json({
    success: false,
    message: "Not authorised — provide a Bearer token or x-api-key",
  });
};

/** API-key-only guard (for endpoints that integrations but not analysts touch). */
const apiKeyOnly = async (req, res, next) => {
  const apiKey = await verifyApiKey(req.headers["x-api-key"]);
  if (apiKey) {
    req.apiKey = apiKey;
    return next();
  }
  return res.status(401).json({ success: false, message: "Not authorised — valid x-api-key required" });
};

module.exports = { protectOrApiKey, apiKeyOnly };
