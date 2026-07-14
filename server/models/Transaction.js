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
  },
  { timestamps: true },
);

// Review-queue listing (fraudStatus filter + recency) is the hottest query
// in the app — compound index keeps it off a full collection scan.
transactionSchema.index({ fraudStatus: 1, createdAt: -1 });

module.exports = mongoose.model("Transaction", transactionSchema);
