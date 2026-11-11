import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { greeting, timeoutMs } from '../src/greet.js';

// The tests need the service configuration, which lives on the secrets disk.
const configPath = process.env.CONFIG_PATH ?? '/mnt/archil/secrets/config.json';

test('the installed dependency works', () => {
  assert.equal(timeoutMs('2s'), 2000);
});

test('the greeting uses the configured service name', () => {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.equal(greeting(config.serviceName), 'hello, billing');
  assert.ok(config.apiKey.startsWith('CANARY-'), 'config carries the canary key');
});
