# Scoped Runner

Per-call access limits for agents that have no sandbox.

Archil's position is that an agent does not need a computer of its own: it needs a disk, and a short-lived microVM for each tool call. Scoped Runner takes that one step further. If compute is granted per call, access can be granted per call too. Every tool call an agent makes gets only the folders and the network that kind of call needs, and **the project's API key never enters any call**: when the tests call the project's service, Archil's egress proxy adds the key to those requests on the way out.

A long-lived sandbox can change its network policy between steps, but anything an install step started is still running when the next step begins, and the key has to live inside the machine. Here every call starts in an empty microVM, and the key is never in one.

## What it is

A local web dashboard and a command-line tool. You give an agent (Claude Opus 5.5) a task on a small Node.js project and watch every tool call it makes run as its own Archil microVM: which class the call was sorted into, what that class mounted, and what network it was allowed. When the agent stops, the tool checks the result itself and measures what each class could actually reach.

The project's service is a small API in one Archil sandbox. Each run gets its own two disks (the project and the saved web results) and its own API key, which is registered with the service when the run starts and revoked when it ends. Several runs can go at once on one host.

## The access classes

Fixed rules sort each tool call into a class. The model never chooses its own access.

| Class | Used for | Project | Web results | API key | Network |
|---|---|---|---|---|---|
| `search` | The web search tool | not mounted | writable | none | Keenable's API only |
| `install` | `npm install`, `npm ci`, `yarn`, `pip install` | writable | not mounted | none | the package registries only |
| `edit` | The file-writing tool | writable | not mounted | none | none |
| `test` | `node --test`, `npm test`, `pytest` | read-only | not mounted | **added at the edge** | the project's service only |
| `other` | Every other command | read-only | read-only | none | none |

## What it guarantees

For every call (`policy.test.mjs` checks the policy; every run also measures it):

1. **No call holds the API key.** For the `test` class, Archil's egress proxy adds it to requests to the project's service; nothing inside the call can read it.
2. **Only the `test` class can reach the service, and it can reach nothing else.**
3. **The class that reads service data cannot write anywhere a later call reads.**

Across calls (`loop.mjs`):

4. **Once Claude has seen output from a test run**, which can carry service data, web searches and dependency installs are refused for the rest of the run. Claude is the one thing that sees every call's output, so this stops it from carrying service data out through a later call. A search query or install command that contains a known secret value is refused at any time.

What keeps the rules from being talked around:

- A command that chains, pipes, substitutes or redirects (`;`, `&&`, `|`, `>`, `<`, `$( )`) always gets the least-privileged class, so `npm install && cat …` gains nothing.
- Web search and file writing are separate tools with fixed classes. No bash command can reach those classes.
- A search query, a file path and file content travel into the call as base64 data and are decoded inside it, never as shell text.
- Everything a call returns passes through a scrubber before it reaches Claude, a log or the browser. It removes known secret values in any letter case, reversed, as hex, URL-encoded or JSON-escaped, and as base64 at any alignment, including inside a larger block that was base64-encoded as a whole.

### What it does not guarantee

- **DNS still works in every call.** Under a deny-all rule, the microVM's resolvers (8.8.8.8 and 1.1.1.1) still answer lookups for any name, and adding a rule to block them stops the call from starting. So anything inside a call could leave through DNS lookups: project code, and in the `test` class, service responses. The API key cannot, because it is never inside. Every run measures and reports this. It is an open question for Archil.
- **The `test` class can use the service.** It runs project code (any test file, or whatever `npm test` runs), and that code can call the service with the key added, just not see the key. A real project should give the key used for tests the least privilege the service allows.
- **Scrubbing is best effort.** A value that is split up, re-encoded some other way or encrypted gets past it. In this design the key is never inside a call, so scrubbing is a second line of defence.

## What has been shown working

All of this ran on a real Archil account in `aws-us-west-2` on 10 November 2026. Run tags match the logs in `runs/`.

**The real agent** (run `lr77kj`, model `claude-opus-5-5`). Asked to add a function, add tests, and write a short doc citing a page found through its own search, Claude finished in 10 calls and 31 seconds (41 with the checks): 3 plain reads, 2 web searches, 1 install, 3 file writes, 1 test run. It read the rule about test output and did its searching and installing first, so nothing had to be refused. All 9 independent checks passed:

- the whole test suite passes, and the project's original tests still pass against the new code;
- the new function returns the required text;
- the doc cites a page the agent's own search returned;
- measured in every class: no call held the key; only `test` reached the service, and it reached nothing else; it could not write anywhere; the key never appeared in any output.

**Measured access** (run `64f3dh`). One harmless probe per class, plus one with no limits. Each probe looks for the key in its whole environment and any mounted file, calls the service, fetches `example.com` (on no allowlist), tries to write each folder, and resolves a name.

| Class | API key inside | Reach the service | Reach an outside host | Write the project | Write web results | DNS lookups |
|---|---|---|---|---|---|---|
| search | no | blocked | blocked | not mounted | yes | answered |
| install | no | blocked | blocked | yes | not mounted | answered |
| edit | no | blocked | blocked | yes | not mounted | answered |
| test | no | **yes** | blocked | refused | not mounted | answered |
| other | no | blocked | blocked | refused | refused | answered |
| no limits | **yes** | **yes** | **reachable** | yes | yes | answered |

**The refusal rule** (rehearsal run `mik8il`). Scripted steps on real Archil: after the test run, one more web search was refused before it reached Archil. All 9 checks passed.

**Several tenants at once** (runs `duq1g7`, `v44wqb`, `lywvtm`). Two agent rehearsals and one access matrix started together, each with its own disks and key: all passed every check, in 16 seconds.

**Keys and cleanup.** A run's key gets HTTP 401 before it is registered, 200 while its run is going, and 401 again once revoked. A server killed mid-run left its run's disks; the restarted server deleted them and revoked the run's key by itself.

**Platform checks made along the way.** Archil's egress proxy routes HTTPS by the server name: a connection to another host's address that claims to be `registry.npmjs.org` reached npm, so naming an allowed host does not get around an allowlist. Header-adding rules work in serverless calls, and the header value never appears inside the call.

Runs from before the API key moved to the network edge (`7pt494`, `yv27yv` and others, with a secrets disk) are kept in `runs/` for reference.

## Run it

You need Node 22.19 or later (the Archil SDK's minimum; built and tested on Node 26), an Archil API key, and for the live agent an Anthropic API key. Put them in a `.env` file in this folder or the one above it. An Archil key only works in the region it was created in.

```
ARCHIL_API_KEY=key-...
ARCHIL_REGION=aws-us-west-2
ANTHROPIC_API_KEY=sk-ant-...
```

Install the dependencies:

```bash
npm install
```

Start the dashboard, then open http://127.0.0.1:4317/:

```bash
npm start
```

To try the dashboard with no keys and no network, start it with stand-ins for Archil, the service and the model:

```bash
npm run start:fake
```

Everything else:

| Command | What it does | Needs |
|---|---|---|
| `npm test` | 37 tests (policy, scrubbing, error reporting, cleanup after interrupted runs, the server end to end with stand-ins) and the agent self-test | nothing |
| `node agent.mjs --fake` | A whole session in the terminal, against stand-ins | nothing |
| `npm run matrix` | Measure what each class can reach | Archil key |
| `npm run rehearse` | The agent loop on Archil, with scripted steps in place of a model | Archil key |
| `npm run agent` | The real agent in the terminal | Archil and Anthropic keys |
| `npm run service:stop` | Delete the sandbox that hosts the project's service | Archil key |

The first live run starts the project's service in a sandbox named `scoped-runner-service` (1 vCPU, 512 MiB, about $0.065 an hour while running). Later runs reuse it; it stops by itself after eight hours, or delete it with `npm run service:stop`. Each run creates disks named `scoped-agent-...` or `scoped-matrix-...` and deletes them at the end; add `--keep` on the command line to leave them. An agent run makes about 19 Archil serverless calls (about 10 by the agent, 4 for the checks, 5 probes); a matrix makes 6. Web search uses Keenable's keyless public endpoint. The server listens on 127.0.0.1 only, refuses requests whose Host or Origin is not this machine, and runs at most three sessions at once.

## How it is put together

| File | Role |
|---|---|
| `policy.mjs` | The classes, the rules that sort a command into a class, and the guarantees they keep |
| `runner.mjs` | Turns one tool call into one Archil call with only the granted mounts and network rule (including the key-adding rule for `test`); scrubs its output; the measuring probe |
| `scrub.mjs` | Removes known secret values, in their common forms, from text |
| `service.mjs` | The project's service: starts or reuses its sandbox; registers and revokes each run's key |
| `loop.mjs` | The agent loop (Claude, three tools), the rule that refuses outbound calls after test output, the task, and the scripted rehearsal |
| `session.mjs` | One complete run: its own disks and key, the agent, the independent and measured checks, cleanup; and the access matrix |
| `server.mjs` | The dashboard server: starts runs, streams their events, lists earlier runs, cleans up after runs whose process died |
| `public/index.html` | The dashboard page (no external dependencies) |
| `agent.mjs` | The command-line entry point and the agent self-test |
| `fake.mjs` | Stand-ins for Archil and the service, for offline tests and fake mode |
| `*.test.mjs` | Tests |
| `sample-app/` | The small project the agent works on |

The agent's model loop and conversation run on your machine. Archil holds the project and the web results on disks, and the service in a sandbox. Nothing survives between calls except what is on those disks, so the install step writes dependencies into the project disk, where the test step finds them.

The model call uses `claude-opus-5-5` at `medium` effort, with the server-side refusal fallback (`fallbacks: "default"`) turned on, so a request a safety check declines is retried on a fallback model instead of stopping the run. Set `AGENT_MODEL` to use another model.

## Known limits

- **DNS** is the open channel described above; it needs Archil.
- **The refusal rule is strict.** If Claude runs the tests before installing, a later install is refused and the run cannot finish. The system prompt says so, and in our live run Claude ordered its steps accordingly.
- **The classification rules are small.** They recognise npm, pnpm, yarn and pip installs, and `node --test`, `npm test` and `pytest`. A real project would need more.
- **It has been run on one small project.** A custom task can be given in the dashboard, but it runs on the same sample project, and only the generic checks apply to it.
- **The source check verifies where a cited link came from,** not whether it is the right page. The scripted rehearsal shows this: it cites the first search result, which is not always about `ms`.
- **Keenable's keyless limit is 1,000 requests an hour per IP address,** and calls from Archil may share an address with other users.
- **If the process running a run dies,** its disks and key stay until the dashboard server next starts, which then deletes the disks and revokes the key: only disks named in that run's own log, by exact name and prefix, and only once the process that ran it has ended.
- **The service sandbox is shared** by all runs on this account and costs money while it runs.
