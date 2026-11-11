# Demo script for in-person judging

Judges walk from table to table. Each one gives you two to four minutes, arrives in the middle of whatever you were doing, and may interrupt. So this script has three sizes: a 15-second hook, a 90-second walkthrough with a live run, and extra depth for a judge who stays.

Every number here comes from a real run on the hackathon account on 10 November 2026. The run tags are given so a judge can open the run in the run list.

The walkthrough is written for the animated page (`ui/`, port 5173). The built-in page (port 4317) shows the same runs with different names and colours; the table near the end maps one to the other.

## Words you will use

| Word | Plain meaning |
|---|---|
| Agent | An AI model that does things (runs commands, writes files, searches the web), not only writes text |
| Tool call | One thing the agent does: one command, one search, one file write |
| Sandbox | One cloud computer an agent keeps for its whole job |
| microVM | A tiny throwaway computer that starts in milliseconds and is destroyed after one command |
| Disk | Storage that outlives the microVM. Here: one for the project, one for saved web results |
| API key | A password one program uses to talk to another |
| Class | The kind of call: search, install, edit, test or other. It decides the access |
| Network edge | The point where a request leaves the microVM. Archil can add the key there |
| Allowlist | The short list of addresses a call may reach. Everything else is blocked |
| Probe | A harmless script that tries every door and reports which ones opened |

## Before judging starts

- [ ] Laptop on its charger, sleep turned off, notifications off. Put the browser in full screen: the animated stage is drawn for a wide screen.
- [ ] `.env` has the Archil key, the region and the Anthropic key. Keep that file closed.
- [ ] Terminal 1, in the repository root: `npm start`. Open http://127.0.0.1:4317/ and wait for the **Service running** pill (about ten seconds on a first start). Leave this tab open as your fallback page.
- [ ] Terminal 2, in `ui/`: `npm run dev`. Open http://127.0.0.1:5173/. The top right must say **Server connected**, and there must be no **Fake mode** chip.
- [ ] Click **Measure access per class** once. It warms Archil and leaves an **Access matrix** run in the list, which you need in step 7.
- [ ] Click **Live agent**, then **Run the agent**, and watch it to the end. This is your test that the animated page works live, and the finished run is what you replay if a later one fails.
- [ ] Click **Rehearsal**, then **Run the agent** once. That run contains the refused call for step 8.

Three things about the animated page that can catch you out:

- **It starts on Rehearsal every time the page loads.** Click **Live agent** before **Run the agent**, then read the line under the title: it must say *Live agent, claude-opus-5-5*, not *Scripted rehearsal*. Never say "live" over a rehearsal.
- **The Demo runs panel is not results.** Its three entries are animations scripted inside the page, which need no server. Their title starts with "Demo:" and carries a *scripted demo, not a real result* tag. Do not show one to a judge unless everything else is down, and say what it is.
- **Choosing a finished run replays it from the start.** So your finished live run is a real result you can play for any judge with no waiting and no network. Say: "this is a real run from earlier, replayed."

Between judges: click your finished live run so the stage is moving, and leave **Live agent** selected.

## The 15-second hook

For a judge who is walking past or asks "what is this?"

> AI agents download strangers' code and use your API key in the same machine. On Archil every command gets its own tiny machine, so we give every command its own access, and the key never enters any machine at all. Want to see it run live? It takes forty seconds.

## The speech

Say this before you click anything. It takes about 45 seconds.

> Hi, I'm Shokhabbos. This is Scoped Runner.
>
> When an AI agent writes code for you, it does two risky things. It downloads packages written by strangers, and it runs your tests, which need your API key. Normally both happen inside one sandbox, so the strangers' code and your key sit in the same machine.
>
> Archil's idea is that an agent doesn't need a sandbox: it needs a disk, and a brand-new tiny machine for every command. So we asked: if every command already gets its own machine, why should every command get the same access?
>
> In Scoped Runner each command gets only what that kind of command needs. The install step can reach the package registry and nothing else. The test step can reach our own service and nothing else. And the API key is never inside any machine. Archil attaches it to the request on its way out.
>
> Let me run it live.

## The walkthrough

About 90 seconds from the first click. A live run took 31 seconds, 41 with the checks (run `lr77kj`). The stage plays each call just after it finishes, so it runs a few seconds behind the log underneath.

Read the class name on each scene, not its colour: the two pages colour the classes differently.

| # | Do | Say |
|---|---|---|
| 1 | Point across the stage from left to right: **Agent**, **Fixed rules**, then the four boxes on the right: **Project disk**, **Web results disk**, **Project service**, **Internet** | "The agent is on the left and has no computer of its own. On the right are the four things a command could touch. Fixed rules in the middle decide which of them each command gets. The AI never decides." |
| 2 | Click **Live agent**, then **Run the agent**. Check the line under the title says *Live agent* | "This is Claude, live, nothing recorded. I've asked it to add a function to a small project, test it, and cite a web page it finds itself." |
| 3 | Each call plays as one scene: the command at the top, the rules stamp a class, a microVM appears, lines connect it to what it may touch, then it is marked *destroyed* | "Every scene is one fresh Archil machine. Watch which lines connect." On `other`: "Reading files: both disks read-only, service and internet blocked." On `search`: "Only the web results disk and the search service. It can't see the project." On `install`: "The project disk and the package registries. This is where strangers' code arrives, and the line to our service stays blocked." |
| 4 | On the `test` scene, point at the key icon sitting on the line to **Project service** | "Now the tests run against our service. See the key on the line, outside the machine? Archil adds it on the way out. The machine never held it, and the internet is blocked." |
| 5 | The stage ends on **All 9 checks passed** and the **Verdict** tile shows 9/9 | "We don't take the agent's word that it worked. After it stops, we re-run the tests ourselves and check the page it cited." |
| 6 | Scroll to the **Measured access** table at the bottom | "We don't take our own rules' word either. A probe in every class looked for the key and tried every door. *API key inside*: no, in every row. Only `test` reached the project service, and it reached nothing else." |
| 7 | Click the **Access matrix** run in **Runs**, scroll to its table, point at the last row, **no limits (baseline)** | "Same probe with no limits, which is how a sandbox works: key inside, service reachable, internet reachable. That row is what we removed." |
| 8 | Only if the judge is still with you: click the rehearsal run, then click near the end of the bar under the stage until the heading reads **Refused before any machine started** | "One more rule. Claude sees every call's output, so it could carry our service's data out in a later search. Once it has seen test output, searches and installs are refused, before any machine starts." Say that this run is scripted. |
| 9 | Point at the **Known gap** note under the **Measured access** table | "One thing we can't close: name lookups still work when the network is blocked. Something inside a call could leak that way, which is exactly why the key is never inside. We report it in every run." |
| 10 | Stop clicking | "Compute per tool call makes access per tool call possible. A sandbox can't do this, because the key has to live in the machine. Here it never does." |

If a judge interrupts with a question, answer it, then pick up at whatever scene is on the stage. The run keeps going without you.

Controls worth knowing: the button left of the bar pauses and replays; clicking the bar jumps to a call; the **1x** button changes speed; and the play icon beside a row in the **Execution log** plays that call on the stage. Use the last one when a judge says "show me the install step again."

## If the judge stays

- **Let them choose the task.** Click **Live agent**, open the **Task** list, pick **Custom task...** and type what they ask for. It runs on the same small project. The access shown on the stage, the measured table and the test re-run still apply; the checks written for the preset task do not. Say so before you click.
- **Show a blocked attempt.** In any run, the **Measured access** table shows what each class tried and what was refused, for example `other` trying to write the project.
- **Show the rules.** Open `policy.mjs`. The whole policy is under a hundred lines, and `policy.test.mjs` fails if anyone weakens it.
- **Show several users at once.** Three runs started together each got their own disks and their own key, and all passed in about 15 seconds (runs `duq1g7`, `v44wqb`, `lywvtm`).

## Why it should win, one line per criterion

| Criterion | Line |
|---|---|
| Creativity | "Everyone uses per-call compute to save money. We use it for security: the key never enters the machine." |
| Use of Archil | "It needs four Archil features together: a microVM per call, per-call disk mounts, per-call network rules, and the rule that adds a header at the edge. It can't be built on a sandbox." |
| Technical execution | "A live model, 37 passing tests, and every run measures its own claims on the platform and reports the one gap it found." |

## If something breaks

- **The live run fails or stalls.** Click your finished live run in **Runs**. It replays from the start; walk through it from step 3. Say: "This is a real run from earlier, replayed."
- **The model call fails.** Click **Rehearsal**, then **Run the agent**: the same real Archil calls, with scripted steps in place of Claude. Say it is scripted.
- **The animated page is blank or says "Server offline".** Check terminal 1 is still running `npm start`. If the animated page itself is the problem, switch to the built-in page tab on port 4317 and use the table below.
- **The buttons are greyed out with a warning about the service.** Run `npm run service:stop`, then `npm start` again, and wait for **Service running** on the built-in page.
- **A search call fails with HTTP 429.** The free search limit is shared per network address. Say so, and replay run `lr77kj`.
- **The run buttons are disabled and the panel says "3/3 running".** At most three run at once. Wait for one to finish.
- **Archil or the wifi is down.** Stop the server and run `npm run start:fake`: the same pages with stand-ins. A **Fake mode** chip appears; say so. Your earlier real runs are still in the list and still replay.

## If you use the built-in page instead

| Animated page (port 5173) | Built-in page (port 4317) |
|---|---|
| **Live agent**, **Run the agent**, **Measure access per class** | **Live model**, **Run agent**, **Measure access** |
| Starts on **Rehearsal** | Starts on **Live model** |
| One scene per call on the stage | One row per call under **Calls**; click a row to open it. The labels under each row show its access |
| Key icon on the line to **Project service** | The label *key added at the edge* on the `test` row |
| **Verdict** 9/9 | *all checks passed* beside the title |
| Last row **no limits (baseline)** | The red **no limits** row |
| **Known gap** note | The amber **Known platform gap: DNS** line |
| No class table; a legend under the stage | The **Access classes** table on the left: good for "what are the five classes?" |
| `test` is amber, `edit` is green | `test` is green, `edit` is purple |

One line on the built-in page is out of date: it says each run gets three fresh disks. An agent run creates two (project and web results); the access matrix creates three.

## Questions you may get

**"You say no sandbox, but your service runs in a sandbox."**
The agent has no sandbox. The service is the thing the tests call, standing in for whatever API a real company already runs somewhere. A server has to stay switched on, so it lives in one small Archil sandbox. No agent command ever runs there.

**"Isn't this a thin wrapper over a few API fields?"**
The mounts, network rules and header-adding rule are Archil's. The project is what is built on them: five classes chosen by rules the model cannot talk around, the key moved out of every machine, a rule that stops the model carrying your service's data out, inputs passed as data so they can never become shell text, scrubbing at the point output leaves Archil, and checks that measure what each class can actually reach in every run. And it only works because compute is per call.

**"Who decides what access a call gets?"**
Fixed rules in `policy.mjs`. A command that chains, pipes or redirects always gets the least-privileged class. In the live run Claude's first command chained several reads with `;`, and it got read-only access with no network, which was all it needed.

**"A malicious dependency runs during the tests. What can it do?"**
It can call your service, through the key Archil adds, but it cannot read the key, cannot reach anything else, and cannot write anything a later call reads. It could try to leak service data through DNS; that is the open platform gap we measure and report. That's why the key used for tests should have the least privilege your service allows.

**"What if a web page tells the model to send your data somewhere?"**
Once the model has seen test output, searches and installs are refused, and outgoing text containing a known secret is refused at any time. In an earlier run, asked outright to print the secret, Claude also declined on its own (run `5k7sru`).

**"Does a deny rule really block everything?"**
Connections, yes: every run measures it. DNS lookups, no: Archil's resolvers answer in every call, and blocking them stops the call from starting. We report it in every run.

**"Can a call get around the allowlist by claiming to be an allowed host?"**
No. We tested it: a connection to another host's address that named `registry.npmjs.org` was routed to npm.

**"Why not a sandbox with a firewall?"**
A sandbox can change its policy between steps, but whatever the install step left running is still running when the tests start, and the key has to be in the machine. Here each call starts empty, and the key never enters.

**"Does this scale past one user?"**
Each run gets its own disks and its own key on a shared service. Three runs started together all passed in about 15 seconds. The page caps it at three to protect the account, not because of a platform limit; we have not measured larger numbers.

**"Is the agent's result real, or staged?"**
The model chooses its own steps, and they differ between runs. In run `lr77kj` it read the rule about test output and did its searching and installing first. The rehearsal and the demo runs are labelled as scripted wherever they appear.

**"Is that animation real time?"**
The log under it is. The stage draws each call just after it finishes, because the server reports a call when it ends, so it runs a few seconds behind and speeds up to catch up.

**"What would you build next?"**
More classification rules (it knows npm, yarn, pnpm, pip, `node --test` and pytest today), a second real project, and a fix or workaround for DNS once Archil answers.

## Numbers you can quote

| Fact | Value | Source |
|---|---|---|
| Live agent, full task | 10 calls in 31 s (41 s with checks), all 9 checks passed | run `lr77kj` |
| Calls by class in that run | 3 other, 2 search, 1 install, 3 edit, 1 test | run `lr77kj` |
| microVMs started in that run | 19 (10 calls, 4 checks, 5 probes) | run `lr77kj` |
| Classes found holding the key, measured | 0 of 5 (the no-limits baseline: yes) | runs `lr77kj`, `64f3dh` |
| Classes that reached the service | only `test`, and it reached nothing else | runs `lr77kj`, `64f3dh` |
| Outbound call refused after test output | 1 of 1 attempted | run `mik8il` (rehearsal) |
| Three runs at once | all passed in about 15 seconds | runs `duq1g7`, `v44wqb`, `lywvtm` |
| DNS lookups under a deny rule | answered in every class | every run |
| Tests | 37 tests and the agent self-test pass | `npm test` |
