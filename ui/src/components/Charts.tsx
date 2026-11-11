// The two charts. Both colour by access class, the same colour the stage uses, and both
// name every class in text beside its marks, so colour is never the only cue.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FeedItem, fmtMs } from '../model';
import { CLASS_ORDER, Icon, INK, classMeta } from '../theme';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

type Tip = { x: number; y: number; body: React.ReactNode } | null;
function TipBox({ tip }: { tip: Tip }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!tip || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(window.innerWidth - r.width - 8, tip.x + 14)), top: Math.max(8, tip.y - r.height - 12) });
  }, [tip]);
  if (!tip) return null;
  return <div ref={ref} className="tip" style={pos} role="tooltip">{tip.body}</div>;
}

function niceStep(spanSec: number, maxTicks: number): number {
  const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  return steps.find((s) => spanSec / s <= maxTicks) ?? 600;
}

// When each call ran, one lane per class. Gaps between bars are the agent deciding.
export function CallTimeline({ feed, activeFeedIndex, onPick }: { feed: FeedItem[]; activeFeedIndex: number; onPick: (feedIndex: number) => void }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip>(null);
  const marks = feed.flatMap((item, feedIndex) => {
    if (item.t === 'call') return [{ feedIndex, cls: item.call.class, start: item.at - item.call.wallMs, end: item.at, refused: false, title: `#${item.call.n}  ${item.call.label}`, note: `${fmtMs(item.call.wallMs)} · ${item.call.exitCode === 0 ? 'exit 0' : item.call.exitCode == null ? 'could not run' : `exit ${item.call.exitCode}`}` }];
    if (item.t === 'probe') return [{ feedIndex, cls: item.row.class, start: item.at - item.row.wallMs, end: item.at, refused: false, title: `probe of the "${classMeta(item.row.class).label}" class`, note: fmtMs(item.row.wallMs) }];
    if (item.t === 'rejected') return [{ feedIndex, cls: item.cls ?? 'other', start: item.at, end: item.at, refused: true, title: item.label, note: item.refused ? 'refused before any machine started' : 'rejected' }];
    return [];
  });
  const lanes = [...CLASS_ORDER, ...(marks.some((m) => m.cls === 'open') ? ['open'] : [])] as string[];
  const gutter = 92, right = 14, laneH = 28, top = 6, axisH = 24;
  const plotW = Math.max(40, width - gutter - right);
  const height = top + lanes.length * laneH + axisH;

  if (!marks.length) return <div ref={ref} className="empty">Calls appear here as they run.</div>;
  const t0 = Math.min(...marks.map((m) => m.start));
  const span = Math.max(1, Math.max(...marks.map((m) => m.end)) - t0);
  const x = (t: number) => gutter + ((t - t0) / span) * plotW;
  const step = niceStep(span / 1000, Math.max(2, Math.floor(plotW / 90)));
  const ticks: number[] = [];
  for (let v = 0; v <= span / 1000 + 1e-9; v += step) ticks.push(v);
  const tickLabel = (v: number) => (step < 1 ? `${Math.round(v * 1000)} ms` : `${Math.round(v)}s`);

  return (
    <div ref={ref} className="chart" onMouseLeave={() => setTip(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label="When each call ran, by access class">
          {ticks.map((v) => <line key={v} x1={x(t0 + v * 1000)} x2={x(t0 + v * 1000)} y1={top} y2={top + lanes.length * laneH} stroke={INK.line} strokeWidth={1} />)}
          {lanes.map((cls, i) => {
            const m = classMeta(cls);
            const y = top + i * laneH;
            return (
              <g key={cls}>
                <circle cx={10} cy={y + laneH / 2} r={5} fill={m.color} />
                <text x={22} y={y + laneH / 2 + 4.500} fontSize={12.500} fill={INK.secondary}>{m.label}</text>
              </g>
            );
          })}
          <line x1={gutter} x2={gutter + plotW} y1={top + lanes.length * laneH + 0.5} y2={top + lanes.length * laneH + 0.5} stroke={INK.axis} strokeWidth={1} />
          {ticks.map((v) => <text key={v} x={x(t0 + v * 1000)} y={height - 6} fontSize={11.500} fill={INK.muted} textAnchor={v === 0 ? 'start' : 'middle'} style={{ fontVariantNumeric: 'tabular-nums' }}>{tickLabel(v)}</text>)}
          {marks.map((m) => {
            const lane = lanes.indexOf(m.cls) < 0 ? lanes.indexOf('other') : lanes.indexOf(m.cls);
            const y = top + lane * laneH;
            const meta = classMeta(m.cls);
            const x0 = x(m.start);
            const w = Math.max(4, x(m.end) - x0 - 2);
            const active = m.feedIndex === activeFeedIndex;
            const hitW = Math.max(16, w + 6);
            const show = (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, body: <><div className="tip-title">{m.title}</div><div className="tip-row"><span className="dot" style={{ background: meta.color }} />{meta.label} class</div><div className="tip-row muted">{m.note}</div></> });
            return (
              <g key={m.feedIndex} style={{ cursor: 'pointer' }} onMouseMove={show} onClick={() => onPick(m.feedIndex)}>
                {m.refused
                  ? <g transform={`translate(${x0 - 7}, ${y + laneH / 2 - 7})`}><circle cx={7} cy={7} r={6.500} fill={INK.surface} stroke={INK.critical} strokeWidth={1.8} /><line x1={3} y1={3} x2={11} y2={11} stroke={INK.critical} strokeWidth={1.8} strokeLinecap="round" /></g>
                  : <rect x={x0} y={y + (laneH - 14) / 2} width={w} height={14} rx={3.500} fill={meta.color} opacity={activeFeedIndex >= 0 && !active ? 0.55 : 1} stroke={active ? INK.primary : 'none'} strokeWidth={active ? 1.5 : 0} />}
                <rect x={x0 + w / 2 - hitW / 2} y={y} width={hitW} height={laneH} fill="transparent" />
              </g>
            );
          })}
        </svg>
      )}
      <TipBox tip={tip} />
    </div>
  );
}

// How many calls each class handled.
export function ClassBars({ counts, describe }: { counts: Record<string, number>; describe: (cls: string) => string }) {
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(1, ...Object.values(counts));
  const rows = [...CLASS_ORDER, ...Object.keys(counts).filter((k) => !(CLASS_ORDER as readonly string[]).includes(k))];
  return (
    <div className="bars" onMouseLeave={() => setTip(null)}>
      {rows.map((cls) => {
        const m = classMeta(cls);
        const v = counts[cls] ?? 0;
        return (
          <div key={cls} className="bar-row" onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, body: <><div className="tip-title">{m.label}: {v} call{v === 1 ? '' : 's'}</div><div className="tip-row muted">{m.blurb}</div><div className="tip-row muted">{describe(cls)}</div></> })}>
            <span className="bar-label"><Icon name={m.icon} size={14} color={INK.secondary} />{m.label}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${(v / max) * 100}%`, background: m.color }} /><span className="bar-value">{v}</span></span>
          </div>
        );
      })}
      <TipBox tip={tip} />
    </div>
  );
}
