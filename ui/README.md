# Scoped Runner UI

A live dashboard for Scoped Runner. It reads the same API and event stream as the built-in page (`../public/index.html`) and changes nothing on the server.

## Run it

Start the runner server in the repository root (`npm start`, or `npm run start:fake` for stand-ins), then in this folder:

```bash
npm install
```

```bash
npm run dev
```

Open http://127.0.0.1:5173/. Requests to `/api` are proxied to the server on port 4317. To point at a server somewhere else, set `RUNNER_URL`, for example `RUNNER_URL=http://127.0.0.1:4319 npm run dev`. `npm run dev -- --mode fake` serves on 5174 and expects a fake-mode server on 4321.

If the server is not running, the scripted demo runs still play, and the page reconnects by itself.

## Demo runs

The **Demo runs** panel plays three scripted runs in real time, with no server, key or model: one that passes, one that fails four of its nine checks (a bug, a citation the search never returned, and a secret the scrubber removed), and one that stops on a setup error and still deletes its disks. Clicking a demo again plays it from the start. They are scripts in `src/demos.ts`, not results: each is labelled as a demo on the page, and none is written to `runs/`.

## What is on the page

- **Stage.** A Remotion composition (`src/stage/Stage.tsx`) played by `@remotion/player`. Each tool call is one segment: the agent asks, fixed rules pick the class, a microVM starts with only that class's mounts and network, the output passes the scrubber, and the machine is gone. Refused calls and the final checks have their own segments. While a run is live, new segments are appended as events arrive and playback speeds up if it falls behind; a finished run replays from the start. The bar under the stage seeks by call.
- **Verdict and numbers.** Checks passed, calls, microVMs started, refusals, secrets scrubbed.
- **Execution log.** Every call, refusal and note, with output and the access each call had.
- **Execution timeline** and **calls by class.** When each call ran, in one lane per access class.
- **Independent checks** and **measured access.** What the runner verified itself, and what each class could actually reach.

## Limits

- The server reports a call when it finishes, not when it starts, so the stage animates each call just after it completes. A call-start event from `loop.mjs` would let the machine appear the moment the call begins.
- The stage is drawn for a wide screen. On a phone it scales down and its text is small; the rest of the page reflows.
- Remotion is free for individuals and for companies of up to three people; larger companies need a licence (https://remotion.dev/license).
