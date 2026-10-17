const mongoose = require("mongoose");
const transactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    merchantId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    location: { city: String, lat: Number, lng: Number },
    deviceId: { type: String, index: true },
    // Extended identity graph fields (Bug #4). All optional — populated as
    // clients start sending them — so existing callers keep working as-is.
    accountId: { type: String, index: true, sparse: true },
    fingerprint: { type: String, index: true, sparse: true },
    sessionId: { type: String, index: true, sparse: true },
    ipAddress: { type: String, index: true, sparse: true },
    walletId: { type: String, index: true, sparse: true },
    email: { type: String, index: true, sparse: true },
    phone: { type: String, index: true, sparse: true },
    // Counterparty of a person-to-person transfer (the account that RECEIVED
    // the funds). Distinct from the payer's identity fields above: used by
    // the mule detector to see money flowing INTO an account, not out.
    beneficiaryId: { type: String, index: true, sparse: true },
    timestamp: { type: Date, default: Date.now, index: true },
    fraudScore: { type: Number, default: 0, index: true },
    fraudStatus: {
      type: String,
      // 'rejected' = transaction touched an already-blocked entity (Bug #1/#2);
      // it is never deleted, only marked rejected — see BlockedActivityLog.
      enum: ["clear", "review", "blocked", "rejected"],
      default: "clear",
      index: true,
    },
    rulesTriggered: [{ ruleName: String, score: Number, reason: String }],
    // Whether this transaction was scored by the real Java fraud engine or
    // by the clear-score fallback (engine unreachable). Lets analysts see at
    // a glance which records carry real signals vs. unscored traffic.
    scoringEngine: { type: String, enum: ['engine', 'fallback'], default: 'engine' },
    // Set when a dispute/chargeback confirms this transaction was fraud. The
    // ground truth that powers per-rule detection-rate reporting — see
    // services/disputeService.js and the Dispute model.
    isConfirmedFraud: { type: Boolean, default: false, index: true },
    disputeReason: { type: String },
    disputedAt: { type: Date },

    // --- ML shadow layer (Phase 1) ---------------------------------------
    // The model's opinion is recorded on every transaction while the RULES
    // keep deciding — a live A/B on real traffic at zero risk. `mlEngine`
    // mirrors `scoringEngine`: a system that is degraded says so.
    mlScore: { type: Number, default: null, index: true }, // calibrated P(fraud), 0–1
    mlVersion: { type: String },
    mlEngine: {
      type: String,
      // 'model'    — scored, mlScore is calibrated
      // 'skipped'  — model present but this request carried no feature vector
      // 'fallback' — no model loaded
      // 'disabled' — feature computation unavailable for this transaction
      enum: ['model', 'skipped', 'fallback', 'disabled'],
      default: 'disabled',
      index: true,
    },
    // WHICH ml engine produced the score. `mlEngine` says whether one did;
    // `mlSource` says which, because two honest implementations exist: the
    // LightGBM sidecar (Phase 2), and the logistic model embedded in the Java
    // engine (Phase 1) which is also the fallback when the sidecar is down.
    mlSource: {
      type: String,
      enum: ['sidecar', 'engine', 'none'],
      default: 'none',
    },
    // How long the sidecar took, so the dashboard can show the ML latency
    // budget being spent rather than asserting it is fine.
    mlLatencyMs: { type: Number, default: null },
    // Exact per-feature w_i * x_i terms (top 5 by magnitude). A linear model
    // gives exact explainability for free, which keeps the product promise
    // that every decision arrives with reasons.
    mlContributions: [{ feature: String, value: Number, weight: Number, contribution: Number }],
  },
  { timestamps: true },
);

// Review-queue listing (fraudStatus filter + recency) is the hottest query
// in the app — compound index keeps it off a full collection scan.
transactionSchema.index({ fraudStatus: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
