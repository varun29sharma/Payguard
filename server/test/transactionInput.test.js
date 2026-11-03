/**
 * transactionInput.test.js — tests for the validation step of the pipeline.
 *
 * buildTransactionInput() is a pure function (no database, no network), so
 * it can be tested directly: give it a request body, check the object it
 * builds or the error it throws. Run with: npm test
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { buildTransactionInput } = require('../services/transactionService');

test('builds a clean input from a valid body', () => {
  const input = buildTransactionInput({ userId: 'U1', merchantId: 'M1', amount: '500', deviceId: 'D1' });
  assert.equal(input.userId, 'U1');
  assert.equal(input.amount, 500); // string amount is converted to a number
  assert.equal(input.currency, 'INR'); // default currency
  assert.equal(input.deviceId, 'D1');
  assert.ok(input.timestamp instanceof Date); // no timestamp given -> now
});

test('rejects a missing required field', () => {
  assert.throws(() => buildTransactionInput({ merchantId: 'M1', amount: 100 }), /userId is required/);
});

test('rejects a negative amount', () => {
  assert.throws(() => buildTransactionInput({ userId: 'U1', merchantId: 'M1', amount: -5 }), /amount must be/);
});

test('rejects a timestamp in the future', () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.throws(
    () => buildTransactionInput({ userId: 'U1', merchantId: 'M1', amount: 100, timestamp: future }),
    /timestamp cannot be in the future/,
  );
});

test('keeps beneficiaryId separate from the payer identity fields', () => {
  const input = buildTransactionInput({ userId: 'U1', merchantId: 'M1', amount: 100, beneficiaryId: 'U9' });
  assert.equal(input.beneficiaryId, 'U9');
});
