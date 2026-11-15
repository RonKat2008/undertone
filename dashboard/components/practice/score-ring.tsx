'use client';

import NumberFlow from '@number-flow/react';
import { animate, createScope, type Scope } from 'animejs';
import { useEffect, useId, useRef, useState } from 'react';
import { DURATION_MS, prefersReducedMotion } from '@/lib/motion';
import { clampScore, scoreWords } from '@/lib/practice/model';

export interface ScoreRingProps {
  score: number;
  size?: 'lg' | 'sm';
}

const R = 52;

/** The overall score: a lit ring (teal into amber) that fills to the score while the number counts up. */
export function ScoreRing({ score, size = 'lg' }: ScoreRingProps) {
  const value = Math.round(clampScore(score));
  const [shown, setShown] = useState(0);
  const arc = useRef<SVGCircleElement>(null);
  const scope = useRef<Scope | null>(null);
  const gradId = `pr-ring-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    setShown(value);
    const el = arc.current;
    if (!el || prefersReducedMotion()) return;
    scope.current = createScope({ root: el.parentElement ?? undefined }).add(() => {
      animate(el, { strokeDashoffset: [100, 100 - value], duration: DURATION_MS.slow * 4, ease: 'outQuart' });
    });
    return () => scope.current?.revert();
  }, [value]);

  return (
    <div className="pr-ring" data-size={size} role="img" aria-label={`Overall score ${value} out of 100: ${scoreWords(value)}`}>
      <svg viewBox="0 0 120 120" aria-hidden>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--coach)" />
          </linearGradient>
        </defs>
        <circle className="pr-ring-track" cx="60" cy="60" r={R} pathLength={100} />
        <circle ref={arc} className="pr-ring-arc" cx="60" cy="60" r={R} pathLength={100}
          stroke={`url(#${gradId})`} strokeDasharray="100 100" strokeDashoffset={100 - value} />
      </svg>
      <div className="pr-ring-center" aria-hidden>
        <span className="pr-ring-num tabular">
          <NumberFlow value={shown} respectMotionPreference willChange={false} />
        </span>
        {size === 'lg' ? <span className="pr-ring-word">{scoreWords(value)}</span> : null}
      </div>
    </div>
  );
}
