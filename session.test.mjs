import test from 'node:test';
import assert from 'node:assert/strict';
import { failureReason, describeError } from './session.mjs';
import { runAgent } from './loop.mjs';

test('an error names the service and the key to check', async () => {
  const archil = describeError(Object.assign(new Error('API request failed with status 401'), { status: 401 }));
  assert.match(archil, /^Archil rejected the key \(401\)\. Check ARCHIL_API_KEY/);

  // A failure in the model call is marked as the Anthropic API's.
  const client = { beta: { messages: { create: async () => { throw Object.assign(new Error('invalid x-api-key'), { status: 401 }); } } } };
  const err = await runAgent({ client, archil: {}, base: {}, task: 't' }).catch((e) => e);
  assert.match(describeError(err), /^the Anthropic API rejected the key \(401\)\. Check ANTHROPIC_API_KEY/);

  assert.match(describeError(Object.assign(new Error('slow down'), { status: 429 })), /^Archil is rate limiting/);
  assert.equal(describeError(new Error('disk full')), 'Error: disk full');
});

// Real `node --test --test-reporter=tap` output when a dependency was never installed
// (the reporter Node uses inside an Archil call), shortened.
const MISSING_DEP = `TAP version 13
# node:internal/modules/package_json_reader:343
#   throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);
#         ^
# Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ms' imported from /mnt/archil/app/src/greet.js
#     at Object.getPackageJSONURL (node:internal/modules/package_json_reader:343:9)
#   code: 'ERR_MODULE_NOT_FOUND'
# Subtest: test/greet.test.js
not ok 1 - test/greet.test.js
  ---
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
# pass 0
# fail 1`;

test('a failed check names the real cause, not the summary counts', () => {
  assert.equal(failureReason(MISSING_DEP), "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ms'");
});

test('assertion failures and plain thrown errors are found too', () => {
  assert.equal(failureReason('not ok 2 - longForm\n  ---\n  error: |-\nAssertionError [ERR_ASSERTION]: Expected values to be strictly equal:'), 'AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:');
  assert.equal(failureReason('', 'TypeError: m.longForm is not a function'), 'TypeError: m.longForm is not a function');
});

test('falls back to the first failing test, or nothing', () => {
  assert.equal(failureReason('TAP version 13\nnot ok 3 - longForm gives the long form\n# fail 1'), 'not ok 3 - longForm gives the long form');
  assert.equal(failureReason('all fine\n# pass 3'), null);
  assert.equal(failureReason(undefined, ''), null);
});
