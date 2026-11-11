# Scoped Runner

Per-call access limits for agents that have no sandbox.

Archil's position is that an agent does not need a computer of its own: it needs a disk, and a short-lived microVM for each tool call. Scoped Runner takes that one step further. If compute is granted per call, access can be granted per call too. Every tool call an agent makes gets only the folders and the network that kind of call needs, and no call ever holds the secrets and a network connection at the same time.

A long-lived sandbox cannot do this. It has one set of mounts and one network policy for its whole life, so the step that downloads third-party code and the step that reads your secrets share the same access.

## What it is

A local web dashboard and a command-line tool. You give an agent (Claude Opus 5.5) a task on a small Node.js project, and watch every tool call it makes run as its own Archil microVM, with the class each call was sorted into, what that class mounted, and what network it was allowed. When the agent stops, the tool checks the result itself.

Each run gets three disks of its own (the project, the secrets, the saved web results), a fresh canary secret, and is deleted at the end. Several runs can go at once on one host: one host, many users, a disk set per user, a microVM per call.

## The access classes

Fixed rules sort each tool call into a class, and the class decides what is mounted and what the network allows. The model never chooses its own access.

| Class | Used for | Project | Secrets | Web results | Network |
|---|---|---|---|---|---|
| `search` | The web search tool | not mounted | not mounted | writable | Keenable's API only |
| `install` | `npm install`, `npm ci`, `pip install` | writable | not mounted | not mounted | package registry only |
| `edit` | The file-writing tool | writable | not mounted | not mounted | none |
| `test` | `node --test`, `npm test`, `pytest` | read-only | read-only | not mounted | none |
| `other` | Every other command | read-only | not mounted | read-only | none |

Two rules hold for every class, and the tests enforce them:

1. No class has the secrets together with any network access.
2. No class that can read the secrets can write to storage a later call will read.

Four details keep the rules from being talked around:

- A command that chains, pipes, substitutes or redirects (`;`, `&&`, `|`, `>`, `<`, `$( )`) always gets the least-privileged class, so `npm install && cat secrets` gains nothing.
- Web search and file writing are separate tools with fixed classes. No bash command can reach those classes.
- A search query, a file path and file content travel into the call as base64 data and are decoded inside it. They are never shell text.
- **Secret values are removed from everything a call returns**, at the one point where output leaves Archil, before it reaches the model, a log or the browser. This covers the remaining channel: a test that prints its configuration can no longer put the secret into the model's context, where a later call with network access could repeat it. It catches the exact value and its base64, hex, URL-encoded and JSON-escaped forms; the model is told when something was removed.

## What has been shown working

All of this ran on a real Archil account in `aws-us-west-2` on 10 November 2026. Run tags match the logs in `runs/`.

**The real agent** (run `7pt494`, model `claude-opus-5-5`). Asked to add a function, add tests, and write a short doc citing a page found through its own search, Claude finished in 10 calls and 36 seconds: 3 plain reads, 2 web searches, 3 file writes, 1 install, 1 test run. Its first search returned an unrelated package, so it searched again and cited the `ms` README. Then the tool checked the result itself:

- the whole test suite passes when re-run (3 of 3);
- the new function returns the required text;
- the doc cites a page the agent's own search returned;
- no call held the secrets with network access, or with a writable folder.

**Measured access** (run `yv27yv`). One harmless probe per class, plus one with no limits. Each probe reads the canary secret, tries to write each folder, and fetches `example.com`, which is on no allowlist.

| Class | Read the secret | Write the project | Write web results | Reach an outside host |
|---|---|---|---|---|
| search | no | not mounted | yes | blocked |
| install | no | yes | not mounted | blocked |
| edit | no | yes | not mounted | blocked |
| test | **yes** | refused | not mounted | blocked |
| other | no | refused | refused | blocked |
| no limits | **yes** | yes | yes | **reachable** |

Only the unlimited baseline could both read the secret and reach an outside host. In both rows where the secret was readable, the scrubber removed it from what came back: the host saw `"apiKey":"[REDACTED]"`.

**Several tenants at once** (runs `0vsgsc`, `pclkxl`, `az4wr9`). Two agent rehearsals and one access matrix started together, each on its own three disks: all three passed every check, 26 Archil calls in 16 seconds. A fourth request was refused because of the cap on concurrent runs.

Earlier runs on the same account, before the dashboard (runs `7hkmmu`, `5sb7jh`, `y2mfnt`), are described in `DEMO.md`.

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

To try the dashboard with no keys and no network, start it with stand-ins for Archil and the model:

```bash
npm run start:fake
```

Everything else:

| Command | What it does | Needs |
|---|---|---|
| `npm test` | 31 tests (policy, scrubbing, error reporting, cleanup after interrupted runs, the server end to end with stand-ins) and the agent self-test | nothing |
| `node agent.mjs --fake` | A whole session in the terminal, against stand-ins | nothing |
| `npm run matrix` | Measure what each class can reach | Archil key |
| `npm run rehearse` | The agent loop on Archil, with scripted steps in place of a model | Archil key |
| `npm run agent` | The real agent in the terminal | Archil and Anthropic keys |
| `npm run demo` | The original four-step comparison with and without limits | Archil key |

A run creates three disks named `scoped-agent-...` or `scoped-matrix-...` and deletes them at the end; add `--keep` on the command line to leave them. An agent run makes about 13 Archil serverless calls (10 by the agent, 3 for the checks); a matrix makes 6. Web search uses Keenable's keyless public endpoint, so no search key is needed. The server listens on 127.0.0.1 only, refuses requests whose Host or Origin is not this machine, and runs at most three sessions at once.

## How it is put together

| File | Role |
|---|---|
| `policy.mjs` | The classes, the rules that sort a command into a class, and the two invariants |
| `runner.mjs` | Turns one tool call into one Archil call with only the granted mounts and network rule; scrubs its output |
| `scrub.mjs` | Removes known secret values, and their common encodings, from text |
| `loop.mjs` | The agent loop (Claude, three tools), the task, and the scripted rehearsal |
| `session.mjs` | One complete run: its own disks, the agent, the independent checks, cleanup; and the access matrix |
| `server.mjs` | The dashboard server: starts runs, streams their events, lists earlier runs |
| `public/index.html` | The dashboard page (no external dependencies) |
| `agent.mjs` | The command-line entry point and the agent self-test |
| `fake.mjs` | Stand-ins for Archil, for offline tests and fake mode |
| `demo.mjs` | The original scripted comparison with and without limits |
| `*.test.mjs` | Tests |
| `sample-app/` | The small project the agent works on |

The agent's model loop and conversation run on your machine. Archil holds only the project, the secrets and the web results. Nothing survives between calls except what is on those disks, so the install step writes dependencies into the project disk, where the test step finds them.

The model call uses `claude-opus-5-5` at `medium` effort, with the server-side refusal fallback (`fallbacks: "default"`) turned on, so a request a safety check declines is retried on a fallback model instead of stopping the run. Set `AGENT_MODEL` to use another model.

## Known limits

- **Scrubbing catches known forms only.** A secret that a test splits, reverses or encodes some other way would get past it. The per-call limits are still the main protection: the call that reads the secrets has no network and nothing it can write.
- **Names still resolve under a network deny rule.** Connections are blocked, but a name lookup is answered. Whether that is intended is an open question for Archil.
- **The classification rules are small.** They recognise npm, pnpm, yarn and pip installs, and `node --test`, `npm test` and `pytest`. A real project would need more.
- **It has been run on one small project.** A custom task can be given in the dashboard, but it runs on the same sample project, and only the generic checks (test suite, the two invariants) apply to it.
- **The source check verifies where a cited link came from,** not whether it is the right page. The scripted rehearsal shows this: it cites the first search result, which is not always about `ms`.
- **Folder-scoped mounts were tested on a few paths, not audited.** That is why the design uses separate disks.
- **Keenable's keyless limit is 1,000 requests an hour per IP address,** and calls from Archil may share an address with other users.
- **If the process running a run dies** (the server is killed, or a command-line run is stopped), that run's disks stay until the dashboard server next starts. On start it deletes them: only disks named in that run's own log, by exact name and with that run's prefix, and only once the process that ran it has ended. It skips a run whose process is still alive, such as a command-line run in progress; for a log with no recorded process, it waits until the run has been silent for 15 minutes. The run is shown as interrupted, with what was deleted. (Tested on Archil by killing the server mid-run.) Any other failure, such as a rejected key, deletes the run's disks straight away.
