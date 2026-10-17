/**
 * ruleConsistency.test.js — the Node half of the rule-consistency feature.
 *
 * Two things are being verified, and the second matters more than the first:
 *
 * 1. A wrap-around night window is reported (`available: true`, one error) —
 *    i.e. the sidecar call works, the payload shape is right, and the issue is
 *    correctly attributed to NIGHT_OWL_RULE so the Rules screen can badge it.
 * 2. **A dead sidecar reports `available: false` and never a clean bill of
 *    health.** That is the failure mode worth a test: a checker that silently
 *    returns "no problems found" when it cannot run would be worse than no
 *    checker, because it would actively reassure an operator about a rule that
 *    can never fire.
 *
 * Run:  cd server && node test/ruleConsistency.test.js
 */
const assert = require('assert');
const http = require('http');

const mlServiceClient = require('../utils/mlServiceClient');

const NIGHT_OWL = {
  ruleName: 'NIGHT_OWL_RULE',
  enabled: true,
  score: 40,
  parameters: { startHour: 22, endHour: 5 },
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('wrap-around night window is reported as an error on the right rule', async () => {
  const result = await mlServiceClient.checkRuleConsistency([NIGHT_OWL]);
  assert.strictEqual(result.available, true, 'sidecar should have answered');
  assert.strictEqual(result.errors, 1);
  assert.strictEqual(result.warnings, 0);
  assert.strictEqual(result.healthy, false);

  const issue = result.issues[0];
  assert.strictEqual(issue.rule, 'NIGHT_OWL_RULE');
  assert.strictEqual(issue.kind, 'wrap_around');
  assert.match(issue.message, /can never fire/);
  // The analysis must distinguish the reading as written from the reading
  // intended, which is the whole point of the finding.
  assert.match(issue.as_implemented, /AND/);
  assert.match(issue.as_intended, /OR/);
});

test('the engine defaults are satisfiable', async () => {
  const defaults = [
    { ruleName: 'VELOCITY_RULE', enabled: true, score: 60, parameters: { maxTransactions: 5 } },
    { ruleName: 'AMOUNT_THRESHOLD_RULE', enabled: true, score: 65, parameters: { minAmount: 100000 } },
    { ruleName: 'NIGHT_OWL_RULE', enabled: true, score: 40, parameters: { startHour: 0, endHour: 5 } },
  ];
  const result = await mlServiceClient.checkRuleConsistency(defaults);
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.errors, 0);
  assert.strictEqual(result.healthy, true);
});

test('a vacuous rule is reported as a warning, not an error', async () => {
  const result = await mlServiceClient.checkRuleConsistency([
    { ruleName: 'AMOUNT_THRESHOLD_RULE', enabled: true, score: 65, parameters: { minAmount: 0 } },
  ]);
  assert.strictEqual(result.available, true);
  assert.strictEqual(result.errors, 0);
  assert.ok(result.warnings >= 1, 'a rule that always fires should warn');
  assert.strictEqual(result.issues[0].kind, 'always_fires');
});

test('an unreachable sidecar reports unavailable, never a clean bill of health', async () => {
  // Point the client at a port nothing is listening on. The point is that the
  // failure is *named*: callers can tell "no issues" from "cannot tell".
  const original = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = 'http://127.0.0.1:9';       // discard port
  delete require.cache[require.resolve('../utils/mlServiceClient')];
  const isolated = require('../utils/mlServiceClient');

  try {
    const result = await isolated.checkRuleConsistency([NIGHT_OWL]);
    assert.strictEqual(result.available, false);
    assert.ok(result.reason, 'a reason must be supplied');
    assert.strictEqual(result.errors, undefined, 'must not fabricate an issue count');
    assert.strictEqual(result.healthy, undefined, 'must not fabricate a verdict');
  } finally {
    if (original === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = original;
    delete require.cache[require.resolve('../utils/mlServiceClient')];
  }
});

test('a non-200 from the sidecar is treated as unavailable', async () => {
  // A stub that answers 503 with a reason, like the real sidecar does when the
  // `ml` package is missing from its path.
  const stub = http.createServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ available: false, reason: 'rule-consistency checker unavailable: boom' }));
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  const port = stub.address().port;

  const original = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = `http://127.0.0.1:${port}`;
  delete require.cache[require.resolve('../utils/mlServiceClient')];
  const isolated = require('../utils/mlServiceClient');

  try {
    const result = await isolated.checkRuleConsistency([NIGHT_OWL]);
    assert.strictEqual(result.available, false);
    assert.match(result.reason, /boom/);
  } finally {
    await new Promise(resolve => stub.close(resolve));
    if (original === undefined) delete process.env.ML_SERVICE_URL;
    else process.env.ML_SERVICE_URL = original;
    delete require.cache[require.resolve('../utils/mlServiceClient')];
  }
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (err) {
      failed += 1;
      console.log(`FAIL ${name}`);
      console.log(`     ${err.message}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
})();
