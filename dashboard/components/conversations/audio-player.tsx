'use client';

/**
 * The conversation's recording, on a plain <audio> element: play/pause, a scrubber that also
 * draws who spoke when, elapsed/total, and 1x/1.5x/2x. Keyboard: space toggles and ← → skip
 * 5 s from anywhere on the page that is not a field or a button; the scrubber is a slider.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
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

/** Space and arrows belong to these when they have focus. */
const OWN_KEYS_SPACE = 'button, a, input, textarea, select, [contenteditable="true"], [role="slider"]';
const OWN_KEYS_ARROWS = 'input, textarea, select, [contenteditable="true"], [role="slider"], [role="radiogroup"]';

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

  // Smooth time while playing (timeupdate only fires about four times a second).
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
    const el = audio.current;
    if (!el) return;
    el.play().catch(() => { /* blocked or failed; onError shows the failure */ });
  }, []);

  const toggle = useCallback(() => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) play(); else el.pause();
  }, [play]);

  useImperativeHandle(ref, () => ({ playFrom: (t: number) => { seek(t); play(); } }), [seek, play]);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || failed) return;
      const el = e.target instanceof Element ? e.target : null;
      if (e.key === ' ' && !el?.closest(OWN_KEYS_SPACE)) {
        e.preventDefault();
        toggle();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !el?.closest(OWN_KEYS_ARROWS)) {
        e.preventDefault();
        seek((audio.current?.currentTime ?? 0) + (e.key === 'ArrowLeft' ? -SKIP_S : SKIP_S));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle, seek, failed]);

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
      <div role="alert" className="border-l-[3px] border-vermilion py-1 pl-3">
        <div className="caps !text-vermilion">Recording</div>
        <p className="mt-1 text-[13px] text-ink-2">The recording could not be loaded. The transcript below is still complete.</p>
        <button type="button" className="btn btn-sm mt-2" onClick={() => { setFailed(false); audio.current?.load(); }}>Try again</button>
      </div>
    );
  }

  return (
    <section aria-label="Recording" className="select-none">
      <audio ref={audio} src={src} preload="metadata"
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={(e) => { const d = e.currentTarget.duration; setDuration(Number.isFinite(d) ? d : null); e.currentTarget.playbackRate = speed; }}
        onDurationChange={(e) => { const d = e.currentTarget.duration; if (Number.isFinite(d)) setDuration(d); }}
        onTimeUpdate={(e) => { if (!playing) report(e.currentTarget.currentTime); }}
        onError={() => { setPlaying(false); setFailed(true); }} />

      <div className="flex items-center gap-4">
        <button type="button" onClick={toggle} aria-label={playing ? 'Pause the recording' : 'Play the recording'} aria-keyshortcuts="Space"
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-transform hover:scale-105 active:scale-95">
          {playing
            ? <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><rect x="2" width="3.5" height="14" fill="currentColor" /><rect x="8.5" width="3.5" height="14" fill="currentColor" /></svg>
            : <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><path d="M2.5 0l11 7-11 7z" fill="currentColor" /></svg>}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="num text-[22px] leading-none" aria-hidden>{clockTime(time)}</span>
            <span className="num text-[12px] text-ink-3" aria-hidden>{total !== null ? clockTime(total) : '–:––'}</span>
          </div>
          <div
            ref={track}
            role="slider" tabIndex={0} aria-label="Position in the recording"
            aria-valuemin={0} aria-valuemax={Math.round(total ?? 0)} aria-valuenow={Math.round(time)}
            aria-valuetext={`${clockTime(time)} of ${total !== null ? clockTime(total) : 'unknown'}`}
            onKeyDown={onSliderKey}
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); pointerSeek(e); }}
            onPointerMove={(e) => { if (dragging) pointerSeek(e); }}
            onPointerUp={() => setDragging(false)} onPointerCancel={() => setDragging(false)}
            className="group relative mt-2 h-7 cursor-pointer touch-none outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {/* who spoke when: yours above the line, theirs below */}
            {total ? turns.map((t) => {
              const left = fractionOf(t.start + offset, total) * 100;
              const width = Math.max(0.25, (fractionOf(t.end + offset, total) * 100) - left);
              return <span key={t.turn_id} aria-hidden className={`absolute h-[5px] ${t.speaker === 'me' ? 'top-[7px] bg-ink-2' : 'top-[15px] bg-them'}`} style={{ left: `${left}%`, width: `${width}%` }} />;
            }) : null}
            <span aria-hidden className="absolute inset-x-0 top-[13px] h-px bg-rule" />
            <span aria-hidden className="absolute inset-x-0 top-[12.5px] h-[2px] origin-left bg-ink" style={{ transform: `scaleX(${frac})` }} />
            {/* The playhead rides a full-width layer moved by transform; the clip keeps that layer from widening the page. */}
            <span aria-hidden className="pointer-events-none absolute -inset-x-1 inset-y-0 overflow-hidden">
              <span className="absolute inset-y-0 left-1 right-1" style={{ transform: `translateX(${frac * 100}%)` }}>
                <span className={`absolute -left-px top-[3px] h-[22px] w-[2px] bg-ink transition-transform group-hover:scale-y-110 ${dragging ? 'scale-y-125' : ''}`} />
              </span>
            </span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="group" aria-label="Playback speed" className="flex">
          {SPEEDS.map((s, i) => (
            <button key={s} type="button" aria-pressed={speed === s} onClick={() => setSpeed(s)}
              className={`btn btn-sm num ${i > 0 ? '-ml-px' : ''} ${i === 0 ? 'rounded-r-none' : i === SPEEDS.length - 1 ? 'rounded-l-none' : 'rounded-none'} ${speed === s ? 'btn-solid' : 'btn-quiet'}`}>
              {s}×
            </button>
          ))}
        </div>
        <span className="flex items-center gap-3 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5"><span className="inline-block h-[5px] w-3 bg-ink-2" aria-hidden />You</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-[5px] w-3 bg-them" aria-hidden />Them</span>
        </span>
      </div>
      <p className="caps mt-2 !text-ink-3">
        Space plays or pauses · ← → skip 5 s
      </p>
    </section>
  );
}
