'use client';

import { animate, createScope, type Scope } from 'animejs';
import { useEffect, useRef } from 'react';
import type { HapticPattern } from '@/lib/bus/contracts';
import { PATTERNS, type Pulse } from '@/lib/bus/patterns';
import { prefersReducedMotion } from '@/lib/motion';

export interface PatternMarkProps {
  pattern: HapticPattern;
  /** Show the plain-words name after the mark ("Slow down"). On by default: the words carry the meaning. */
  withLabel?: boolean;
  /** Mark height in px; dashes scale with it. 12 sits in a line of text. */
  size?: number;
  /** Change this value to replay the buzz at its real timing (e.g. the nudge id). Undefined: static. */
  playKey?: string | number;
  className?: string;
}

/** px of mark per ms of buzz, at size 12 */
const PX_PER_MS = 0.06;
const SHORT_MS = 150;
const MIN_GAP = 3;

interface Dash { x: number; w: number; t: number; pulse: Pulse }

function layout(pulses: Pulse[], scale: number): { dashes: Dash[]; width: number } {
  const dashes: Dash[] = [];
  let end = 0;
  for (const p of pulses) {
    const w = (p.dur < SHORT_MS && !p.shape ? 6 : Math.max(12, p.dur * PX_PER_MS)) * scale;
    const x = dashes.length === 0 ? 0 : Math.max(p.at * PX_PER_MS * scale, end + MIN_GAP * scale);
    const t = (p.level >= 0.9 ? 3 : 2) * scale;
    dashes.push({ x, w, t, pulse: p });
    end = x + w;
  }
  return { dashes, width: Math.ceil(end) };
}

/**
 * A haptic pattern drawn as short and long dashes: a short dash is a tap, a long dash a held
 * buzz, a thicker dash a harder one, a widening wedge a ramp. Not notation, not a rhythm; a
 * reminder of the feel next to its plain name. Colour follows the text (give it the accent
 * class only where the buzz is "your moment").
 */
export function PatternMark({ pattern, withLabel = true, size = 12, playKey, className }: PatternMarkProps) {
  const spec = PATTERNS[pattern];
  const scale = size / 12;
  const { dashes, width } = layout(spec.pulses, scale);
  const mid = size / 2;
  const root = useRef<SVGSVGElement>(null);
  const scope = useRef<Scope | null>(null);

  useEffect(() => {
    if (playKey === undefined || !root.current || prefersReducedMotion()) return;
    scope.current = createScope({ root: root.current }).add(() => {
      dashes.forEach((d, i) => {
        animate(`[data-dash="${i}"]`, {
          scaleX: [0, 1],
          duration: Math.max(d.pulse.dur, 80),
          delay: d.pulse.at,
          ease: 'linear',
        });
      });
    });
    return () => scope.current?.revert();
    // dashes derive from `pattern`; replay only when the key or the pattern changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, pattern]);

  return (
    <span className={`qi-pattern ${className ?? ''}`}>
      <svg ref={root} width={width} height={size} viewBox={`0 0 ${width} ${size}`} aria-hidden={withLabel || undefined}
        role={withLabel ? undefined : 'img'} aria-label={withLabel ? undefined : spec.action}>
        {dashes.map((d, i) => {
          const style = { transformBox: 'fill-box', transformOrigin: 'left center' } as const;
          if (d.pulse.shape === 'ramp') {
            const half = 2.5 * scale;
            return <polygon key={i} data-dash={i} style={style} fill="currentColor"
              points={`${d.x},${mid - 0.5 * scale} ${d.x + d.w},${mid - half} ${d.x + d.w},${mid + half} ${d.x},${mid + 0.5 * scale}`} />;
          }
          return <rect key={i} data-dash={i} style={style} x={d.x} y={mid - d.t / 2} width={d.w} height={d.t} rx={d.t / 2}
            fill="currentColor" opacity={d.pulse.shape === 'soft' ? 0.6 : 1} />;
        })}
      </svg>
      {withLabel ? <span className="qi-pattern-label">{spec.action}</span> : null}
    </span>
  );
}
