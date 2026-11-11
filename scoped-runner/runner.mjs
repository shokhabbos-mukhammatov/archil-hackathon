// Turns one agent tool call into one Archil serverless call that mounts only what the
// call's class is granted. There is no sandbox: each call is a fresh microVM.

import { grantsFor } from './policy.mjs';
import { scrub } from './scrub.mjs';

export const ROOT = '/mnt/archil';
export const APP_DIR = `${ROOT}/app`;
export const SECRETS_DIR = `${ROOT}/secrets`;
export const WEB_DIR = `${ROOT}/web`;

export function buildCall({ command, mode, forcedClass, workspaceDisk, secretsDisk, webDisk, image }) {
  const grants = grantsFor(command, mode, forcedClass);
  const disks = {};
  if (grants.app === 'write') disks.app = { disk: workspaceDisk, queueMs: 15000 };
  if (grants.app === 'read') disks.app = { disk: workspaceDisk, readOnly: true };
  if (grants.secrets === 'read') disks.secrets = { disk: secretsDisk, readOnly: true };
  if (grants.web === 'write') disks.web = { disk: webDisk, queueMs: 15000 };
  if (grants.web === 'read') disks.web = { disk: webDisk, readOnly: true };
  const request = { disks, command: `cd ${disks.app ? APP_DIR : ROOT} && ${command}` };
  if (image) request.baseImage = image;
  if (grants.network) request.network = { egress: grants.network };
  return { grants, request };
}

// A harmless report of what a call with these grants can reach: one known file, one write
// per folder, one outside request. It changes nothing and sends nothing outside. When the
// secrets are readable it prints the (throwaway canary) configuration, so the host can show
// that the scrubber removed the secret value from what came back.
export const PROBE = `node -e '
const fs = require("fs");
const readText = (p) => { try { return fs.readFileSync(p, "utf8").trim(); } catch { return null; } };
const write = (dir) => { if (!fs.existsSync(dir)) return "not mounted"; const p = dir + "/.probe"; try { fs.writeFileSync(p, "x"); try { fs.rmSync(p); } catch {} return "allowed"; } catch { return "refused"; } };
(async () => {
  let outside;
  try { await fetch("https://example.com", { signal: AbortSignal.timeout(6000) }); outside = "reachable"; }
  catch { outside = "blocked"; }
  const secretText = readText("${SECRETS_DIR}/config.json");
  console.log("PROBE " + JSON.stringify({ secrets: secretText === null ? "not available" : "readable", secretText, workspaceWrite: write("${APP_DIR}"), webWrite: write("${WEB_DIR}"), outside }));
})();'`;

// The web search tool. The query is data, never shell text: it travels as base64, whose
// alphabet has no shell meaning, and is decoded inside the call.
const SEARCH_SCRIPT = `node -e '
const fs = require("fs");
const query = Buffer.from(process.argv[1], "base64").toString("utf8");
(async () => {
  try {
    const r = await fetch("https://api.keenable.ai/v1/search/public", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Keenable-Title": "scoped-runner-demo" },
      body: JSON.stringify({ query, max_results: 3, mode: "realtime" }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await r.text();
    let results = [];
    try { results = (JSON.parse(text).results || []).map((x) => ({ title: x.title, url: x.url, published_at: x.published_at, snippet: String(x.snippet || "").slice(0, 1500) })); } catch {}
    let saved;
    try { const file = "${WEB_DIR}/search-" + Date.now() + ".json"; fs.writeFileSync(file, JSON.stringify({ query, fetched_at: new Date().toISOString(), results }, null, 2)); saved = file; }
    catch (e) { saved = "not saved (" + (e.code || e.message) + ")"; }
    console.log("SEARCH " + JSON.stringify({ status: r.status, count: results.length, saved, results: results.map((x) => ({ title: x.title, url: x.url, published_at: x.published_at })) }));
  } catch (e) {
    console.log("SEARCH " + JSON.stringify({ status: 0, error: String((e.cause && e.cause.code) || e.message) }));
  }
})();'`;

export function searchCommand(query) {
  return `${SEARCH_SCRIPT} ${Buffer.from(String(query), 'utf8').toString('base64')}`;
}

// The file-writing tool. Path and content both travel as base64 and are decoded inside the
// call; the path is checked here and again inside the call to stay within the workspace.
const WRITE_SCRIPT = `node -e '
const fs = require("fs"), path = require("path");
const rel = Buffer.from(process.argv[1], "base64").toString("utf8");
const body = Buffer.from(process.argv[2] || "", "base64");
const full = path.resolve("${APP_DIR}", rel);
if (!full.startsWith("${APP_DIR}/")) { console.log("WRITE refused: outside the workspace"); process.exit(1); }
fs.mkdirSync(path.dirname(full), { recursive: true });
fs.writeFileSync(full, body);
console.log("WRITE ok " + rel + " (" + body.length + " bytes)");'`;

export function checkWorkspacePath(relPath) {
  const p = String(relPath ?? '');
  if (!p || p.startsWith('/') || p.includes('\\') || !/^[A-Za-z0-9._\/-]+$/.test(p)) return 'path must be a plain relative path inside the project';
  if (p.split('/').some((part) => part === '..' || part === '.' || part === '')) return 'path must not contain "..", "." or empty segments';
  if (p.split('/')[0] === 'node_modules') return 'node_modules is managed by the install step';
  return null;
}

export function writeFileCommand(relPath, content) {
  const problem = checkWorkspacePath(relPath);
  if (problem) throw new Error(problem);
  const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');
  return `${WRITE_SCRIPT} ${b64(relPath)} ${b64(content ?? '')}`;
}

function parseTagged(stdout, tag) {
  const line = String(stdout ?? '').split('\n').find((l) => l.startsWith(tag + ' '));
  if (!line) return null;
  try { return JSON.parse(line.slice(tag.length + 1)); } catch { return null; }
}
export const parseProbe = (stdout) => parseTagged(stdout, 'PROBE');
export const parseSearch = (stdout) => parseTagged(stdout, 'SEARCH');

// Runs one call. `options.secretValues` lists values the host knows are secret; they are
// never sent to Archil (buildCall does not read them) and are removed from everything the
// call returns, here, at the one point where output leaves Archil.
export async function runCall(archil, options) {
  const { grants, request } = buildCall(options);
  const secrets = options.secretValues ?? [];
  const started = Date.now();
  try {
    const result = await archil.exec(request);
    const out = scrub(result.stdout ?? '', secrets);
    const err = scrub(result.stderr ?? '', secrets);
    return { grants, ok: result.exitCode === 0, exitCode: result.exitCode, stdout: out.text, stderr: err.text, redactions: out.hits + err.hits, wallMs: Date.now() - started, timing: result.timing };
  } catch (e) {
    const msg = scrub(String(e?.message ?? e), secrets);
    return { grants, ok: false, exitCode: null, stdout: '', stderr: '', redactions: msg.hits, error: `${e?.name ?? 'Error'} status=${e?.status ?? '?'}: ${msg.text.slice(0, 300)}`, wallMs: Date.now() - started };
  }
}

// One agent step: a bash command, a web search, or a file write.
export function runStep(archil, step, base) {
  if (step.tool === 'search') return runCall(archil, { ...base, command: searchCommand(step.query), forcedClass: 'search' });
  if (step.tool === 'write') return runCall(archil, { ...base, command: writeFileCommand(step.path, step.content), forcedClass: 'edit' });
  return runCall(archil, { ...base, command: step.command });
}
export function classOfStep(step, mode) {
  if (mode === 'open') return 'open';
  if (step.tool === 'search') return 'search';
  if (step.tool === 'write') return 'edit';
  return grantsFor(step.command, mode).class;
}
