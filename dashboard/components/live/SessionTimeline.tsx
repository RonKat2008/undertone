'use client';

import React, { useState } from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { Glyph, HapticPattern } from '@/components/Glyph';

interface TooltipData {
  xPct: number;
  timeStr: string;
  title: string;
  detail: string;
  tag?: string;
  tagColor?: string;
}

export function SessionTimeline({ className = '' }: { className?: string } = {}) {
  const { state } = useBus();
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);

  const elapsed = state?.elapsedS || 0;

  // Session duration: 0 to current elapsed or standard 90s
  const maxTurnEnd = state?.turns?.reduce((max, t) => Math.max(max, t.end), 0) || 0;
  const maxNudgeTs = state?.nudges?.reduce((max, n) => Math.max(max, n.ts), 0) || 0;
  const totalDuration = Math.max(90, Math.ceil(elapsed), Math.ceil(maxTurnEnd), Math.ceil(maxNudgeTs));

  const timeToPct = (t: number) => {
    if (totalDuration <= 0) return 0;
    return Math.max(0, Math.min(100, (t / totalDuration) * 100));
  };

  const formatTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Find interruptions: from judge verdicts or interrupt nudges
  const interruptions: Array<{ id: string; ts: number; reason: string }> = [];
  if (state?.turns) {
    for (const turn of state.turns) {
      const judge = state.judgeByTurnId?.[turn.turn_id];
      if (judge?.interrupted) {
        const ans = judge.interrupted;
        const isInterrupted =
          (ans.kind === 'choice' && ans.choice === 'true') ||
          (ans.kind === 'noul' && ans.p >= 0.7);

        if (isInterrupted) {
          interruptions.push({
            id: `int-turn-${turn.turn_id}`,
            ts: turn.start,
            reason: 'Cut off speaker',
          });
        }
      }
    }
  }
  if (state?.nudges) {
    for (const nudge of state.nudges) {
      if (nudge.haptic === 'interrupt') {
        const exists = interruptions.some((i) => Math.abs(i.ts - nudge.ts) < 1.5);
        if (!exists) {
          interruptions.push({
            id: `int-nudge-${nudge.ts}`,
            ts: nudge.ts,
            reason: nudge.reason || 'Interruption',
          });
        }
      }
    }
  }

  // Ticks for time scale ruler: 0, 15, 30, 45, 60, 75, 90 (or extended if >90s)
  const rulerTicks: number[] = [];
  const step = totalDuration <= 90 ? 15 : totalDuration <= 180 ? 30 : 60;
  for (let s = 0; s <= totalDuration; s += step) {
    rulerTicks.push(s);
  }

  const isLive = state?.sessionStatus === 'active';
  const playheadPct = timeToPct(elapsed);

  return (
    <section 
      aria-label="Session timeline"
      className={`w-full bg-paper border-b border-hairline py-3 px-4 sm:px-6 select-none ${className}`}
    >
      {/* Timeline header: label and time status */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs uppercase tracking-widest text-ink-mid">
            Timeline
          </span>
          {isLive && (
            <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-ink">
              <span className="w-1.5 h-1.5 rounded-full bg-ink animate-pulse" aria-hidden="true" />
              <span>LIVE</span>
            </span>
          )}
        </div>
        <div className="font-mono text-xs tabular-nums text-ink-mid">
          <span className="text-ink font-medium">{formatTime(elapsed)}</span>
          <span className="mx-1 text-hairline">/</span>
          <span>{formatTime(totalDuration)}</span>
        </div>
      </div>

      {/* Main timeline interactive container */}
      <div className="relative w-full pt-1 pb-1">
        {/* Floating Tooltip */}
        {tooltip && (
          <div
            role="status"
            aria-live="polite"
            className="absolute -top-14 z-30 pointer-events-none transition-opacity duration-150"
            style={{
              left: `${Math.max(12, Math.min(88, tooltip.xPct))}%`,
              transform: 'translateX(-50%)',
            }}
          >
            <div className="bg-paper border border-hairline px-2.5 py-1.5 text-xs text-ink shadow-xs max-w-xs whitespace-nowrap">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="font-mono text-[10px] tabular-nums text-ink-mid">
                  {tooltip.timeStr}
                </span>
                {tooltip.tag && (
                  <span
                    className="font-mono text-[9px] uppercase px-1 py-0.2 border border-hairline"
                    style={{ color: tooltip.tagColor || 'inherit' }}
                  >
                    {tooltip.tag}
                  </span>
                )}
                <span className="font-medium text-ink text-xs">{tooltip.title}</span>
              </div>
              <p className="text-[11px] text-ink-mid leading-tight max-w-[220px] truncate">
                {tooltip.detail}
              </p>
            </div>
          </div>
        )}

        {/* Nudge & Marker Strip (Glyphs, Bookmarks, Signals) */}
        <div className="relative w-full h-5 mb-1.5">
          {/* Nudge Glyphs */}
          {state?.nudges?.map((nudge, idx) => {
            const xPct = timeToPct(nudge.ts);
            return (
              <button
                key={`nudge-${idx}`}
                type="button"
                className="absolute -translate-x-1/2 top-0 p-0.5 transition-transform hover:scale-125 focus:scale-125 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink z-10"
                style={{ left: `${xPct}%` }}
                onMouseEnter={() =>
                  setTooltip({
                    xPct,
                    timeStr: formatTime(nudge.ts),
                    title: nudge.message,
                    detail: `${nudge.reason} · Pattern: ${nudge.haptic}`,
                    tag: 'Nudge',
                    tagColor: 'var(--ink)',
                  })
                }
                onMouseLeave={() => setTooltip(null)}
                onFocus={() =>
                  setTooltip({
                    xPct,
                    timeStr: formatTime(nudge.ts),
                    title: nudge.message,
                    detail: `${nudge.reason} · Pattern: ${nudge.haptic}`,
                    tag: 'Nudge',
                    tagColor: 'var(--ink)',
                  })
                }
                onBlur={() => setTooltip(null)}
                aria-label={`Nudge: ${nudge.message} at ${formatTime(nudge.ts)}`}
              >
                <Glyph pattern={nudge.haptic as HapticPattern} size="xs" />
              </button>
            );
          })}

          {/* Bookmarks */}
          {state?.bookmarks?.map((bm, idx) => {
            const xPct = timeToPct(bm.ts);
            const isPromise = bm.source === 'promise';
            return (
              <button
                key={`bm-${idx}`}
                type="button"
                className="absolute -translate-x-1/2 top-0.5 text-ink hover:scale-125 focus:scale-125 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink z-10"
                style={{ left: `${xPct}%` }}
                onMouseEnter={() =>
                  setTooltip({
                    xPct,
                    timeStr: formatTime(bm.ts),
                    title: isPromise ? 'Promise Detected' : 'Bookmark',
                    detail: bm.text || 'Marked moment',
                    tag: isPromise ? 'Promise' : 'Bookmark',
                    tagColor: 'var(--ink)',
                  })
                }
                onMouseLeave={() => setTooltip(null)}
                onFocus={() =>
                  setTooltip({
                    xPct,
                    timeStr: formatTime(bm.ts),
                    title: isPromise ? 'Promise Detected' : 'Bookmark',
                    detail: bm.text || 'Marked moment',
                    tag: isPromise ? 'Promise' : 'Bookmark',
                    tagColor: 'var(--ink)',
                  })
                }
                onBlur={() => setTooltip(null)}
                aria-label={`Bookmark: ${bm.text || 'Flagged moment'} at ${formatTime(bm.ts)}`}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M3.5 2v12l4.5-3 4.5 3V2H3.5z" />
                </svg>
              </button>
            );
          })}

          {/* Signal marks (nerves / checked_out) */}
          {state?.signals?.map((sig, idx) => {
            const xPct = timeToPct(sig.ts);
            const isNerves = sig.kind === 'nerves';
            return (
              <button
                key={`sig-${idx}`}
                type="button"
                className="absolute -translate-x-1/2 top-1 hover:scale-125 focus:scale-125 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink z-10"
                style={{ left: `${xPct}%` }}
                onMouseEnter={() =>
                  setTooltip({
                    xPct,
                    timeStr: formatTime(sig.ts),
                    title: isNerves ? 'Signal: Nerves' : 'Signal: Checked Out',
                    detail: sig.detail,
                    tag: 'Signal',
                    tagColor: isNerves ? 'var(--p-still)' : 'var(--ink-mid)',
                  })
                }
                onMouseLeave={() => setTooltip(null)}
                onFocus={() =>
                  setTooltip({
                    xPct,
                    timeStr: formatTime(sig.ts),
                    title: isNerves ? 'Signal: Nerves' : 'Signal: Checked Out',
                    detail: sig.detail,
                    tag: 'Signal',
                    tagColor: isNerves ? 'var(--p-still)' : 'var(--ink-mid)',
                  })
                }
                onBlur={() => setTooltip(null)}
                aria-label={`Signal ${sig.kind}: ${sig.detail} at ${formatTime(sig.ts)}`}
              >
                <div
                  className={`w-3 h-3 rounded-full border flex items-center justify-center bg-paper ${
                    isNerves ? 'border-p-still' : 'border-ink-mid'
                  }`}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${
                      isNerves ? 'bg-p-still' : 'bg-ink-mid'
                    }`}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Turn Strip (Thin horizontal strip representing the whole session) */}
        <div className="relative w-full h-4 sm:h-5 bg-paper-well border border-hairline overflow-hidden">
          {/* Turn blocks colored by speaker: ink for me, other for them */}
          {state?.turns?.map((turn) => {
            const leftPct = timeToPct(turn.start);
            const rightPct = timeToPct(turn.end);
            const widthPct = Math.max(0.6, rightPct - leftPct);
            const isMe = turn.speaker === 'me';

            return (
              <button
                key={turn.turn_id}
                type="button"
                tabIndex={0}
                className={`absolute top-0 bottom-0 transition-opacity hover:opacity-85 focus:opacity-85 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink ${
                  isMe ? 'bg-ink' : 'bg-other'
                }`}
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                }}
                onMouseEnter={() =>
                  setTooltip({
                    xPct: leftPct + widthPct / 2,
                    timeStr: `${formatTime(turn.start)}–${formatTime(turn.end)}`,
                    title: isMe ? 'Wearer (me)' : 'Other speaker',
                    detail: turn.text,
                    tag: `${Math.round(turn.wpm)} WPM`,
                    tagColor: isMe ? 'var(--ink)' : 'var(--ink-mid)',
                  })
                }
                onMouseLeave={() => setTooltip(null)}
                onFocus={() =>
                  setTooltip({
                    xPct: leftPct + widthPct / 2,
                    timeStr: `${formatTime(turn.start)}–${formatTime(turn.end)}`,
                    title: isMe ? 'Wearer (me)' : 'Other speaker',
                    detail: turn.text,
                    tag: `${Math.round(turn.wpm)} WPM`,
                    tagColor: isMe ? 'var(--ink)' : 'var(--ink-mid)',
                  })
                }
                onBlur={() => setTooltip(null)}
                aria-label={`Turn by ${isMe ? 'me' : 'other'} from ${formatTime(turn.start)} to ${formatTime(turn.end)}: ${turn.text}`}
              />
            );
          })}

          {/* Interruption Ticks */}
          {interruptions.map((inter) => {
            const xPct = timeToPct(inter.ts);
            return (
              <button
                key={inter.id}
                type="button"
                tabIndex={0}
                className="absolute top-0 bottom-0 w-[2px] bg-p-interrupt hover:w-[3px] focus:w-[3px] -translate-x-1/2 z-20 cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-p-interrupt"
                style={{ left: `${xPct}%` }}
                onMouseEnter={() =>
                  setTooltip({
                    xPct,
                    timeStr: formatTime(inter.ts),
                    title: 'Interruption',
                    detail: inter.reason,
                    tag: 'Cut Off',
                    tagColor: 'var(--p-interrupt)',
                  })
                }
                onMouseLeave={() => setTooltip(null)}
                onFocus={() =>
                  setTooltip({
                    xPct,
                    timeStr: formatTime(inter.ts),
                    title: 'Interruption',
                    detail: inter.reason,
                    tag: 'Cut Off',
                    tagColor: 'var(--p-interrupt)',
                  })
                }
                onBlur={() => setTooltip(null)}
                aria-label={`Interruption tick at ${formatTime(inter.ts)}: ${inter.reason}`}
              >
                {/* Visual pip above track */}
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-p-interrupt rotate-45 pointer-events-none" />
              </button>
            );
          })}

          {/* Live playhead line */}
          {isLive && elapsed > 0 && (
            <div
              className="absolute top-0 bottom-0 w-[1px] bg-ink pointer-events-none z-10 transition-[left] duration-300 ease-linear"
              style={{ left: `${playheadPct}%` }}
              aria-hidden="true"
            >
              <div className="w-1.5 h-1.5 bg-ink -translate-x-1/2 -translate-y-1/2 rounded-full" />
            </div>
          )}
        </div>

        {/* Time scale ruler ticks beneath the strip */}
        <div className="relative w-full h-4 mt-1 border-t border-hairline font-mono text-[9px] tabular-nums text-ink-mid">
          {rulerTicks.map((tickSec) => {
            const xPct = timeToPct(tickSec);
            return (
              <div
                key={`tick-${tickSec}`}
                className="absolute -top-1 -translate-x-1/2 flex flex-col items-center pointer-events-none"
                style={{ left: `${xPct}%` }}
                aria-hidden="true"
              >
                <div className="w-[1px] h-1 bg-hairline" />
                <span className="mt-0.5">{formatTime(tickSec)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
