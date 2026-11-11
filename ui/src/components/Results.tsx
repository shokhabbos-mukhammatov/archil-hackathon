// What the run produced: the verdict, the numbers, the charts, the independent checks and
// the measured access table. Everything here fills in as events arrive.

import React from 'react';
import { Check, Grants, ProbeRow, RunState, RunStatus, describeNetwork, fmtMs } from '../model';
import { Icon, INK, classMeta } from '../theme';
import { CallTimeline, ClassBars } from './Charts';

export function StatusPill({ status }: { status: RunStatus }) {
  const map: Record<RunStatus, { label: string; icon: React.ReactNode; cls: string }> = {
    idle: { label: 'Waiting', icon: <Icon name="clock" size={14} />, cls: '' },
    running: { label: 'Running', icon: <span className="spinner" />, cls: 'running' },
    passed: { label: 'Passed', icon: <Icon name="check" size={14} color={INK.good} stroke={2.6} />, cls: 'passed' },
    failed: { label: 'Failed', icon: <Icon name="x" size={14} color={INK.critical} stroke={2.6} />, cls: 'failed' },
    interrupted: { label: 'Interrupted', icon: <Icon name="warning" size={14} color={INK.warning} />, cls: 'interrupted' },
  };
  const s = map[status];
  return <span className={`pill ${s.cls}`}>{s.icon}{s.label}</span>;
}

function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="tile card">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export function StatTiles({ state, status, elapsedMs }: { state: RunState; status: RunStatus; elapsedMs: number }) {
  const matrix = state.start?.kind === 'matrix';
  const passed = state.checks.filter((c) => c.ok).length;
  const total = state.checks.length;
  const sum = state.summary ?? {};
  const redactions = sum.redactions ?? state.calls.reduce((n, c) => n + (c.redactions ?? 0), 0);
  const probes = state.measure?.length ?? 0;
  const heroSub = status === 'running' ? (total ? 'independent checks so far' : 'checks run once the agent stops')
    : status === 'interrupted' ? 'the run stopped before it finished'
      : total ? 'independent checks passed' : state.errors[0] ? 'the run stopped on an error' : 'no checks ran';
  return (
    <div className="tiles">
      <div className={`tile hero card ${status}`}>
        <div className="tile-label">Verdict</div>
        <div className="hero-row">
          <div className="hero-figure">{total ? <>{passed}<span className="hero-of">/{total}</span></> : '-'}</div>
          <div>
            <StatusPill status={status} />
            <div className="tile-sub">{heroSub}</div>
          </div>
        </div>
      </div>
      {matrix ? (
        <>
          <Tile label="Probes" value={probes} sub="one microVM per class" />
          <Tile label="Limited classes holding the key" value={sum.keyInside ?? (state.measure ? state.measure.filter((r) => r.class !== 'open' && r.keyInside).length : '-')} sub="measured, not assumed" />
          <Tile label="DNS answered" value={state.measure ? `${state.measure.filter((r) => r.dns === 'answered').length}/${probes}` : '-'} sub="known gap, see below" />
          <Tile label="Time" value={fmtMs(elapsedMs)} sub="start to cleanup" />
        </>
      ) : (
        <>
          <Tile label="Tool calls" value={state.calls.length} sub="each in its own microVM" />
          <Tile label="microVMs started" value={sum.archilCalls ?? state.calls.length} sub="calls, checks and probes" />
          <Tile label="Agent time" value={state.agentDone ? fmtMs(state.agentDone.seconds * 1000 || sumWall(state)) : fmtMs(elapsedMs)} sub={state.agentDone ? String(state.agentDone.ended ?? '') : 'still working'} />
          <Tile label="Refused" value={sum.refused ?? state.refused} sub="outbound calls after service data" />
          <Tile label="Secrets scrubbed" value={redactions} sub="removed from call output" />
        </>
      )}
    </div>
  );
}
const sumWall = (s: RunState) => s.calls.reduce((n, c) => n + (c.wallMs ?? 0), 0);

function Checks({ checks, running }: { checks: Check[]; running: boolean }) {
  if (!checks.length) return <div className="empty">{running ? 'The runner checks the result itself once the agent stops.' : 'No checks were recorded for this run.'}</div>;
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.id} className="check">
          <span className={`check-icon ${c.ok ? 'ok' : 'bad'}`}><Icon name={c.ok ? 'check' : 'x'} size={14} color="#fff" stroke={3} /></span>
          <div>
            <div className="check-label">{c.label}</div>
            {c.detail && <div className="check-detail">{c.ok ? '' : 'Failed: '}{c.detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

type Tone = 'on' | 'off' | 'bad' | 'warn';
function Cell({ tone, text }: { tone: Tone; text: string }) {
  const icon = tone === 'on' ? <Icon name="check" size={14} stroke={2.4} /> : tone === 'bad' ? <Icon name="warning" size={14} color={INK.critical} /> : tone === 'warn' ? <Icon name="warning" size={14} color={INK.warning} /> : <Icon name="ban" size={14} color={INK.muted} />;
  return <td className={`cell ${tone}`}><span>{icon}{text}</span></td>;
}

function AccessTable({ rows }: { rows: ProbeRow[] }) {
  const write = (v: string | null) => <Cell tone={v === 'allowed' ? 'on' : 'off'} text={v ?? 'not measured'} />;
  return (
    <div className="table-wrap">
      <table className="matrix">
        <thead>
          <tr><th>Class</th><th>API key inside</th><th>Project service</th><th>Outside host</th><th>Write project</th><th>Write web results</th><th>DNS lookup</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const m = classMeta(r.class);
            return (
              <tr key={r.class} className={r.class === 'open' ? 'baseline' : ''}>
                <th scope="row"><span className="dot" style={{ background: m.color }} />{m.label}{r.class === 'open' && <span className="muted"> (baseline)</span>}</th>
                {!r.measured ? <td colSpan={6} className="cell bad"><span><Icon name="warning" size={14} color={INK.critical} />probe did not report: {r.error ?? 'unknown'}</span></td> : (
                  <>
                    <Cell tone={r.keyInside ? 'bad' : 'off'} text={r.keyInside ? 'yes' : 'no'} />
                    <Cell tone={r.service === 'authenticated' ? (r.class === 'open' ? 'bad' : 'on') : 'off'} text={r.service ?? 'not measured'} />
                    <Cell tone={r.outside === 'reachable' ? 'bad' : 'off'} text={r.outside ?? 'not measured'} />
                    {write(r.workspaceWrite)}
                    {write(r.webWrite)}
                    <Cell tone={r.dns === 'answered' ? 'warn' : 'off'} text={r.dns ?? 'not measured'} />
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="panel card">
      <header className="panel-head"><h3>{title}</h3>{hint && <span className="panel-hint">{hint}</span>}</header>
      {children}
    </section>
  );
}

export function describeGrants(g: Grants | undefined): string {
  if (!g) return '';
  const key = g.key === 'edge' ? ', key added at the edge' : g.key === 'inside' ? ', key inside the call' : '';
  return `project: ${g.app}, web results: ${g.web}, network: ${describeNetwork(g.network)}${key}`;
}

export function Results({ state, status, classes, activeFeedIndex, onPick }: { state: RunState; status: RunStatus; classes: Record<string, Grants>; activeFeedIndex: number; onPick: (feedIndex: number) => void }) {
  const matrix = state.start?.kind === 'matrix';
  const running = status === 'running';
  const counts: Record<string, number> = {};
  for (const c of state.calls) counts[c.class] = (counts[c.class] ?? 0) + 1;
  return (
    <div className="results">
      <Panel title="Execution timeline" hint="when each call ran; gaps are the agent deciding">
        <CallTimeline feed={state.feed} activeFeedIndex={activeFeedIndex} onPick={onPick} />
      </Panel>
      {!matrix && (
        <Panel title="Calls by access class" hint="fixed rules sort every call">
          <ClassBars counts={counts} describe={(cls) => describeGrants(classes[cls])} />
        </Panel>
      )}
      <Panel title="Independent checks" hint={state.checks.length ? `${state.checks.filter((c) => c.ok).length} of ${state.checks.length} passed` : undefined}>
        <Checks checks={state.checks} running={running} />
      </Panel>
    </div>
  );
}

// Full width: the measured table has seven columns.
export function AccessAndCleanup({ state, status }: { state: RunState; status: RunStatus }) {
  const running = status === 'running';
  const simulated = !!state.start?.simulated;
  return (
    <>
      <Panel title="Measured access" hint={simulated ? 'one harmless probe per class, against stand-ins' : 'one harmless probe per class, measured on Archil'}>
        {state.measure?.length ? <AccessTable rows={state.measure} /> : <div className="empty">{running ? 'Probes run after the agent stops.' : 'No probes were recorded for this run.'}</div>}
        {state.gap && <div className="callout warn"><Icon name="warning" size={16} color={INK.warning} /><div><strong>Known gap.</strong> {state.gap}</div></div>}
      </Panel>
      {(state.cleanup || state.errors.length > 0) && (
        <Panel title="Cleanup">
          {state.errors.map((e, i) => <div key={i} className="callout bad"><Icon name="warning" size={16} color={INK.critical} /><div>{e}</div></div>)}
          {state.cleanup && (
            <div className="cleanup">
              {(state.cleanup.deleted ?? []).map((d: string) => <span key={d} className="tag"><Icon name="check" size={12} stroke={2.4} />{d} deleted</span>)}
              {(state.cleanup.kept ?? []).map((d: string) => <span key={d} className="tag">{d} kept</span>)}
              {(state.cleanup.failed ?? []).map((d: string) => <span key={d} className="tag bad"><Icon name="warning" size={12} color={INK.critical} />{d}</span>)}
              {state.cleanup.recovered && <span className="tag">cleaned up after an interrupted run</span>}
            </div>
          )}
        </Panel>
      )}
    </>
  );
}
