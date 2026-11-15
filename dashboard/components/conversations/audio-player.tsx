'use client';

/**
 * The conversation's recording on a plain <audio>: play/pause, a scrubber that shows who spoke
 * when (you in teal, them in the person hue), the current time and the speed. The scrubber is
 * a slider (arrows skip 5 s, Page keys 30 s, Home/End). Seek maths lives in lib/conversations/model.
 */
import { Pause, Play, RotateCcw } from 'lucide-react';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { Button, ICON, SegmentedControl } from '@/components/ui';
import { clampSeek, clockTime, fractionOf, SPEEDS, timeAtPointer, type Speed } from '@/lib/conversations/model';
import type { TranscriptTurn } from '@/lib/conversations/types';

export interface PlayerHandle {
  /** Seek to an audio position (seconds) and start playing. */
  playFrom: (audioTime: number) => void;
}

interface AudioPlayerProps {
  src: string;
  turns: readonly TranscriptTurn[];
  offset: number;
  /** Shown as the total until the file's own duration is known. */
  durationHint: number | null;
  onTime: (audioTime: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  ref?: Ref<PlayerHandle>;
}

const SKIP_S = 5;
const SPEED_OPTIONS = SPEEDS.map((s) => ({ value: String(s), label: `${s}×` }));

interface SegmentsProps {
  turns: readonly TranscriptTurn[];
  offset: number;
  total: number | null;
  className?: string;
  style?: CSSProperties;
}

/** Who spoke when: yours along the top in teal, theirs along the bottom in the person hue. */
function Segments({ turns, offset, total, className, style }: SegmentsProps) {
  if (!total) return null;
  return (
    <span className={`absolute inset-0 ${className ?? ''}`} style={style}>
      {turns.map((t) => {
        const left = fractionOf(t.start + offset, total) * 100;
        const width = Math.max(0.4, fractionOf(t.end + offset, total) * 100 - left);
        return <span key={t.turn_id} className={`absolute h-[7px] rounded-full ${t.speaker === 'me' ? 'top-[2px] bg-accent' : 'bottom-[2px] bg-person'}`}
          style={{ left: `${left}%`, width: `${width}%` }} />;
      })}
    </span>
  );
}

export function AudioPlayer({ src, turns, offset, durationHint, onTime, onPlayingChange, ref }: AudioPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [speed, setSpeed] = useState<Speed>(1);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const total = duration ?? durationHint;

  const report = useCallback((t: number) => { setTime(t); onTime(t); }, [onTime]);

  // Smooth time while playing (timeupdate fires only about four times a second).
  useEffect(() => {
    if (!playing) return;
    let id = 0;
    const tick = () => {
      if (audio.current) report(audio.current.currentTime);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, report]);

  useEffect(() => { onPlayingChange?.(playing); }, [playing, onPlayingChange]);
  useEffect(() => { if (audio.current) audio.current.playbackRate = speed; }, [speed]);

  const seek = useCallback((t: number) => {
    const el = audio.current;
    if (!el) return;
    const to = clampSeek(t, Number.isFinite(el.duration) ? el.duration : total);
    el.currentTime = to;
    report(to);
  }, [report, total]);

  const play = useCallback(() => {
    audio.current?.play().catch(() => { /* blocked or failed; onError shows a failure */ });
  }, []);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) play(); else el.pause();
  }, [play]);

  useImperativeHandle(ref, () => ({ playFrom: (t: number) => { seek(t); play(); } }), [seek, play]);

  function onSliderKey(e: KeyboardEvent<HTMLDivElement>) {
    const now = audio.current?.currentTime ?? 0;
    const moves: Record<string, number | undefined> = {
      ArrowLeft: now - SKIP_S, ArrowDown: now - SKIP_S, ArrowRight: now + SKIP_S, ArrowUp: now + SKIP_S,
      PageDown: now - 30, PageUp: now + 30, Home: 0, End: total ?? now,
    };
    if (e.key === ' ') { e.preventDefault(); toggle(); return; }
    const to = moves[e.key];
    if (to === undefined) return;
    e.preventDefault();
    seek(to);
  }

  function pointerSeek(e: PointerEvent<HTMLDivElement>) {
    const box = track.current?.getBoundingClientRect();
    if (box) seek(timeAtPointer(e.clientX, box.left, box.width, total));
  }

  const frac = fractionOf(time, total);

  if (failed) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body text-muted">The recording didn’t load. The words below are all still here.</p>
        <Button size="small" onClick={() => { setFailed(false); audio.current?.load(); }}>
          <RotateCcw {...ICON} size={16} aria-hidden />Try again
        </Button>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Recording" className="select-none">
      <audio ref={audio} src={src} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; setDuration(Number.isFinite(d) ? d : null); e.currentTarget.playbackRate = speed; }}
        onDurationChange={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuration(d); }}
        onTimeUpdate={(e) => { if (!playing) report(e.currentTarget.currentTime); }}
        onError={() => { setPlaying(false); setFailed(true); }} />

      <div className="flex items-center gap-3 sm:gap-4">
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}
          className="qi-btn shrink-0 !h-12 !w-12 !rounded-full !p-0" data-variant="primary">
          {playing ? <Pause {...ICON} size={20} aria-hidden fill="currentColor" /> : <Play {...ICON} size={20} aria-hidden fill="currentColor" className="translate-x-px" />}
        </button>

        <div className="min-w-0 flex-1">
          <div
            ref={track}
            role="slider" tabIndex={0} aria-label="Position in the recording"
            aria-valuemin={0} aria-valuemax={Math.round(total ?? 0)} aria-valuenow={Math.round(time)}
            aria-valuetext={`${clockTime(time)} of ${total !== null ? clockTime(total) : 'unknown'}`}
            onKeyDown={onSliderKey}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); pointerSeek(e); }}
            onPointerMove={(e) => { if (dragging) pointerSeek(e); }}
            onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}
            className="group relative h-11 cursor-pointer touch-none rounded-control outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {/* who spoke when: thin segments, yours above the middle, theirs below */}
            <span aria-hidden className="absolute inset-x-0 top-1/2 h-[18px] -translate-y-1/2 overflow-hidden rounded-full bg-surface-2">
              <Segments turns={turns} offset={offset} total={total} className="opacity-35" />
              {/* the played part lights up: the same segments at full strength, clipped at the playhead */}
              <Segments turns={turns} offset={offset} total={total} style={{ clipPath: `inset(0 ${(1 - frac) * 100}% 0 0)` }} />
            </span>
            {/* the playhead rides a full-width layer moved by transform, clipped so it never widens the page */}
            <span aria-hidden className="pointer-events-none absolute -inset-x-2 inset-y-0 overflow-hidden">
              <span className="absolute inset-y-0 left-2 right-2" style={{ transform: `translateX(${frac * 100}%)` }}>
                <span className={`absolute -left-[2px] top-1/2 h-7 w-1 -translate-y-1/2 rounded-full bg-fg shadow-[0_0_0_3px_var(--surface)] transition-transform duration-150 ${dragging ? 'scale-y-110' : 'group-hover:scale-y-110'}`} />
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-caption text-muted tabular" aria-hidden>
            <span className="text-fg">{clockTime(time)}</span>
            <span>{total !== null ? clockTime(total) : ''}</span>
          </div>
        </div>

        <div className="hidden shrink-0 sm:block">
          <SegmentedControl label="Playback speed" value={String(speed)} options={SPEED_OPTIONS} onValueChange={(v) => setSpeed(Number(v) as Speed)} />
        </div>
        {/* phones: one button that steps through the speeds */}
        <button type="button" className="qi-btn shrink-0 tabular sm:hidden" data-variant="quiet" data-size="small"
          aria-label={`Playback speed ${speed} times. Change speed`}
          onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}>
          {speed}×
        </button>
      </div>
    </div>
  );
}
