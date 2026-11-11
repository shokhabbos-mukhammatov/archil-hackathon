// Command-line entry point. The same sessions the web dashboard runs (see session.mjs),
// printed to the terminal.
//
//   node agent.mjs --selftest       exercise the loop with stand-ins; no keys, no network
//   node agent.mjs --fake           a whole session against stand-ins for Archil and the service
//   node agent.mjs --rehearse       real Archil calls, scripted steps in place of a model
//   node agent.mjs                  the real agent; needs ARCHIL_API_KEY and ANTHROPIC_API_KEY
//   node agent.mjs --matrix         measure what each access class can reach (real Archil)
//   node agent.mjs --stop-service   delete the sandbox that hosts the project's service
//   add --keep                      to leave the run's disks in place afterwards
//
// A live run starts (or reuses) the project's service in a small sandbox named
// "scoped-runner-service", creates two disks named "scoped-agent-..." (or three named
// "scoped-matrix-..."), and deletes the disks at the end. The service sandbox is left running
// for later runs; it stops by itself after eight hours.

import './env.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describeGrants } from './policy.mjs';
import { runAgent, outboundRefusal, DEFAULT_MODEL } from './loop.mjs';
import { runSession, runMatrix, IMAGE, DEFAULT_LOG_DIR, describeError } from './session.mjs';
import { startService, stopService } from './service.mjs';
import { REDACTED } from './scrub.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));

// ---------------------------------------------------------------------------------------
// Self-test: a scripted stand-in for the model and a recording stand-in for Archil.
// ---------------------------------------------------------------------------------------
async function selftest() {
  const KEY = 'svc_selftest0123456789abcdef0123456789';
  const SERVICE = { host: 'service.example.test', headers: { Authorization: `Bearer ${KEY}` } };
  const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const script = [
    { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Looking first.' }, use('t1', 'web_search', { query: 'ms package long format' }), use('t2', 'bash', { command: 'cat src/greet.js' })] },
    { stop_reason: 'tool_use', content: [use('t3', 'write_file', { path: 'src/greet.js', content: "export const x = '1';\n" }), use('t4', 'write_file', { path: '../secrets/config.json', content: 'y' })] },
    { stop_reason: 'tool_use', content: [use('t5', 'bash', { command: 'npm install' })] },
    { stop_reason: 'tool_use', content: [use('t6', 'bash', { command: 'node --test' }), use('t7', 'bash', { command: 'npm install && cat service.json' })] },
    { stop_reason: 'tool_use', content: [use('t8', 'web_search', { query: 'anything at all' }), use('t9', 'bash', { command: 'npm install left-pad' })] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Done.' }] },
  ];
  const seenParams = [];
  const client = { beta: { messages: { create: async (params) => { seenParams.push({ ...params, messages: structuredClone(params.messages) }); return script[seenParams.length - 1]; } } } };
  const requests = [];
  const archil = {
    exec: async (request) => {
      requests.push(request);
      let stdout = 'ok';
      if (request.command.includes('api.keenable.ai')) stdout = 'SEARCH {"status":200,"count":1,"saved":"/mnt/archil/web/search-1.json","results":[{"title":"ms","url":"https://example.com/ms"}]}';
      // A service that wrongly echoes the key back, printed by a test.
      if (request.command.endsWith('node --test')) stdout = `account: {"echo":"Bearer ${KEY}"}\n# pass 2`;
      return { exitCode: 0, stdout, stderr: '', timing: { queueMs: 1, totalMs: 2 } };
    },
  };
  const base = { mode: 'limited', workspaceDisk: 'dsk-w', webDisk: 'dsk-web', image: IMAGE, service: SERVICE, secretValues: [KEY] };
  const texts = [];
  const refusals = [];
  const { calls, refused, finalText, ended, messages } = await runAgent({ client, archil, base, task: 'test task', onText: (t) => texts.push(t.text), onCall: (c) => { if (c.refused) refusals.push(c); } });

  assert.equal(ended, 'the agent finished');
  assert.equal(finalText, 'Done.');
  assert.deepEqual(texts, ['Looking first.']);
  assert.deepEqual(calls.map((c) => c.class), ['search', 'other', 'edit', 'install', 'test', 'other'], 'each call is classed by the fixed rules');
  assert.equal(requests.length, 6, 'the refused and rejected calls never reached Archil');
  // After the test run, calls that send data outside the project are refused.
  assert.equal(refused, 2);
  assert.deepEqual(refusals.map((c) => c.class), ['search', 'install']);
  // A chained command is a plain command: no service, no network.
  assert.ok(requests[5].disks.app.readOnly && requests[5].network.egress.default === 'deny' && !requests[5].network.egress.allow, 'a chained command gets the least access');
  // The key is in exactly one place: the test call's network rule, which Archil applies.
  const testReq = requests[4];
  assert.deepEqual(testReq.network.egress, { default: 'deny', allow: [{ target: SERVICE.host, transform: { headers: SERVICE.headers } }] });
  for (const r of requests) {
    assert.ok(!r.command.includes(KEY) && !JSON.stringify(r.disks).includes(KEY), 'the key is never in a command or on a disk');
    if (r !== testReq) assert.ok(!JSON.stringify(r).includes(KEY), 'no other call carries the key at all');
    assert.ok(r.network?.egress?.default === 'deny', 'every limited call carries a deny-by-default network rule');
  }
  // Every tool call the model made got exactly one result, in the very next message.
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const ids = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
    if (!ids.length) continue;
    assert.deepEqual(messages[i + 1].content.map((b) => b.tool_use_id), ids);
  }
  const results = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result');
  assert.equal(results.find((b) => b.tool_use_id === 't4').is_error, true, 'a write outside the workspace is refused before any call is made');
  assert.match(String(results.find((b) => b.tool_use_id === 't8').content), /^Refused/);
  // A key echoed by the service never reaches the model.
  assert.ok(!JSON.stringify(messages).includes(KEY), 'no secret value anywhere in the conversation');
  assert.ok(String(results.find((b) => b.tool_use_id === 't6').content).includes(REDACTED));
  assert.equal(calls[4].redactions, 1);
  // Outgoing text that contains a secret, in any form the scrubber knows, is refused.
  assert.match(outboundRefusal('search', `q ${Buffer.from(KEY).toString('base64')}`, { sawServiceData: false, secretValues: [KEY] }), /secret/);
  assert.equal(outboundRefusal('edit', KEY, { sawServiceData: true, secretValues: [KEY] }), null, 'only classes that reach third parties are limited');
  assert.equal(seenParams[0].model, DEFAULT_MODEL);
  assert.equal(seenParams[0].fallbacks, 'default');
  console.log('Self-test passed: 6 calls classed correctly; 1 unsafe write and 2 outbound calls after the test run refused; the key appears only in the test call\'s network rule; an echoed key was removed before the model saw it.');
}

// ---------------------------------------------------------------------------------------
// Terminal printer for session events.
// ---------------------------------------------------------------------------------------
const pad = (s, n) => String(s ?? '?').padEnd(n);
function printer(e) {
  switch (e.type) {
    case 'start':
      if (e.kind === 'matrix') console.log(`Access matrix${e.simulated ? ' (FAKE: stand-ins, nothing leaves this machine)' : ''}, region ${e.region}, image ${e.image}, run tag ${e.id}`);
      else console.log(`Scoped agent, ${e.simulated ? 'FAKE (stand-ins for Archil, the service and the model)' : e.mode === 'rehearse' ? 'REHEARSAL (steps are scripted, not chosen by a model)' : `model ${e.model}`}, region ${e.region}, image ${e.image}, run tag ${e.id}\nTask: ${e.task.title}\n`);
      break;
    case 'disks': console.log(`Disks: ${e.names.join(', ')}`); break;
    case 'status': console.log(e.text); break;
    case 'say': console.log(`  .   ${e.text.split('\n')[0].slice(0, 110)}`); break;
    case 'rejected': console.log(`  --  ${e.refused ? 'REFUSED ' : ''}${e.label}: ${e.problem}`); break;
    case 'call': {
      const c = e.call;
      console.log(`  #${String(c.n).padStart(2)}  ${c.class.padEnd(7)}  ${c.label.slice(0, 70)}\n       ${describeGrants(c.grants)}  ->  ${c.error ? c.error : `exit ${c.exitCode}, ${c.wallMs} ms`}${c.redactions ? `, ${c.redactions} secret value(s) redacted` : ''}`);
      break;
    }
    case 'matrix-row': case 'measure': {
      const rows = e.type === 'measure' ? e.rows : [e.row];
      if (e.type === 'measure') console.log('Measured, per class:');
      for (const r of rows) console.log(`  ${pad(r.class, 8)} key inside ${pad(r.keyInside ? 'YES' : 'no', 4)} service ${pad(r.service, 18)} outside ${pad(r.outside, 10)} write project ${pad(r.workspaceWrite, 12)} write web ${pad(r.webWrite, 12)} DNS ${r.dns}${r.error ? `  error: ${r.error}` : ''}`);
      break;
    }
    case 'agent-done':
      console.log(`\nAgent stopped after ${e.calls} calls in ${e.seconds} s${e.refused ? ` (${e.refused} refused)` : ''}: ${e.ended}.`);
      if (e.finalText) console.log(`Agent's summary:\n  ${e.finalText.split('\n').join('\n  ')}`);
      console.log('');
      break;
    case 'check': console.log(`${e.check.ok ? 'PASS' : 'FAIL'}  ${e.check.label}  (${e.check.detail})`); break;
    case 'gap': console.log(`NOTE  Known platform gap: ${e.text}`); break;
    case 'summary': {
      const s = e.summary;
      if (s.byClass) console.log(`\n=== summary ===\n${Object.entries(s.byClass).map(([k, n]) => `${String(n).padStart(3)} call(s) as ${k}`).join('\n')}\nRefused: ${s.refused}. Secret values removed from output: ${s.redactions}. Archil calls in total: ${s.archilCalls}.`);
      break;
    }
    case 'error': console.error(`\nStopped: ${e.text}`); break;
    case 'cleanup':
      if (e.kept?.length) console.log(`\nKept disks: ${e.kept.join(', ')}`);
      for (const n of e.deleted ?? []) console.log(`  deleted ${n}`);
      for (const f of e.failed ?? []) console.log(`  could NOT delete ${f}`);
      break;
    case 'end': console.log(`\n${e.ok ? 'All checks passed.' : 'Not all checks passed.'} Log: ${e.log ?? ''}`); break;
  }
}

async function live() {
  const fake = args.has('--fake');
  const region = process.env.ARCHIL_REGION ?? 'aws-us-west-2';
  let archil;
  let service;
  if (fake) {
    const f = await import('./fake.mjs');
    service = f.fakeService();
    archil = f.fakeArchil({ delayMs: 20, service });
  } else {
    if (!process.env.ARCHIL_API_KEY) { console.error('ARCHIL_API_KEY is not set (in this terminal or in a .env file). Try --fake or --selftest.'); process.exit(2); }
    const { Archil } = await import('disk');
    archil = new Archil({ region });
    if (args.has('--stop-service')) { console.log((await stopService(archil)) ? 'Deleted the service sandbox.' : 'No service sandbox was running.'); return; }
    try { service = await startService(archil, { log: console.log, image: IMAGE }); }
    catch (e) { console.error(`The project's service could not start: ${describeError(e)}`); process.exit(1); }
  }
  const logDir = fake ? path.join(DEFAULT_LOG_DIR, 'fake') : DEFAULT_LOG_DIR;
  let logName = '';
  const emit = (e) => { if (e.type === 'start') logName = e.log; printer(e.type === 'end' ? { ...e, log: path.relative(here, path.join(logDir, logName)) } : e); };
  const common = { archil, service, emit, region, logDir, keep: args.has('--keep'), simulated: fake };
  if (args.has('--matrix')) { await runMatrix(common); return; }

  const rehearse = fake || args.has('--rehearse');
  let client = null;
  if (!rehearse) {
    if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
      console.error('No Anthropic key found. Add a line ANTHROPIC_API_KEY=... to your .env file, or run with --rehearse to use scripted steps.');
      process.exit(2);
    }
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    client = new Anthropic();
  }
  await runSession({ ...common, client, mode: rehearse ? 'rehearse' : 'live', model: DEFAULT_MODEL });
}

if (args.has('--selftest')) await selftest();
else await live();
