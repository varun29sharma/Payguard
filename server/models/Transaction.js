const mongoose = require("mongoose");
const transactionSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, unique: true },
    userId: { type: String, required: true, index: true },
    merchantId: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    location: { city: String, lat: Number, lng: Number },
    deviceId: { type: String },
    timestamp: { type: Date, default: Date.now, index: true },
    fraudScore: { type: Number, default: 0 },
    fraudStatus: {
      type: String,
      enum: ["clear", "review", "blocked"],
      default: "clear",
    },
    rulesTriggered: [{ ruleName: String, score: Number }],
  },
  { timestamps: true },
);
module.exports = mongoose.model("Transaction", transactionSchema);
