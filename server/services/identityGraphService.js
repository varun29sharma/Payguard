const Transaction = require('../models/Transaction');

// Every identifier type PayGuard understands. Adding a new identifier type
// (e.g. a new payment rail's wallet id) means adding it here + to the
// BlockList `type` enum — nowhere else.
const IDENTITY_FIELDS = ['userId', 'deviceId', 'accountId', 'fingerprint', 'sessionId', 'ipAddress', 'walletId', 'email', 'phone'];
const IGNORED_VALUES = new Set([undefined, null, '', 'unknown']);

const extractIdentifiers = (source) => {
  const identifiers = {};
  for (const field of IDENTITY_FIELDS) {
    const value = source?.[field];
    if (!IGNORED_VALUES.has(value)) identifiers[field] = String(value);
  }
  return identifiers;
};

/**
 * Bug #4 fix — Fragmented Entity Blocking.
 *
 * Breadth-first traversal across Transactions: starting from the seed
 * identifiers, repeatedly pull in every other identifier that ever appeared
 * on the same transaction, until no new identifiers are discovered (a fixed
 * point) or `maxIterations` is hit. This is what lets "block this user" also
 * catch the device, IP, and card fingerprint that user's fraud ring shares
 * with other accounts — instead of leaving those other accounts free to keep
 * transacting.
 */
const buildConnectedIdentifiers = async (seedIdentifiers, { maxIterations = 5 } = {}) => {
  const known = new Map(); // field -> Set(values)
  const addAll = (identifiers) => {
    let added = false;
    for (const [field, value] of Object.entries(identifiers)) {
      if (!IDENTITY_FIELDS.includes(field) || IGNORED_VALUES.has(value)) continue;
      if (!known.has(field)) known.set(field, new Set());
      if (!known.get(field).has(value)) {
        known.get(field).add(value);
        added = true;
      }
    }
    return added;
  };

  addAll(seedIdentifiers);
  if (known.size === 0) return known;

  for (let i = 0; i < maxIterations; i++) {
    const or = [];
    for (const [field, values] of known.entries()) or.push({ [field]: { $in: [...values] } });
    if (!or.length) break;

    const matches = await Transaction.find({ $or: or }).select(IDENTITY_FIELDS.join(' ')).lean();

    let changed = false;
    for (const match of matches) {
      if (addAll(extractIdentifiers(match))) changed = true;
    }
    if (!changed) break;
  }

  return known;
};

const identifiersToPairs = (identifierMap) => {
  const pairs = [];
  for (const [type, values] of identifierMap.entries()) {
    for (const value of values) pairs.push({ type, value });
  }
  return pairs;
};

const matchAnyIdentifierQuery = (identifierMap) => {
  const or = [];
  for (const [field, values] of identifierMap.entries()) {
    if (IDENTITY_FIELDS.includes(field) && values.size) or.push({ [field]: { $in: [...values] } });
  }
  return or.length ? { $or: or } : null;
};

module.exports = {
  IDENTITY_FIELDS,
  extractIdentifiers,
  buildConnectedIdentifiers,
  identifiersToPairs,
  matchAnyIdentifierQuery,
};
