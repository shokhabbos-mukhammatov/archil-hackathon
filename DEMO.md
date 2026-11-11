# Demo script

For a slot of two to three minutes. The numbers quoted here come from real runs; the run tags are given so they can be checked in the dashboard's run list or in `runs/`.

## The pitch

**One sentence.** Archil gives an agent compute one tool call at a time, so we give it access one tool call at a time, and the API key never enters any call at all: Archil adds it at the network edge.

**Three sentences.** Archil says agents do not need a sandbox, just a disk and a microVM per tool call. With a microVM per call, each step can have only the folders and network it needs: the step that downloads third-party code cannot reach your service, and the step that runs your tests reaches only your service, with the key added on the way out. And because the model sees every call's output, once it has seen your service's data nothing more can go out to third parties.

## Before you go on

- [ ] `.env` has the Archil key, the region and the Anthropic key.
- [ ] Run `npm start` and open http://127.0.0.1:4317/. Wait for the "Service running" pill (the first start takes about ten seconds).
- [ ] About five minutes before, click **Measure access** once. It warms the image and leaves the matrix in the run list for later.
- [ ] Have **Live model** selected and the preset task chosen, ready to click **Run agent**.
- [ ] Keep a terminal open on this folder for the fallbacks below.

## The three minutes

| Time | Do | Say |
|---|---|---|
| 0:00 | Dashboard on screen | The one-sentence pitch. |
| 0:15 | Point at the **Access classes** table | "Five kinds of call, picked by fixed rules, never by the model." Point at `install`: registries only, can't reach your service. Point at `test`: your service only, and the key column says *at edge*. "The key is never inside the machine." |
| 0:35 | Click **Run agent** | "Claude Opus 5.5, live, no sandbox. Every row is one fresh Archil microVM." |
| 0:40 | Rows appear for about 30 seconds | Read the class of each row. On a search row: "Keenable only." On install: "registries only." On the test row, open it: "This one reached the service. Archil added the key on the way out; the call never had it." |
| 1:15 | Checks tick green, then the **Measured access** table | "We don't take the agent's word, or even our own policy's. After the run, a probe in every class looked for the key in everything it could see, and tried every door. Only `test` reached the service, nothing held the key." |
| 1:45 | Point at the amber DNS line | "One thing we can't close: DNS lookups still work under a deny rule on Archil today. Anything inside a call could leak that way, which is exactly why the key is never inside. We've raised it with the Archil team." |
| 2:05 | Click the earlier **Access matrix** run | "Same probe with no limits, the way a sandbox works: key inside, service reachable, internet reachable." |
| 2:20 | Close | "Compute per tool call makes access per tool call possible, and the key never has to enter the machine." Stop. |

The live run took 41 seconds including the checks in our test.

## If something breaks

- **The model call fails or is slow.** Switch to **Rehearsal** and click **Run agent**: the same real Archil calls with scripted steps. It also shows the refusal rule: after its test run, one more search is refused. Say it is scripted.
- **The service won't start.** The pill says "Service failed". Run `npm run service:stop`, restart `npm start`, and wait for "running".
- **The search step reports HTTP 429.** Keenable's keyless limit is shared per IP address. Say so, and open run `lr77kj` from the list.
- **Archil is unreachable.** Stop the server and run `npm run start:fake`: the same dashboard with stand-ins. The banner says FAKE MODE; say so.

## Questions you may get

**"Isn't this a thin wrapper over a few API fields?"**
The mounts, network rules and header-adding rule are Archil's. The project is what is built on them: five classes chosen by rules the model cannot talk around, the key moved out of every machine, a rule that stops the model carrying your service's data out, inputs passed as data so they can never become shell text, scrubbing at the point output leaves Archil, and checks that measure what each class can actually reach in every run. And it only works because compute is per call.

**"Who decides what access a call gets?"**
Fixed rules in `policy.mjs`. A command that chains, pipes or redirects always gets the least-privileged class. In the live run Claude's first command chained several reads with `;`, and it got read-only access with no network, which was all it needed.

**"A malicious dependency runs during the tests. What can it do?"**
It can call your service, through the key Archil adds, but it cannot read the key, cannot reach anything else, and cannot write anything a later call reads. It could try to leak service data through DNS; that is the open platform gap we measure and report. That's why the key used for tests should have the least privilege your service allows.

**"What if web results tell the model to send your data somewhere?"**
Once the model has seen test output, searches and installs are refused, and outgoing text containing a known secret is refused at any time. In an earlier run, asked outright to print the secret, Claude also declined on its own (run `5k7sru`).

**"Does a deny rule really block everything?"**
Connections, yes: every run measures it. DNS lookups, no: Archil's resolvers answer in every call, and blocking them stops the call from starting. We report it in every run and have raised it with Archil.

**"Can a call get around the allowlist by claiming to be an allowed host?"**
No. We tested it: a connection to another host's address that named `registry.npmjs.org` was routed to npm.

**"Why not a sandbox with a firewall?"**
A sandbox can change its policy between steps, but whatever the install step left running is still running when the tests start, and the key has to be in the machine. Here each call starts empty, and the key never enters.

**"Does this scale past one user?"**
Each run gets its own disks and its own key on a shared service. Three runs started together all passed in 16 seconds (runs `duq1g7`, `v44wqb`, `lywvtm`). The dashboard caps it at three to protect the account, not because of a platform limit; we have not measured larger numbers.

**"Is the agent's result real, or staged?"**
The model chooses its own steps. In run `lr77kj` it read the rule about test output and did its searching and installing first. The rehearsal is labelled as scripted wherever it appears.

## Numbers you can quote

| Fact | Value | Source |
|---|---|---|
| Live agent, full task | 10 calls in 31 s (41 s with checks), all 9 checks passed | run `lr77kj` |
| Calls by class in that run | 3 other, 2 search, 1 install, 3 edit, 1 test | run `lr77kj` |
| Classes found holding the key, measured | 0 of 5 (the no-limits baseline: yes) | runs `lr77kj`, `64f3dh` |
| Classes that reached the service | only `test`, and it reached nothing else | runs `lr77kj`, `64f3dh` |
| Outbound call refused after test output | 1 of 1 attempted | run `mik8il` (rehearsal) |
| Three runs at once | all passed in 16 seconds | runs `duq1g7`, `v44wqb`, `lywvtm` |
| DNS lookups under a deny rule | answered in every class | every run |
| Tests | 37 tests and the agent self-test pass | `npm test` |
