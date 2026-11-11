# Demo script

For a slot of two to three minutes. The numbers quoted here come from real runs; the run tags are given so they can be checked in the dashboard's run list or in `runs/`.

## The pitch

**One sentence.** Archil gives an agent compute one tool call at a time, so we give it access one tool call at a time: each call gets only the folders and network it needs, and none ever holds the secrets and a network connection together.

**Three sentences.** Archil says agents do not need a sandbox, just a disk and a microVM per tool call. A sandbox has one set of permissions for its whole life, so the step that downloads third-party code and the step that reads your secrets share the same access. With a microVM per call, each step can have its own, and we built the runner and the dashboard that show it.

## Before you go on

- [ ] `.env` has the Archil key, the region and the Anthropic key.
- [ ] Run `npm start` and open http://127.0.0.1:4317/ in a browser. Zoom so the Calls panel is readable from the back of the room.
- [ ] About five minutes before, click **Measure access** once. The first call after a quiet period waits about ten seconds while Archil prepares the image; this warms it. Leave that run in the list: it is the matrix you show later.
- [ ] Have **Live model** selected and the preset task chosen, ready to click **Run agent**.
- [ ] Keep a terminal open on this folder in case you need the fallbacks below.

## The three minutes

| Time | Do | Say |
|---|---|---|
| 0:00 | Dashboard on screen, intro panel | The one-sentence pitch. |
| 0:15 | Point at the **Access classes** table | "Five kinds of call. Fixed rules pick the kind; the model never decides its own access." Point at `install`: registry only, no secrets. Point at `test`: secrets, no network, nothing writable. |
| 0:30 | Click **Run agent** | "This is Claude Opus 5.5, live, with no sandbox. Every row is one Archil microVM with fresh mounts." |
| 0:35 | Rows appear for about 35 seconds | Read the class of each row as it lands. On a search row: "Keenable only, no project, no secrets." On the install row: "Registry only." On the test row: "Now it can read the secrets, and it has no network and nothing it can write." Point at the two red-or-green tiles: "These two count calls that held the secrets with network, or with a writable folder. They stay at zero." |
| 1:15 | Independent checks tick green | "We don't take the agent's word for it. After it stops, the tool re-runs the tests on Archil and checks the cited source itself." |
| 1:35 | Click the earlier **Access matrix** run in the list | "That's what we declared. This is what we measured: the same harmless probe, once per class. Only the row with no limits can read the secret *and* reach the internet." Point at the test row's last column: "And even where the secret is readable, the value is scrubbed before anything comes back to the host or the model." |
| 2:15 | Back to the agent run | Close: "Compute per tool call makes access per tool call possible. A sandbox can't do this." Then name one limit honestly (see below) and stop. |

A live run took 36 seconds in our test, so there is room.

## If something breaks

- **The model call fails or is slow.** Switch to **Rehearsal** and click **Run agent**. It makes the same real Archil calls with scripted steps; the run header says "rehearsal", and you should say so too.
- **The search step reports HTTP 429.** Keenable's keyless limit is shared per IP address. Say so, and open run `7pt494` from the list.
- **Archil is unreachable.** Stop the server and run `npm run start:fake`: the same dashboard with stand-ins. The banner says FAKE MODE; say so. Then open earlier real runs from `runs/` with `npm start` once the network is back.

## Questions you may get

**"Isn't this a thin wrapper over two API fields?"**
The mounts and network rule are Archil's. The project is the policy around them: five classes, two invariants that tests enforce, rules that cannot be talked into more access, inputs passed as data so a search query or a file's content can never become shell text, secret scrubbing at the point output leaves Archil, and checks that measure what each class can actually reach. And it is only possible because compute is per call.

**"Who decides what access a call gets? If the model does, that's the hole."**
Fixed rules in `policy.mjs`. The model never chooses. A command that chains, pipes or redirects always gets the least-privileged class. In the live run Claude's first command chained several reads with `;` and `|`, and was given read-only access with no network, which was all it needed.

**"Code installed in one step runs in the test step, which has the secrets. What stops it getting them out?"**
The test call has no network, its project mount is read-only, and its scratch space disappears with the microVM, so it has nothing to write that a later call would read. The one remaining channel was the test call's output, which goes back to the model; that output is now scrubbed of the secret's value and its common encodings before the model sees it. A secret printed in some other transformed form could still get past the scrubber, which we say plainly.

**"What if someone just asks the agent to print the secret?"**
We tried: a custom task asked Claude to log the whole configuration in a test and report what it printed (run `5k7sru`). Claude declined, saying it would route the secret key into tool output, and offered to log only the service name instead. Had it gone ahead, the test call still had no network, and the scrubber would have replaced the value with `[REDACTED]` before Claude saw it.

**"Does a network deny rule really block everything?"**
Connections, yes: the matrix measures it on every run. Name lookups are still answered under a deny rule. We found that during testing and it is an open question for Archil.

**"Why not a sandbox with a firewall?"**
A sandbox has one policy for its lifetime. Here the install step and the test step get different mounts and different network rules, seconds apart, with nothing running in between.

**"Why separate disks and not folders on one disk?"**
Archil's guidance is that the disk is the unit of isolation. Folder-scoped mounts did hide a planted file in our check, but we tried a few paths and did not audit them.

**"Does this scale past one user?"**
Every run gets its own three disks and canary. Three runs started together all passed, 26 Archil calls in 16 seconds (runs `0vsgsc`, `pclkxl`, `az4wr9`); the dashboard caps concurrent runs at three to protect the account, not because of a platform limit.

**"Can you run it on a task I choose?"**
Yes: choose **Custom task** in the dashboard. It runs on the same sample project. The access summary and the two invariants still apply; the checks written for the preset task do not.

**"Is the agent's result real, or did you stage it?"**
The model chooses its own steps, and they differ between runs. In run `7pt494` Claude's first search returned an unrelated package, so it searched again before citing anything. The rehearsal mode is labelled as scripted wherever it appears.

## Numbers you can quote

| Fact | Value | Source |
|---|---|---|
| Live agent, full task | 10 calls in 36 seconds, all 5 checks passed | run `7pt494` |
| Calls by class in that run | 3 other, 2 search, 3 edit, 1 install, 1 test | run `7pt494` |
| Calls granted the secrets with network access | 0 | every run |
| Classes that could read the secret and reach outside (measured) | 0 of 5 under limits; the unlimited baseline could | run `yv27yv` |
| Secret values that reached the host unredacted | 0 (2 redactions in the matrix) | run `yv27yv` |
| Three runs at once | all passed, 26 Archil calls in 16 seconds | runs `0vsgsc`, `pclkxl`, `az4wr9` |
| First call when the image is cold | about 10 seconds of queueing | run `7hkmmu` |
| Tests | 31 tests and the agent self-test pass | `npm test` |
