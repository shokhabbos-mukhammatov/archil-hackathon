// Everything the page asks the Scoped Runner server (server.mjs) for.

import { useCallback, useEffect, useRef, useState } from 'react';
import { RunEvent } from './model';
import { demoById } from './demos';

export type Config = {
  fake: boolean; region: string; image: string; model: string;
  archil: boolean; archilProblem: string | null; modelKey: boolean;
  service: string | null; serviceProblem: string | null;
  tasks: { id: string; title: string; text: string }[];
  classes: Record<string, any>; maxActive: number;
};
export type RunSummary = {
  id: string; kind: 'agent' | 'matrix'; mode: string; simulated: boolean; model: string | null; title: string;
  startedAt: number | null; endedAt: number | null; status: 'running' | 'passed' | 'failed' | 'interrupted';
  calls: number; checksPassed: number; checksTotal: number;
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url} answered ${r.status}`);
  const type = r.headers.get('content-type') ?? '';
  if (!type.includes('json')) throw new Error(`${url} did not answer with JSON`);
  return r.json();
}

export async function startRun(body: { kind: 'agent' | 'matrix'; mode?: 'live' | 'rehearse'; taskId?: string; taskText?: string }): Promise<string> {
  const r = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error ?? `the server answered ${r.status}`);
  return out.id;
}

// The server's configuration and run list. `online` is false while the server cannot be
// reached; the scripted demo runs still play, and the page keeps trying.
export function useServer() {
  const [config, setConfig] = useState<Config | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const anyRunning = runs.some((r) => r.status === 'running');

  const refresh = useCallback(async () => {
    try {
      const [c, list] = await Promise.all([getJson<Config>('/api/config'), getJson<RunSummary[]>('/api/runs')]);
      setConfig(c); setRuns(list); setOnline(true);
    } catch { setOnline(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const t = setInterval(refresh, online === false ? 3000 : anyRunning ? 1000 : 5000);
    return () => clearInterval(t);
  }, [refresh, online, anyRunning]);

  return { config, runs, online, refresh };
}

// One run's events: every past one, then live ones as they happen. A demo id plays its
// script in real time instead; `playKey` changes when the same demo is started again.
export function useRunEvents(id: string | null, playKey = 0): { events: RunEvent[]; streaming: boolean } {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [streaming, setStreaming] = useState(false);
  const buffer = useRef<RunEvent[]>([]);

  useEffect(() => {
    buffer.current = [];
    setEvents([]);
    if (!id) { setStreaming(false); return; }
    const demo = demoById(id);
    if (demo) {
      // Each event is due at a fixed offset from now, so a throttled tab catches up.
      const base = Date.now();
      let i = 0;
      let timer = 0;
      setStreaming(true);
      const next = () => {
        while (i < demo.events.length && base + demo.events[i].at <= Date.now()) { buffer.current.push({ ...demo.events[i], at: base + demo.events[i].at }); i++; }
        setEvents(buffer.current.slice());
        if (i < demo.events.length) timer = window.setTimeout(next, Math.max(0, base + demo.events[i].at - Date.now()));
        else setStreaming(false);
      };
      next();
      return () => window.clearTimeout(timer);
    }

    let raf = 0;
    let closed = false;
    const flush = () => { raf = 0; if (!closed) setEvents(buffer.current.slice()); };
    const es = new EventSource(`/api/runs/${id}/events`);
    setStreaming(true);
    const stop = () => { if (closed) return; es.close(); setStreaming(false); if (raf) cancelAnimationFrame(raf); setEvents(buffer.current.slice()); closed = true; };
    es.onmessage = (m) => {
      try { buffer.current.push(JSON.parse(m.data)); } catch { return; }
      // The server ends the stream after the end event; closing here stops the browser
      // from reconnecting and replaying the run.
      if (buffer.current[buffer.current.length - 1].type === 'end') { stop(); return; }
      if (!raf) raf = requestAnimationFrame(flush);
    };
    es.onerror = () => stop();
    return () => { closed = true; es.close(); if (raf) cancelAnimationFrame(raf); };
  }, [id, playKey]);

  return { events, streaming };
}
