// End-to-end tests of the server with stand-ins for Archil and the model (--fake).
// They start a real HTTP server on a free port, start runs through the API, and read the
// event stream the dashboard reads.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startServer } from './server.mjs';

// The canary secret each run makes (see session.mjs). The sample project's own test
// mentions the prefix "CANARY-", so match the whole value, not the prefix.
const CANARY = /CANARY-[0-9a-f]{18}/;

const logDir = mkdtempSync(path.join(tmpdir(), 'scoped-runner-test-'));
const srv = await startServer({ port: 0, fake: true, logDir, quiet: true });
const base = `http://127.0.0.1:${srv.port}`;
test.after(async () => { await srv.close(); rmSync(logDir, { recursive: true, force: true }); });

const post = (body, headers = {}) => fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function events(id) {
  const res = await fetch(`${base}/api/runs/${id}/events`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const raw = await res.text(); // the server ends the stream after the "end" event
  return { raw, list: raw.split('\n\n').map((c) => c.split('\n').find((l) => l.startsWith('data: '))).filter(Boolean).map((l) => JSON.parse(l.slice(6))) };
}

test('the dashboard and its configuration are served without any key values', async () => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Scoped Runner<\/title>/);
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.fake, true);
  assert.equal(config.model, 'claude-opus-5-5');
  assert.deepEqual(Object.keys(config.classes).sort(), ['edit', 'install', 'open', 'other', 'search', 'test']);
  const text = JSON.stringify(config);
  for (const name of ['ARCHIL_API_KEY', 'ANTHROPIC_API_KEY']) if (process.env[name]) assert.ok(!text.includes(process.env[name]), `${name} leaked`);
});

test('an agent run streams every call, passes its checks and cleans up', async () => {
  const res = await post({ kind: 'agent', mode: 'rehearse', taskId: 'longform' });
  assert.equal(res.status, 202);
  const { id } = await res.json();
  const { raw, list } = await events(id);
  const types = list.map((e) => e.type);
  assert.equal(types[0], 'start');
  assert.equal(types.at(-1), 'end');
  assert.equal(list.at(-1).ok, true);
  const calls = list.filter((e) => e.type === 'call').map((e) => e.call);
  assert.equal(calls.length, 10);
  assert.ok(calls.every((c) => !(c.grants.secrets !== 'none' && c.grants.network && (c.grants.network.allow ?? []).length)));
  const secretsRead = calls.find((c) => c.label.includes('/mnt/archil/secrets'));
  assert.equal(secretsRead.class, 'other');
  assert.notEqual(secretsRead.exitCode, 0, 'a plain command cannot see the secrets');
  const checks = list.filter((e) => e.type === 'check').map((e) => e.check);
  assert.equal(checks.length, 5);
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks));
  const cleanup = list.find((e) => e.type === 'cleanup');
  assert.equal(cleanup.deleted.length, 3);
  assert.doesNotMatch(raw, CANARY, 'the canary secret never reaches the browser');

  const runs = await (await fetch(`${base}/api/runs`)).json();
  const listed = runs.find((r) => r.id === id);
  assert.equal(listed.status, 'passed');
  assert.equal(listed.checksPassed, 5);
});

test('the access matrix shows the limits hold and the baseline does not', async () => {
  const { id } = await (await post({ kind: 'matrix' })).json();
  const { raw, list } = await events(id);
  const rows = list.filter((e) => e.type === 'matrix-row').map((e) => e.row);
  assert.deepEqual(rows.map((r) => r.class), ['search', 'install', 'edit', 'test', 'other', 'open']);
  for (const r of rows.filter((x) => x.class !== 'open')) assert.ok(!(r.secrets === 'readable' && r.outside === 'reachable'), r.class);
  const open = rows.find((r) => r.class === 'open');
  assert.equal(open.secrets, 'readable');
  assert.equal(open.outside, 'reachable');
  assert.match(rows.find((r) => r.class === 'test').secretShown, /\[REDACTED\]/);
  assert.doesNotMatch(raw, CANARY);
  assert.equal(list.at(-1).ok, true);
});

test('several runs share one host at once, each on its own disks; a fourth waits', async () => {
  const started = await Promise.all([post({ kind: 'agent', mode: 'rehearse' }), post({ kind: 'agent', mode: 'rehearse' }), post({ kind: 'matrix' })]);
  assert.deepEqual(started.map((r) => r.status), [202, 202, 202]);
  const ids = await Promise.all(started.map((r) => r.json().then((j) => j.id)));
  assert.equal((await post({ kind: 'matrix' })).status, 429, 'the cap on concurrent runs holds');
  const all = await Promise.all(ids.map(events));
  for (const { list } of all) assert.equal(list.at(-1).ok, true);
  const diskNames = all.flatMap(({ list }) => list.find((e) => e.type === 'disks').names);
  assert.equal(new Set(diskNames).size, 9, 'no two runs share a disk');
});

test('requests from other sites or with bad input are refused', async () => {
  assert.equal((await post({ kind: 'agent' }, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await fetch(`${base}/api/runs`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await post({ kind: 'nope' })).status, 400);
  assert.equal((await post({ kind: 'agent', taskId: 'nope' })).status, 400);
  assert.equal((await fetch(`${base}/api/runs/zzzzzz/events`)).status, 404);
  // fetch() drops a custom Host header, so send this one with node:http.
  const status = await new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: srv.port, path: '/api/config', headers: { host: 'attacker.example' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(status, 403, 'a request naming another host (DNS rebinding) is refused');
});

test('on start, the server deletes only the disks that dead, unfinished runs left', async () => {
  const { fakeArchil } = await import('./fake.mjs');
  const { writeFileSync, readFileSync } = await import('node:fs');
  const archil = fakeArchil({ delayMs: 1 });
  const make = async (name) => (await archil.disks.create({ name })).disk;
  const dir = mkdtempSync(path.join(tmpdir(), 'scoped-recover-'));
  const now = Date.now();
  const deadPid = 2 ** 22 + 12345; // above every OS's PID range in practice: never a live process
  const runLog = (id, pid, lastAt, names, ended = false) => {
    const ev = [{ type: 'start', kind: 'agent', id, ...(pid ? { pid } : {}), mode: 'rehearse', task: { title: 't' }, at: lastAt - 1000 }];
    if (names) ev.push({ type: 'disks', names, at: lastAt - 500 });
    ev.push({ type: 'call', call: { n: 1 }, at: lastAt });
    if (ended) ev.push({ type: 'end', ok: true, at: lastAt + 1 });
    writeFileSync(path.join(dir, `session-${id}.jsonl`), ev.map((e) => JSON.stringify(e)).join('\n') + '\n');
  };
  const names = (id) => ['secrets', 'ws', 'web'].map((l) => `scoped-agent-${id}-${l}`);
  for (const id of ['dead01', 'live02', 'recnt3', 'old004', 'done05']) for (const n of names(id)) await make(n);
  await make('my-own-data');                  // never named by any run
  await make('scoped-agent-dead01-extra');    // has the dead run's prefix but is not in its log

  runLog('dead01', deadPid, now - 60_000, [...names('dead01'), 'my-own-data']); // the process is gone
  runLog('live02', process.pid, now - 60 * 60_000, names('live02'));           // its process is still alive
  runLog('recnt3', null, now - 60_000, names('recnt3'));                        // no pid recorded, quiet for 1 minute
  runLog('old004', null, now - 60 * 60_000, names('old004'));                   // no pid recorded, quiet for an hour
  runLog('done05', deadPid, now - 60_000, names('done05'), true);               // finished normally

  const s = await startServer({ port: 0, logDir: dir, quiet: true, archil });
  try {
    const results = await s.recovery;
    const left = (await archil.disks.list()).map((d) => d.name).sort();
    assert.deepEqual(left, ['my-own-data', 'scoped-agent-dead01-extra', ...names('done05'), ...names('live02'), ...names('recnt3')].sort());
    assert.deepEqual(results.find((r) => r.id === 'dead01').deleted, names('dead01'));
    assert.deepEqual(results.find((r) => r.id === 'old004').deleted, names('old004'));
    assert.match(results.find((r) => r.id === 'live02').skipped, /still running/);
    assert.match(results.find((r) => r.id === 'recnt3').skipped, /recent/);
    assert.ok(!results.some((r) => r.id === 'done05'));

    // The cleanup is recorded in the run's log and shown in its event stream.
    const logged = readFileSync(path.join(dir, 'session-dead01.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(logged.slice(-2).map((e) => e.type), ['cleanup', 'end']);
    const res = await fetch(`http://127.0.0.1:${s.port}/api/runs/dead01/events`);
    const types = (await res.text()).split('\n\n').filter(Boolean).map((c) => JSON.parse(c.slice(6)).type);
    assert.deepEqual(types.slice(-2), ['cleanup', 'end']);
  } finally { await s.close(); }

  // A second start does nothing more for runs already cleaned up.
  const again = await startServer({ port: 0, logDir: dir, quiet: true, archil });
  try {
    const results = await again.recovery;
    assert.deepEqual(results.map((r) => r.id).sort(), ['live02', 'recnt3']);
    assert.ok(results.every((r) => r.skipped));
  } finally { await again.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('finished runs are listed again after a restart', async () => {
  const again = await startServer({ port: 0, fake: true, logDir, quiet: true });
  try {
    const runs = await (await fetch(`http://127.0.0.1:${again.port}/api/runs`)).json();
    assert.ok(runs.length >= 2);
    assert.ok(runs.every((r) => r.status !== 'running'));
  } finally { await again.close(); }
});
