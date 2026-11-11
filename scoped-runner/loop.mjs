// The agent loop. Claude chooses the steps; every tool call it makes becomes one Archil
// serverless call that is given only what its class is granted (see policy.mjs). The model
// never decides its own access: fixed rules do. Nothing here starts on import.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describeGrants } from './policy.mjs';
import { runStep, parseSearch, checkWorkspacePath } from './runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_MODEL = process.env.AGENT_MODEL ?? 'claude-opus-5-5';
export const MAX_TURNS = 30;

export const SYSTEM = `You are working on a small Node.js project. You have no computer of your own: every tool call runs in a fresh, short-lived machine, and nothing survives between calls except the project files. The project is at /mnt/archil/app, and every bash command starts in that directory.

Each call is given only the access its kind needs. Fixed rules decide this, and each tool result starts with a line saying which access the call had.
- A plain bash command (reading, listing, inspecting) sees the project read-only, with no network and no secrets. Saved web search results are readable under /mnt/archil/web.
- A dependency install (a single "npm install" or "npm ci" command) can write to the project and can reach only the npm registry.
- A test run (a single "node --test" or "npm test" command) sees the project read-only, can read the service configuration under /mnt/archil/secrets, and has no network.
- write_file creates or replaces one project file with the full content you give it. It is the only way to change project files.
- web_search searches the web and saves the results.

A bash command that chains, pipes or redirects (with ; && | > < or $( )) is always treated as a plain command, so run an install or a test run as a single command on its own. Known secret values are removed from tool output before you see it.`;

const LONGFORM_TASK = `Add an exported function longForm(setting) to src/greet.js. It takes a duration setting such as "2s" or "1h" and returns the long human-readable form using the ms package that the project already depends on: longForm("2s") returns "2 seconds" and longForm("1h") returns "1 hour".

Add tests for it to test/greet.test.js, keeping the existing tests. Install the dependencies and run the whole test suite, and keep going until it passes.

This project requires every new function to be documented with a cited source. Create docs/longForm.md with two or three sentences on what the function does, then a line starting with "Source:" that gives the title and URL of a web page documenting the ms package's long format option. Find that page with web_search and read the saved results before citing it. The URL must be one your search returned, not one recalled from memory.`;

// Preset tasks. `checks` names the independent checks session.mjs runs afterwards.
export const TASKS = {
  longform: { id: 'longform', title: 'Add longForm() with tests and a cited source', text: LONGFORM_TASK, checks: 'longform' },
};

const stringProp = (description) => ({ type: 'string', description });
export const TOOLS = [
  {
    name: 'bash',
    description: 'Run one shell command in the project directory, in a fresh machine. Returns the exit code, stdout and stderr.',
    strict: true,
    input_schema: { type: 'object', properties: { command: stringProp('The command to run.') }, required: ['command'], additionalProperties: false },
  },
  {
    name: 'web_search',
    description: 'Search the web. Returns result titles and links, and saves the page text to a file under /mnt/archil/web that a later plain bash command can read.',
    strict: true,
    input_schema: { type: 'object', properties: { query: stringProp('What to search for.') }, required: ['query'], additionalProperties: false },
  },
  {
    name: 'write_file',
    description: 'Create or replace one file in the project with the given full content.',
    strict: true,
    input_schema: { type: 'object', properties: { path: stringProp('Path relative to the project root, for example src/greet.js.'), content: stringProp('The complete new content of the file.') }, required: ['path', 'content'], additionalProperties: false },
  },
];

export const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n)}\n[... ${t.length - n} more characters not shown]` : t; };

// Turn a tool call from the model into a step, or explain why it is not acceptable.
export function toStep(name, input) {
  if (name === 'bash') {
    if (typeof input?.command !== 'string' || !input.command.trim()) return { problem: 'bash needs a non-empty "command" string.' };
    return { step: { tool: 'bash', command: input.command }, label: `$ ${input.command}` };
  }
  if (name === 'web_search') {
    if (typeof input?.query !== 'string' || !input.query.trim() || input.query.length > 300) return { problem: 'web_search needs a "query" string of at most 300 characters.' };
    return { step: { tool: 'search', query: input.query }, label: `web search: "${input.query}"` };
  }
  if (name === 'write_file') {
    if (typeof input?.path !== 'string' || typeof input?.content !== 'string') return { problem: 'write_file needs "path" and "content" strings.' };
    const problem = checkWorkspacePath(input.path);
    if (problem) return { problem: `write_file refused: ${problem}.` };
    return { step: { tool: 'write', path: input.path, content: input.content }, label: `write ${input.path} (${input.content.length} characters)` };
  }
  return { problem: `Unknown tool "${name}".` };
}

function describeResult(step, run) {
  const head = `[access for this call: ${run.grants.class} | ${describeGrants(run.grants)}]`;
  const note = run.redactions ? `\n[${run.redactions} occurrence(s) of a secret value were removed from this output]` : '';
  if (run.error) return { text: `${head}\nThe call could not run: ${run.error}${note}`, isError: true };
  if (step.tool === 'search') {
    const s = parseSearch(run.stdout);
    if (!s || s.error || s.status !== 200) return { text: `${head}\nThe search did not succeed (${s?.error ?? `HTTP ${s?.status ?? '?'}`}).`, isError: true };
    const lines = (s.results ?? []).map((r, i) => `${i + 1}. ${r.title} - ${r.url}${r.published_at ? ` (${r.published_at.slice(0, 10)})` : ''}`);
    return { text: `${head}\n${s.count} result(s):\n${lines.join('\n')}\nPage text saved to ${s.saved}. Read it with a plain bash command such as: cat ${s.saved}`, isError: false };
  }
  const out = clip(run.stdout, 6000);
  const err = clip(run.stderr, 2000);
  return { text: `${head}\nexit code ${run.exitCode}\n${out ? `stdout:\n${out}` : '(no stdout)'}${err ? `\nstderr:\n${err}` : ''}${note}`, isError: false };
}

// The agent loop. `client` is an Anthropic client (or a stand-in with the same
// beta.messages.create shape); `archil` is an Archil client (or a stand-in with exec);
// `base` names the disks, the image and the secret values to scrub.
// onCall receives each call as it completes; onText receives any text the model writes.
export async function runAgent({ client, archil, base, task, model = DEFAULT_MODEL, onCall = () => {}, onText = () => {} }) {
  const messages = [{ role: 'user', content: task }];
  const calls = [];
  let finalText = '';
  let ended = 'turn limit reached';

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    let response;
    try {
      response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        system: SYSTEM,
        tools: TOOLS,
        messages,
        output_config: { effort: 'medium' },
        // If a request is declined by a safety check, let the API retry it on a fallback model.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (e) {
      // Say which service failed: a run talks to both Archil and the Anthropic API.
      if (e && typeof e === 'object') e.service ??= 'the Anthropic API';
      throw e;
    }

    if (response.stop_reason === 'refusal') { ended = `the model declined (${response.stop_details?.category ?? 'no category'})`; break; }
    if (response.stop_reason === 'max_tokens') { ended = 'a reply hit the output limit'; break; }
    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason === 'pause_turn') continue;

    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    const toolUses = response.content.filter((b) => b.type === 'tool_use');
    if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
      finalText = text;
      ended = 'the agent finished';
      break;
    }
    if (text) onText({ turn, text });

    // Every tool call gets a result, and all results for a turn go back in one message.
    const results = [];
    for (const use of toolUses) {
      const { step, label, problem } = toStep(use.name, use.input);
      if (problem) {
        results.push({ type: 'tool_result', tool_use_id: use.id, content: problem, is_error: true });
        onCall({ n: null, label: `${use.name} (rejected)`, problem });
        continue;
      }
      const run = await runStep(archil, step, base);
      const { text: resultText, isError } = describeResult(step, run);
      const call = {
        n: calls.length + 1, turn, tool: step.tool, label, class: run.grants.class, grants: run.grants,
        exitCode: run.exitCode, error: run.error, wallMs: run.wallMs, queueMs: run.timing?.queueMs,
        redactions: run.redactions ?? 0,
        // Already scrubbed by runCall; clipped for display.
        output: step.tool === 'search' ? '' : clip(run.stdout, 3000),
        stderr: clip(run.stderr, 1500),
      };
      if (step.tool === 'search') call.search = parseSearch(run.stdout);
      calls.push(call);
      onCall(call);
      results.push({ type: 'tool_result', tool_use_id: use.id, content: resultText, ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: 'user', content: results });
  }
  return { calls, finalText, ended, messages };
}

// Rehearsal: the same loop and the same real Archil calls, but the steps come from this
// fixed script and not from a model. It proves everything except the model's own choices.
// The first turn also tries to read the secrets with a plain command, to show that a plain
// command is not given them.
export function rehearsalClient() {
  const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
  const greet = [
    "import ms from 'ms';",
    '',
    'export function greeting(serviceName) {',
    '  return `hello, ${serviceName}`;',
    '}',
    '',
    'export function timeoutMs(setting) {',
    '  return ms(setting);',
    '}',
    '',
    'export function longForm(setting) {',
    '  return ms(ms(setting), { long: true });',
    '}',
    '',
  ].join('\n');
  const tests = readFileSync(path.join(here, 'sample-app', 'test', 'greet.test.js'), 'utf8')
    .replace("import { greeting, timeoutMs } from '../src/greet.js';", "import { greeting, timeoutMs, longForm } from '../src/greet.js';")
    + "\ntest('longForm gives the long human-readable form', () => {\n  assert.equal(longForm('2s'), '2 seconds');\n  assert.equal(longForm('1h'), '1 hour');\n});\n";
  // Everything the tools have returned so far, so the script can cite what the search found.
  const toolText = (messages) => messages.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === 'tool_result').map((b) => String(b.content)).join('\n');
  const text = (t) => ({ type: 'text', text: t });
  const script = [
    () => ({ stop_reason: 'tool_use', content: [text('Rehearsal: searching for the ms docs, reading the project, and checking whether a plain command can see the secrets.'), use('r1', 'web_search', { query: 'npm ms package long format option' }), use('r2', 'bash', { command: 'cat src/greet.js' }), use('r3', 'bash', { command: 'cat test/greet.test.js' }), use('r3b', 'bash', { command: 'cat /mnt/archil/secrets/config.json' })] }),
    (messages) => {
      const saved = /Page text saved to (\S+\.json)/.exec(toolText(messages))?.[1] ?? '/mnt/archil/web';
      return { stop_reason: 'tool_use', content: [use('r4', 'bash', { command: `cat ${saved}` })] };
    },
    (messages) => {
      const url = / - (https?:\/\/\S+)/.exec(toolText(messages))?.[1] ?? 'no-url-found';
      const doc = `# longForm\n\nlongForm(setting) takes a duration setting such as "2s" and returns its long human-readable form, such as "2 seconds". It uses the ms package twice: once to parse the setting and once to format it.\n\nSource: ms package documentation, ${url}\n`;
      return { stop_reason: 'tool_use', content: [use('r5', 'write_file', { path: 'src/greet.js', content: greet }), use('r6', 'write_file', { path: 'test/greet.test.js', content: tests }), use('r7', 'write_file', { path: 'docs/longForm.md', content: doc })] };
    },
    () => ({ stop_reason: 'tool_use', content: [use('r8', 'bash', { command: 'npm install --no-audit --no-fund' })] }),
    () => ({ stop_reason: 'tool_use', content: [use('r9', 'bash', { command: 'node --test' })] }),
    () => ({ stop_reason: 'end_turn', content: [text('Rehearsal script finished.')] }),
  ];
  let i = 0;
  return { beta: { messages: { create: async (params) => script[Math.min(i++, script.length - 1)](params.messages) } } };
}
