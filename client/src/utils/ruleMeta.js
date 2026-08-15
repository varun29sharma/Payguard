// UI metadata for each fraud rule — the engine-side defaults live in
// server/services/ruleConfigService.js and travel with every request.
export const RULE_META = {
  VELOCITY_RULE: {
    description: 'More than N transactions from one user inside the window.',
    params: [
      { key: 'maxTransactions', label: 'Max transactions', type: 'number', step: 1 },
      { key: 'windowSeconds',   label: 'Window (sec)',     type: 'number', step: 1 },
    ],
  },
  ENUMERATION_ATTACK_RULE: {
    description: 'N micro-transactions (≤ amount) from one user inside the window — card testing / enumeration.',
    params: [
      { key: 'microAmountThreshold', label: 'Micro amount ≤ ₹', type: 'number', step: 0.01 },
      { key: 'maxMicroTxns',         label: 'Max micro txns',    type: 'number', step: 1 },
      { key: 'windowSeconds',        label: 'Window (sec)',      type: 'number', step: 1 },
    ],
  },
  AMOUNT_THRESHOLD_RULE: {
    description: 'A single transaction above a high-value threshold.',
    params: [
      { key: 'minAmount', label: 'Min amount (₹)', type: 'number', step: 1 },
    ],
  },
  GEOGRAPHIC_ANOMALY_RULE: {
    description: 'Transactions from 2+ cities inside the window — impossible travel / relay pattern.',
    params: [
      { key: 'windowMinutes', label: 'Window (min)', type: 'number', step: 1 },
    ],
  },
  NEW_DEVICE_RULE: {
    description: 'First transaction from a device the user has never used before.',
    params: [],
  },
  NIGHT_OWL_RULE: {
    description: 'Transactions outside waking hours (local).',
    params: [
      { key: 'startHour', label: 'Start hour', type: 'number', step: 1 },
      { key: 'endHour',   label: 'End hour',   type: 'number', step: 1 },
    ],
  },
};

export const RULE_ORDER = Object.keys(RULE_META);
