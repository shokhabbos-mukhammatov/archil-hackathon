// The sample project's own service: a tiny HTTP API that answers /v1/account only when a
// request carries a valid API key. It stands in for whatever API a real project's tests call.
//
// It runs in one small Archil sandbox, because a long-lived server needs one (a serverless
// call ends with its command). The sandbox is shared by all runs and reused across restarts.
// Each run registers its own key when it starts and removes it when it ends, so a key is
// only valid while its run is going. Keys live only in the host process, in this sandbox,
// and in the egress rule Archil applies to the test class; never inside an agent's call.

import { randomBytes } from 'node:crypto';

export const SERVICE_NAME = 'scoped-runner-service';
export const SERVICE_PORT = 8080;
const KEYS_DIR = '/srv/keys';

// Plain Node, no dependencies. Accepts any key file present in KEYS_DIR.
export const SERVICE_SOURCE = `
const http = require("http"), fs = require("fs"), crypto = require("crypto");
const DIR = ${JSON.stringify(KEYS_DIR)};
const valid = (given) => {
  let names = []; try { names = fs.readdirSync(DIR); } catch {}
  const g = Buffer.from(String(given));
  return names.some((n) => {
    try { const k = Buffer.from("Bearer " + fs.readFileSync(DIR + "/" + n, "utf8").trim()); return k.length === g.length && crypto.timingSafeEqual(k, g); }
    catch { return false; }
  });
};
const send = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
http.createServer((req, res) => {
  if (req.url === "/health") return send(res, 200, { ok: true });
  if (req.url === "/v1/account") return valid(req.headers.authorization || "") ? send(res, 200, { serviceName: "billing", plan: "team" }) : send(res, 401, { error: "missing or wrong API key" });
  send(res, 404, { error: "not found" });
}).listen(${SERVICE_PORT}, "0.0.0.0");
`;

export const newServiceKey = () => `svc_${randomBytes(20).toString('hex')}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function healthy(host) {
  try { const r = await fetch(`https://${host}/health`, { signal: AbortSignal.timeout(5000) }); return r.ok; } catch { return false; }
}

// Finds or creates the service sandbox and makes sure the service is answering.
// Returns { host, url, addKey(tag, key), removeKey(tag), stop() }.
export async function startService(archil, { log = () => {}, image = 'node:22-slim' } = {}) {
  let sandbox = (await archil.sandboxes.list()).find((s) => s.name === SERVICE_NAME);
  if (sandbox && sandbox.status !== 'running') {
    log(`Service sandbox was ${sandbox.status}; replacing it.`);
    try { await sandbox.stop(); } catch {}
    await sandbox.delete();
    sandbox = null;
  }
  if (!sandbox) {
    log('Starting the sample project\'s service in a small Archil sandbox...');
    sandbox = await archil.sandboxes.create({ name: SERVICE_NAME, baseImage: image, vcpuCount: 1, memSizeMiB: 512, maxTtlSeconds: 8 * 3600 });
  }
  const host = await sandbox.exposePort(SERVICE_PORT);
  if (!(await healthy(host))) {
    await sandbox.files.uploadFile(Buffer.from(SERVICE_SOURCE), '/srv/service.js');
    await sandbox.exec(`mkdir -p ${KEYS_DIR}`);
    // run() and disconnect() leave the process running; a background job started inside
    // exec() would end with the exec.
    const proc = await sandbox.run('node /srv/service.js');
    await sleep(1000);
    await proc.disconnect();
    let up = false;
    for (let i = 0; i < 15 && !(up = await healthy(host)); i++) await sleep(1000);
    if (!up) throw new Error('the sample service did not come up in its sandbox');
  }
  log(`Service ready at https://${host}`);
  return {
    host,
    url: `https://${host}`,
    async addKey(tag, key) { await sandbox.files.uploadFile(Buffer.from(key), `${KEYS_DIR}/${String(tag).replace(/[^a-z0-9]/g, '')}`); },
    async removeKey(tag) { await sandbox.exec(`rm -f ${KEYS_DIR}/${String(tag).replace(/[^a-z0-9]/g, '')}`); },
    async stop() { try { await sandbox.stop(); } catch {} await sandbox.delete(); },
  };
}

export async function stopService(archil) {
  const sandbox = (await archil.sandboxes.list()).find((s) => s.name === SERVICE_NAME);
  if (!sandbox) return false;
  try { await sandbox.stop(); } catch {}
  await sandbox.delete();
  return true;
}
