import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub, containsSecret, patternsFor, REDACTED } from './scrub.mjs';
import { buildCall, runCall, probeCommand, parseProbe } from './runner.mjs';

const SECRET = 'svc_ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';

test('the exact value is removed and counted', () => {
  const { text, hits } = scrub(`key=${SECRET}\nagain ${SECRET}`, [SECRET]);
  assert.equal(hits, 2);
  assert.equal(text, `key=${REDACTED}\nagain ${REDACTED}`);
});

test('any letter case, reversed, hex, URL-encoded and JSON-escaped forms are removed', () => {
  const b = Buffer.from(SECRET);
  for (const form of [SECRET.toUpperCase(), [...SECRET].reverse().join(''), b.toString('hex'), b.toString('hex').toUpperCase(), encodeURIComponent(SECRET)]) {
    const { text, hits } = scrub(`x ${form} y`, [SECRET]);
    assert.equal(hits, 1, form);
    assert.equal(text, `x ${REDACTED} y`, form);
  }
});

test('base64 of a larger block is caught at every alignment, and the value cannot be decoded back', () => {
  for (let pad = 0; pad < 6; pad++) {
    const block = JSON.stringify({ serviceName: 'billing', note: 'x'.repeat(pad), apiKey: SECRET }) + '\n';
    for (const enc of ['base64', 'base64url']) {
      const encoded = Buffer.from(block).toString(enc);
      const { text, hits } = scrub(encoded, [SECRET]);
      assert.ok(hits >= 1, `${enc}, offset ${pad}`);
      const decoded = Buffer.from(text.replace(/\[REDACTED\]/g, ''), enc).toString('latin1');
      assert.ok(!decoded.includes(SECRET), `${enc}, offset ${pad}: secret recoverable`);
    }
  }
});

test('the base64 of the value on its own is caught too', () => {
  for (const enc of ['base64', 'base64url']) assert.ok(scrub(Buffer.from(SECRET).toString(enc), [SECRET]).hits >= 1, enc);
});

test('known limits: split or re-encoded values are not caught', () => {
  assert.equal(scrub([...SECRET].join(' '), [SECRET]).hits, 0);
  assert.equal(scrub(SECRET.slice(0, 20) + '\n' + SECRET.slice(20), [SECRET]).hits, 0);
});

test('text without the secret is unchanged; short values are ignored', () => {
  assert.deepEqual(scrub('nothing to see', [SECRET]), { text: 'nothing to see', hits: 0 });
  assert.deepEqual(scrub('billing billing', ['billing']), { text: 'billing billing', hits: 0 });
  assert.deepEqual(scrub(undefined, [SECRET]), { text: '', hits: 0 });
  assert.ok(patternsFor(SECRET).exact.length >= 3);
  assert.equal(containsSecret(`q=${Buffer.from(SECRET).toString('base64')}`, [SECRET]), true);
  assert.equal(containsSecret('ms long format', [SECRET]), false);
});

const disks = { workspaceDisk: 'dsk-w', webDisk: 'dsk-web' };

test('secret values are never sent to Archil in the command or disks', () => {
  const { request } = buildCall({ command: 'node --test', mode: 'limited', ...disks, secretValues: [SECRET] });
  assert.ok(!JSON.stringify(request).includes(SECRET));
  assert.equal(request.secretValues, undefined);
});

test('runCall scrubs stdout, stderr and errors before returning them', async () => {
  const leaky = { exec: async () => ({ exitCode: 1, stdout: `token ${SECRET}`, stderr: Buffer.from(SECRET).toString('base64'), timing: {} }) };
  const r = await runCall(leaky, { command: 'node --test', mode: 'limited', ...disks, secretValues: [SECRET] });
  assert.equal(r.redactions, 2);
  assert.ok(!r.stdout.includes(SECRET) && r.stdout.includes(REDACTED));
  assert.ok(r.stderr.includes(REDACTED));

  const throwing = { exec: async () => { throw Object.assign(new Error(`bad ${SECRET}`), { status: 500 }); } };
  const e = await runCall(throwing, { command: 'ls', mode: 'limited', ...disks, secretValues: [SECRET] });
  assert.ok(!e.error.includes(SECRET) && e.error.includes(REDACTED));
});

test('a probe that finds the key reports it through the scrubber count', async () => {
  const archil = { exec: async () => ({ exitCode: 0, stdout: `PROBE ${JSON.stringify({ keyFile: 'readable', workspaceWrite: 'allowed', webWrite: 'allowed', outside: 'reachable', service: 'authenticated', dns: 'answered' })}\nVISIBLE {"PATH":"/bin"} ${SECRET}`, stderr: '' }) };
  const r = await runCall(archil, { command: probeCommand('https://service.example.test'), mode: 'open', ...disks, secretValues: [SECRET] });
  assert.equal(parseProbe(r.stdout).service, 'authenticated');
  assert.equal(r.redactions, 1);
  assert.ok(!r.stdout.includes(SECRET));
});
