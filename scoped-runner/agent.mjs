// Command-line entry point. The same sessions the web dashboard runs (see session.mjs),
// printed to the terminal.
//
//   node agent.mjs --selftest   exercise the loop with stand-ins; no keys, no network
//   node agent.mjs --fake       a whole session against stand-ins for Archil and the model
//   node agent.mjs --rehearse   real Archil calls, scripted steps in place of a model
//   node agent.mjs              the real agent; needs ARCHIL_API_KEY and ANTHROPIC_API_KEY
//   node agent.mjs --matrix     measure what each access class can reach (real Archil)
//   add --keep                  to leave the run's disks in place afterwards
//
// A live run creates three disks named "scoped-agent-..." (or "scoped-matrix-..."), and
// deletes them at the end.

import './env.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { describeGrants } from './policy.mjs';
import { runAgent, DEFAULT_MODEL } from './loop.mjs';
import { runSession, runMatrix, IMAGE, DEFAULT_LOG_DIR } from './session.mjs';
import { REDACTED } from './scrub.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));

// ---------------------------------------------------------------------------------------
// Self-test: a scripted stand-in for the model and a recording stand-in for Archil.
// ---------------------------------------------------------------------------------------
async function selftest() {
  const SECRET = 'CANARY-selftest-0123456789';
  const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const script = [
    { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Looking first.' }, use('t1', 'web_search', { query: 'ms package long format' }), use('t2', 'bash', { command: 'cat src/greet.js' })] },
    { stop_reason: 'tool_use', content: [use('t3', 'write_file', { path: 'src/greet.js', content: "export const x = '1';\n" }), use('t4', 'write_file', { path: '../secrets/config.json', content: 'y' })] },
    { stop_reason: 'tool_use', content: [use('t5', 'bash', { command: 'npm install' })] },
    { stop_reason: 'tool_use', content: [use('t6', 'bash', { command: 'node --test' }), use('t7', 'bash', { command: 'npm install && cat /mnt/archil/secrets/config.json' })] },
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
      // A careless test that prints its configuration.
      if (request.command.endsWith('node --test')) stdout = `config: {"apiKey":"${SECRET}"}\n# pass 2`;
      return { exitCode: 0, stdout, stderr: '', timing: { queueMs: 1, totalMs: 2 } };
    },
  };
  const base = { mode: 'limited', workspaceDisk: 'dsk-w', secretsDisk: 'dsk-s', webDisk: 'dsk-web', image: IMAGE, secretValues: [SECRET] };
  const texts = [];
  const { calls, finalText, ended, messages } = await runAgent({ client, archil, base, task: 'test task', onText: (t) => texts.push(t.text) });

  assert.equal(ended, 'the agent finished');
  assert.equal(finalText, 'Done.');
  assert.deepEqual(texts, ['Looking first.']);
  assert.deepEqual(calls.map((c) => c.class), ['search', 'other', 'edit', 'install', 'test', 'other'], 'each call is classed by the fixed rules');
  assert.equal(requests.length, 6, 'the rejected write never reached Archil');
  // A chained command that names the secrets path is a plain command: no secrets mounted.
  assert.ok(!requests[5].disks.secrets && requests[5].disks.app.readOnly, 'a chained command gets the least access');
  for (const r of requests) {
    const net = r.network?.egress;
    assert.ok(net && net.default === 'deny', 'every limited call carries a deny-by-default network rule');
    assert.ok(!(r.disks.secrets && (net.allow?.length ?? 0) > 0), 'no call mounts the secrets with network access');
    assert.ok(!(r.disks.secrets && Object.values(r.disks).some((d) => !d.readOnly)), 'no call that mounts the secrets can write anywhere shared');
    assert.ok(!JSON.stringify(r).includes(SECRET), 'the secret value is never sent to Archil');
  }
  // Every tool call the model made got exactly one result, in the very next message.
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
    const ids = m.content.filter((b) => b.type === 'tool_use').map((b) => b.id);
    if (!ids.length) continue;
    const next = messages[i + 1];
    assert.equal(next.role, 'user');
    assert.deepEqual(next.content.map((b) => b.tool_use_id), ids);
  }
  const results = messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result');
  assert.equal(results.find((b) => b.tool_use_id === 't4').is_error, true, 'a write outside the workspace is refused before any call is made');
  // The secret the test printed never reaches the model; the model is told it was removed.
  const testResult = String(results.find((b) => b.tool_use_id === 't6').content);
  assert.ok(!JSON.stringify(messages).includes(SECRET), 'no secret value anywhere in the conversation');
  assert.ok(testResult.includes(REDACTED) && testResult.includes('were removed'));
  assert.equal(calls[4].redactions, 1);
  assert.equal(seenParams[0].model, DEFAULT_MODEL);
  assert.equal(seenParams[0].tools.length, 3);
  assert.equal(seenParams[0].fallbacks, 'default');
  console.log('Self-test passed: 6 calls classed correctly, 1 unsafe write refused, every tool call answered, no call had the secrets with network access, and a printed secret was removed before the model saw it.');
}

// ---------------------------------------------------------------------------------------
// Terminal printer for session events.
// ---------------------------------------------------------------------------------------
function printer(e) {
  switch (e.type) {
    case 'start':
      if (e.kind === 'matrix') console.log(`Access matrix${e.simulated ? ' (FAKE: stand-ins, nothing leaves this machine)' : ''}, region ${e.region}, image ${e.image}, run tag ${e.id}`);
      else console.log(`Scoped agent, ${e.simulated ? 'FAKE (stand-ins for Archil and the model)' : e.mode === 'rehearse' ? 'REHEARSAL (steps are scripted, not chosen by a model)' : `model ${e.model}`}, region ${e.region}, image ${e.image}, run tag ${e.id}\nTask: ${e.task.title}\n`);
      break;
    case 'disks': console.log(`Disks: ${e.names.join(', ')}`); break;
    case 'status': console.log(e.text); break;
    case 'say': console.log(`  .   ${e.text.split('\n')[0].slice(0, 110)}`); break;
    case 'rejected': console.log(`  --  ${e.label}: ${e.problem}`); break;
    case 'call': {
      const c = e.call;
      console.log(`  #${String(c.n).padStart(2)}  ${c.class.padEnd(7)}  ${c.label.slice(0, 70)}\n       ${describeGrants(c.grants)}  ->  ${c.error ? c.error : `exit ${c.exitCode}, ${c.wallMs} ms`}${c.redactions ? `, ${c.redactions} secret value(s) redacted` : ''}`);
      break;
    }
    case 'matrix-row': {
      const r = e.row;
      console.log(`  ${r.class.padEnd(8)} secrets ${String(r.secrets).padEnd(13)} workspace write ${String(r.workspaceWrite).padEnd(11)} web write ${String(r.webWrite).padEnd(11)} outside ${String(r.outside).padEnd(9)}${r.redactions ? ` (${r.redactions} redacted)` : ''}${r.error ? `  error: ${r.error}` : ''}`);
      break;
    }
    case 'agent-done':
      console.log(`\nAgent stopped after ${e.calls} calls in ${e.seconds} s: ${e.ended}.`);
      if (e.finalText) console.log(`Agent's summary:\n  ${e.finalText.split('\n').join('\n  ')}`);
      console.log('');
      break;
    case 'check': console.log(`${e.check.ok ? 'PASS' : 'FAIL'}  ${e.check.label}  (${e.check.detail})`); break;
    case 'summary': {
      const s = e.summary;
      if (s.byClass) console.log(`\n=== access summary ===\n${Object.entries(s.byClass).map(([k, n]) => `${String(n).padStart(3)} call(s) as ${k}`).join('\n')}\nSecret values redacted from output: ${s.redactions}\nArchil calls in total: ${s.archilCalls}`);
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
  if (fake) archil = (await import('./fake.mjs')).fakeArchil({ delayMs: 20 });
  else {
    if (!process.env.ARCHIL_API_KEY) { console.error('ARCHIL_API_KEY is not set (in this terminal or in a .env file). Try --fake or --selftest.'); process.exit(2); }
    const { Archil } = await import('disk');
    archil = new Archil({ region });
  }
  const logDir = fake ? path.join(DEFAULT_LOG_DIR, 'fake') : DEFAULT_LOG_DIR;
  let logName = '';
  const emit = (e) => { if (e.type === 'start') logName = e.log; printer(e.type === 'end' ? { ...e, log: path.relative(here, path.join(logDir, logName)) } : e); };
  const common = { archil, emit, region, logDir, keep: args.has('--keep'), simulated: fake };
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
