// Start a run, and pick an earlier one to replay.

import React, { useState } from 'react';
import { Config, RunSummary, startRun } from '../api';
import { fmtAgo } from '../model';
import { DEMOS } from '../demos';
import { Icon, INK } from '../theme';

export function Launcher({ config, online, activeCount, onStarted }: { config: Config | null; online: boolean; activeCount: number; onStarted: (id: string) => void }) {
  const [mode, setMode] = useState<'rehearse' | 'live'>('rehearse');
  const [taskId, setTaskId] = useState('longform');
  const [taskText, setTaskText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canLive = !!config && !config.fake && config.modelKey;
  const effectiveMode = canLive ? mode : 'rehearse';
  const blocked = !online ? 'The runner server is not reachable.' : !config ? 'Loading...' : !config.archil ? (config.archilProblem ?? 'Archil is not configured.') : config.serviceProblem ? config.serviceProblem : null;
  const full = !!config && activeCount >= config.maxActive;
  const custom = effectiveMode === 'live' && taskId === 'custom';
  const customBad = custom && (taskText.trim().length < 10 || taskText.trim().length > 4000);

  const go = async (kind: 'agent' | 'matrix') => {
    setBusy(kind); setError(null);
    try { onStarted(await startRun(kind === 'matrix' ? { kind } : { kind, mode: effectiveMode, taskId: custom ? 'custom' : taskId === 'custom' ? 'longform' : taskId, taskText: custom ? taskText : undefined })); }
    catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(null); }
  };

  return (
    <section className="panel card launcher">
      <header className="panel-head"><h3>New run</h3>{config && <span className="panel-hint">{activeCount}/{config.maxActive} running</span>}</header>
      <div className="seg" role="radiogroup" aria-label="Who chooses the steps">
        <button role="radio" aria-checked={effectiveMode === 'rehearse'} className={effectiveMode === 'rehearse' ? 'on' : ''} onClick={() => setMode('rehearse')}>Rehearsal</button>
        <button role="radio" aria-checked={effectiveMode === 'live'} className={effectiveMode === 'live' ? 'on' : ''} onClick={() => setMode('live')} disabled={!canLive} title={canLive ? '' : config?.fake ? 'Fake mode runs the scripted rehearsal only' : 'Needs ANTHROPIC_API_KEY in .env'}>Live agent</button>
      </div>
      <p className="hint">{effectiveMode === 'live' ? `${config?.model ?? 'Claude'} chooses every step.` : 'A fixed script chooses the steps; the calls and limits are the same.'}{config?.fake ? ' Fake mode: stand-ins for Archil and the model.' : ''}</p>
      {effectiveMode === 'live' && (
        <>
          <label className="field">
            <span>Task</span>
            <select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              {(config?.tasks ?? []).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              <option value="custom">Custom task...</option>
            </select>
          </label>
          {custom && <textarea className="task-text" rows={5} placeholder="Describe a task on the sample project (10 to 4000 characters)." value={taskText} onChange={(e) => setTaskText(e.target.value)} />}
        </>
      )}
      <button className="btn primary" disabled={!!blocked || full || !!busy || customBad} onClick={() => go('agent')}>
        {busy === 'agent' ? <span className="spinner" /> : <Icon name="play" size={15} />}Run the agent
      </button>
      <button className="btn" disabled={!!blocked || full || !!busy} onClick={() => go('matrix')}>
        {busy === 'matrix' ? <span className="spinner" /> : <Icon name="grid" size={15} />}Measure access per class
      </button>
      {blocked && <div className="callout warn small"><Icon name="warning" size={15} color={INK.warning} /><div>{blocked}</div></div>}
      {!blocked && full && <div className="callout small"><Icon name="clock" size={15} /><div>{activeCount} runs are in progress; wait for one to finish.</div></div>}
      {error && <div className="callout bad small"><Icon name="warning" size={15} color={INK.critical} /><div>{error}</div></div>}
    </section>
  );
}

function StatusIcon({ status }: { status: RunSummary['status'] }) {
  if (status === 'running') return <span className="spinner" />;
  if (status === 'passed') return <Icon name="check" size={15} color={INK.good} stroke={2.6} />;
  if (status === 'failed') return <Icon name="x" size={15} color={INK.critical} stroke={2.6} />;
  return <Icon name="warning" size={15} color={INK.warning} />;
}

// Scripted runs for showing the page: a pass, a failure and an error. Never real results.
export function DemoList({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const ends = {
    passed: <><Icon name="check" size={13} color={INK.good} stroke={2.6} />passes</>,
    failed: <><Icon name="x" size={13} color={INK.critical} stroke={2.6} />fails</>,
    error: <><Icon name="warning" size={13} color={INK.warning} />errors</>,
  };
  return (
    <section className="panel card demos">
      <header className="panel-head"><h3>Demo runs</h3><span className="panel-hint">scripted, not real results</span></header>
      <ul className="run-list">
        {DEMOS.map((d) => (
          <li key={d.id}>
            <button className={`run${selected === d.id ? ' on' : ''}`} onClick={() => onSelect(d.id)} title="Play this demo from the start">
              <span className="run-status"><Icon name="play" size={14} color={INK.secondary} /></span>
              <span className="run-body"><span className="run-title">{d.title}</span><span className="run-sub"><span>{d.blurb}</span></span></span>
              <span className="run-ago ends">{ends[d.outcome]}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RunList({ runs, selected, onSelect }: { runs: RunSummary[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <section className="panel card runs">
      <header className="panel-head"><h3>Runs</h3><span className="panel-hint">{runs.length || 'none yet'}</span></header>
      <ul className="run-list">
        {runs.map((r) => (
          <li key={r.id}>
            <button className={`run${selected === r.id ? ' on' : ''}`} onClick={() => onSelect(r.id)} aria-current={selected === r.id}>
              <span className="run-status" title={r.status}><StatusIcon status={r.status} /></span>
              <span className="run-body">
                <span className="run-title">{r.title}</span>
                <span className="run-sub">
                  <span className="mono">{r.id}</span>
                  <span>{r.simulated ? 'fake' : r.kind === 'matrix' ? 'probes' : r.mode === 'live' ? 'live agent' : 'rehearsal'}</span>
                  <span>{r.calls} call{r.calls === 1 ? '' : 's'}</span>
                  {r.checksTotal > 0 && <span>{r.checksPassed}/{r.checksTotal} checks</span>}
                </span>
              </span>
              <span className="run-ago">{r.status === 'running' ? 'now' : fmtAgo(r.endedAt ?? r.startedAt)}</span>
            </button>
          </li>
        ))}
        {runs.length === 0 && <li className="empty">Runs you start appear here.</li>}
      </ul>
    </section>
  );
}
