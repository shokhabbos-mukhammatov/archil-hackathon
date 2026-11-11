import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRunEvents, useServer } from './api';
import { ExecutionLog } from './components/Log';
import { AccessAndCleanup, Results, StatTiles, StatusPill } from './components/Results';
import { DemoList, Launcher, RunList } from './components/Sidebar';
import { buildSegments, fmtClock, reduceRun, statusOf } from './model';
import { DEFAULT_DEMO, demoById } from './demos';
import { StagePlayer } from './stage/StagePlayer';
import { CLASS_ORDER, Icon, INK, classMeta } from './theme';

export function App() {
  const { config, runs, online, refresh } = useServer();
  const [selected, setSelected] = useState<string | null>(null);
  const [playKey, setPlayKey] = useState(0);
  const [activeSeg, setActiveSeg] = useState(-1);
  const [seek, setSeek] = useState<{ index: number; nonce: number } | null>(null);
  const [now, setNow] = useState(Date.now());

  // First visit: open the newest run, or the passing demo when there is nothing to show.
  useEffect(() => {
    if (selected || online === null) return;
    if (online && runs.length) setSelected(runs[0].id);
    else setSelected(DEFAULT_DEMO);
  }, [online, runs, selected]);

  // Choosing a demo again plays it again from the start.
  const select = useCallback((id: string) => { setSelected(id); if (demoById(id)) setPlayKey((k) => k + 1); }, []);

  const { events } = useRunEvents(selected, playKey);
  const state = useMemo(() => reduceRun(events), [events]);
  const segments = useMemo(() => buildSegments(state), [state]);
  const status = statusOf(state);
  const running = status === 'running';
  const demo = demoById(selected);
  const isSample = !!demo;

  useEffect(() => { setActiveSeg(-1); setSeek(null); }, [selected, playKey]);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [running]);
  useEffect(() => { if (state.end) refresh(); }, [state.end, refresh]);

  const activeFeedIndex = activeSeg >= 0 && segments[activeSeg] ? segments[activeSeg].feedIndex : -1;
  const playFeed = useCallback((feedIndex: number) => {
    const index = segments.findIndex((s) => s.feedIndex === feedIndex);
    if (index >= 0) setSeek({ index, nonce: Date.now() });
  }, [segments]);

  const start = state.start;
  const elapsedMs = start ? Math.max(0, (state.end?.at ?? (running ? Math.max(now, state.lastAt) : state.lastAt)) - start.at) : 0;
  const agentLabel = !start ? 'model loop' : start.kind === 'matrix' ? 'the runner, no model' : start.mode === 'live' ? String(start.model ?? 'Claude') : 'scripted rehearsal';
  const title = demo ? `Demo: ${demo.title}` : !start ? 'Loading run...' : start.kind === 'matrix' ? 'Access matrix' : start.task?.title ?? 'Agent run';
  const classes = (config?.classes ?? {}) as Record<string, any>;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo"><Icon name="shield" size={20} color="#fff" stroke={2} /></span>
          <div>
            <h1>Scoped Runner</h1>
            <p>Per-call access limits for agents with no sandbox</p>
          </div>
        </div>
        <div className="env">
          {config && <span className="env-chip"><span className="env-k">Region</span>{config.region}</span>}
          {config && <span className="env-chip"><span className="env-k">Image</span>{config.image}</span>}
          {config && <span className="env-chip"><span className="env-k">Model</span>{config.model}</span>}
          {config?.fake && <span className="env-chip warn"><Icon name="warning" size={13} color={INK.warning} />Fake mode</span>}
          <span className={`env-chip conn ${online ? 'ok' : online === false ? 'down' : ''}`}><span className="conn-dot" />{online ? 'Server connected' : online === false ? 'Server offline' : 'Connecting'}</span>
        </div>
      </header>

      {online === false && (
        <div className="banner"><Icon name="warning" size={16} color={INK.warning} />
          <div>The runner server is not answering, so only the scripted demo runs are available; they are not real results. Start the server with <code>npm start</code> (or <code>npm run start:fake</code>) in the repository root; this page reconnects by itself.</div>
        </div>
      )}

      <div className="layout">
        <aside className="side">
          <Launcher config={config} online={!!online} activeCount={runs.filter((r) => r.status === 'running').length} onStarted={(id) => { select(id); refresh(); }} />
          <DemoList selected={selected} onSelect={select} />
          <RunList runs={runs} selected={selected} onSelect={select} />
        </aside>

        <main className="main">
          <div className="run-head">
            <div className="run-head-text">
              <h2>{title}</h2>
              <div className="run-head-sub">
                {isSample && <span className="tag warn"><Icon name="warning" size={12} color={INK.warning} />scripted demo, not a real result</span>}
                {start?.simulated && !isSample && <span className="tag warn"><Icon name="warning" size={12} color={INK.warning} />fake mode: stand-ins, not the platform</span>}
                {start && <span>{start.kind === 'matrix' ? 'One probe per class' : start.mode === 'live' ? `Live agent, ${start.model}` : 'Scripted rehearsal'}</span>}
                {start && !isSample && <span className="mono">run {start.id}</span>}
                {start?.region && <span>{start.region}</span>}
              </div>
            </div>
            <div className="run-head-right">
              <span className="clock" title="Run time"><Icon name="clock" size={15} color={INK.muted} />{fmtClock(elapsedMs)}</span>
              <StatusPill status={status} />
            </div>
          </div>

          {start?.task?.text && start.kind !== 'matrix' && (
            <details className="task card">
              <summary><Icon name="chevron" size={14} color={INK.muted} />Task given to the agent</summary>
              <p>{start.task.text}</p>
            </details>
          )}

          <StagePlayer runId={`${selected ?? ''}:${playKey}`} segments={segments} live={running} agentLabel={agentLabel} waiting={start ? 'Creating this run\'s disks...' : 'Waiting for a run'} seek={seek} onSegment={setActiveSeg} />

          <div className="legend" aria-label="Access classes">
            {CLASS_ORDER.map((c) => <span key={c} className="legend-item"><span className="dot" style={{ background: classMeta(c).color }} />{classMeta(c).label}<span className="muted">{classMeta(c).blurb.toLowerCase()}</span></span>)}
            <span className="legend-item"><span className="legend-line thick" />read + write</span>
            <span className="legend-item"><span className="legend-line" />read-only</span>
            <span className="legend-item"><Icon name="x" size={12} color={INK.muted} stroke={2.4} />not granted</span>
          </div>

          <StatTiles state={state} status={status} elapsedMs={elapsedMs} />

          <div className="columns">
            <ExecutionLog state={state} running={running} activeFeedIndex={activeFeedIndex} follow onPlay={playFeed} />
            <Results state={state} status={status} classes={classes} activeFeedIndex={activeFeedIndex} onPick={playFeed} />
          </div>

          <AccessAndCleanup state={state} status={status} />
        </main>
      </div>
    </div>
  );
}
