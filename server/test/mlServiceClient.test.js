#!/usr/bin/env node
/**
 * mlServiceClient.test.js — the sidecar client must fail *quietly and honestly*.
 *
 * The property that matters for an authorisation path is not "the model
 * responds" but "when it doesn't, nothing breaks and the record says so".
 * Run:  node server/test/mlServiceClient.test.js
 */

'use strict';

process.env.ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:9'; // nothing listens

const assert = require('assert');
const { scoreWithMlService, checkMlServiceHealth } = require('../utils/mlServiceClient');

async function main() {
  // 1. No features -> short-circuit, no request made.
  const empty = await scoreWithMlService([], { timeoutMs: 50 });
  assert.strictEqual(empty.ok, false);
  assert.match(empty.reason, /no feature vector/);

  // 2. Unreachable service -> resolves (never throws) with ok:false and a reason.
  const dead = await scoreWithMlService([1, 2, 3], { timeoutMs: 200 });
  assert.strictEqual(dead.ok, false, 'a dead sidecar must not raise');
  assert.ok(dead.reason, 'the failure must carry a reason to record');
  assert.ok(Number.isFinite(dead.latencyMs), 'latency is always reported');

  // 3. Health probe likewise never throws.
  const health = await checkMlServiceHealth();
  assert.strictEqual(health.up, false);
  assert.ok(typeof health.reason === 'string' || health.reason === null);

  console.log('PASS: ml service client degrades honestly (ok:false + reason, never throws)');
}

main().catch((err) => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
