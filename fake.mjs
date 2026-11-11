// Stand-ins for Archil and for the project's service, so the session code, the server and
// the dashboard can be exercised with no keys and no network. The Archil stand-in keeps each
// disk's files in memory and answers the handful of commands the rehearsal script, the
// checks and the probes use, honouring each request's mounts, read-only flags and network
// rule (including a header-adding rule for the service) the way the real service does.
// DNS is reported as answered, as on the real platform. These are test doubles: they prove
// the wiring, not the platform.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const RESULTS = [
  { title: 'ms - npm', url: 'https://www.npmjs.com/package/ms', snippet: 'Tiny millisecond conversion utility. ms(60000, { long: true }) returns "1 minute".' },
  { title: 'vercel/ms: Tiny millisecond conversion utility', url: 'https://github.com/vercel/ms', snippet: 'Use the long option for verbose output: ms(ms("10 hours"), { long: true }).' },
];

export function fakeService() {
  const keys = new Map();
  const host = 'service.fake.test';
  return {
    host, url: `https://${host}`, fake: true,
    async addKey(tag, key) { keys.set(tag, key); },
    async removeKey(tag) { keys.delete(tag); },
    accepts(authorization) { return [...keys.values()].some((k) => authorization === `Bearer ${k}`); },
    activeKeys: () => keys.size,
  };
}

export function fakeArchil({ delayMs = 150, service = null } = {}) {
  let seq = 0;
  const store = new Map(); // disk id -> Map(relative path -> text)
  const objects = new Map(); // disk id -> disk object

  function mounts(req) {
    const m = {};
    for (const [key, spec] of Object.entries(req.disks ?? {})) {
      const id = typeof spec === 'string' ? spec : spec.disk?.id ?? spec.disk ?? spec.id;
      m[key] = { files: store.get(id) ?? new Map(), readOnly: !!spec.readOnly };
    }
    return m;
  }
  const ruleFor = (net, host) => (net?.allow ?? []).find((a) => (typeof a === 'string' ? a : a.target) === host);
  const allows = (net, host) => !net || net.default === 'allow' || !!ruleFor(net, host);
  // What the service would say to a request from a call under this network rule.
  function serviceStatus(net, url, ownKey) {
    if (!url || !service) return 0;
    const host = new URL(url).host;
    let auth = ownKey ? `Bearer ${ownKey}` : '';
    if (net) {
      const rule = ruleFor(net, host);
      if (!rule) return 0; // blocked
      auth = (typeof rule === 'object' && rule.transform?.headers?.Authorization) || auth;
    }
    return service.accepts(auth) ? 200 : 401;
  }
  const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '' });
  const fail = (stderr, stdout = '') => ({ exitCode: 1, stdout, stderr });

  function resolve(m, p) {
    const abs = /^\/mnt\/archil\/([^/]+)\/(.+)$/.exec(p);
    return abs ? { mount: m[abs[1]], rel: abs[2] } : { mount: m.app, rel: p.replace(/^\.\//, '') };
  }

  function runTests(m, net) {
    const files = m.app?.files;
    if (!files?.has('node_modules/.installed')) return fail("Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'ms'", '# pass 0\n# fail 1');
    let url = '';
    try { url = JSON.parse(files.get('service.json') ?? '{}').url; } catch {}
    const status = serviceStatus(net, url, null);
    if (status !== 200) return fail(status ? 'AssertionError [ERR_ASSERTION]: the service accepted the request' : 'TypeError: fetch failed', '# pass 1\n# fail 1');
    const n = ((files.get('test/greet.test.js') ?? '').match(/\btest\(/g) ?? []).length;
    return ok(`TAP version 13\n1..${n}\n# tests ${n}\n# pass ${n}\n# fail 0`);
  }

  function respond(req) {
    const m = mounts(req);
    const net = req.network?.egress; // undefined means open
    const cmd = req.command.replace(/^cd \S+ && /, '');
    const writable = (x) => (!x ? 'not mounted' : x.readOnly ? 'refused' : 'allowed');

    if (cmd.includes('console.log("PROBE "')) {
      const serviceUrl = Buffer.from(cmd.split(' ').at(-1) ?? '', 'base64').toString('utf8');
      const keyFile = m.key?.files.get('key.txt') ?? null;
      const s = serviceStatus(net, serviceUrl, keyFile);
      const report = {
        keyFile: keyFile ? 'readable' : 'not available', workspaceWrite: writable(m.app), webWrite: writable(m.web),
        outside: allows(net, 'example.com') ? 'reachable' : 'blocked',
        service: !serviceUrl ? 'not configured' : s === 200 ? 'authenticated' : s ? `refused (HTTP ${s})` : 'blocked',
        dns: 'answered',
      };
      return ok(`PROBE ${JSON.stringify(report)}\nVISIBLE ${JSON.stringify({ PATH: '/usr/local/bin:/usr/bin', HOME: '/root' })} ${keyFile ?? ''}`);
    }
    if (cmd.includes('api.keenable.ai/v1/search')) {
      if (!allows(net, 'api.keenable.ai')) return ok('SEARCH ' + JSON.stringify({ status: 0, error: 'ECONNREFUSED' }));
      const query = Buffer.from(cmd.split(' ').at(-1), 'base64').toString('utf8');
      let saved = 'not saved (EROFS)';
      if (m.web && !m.web.readOnly) {
        const name = `search-${Date.now()}.json`;
        m.web.files.set(name, JSON.stringify({ query, fetched_at: new Date().toISOString(), results: RESULTS }, null, 2));
        saved = `/mnt/archil/web/${name}`;
      }
      return ok('SEARCH ' + JSON.stringify({ status: 200, count: RESULTS.length, saved, results: RESULTS.map(({ title, url }) => ({ title, url })) }));
    }
    if (cmd.includes('console.log("WRITE ok')) {
      const [p64, b64] = cmd.split(' ').slice(-2);
      const rel = Buffer.from(p64, 'base64').toString('utf8');
      if (!m.app) return fail('ENOENT: workspace not mounted');
      if (m.app.readOnly) return fail('EROFS: read-only file system');
      const body = Buffer.from(b64 ?? '', 'base64').toString('utf8');
      m.app.files.set(rel, body);
      return ok(`WRITE ok ${rel} (${Buffer.byteLength(body)} bytes)`);
    }
    if (/^(npm|pnpm|yarn)\s+(ci|install|add)\b/.test(cmd)) {
      if (!m.app || m.app.readOnly) return fail('npm error code EROFS\nnpm error read-only file system');
      if (!allows(net, 'registry.npmjs.org')) return fail('npm error network request to https://registry.npmjs.org/ms failed');
      m.app.files.set('node_modules/.installed', 'ms@2.1.3');
      return ok('added 1 package in 1s');
    }
    if (/^(node\s+--test|npm\s+(run\s+)?test)\b/.test(cmd) || cmd.includes('/tmp/orig/original.test.mjs')) return runTests(m, net);
    if (cmd.includes('m.longForm(')) {
      return /long:\s*true/.test(m.app?.files.get('src/greet.js') ?? '') ? ok('longForm ok') : fail('longForm is missing or wrong');
    }
    const cat = /^cat\s+(\S+)$/.exec(cmd);
    if (cat) {
      const { mount, rel } = resolve(m, cat[1]);
      const content = mount?.files.get(rel);
      return content == null ? fail(`cat: ${cat[1]}: No such file or directory`) : ok(content);
    }
    const ls = /^ls(?:\s+-\S+)*\s*(\S*)$/.exec(cmd);
    if (ls) {
      const { mount, rel } = ls[1] ? resolve(m, ls[1].replace(/\/$/, '') + '/') : { mount: m.app, rel: '' };
      if (!mount) return fail(`ls: cannot access '${ls[1]}': No such file or directory`);
      const names = [...new Set([...mount.files.keys()].filter((k) => k.startsWith(rel)).map((k) => k.slice(rel.length).split('/')[0]))];
      return ok(names.sort().join('\n'));
    }
    return ok('');
  }

  return {
    fake: true,
    disks: {
      async create({ name }) {
        const id = `dsk-fake${String(++seq).padStart(4, '0')}`;
        const files = new Map();
        store.set(id, files);
        const disk = {
          id, name,
          async putObject(key, body) { files.set(key, typeof body === 'string' ? body : Buffer.from(body).toString('utf8')); return {}; },
          async delete() { store.delete(id); objects.delete(id); },
        };
        objects.set(id, disk);
        return { disk };
      },
      async list() { return [...objects.values()]; },
    },
    async exec(req) {
      await sleep(delayMs * (0.6 + Math.random() * 0.8));
      const queueMs = 20 + Math.round(Math.random() * 40);
      return { ...respond(req), timing: { queueMs, totalMs: delayMs + queueMs, executeMs: delayMs } };
    },
  };
}
