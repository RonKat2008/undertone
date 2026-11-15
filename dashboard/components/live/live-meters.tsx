'use client';

import { m, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { PaceBar, ShareBar } from '@/components/ui';
import { shareWords, type HandsWord, type Pace } from '@/lib/api/live';

export interface LiveMetersProps {
  pace: Pace;
  share: number | null;
  hands: HandsWord | null;
}

/** Pace, talk share and hands: small, side by side, all in words with one visual each. */
export function LiveMeters({ pace, share, hands }: LiveMetersProps) {
  return (
    <div className="grid gap-x-8 gap-y-6 sm:grid-cols-3">
      <Meter title="Your pace" note={pace.wpm !== null ? `${Math.round(pace.wpm)} words a minute` : 'Waiting for you to speak'}>
        <PaceBar value={pace.wpm ?? pace.baseline} min={pace.min} max={pace.max} zone={pace.zone} label={pace.label} />
        {pace.learning && pace.wpm !== null ? <p className="text-caption mt-1 text-muted">Still learning your usual pace</p> : null}
      </Meter>
      <Meter title="Talk share" note={shareWords(share)}>
        <ShareBar share={share ?? 0.5} label={shareWords(share)} />
      </Meter>
      <Meter title="Hands" note={hands ? `Hands: ${hands}` : 'No movement yet'}>
        <HandsMark hands={hands} />
      </Meter>
    </div>
  );
}

function Meter({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-body font-medium text-fg">{title}</span>
        <span className="text-caption tabular truncate text-muted">{note}</span>
      </div>
      {children}
    </div>
  );
}

const DOTS = 5;

/** Five dots that sit still, sway, or jitter, in the hands colour. */
function HandsMark({ hands }: { hands: HandsWord | null }) {
  const reduced = useReducedMotion() ?? false;
  const word = hands ?? 'still';
  return (
    <div className="flex h-10 items-center gap-2.5" aria-hidden>
      {Array.from({ length: DOTS }, (_, i) => {
        const anim = reduced || word === 'still'
          ? { y: 0, x: 0 }
          : word === 'moving'
            ? { y: [0, -5, 0, 4, 0] }
            : { x: [0, -2, 2, -1, 1, 0], y: [0, 2, -2, 1, -1, 0] };
        const duration = word === 'moving' ? 1.6 : 0.45;
        return (
          <m.span key={i} className={`size-2.5 rounded-full ${hands ? 'bg-conversation' : 'bg-line-strong'}`}
            animate={anim}
            transition={word === 'still' || reduced ? { duration: 0.2 } : { duration, repeat: Infinity, ease: 'easeInOut', delay: i * (word === 'moving' ? 0.12 : 0.05) }} />
        );
      })}
    </div>
  );
}
