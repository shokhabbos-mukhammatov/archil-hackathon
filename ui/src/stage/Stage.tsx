// The stage: a Remotion composition that plays one run as a sequence of fixed-length
// segments. Every tool call is shown the way it actually ran: the agent asks, fixed rules
// pick a class, a fresh microVM starts with only that class's mounts and network, its
// output goes back through the scrubber, and the machine is gone again.
//
// It is a pure function of (frame, segments), so the same composition follows a live run
// in the page and replays a finished one. Nothing in here reads the clock or the network.

import React from 'react';
import { AbsoluteFill, Easing, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Segment, describeNetwork, fmtMs, reachesService, segmentAt } from '../model';
import { Icon, IconName, INK, classMeta } from '../theme';

export const STAGE_W = 1280;
export const STAGE_H = 540;
export type StageProps = { segments: Segment[]; agentLabel: string; waiting: string };

const clampOpts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
const smooth = Easing.bezier(0.2, 0.8, 0.2, 1);
const prog = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], { ...clampOpts, easing: smooth });
const lin = (f: number, a: number, b: number) => interpolate(f, [a, b], [0, 1], clampOpts);

// Geometry (composition pixels).
const MID = 245;
const AGENT = { x: 40, y: 158, w: 190, h: 174 };
const GATE = { x: 300, y: 200, w: 150, h: 90 };
const VM = { x: 520, y: 140, w: 310, h: 210 };
const SCRUB = { x: 300, y: 438, w: 150, h: 64 };
const RES = { x: 1000, w: 244, h: 86, cy: [78, 190, 302, 414], sy: [200, 230, 260, 290] };
const RETURN_PATH: [number, number][] = [[675, 350], [675, 470], [450, 470], [300, 470], [135, 470], [135, AGENT.y + AGENT.h]];

type Pt = [number, number];
const linkPoints = (i: number): [Pt, Pt, Pt, Pt] => {
  const a: Pt = [VM.x + VM.w, RES.sy[i]];
  const d: Pt = [RES.x, RES.cy[i]];
  return [a, [a[0] + 85, a[1]], [d[0] - 85, d[1]], d];
};
const bez = ([a, b, c, d]: [Pt, Pt, Pt, Pt], t: number): Pt => {
  const u = 1 - t;
  const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [a[0] * k[0] + b[0] * k[1] + c[0] * k[2] + d[0] * k[3], a[1] * k[0] + b[1] * k[1] + c[1] * k[2] + d[1] * k[3]];
};
const linkD = (i: number) => { const [a, b, c, d] = linkPoints(i); return `M${a[0]} ${a[1]} C${b[0]} ${b[1]} ${c[0]} ${c[1]} ${d[0]} ${d[1]}`; };
function along(points: Pt[], t: number): Pt {
  const lens = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  let left = Math.max(0, Math.min(1, t)) * lens.reduce((x, y) => x + y, 0);
  for (let i = 0; i < lens.length; i++) {
    if (left <= lens[i] || i === lens.length - 1) { const r = lens[i] ? left / lens[i] : 0; return [points[i][0] + (points[i + 1][0] - points[i][0]) * r, points[i][1] + (points[i + 1][1] - points[i][1]) * r]; }
    left -= lens[i];
  }
  return points[0];
}

// What each of the four things a call could touch looks like for this call.
type Link = { on: boolean; mode: 'rw' | 'ro' | 'edge' | 'net' | 'off'; tag: string };
function linksFor(seg: Extract<Segment, { kind: 'call' }>): Link[] {
  const g = seg.grants;
  const row = seg.row;
  const mount = (m: string, measured: string | null | undefined): Link => {
    if (m === 'none') return { on: false, mode: 'off', tag: 'not mounted' };
    const tag = row ? (measured === 'allowed' ? 'write allowed' : `write ${measured ?? 'refused'}`) : m === 'write' ? 'read + write' : 'read-only';
    return { on: true, mode: m === 'write' ? 'rw' : 'ro', tag };
  };
  const service: Link = g.network === 'service'
    ? { on: true, mode: 'edge', tag: row ? (row.service ?? 'not measured') : 'key added at the edge' }
    : g.network === null
      ? { on: true, mode: 'rw', tag: row ? (row.service ?? 'reachable') : 'reachable' }
      : { on: false, mode: 'off', tag: row ? (row.service ?? 'blocked') : 'blocked' };
  const allow = g.network && typeof g.network === 'object' ? (g.network.allow ?? []) : [];
  const net: Link = g.network === null
    ? { on: true, mode: 'rw', tag: row ? (row.outside ?? 'open') : 'open, no limits' }
    : allow.length
      ? { on: true, mode: 'net', tag: describeNetwork(g.network) }
      : { on: false, mode: 'off', tag: row && row.outside ? row.outside : 'blocked' };
  return [mount(g.app, row?.workspaceWrite), mount(g.web, row?.webWrite), service, net];
}

const font = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const mono = 'ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace';
const card = (r: { x: number; y: number; w: number; h: number }, extra: React.CSSProperties = {}): React.CSSProperties => ({
  position: 'absolute', left: r.x, top: r.y, width: r.w, height: r.h, boxSizing: 'border-box',
  background: INK.surface, border: `1.5px solid ${INK.axis}`, borderRadius: 14, color: INK.primary, ...extra,
});
const ellipsis: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

function Chip({ cls, scale = 1 }: { cls: string; scale?: number }) {
  const m = classMeta(cls);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 11px 4px 8px', borderRadius: 999, background: `${m.color}2e`, border: `1.5px solid ${m.color}`, fontSize: 17, fontWeight: 600, color: INK.primary, transform: `scale(${scale})`, whiteSpace: 'nowrap' }}>
      <Icon name={m.icon} size={17} color={INK.primary} />{m.label}
    </span>
  );
}

function Packet({ at, color, opacity = 1 }: { at: Pt; color: string; opacity?: number }) {
  return <rect x={at[0] - 13} y={at[1] - 6.500} width={26} height={13} rx={6.500} fill={color} stroke={INK.page} strokeWidth={2} opacity={opacity} />;
}

const RES_DEF: { title: string; icon: IconName }[] = [
  { title: 'Project disk', icon: 'disk' },
  { title: 'Web results disk', icon: 'disk' },
  { title: 'Project service', icon: 'server' },
  { title: 'Internet', icon: 'globe' },
];

export const Stage: React.FC<StageProps> = ({ segments, agentLabel, waiting }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const idx = segmentAt(segments, frame);
  const seg = idx >= 0 ? segments[idx] : null;
  const f = seg ? frame - seg.from : 0;
  const call = seg?.kind === 'call' ? seg : null;
  const refused = seg?.kind === 'refused' ? seg : null;
  const setup = seg?.kind === 'setup' ? seg : null;
  const verdict = seg?.kind === 'verdict' ? seg : null;
  const setupSeg = segments.find((s) => s.kind === 'setup') as Extract<Segment, { kind: 'setup' }> | undefined;
  const provisioned = !!setupSeg && frame >= setupSeg.from;
  const color = classMeta(call?.cls ?? refused?.cls).color;

  const links = call ? linksFor(call) : null;
  const out = call ? lin(f, 66, 76) : 0; // the machine and its grants going away
  const vmIn = call ? spring({ frame: f - 16, fps, config: { damping: 14, mass: 0.6 } }) : 0;
  const vmOpacity = call ? Math.min(1, vmIn) * (1 - out) : 0;
  const tainted = !!(seg && 'tainted' in seg && seg.tainted) || !!(call && reachesService(call.grants) && call.cls !== 'open' && f >= 60);
  const totalCalls = segments.filter((s) => s.kind === 'call').length;

  const subtitle = (i: number) => {
    const d = setupSeg?.disks ?? [];
    if (i === 0) return d.find((n) => n.endsWith('-ws')) ?? 'one per run';
    if (i === 1) return d.find((n) => n.endsWith('-web')) ?? 'one per run';
    if (i === 2) return setupSeg?.service ?? 'holds the data the key unlocks';
    return 'any host outside the project';
  };

  return (
    <AbsoluteFill style={{ background: INK.page, fontFamily: font, color: INK.primary, lineHeight: 1.3 }}>
      {/* faint dot grid */}
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(${INK.line} 1px, transparent 1px)`, backgroundSize: '26px 26px', opacity: 0.55 }} />

      <svg width={STAGE_W} height={STAGE_H} style={{ position: 'absolute', inset: 0 }}>
        {/* fixed wiring */}
        <path d={`M${AGENT.x + AGENT.w} ${MID} H${GATE.x} M${GATE.x + GATE.w} ${MID} H${VM.x}`} stroke={INK.axis} strokeWidth={1.5} fill="none" />
        <polyline points={RETURN_PATH.map((p) => p.join(',')).join(' ')} stroke={INK.axis} strokeWidth={1.5} fill="none" />
        {[0, 1, 2, 3].map((i) => <path key={i} d={linkD(i)} stroke={INK.line} strokeWidth={1.5} fill="none" />)}

        {/* this call's grants */}
        {links && links.map((l, i) => {
          const draw = prog(f, 20 + i * 2, 32 + i * 2);
          const mid = bez(linkPoints(i), 0.5);
          if (!l.on) {
            const o = prog(f, 24 + i * 2, 32 + i * 2) * (1 - out);
            return (
              <g key={i} opacity={o}>
                <circle cx={mid[0]} cy={mid[1]} r={12} fill={INK.page} stroke={INK.muted} strokeWidth={1.5} />
                <path d={`M${mid[0] - 4.500} ${mid[1] - 4.500}l9 9M${mid[0] + 4.500} ${mid[1] - 4.500}l-9 9`} stroke={INK.muted} strokeWidth={2} strokeLinecap="round" />
              </g>
            );
          }
          const flowing = f >= 30 + i * 2 && f < 60;
          const dots = flowing ? [0, 1, 2].map((k) => {
            const t = (((f - 30) / 24) * 1.25 + k / 3) % 1;
            const backward = l.mode === 'ro' ? true : k === 1;
            return bez(linkPoints(i), backward ? 1 - t : t);
          }) : [];
          return (
            <g key={i} opacity={1 - out}>
              <path d={linkD(i)} pathLength={1} strokeDasharray="1 1" strokeDashoffset={1 - draw} stroke={color} strokeWidth={l.mode === 'ro' ? 2 : 3.500} strokeLinecap="round" fill="none" />
              {dots.map((p, k) => <circle key={k} cx={p[0]} cy={p[1]} r={5} fill={color} stroke={INK.page} strokeWidth={2} />)}
            </g>
          );
        })}

        {/* request and result packets */}
        {(call || refused) && f < 10 && <Packet at={[AGENT.x + AGENT.w + (GATE.x - AGENT.x - AGENT.w) * prog(f, 0, 10), MID]} color={INK.secondary} />}
        {call && f >= 13 && f < 22 && <Packet at={[GATE.x + GATE.w + (VM.x - GATE.x - GATE.w) * prog(f, 13, 22), MID]} color={color} />}
        {call && f >= 54 && f < 70 && <Packet at={along(RETURN_PATH, lin(f, 54, 70))} color={color} />}
        {refused && f >= 26 && f < 40 && <Packet at={[GATE.x - (GATE.x - AGENT.x - AGENT.w) * prog(f, 26, 40), MID]} color={INK.critical} />}
      </svg>

      {/* header: what is happening now */}
      <div style={{ position: 'absolute', left: 40, top: 26, width: 920 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 15, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', color: INK.muted, height: 30 }}>
          {call && <>{call.row ? 'Probe' : 'Call'} {call.n}{call.row || !totalCalls ? '' : ` of ${totalCalls}`}</>}
          {refused && <span style={{ color: INK.primary, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name="ban" size={18} color={INK.critical} />{refused.refused ? 'Refused before any machine started' : 'Rejected'}</span>}
          {setup && 'Setting up this run'}
          {verdict && 'Result'}
          {!seg && 'Standing by'}
        </div>
        <div style={{ fontFamily: mono, fontSize: 22, marginTop: 4, color: INK.primary, ...ellipsis }}>
          {call?.label ?? refused?.label ?? (setup ? `${setup.disks.length} disks of its own, and a fresh API key for the service` : verdict ? 'Checked independently of the agent' : waiting)}
        </div>
        {refused && <div style={{ fontSize: 16, color: INK.secondary, marginTop: 6, opacity: prog(f, 14, 24), ...ellipsis }}>{refused.problem.replace(/^Refused:\s*/, '')}</div>}
      </div>

      {/* agent */}
      <div style={card(AGENT, { padding: '14px 16px', borderColor: tainted ? INK.warning : INK.axis })}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 20, fontWeight: 650 }}><Icon name="bot" size={22} />Agent</div>
        <div style={{ fontSize: 14.500, color: INK.muted, marginTop: 3, ...ellipsis }}>{agentLabel}</div>
        <div style={{ height: 1, background: INK.line, margin: '11px 0 9px' }} />
        {tainted
          ? <div style={{ display: 'flex', gap: 8, fontSize: 14.500, lineHeight: 1.25, color: INK.primary }}><Icon name="warning" size={18} color={INK.warning} style={{ marginTop: 1 }} /><span>Has seen service data: search and install are now refused</span></div>
          : <div style={{ fontSize: 14.500, lineHeight: 1.25, color: INK.muted }}>Runs on your machine. Has no computer of its own.</div>}
      </div>

      {/* policy gate */}
      {(() => {
        const stamp = call ? spring({ frame: f - 9, fps, config: { damping: 11, mass: 0.5 } }) : 0;
        const rStamp = refused ? spring({ frame: f - 11, fps, config: { damping: 9, mass: 0.5 } }) : 0;
        const shake = refused ? Math.sin(f * 1.7) * 6 * (1 - lin(f, 12, 28)) * (f >= 12 ? 1 : 0) : 0;
        return (
          <div style={card(GATE, { padding: '10px 12px', textAlign: 'center', transform: `translateX(${shake}px)`, borderColor: refused && f >= 11 ? INK.critical : call && f >= 9 ? color : INK.axis })}>
            <div style={{ fontSize: 13.500, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', color: INK.muted }}>Fixed rules</div>
            <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 4 }}>
              {call && f >= 9 && <span style={{ opacity: 1 - out }}><Chip cls={call.cls} scale={0.7 + 0.3 * stamp} /></span>}
              {refused && f >= 11 && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px', borderRadius: 8, border: `2px solid ${INK.critical}`, fontSize: 16, fontWeight: 700, letterSpacing: 1, transform: `scale(${0.6 + 0.4 * rStamp}) rotate(-4deg)` }}><Icon name="ban" size={17} color={INK.critical} />REFUSED</span>}
              {!call && !refused && <span style={{ fontSize: 14.500, color: INK.muted }}>pick the class</span>}
            </div>
          </div>
        );
      })()}

      {/* the machine: exists only for the length of one call */}
      <div style={card(VM, { background: 'transparent', border: `1.5px dashed ${refused ? INK.critical : INK.axis}`, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', opacity: (1 - vmOpacity) * (verdict ? 0.3 : 1) })}>
        <div style={{ fontSize: 16, color: INK.muted, lineHeight: 1.35, padding: 24 }}>
          {setup ? <span style={{ color: INK.secondary }}>{setup.disks.map((d, i) => <div key={d} style={{ fontFamily: mono, fontSize: 15, opacity: prog(f, 6 + i * 8, 14 + i * 8) }}>+ {d}</div>)}<div style={{ fontFamily: mono, fontSize: 15, opacity: prog(f, 6 + setup.disks.length * 8, 14 + setup.disks.length * 8) }}>+ API key registered at the edge</div></span>
            : refused ? <span style={{ color: INK.secondary }}>No machine was started for this call</span>
              : seg ? 'No machine exists between calls' : waiting}
        </div>
      </div>
      {call && (
        <div style={card(VM, { borderColor: color, borderWidth: 2, boxShadow: `0 0 0 7px ${color}26, 0 18px 50px #000a`, opacity: vmOpacity, transform: `scale(${0.9 + 0.1 * Math.min(vmIn, 1.05) - 0.05 * out})`, padding: '15px 18px', display: 'flex', flexDirection: 'column' })}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 19, fontWeight: 650 }}>
            <Icon name="cpu" size={21} />microVM<span style={{ color: INK.muted, fontWeight: 500 }}>#{call.n}</span>
            <span style={{ marginLeft: 'auto' }}><Chip cls={call.cls} /></span>
          </div>
          <div style={{ fontFamily: mono, fontSize: 16, color: INK.secondary, marginTop: 13, lineHeight: 1.35, height: 66, overflow: 'hidden', wordBreak: 'break-all' }}>{call.label}</div>
          {call.grants.key === 'inside' && <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 15, marginTop: 2 }}><Icon name="key" size={17} color={INK.critical} />API key is inside this call</div>}
          <div style={{ marginTop: 'auto' }}>
            <div style={{ height: 4, borderRadius: 2, background: `${color}40`, overflow: 'hidden' }}><div style={{ height: '100%', width: `${lin(f, 28, 54) * 100}%`, background: color, borderRadius: 2 }} /></div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, marginTop: 10, height: 22 }}>
              {f < 28 && <span style={{ color: INK.muted }}>starting...</span>}
              {f >= 28 && f < 54 && <span style={{ color: INK.secondary }}>running</span>}
              {f >= 54 && (call.exitCode === 0
                ? <><Icon name="check" size={19} color={INK.good} stroke={2.4} /><span>exit 0</span></>
                : <><Icon name="x" size={19} color={INK.critical} stroke={2.4} /><span>{call.exitCode == null ? 'could not run' : `exit ${call.exitCode}`}</span></>)}
              {f >= 54 && <span style={{ color: INK.muted }}>{fmtMs(call.wallMs)}</span>}
              {f >= 64 && <span style={{ marginLeft: 'auto', color: INK.muted }}>destroyed</span>}
            </div>
          </div>
        </div>
      )}

      {/* key-at-the-edge marker on the service link */}
      {links && links[2].mode === 'edge' && (() => {
        const p = bez(linkPoints(2), 0.5);
        return <div style={{ position: 'absolute', left: p[0] - 19, top: p[1] - 19, width: 38, height: 38, borderRadius: 19, background: INK.page, border: `2px solid ${color}`, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: prog(f, 28, 36) * (1 - out) }}><Icon name="key" size={19} color={INK.primary} /></div>;
      })()}

      {/* what a call could touch */}
      {RES_DEF.map((r, i) => {
        const l = links?.[i];
        const appear = setup ? prog(f, 4 + i * 8, 16 + i * 8) : provisioned ? 1 : 0.35;
        const lit = l ? prog(f, 26 + i * 2, 36 + i * 2) * (1 - out) : 0;
        const tagAt = call?.row ? 42 : 26 + i * 2;
        const pulse = setup ? Math.sin(Math.PI * lin(f, 4 + i * 8, 24 + i * 8)) : 0;
        return (
          <div key={r.title} style={card({ x: RES.x, y: RES.cy[i] - RES.h / 2, w: RES.w, h: RES.h }, {
            padding: '11px 14px', opacity: appear * (l && !l.on ? 1 - 0.45 * lit : 1),
            borderColor: l?.on && lit > 0.5 ? color : pulse > 0.3 ? INK.accent : INK.axis,
            boxShadow: l?.on ? `0 0 0 ${5 * lit}px ${color}22` : 'none',
          })}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 650 }}><Icon name={r.icon} size={19} />{r.title}</div>
            <div style={{ fontFamily: mono, fontSize: 13, color: INK.muted, marginTop: 2, ...ellipsis }}>{subtitle(i)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 15, marginTop: 6, height: 20, opacity: l ? prog(f, tagAt, tagAt + 8) * (1 - out) : 0, color: l?.on ? INK.primary : INK.muted, ...ellipsis }}>
              {l && <Icon name={l.on ? 'check' : 'x'} size={16} color={l.on ? INK.primary : INK.muted} stroke={2.2} />}{l?.tag}
            </div>
          </div>
        );
      })}

      {/* scrubber: the one point where output leaves */}
      {(() => {
        const pass = call && f >= 60 ? spring({ frame: f - 60, fps, config: { damping: 12, mass: 0.5 } }) : 0;
        const hit = !!call && call.redactions > 0;
        return (
          <div style={card(SCRUB, { padding: '9px 12px', textAlign: 'center', borderColor: call && f >= 60 && f < 74 ? (hit ? INK.warning : INK.good) : INK.axis })}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, fontSize: 16, fontWeight: 650 }}><Icon name="filter" size={17} />Scrubber</div>
            <div style={{ fontSize: 14.500, marginTop: 3, color: call && f >= 60 ? INK.primary : INK.muted, transform: `scale(${call && f >= 60 ? 0.85 + 0.15 * pass : 1})` }}>
              {call && f >= 60 ? `${call.redactions} secret${call.redactions === 1 ? '' : 's'} removed` : 'strips secret values'}
            </div>
          </div>
        );
      })()}

      {/* verdict */}
      {verdict && (() => {
        const n = verdict.checks.length;
        const passed = verdict.checks.filter((c) => c.ok).length;
        const bannerAt = 16 + n * 7 + 6;
        const pop = spring({ frame: f - bannerAt, fps, config: { damping: 11, mass: 0.6 } });
        const good = verdict.ok && !verdict.interrupted;
        const headline = verdict.interrupted ? 'Run interrupted' : n === 0 ? (verdict.ok ? 'Run finished' : 'Run failed') : good ? `All ${n} checks passed` : `${n - passed} of ${n} checks failed`;
        return (
          <AbsoluteFill style={{ background: `rgba(13,13,13,${0.86 * prog(f, 0, 10)})`, alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 800, opacity: prog(f, 4, 14), transform: `translateY(${(1 - prog(f, 4, 14)) * 14}px)` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16, opacity: f >= bannerAt ? 1 : 0.0, transform: `scale(${0.92 + 0.08 * pop})`, transformOrigin: 'left center' }}>
                <div style={{ width: 54, height: 54, borderRadius: 27, background: good ? INK.good : INK.critical, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={good ? 'check' : 'x'} size={32} color="#fff" stroke={2.8} /></div>
                <div>
                  <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: -0.5 }}>{headline}</div>
                  <div style={{ fontSize: 16, color: INK.secondary }}>{verdict.error && !n ? verdict.error.slice(0, 110) : 'Re-run by the runner itself, not reported by the agent'}</div>
                </div>
              </div>
              <div style={{ background: INK.surface, border: `1.5px solid ${INK.axis}`, borderRadius: 14, padding: n ? '8px 18px' : 0 }}>
                {verdict.checks.map((c, i) => {
                  const o = prog(f, 14 + i * 7, 22 + i * 7);
                  const tick = spring({ frame: f - (16 + i * 7), fps, config: { damping: 10, mass: 0.4 } });
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, height: 34, opacity: o, borderTop: i ? `1px solid ${INK.line}` : 'none', fontSize: 16.500 }}>
                      <span style={{ transform: `scale(${tick})`, display: 'inline-flex' }}><Icon name={c.ok ? 'check' : 'x'} size={20} color={c.ok ? INK.good : INK.critical} stroke={2.6} /></span>
                      <span style={ellipsis}>{c.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </AbsoluteFill>
        );
      })()}
    </AbsoluteFill>
  );
};
