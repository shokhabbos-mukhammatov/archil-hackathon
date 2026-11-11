// Turns a run's event stream (the same events server.mjs sends and logs) into the state the
// screen shows, and into the list of animated segments the stage plays.

export type Network = null | 'service' | { default: string; allow?: (string | { target: string })[] };
export type Grants = {
  class: string; describe?: string;
  app: 'write' | 'read' | 'none'; web: 'write' | 'read' | 'none';
  key: 'none' | 'edge' | 'inside'; network: Network; egress?: boolean;
};
export type Call = {
  n: number; turn: number; tool: string; label: string; class: string; grants: Grants;
  exitCode: number | null; error?: string; wallMs: number; queueMs?: number; redactions: number;
  output: string; stderr: string;
  search?: { status?: number; count?: number; saved?: string; error?: string; results?: { title: string; url: string }[] } | null;
};
export type ProbeRow = {
  class: string; grants: Grants; measured: boolean; keyInside: boolean;
  service: string | null; outside: string | null; workspaceWrite: string | null; webWrite: string | null;
  dns: string | null; wallMs: number; error: string | null;
};
export type Check = { id: string; label: string; ok: boolean; detail?: string };
export type RunEvent = { type: string; at: number; [key: string]: any };

export type FeedItem =
  | { t: 'say'; at: number; text: string; turn: number }
  | { t: 'call'; at: number; call: Call }
  | { t: 'rejected'; at: number; label: string; cls?: string; problem: string; refused: boolean }
  | { t: 'probe'; at: number; row: ProbeRow }
  | { t: 'status'; at: number; text: string }
  | { t: 'error'; at: number; text: string };

export type RunState = {
  start: RunEvent | null;
  disks: string[];
  feed: FeedItem[];
  calls: Call[];
  refused: number;
  checks: Check[];
  measure: ProbeRow[] | null;
  gap: string | null;
  summary: Record<string, any> | null;
  cleanup: RunEvent | null;
  agentDone: RunEvent | null;
  end: RunEvent | null;
  errors: string[];
  lastAt: number;
};

export type RunStatus = 'idle' | 'running' | 'passed' | 'failed' | 'interrupted';

export function reduceRun(events: RunEvent[]): RunState {
  const s: RunState = { start: null, disks: [], feed: [], calls: [], refused: 0, checks: [], measure: null, gap: null, summary: null, cleanup: null, agentDone: null, end: null, errors: [], lastAt: 0 };
  const probes: ProbeRow[] = [];
  for (const e of events) {
    if (e.at) s.lastAt = e.at;
    switch (e.type) {
      case 'start': s.start = e; break;
      case 'disks': s.disks = e.names ?? []; break;
      case 'status': s.feed.push({ t: 'status', at: e.at, text: e.text }); break;
      case 'say': s.feed.push({ t: 'say', at: e.at, text: e.text, turn: e.turn }); break;
      case 'call': s.calls.push(e.call); s.feed.push({ t: 'call', at: e.at, call: e.call }); break;
      case 'rejected':
        if (e.refused) s.refused++;
        s.feed.push({ t: 'rejected', at: e.at, label: e.label, cls: e.class, problem: e.problem, refused: !!e.refused });
        break;
      case 'matrix-row': probes.push(e.row); s.feed.push({ t: 'probe', at: e.at, row: e.row }); break;
      case 'measure': s.measure = e.rows ?? []; break;
      case 'check': s.checks.push(e.check); break;
      case 'gap': s.gap = e.text; break;
      case 'summary': s.summary = e.summary; break;
      case 'agent-done': s.agentDone = e; break;
      case 'cleanup': s.cleanup = e; break;
      case 'error': s.errors.push(e.text); s.feed.push({ t: 'error', at: e.at, text: e.text }); break;
      case 'end': s.end = e; break;
    }
  }
  if (probes.length) s.measure = probes;
  return s;
}

export function statusOf(s: RunState): RunStatus {
  if (!s.start) return 'idle';
  if (!s.end) return 'running';
  if (s.end.interrupted) return 'interrupted';
  return s.end.ok ? 'passed' : 'failed';
}

// ---------------------------------------------------------------------------------------
// Stage segments: each is a fixed-length piece of animation. The stage plays them in order,
// so a live run and a replay of a finished run are the same composition.
// ---------------------------------------------------------------------------------------
export const FPS = 30;
export const SETUP_FRAMES = 48;
export const CALL_FRAMES = 78;
export const REFUSED_FRAMES = 66;
export const verdictFrames = (checks: number) => 46 + checks * 7 + 60;

type Base = { from: number; frames: number; feedIndex: number };
export type Segment =
  | (Base & { kind: 'setup'; disks: string[]; service: string | null; matrix: boolean })
  | (Base & { kind: 'call'; n: number; total?: number; label: string; cls: string; grants: Grants; exitCode: number | null; error?: string; wallMs: number; redactions: number; tainted: boolean; row?: ProbeRow })
  | (Base & { kind: 'refused'; label: string; cls: string; problem: string; refused: boolean; tainted: boolean })
  | (Base & { kind: 'verdict'; checks: Check[]; ok: boolean; interrupted: boolean; error: string | null });

export const reachesService = (g: Grants) => g.network === 'service' || g.network === null;

export function buildSegments(s: RunState): Segment[] {
  const out: Segment[] = [];
  let from = 0;
  const add = (seg: any) => { out.push({ ...seg, from }); from += seg.frames; };
  if (!s.start) return out;
  const matrix = s.start.kind === 'matrix';
  if (s.disks.length) add({ kind: 'setup', frames: SETUP_FRAMES, feedIndex: -1, disks: s.disks, service: s.start.service ?? null, matrix });
  let tainted = false;
  let n = 0;
  s.feed.forEach((item, feedIndex) => {
    if (item.t === 'call') {
      const c = item.call;
      add({ kind: 'call', frames: CALL_FRAMES, feedIndex, n: c.n, label: c.label, cls: c.class, grants: c.grants, exitCode: c.exitCode, error: c.error, wallMs: c.wallMs, redactions: c.redactions ?? 0, tainted });
      if (reachesService(c.grants)) tainted = true;
    } else if (item.t === 'probe') {
      const r = item.row;
      add({ kind: 'call', frames: CALL_FRAMES, feedIndex, n: ++n, label: `probe: what can the "${r.class === 'open' ? 'no limits' : r.class}" class reach?`, cls: r.class, grants: r.grants, exitCode: r.measured ? 0 : 1, error: r.error ?? undefined, wallMs: r.wallMs, redactions: 0, tainted: false, row: r });
    } else if (item.t === 'rejected') {
      add({ kind: 'refused', frames: REFUSED_FRAMES, feedIndex, label: item.label, cls: item.cls ?? 'other', problem: item.problem, refused: item.refused, tainted });
    }
  });
  if (s.end) add({ kind: 'verdict', frames: verdictFrames(s.checks.length), feedIndex: -1, checks: s.checks, ok: !!s.end.ok, interrupted: !!s.end.interrupted, error: s.errors[0] ?? null });
  return out;
}

export const totalFrames = (segs: Segment[]) => (segs.length ? segs[segs.length - 1].from + segs[segs.length - 1].frames : 0);

export function segmentAt(segs: Segment[], frame: number): number {
  let i = -1;
  for (let k = 0; k < segs.length; k++) { if (segs[k].from <= frame) i = k; else break; }
  return i;
}

// ---------------------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------------------
export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '-';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function fmtClock(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function fmtAgo(at: number | null | undefined, now = Date.now()): string {
  if (!at) return '';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function describeNetwork(n: Network): string {
  if (n === null) return 'open internet';
  if (n === 'service') return "the project's service only";
  const hosts = (n.allow ?? []).map((a) => (typeof a === 'string' ? a : a.target));
  if (!hosts.length) return 'none';
  if (hosts.some((h) => h.includes('npmjs'))) return 'package registries only';
  return `${hosts.join(', ')} only`;
}
