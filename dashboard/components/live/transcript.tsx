'use client';

import { m, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Avatar } from '@/components/ui';
import { clock, splitFillers } from '@/lib/api/live';
import type { Speaker } from '@/lib/bus/contracts';
import type { TurnView } from '@/lib/bus/reducer';
import { motionPresets } from '@/lib/motion';

const SHOWN = 80;

export interface TranscriptProps {
  turns: TurnView[];
  partial: { speaker: Speaker | null; text: string } | null;
  /** The coach's filler words; the turn's own caught fillers are added. */
  fillers: string[];
}

/** You and them, latest at the bottom. Words still being heard are muted until they settle. */
export function Transcript({ turns, partial, fillers }: TranscriptProps) {
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  const box = useRef<HTMLDivElement>(null);
  const shown = turns.slice(-SHOWN);
  const last = shown.at(-1)?.turn_id;
  const partialText = partial?.text ?? '';

  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [last, partialText, reduced]);

  if (shown.length === 0 && !partial) {
    return <p className="text-body py-2 text-muted">Words appear here as soon as someone speaks.</p>;
  }

  return (
    <div ref={box} className="[scrollbar-width:thin] -mx-2 max-h-[min(56vh,560px)] min-h-[200px] overflow-y-auto px-2" aria-label="Transcript" role="log">
      <ol className="grid gap-4">
        {shown.map((t) => (
          <m.li key={t.turn_id} variants={presets.enter} initial="hidden" animate="shown">
            <Line speaker={t.speaker} time={clock(t.start)}>
              <Words text={t.text} fillers={t.speaker === 'me' ? [...t.fillers, ...fillers] : []} animate={!reduced} />
            </Line>
          </m.li>
        ))}
        {partial && partial.text && (
          <li aria-hidden>
            <Line speaker={partial.speaker ?? 'other'} time="now" pending>
              <span className="text-muted">{partial.text}</span>
              <span className="ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[0.2em] animate-pulse bg-muted" />
            </Line>
          </li>
        )}
      </ol>
    </div>
  );
}

function Line({ speaker, time, pending = false, children }: { speaker: Speaker; time: string; pending?: boolean; children: ReactNode }) {
  const me = speaker === 'me';
  // Words still arriving: who is speaking is not settled yet, so no name or colour is shown.
  if (pending) {
    return (
      <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
        <span className="mt-1 h-8 w-8 rounded-full bg-[var(--surface)] opacity-60" />
        <div className="min-w-0">
          <div className="text-caption text-muted">{time}</div>
          <p className="text-lead mt-0.5 text-pretty text-fg/85">{children}</p>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
      <span><Avatar name={me ? 'You' : 'Them'} tone={me ? 'me' : 'person'} size="sm" /></span>
      <div className="min-w-0">
        <div className="text-caption flex items-baseline gap-2">
          <span className={`font-medium ${me ? 'text-accent' : 'text-person'}`}>{me ? 'You' : 'Them'}</span>
          <span className="tabular text-muted">{time}</span>
        </div>
        <p className={`text-lead mt-0.5 text-pretty ${me ? 'text-fg' : 'text-fg/85'}`}>{children}</p>
      </div>
    </div>
  );
}

/** The turn's words with each filler lit up in the coach's amber, popping in once. */
function Words({ text, fillers, animate }: { text: string; fillers: string[]; animate: boolean }) {
  const parts = splitFillers(text, fillers);
  return (
    <>
      {parts.map((p, i) => (p.filler ? (
        <m.mark key={i} title="Filler word"
          initial={animate ? { opacity: 0.4, scale: 0.85 } : false} animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', duration: 0.4, bounce: 0.4, delay: 0.15 }}
          className="inline-block rounded-[5px] bg-[var(--coach-wash)] px-1 text-coach">
          {p.text}
        </m.mark>
      ) : <span key={i}>{p.text}</span>))}
    </>
  );
}
