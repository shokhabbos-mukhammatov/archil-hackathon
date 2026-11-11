// One complete, self-contained run, as used by both the command line and the web server.
//
//   runSession  creates two disks for this run alone (workspace, web results), registers a
//               fresh API key for the run with the project's service, lets the agent work,
//               checks the result itself, measures what every class could actually reach,
//               then revokes the key and deletes the disks.
//   runMatrix   the measurement alone, with the no-limits baseline added for comparison.
//
// Every run reports through `emit(event)` and also appends each event to
// runs/session-<tag>.jsonl, so a finished run can be shown again later.

import { readdirSync, readFileSync, statSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLASSES } from './policy.mjs';
import { runCall, probeCommand, parseProbe } from './runner.mjs';
import { runAgent, rehearsalClient, TASKS, DEFAULT_MODEL } from './loop.mjs';
import { newServiceKey } from './service.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const IMAGE = process.env.DEMO_IMAGE ?? 'node:22-slim';
export const DEFAULT_LOG_DIR = path.join(here, 'runs');
export const newTag = () => Math.random().toString(36).slice(2, 8);

const tail = (s, n = 8) => String(s ?? '').trim().split('\n').slice(-n).join('\n');
const normUrl = (u) => String(u).replace(/[.,;:]+$/, '').replace(/\/$/, '');

// The line that says why a command failed: the first thrown error (TAP output prefixes
// a crashed test file's stderr with "# "), else the first failing test. Paths after
// "imported from" are dropped to keep it short.
export function failureReason(...texts) {
  const lines = texts.join('\n').split('\n').map((l) => l.replace(/^#\s?/, '').trim()).filter(Boolean);
  const line = lines.find((l) => /^[A-Za-z]*Error\b(?: \[[A-Z_]+\])?:/.test(l)) ?? lines.find((l) => /^not ok \d+/.test(l));
  return line ? line.replace(/ imported from \S+/, '').slice(0, 200) : null;
}

// Errors that carry an HTTP status come from Archil or from the model call, and loop.mjs
// marks the model's with `service`. Naming the service matters: .env holds two keys.
export function describeError(e) {
  const status = e?.status;
  const who = e?.service ?? (status ? 'Archil' : null);
  const msg = String(e?.message ?? e).slice(0, 300);
  if (status === 401 || status === 403) return `${who} rejected the key (${status}). Check ${who === 'Archil' ? 'ARCHIL_API_KEY and ARCHIL_REGION' : 'ANTHROPIC_API_KEY'} in .env. Details: ${msg}`;
  if (status === 429) return `${who} is rate limiting requests (429); wait a moment and try again. Details: ${msg}`;
  return `${who ? `${who}: ` : ''}${e?.name ?? 'Error'}${status ? ` (status ${status})` : ''}: ${msg}`;
}

function walk(dir, rel = '') {
  return readdirSync(path.join(dir, rel)).flatMap((name) => {
    if (name === 'node_modules') return [];
    const r = rel ? `${rel}/${name}` : name;
    return statSync(path.join(dir, r)).isDirectory() ? walk(dir, r) : [r];
  });
}

function makeEmitter(tag, logDir, emit) {
  mkdirSync(logDir, { recursive: true });
  const file = path.join(logDir, `session-${tag}.jsonl`);
  const send = (ev) => {
    const e = { ...ev, at: Date.now() };
    try { appendFileSync(file, JSON.stringify(e) + '\n'); } catch {}
    try { emit(e); } catch {}
    return e;
  };
  return { file, send };
}

// Disks go into the caller's `created` list as each one is made, so a failure partway
// through still leaves every created disk on the list for cleanup.
async function makeDisks(archil, prefix, labels, send, created) {
  try {
    for (const label of labels) {
      const { disk } = await archil.disks.create({ name: `${prefix}-${label}` });
      created.push(disk);
    }
  } finally {
    if (created.length) send({ type: 'disks', names: created.map((d) => d.name) });
  }
  return created;
}

async function deleteDisks(created, keep, send) {
  if (!created.length) return;
  if (keep) { send({ type: 'cleanup', kept: created.map((d) => d.name), deleted: [], failed: [] }); return; }
  const deleted = [];
  const failed = [];
  for (const d of created) {
    try { await d.delete(); deleted.push(d.name); } catch (e) { failed.push(`${d.name} (${d.id}): ${describeError(e)}`); }
  }
  send({ type: 'cleanup', deleted, failed });
}

// ---------------------------------------------------------------------------------------
// Measurement: one harmless probe per class.
// ---------------------------------------------------------------------------------------
export async function probeClasses({ archil, base, classes, serviceUrl, onRow = () => {} }) {
  const rows = [];
  for (const name of classes) {
    const run = await runCall(archil, { ...base, mode: name === 'open' ? 'open' : 'limited', forcedClass: name === 'open' ? undefined : name, command: probeCommand(serviceUrl) });
    const p = parseProbe(run.stdout);
    const row = {
      class: name, grants: run.grants, measured: !!p,
      // The probe prints its whole environment and any key file; the scrubber counts the key.
      keyInside: (run.redactions ?? 0) > 0 || p?.keyFile === 'readable',
      service: p?.service ?? null, outside: p?.outside ?? null,
      workspaceWrite: p?.workspaceWrite ?? null, webWrite: p?.webWrite ?? null, dns: p?.dns ?? null,
      wallMs: run.wallMs, error: p ? null : (run.error ?? failureReason(run.stderr, run.stdout) ?? tail(run.stderr || run.stdout, 2)),
    };
    rows.push(row);
    onRow(row);
  }
  return rows;
}

export function judgeRows(rows) {
  const limited = rows.filter((r) => r.class !== 'open');
  const authed = (r) => r.service === 'authenticated';
  const open = rows.find((r) => r.class === 'open');
  return {
    allMeasured: rows.every((r) => r.measured),
    keyInside: limited.filter((r) => r.keyInside).map((r) => r.class),
    serviceClasses: limited.filter(authed).map((r) => r.class),
    serviceAndOutside: limited.filter((r) => authed(r) && r.outside === 'reachable').map((r) => r.class),
    serviceAndWrite: limited.filter((r) => authed(r) && (r.workspaceWrite === 'allowed' || r.webWrite === 'allowed')).map((r) => r.class),
    dnsAnswered: rows.filter((r) => r.dns === 'answered').map((r) => r.class),
    baseline: open ? { keyInside: open.keyInside, service: authed(open), outside: open.outside === 'reachable' } : null,
  };
}

const list = (xs) => (xs.length ? xs.join(', ') : 'none');

function measuredChecks(j, rowsCount) {
  return [
    { id: 'measured', label: 'Every probe ran and reported', ok: j.allMeasured, detail: `${rowsCount} probes` },
    { id: 'key', label: 'The API key was not inside any call (measured in every class)', ok: j.keyInside.length === 0, detail: `classes holding it: ${list(j.keyInside)}` },
    { id: 'service', label: "Only the test class could reach the project's service, and it could reach nothing else", ok: j.serviceClasses.join() === 'test' && j.serviceAndOutside.length === 0, detail: `reached the service: ${list(j.serviceClasses)}; also reached an outside host: ${list(j.serviceAndOutside)}` },
    { id: 'service-write', label: 'The class that reads service data could not write anywhere a later call reads', ok: j.serviceAndWrite.length === 0, detail: `could write: ${list(j.serviceAndWrite)}` },
  ];
}

function dnsGap(j, total) {
  if (!j.dnsAnswered.length) return null;
  return `DNS lookups were answered in ${j.dnsAnswered.length} of ${total} classes, even under a deny-all rule (Archil's resolvers are reachable from every call). Anything inside a call could leave that way: project code and service responses, but not the API key, which is never inside. This is an open question for Archil.`;
}

// ---------------------------------------------------------------------------------------
// Checks that do not take the agent's word for anything.
// ---------------------------------------------------------------------------------------
function originalTestsCommand() {
  const original = readFileSync(path.join(here, 'sample-app', 'test', 'greet.test.js'), 'utf8')
    .replace("from '../src/greet.js'", "from '/mnt/archil/app/src/greet.js'")
    .replace("new URL('../service.json', import.meta.url)", "'/mnt/archil/app/service.json'");
  const b64 = Buffer.from(original, 'utf8').toString('base64');
  return `node -e 'const fs = require("fs"); fs.mkdirSync("/tmp/orig", { recursive: true }); fs.writeFileSync("/tmp/orig/original.test.mjs", Buffer.from(process.argv[1], "base64"))' ${b64} && node --test /tmp/orig/original.test.mjs`;
}

async function independentChecks({ archil, base, calls, task, serviceUrl, send }) {
  const checks = [];
  let archilCalls = 0;
  const add = (c) => { checks.push(c); send({ type: 'check', check: c }); };
  const call = async (command, forcedClass) => { archilCalls++; return runCall(archil, { ...base, command, forcedClass }); };
  const counts = (r) => [/(?:#|ℹ)\s*pass (\d+)/.exec(r.stdout)?.[1], /(?:#|ℹ)\s*fail (\d+)/.exec(r.stdout)?.[1]];
  const testDetail = (r) => { const [pass, fail] = counts(r); return r.ok ? `${pass ?? '?'} passed, ${fail ?? 0} failed` : r.error ?? `${failureReason(r.stdout, r.stderr) ?? 'failed'} (${pass ?? '?'} passed, ${fail ?? '?'} failed)`; };

  const suite = await call('node --test');
  add({ id: 'suite', label: 'The whole test suite passes when re-run independently', ok: suite.ok, detail: testDetail(suite) });

  if (task.checks === 'longform') {
    const original = await call(originalTestsCommand(), 'test');
    add({ id: 'original', label: "The project's original tests still pass against the agent's code", ok: original.ok, detail: testDetail(original) });

    const probe = await call(`node -e 'import("./src/greet.js").then((m) => { if (m.longForm("2s") !== "2 seconds" || m.longForm("1h") !== "1 hour") process.exit(1); console.log("longForm ok"); })'`);
    add({ id: 'longform', label: 'longForm("2s") returns "2 seconds" and longForm("1h") returns "1 hour"', ok: probe.ok, detail: probe.ok ? 'both correct' : (probe.error ?? failureReason(probe.stderr, probe.stdout) ?? (tail(probe.stdout || probe.stderr, 2) || `exit ${probe.exitCode}`)) });

    const doc = await call('cat docs/longForm.md');
    const cited = [...new Set((String(doc.stdout).match(/https?:\/\/[^\s)>\]"'`]+/g) ?? []).map(normUrl))];
    const searches = calls.filter((c) => c.tool === 'search');
    const returned = new Set(searches.flatMap((c) => c.search?.results ?? []).map((r) => normUrl(r.url)));
    const matched = cited.filter((u) => returned.has(u));
    add({ id: 'cited', label: "docs/longForm.md cites a page the agent's own web search returned", ok: matched.length > 0, detail: matched.length ? matched[0] : `searches made: ${searches.length}; URLs cited: ${cited.join(', ') || 'none'}` });
  }

  // Measured, not read from the policy table: what each class could actually do.
  const classes = Object.keys(CLASSES);
  send({ type: 'status', text: 'Measuring what each class could actually reach...' });
  const rows = await probeClasses({ archil, base, classes, serviceUrl });
  archilCalls += rows.length;
  send({ type: 'measure', rows });
  const j = judgeRows(rows);
  for (const c of measuredChecks(j, rows.length)) add(c);
  const leaked = calls.reduce((n, c) => n + (c.redactions ?? 0), 0);
  add({ id: 'output', label: "The API key never appeared in any call's output", ok: leaked === 0, detail: `${leaked} occurrence(s) removed by the scrubber` });
  const gap = dnsGap(j, rows.length);
  if (gap) send({ type: 'gap', text: gap });
  return { checks, archilCalls, judged: j };
}

export function accessSummary(calls, refused = 0) {
  const byClass = {};
  for (const c of calls) byClass[c.class] = (byClass[c.class] ?? 0) + 1;
  return { byClass, refused, redactions: calls.reduce((n, c) => n + (c.redactions ?? 0), 0) };
}

// Registers a fresh key for this run with the service, and returns the rule pieces.
async function serviceForRun(service, tag) {
  if (!service) return { rule: null, key: null, url: '' };
  const key = newServiceKey();
  await service.addKey(tag, key);
  return { rule: { host: service.host, headers: { Authorization: `Bearer ${key}` } }, key, url: service.url };
}

export async function runSession({ archil, client, service, mode = 'live', taskId = 'longform', taskText, model = DEFAULT_MODEL, keep = false, emit = () => {}, tag = newTag(), region, logDir = DEFAULT_LOG_DIR, simulated = false }) {
  const rehearse = mode !== 'live';
  let task = taskId === 'custom' ? { id: 'custom', title: 'Custom task', text: String(taskText ?? '').trim(), checks: 'generic' } : TASKS[taskId];
  if (!task || !task.text) throw new Error(`unknown or empty task "${taskId}"`);
  if (rehearse) task = TASKS.longform; // the rehearsal script is written for this task
  const { file, send } = makeEmitter(tag, logDir, emit);
  // `pid` lets a restarted server tell a run that died from one still going elsewhere.
  send({ type: 'start', kind: 'agent', id: tag, pid: process.pid, mode: rehearse ? 'rehearse' : 'live', simulated, model: rehearse ? null : model, task: { id: task.id, title: task.title, text: task.text }, region, image: IMAGE, service: service?.host ?? null, log: path.basename(file) });

  const created = [];
  let registered = false;
  const result = { ok: false, tag };
  try {
    if (!service) throw new Error("the project's service is not running, so the test class has nothing to reach");
    await makeDisks(archil, `scoped-agent-${tag}`, ['ws', 'web'], send, created);
    const [workspace, web] = created;
    const svc = await serviceForRun(service, tag);
    registered = true;
    const files = walk(path.join(here, 'sample-app'));
    for (const f of files) await workspace.putObject(f, readFileSync(path.join(here, 'sample-app', f)));
    await workspace.putObject('service.json', JSON.stringify({ url: svc.url }) + '\n');
    send({ type: 'status', text: `Project uploaded (${files.length} files). A fresh API key for this run is registered with the service; it exists only in the host and in Archil's egress rule.` });

    const base = { mode: 'limited', workspaceDisk: workspace, webDisk: web, image: IMAGE, service: svc.rule, secretValues: [svc.key] };
    const started = Date.now();
    const { calls, refused, finalText, ended } = await runAgent({
      client: rehearse ? rehearsalClient() : client,
      archil, base, task: task.text, model,
      onCall: (c) => send(c.n === null ? { type: 'rejected', label: c.label, class: c.class, problem: c.problem, refused: !!c.refused } : { type: 'call', call: c }),
      onText: (t) => send({ type: 'say', turn: t.turn, text: t.text }),
    });
    const seconds = Math.round((Date.now() - started) / 1000);
    send({ type: 'agent-done', ended, finalText, calls: calls.length, refused, seconds });

    send({ type: 'status', text: 'Checking the result independently...' });
    const { checks, archilCalls, judged } = await independentChecks({ archil, base, calls, task, serviceUrl: svc.url, send });
    const summary = { ...accessSummary(calls, refused), calls: calls.length, archilCalls: calls.length + archilCalls, seconds, keyInside: judged.keyInside.length, dnsAnswered: judged.dnsAnswered.length };
    send({ type: 'summary', summary });
    Object.assign(result, { ok: checks.every((c) => c.ok), calls, checks, summary });
  } catch (e) {
    send({ type: 'error', text: describeError(e) });
  } finally {
    if (registered) { try { await service.removeKey(tag); send({ type: 'status', text: "This run's API key was revoked." }); } catch (e) { send({ type: 'error', text: `could not revoke this run's key: ${describeError(e)}` }); } }
    await deleteDisks(created, keep, send);
    send({ type: 'end', ok: result.ok });
  }
  return result;
}

export async function runMatrix({ archil, service, keep = false, emit = () => {}, tag = newTag(), region, logDir = DEFAULT_LOG_DIR, simulated = false }) {
  const { file, send } = makeEmitter(tag, logDir, emit);
  const order = [...Object.keys(CLASSES), 'open'];
  send({ type: 'start', kind: 'matrix', id: tag, pid: process.pid, mode: 'live', simulated, region, image: IMAGE, classes: order, service: service?.host ?? null, log: path.basename(file) });

  const created = [];
  let registered = false;
  const result = { ok: false, tag, rows: [] };
  try {
    if (!service) throw new Error("the project's service is not running");
    await makeDisks(archil, `scoped-matrix-${tag}`, ['ws', 'web', 'key'], send, created);
    const [workspace, web, keyDisk] = created;
    const svc = await serviceForRun(service, tag);
    registered = true;
    // The no-limits baseline gets the key the way a conventional sandbox would: on hand.
    await keyDisk.putObject('key.txt', svc.key);
    const base = { workspaceDisk: workspace, webDisk: web, keyDisk, image: IMAGE, service: svc.rule, secretValues: [svc.key] };
    send({ type: 'status', text: 'One harmless probe per class: look for the key, call the service, fetch an outside host, write each folder, resolve a name.' });

    result.rows = await probeClasses({ archil, base, classes: order, serviceUrl: svc.url, onRow: (row) => send({ type: 'matrix-row', row }) });
    const j = judgeRows(result.rows);
    const checks = [
      ...measuredChecks(j, result.rows.length),
      { id: 'baseline', label: 'Without limits, the same probe held the key and could reach the service and the internet (the baseline)', ok: !!j.baseline && j.baseline.keyInside && j.baseline.service && j.baseline.outside, detail: j.baseline ? `key inside: ${j.baseline.keyInside}, service: ${j.baseline.service}, outside: ${j.baseline.outside}` : 'not measured' },
    ];
    for (const c of checks) send({ type: 'check', check: c });
    const gap = dnsGap(j, result.rows.length);
    if (gap) send({ type: 'gap', text: gap });
    result.ok = checks.every((c) => c.ok);
    send({ type: 'summary', summary: { calls: result.rows.length, archilCalls: result.rows.length, keyInside: j.keyInside.length, dnsAnswered: j.dnsAnswered.length } });
  } catch (e) {
    send({ type: 'error', text: describeError(e) });
  } finally {
    if (registered) { try { await service.removeKey(tag); } catch (e) { send({ type: 'error', text: `could not revoke this run's key: ${describeError(e)}` }); } }
    await deleteDisks(created, keep, send);
    send({ type: 'end', ok: result.ok });
  }
  return result;
}
