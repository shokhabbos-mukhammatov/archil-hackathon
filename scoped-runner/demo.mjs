// Runs the same four-step agent task twice on Archil, with no sandbox:
//   "open"     every call gets the workspace, the secrets, the web results and an open network
//   "limited"  every call gets only what its class is granted (see policy.mjs)
// and prints, for each call, what it could reach and whether the real step still worked.
//
//   node demo.mjs --dry-run     show the planned calls; no key, no network
//   node demo.mjs               live run; needs ARCHIL_API_KEY set in this terminal
//   node demo.mjs --keep        live run, and leave the demo disks in place afterwards
//
// A live run creates five disks named "scoped-demo-...", makes about twenty serverless
// calls, and deletes only the disks it created. It never prints your key or a disk token.
// The web search step sends one generic query to Keenable's keyless public endpoint.

import './env.mjs';
import { readdirSync, readFileSync, statSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeGrants, hasNetwork } from './policy.mjs';
import { buildCall, runCall, runStep, classOfStep, searchCommand, PROBE, parseProbe, parseSearch } from './runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const IMAGE = process.env.DEMO_IMAGE ?? 'node:22-slim';
const MODES = ['open', 'limited'];
const STEPS = [
  { tool: 'search', label: 'web search', query: 'npm ms package convert time string to milliseconds' },
  { tool: 'bash', label: 'read results', command: 'ls /mnt/archil/web' },
  { tool: 'bash', label: 'npm install', command: 'npm install --no-audit --no-fund' },
  { tool: 'bash', label: 'node --test', command: 'node --test' },
];
const show = (step) => (step.tool === 'search' ? `web search: "${step.query}"` : `$ ${step.command}`);

function walk(dir, rel = '') {
  return readdirSync(path.join(dir, rel)).flatMap((name) => {
    if (name === 'node_modules') return [];
    const r = rel ? `${rel}/${name}` : name;
    return statSync(path.join(dir, r)).isDirectory() ? walk(dir, r) : [r];
  });
}

if (args.has('--dry-run')) {
  const placeholders = { workspaceDisk: '<workspace disk>', secretsDisk: '<secrets disk>', webDisk: '<web results disk>', image: IMAGE };
  console.log(`Planned calls (image ${IMAGE}). Nothing is sent.\n`);
  for (const mode of MODES) {
    console.log(`=== ${mode} ===`);
    for (const step of STEPS) {
      const command = step.tool === 'search' ? searchCommand(step.query) : step.command;
      const { grants, request } = buildCall({ command, mode, forcedClass: step.tool === 'search' ? 'search' : undefined, ...placeholders });
      console.log(`\n${show(step)}\n  class: ${grants.class}  (${describeGrants(grants)})`);
      console.log(`  mounts: ${Object.entries(request.disks).map(([k, v]) => `${k}${v.readOnly ? ' (read-only)' : ''}`).join(', ')}`);
      console.log(`  network: ${request.network ? JSON.stringify(request.network.egress) : 'no policy (open)'}`);
    }
    console.log('');
  }
  process.exit(0);
}

if (!process.env.ARCHIL_API_KEY) {
  console.error('ARCHIL_API_KEY is not set in this terminal. Set it, or use --dry-run.');
  process.exit(2);
}

const { Archil } = await import('disk');
const region = process.env.ARCHIL_REGION ?? 'aws-us-west-2';
const archil = new Archil({ region });
const tag = Math.random().toString(36).slice(2, 8);
const created = [];
const logDir = path.join(here, 'runs');
mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `run-${tag}.jsonl`);
const log = (entry) => appendFileSync(logFile, JSON.stringify(entry) + '\n');
const tail = (s, n = 6) => String(s ?? '').trim().split('\n').slice(-n).join('\n    ');

async function newDisk(label) {
  const { disk } = await archil.disks.create({ name: `scoped-demo-${tag}-${label}` });
  created.push(disk);
  return disk;
}

async function cleanup() {
  if (args.has('--keep')) { console.log(`\nKept disks: ${created.map((d) => d.name).join(', ')}`); return; }
  console.log('\nDeleting the disks this run created...');
  for (const d of created) {
    try { await d.delete(); console.log(`  deleted ${d.name}`); } catch (e) { console.log(`  could NOT delete ${d.name} (${d.id}): ${String(e?.message ?? e).slice(0, 160)}`); }
  }
}

const rows = [];
try {
  console.log(`Scoped runner demo, region ${region}, image ${IMAGE}, run tag ${tag}`);
  const secrets = await newDisk('secrets');
  await secrets.putObject('config.json', JSON.stringify({ serviceName: 'billing', apiKey: `CANARY-${tag}` }) + '\n');
  const appFiles = walk(path.join(here, 'sample-app'));

  for (const mode of MODES) {
    const workspace = await newDisk(`ws-${mode}`);
    const web = await newDisk(`web-${mode}`);
    for (const f of appFiles) await workspace.putObject(f, readFileSync(path.join(here, 'sample-app', f)));
    console.log(`\n=== ${mode}: workspace ${workspace.name}, ${appFiles.length} files uploaded ===`);
    const base = { mode, workspaceDisk: workspace, secretsDisk: secrets, webDisk: web, image: IMAGE, secretValues: [`CANARY-${tag}`] };

    for (const step of STEPS) {
      const stepClass = classOfStep(step, mode);
      // What could a call with this step's grants reach? (Same grants, harmless report.)
      const probeRun = await runCall(archil, { ...base, command: PROBE, forcedClass: mode === 'open' ? undefined : stepClass });
      const probe = parseProbe(probeRun.stdout);
      // The real step.
      const run = await runStep(archil, step, base);
      const search = step.tool === 'search' ? parseSearch(run.stdout) : null;
      const worked = step.tool === 'search' ? search?.status === 200 && search.count > 0 : run.ok;

      console.log(`\n${show(step)}\n  class: ${run.grants.class}  (${describeGrants(run.grants)})`);
      console.log(`  reach:   ${probe ? `secrets ${probe.secrets}; workspace write ${probe.workspaceWrite}; web results write ${probe.webWrite}; outside network ${probe.outside}` : `probe failed: ${probeRun.error ?? tail(probeRun.stderr || probeRun.stdout, 3)}`}`);
      console.log(`  result:  ${run.error ? run.error : `exit ${run.exitCode} in ${run.wallMs} ms (queue ${run.timing?.queueMs ?? '?'} ms)`}`);
      if (search) console.log(`  search:  ${search.error ? `failed (${search.error})` : `HTTP ${search.status}, ${search.count} result(s), saved to ${search.saved}${search.results?.[0] ? `\n           first: ${search.results[0].title} (${search.results[0].url})` : ''}`}`);
      if (step.label === 'read results') console.log(`  output:  ${tail(run.stdout, 3) || '(nothing)'}`);
      if (!worked && !search) console.log(`    ${tail(run.stderr || run.stdout)}`);

      rows.push({ mode, label: step.label, class: run.grants.class, grants: run.grants, probe, worked, exitCode: run.exitCode, wallMs: run.wallMs });
      log({ mode, step, grants: run.grants, probe, search, exitCode: run.exitCode, wallMs: run.wallMs, timing: run.timing, error: run.error, stdoutTail: tail(run.stdout, 12), stderrTail: tail(run.stderr, 12) });
    }
  }

  console.log('\n=== summary ===');
  console.log('mode     | step         | class   | secrets        | workspace write | web write    | outside network | step');
  for (const r of rows) {
    const p = r.probe ?? {};
    console.log(`${r.mode.padEnd(8)} | ${r.label.padEnd(12)} | ${r.class.padEnd(7)} | ${String(p.secrets ?? '?').padEnd(14)} | ${String(p.workspaceWrite ?? '?').padEnd(15)} | ${String(p.webWrite ?? '?').padEnd(12)} | ${String(p.outside ?? '?').padEnd(15)} | ${r.worked ? 'worked' : `FAILED (exit ${r.exitCode})`}`);
  }
  const limited = rows.filter((r) => r.mode === 'limited');
  const byPolicy = limited.every((r) => !(r.grants.secrets !== 'none' && hasNetwork(r.grants)));
  const byProbe = limited.every((r) => !(r.probe?.secrets === 'readable' && r.probe?.outside === 'reachable'));
  console.log(`\nUnder limits, was any call granted the secrets and network access together?  ${byPolicy ? 'No.' : 'YES - the policy is wrong.'}`);
  console.log(`Under limits, did any call that could read the secrets reach an outside host?  ${byProbe ? 'No.' : 'YES - the limits did not hold.'}`);
  console.log(`Under limits, did the real steps still work?  ${limited.every((r) => r.worked) ? 'Yes, all of them.' : 'No - see the failures above.'}`);
  console.log(`Full log: ${logFile}`);
} catch (e) {
  console.error(`\nStopped: ${e?.name ?? 'Error'} status=${e?.status ?? '?'}: ${String(e?.message ?? e).slice(0, 300)}`);
} finally {
  await cleanup();
}
