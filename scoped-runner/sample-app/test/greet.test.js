import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { greeting, timeoutMs } from '../src/greet.js';

// The project's service. Its address is in service.json; its API key is not in this
// project or on the machine running these tests: Archil adds it to requests to the service.
const { url } = JSON.parse(readFileSync(new URL('../service.json', import.meta.url), 'utf8'));

test('the installed dependency works', () => {
  assert.equal(timeoutMs('2s'), 2000);
});

test('the greeting uses the service name from the account service', async () => {
  const res = await fetch(`${url}/v1/account`);
  assert.equal(res.status, 200, 'the service accepted the request');
  const account = await res.json();
  assert.equal(greeting(account.serviceName), 'hello, billing');
});
