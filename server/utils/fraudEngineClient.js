const axios = require("axios");
// this calls the Spring Boot fraud scoring service and returns a fraudResult.
// If the fraud engine is unavailable, the caller falls back to clear.
const FRAUD_ENGINE_URL = (
  process.env.FRAUD_ENGINE_URL || "http://localhost:8080"
).replace(/\/$/, "");

const callFraudEngine = async (transaction) => {
  const payload = {
    transactionId: transaction.transactionId,
    userId: transaction.userId,
    merchantId: transaction.merchantId,
    amount: transaction.amount,
    timestamp: transaction.timestamp,
    deviceId: transaction.deviceId || "unknown",
    location: transaction.location || {},
  };
  // 3 sec timeout for sending the request; failure means clear.
  const response = await axios.post(
    `${FRAUD_ENGINE_URL}/api/fraud/score`,
    payload,
    { timeout: 3000 },
  );
  return response.data; // { score:72,status:'blocked',rulesTriggered: [...] }
};
module.exports = { callFraudEngine };
