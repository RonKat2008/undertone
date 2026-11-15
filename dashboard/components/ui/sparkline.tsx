'use client';

import { animate, createScope, svg, type Scope } from 'animejs';
import { useEffect, useId, useRef } from 'react';
import { DURATION_MS, prefersReducedMotion } from '@/lib/motion';
import type { Kind } from './kind';

export interface SparklineProps {
  /** Oldest first. Two or more points; fewer renders nothing. */
  values: number[];
  /** The trend in words for screen readers: "Fewer filler words over the last two weeks". */
  label: string;
  /** accent (default), coach, or a kind hue (e.g. 'habit' for a habit's trend). */
  tone?: 'accent' | 'coach' | Kind;
  width?: number;
  height?: number;
  /** Fix the vertical range; defaults to the data's own range. */
  domain?: [number, number];
  /** Draw the line in on mount (default on; off under reduced motion). */
  draw?: boolean;
}

const PAD = 2;

function colorOf(tone: SparklineProps['tone']): string {
  if (tone === 'accent' || tone === undefined) return 'var(--accent)';
  if (tone === 'coach') return 'var(--coach)';
  return `var(--kind-${tone})`;
}

/** A word-sized trend: one coloured line over a soft fill. No axes, no dots, no numbers. */
export function Sparkline({ values, label, tone = 'accent', width = 64, height = 20, domain, draw = true }: SparklineProps) {
  const lineRef = useRef<SVGPolylineElement>(null);
  const scope = useRef<Scope | null>(null);
  const fillId = useId().replace(/:/g, '');

  useEffect(() => {
    if (!draw || !lineRef.current || prefersReducedMotion()) return;
    const el = lineRef.current;
    scope.current = createScope({ root: el.parentElement ?? undefined }).add(() => {
      animate(svg.createDrawable(el), { draw: ['0 0', '0 1'], duration: DURATION_MS.slow * 2, ease: 'outQuad' });
    });
    return () => scope.current?.revert();
  }, [draw]);

  if (values.length < 2) return null;
  const [lo, hi] = domain ?? [Math.min(...values), Math.max(...values)];
  const span = hi - lo || 1;
  const step = (width - PAD * 2) / (values.length - 1);
  const pts = values.map((v, i) => {
    const x = PAD + i * step;
    const y = PAD + (1 - (Math.min(Math.max(v, lo), hi) - lo) / span) * (height - PAD * 2);
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `M${pts[0][0]},${height} L${line.replace(/ /g, ' L')} L${pts[pts.length - 1][0]},${height} Z`;
  const color = colorOf(tone);
  return (
    <svg className="qi-sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ color }}>
      <defs>
        <linearGradient id={fillId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${fillId})`} />
      <polyline ref={lineRef} points={line} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
