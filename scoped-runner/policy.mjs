// Per-call access policy.
//
// Every tool call an agent makes is sorted into a class by fixed rules (never by a model),
// and each class is granted only the folders and network it needs:
//
//   app:      'write' | 'read' | 'none'   the project workspace
//   web:      'write' | 'read' | 'none'   where saved web search results are kept
//   key:      'none' | 'edge' | 'inside'  the project service's API key.
//             'edge' means Archil's egress proxy adds it to requests to the project's
//             service; the call itself never holds it. 'inside' is what a conventional
//             sandbox does (only the no-limits baseline).
//   network:  'service' (only the project's own service), an egress policy, or null (open)
//   egress:   true if the class can send data to third parties outside the project
//
// What the classes are designed to keep (policy.test.mjs checks each):
//   1. No class holds the API key inside the call.
//   2. Only the test class can reach the project's service, and it can reach nothing else.
//   3. The class that reads service data cannot write anywhere a later call reads.
// And across calls (loop.mjs): once the model has seen output from a call that reached the
// service, calls that can send data to third parties are refused for the rest of the run.

export const INSTALL_REGISTRIES = ['registry.npmjs.org', 'registry.yarnpkg.com', 'pypi.org', 'files.pythonhosted.org'];

export const CLASSES = {
  search: {
    describe: 'Search the web',
    app: 'none', web: 'write', key: 'none',
    network: { default: 'deny', allow: ['api.keenable.ai'] },
    egress: true,
  },
  install: {
    describe: 'Fetch dependencies',
    app: 'write', web: 'none', key: 'none',
    network: { default: 'deny', allow: INSTALL_REGISTRIES },
    egress: true,
  },
  edit: {
    describe: 'Write a project file',
    app: 'write', web: 'none', key: 'none',
    network: { default: 'deny' },
  },
  test: {
    describe: 'Run the test suite',
    app: 'read', web: 'none', key: 'edge',
    network: 'service',
  },
  other: {
    describe: 'Anything else',
    app: 'read', web: 'read', key: 'none',
    network: { default: 'deny' },
  },
};

// What a conventional sandbox gives every command: everything, all the time, with the key
// on hand. Used only as the comparison baseline.
export const OPEN = { describe: 'No limits (a conventional sandbox)', app: 'write', web: 'write', key: 'inside', network: null, egress: true };

// Rules for bash commands. Web search and file writing are separate tools with their own
// fixed classes, so a bash command can never talk its way into the search or edit class.
const RULES = [
  [/^(npm|pnpm|yarn)\s+(ci|install|add)(\s|$)/, 'install'],
  [/^(pip|pip3|uv\s+pip)\s+install(\s|$)/, 'install'],
  [/^(npm\s+(run\s+)?test|node\s+--test|pytest)(\s|$)/, 'test'],
];

// Chaining, pipes, substitution and redirection could smuggle a second command into a
// privileged class, so any command that uses them gets the least-privileged class.
const SHELL_COMPOSITION = /[;&|`<>\n]|\$\(/;

export function classify(command) {
  const text = String(command).trim();
  if (SHELL_COMPOSITION.test(text)) return 'other';
  for (const [pattern, name] of RULES) if (pattern.test(text)) return name;
  return 'other';
}

export function grantsFor(command, mode = 'limited', forcedClass) {
  if (mode === 'open') return { class: 'open', ...OPEN };
  const name = forcedClass ?? classify(command);
  return { class: name, ...CLASSES[name] };
}

export const reachesService = (g) => g.network === 'service' || g.network === null;
export const hasNetwork = (g) => g.network === null || g.network === 'service' || (g.network?.allow?.length ?? 0) > 0;

export function describeNetwork(network) {
  if (network === null) return 'open';
  if (network === 'service') return "only the project's service (key added at the edge)";
  return network.allow?.length ? `only ${network.allow.map((a) => (typeof a === 'string' ? a : a.target)).join(', ')}` : 'none';
}

export function describeGrants(g) {
  const key = g.key === 'edge' ? 'added at the edge, never inside' : g.key === 'inside' ? 'INSIDE the call' : 'none';
  return `workspace: ${g.app}, web results: ${g.web}, API key: ${key}, network: ${describeNetwork(g.network)}`;
}
