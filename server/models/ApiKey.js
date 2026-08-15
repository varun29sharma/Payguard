const mongoose = require("mongoose");

/**
 * API keys for machine-to-machine ingest (payment switches, gateways, or
 * anything POSTing transactions without a human analyst session). Only the
 * bcrypt hash is stored — the plaintext key is shown once at issuance.
 */
const apiKeySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    // bcrypt hash of the full key (e.g. "pg_live_<32 hex chars>").
    keyHash: { type: String, required: true },
    active: { type: Boolean, default: true },
    lastUsedAt: { type: Date },
    createdBy: { type: String },
  },
  { timestamps: true },
);

apiKeySchema.index({ active: 1 });

module.exports = mongoose.model("ApiKey", apiKeySchema);
