// Per-call access policy.
//
// Every tool call an agent makes is sorted into a class by fixed rules (never by a model),
// and each class is granted only the folders and network it needs.
//
//   app:      'write' | 'read' | 'none'   the project workspace
//   secrets:  'read'  | 'none'            configuration the tests need
//   web:      'write' | 'read' | 'none'   where web search results are kept
//   network:  an egress policy, or null for an open network
//
// Two properties the classes are designed to keep (policy.test.mjs checks both):
//   1. No class has the secrets together with any network access.
//   2. A class that can see the secrets cannot write to any storage a later call will read.

export const CLASSES = {
  search: {
    describe: 'Search the web',
    app: 'none',
    secrets: 'none',
    web: 'write',
    network: { default: 'deny', allow: ['api.keenable.ai'] },
  },
  install: {
    describe: 'Fetch dependencies',
    app: 'write',
    secrets: 'none',
    web: 'none',
    network: { default: 'deny', allow: ['registry.npmjs.org'] },
  },
  edit: {
    describe: 'Write a project file',
    app: 'write',
    secrets: 'none',
    web: 'none',
    network: { default: 'deny' },
  },
  test: {
    describe: 'Run the test suite',
    app: 'read',
    secrets: 'read',
    web: 'none',
    network: { default: 'deny' },
  },
  other: {
    describe: 'Anything else',
    app: 'read',
    secrets: 'none',
    web: 'read',
    network: { default: 'deny' },
  },
};

// What a conventional sandbox gives every command: everything, all the time.
export const OPEN = { describe: 'No limits', app: 'write', secrets: 'read', web: 'write', network: null };

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

export function hasNetwork(grants) {
  return grants.network === null || (grants.network.allow?.length ?? 0) > 0;
}

export function describeGrants(g) {
  const net = g.network === null ? 'open' : g.network.allow?.length ? `only ${g.network.allow.join(', ')}` : 'none';
  return `workspace: ${g.app}, secrets: ${g.secrets}, web results: ${g.web}, network: ${net}`;
}
