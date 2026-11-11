// The execution log: every call, refusal and note in the order it happened. Rows appear
// the moment their event arrives; the highlighted row is the one the stage is playing.

import React, { useEffect, useRef, useState } from 'react';
import { FeedItem, RunState, fmtMs } from '../model';
import { Icon, INK, classMeta } from '../theme';
import { describeGrants } from './Results';

function ClassChip({ cls }: { cls: string }) {
  const m = classMeta(cls);
  return <span className="class-chip" style={{ ['--c' as any]: m.color }}><Icon name={m.icon} size={13} />{m.label}</span>;
}

function CallRow({ item, index, active, open, onToggle, onPlay }: { item: Extract<FeedItem, { t: 'call' }>; index: number; active: boolean; open: boolean; onToggle: () => void; onPlay: () => void }) {
  const c = item.call;
  const ok = c.exitCode === 0;
  return (
    <li className={`log-row call${active ? ' active' : ''}`} data-feed={index}>
      <div className="log-line">
        <button className="log-main" onClick={onToggle} aria-expanded={open}>
          <span className="log-n">{c.n}</span>
          <ClassChip cls={c.class} />
          <span className="log-label mono">{c.label}</span>
          <span className="log-meta">
            {c.redactions > 0 && <span className="tag warn"><Icon name="filter" size={12} />{c.redactions} scrubbed</span>}
            <span className="log-time">{fmtMs(c.wallMs)}</span>
            <span className={`exit ${ok ? 'ok' : 'bad'}`}><Icon name={ok ? 'check' : 'x'} size={13} color={ok ? INK.good : INK.critical} stroke={2.6} />{c.exitCode == null ? 'error' : `exit ${c.exitCode}`}</span>
            <Icon name="chevron" size={14} color={INK.muted} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }} />
          </span>
        </button>
        <button className="icon-btn small" onClick={onPlay} title="Play this call on the stage" aria-label={`Play call ${c.n} on the stage`}><Icon name="play" size={13} /></button>
      </div>
      {open && (
        <div className="log-detail">
          <div className="grants"><Icon name="shield" size={14} color={INK.secondary} />Access for this call: {describeGrants(c.grants)}</div>
          {c.error && <pre className="out bad">{c.error}</pre>}
          {c.search?.results?.length ? (
            <ul className="search-results">{c.search.results.map((r) => <li key={r.url}><span>{r.title}</span><span className="mono muted">{r.url}</span></li>)}</ul>
          ) : null}
          {c.output && <pre className="out">{c.output}</pre>}
          {c.stderr && <pre className="out err">{c.stderr}</pre>}
          {!c.output && !c.stderr && !c.error && !c.search?.results?.length && <div className="muted small">No output.</div>}
        </div>
      )}
    </li>
  );
}

export function ExecutionLog({ state, running, activeFeedIndex, follow, onPlay }: { state: RunState; running: boolean; activeFeedIndex: number; follow: boolean; onPlay: (feedIndex: number) => void }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const box = useRef<HTMLUListElement>(null);
  const [since, setSince] = useState(0);

  useEffect(() => { setOpen(new Set()); }, [state.start?.id]);

  // Keep the row the stage is playing in view, without moving the page itself.
  useEffect(() => {
    const el = box.current;
    if (!el || !follow || activeFeedIndex < 0) return;
    const row = el.querySelector<HTMLElement>(`[data-feed="${activeFeedIndex}"]`);
    if (!row) return;
    const top = row.offsetTop - el.offsetTop;
    if (top < el.scrollTop || top + row.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' });
  }, [activeFeedIndex, follow]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSince(Date.now() - (state.lastAt || Date.now())), 100);
    return () => clearInterval(t);
  }, [running, state.lastAt]);

  const probes = state.feed.filter((f) => f.t === 'probe').length;
  const toggle = (i: number) => setOpen((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  return (
    <section className="panel card log">
      <header className="panel-head"><h3>Execution log</h3><span className="panel-hint">{probes ? `${probes} probe${probes === 1 ? '' : 's'}` : `${state.calls.length} call${state.calls.length === 1 ? '' : 's'}`}{state.refused ? `, ${state.refused} refused` : ''}</span></header>
      <ul className="log-list" ref={box}>
        {state.feed.length === 0 && !running && <li className="empty">Nothing recorded for this run.</li>}
        {state.feed.map((item, i) => {
          if (item.t === 'call') return <CallRow key={i} item={item} index={i} active={i === activeFeedIndex} open={open.has(i)} onToggle={() => toggle(i)} onPlay={() => onPlay(i)} />;
          if (item.t === 'probe') {
            const r = item.row;
            return (
              <li key={i} className={`log-row call${i === activeFeedIndex ? ' active' : ''}`} data-feed={i}>
                <div className="log-line">
                  <button className="log-main" onClick={() => onPlay(i)}>
                    <ClassChip cls={r.class} /><span className="log-label">Probe: what could this class reach?</span>
                    <span className="log-meta"><span className="log-time">{fmtMs(r.wallMs)}</span><span className={`exit ${r.measured ? 'ok' : 'bad'}`}><Icon name={r.measured ? 'check' : 'x'} size={13} color={r.measured ? INK.good : INK.critical} stroke={2.6} />{r.measured ? 'reported' : 'no report'}</span></span>
                  </button>
                </div>
              </li>
            );
          }
          if (item.t === 'rejected') {
            return (
              <li key={i} className={`log-row refused${i === activeFeedIndex ? ' active' : ''}`} data-feed={i}>
                <div className="log-line">
                  <button className="log-main" onClick={() => onPlay(i)}>
                    <span className="log-n"><Icon name="ban" size={15} color={INK.critical} /></span>
                    {item.cls && <ClassChip cls={item.cls} />}
                    <span className="log-label mono">{item.label}</span>
                    <span className="log-meta"><span className="tag bad">{item.refused ? 'refused' : 'rejected'}</span></span>
                  </button>
                </div>
                <div className="log-problem">{item.problem.replace(/^Refused:\s*/, '')}</div>
              </li>
            );
          }
          if (item.t === 'say') return <li key={i} className="log-row say"><Icon name="bot" size={15} color={INK.muted} /><span>{item.text}</span></li>;
          if (item.t === 'error') return <li key={i} className="log-row note bad"><Icon name="warning" size={15} color={INK.critical} /><span>{item.text}</span></li>;
          return <li key={i} className="log-row note"><Icon name="bolt" size={15} color={INK.muted} /><span>{item.text}</span></li>;
        })}
        {running && (
          <li className="log-row pending"><span className="spinner" /><span>{state.agentDone ? 'Running the independent checks' : state.feed.length ? 'Waiting on the next step' : 'Setting up the run'}</span><span className="log-time">{(since / 1000).toFixed(1)}s since the last event</span></li>
        )}
      </ul>
    </section>
  );
}
