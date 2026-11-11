// The local web dashboard. One host, many runs: every run gets its own three disks and a
// fresh microVM per tool call, and several can run at once.
//
//   node server.mjs           real Archil (and Claude for live runs); keys come from .env
//   node server.mjs --fake    stand-ins for Archil and the model; nothing leaves this machine
//   add --port N              to listen somewhere other than 4317
//
// Listens on 127.0.0.1 only (PORT, default 4317). It refuses requests whose Host or Origin
// is not this machine, so a web page elsewhere cannot start runs on your keys.
//
//   GET  /                         the dashboard
//   GET  /api/config               what is configured (never any key values)
//   GET  /api/runs                 runs, newest first, including ones from earlier sessions
//   POST /api/runs                 start one: {kind:"agent"|"matrix", mode:"live"|"rehearse", taskId, taskText}
//   GET  /api/runs/:id/events      the run's events: every past one, then live ones (text/event-stream)

import './env.mjs';
import http from 'node:http';
import { readFileSync, readdirSync, existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CLASSES, OPEN } from './policy.mjs';
import { TASKS, DEFAULT_MODEL } from './loop.mjs';
import { runSession, runMatrix, IMAGE, DEFAULT_LOG_DIR, describeError, newTag } from './session.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_ACTIVE = 3;
const MAX_BODY = 20_000;

function summarize(run) {
  const start = run.events.find((e) => e.type === 'start') ?? {};
  const end = run.events.find((e) => e.type === 'end');
  const summary = run.events.find((e) => e.type === 'summary')?.summary;
  const checks = run.events.filter((e) => e.type === 'check').map((e) => e.check);
  return {
    id: run.id, kind: start.kind, mode: start.mode, simulated: !!start.simulated, model: start.model ?? null,
    title: start.kind === 'matrix' ? 'Access matrix' : start.task?.title ?? 'Agent run',
    startedAt: start.at ?? null, endedAt: end?.at ?? null,
    status: !end ? 'running' : end.interrupted ? 'interrupted' : end.ok ? 'passed' : 'failed',
    calls: summary?.calls ?? run.events.filter((e) => e.type === 'call' || e.type === 'matrix-row').length,
    checksPassed: checks.filter((c) => c.ok).length, checksTotal: checks.length,
  };
}

function loadHistory(logDir) {
  const runs = new Map();
  if (!existsSync(logDir)) return runs;
  for (const name of readdirSync(logDir)) {
    const m = /^session-([a-z0-9]+)\.jsonl$/.exec(name);
    if (!m) continue;
    const events = [];
    for (const line of readFileSync(path.join(logDir, name), 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { events.push(JSON.parse(line)); } catch {}
    }
    if (!events.length || events[0].type !== 'start') continue;
    const unfinished = !events.some((e) => e.type === 'end');
    if (unfinished) events.push({ type: 'end', ok: false, interrupted: true, at: events.at(-1).at });
    runs.set(m[1], { id: m[1], events, listeners: new Set(), done: true, unfinished, file: path.join(logDir, name) });
  }
  return runs;
}

// How long a run whose starting process is unknown (logs from before `pid` was recorded)
// must have been silent before it counts as dead. A live run reports at least once per
// tool call, and one call is capped at five minutes.
export const STALE_MS = 15 * 60 * 1000;

// true: running; false: gone; null: not recorded. EPERM means it exists.
export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// Deletes the disks of runs that stopped before their own cleanup ran, because the process
// running them died. Only disks named in that run's own log are deleted, by exact name and
// only with that run's prefix; nothing else on the account is touched. A run whose process
// is still alive (a command-line run in progress, say) is left alone. Once cleaned, the run's
// log gets a cleanup and an end event, so it is not considered again; if a deletion fails,
// the next start tries again.
export async function recoverInterrupted({ archil, runs, log = () => {}, now = Date.now() }) {
  const results = [];
  if (typeof archil?.disks?.list !== 'function') return results;
  let onAccount = null;
  for (const run of [...runs.values()].filter((r) => r.unfinished)) {
    const start = run.events[0];
    const alive = processAlive(start.pid);
    const lastAt = run.events.at(-2)?.at ?? start.at; // the last real event, before the added end
    if (alive === true || (alive === null && now - lastAt < STALE_MS)) {
      results.push({ id: run.id, skipped: alive ? 'its process is still running' : 'recent, and its process is unknown' });
      continue;
    }
    const ownName = new RegExp(`^scoped-(agent|matrix)-${run.id}-(secrets|ws|web)$`);
    const recorded = run.events.filter((e) => e.type === 'disks').flatMap((e) => e.names ?? []).filter((n) => ownName.test(n));
    const deleted = [];
    const failed = [];
    const missing = [];
    if (recorded.length) {
      onAccount ??= await archil.disks.list();
      for (const name of recorded) {
        const disk = onAccount.find((d) => d.name === name);
        if (!disk) { missing.push(name); continue; }
        try { await disk.delete(); deleted.push(name); } catch (e) { failed.push(`${name} (${disk.id}): ${describeError(e)}`); }
      }
    }
    const at = Date.now();
    const cleanup = { type: 'cleanup', recovered: true, deleted, failed, missing, at };
    run.events.splice(run.events.length - 1, 0, cleanup); // before the added end
    const lines = [cleanup];
    if (!failed.length) { lines.push({ type: 'end', ok: false, interrupted: true, at }); run.unfinished = false; }
    try { appendFileSync(run.file, lines.map((l) => JSON.stringify(l) + '\n').join('')); } catch {}
    results.push({ id: run.id, deleted, failed, missing });
    log(`Run ${run.id} had been interrupted: deleted ${deleted.length} disk(s) it left${missing.length ? `, ${missing.length} already gone` : ''}${failed.length ? `, could NOT delete ${failed.length} (will retry next start)` : ''}.`);
  }
  return results;
}

export async function startServer({ port = Number(process.env.PORT ?? 4317), host = '127.0.0.1', fake = false, logDir, quiet = false, archil: givenArchil = null } = {}) {
  const region = process.env.ARCHIL_REGION ?? 'aws-us-west-2';
  logDir ??= fake ? path.join(DEFAULT_LOG_DIR, 'fake') : DEFAULT_LOG_DIR;
  const log = (...a) => { if (!quiet) console.log(...a); };

  let archil = givenArchil;
  let archilProblem = null;
  if (archil) { /* supplied by the caller (tests) */ }
  else if (fake) archil = (await import('./fake.mjs')).fakeArchil();
  else if (!process.env.ARCHIL_API_KEY) archilProblem = 'ARCHIL_API_KEY is not set. Add it to .env, or start with --fake.';
  else {
    try { const { Archil } = await import('disk'); archil = new Archil({ region }); } catch (e) { archilProblem = describeError(e); }
  }
  const hasModelKey = fake || !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
  let anthropic = null;
  const modelClient = async () => {
    if (!anthropic) { const { default: Anthropic } = await import('@anthropic-ai/sdk'); anthropic = new Anthropic(); }
    return anthropic;
  };

  const runs = loadHistory(logDir);
  const page = () => readFileSync(path.join(here, 'public', 'index.html'));

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const readJson = (req) => new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('request body too large'), { http: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('body is not valid JSON'), { http: 400 })); } });
    req.on('error', reject);
  });

  function push(run, ev) {
    run.events.push(ev);
    if (ev.type === 'end') run.done = true;
    for (const l of [...run.listeners]) l(ev);
  }

  function startRun(body) {
    const kind = body.kind;
    if (!['agent', 'matrix'].includes(kind)) return [400, { error: 'kind must be "agent" or "matrix"' }];
    const mode = body.mode === 'live' ? 'live' : 'rehearse';
    const taskId = body.taskId ?? 'longform';
    if (kind === 'agent' && taskId !== 'custom' && !TASKS[taskId]) return [400, { error: `unknown task "${taskId}"` }];
    const taskText = typeof body.taskText === 'string' ? body.taskText.trim() : '';
    if (kind === 'agent' && taskId === 'custom' && mode === 'live' && (taskText.length < 10 || taskText.length > 4000)) return [400, { error: 'a custom task needs 10 to 4000 characters' }];
    if (!archil) return [400, { error: archilProblem }];
    if (kind === 'agent' && mode === 'live' && !hasModelKey) return [400, { error: 'ANTHROPIC_API_KEY is not set, so only rehearsals can run. Add it to .env.' }];
    const active = [...runs.values()].filter((r) => !r.done).length;
    if (active >= MAX_ACTIVE) return [429, { error: `${active} runs are already in progress; wait for one to finish` }];

    const tag = newTag();
    const run = { id: tag, events: [], listeners: new Set(), done: false };
    runs.set(tag, run);
    const emit = (ev) => push(run, ev);
    const common = { archil, emit, tag, region, logDir, simulated: fake };
    const job = kind === 'matrix'
      ? runMatrix(common)
      : (async () => runSession({ ...common, client: mode === 'live' && !fake ? await modelClient() : null, mode: fake ? 'rehearse' : mode, taskId, taskText, model: DEFAULT_MODEL }))();
    job.catch((e) => push(run, { type: 'error', text: describeError(e), at: Date.now() }))
      .finally(() => { if (!run.done) push(run, { type: 'end', ok: false, at: Date.now() }); log(`run ${tag} finished`); });
    log(`run ${tag} started: ${kind}, ${fake ? 'fake' : mode}`);
    return [202, { id: tag }];
  }

  function streamEvents(req, res, run) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    const write = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    for (const ev of run.events) write(ev);
    if (run.done) { res.end(); return; }
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 15000);
    const listener = (ev) => { write(ev); if (ev.type === 'end') res.end(); };
    run.listeners.add(listener);
    res.on('close', () => { clearInterval(heartbeat); run.listeners.delete(listener); });
  }

  async function route(req, res) {
    // Only this machine may talk to the server (also defeats DNS rebinding).
    const hostHeader = String(req.headers.host ?? '');
    if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(hostHeader)) return json(res, 403, { error: 'forbidden host' });
    const url = new URL(req.url, `http://${hostHeader}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(page());
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, {
        fake, region, image: IMAGE, model: DEFAULT_MODEL,
        archil: !!archil, archilProblem, modelKey: hasModelKey,
        tasks: Object.values(TASKS).map(({ id, title, text }) => ({ id, title, text })),
        classes: { ...CLASSES, open: OPEN },
        maxActive: MAX_ACTIVE,
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/runs') {
      return json(res, 200, [...runs.values()].map(summarize).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0)));
    }
    if (req.method === 'POST' && url.pathname === '/api/runs') {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${hostHeader}`) return json(res, 403, { error: 'forbidden origin' });
      if (!String(req.headers['content-type'] ?? '').includes('application/json')) return json(res, 415, { error: 'send application/json' });
      let body;
      try { body = await readJson(req); } catch (e) { return json(res, e.http ?? 400, { error: e.message }); }
      const [status, out] = startRun(body ?? {});
      return json(res, status, out);
    }
    const ev = /^\/api\/runs\/([a-z0-9]+)\/events$/.exec(url.pathname);
    if (req.method === 'GET' && ev) {
      const run = runs.get(ev[1]);
      if (!run) return json(res, 404, { error: 'no such run' });
      return streamEvents(req, res, run);
    }
    return json(res, 404, { error: 'not found' });
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => { if (!res.headersSent) json(res, 500, { error: describeError(e) }); else res.end(); });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  const actualPort = server.address().port;
  log(`Scoped Runner dashboard: http://${host}:${actualPort}/${fake ? '  (FAKE mode: stand-ins for Archil and the model)' : ''}`);
  if (archilProblem) log(`Note: ${archilProblem}`);
  // In the background: clean up after runs that a previous server (or a killed command-line
  // run) left unfinished. Callers that need the outcome can await `recovery`.
  const recovery = recoverInterrupted({ archil, runs, log }).catch((e) => { log(`Could not clean up interrupted runs: ${describeError(e)}`); return []; });
  return { server, port: actualPort, recovery, close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(() => r()); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const i = process.argv.indexOf('--port');
  const port = i > 0 ? Number(process.argv[i + 1]) : undefined;
  await startServer({ fake: process.argv.includes('--fake'), ...(port ? { port } : {}) });
}
