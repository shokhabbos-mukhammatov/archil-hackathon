import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub, variants, REDACTED } from './scrub.mjs';
import { buildCall, runCall, PROBE, parseProbe } from './runner.mjs';

const SECRET = 'CANARY-abc123-zz9plural';

test('the exact value is removed and counted', () => {
  const { text, hits } = scrub(`key=${SECRET}\nagain ${SECRET}`, [SECRET]);
  assert.equal(hits, 2);
  assert.ok(!text.includes(SECRET));
  assert.equal(text, `key=${REDACTED}\nagain ${REDACTED}`);
});

test('common encodings of the value are removed too', () => {
  const b = Buffer.from(SECRET);
  for (const form of [b.toString('base64'), b.toString('base64url'), b.toString('hex'), b.toString('hex').toUpperCase(), encodeURIComponent(SECRET)]) {
    const { text, hits } = scrub(`x ${form} y`, [SECRET]);
    assert.equal(hits, 1, form);
    assert.equal(text, `x ${REDACTED} y`, form);
  }
});

test('a value inside printed JSON is removed and the JSON stays valid', () => {
  const printed = JSON.stringify({ config: JSON.stringify({ serviceName: 'billing', apiKey: SECRET }) });
  const { text, hits } = scrub(printed, [SECRET]);
  assert.equal(hits, 1);
  assert.equal(JSON.parse(JSON.parse(text).config).apiKey, REDACTED);
});

test('text without the secret is unchanged; short values are ignored', () => {
  assert.deepEqual(scrub('nothing to see', [SECRET]), { text: 'nothing to see', hits: 0 });
  assert.deepEqual(scrub('billing billing', ['billing']), { text: 'billing billing', hits: 0 });
  assert.deepEqual(scrub(undefined, [SECRET]), { text: '', hits: 0 });
  // raw, base64, unpadded base64 (= base64url here), hex, upper-case hex
  assert.equal(variants(SECRET).length, 5);
});

const disks = { workspaceDisk: 'dsk-w', secretsDisk: 'dsk-s', webDisk: 'dsk-web' };

test('secret values are never sent to Archil', () => {
  const { request } = buildCall({ command: 'node --test', mode: 'limited', ...disks, secretValues: [SECRET] });
  assert.ok(!JSON.stringify(request).includes(SECRET));
  assert.equal(request.secretValues, undefined);
});

test('runCall scrubs stdout, stderr and errors before returning them', async () => {
  const leaky = { exec: async () => ({ exitCode: 1, stdout: `token ${SECRET}`, stderr: Buffer.from(SECRET).toString('base64'), timing: {} }) };
  const r = await runCall(leaky, { command: 'node --test', mode: 'limited', ...disks, secretValues: [SECRET] });
  assert.equal(r.redactions, 2);
  assert.ok(!r.stdout.includes(SECRET) && r.stdout.includes(REDACTED));
  assert.equal(r.stderr, REDACTED);

  const throwing = { exec: async () => { throw Object.assign(new Error(`bad ${SECRET}`), { status: 500 }); } };
  const e = await runCall(throwing, { command: 'ls', mode: 'limited', ...disks, secretValues: [SECRET] });
  assert.ok(!e.error.includes(SECRET) && e.error.includes(REDACTED));
});

test('a probe that prints the configuration comes back with the secret removed', async () => {
  const config = JSON.stringify({ serviceName: 'billing', apiKey: SECRET });
  const archil = { exec: async () => ({ exitCode: 0, stdout: 'PROBE ' + JSON.stringify({ secrets: 'readable', secretText: config, workspaceWrite: 'refused', webWrite: 'not mounted', outside: 'blocked' }), stderr: '' }) };
  const r = await runCall(archil, { command: PROBE, mode: 'limited', forcedClass: 'test', ...disks, secretValues: [SECRET] });
  const p = parseProbe(r.stdout);
  assert.equal(p.secrets, 'readable');
  assert.equal(JSON.parse(p.secretText).apiKey, REDACTED);
  assert.equal(r.redactions, 1);
});
