// The stage in the page: a Remotion Player plus its own transport. While a run is live the
// player follows it: new segments are appended as events arrive, and playback speeds up
// when the animation falls behind the real run. A finished run is an ordinary replay.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, PlayerRef } from '@remotion/player';
import { FPS, Segment, segmentAt, totalFrames } from '../model';
import { Icon, INK, classMeta } from '../theme';
import { STAGE_H, STAGE_W, Stage } from './Stage';

type Props = {
  runId: string;
  segments: Segment[];
  live: boolean;
  agentLabel: string;
  waiting: string;
  seek: { index: number; nonce: number } | null;
  onSegment: (index: number) => void;
};

const SPEEDS = [1, 2, 4];

export function StagePlayer({ runId, segments, live, agentLabel, waiting, seek, onSegment }: Props) {
  const ref = useRef<PlayerRef>(null);
  const total = Math.max(1, totalFrames(segments));
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [following, setFollowing] = useState(true);
  const [speed, setSpeed] = useState(1);
  const followingRef = useRef(following);
  followingRef.current = following;
  const segIndex = segmentAt(segments, frame);

  // Catch up when the animation is well behind a live run.
  const behind = total - frame;
  const catchUp = live && following ? (behind > 320 ? 3 : behind > 150 ? 1.75 : 1) : 1;
  const rate = Math.min(4, speed * catchUp);

  const inputProps = useMemo(() => ({ segments, agentLabel, waiting }), [segments, agentLabel, waiting]);

  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    const onFrame = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    p.addEventListener('ended', onPause);
    return () => { p.removeEventListener('frameupdate', onFrame); p.removeEventListener('play', onPlay); p.removeEventListener('pause', onPause); p.removeEventListener('ended', onPause); };
  }, []);

  // A different run: start again from the top and follow it.
  useEffect(() => {
    ref.current?.seekTo(0);
    setFrame(0);
    setFollowing(true);
  }, [runId]);

  // More to play has arrived (or this is a fresh run): keep going unless the viewer paused.
  useEffect(() => {
    const p = ref.current;
    if (!p || !followingRef.current || segments.length === 0) return;
    if (!p.isPlaying() && p.getCurrentFrame() < total - 1) p.play();
  }, [total, runId, segments.length]);

  useEffect(() => { onSegment(segIndex); }, [segIndex, onSegment]);

  // A request from the page to jump to one call.
  useEffect(() => {
    const p = ref.current;
    if (!seek || !p || !segments[seek.index]) return;
    p.seekTo(segments[seek.index].from);
    setFollowing(false);
    p.play();
  }, [seek?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = useCallback(() => {
    const p = ref.current;
    if (!p) return;
    if (p.isPlaying()) { p.pause(); setFollowing(false); return; }
    if (p.getCurrentFrame() >= total - 1) p.seekTo(0);
    setFollowing(true);
    p.play();
  }, [total]);

  const seekTo = (f: number) => {
    const p = ref.current;
    if (!p) return;
    p.seekTo(Math.max(0, Math.min(total - 1, Math.round(f))));
    setFollowing(false);
  };
  const goLive = () => {
    const p = ref.current;
    if (!p || !segments.length) return;
    p.seekTo(segments[segments.length - 1].from);
    setFollowing(true);
    p.play();
  };

  const atEnd = frame >= total - 1;
  const seg = segIndex >= 0 ? segments[segIndex] : null;
  const segName = !seg ? 'Waiting' : seg.kind === 'setup' ? 'Setup' : seg.kind === 'verdict' ? 'Result' : seg.kind === 'refused' ? 'Refused call' : seg.row ? `Probe ${seg.n}` : `Call ${seg.n}`;

  return (
    <section className="stage card" aria-label="Animated view of the run">
      <div className="stage-canvas">
        <Player
          ref={ref}
          component={Stage}
          inputProps={inputProps}
          durationInFrames={total}
          fps={FPS}
          compositionWidth={STAGE_W}
          compositionHeight={STAGE_H}
          playbackRate={rate}
          style={{ width: '100%', aspectRatio: `${STAGE_W} / ${STAGE_H}` }}
          controls={false}
          clickToPlay={false}
          doubleClickToFullscreen={false}
          spaceKeyToPlayOrPause={false}
          moveToBeginningWhenEnded={false}
          acknowledgeRemotionLicense
        />
      </div>
      <div className="transport">
        <button className="icon-btn" onClick={toggle} disabled={!segments.length} aria-label={playing ? 'Pause' : atEnd ? 'Replay' : 'Play'} title={playing ? 'Pause' : atEnd ? 'Replay from the start' : 'Play'}>
          <Icon name={playing ? 'pause' : atEnd && segments.length ? 'replay' : 'play'} size={18} />
        </button>
        <div className="track" role="slider" aria-label="Position in the run" aria-valuemin={0} aria-valuemax={total} aria-valuenow={frame} tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'ArrowRight' && segments[segIndex + 1]) seekTo(segments[segIndex + 1].from); if (e.key === 'ArrowLeft' && segIndex >= 0) seekTo(segments[Math.max(0, segIndex - 1)].from); }}>
          {segments.length === 0 && <div className="track-empty" />}
          {segments.map((s, i) => {
            const color = s.kind === 'call' ? classMeta(s.cls).color : s.kind === 'refused' ? INK.critical : s.kind === 'verdict' ? (s.ok ? INK.good : INK.critical) : INK.muted;
            const fill = i < segIndex ? 1 : i === segIndex ? (frame - s.from) / s.frames : 0;
            const label = s.kind === 'call' ? `${s.row ? 'Probe' : 'Call'} ${s.n} · ${classMeta(s.cls).label} · ${s.label}` : s.kind === 'refused' ? `Refused · ${s.label}` : s.kind === 'setup' ? 'Setup' : 'Result';
            return (
              <button key={i} className={`track-seg${i === segIndex ? ' current' : ''}${s.kind === 'refused' ? ' refused' : ''}`} style={{ flexGrow: s.frames, ['--seg' as any]: color }} title={label} aria-label={label}
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seekTo(s.from + ((e.clientX - r.left) / r.width) * s.frames); ref.current?.play(); }}>
                <span className="track-fill" style={{ width: `${Math.max(0, Math.min(1, fill)) * 100}%` }} />
              </button>
            );
          })}
        </div>
        <span className="transport-pos">{segName}</span>
        <button className="chip-btn" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} title="Playback speed">{speed}x</button>
        {live && (
          <button className={`chip-btn live${following ? ' on' : ''}`} onClick={goLive} title="Jump to the newest call and follow the run">
            <span className="live-dot" />Live
          </button>
        )}
      </div>
    </section>
  );
}
