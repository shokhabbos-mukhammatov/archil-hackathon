import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, grantsFor, hasNetwork, reachesService, CLASSES, INSTALL_REGISTRIES } from './policy.mjs';
import { buildCall, searchCommand, writeFileCommand, checkWorkspacePath, classOfStep } from './runner.mjs';

const disks = { workspaceDisk: 'dsk-w', webDisk: 'dsk-web', keyDisk: 'dsk-key' };
const service = { host: 'service.example.test', headers: { Authorization: 'Bearer svc_test_key_000000' } };

test('installs and tests are recognised', () => {
  assert.equal(classify('npm install'), 'install');
  assert.equal(classify('  npm ci'), 'install');
  assert.equal(classify('pip install requests'), 'install');
  assert.equal(classify('node --test'), 'test');
  assert.equal(classify('npm test'), 'test');
  assert.equal(classify('npm run test'), 'test');
});

test('everything else gets the least-privileged class', () => {
  assert.equal(classify('ls -la'), 'other');
  assert.equal(classify('cat src/greet.js'), 'other');
  assert.equal(classify('npm installer'), 'other');
  assert.equal(classify('npm testing'), 'other');
});

test('a command that chains, pipes, substitutes or redirects never gets a privileged class', () => {
  for (const c of ['npm install && ls', 'npm install; ls', 'npm install | tee log', 'node --test > out.txt', 'npm install $(cat x)', 'npm install `cat x`', 'node --test\nls']) {
    assert.equal(classify(c), 'other', c);
  }
});

test('no bash command can reach the search class', () => {
  for (const c of ['search foo', 'web-search foo', 'curl https://api.keenable.ai/v1/search/public']) {
    assert.notEqual(classify(c), 'search', c);
  }
});

test('invariant 1: no class holds the API key inside the call', () => {
  for (const [name, c] of Object.entries(CLASSES)) assert.notEqual(c.key, 'inside', name);
});

test('invariant 2: only the test class reaches the service, and it reaches nothing else', () => {
  const reaching = Object.entries(CLASSES).filter(([, c]) => reachesService(c)).map(([n]) => n);
  assert.deepEqual(reaching, ['test']);
  assert.equal(CLASSES.test.network, 'service');
  assert.ok(!CLASSES.test.egress);
  for (const [name, c] of Object.entries(CLASSES)) assert.ok(!(reachesService(c) && c.egress), name);
});

test('invariant 3: the class that reads service data cannot write anywhere a later call reads', () => {
  for (const [name, c] of Object.entries(CLASSES)) {
    if (reachesService(c)) assert.ok(c.app !== 'write' && c.web !== 'write', name);
  }
});

test('only classes that can reach third parties are marked as egress', () => {
  for (const [name, c] of Object.entries(CLASSES)) assert.equal(!!c.egress, name === 'search' || name === 'install', name);
  for (const [name, c] of Object.entries(CLASSES)) if (!c.egress && !reachesService(c)) assert.ok(!hasNetwork(c), name);
});

test('installs can reach the npm, yarn and Python registries', () => {
  const req = buildCall({ command: 'pip install requests', mode: 'limited', ...disks, service }).request;
  assert.deepEqual(req.network.egress.allow, INSTALL_REGISTRIES);
  for (const host of ['registry.npmjs.org', 'registry.yarnpkg.com', 'pypi.org', 'files.pythonhosted.org']) assert.ok(INSTALL_REGISTRIES.includes(host), host);
});

test('the test call reaches only the service, with the key added by the egress rule', () => {
  const { request } = buildCall({ command: 'node --test', mode: 'limited', ...disks, service });
  assert.deepEqual(Object.keys(request.disks), ['app']);
  assert.equal(request.disks.app.readOnly, true);
  assert.deepEqual(request.network, { egress: { default: 'deny', allow: [{ target: service.host, transform: { headers: service.headers } }] } });
  assert.ok(!request.command.includes('svc_test_key'), 'the key is not in the command');
  // Without a service configured, the test call gets no network at all.
  assert.deepEqual(buildCall({ command: 'node --test', mode: 'limited', ...disks }).request.network, { egress: { default: 'deny' } });
});

test('the request mounts only what the class is granted', () => {
  const install = buildCall({ command: 'npm install', mode: 'limited', ...disks, service }).request;
  assert.deepEqual(Object.keys(install.disks), ['app']);
  assert.equal(install.disks.app.readOnly, undefined);

  const other = buildCall({ command: 'ls /mnt/archil/web', mode: 'limited', ...disks, service }).request;
  assert.deepEqual(Object.keys(other.disks).sort(), ['app', 'web']);
  assert.equal(other.disks.web.readOnly, true);
  assert.deepEqual(other.network, { egress: { default: 'deny' } });

  for (const cmd of ['npm install', 'node --test', 'ls']) assert.ok(!buildCall({ command: cmd, mode: 'limited', ...disks, service }).request.disks.key, `${cmd}: no key disk under limits`);

  const open = buildCall({ command: 'npm install', mode: 'open', ...disks, service }).request;
  assert.deepEqual(Object.keys(open.disks).sort(), ['app', 'key', 'web']);
  assert.equal(open.network, undefined);
});

test('a search call mounts only the web results disk and reaches only the search provider', () => {
  const { grants, request } = buildCall({ command: searchCommand('anything'), mode: 'limited', forcedClass: 'search', ...disks, service });
  assert.equal(grants.class, 'search');
  assert.deepEqual(Object.keys(request.disks), ['web']);
  assert.deepEqual(request.network, { egress: { default: 'deny', allow: ['api.keenable.ai'] } });
  assert.ok(request.command.startsWith('cd /mnt/archil && '));
});

test('a search query is carried as data and cannot add shell text', () => {
  const hostile = `x'; echo INJECTED; $(echo y) | cat > /tmp/z \n second line`;
  const command = searchCommand(hostile);
  const argument = command.split(' ').at(-1);
  assert.match(argument, /^[A-Za-z0-9+/=]+$/);
  assert.equal(Buffer.from(argument, 'base64').toString('utf8'), hostile);
  assert.ok(!command.includes('INJECTED'));
});

test('a file write gets a writable workspace and nothing else', () => {
  const { grants, request } = buildCall({ command: writeFileCommand('src/new.js', 'export const x = 1;\n'), mode: 'limited', forcedClass: 'edit', ...disks, service });
  assert.equal(grants.class, 'edit');
  assert.deepEqual(Object.keys(request.disks), ['app']);
  assert.equal(request.disks.app.readOnly, undefined);
  assert.deepEqual(request.network, { egress: { default: 'deny' } });
});

test('file content and path are carried as data', () => {
  const hostile = `'; echo INJECTED; $(echo y)\n`;
  const command = writeFileCommand('src/a.js', hostile);
  const [pathArg, bodyArg] = command.split(' ').slice(-2);
  assert.match(pathArg, /^[A-Za-z0-9+/=]+$/);
  assert.match(bodyArg, /^[A-Za-z0-9+/=]+$/);
  assert.equal(Buffer.from(bodyArg, 'base64').toString('utf8'), hostile);
  assert.ok(!command.includes('INJECTED'));
});

test('file writes cannot leave the workspace or replace service.json', () => {
  for (const p of ['../secrets/config.json', '/etc/passwd', 'src/../../x', 'a\\b', '', 'node_modules/ms/index.js', 'src/./a.js', 'src//a.js', 'a b.js', 'service.json']) {
    assert.ok(checkWorkspacePath(p), `should refuse: ${JSON.stringify(p)}`);
    assert.throws(() => writeFileCommand(p, 'x'));
  }
  for (const p of ['src/greet.js', 'test/greet.test.js', 'README.md', 'a/b/c.d-e_f.js']) {
    assert.equal(checkWorkspacePath(p), null, p);
  }
});

test('steps map to the right class', () => {
  assert.equal(classOfStep({ tool: 'write', path: 'a.js', content: '' }, 'limited'), 'edit');
  assert.equal(classOfStep({ tool: 'search', query: 'q' }, 'limited'), 'search');
  assert.equal(classOfStep({ tool: 'bash', command: 'node --test' }, 'limited'), 'test');
  assert.equal(classOfStep({ tool: 'search', query: 'q' }, 'open'), 'open');
  assert.equal(grantsFor('ls', 'open').class, 'open');
});
