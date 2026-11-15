'use client';

/**
 * The words, as a script. A name and a time appear only when the speaker changes (or after a
 * long pause), filler words are quietly marked, and the moments the coach pointed at are
 * underlined in teal with the reason on hover or focus. With a recording, clicking a turn plays
 * from there; the playing turn is lit and kept in view, unless the reader is scrolling by hand.
 * Speech is untrusted text and is only ever rendered as text.
 */
import { Play } from 'lucide-react';
import { m } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { ICON, Tooltip } from '@/components/ui';
import { fillersFor, outOfView, shouldFollow, transcriptRows, turnPieces, type FlaggedMoment } from '@/lib/conversations/display';
import { clockTime } from '@/lib/conversations/model';
import type { TranscriptTurn } from '@/lib/conversations/types';
import { useReducedMotion } from '@/lib/use-reduced-motion';

interface TranscriptProps {
  turns: readonly TranscriptTurn[];
  /** The other person's name, or null for "Them". */
  other: string | null;
  flags: readonly FlaggedMoment[];
  /** Index of the turn being played; -1 for none. */
  active: number;
  playing: boolean;
  /** Present only when there is a recording to play. */
  onSeek?: (turn: TranscriptTurn) => void;
}

/** Room kept clear above (the shell) and below (the docked player) when following playback. */
const FOLLOW_TOP_PX = 96;
const FOLLOW_BOTTOM_PX = 168;
const HAND_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End']);

export function Transcript({ turns, other, flags, active, playing, onSeek }: TranscriptProps) {
  const reduced = useReducedMotion();
  const list = useRef<HTMLOListElement>(null);
  const lastHandScroll = useRef(0);
  const rows = transcriptRows(turns);
  const flagAt = new Map(flags.map((f) => [f.turnIndex, f]));
  const them = other ?? 'Them';

  // The reader scrolling by hand wins over following playback for a few seconds.
  useEffect(() => {
    const mark = () => { lastHandScroll.current = Date.now(); };
    const onKey = (e: KeyboardEvent) => { if (HAND_KEYS.has(e.key) && !(e.target instanceof Element && e.target.closest('[role="slider"]'))) mark(); };
    window.addEventListener('wheel', mark, { passive: true });
    window.addEventListener('touchmove', mark, { passive: true });
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('wheel', mark);
      window.removeEventListener('touchmove', mark);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    if (!playing || active < 0 || !shouldFollow(lastHandScroll.current, Date.now())) return;
    const el = list.current?.querySelector<HTMLElement>(`[data-turn="${active}"]`);
    if (!el || !outOfView(el.getBoundingClientRect(), FOLLOW_TOP_PX, window.innerHeight - FOLLOW_BOTTOM_PX)) return;
    el.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  }, [active, playing, reduced]);

  return (
    <ol ref={list} className="grid">
      {rows.map(({ turn, index, newSpeaker, showTime }) => {
        const me = turn.speaker === 'me';
        const flag = flagAt.get(index) ?? null;
        const isActive = index === active;
        return (
          <li key={turn.turn_id} data-turn={index}
            className={`group relative grid grid-cols-[32px_minmax(0,1fr)] rounded-[12px] py-1.5 pr-3 ${newSpeaker && index > 0 ? 'mt-4' : ''} ${onSeek ? 'cursor-pointer' : ''}`}
            onClick={onSeek ? (e) => { if (!(e.target instanceof Element && e.target.closest('button'))) onSeek(turn); } : undefined}>
            {isActive ? <m.span layoutId="playing-turn" aria-hidden className="absolute inset-0 rounded-[12px] bg-[var(--accent-wash)]" transition={{ type: 'spring', duration: 0.38, bounce: 0.12 }} /> : null}
            {onSeek && !isActive ? <span aria-hidden className="absolute inset-0 rounded-[12px] opacity-0 transition-opacity duration-150 [@media(hover:hover)]:group-hover:bg-[var(--hover)] [@media(hover:hover)]:group-hover:opacity-100" /> : null}
            <span className="relative col-start-1 flex justify-center pt-0.5">
              {onSeek ? (
                <button type="button" onClick={() => onSeek(turn)} aria-label={`Play from ${clockTime(turn.start)}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={`grid h-7 w-7 place-items-center rounded-full transition-opacity duration-150 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-accent ${isActive ? 'text-accent opacity-100' : 'text-muted opacity-0 group-hover:opacity-100'}`}>
                  <Play {...ICON} size={14} fill="currentColor" aria-hidden />
                </button>
              ) : null}
            </span>
            <div className="relative col-start-2 min-w-0">
              {newSpeaker || showTime ? (
                <p className="mb-0.5 flex items-baseline gap-2 text-caption">
                  {newSpeaker ? <span className={`font-medium ${me ? 'text-accent' : 'text-person'}`}>{me ? 'You' : them}</span> : null}
                  {showTime ? <time className="tabular text-muted">{clockTime(turn.start)}</time> : null}
                </p>
              ) : null}
              <p className={`max-w-[66ch] text-[16px] leading-[26px] ${me ? 'text-fg' : 'text-[color-mix(in_oklch,var(--text)_86%,var(--muted))]'}`}>
                <TurnText turn={turn} flag={flag} />
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TurnText({ turn, flag }: { turn: TranscriptTurn; flag: FlaggedMoment | null }) {
  const pieces = turnPieces(turn.text, fillersFor(turn), flag?.phrase ?? null);
  const nodes: ReactNode[] = [];
  let flagged: ReactNode[] = [];
  const flush = (key: number) => {
    if (flagged.length === 0 || !flag) return;
    nodes.push(<Flagged key={`f${key}`} why={flag.why}>{flagged}</Flagged>);
    flagged = [];
  };
  pieces.forEach((p, i) => {
    const node = p.filler ? <span key={i} className="text-muted decoration-[var(--line-strong)] decoration-dotted underline-offset-4 [text-decoration-line:underline]">{p.text}</span> : <span key={i}>{p.text}</span>;
    if (p.flagged) flagged.push(node);
    else { flush(i); nodes.push(node); }
  });
  flush(pieces.length);
  // The coach flagged this turn but the exact words were not found: mark the whole turn.
  if (flag && !flag.phrase) return <Flagged why={flag.why}>{nodes}</Flagged>;
  return <>{nodes}</>;
}

function Flagged({ why, children }: { why: string; children: ReactNode }) {
  return (
    <Tooltip content={why}>
      <span tabIndex={0} className="rounded-[3px] underline decoration-accent decoration-2 underline-offset-[5px] outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        {children}
        <span className="sr-only"> (Your coach: {why})</span>
      </span>
    </Tooltip>
  );
}
