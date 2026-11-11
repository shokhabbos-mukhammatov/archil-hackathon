// Scripted demo runs: one that passes, one that fails its checks, one that stops on an
// error. They exist to show the page working without a server, an Archil key or a model.
// They are scripts written here, not results: each is labelled as a demo wherever it
// appears, and none is written to the runs folder.
//
// Every event carries `at` as milliseconds from the start of the script. The page plays a
// demo in real time (see useRunEvents), so it looks and paces like a live run.

import { Grants, RunEvent } from './model';

export type Demo = { id: string; title: string; blurb: string; outcome: 'passed' | 'failed' | 'error'; events: RunEvent[] };

const REGISTRIES = ['registry.npmjs.org', 'registry.yarnpkg.com', 'pypi.org', 'files.pythonhosted.org'];
const G: Record<string, Grants> = {
  search: { class: 'search', describe: 'Search the web', app: 'none', web: 'write', key: 'none', network: { default: 'deny', allow: ['api.keenable.ai'] }, egress: true },
  install: { class: 'install', describe: 'Fetch dependencies', app: 'write', web: 'none', key: 'none', network: { default: 'deny', allow: REGISTRIES }, egress: true },
  edit: { class: 'edit', describe: 'Write a project file', app: 'write', web: 'none', key: 'none', network: { default: 'deny' } },
  test: { class: 'test', describe: 'Run the test suite', app: 'read', web: 'none', key: 'edge', network: 'service' },
  other: { class: 'other', describe: 'Anything else', app: 'read', web: 'read', key: 'none', network: { default: 'deny' } },
};

const TASK = {
  id: 'longform',
  title: 'Add longForm() with tests and a cited source',
  text: 'Add an exported function longForm(setting) to src/greet.js that returns the long human-readable form of a duration, using the ms package: longForm("2s") returns "2 seconds".\n\nAdd tests, install the dependencies and run the whole suite until it passes.\n\nDocument the function in docs/longForm.md with a "Source:" line citing a page your own web search returned.',
};
const SEARCH_RESULTS = [
  { title: 'ms - npm', url: 'https://www.npmjs.com/package/ms' },
  { title: 'vercel/ms: Tiny millisecond conversion utility', url: 'https://github.com/vercel/ms' },
];
const REFUSAL = "Refused: this run has already shown you output from a test run, which can contain data from the project's service, so calls that send data outside the project (web search, dependency installs) are no longer allowed.";
const GREET_SRC = "import ms from 'ms';\n\nexport function greeting(serviceName) {\n  return `hello, ${serviceName}`;\n}\n\nexport function timeoutMs(setting) {\n  return ms(setting);\n}";
const DNS_GAP = "DNS lookups were answered in 5 of 5 classes, even under a deny-all rule (Archil's resolvers are reachable from every call). Anything inside a call could leave that way: project code and service responses, but not the API key, which is never inside. This is an open question for Archil.";

function script(id: string) {
  let clock = 0;
  let n = 0;
  const events: RunEvent[] = [];
  const emit = (e: Record<string, any>, afterMs = 40) => { clock += afterMs; events.push({ ...e, at: clock } as RunEvent); };
  // `thinkMs` is the pause before the call starts: the agent deciding.
  const call = (turn: number, tool: string, label: string, cls: string, wallMs: number, output: string, extra: Record<string, any> = {}, thinkMs = 250) =>
    emit({ type: 'call', call: { n: ++n, turn, tool, label, class: cls, grants: G[cls], exitCode: 0, wallMs, queueMs: 40, redactions: 0, output, stderr: '', ...extra } }, wallMs + thinkMs);
  const check = (cid: string, label: string, ok: boolean, detail: string, afterMs = 5) => emit({ type: 'check', check: { id: cid, label, ok, detail } }, afterMs);
  const begin = () => {
    emit({ type: 'start', kind: 'agent', id, mode: 'rehearse', simulated: true, model: null, task: TASK, region: 'aws-us-west-2', image: 'node:22-slim', service: 'service.demo.test' }, 0);
    emit({ type: 'disks', names: [`scoped-agent-${id}-ws`, `scoped-agent-${id}-web`] }, 1300);
  };
  // The steps both agent demos share: look around, search, read the saved results.
  const explore = () => {
    emit({ type: 'status', text: "Project uploaded (3 files). A fresh API key for this run is registered with the service; it exists only in the host and in Archil's egress rule." }, 700);
    emit({ type: 'say', turn: 1, text: 'Searching for the ms docs and reading the project.' }, 900);
    call(1, 'search', 'web search: "npm ms package long format option"', 'search', 2700, '', { search: { status: 200, count: 2, saved: '/mnt/archil/web/search-1.json', results: SEARCH_RESULTS } });
    call(1, 'bash', '$ cat src/greet.js', 'other', 1900, GREET_SRC);
    call(1, 'bash', '$ cat test/greet.test.js', 'other', 1850, "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { greeting, timeoutMs } from '../src/greet.js';\n...");
    call(2, 'bash', '$ cat /mnt/archil/web/search-1.json', 'other', 1900, JSON.stringify({ query: 'npm ms package long format option', results: SEARCH_RESULTS }, null, 2), {}, 800);
  };
  const probes = () => {
    const row = (cls: string, service: string, workspaceWrite: string, webWrite: string) => ({ class: cls, grants: G[cls], measured: true, keyInside: false, service, outside: 'blocked', workspaceWrite, webWrite, dns: 'answered', wallMs: 2100, error: null });
    emit({ type: 'status', text: 'Measuring what each class could actually reach...' }, 10);
    emit({ type: 'measure', rows: [row('search', 'blocked', 'not mounted', 'allowed'), row('install', 'blocked', 'allowed', 'not mounted'), row('edit', 'blocked', 'allowed', 'not mounted'), row('test', 'authenticated', 'refused', 'not mounted'), row('other', 'blocked', 'refused', 'refused')] }, 2600);
    check('measured', 'Every probe ran and reported', true, '5 probes');
    check('key', 'The API key was not inside any call (measured in every class)', true, 'classes holding it: none');
    check('service', "Only the test class could reach the project's service, and it could reach nothing else", true, 'reached the service: test; also reached an outside host: none');
    check('service-write', 'The class that reads service data could not write anywhere a later call reads', true, 'could write: none');
  };
  const finish = (ok: boolean, summary: Record<string, any>) => {
    emit({ type: 'gap', text: DNS_GAP }, 5);
    emit({ type: 'summary', summary: { byClass: { search: 1, other: 3, edit: 3, install: 1, test: 1 }, calls: n, archilCalls: n + 9, keyInside: 0, dnsAnswered: 5, ...summary } }, 5);
    emit({ type: 'status', text: "This run's API key was revoked." }, 300);
    emit({ type: 'cleanup', deleted: [`scoped-agent-${id}-ws`, `scoped-agent-${id}-web`], failed: [] }, 900);
    emit({ type: 'end', ok }, 5);
  };
  return { emit, call, check, begin, explore, probes, finish, events, now: () => clock };
}

// 1. Everything works.
function passing(): RunEvent[] {
  const s = script('demo-pass');
  s.begin();
  s.explore();
  const t0 = s.events[2].at;
  s.call(3, 'write', 'write src/greet.js (241 characters)', 'edit', 2000, 'WRITE ok src/greet.js (241 bytes)', {}, 1100);
  s.call(3, 'write', 'write test/greet.test.js (998 characters)', 'edit', 1950, 'WRITE ok test/greet.test.js (998 bytes)');
  s.call(3, 'write', 'write docs/longForm.md (278 characters)', 'edit', 1900, 'WRITE ok docs/longForm.md (278 bytes)');
  s.call(4, 'bash', '$ npm install --no-audit --no-fund', 'install', 3300, 'added 1 package in 2s', {}, 700);
  s.call(5, 'bash', '$ node --test', 'test', 2600, 'TAP version 13\nok 1 - greeting names the service\nok 2 - timeoutMs parses a duration\nok 3 - the service accepts the request\nok 4 - longForm gives the long human-readable form\n1..4\n# tests 4\n# pass 4\n# fail 0', {}, 600);
  s.emit({ type: 'say', turn: 6, text: 'One more search after the test run, which should be refused.' }, 700);
  s.emit({ type: 'rejected', label: 'web search: "ms package changelog"', class: 'search', problem: REFUSAL, refused: true }, 10);
  const seconds = Math.round((s.now() - t0) / 1000);
  s.emit({ type: 'agent-done', ended: 'the agent finished', finalText: 'longForm is added, tested and documented.', calls: 9, refused: 1, seconds }, 700);
  s.emit({ type: 'status', text: 'Checking the result independently...' }, 10);
  s.check('suite', 'The whole test suite passes when re-run independently', true, '4 passed, 0 failed', 1100);
  s.check('original', "The project's original tests still pass against the agent's code", true, '3 passed, 0 failed', 1000);
  s.check('longform', 'longForm("2s") returns "2 seconds" and longForm("1h") returns "1 hour"', true, 'both correct', 900);
  s.check('cited', "docs/longForm.md cites a page the agent's own web search returned", true, 'https://www.npmjs.com/package/ms', 900);
  s.probes();
  s.check('output', "The API key never appeared in any call's output", true, '0 occurrence(s) removed by the scrubber');
  s.finish(true, { refused: 1, redactions: 0, seconds });
  return s.events;
}

// 2. The agent's work is wrong, and the checks say so: the function has a bug, the doc cites
// a link the search never returned, and a test printed the service's echo of the API key,
// which the scrubber removed before the agent saw it.
function failing(): RunEvent[] {
  const s = script('demo-fail');
  s.begin();
  s.explore();
  const t0 = s.events[2].at;
  s.call(3, 'write', 'write src/greet.js (236 characters)', 'edit', 2000, 'WRITE ok src/greet.js (236 bytes)', {}, 1100);
  s.call(3, 'write', 'write test/greet.test.js (1124 characters)', 'edit', 1950, 'WRITE ok test/greet.test.js (1124 bytes)');
  s.call(3, 'write', 'write docs/longForm.md (263 characters)', 'edit', 1900, 'WRITE ok docs/longForm.md (263 bytes)');
  s.call(4, 'bash', '$ npm install --no-audit --no-fund', 'install', 3300, 'added 1 package in 2s', {}, 700);
  s.call(5, 'bash', '$ node --test', 'test', 2700,
    'TAP version 13\nok 1 - greeting names the service\nok 2 - timeoutMs parses a duration\nok 3 - the service accepts the request\n# service said: {"account":"demo","echo":{"authorization":"Bearer [REDACTED]"}}\nnot ok 4 - longForm gives the long human-readable form\n  ---\n  error: "2000 !== \'2 seconds\'"\n  code: \'ERR_ASSERTION\'\n  ...\n1..4\n# tests 4\n# pass 3\n# fail 1',
    { exitCode: 1, redactions: 1 }, 600);
  s.emit({ type: 'say', turn: 6, text: 'The new test fails. Checking the ms docs again for the long option.' }, 800);
  s.emit({ type: 'rejected', label: 'web search: "ms long option returns number"', class: 'search', problem: REFUSAL, refused: true }, 10);
  s.call(7, 'bash', '$ node --test', 'test', 2600, 'TAP version 13\nok 1 - greeting names the service\nok 2 - timeoutMs parses a duration\nok 3 - the service accepts the request\nnot ok 4 - longForm gives the long human-readable form\n1..4\n# tests 4\n# pass 3\n# fail 1', { exitCode: 1 }, 900);
  const seconds = Math.round((s.now() - t0) / 1000);
  s.emit({ type: 'agent-done', ended: 'the agent finished', finalText: 'The longForm test still fails and I could not look up the docs again.', calls: 10, refused: 1, seconds }, 700);
  s.emit({ type: 'status', text: 'Checking the result independently...' }, 10);
  s.check('suite', 'The whole test suite passes when re-run independently', false, "AssertionError [ERR_ASSERTION]: 2000 !== '2 seconds' (3 passed, 1 failed)", 1100);
  s.check('original', "The project's original tests still pass against the agent's code", true, '3 passed, 0 failed', 1000);
  s.check('longform', 'longForm("2s") returns "2 seconds" and longForm("1h") returns "1 hour"', false, 'exit 1', 900);
  s.check('cited', "docs/longForm.md cites a page the agent's own web search returned", false, 'searches made: 1; URLs cited: https://github.com/zeit/ms', 900);
  s.probes();
  s.check('output', "The API key never appeared in any call's output", false, '1 occurrence(s) removed by the scrubber');
  s.finish(false, { byClass: { search: 1, other: 3, edit: 3, install: 1, test: 2 }, refused: 1, redactions: 1, seconds });
  return s.events;
}

// 3. The run stops before the agent starts, and still cleans up after itself.
function erroring(): RunEvent[] {
  const s = script('demo-error');
  s.begin();
  s.emit({ type: 'error', text: 'Archil: Error (status 503): the project upload did not complete' }, 2200);
  s.emit({ type: 'cleanup', deleted: ['scoped-agent-demo-error-ws', 'scoped-agent-demo-error-web'], failed: [] }, 1300);
  s.emit({ type: 'end', ok: false }, 5);
  return s.events;
}

export const DEMOS: Demo[] = [
  { id: 'demo-pass', title: 'Passing run', blurb: 'All nine checks pass', outcome: 'passed', events: passing() },
  { id: 'demo-fail', title: 'Failing run', blurb: 'A bug, a bad citation, a scrubbed secret', outcome: 'failed', events: failing() },
  { id: 'demo-error', title: 'Run that stops on an error', blurb: 'Setup fails; the disks are still deleted', outcome: 'error', events: erroring() },
];
export const DEFAULT_DEMO = DEMOS[0].id;
export const demoById = (id: string | null | undefined) => DEMOS.find((d) => d.id === id) ?? null;
