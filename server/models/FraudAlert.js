const mongoose = require("mongoose");
const fraudAlertSchema = new mongoose.Schema(
  {
    transaction: { type: mongoose.Schema.Types.ObjectId, required: true },
    userId: { type: String, required: true },
    fraudScore: { type: Number, required: true },
    status: {
      type: String,
      enum: ["open", "resolved", "false_positive"],
      default: "open",
    },
    rulesTriggered: [{ ruleName: String, score: Number }],
    resolvedBy: { type: String },
  },
  { timestamps: true },
);
module.exports = mongoose.model("FraudAlert", fraudAlertSchema);
