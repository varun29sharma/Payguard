#!/usr/bin/env node
/**
 * featureParity.test.js — the golden-fixture guard against training/serving skew.
 *
 * Features are computed in two places by necessity: Python offline (to train)
 * and Node online (to serve). If those two disagree, the model is scored on
 * features it was never trained on and every metric the README quotes becomes a
 * lie — silently. This test replays `ml/artifacts/golden_features.json`
 * through the Node implementation and asserts it reproduces the expected vector
 * for every row.
 *
 * Run:  node server/test/featureParity.test.js
 * (Kept as a dependency-free script because the server package has no test
 * runner, and a guard nobody can run is not a guard.)
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { computeFeatures } = require('../services/featureService');

const FIXTURE = path.join(__dirname, '..', '..', 'ml', 'artifacts', 'golden_features.json');
const TOLERANCE = 1e-9;
const DAYS_30_MS = 30 * 24 * 3600 * 1000;

function fail(message) {
  console.error('FAIL: ' + message);
  process.exitCode = 1;
}

function main() {
  if (!fs.existsSync(FIXTURE)) {
    fail('golden fixture not found at ' + FIXTURE +
         ' — run `cd ml && ./.venv/bin/python make_golden_fixture.py`');
    return;
  }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const rows = fixture.stream.map((r) => ({ ...r, timestamp: new Date(r.timestamp) }));
  const expectedById = new Map(fixture.expected.map((e) => [e.transactionId, e.vector]));

  let checked = 0;
  let worstDiff = 0;
  let worstWhere = null;

  for (let i = 0; i < rows.length; i += 1) {
    const txn = rows[i];
    const t = txn.timestamp.getTime();

    // Rebuild history exactly the way `buildFeatures` would query it: strictly
    // before `t`, user rows within 30d, plus the user's most recent row of any
    // age, plus all prior merchant rows.
    const userHistory = rows.slice(0, i).filter(
      (r) => r.userId === txn.userId && r.timestamp.getTime() >= t - DAYS_30_MS,
    );
    let userPrevious = null;
    for (let j = i - 1; j >= 0; j -= 1) {
      if (rows[j].userId === txn.userId) { userPrevious = rows[j]; break; }
    }
    const merchantHistory = rows.slice(0, i).filter((r) => r.merchantId === txn.merchantId);

    const got = computeFeatures({ transaction: txn, userHistory, userPrevious, merchantHistory });
    const want = expectedById.get(txn.transactionId);
    if (!want) continue;

    if (got.length !== want.length) {
      fail(`${txn.transactionId}: vector length ${got.length} != expected ${want.length}`);
      return;
    }
    for (let f = 0; f < want.length; f += 1) {
      const diff = Math.abs(got[f] - want[f]);
      if (diff > worstDiff) {
        worstDiff = diff;
        worstWhere = { id: txn.transactionId, feature: fixture.feature_names[f], got: got[f], want: want[f] };
      }
    }
    checked += 1;
  }

  if (worstWhere && worstDiff > TOLERANCE) {
    fail(`feature mismatch at ${worstWhere.id} :: ${worstWhere.feature} ` +
         `got ${worstWhere.got} want ${worstWhere.want} (abs diff ${worstDiff})`);
    return;
  }

  console.log(`PASS: Node feature implementation matches the golden fixture ` +
              `(${checked} rows x ${fixture.feature_names.length} features, ` +
              `max abs diff ${worstDiff.toExponential(2)})`);
}

main();
