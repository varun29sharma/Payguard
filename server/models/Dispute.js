const mongoose = require("mongoose");

/**
 * Dispute — the ground-truth signal that closes the detection loop.
 * A cardholder/issuer dispute is external confirmation that a transaction
 * WAS fraud (or a chargeback was filed for another reason). Ingesting one
 * labels the underlying transaction as confirmed fraud, which lets the
 * platform report per-rule detection rates: of the fraud we now know about,
 * how much did each rule actually catch at scoring time?
 *
 * `fraudConfirmed` is derived at ingest: fraud-type reasons (unauthorized,
 * stolen card, account takeover) and disputes lost by the merchant both mean
 * the money was fraudulently taken.
 */
const disputeSchema = new mongoose.Schema(
  {
    transactionId: { type: String, required: true, index: true },
    // Reason the cardholder/issuer gave for the dispute.
    reason: { type: String, required: true },
    status: { type: String, enum: ['open', 'won', 'lost', 'closed'], default: 'open' },
    amount: { type: Number, min: 0 },
    notes: { type: String },
    // Derived at ingest — see FRAUD_REASONS in disputeService.
    fraudConfirmed: { type: Boolean, default: false, index: true },
    filedBy: { type: String, default: 'api' }, // analyst email or API-key name
  },
  { timestamps: true },
);

disputeSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Dispute", disputeSchema);
