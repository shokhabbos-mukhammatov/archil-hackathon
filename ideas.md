# Archil hackathon: ideas, scores and decisions

Last updated 2026-11-10. Facts about Archil come from its docs. Scores and rankings are opinions from AI reviewers, not measurements. Nothing has been built or tested yet.

## Decisions

### Decided

| # | Decision | Made by | Reason |
|---|---|---|---|
| 1 | Aim for the **Most creative agent project** prize. | You | Your choice after the blind review showed the best idea depends on the prize. |
| 2 | **Sleeping pet is rejected.** The project must be technical. | You | "Hackathon still tech related." |
| 3 | Pets, games and audience stunts are set aside. | Me, reading decision 2 | This is my interpretation of decision 2. It removes Forked game player, Destroy-and-reset room, Shared flat, World survey map and Branching story. Say so if it is too broad. |
| 4 | The agent flight recorder is no longer the default pick. | Me, after the blind review | It was my original recommendation. Once the pool was widened and described evenly, it was one contender among several, and other teams are likely to build it. |
| 5 | Bisect and the what-if database are dropped. | Me, after the blind review | Serverless exec cannot run against a checkpoint or branch, so bisect's mechanism is not available. All three reviewers put the what-if database in their bottom three. |
| 6 | **Build the forkable agent runtime** (the Live-fork explorer widened into one product). | You | "I like this idea." It was my pick as the best end-to-end project once build time stopped being the deciding factor. |
| 7 | Build time is not a reason to cut scope. | You | "Don't worry about limited time, I can handle it." |

| 8 | **The forkable agent runtime is set aside**, along with anything built on forks, branches, checkpoints or undo. | You | Several other teams at the event are building identical projects. |

| 9 | **The most creative prize is no longer the target.** This replaces decision 1. | You | "Let's don't worry about the most creative track." |
| 10 | **Build Tested search in its improved form**, aimed at technical execution first and best use of Archil second. | You, on my recommendation | It has the lowest platform risk of the ideas considered, it is clear of the fork projects, and the reviewers' objections are fixable. |

### Still open

- **The premise check.** The project only makes sense if there are real breakages from recent library releases where a model's unaided fix fails and a fix from the web passes. Three such cases are needed for the demo. In progress.
- **Scratch space.** Whether a serverless exec can write to scratch space inside its own microVM is untested. Needs an Archil API key.
- **Plan.** At about 25 serverless calls per run, the free plan's 1,000-call cap lasts roughly 40 runs. The reviewers recommend the $10 Developer plan. Not yet decided.
- **One alternative not ruled out on evidence.** In the 19-idea review the Injection test range was all three reviewers' pick for technical execution (12 of 15 for technical depth, against 10 for Tested search before its improvements). It was passed over because it needs sandbox compute and uses forking as its reset.

## Chosen project: Tested search

### The shape being built

Narrowed from "any error" to "my code broke after an upgrade". Breakages from recent releases are where a model's knowledge is stale, so the web search is needed by construction. This narrowing is my suggestion and has not been reviewed.

1. **Sweep.** Run the reproduction across recent releases of the dependency, each in its own microVM, to find the release that broke it.
2. **Search.** Use Keenable to find what changed upstream and candidate fixes.
3. **Test.** Run each candidate in its own microVM against a check script it cannot edit, next to the model's unaided answer as a control.
4. **Label.** Mark each passing result as a real fix or a workaround, with its source and the exact change.
5. **Remember.** Store verified fixes on the disk so the same breakage is answered at once next time.

Stages 1 and 3 share one runner. Each stage is a demo on its own if a later one slips.

### The idea as first proposed

**Description.** A developer gives the tool an error and a small reproduction of it. The tool confirms the reproduction fails, searches the web through Keenable for candidate fixes, has a model turn each into a concrete patch, runs every candidate in its own fresh microVM in parallel, and returns only the fixes that verifiably make the reproduction pass, each with its source link and the exact change applied.

- **Relies on:** Keenable web search; Archil parallel serverless exec. No sandboxes, forks or branches.
- **Why it was proposed:** it leads with capabilities the fork-based projects don't use, works from Windows through the SDK, and uses both sponsors' technology.

### Review result

Three fresh reviewers (sponsor, judge, developer) evaluated it without knowing it was my lean. They wrote a case for and against before scoring, on the same four criteria as the 19-idea review.

| Criterion | Sponsor | Judge | Developer | Sum (of 15) |
|---|---|---|---|---|
| Creative | 3 | 3 | 3 | 9 |
| Archil use | 3 | 3 | 3 | 9 |
| Technical | 3 | 4 | 3 | 10 |
| Feasible | 4 | 3 | 4 | 11 |
| **Total (of 60)** | | | | **39** |

For comparison, 39 is mid-table in the 19-idea review: level with Change preview, below the Step timeline (45) and the Dry-run gate (44).

All three reached the same verdict: build it only with changes. In their words, as written it is "competent but forgettable" and "a pleasant 3 out of 5".

Prize chances, per the judge reviewer, as written: most creative medium-low; best use of Archil low; technical execution medium, rising to high if it works on an error a judge picks.

### Weaknesses the reviewers found

1. **"Why not just ask the model?"** For most errors with an answer on the web, the model fixes it unaided, so the search and the microVMs look decorative. All three raised this first.
2. **A pass is not a fix.** Deleting the failing line, swallowing the exception or pinning an old version all make the reproduction pass.
3. **The source link can be decoration.** Given the error and the code, the model may write the right fix whatever the web page said.
4. **Archil is replaceable as described.** A dozen parallel runs can be done on other platforms, and the disk only holds a few files.
5. **The live chain is fragile.** Poor search results, patches that don't apply, or slow dependency installs can produce an all-red grid.

### Improvements the reviewers proposed

| Improvement | Fixes | Proposed by |
|---|---|---|
| **Control row.** Run the model's unaided answer as candidate zero, plus a no-change candidate, and choose demo errors from library releases too recent for the model to know. | 1 | All three |
| **Strict check.** The user supplies a check script that asserts expected behaviour. It runs from an untouched copy so a candidate cannot edit it. Version pins and suppressed errors are labelled as workarounds, and fixes are ranked by smallest change. | 2 | All three |
| **Quote-checked sources.** Each candidate must include a verbatim quote from its page, checked against the fetched text. | 3 | Developer |
| **Verified-fix ledger.** Store every passing fix on the disk with its error signature, patch, source, environment and output. The next person with the same error gets a search hit and a one-run re-check against their own reproduction. This makes the disk do real work. | 4 | Sponsor; the judge proposed the same records as "receipts" |
| **Version sweep.** Run the unchanged reproduction across the last 30 to 40 releases of the suspect dependency with the same runner. It gives a deterministic result and the breaking release sharpens the search. | 4, 5 | Judge and developer as part of the core; sponsor as a stretch only |
| **Safe execution.** Mount the reproduction read-only and restrict network access, since the tool runs code from the internet. Needs the Developer plan. | new risk | Developer |
| **Ship as a command-line tool** with a terminal grid, which avoids the backend a web page would need. | 5 | Developer |
| **Demo preparation.** Pre-warm one image, cap candidates at 8 to 12, let a judge choose among three prepared errors, keep a recording as fallback. | 5 | Sponsor and judge |

### Feasibility findings (from the developer reviewer; not independently checked by me)

- **Each candidate does not get its own copy automatically.** Parallel runs on one shared disk collide. Each run has to copy the reproduction to scratch space inside its own microVM and report through its output.
- **Whether that scratch space is writable is untested.** This is the first thing to check.
- **Keenable's search returns extracted page text** (up to 10,000 characters per result) with site and date filters, and a separate fetch call returns a page as markdown. Python, TypeScript and Go SDKs exist.
- **No existing product was found** that fans web candidates out to parallel sandboxes and returns only verified ones. The mechanism (retrieve, patch, test) is well covered in research; the packaging is new.

### On the alternatives

None of the three would clearly pick another of the new ideas overall. The judge thought Regression archaeology has a better chance at the Archil prize because it is deterministic and uses real parallel width; all three would fold it into Tested search as the version sweep.

## Set aside: forkable agent runtime

Kept for reference. Set aside under decision 8 because other teams are building the same thing.

**Pitch.** Speculative execution for agents. The agent's whole running machine can be forked, so it can try a risky step for real before committing to it, try several approaches at once from the same state, and go back to any earlier point.

**Description.** An agent does operations work inside a sandbox, for example on a server with a live database. Its runtime can fork the running machine, memory and processes included, and uses that one ability in three ways:

- **Gate.** Before a risky command, fork and run the command in the fork. Show the user what actually changed. Approve means the agent carries on in the fork; reject deletes the fork.
- **Explore.** At an uncertain step, fork three times, try a different approach in each from the same in-memory state, check the outcomes and keep the best.
- **Rewind.** Every fork point stays behind as a paused machine, so the run can be restarted from any earlier one.

A web page shows the run as a tree of timelines: which branches were tried, what each changed, which was kept.

**Why it is creative.** The state being copied lives in running processes, so it cannot be faked with file copies. In its game form this mechanism scored 5 of 5 for both creativity and Archil use from all three blind reviewers.

### How it works

- **Brain outside, world inside.** The agent's model loop and conversation live in an orchestrator on the laptop. The sandbox holds only the world: files, database, running services. Each agent step is a fresh command sent into the sandbox.
- **Fork point.** The orchestrator pauses the sandbox once, which produces a checkpoint, then creates the forks from that checkpoint in parallel. The parent stays paused and costs no compute.
- **Agent state forks too.** Each fork gets its own copy of the conversation, so the machine and the agent's memory branch together. Every node in the tree is a pair: a sandbox and a conversation.
- **Effect report.** For each fork, the runtime reports what the command did: file changes, changes in live state (database schema and row counts, running processes, listening ports), and the result of a check command.
- **Commit.** The chosen fork continues. The other forks are stopped and deleted. The parent is kept, paused, as a restore point.

### Weaknesses and how the design answers them

| Weakness | Answer | Basis |
|---|---|---|
| Forking a running sandbox drops attached connections. | Keep the agent outside the sandbox and send each step as a new command, so there is no long-lived connection to lose. Long-running programs run detached inside the sandbox. | Design choice. The SDK also has `sandbox.attach(processId)` for re-attaching. |
| A judge asked: "when you fork, do you restore the agent's conversation or only the disk?" | Both. The orchestrator copies the conversation for each fork. | Design choice. |
| On disk branches, "approve" meant running the command a second time, which may behave differently. | Approve means continuing in the fork, where the command already ran. Nothing is re-run. | Docs: a fork is a full independent sandbox. |
| Serverless exec cannot run on a branch. | Not needed. A forked sandbox accepts commands directly. | Docs. |
| A sandbox cannot be deleted while its forks exist, so parents pile up. | Treat the kept parents as the rewind points, which the product needs anyway. Fork only at decision points, not every step, so a run leaves a handful of parents. Delete losing forks at once. | Docs for the constraint; design choice for the answer. Whether paused sandboxes count toward the concurrent limit needs a test. |
| Fork speed is unpublished. | Keep sandboxes small (1 vCPU, 1 to 2 GiB) so there is less memory to copy. Pause once and create all forks from that one checkpoint in parallel. Gate only commands classed as risky. | Docs: the disk part takes about 50 ms; a fork of a stopped sandbox comes up in about a second. Memory-fork time needs a test. |
| Forking live is refused if extra disks are mounted. | Keep everything on the sandbox's root disk. | Docs. |
| A fork can still act on the outside world: send an email, call a paid API, push to a remote. | Run forks with network access denied or limited to an allowlist, and keep credentials out of the sandbox by using Archil's credential brokering. | Docs: per-sandbox firewall and brokering exist on the Developer plan. On the free plan sandboxes are already limited to a fixed allowlist. |
| Showing "what actually changed" needs the before state, and a paused parent cannot run commands. | Inside the fork, record the before state first: a shadow git repository kept outside the workspace for files, and probe commands for database and process state. Then run the command and compare. | Design choice. |
| How does Explore pick a winner without the agent rationalising? | The check command (tests, a health check, an invariant query) is fixed before forking. A fork that fails the check cannot win. Ties go to the user. | Design choice. |
| What counts as risky? | A rule list (deletes, schema changes, package upgrades, force pushes, service restarts), plus the agent's own flag, plus a strict mode that gates every command that is not read-only. | Design choice. |
| The free plan cannot carry a multi-sandbox project. | Use the Developer plan. A 1 vCPU, 2 GiB sandbox costs about $0.095 an hour while running and nothing while paused, so a base plus three forks running for an hour is under $0.40. | Docs (pricing). Needs your decision. |
| Free-plan sandboxes cannot reach Keenable. | The orchestrator calls Keenable from the laptop, not from the sandbox. | Design choice. |
| Windows cannot mount Archil disks. | Nothing is mounted. Everything goes through the TypeScript SDK, and the web page talks to a local server. | Docs. |
| Live agent demos are flaky. | Start from a prepared stopped template so setup takes about a second, and keep a scripted scenario alongside the free-prompt mode. | Docs for the template fork time. |

### What the docs confirm

Checked in Archil's sandbox guide and fork API reference:

- A sandbox with no extra disks can be forked while running, paused or stopped.
- Forks from running or paused sandboxes resume from the source's CPU, memory and disk state.
- Forking a paused sandbox leaves it paused. Forking a running one pauses it briefly and resumes it.
- A fork call can take a `checkpoint` from an earlier pause, so one pause can feed any number of forks without touching the source.
- Forked sandboxes can themselves be forked, so a tree is possible.
- Only a sandbox's current checkpoint and the one before it can be forked. Older restore points therefore have to be kept as paused sandboxes.

### Limits that remain

- **The outside world cannot be undone.** Blocking the network prevents outside effects in a fork; it does not reverse them once allowed.
- **Rewind depth is bounded.** If paused sandboxes count toward the concurrent limit (20 on the Developer plan), that caps the number of restore points.
- **Clocks jump.** A paused process sees time skip when it resumes, which can expire timeouts and leases. Services should be local to the sandbox.
- **Memory-fork time is unknown** until measured.
- **The combined design is unreviewed.**

### Build order

Tests first, about 15 minutes each:

1. Open a database transaction without committing it, fork the sandbox, and check the transaction is still open in the fork. This proves memory survives.
2. Time one pause plus three parallel forks from its checkpoint at 1 GiB of memory.
3. Check whether paused sandboxes count toward the concurrent limit, and that forks delete cleanly before their parent.
4. Fork a fork, three levels deep.

Then build:

1. Gate, end to end: one fork, the effect report, approve and reject.
2. Explore: several forks, a fixed check command, picking the winner.
3. Rewind and the tree view.
4. Network limits on forks.
5. The demo scenario.

### Demo scenario

A sandbox runs a database holding a small app's data. The agent is asked to make a risky schema change with a backfill. At the destructive step the runtime forks three ways, each trying a different migration approach from the same live state. The effect reports show one approach losing rows and failing the check; the best one is kept. The demo ends by rewinding to before the migration.

## Other shortlisted ideas

### Dry-run gate (scored 44 of 60; the fallback)

**Description.** When an agent proposes a risky command, it first runs on a fresh branch of the disk. The user sees the actual file changes it caused and approves or discards them. The demo shows an agent misled by a poisoned web page being stopped before the real disk is touched.

- **Relies on:** disk checkpoints and branches.
- **Scores (each out of 15):** creative 11, Archil use 14, technical 11, feasible 8.
- **Why it is creative:** existing approval prompts show the command text; this shows what the command actually did. It was the highest creative score among the technical ideas and the developer reviewer's first choice.
- **Risks:**
  - Serverless exec cannot target a branch, so the dry run needs a sandbox that mounts the branch with the `archil` CLI.
  - Branches do not merge, so "approve" means running the command again on the live disk. A command that behaves differently the second time breaks the promise.
  - The judge reviewer called the agent-safety theme crowded.
  - Free-plan sandboxes cannot reach Keenable, so the web search step has to run through serverless exec.
- **Smallest convincing demo:** one agent, one risky command, one diff view, approve and reject both working.
- **First test (15 minutes):** in a sandbox, create a checkpoint with the CLI, create a branch from it with the SDK, mount the branch and write a file to it.

### Directory claims (scored 42 of 60)

**Description.** Three coding agents refactor one repository on one shared disk with no message bus. Each claims directories using the file system's own write locks, and writes outside a claim are refused. A dashboard shows current ownership and each refused write as it happens.

- **Relies on:** shared-disk write delegations (`archil checkout`).
- **Scores (each out of 15):** creative 9, Archil use 15, technical 11, feasible 7.
- **Why it is creative:** it uses a storage locking feature as the coordination layer for multiple agents. The generator that proposed it called it the least obvious of its ideas, and none of Archil's own guides do it.
- **Risks:**
  - A delegation held by a serverless exec ends when the command ends, so lasting claims need three long-running sandboxes, which uses the compute hour quickly.
  - Three agents refactoring live is flaky.
  - A dashboard of refused writes is dry to watch.
  - Whether the SDK can list current claims is unverified; two agents reported differently.
- **Smallest convincing demo:** two agents, two directories, one deliberate out-of-bounds write that is visibly refused.
- **First test (15 minutes):** two sandboxes mount the same disk, one claims a folder, the other tries to write there. Check the refusal is clean and the claim holds.

## How the ideas were evaluated

**Round one (flawed).** I wrote six ideas, five of them built on one thesis: that millisecond branching is Archil's best feature. Three reviewers ranked them and agreed with me. You pointed out the bias, and it was real: the reviewers could only choose from my shortlist, my favourite had the longest description, and the fact sheet led with branching.

**Round two (blind).**

- Three fresh agents invented ideas from scratch without seeing mine, each from a different starting point: features first, problems first, audience first.
- Their 15 ideas were pooled with my six and the dry-run gate (proposed by round-one reviewers). Duplicates were merged, giving 19.
- Every idea was rewritten under a plain name in the same format, 38 to 47 words.
- Three new reviewers (sponsor, judge, developer) each got a different shuffled order and had to write a case for and against every idea before scoring.

**Limits of this method.**

- All generators and reviewers are the same underlying AI model as me. This reduces my bias; it does not remove it.
- Totals weight the four criteria equally, which was my choice. Gaps of a few points mean little.
- Reviewers gave their highest creative scores almost only to playful ideas, so creative scores for technical ideas are bunched together.
- The per-step timeline was invented independently three times. That suggests it fits Archil well and also that other teams will think of it.

## All ideas

Scores are sums across the three reviewers. Each criterion is out of 15 and the total is out of 60.

| Idea | Kind | Creative | Archil use | Technical | Feasible | Total |
|---|---|---|---|---|---|---|
| Forked game player | playful | 15 | 15 | 12 | 7 | 49 |
| Sleeping pet | playful | 15 | 14 | 7 | 12 | 48 |
| Step timeline | technical | 9 | 15 | 13 | 8 | 45 |
| Dry-run gate | technical | 11 | 14 | 11 | 8 | 44 |
| Destroy-and-reset room | playful | 14 | 11 | 9 | 9 | 43 |
| Directory claims | technical | 9 | 15 | 11 | 7 | 42 |
| Advisory search | technical | 9 | 12 | 12 | 9 | 42 |
| Injection test range | technical | 9 | 11 | 12 | 9 | 41 |
| Shared flat | playful | 13 | 12 | 8 | 8 | 41 |
| Fix tree search | technical | 9 | 10 | 14 | 7 | 40 |
| Runtime test matrix | technical | 6 | 12 | 9 | 13 | 40 |
| Change preview | technical | 7 | 12 | 9 | 11 | 39 |
| Breaking-step finder | technical | 11 | 9 | 12 | 6 | 38 |
| Attack and patch forks | technical | 9 | 9 | 12 | 8 | 38 |
| Resumable workspace | technical | 6 | 9 | 9 | 14 | 38 |
| World survey map | playful | 12 | 9 | 7 | 10 | 38 |
| Scenario database | technical | 6 | 11 | 9 | 7 | 33 |
| Branching story | playful | 8 | 6 | 6 | 10 | 30 |
| Paperwork sorter | utility | 3 | 6 | 7 | 14 | 30 |

Each reviewer's pick per prize:

| Prize | Sponsor | Judge | Developer |
|---|---|---|---|
| Most creative | Forked game player | Sleeping pet | Sleeping pet |
| Best use of Archil | Step timeline | Forked game player | Dry-run gate |
| Best technical execution | Injection test range | Injection test range | Injection test range |

### Technical ideas

**Step timeline** (my original "agent flight recorder"; also invented by two generators). An agent works on a project on a disk, and a snapshot is taken after every tool call. A web page shows the run as a timeline: open any file as it was at any step, diff two steps, and restart the agent from an earlier step.
- Relies on: disk checkpoints and branches.
- For: uses checkpoints, branches and reads of old checkpoints together; looks like a product Archil could show customers.
- Against: the heaviest plumbing of any idea; checkpoints can only be made from inside a sandbox; no API lists or diffs checkpoints; other teams are likely to build it.
- Status: contender for "best use of Archil", not shortlisted for the creative prize.

**Dry-run gate.** See the shortlist.

**Directory claims.** See the shortlist.

**Advisory search.** Given a new security advisory found through web search, an agent writes patterns for the vulnerable usage, searches a disk holding hundreds of cloned open-source repositories in one call, runs a confirming test in each hit and lists the affected projects.
- Relies on: parallel disk search, serverless exec, Keenable search.
- For: the only idea where all three sponsors' technology does real work; avoids the sandbox compute cap.
- Against: setting up the corpus is slow; a confirming test that works across many repositories is hard; the output is a list.
- Status: not shortlisted; modest creative score.

**Injection test range.** An agent and its workspace, seeded with canary secrets, are frozen as a template sandbox. Each prompt-injection payload runs against a fresh fork; file diffs and a decoy send tool show which attacks worked. The demo patches the prompt and reruns the suite.
- Relies on: sandbox fork as a reset.
- For: produces a number that moves after the fix; judges can supply their own payload; fits Casco. The unanimous pick for technical execution.
- Against: fresh containers could do the reset; needs sandbox compute beyond the free hour; a results table is visually dry.
- Status: the best option if the target changes to technical execution.

**Fix tree search.** Given a failing test suite, an agent proposes several candidate fixes, each on its own copy of the project, scores them by running the tests, then expands the most promising candidates further. The demo shows the tree of attempts and the winning path.
- Relies on: disk branches or sandbox forks.
- For: the highest technical score; cheap forks suit search over code states.
- Against: close to Archil's own "Parallel agents" guide; slow and costly to run live; git worktrees do it locally.
- Status: not shortlisted.

**Runtime test matrix.** An agent maintains a small library on a disk. Each iteration runs the test suite at once in a dozen public images (language versions, distros), shows a pass/fail grid, then patches the code until every cell is green.
- Relies on: parallel serverless exec with a different image per call.
- For: uses only confirmed features; works from Windows without sandboxes; very likely to finish.
- Against: it is a CI matrix, which GitHub Actions already provides.
- Status: the safe fallback if sandbox quota turns out to be unavailable.

**Change preview.** A non-technical owner's web app runs in a sandbox with a public URL. They ask for a change in plain English; the agent forks the machine, edits the fork and returns a second URL. The demo keeps one change and discards a broken one.
- Relies on: sandbox fork, exposed ports.
- For: instantly understood; the fork includes live data, not only code.
- Against: Archil's own web-app guide already shows forked previews; preview deployments are a known product.
- Status: not shortlisted.

**Breaking-step finder** (my original "agent bisect"). An agent's long run ends with failing tests. The tool takes the snapshots saved at each step, runs the test suite against all of them, and shows a pass/fail strip that pinpoints the step that broke things.
- Relies on: disk checkpoints, parallel serverless exec.
- For: "bisect for agent runs" is a clear and useful pitch.
- Against: serverless exec cannot run against a checkpoint, so the main mechanism is not available; the workaround of copying files per step makes checkpoints decorative.
- Status: dropped (decision 5).

**Attack and patch forks.** A deliberately vulnerable web app, written by the team, runs in a sandbox and is forked. An attacker agent finds an exploit in one fork, a defender agent patches another, and the exploit is replayed against the patched fork to show the fix holds.
- Relies on: sandbox fork.
- For: matches Casco's prove-and-retest loop.
- Against: a self-written bug looks staged; two agents must both succeed live; sandboxes cannot reach each other.
- Status: not shortlisted.

**Resumable workspace.** A task's files, notes and a SQLite ledger live on one disk, and every agent step is a stateless command run against it. The demo kills the agent mid-task on one laptop and resumes it on a second laptop with a different model.
- Relies on: disk with serverless exec, SQLite.
- For: matches Archil's headline pitch; near-certain to work live.
- Against: any durable store does this; unmemorable.
- Status: not shortlisted.

**Scenario database** (my original "what-if database"). A SQLite database sits on a disk. For a risky change such as a migration, the tool makes several branches, an agent applies a different approach on each, and a page shows the outcomes side by side.
- Relies on: disk branches, SQLite.
- For: rehearsing a migration on real data is a real need.
- Against: serverless SQLite cannot reach a branch, so its two features do not combine; Neon and Turso already do database branching.
- Status: dropped (decision 5).

**Paperwork sorter.** Someone uploads receipts, statements and letters. An agent extracts each file, builds folders and a ledger, and answers questions such as dentist spending last year. The demo ends with a share link for an accountant.
- Relies on: disk with serverless exec, SQLite, share links.
- For: relatable and easy to finish.
- Against: Archil is replaceable storage; several teams are likely to build something similar.
- Status: not shortlisted; lowest total.

### Playful ideas (set aside under decisions 2 and 3)

**Forked game player.** An agent plays a classic text adventure running unmodified inside a sandbox. At risky moments the audience submits moves from their phones, and the running machine is forked so the top three all happen. The screen shows the tree of timelines and which died.
- Relies on: fork of a running sandbox, memory included.
- For: the highest total; a memory fork of an unmodified process cannot be explained away.
- Against: the lowest feasibility in the top group; the five-sandbox cap limits the tree; forks drop connections.
- Status: set aside as a game. Its mechanism lives on in the Live-fork explorer.

**Sleeping pet.** A creature lives as one running process with no save file. It sleeps when the room ignores it and wakes when someone opens its page by QR code. Phones feed it, it remembers names, and it can split into offspring.
- Relies on: sandbox pause and resume, wake on traffic.
- For: memorable and likely to work; two of three reviewers picked it for most creative.
- Against: barely an agent; technically thin.
- Status: rejected (decision 2).

**Destroy-and-reset room.** The audience types plain-English wishes for wrecking a real Linux machine; an agent turns each into root commands and the screen shows the damage. A fresh machine appears in about a second. A second agent hardens the template and replays past kills.
- Relies on: forking a stopped template sandbox.
- For: loud and unforgettable; shows isolation and disposability.
- Against: the reset speed is unpublished; without the hardening agent it is a stunt.
- Status: set aside (decision 3).

**Shared flat.** Four agents share a flat that is a disk: private rooms and a common fridge folder. The audience drops items into the fridge from phones. Agents eat, hoard, snoop and leave notes, and the screen shows the files and the refused writes.
- Relies on: shared disk with per-path write control.
- For: makes a file-system feature funny and visible.
- Against: needs four long-running sandboxes; agent behaviour may be dull.
- Status: set aside (decision 3). Directory claims is the technical version of the same feature.

**World survey map.** The audience votes on a question such as the price of a beer. One microVM per country runs a live web search, extracts a number and writes a file to a shared disk. A world map colours in country by country within seconds.
- Relies on: serverless exec fan-out, Keenable search.
- For: striking visual; uses Keenable credits.
- Against: about 195 calls per run against the free plan's 1,000; the disk is incidental.
- Status: set aside (decision 3).

**Branching story** (mine). A persistent game world is stored as files on a disk. Every player decision forks the world, an agent narrates and updates the files, and each branch has a shareable link.
- Relies on: disk branches, share links.
- For: approachable and shareable.
- Against: a table of nodes would replace Archil; AI story games already exist.
- Status: set aside (decision 3); bottom three for two reviewers.

## Facts that constrain the build

Checked against Archil's docs unless marked otherwise.

**Free plan (hard caps)**
- 1,000 serverless calls a month. Each exec, search or SQLite query is one call.
- 1 vCPU-hour of sandbox compute a month, 30-minute sandbox sessions, 5 concurrent sandboxes.
- 5 disks of 10 GB.
- Sandbox network access is limited to package registries, Git hosts and model provider APIs. Keenable is not on the list. Serverless exec has unrestricted network access.
- The Developer plan ($10 monthly minimum) removes these caps and allows 20 concurrent sandboxes.

**Windows**
- Disks cannot be mounted on Windows. The TypeScript SDK (Node 22.19 or later) and Python SDK work.

**Checkpoints and branches**
- Checkpoints are created only with the Linux `archil` CLI on a mounted disk. This is documented inside a sandbox. It is not confirmed inside serverless exec.
- Branches can be created from the SDK: `disk.createBranch({ name, fromCheckpoint })`. The docs page omits it; I confirmed it in the published package's type definitions.
- Serverless exec cannot target a branch. A branch is reachable through the S3 API or from a sandbox that mounts it with the CLI.
- A file can be read as of a checkpoint through the S3 API, but checkpoints cannot be listed or diffed there.
- Branches do not merge and cannot be deleted.

**Sandboxes**
- Pause and resume keep memory and processes. Paused and stopped sandboxes cost no compute. Resume time is not published.
- `sandbox.fork()` on a running or paused sandbox keeps memory and processes, and is refused if extra disks are mounted. Forking a running sandbox drops its attached connections; a paused one is left as it is. A parent cannot be deleted while forks exist.
- A fork can be made from a pause checkpoint, so one pause can feed many forks. Only the current checkpoint and the one before it are accepted. Forks can be forked again.
- A fork of a stopped sandbox comes up in about a second. Fork time with memory is not published.
- A request to an exposed port wakes a stopped sandbox. Port traffic does not reset the idle timer.
- Sandboxes cannot reach each other over the network.

**Web page**
- Browser access to the S3 API needs an allowlist entry from Archil support, so any web page needs a small backend.

## Questions for the Archil team at the start

- Do hackathon accounts get raised limits or the Developer plan?
- How long does forking a running or paused sandbox take, and how does it scale with memory size?
- Do paused or stopped sandboxes count toward the concurrent limit?
- Is there any way to delete a parent sandbox while keeping a fork of it?
- Does `archil checkpoints create` work inside serverless exec?
- Is there an SDK call to list a disk's current write delegations?
