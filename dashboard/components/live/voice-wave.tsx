'use client';

import { animate, createScope, stagger, utils, type Scope } from 'animejs';
import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

export type Voice = 'me' | 'them' | 'quiet' | 'idle';

export interface VoiceWaveProps {
  /** Who is speaking right now. Drives the colour and how much the bars move. */
  voice: Voice;
  /** Bars across; the wave is drawn symmetric around the middle. */
  bars?: number;
  className?: string;
}

const HEIGHT = 96;
const BAR_W = 6;
const GAP = 6;

/** How tall the bars may get and how quickly they move, by voice. */
const LIVELINESS: Record<Voice, { lo: number; hi: number; ms: [number, number] }> = {
  me: { lo: 0.18, hi: 1, ms: [180, 320] },
  them: { lo: 0.14, hi: 0.8, ms: [220, 380] },
  quiet: { lo: 0.06, hi: 0.2, ms: [900, 1400] },
  idle: { lo: 0.05, hi: 0.12, ms: [1400, 2000] },
};

const COLOUR: Record<Voice, string> = {
  me: 'text-accent',
  them: 'text-person',
  quiet: 'text-muted',
  idle: 'text-muted',
};

/**
 * A living voice visual: rounded bars that dance while someone speaks (teal for you, coral for
 * them) and settle into a slow breath when nobody does. anime.js drives the bars on a ref;
 * under reduced motion they hold a still shape.
 */
export function VoiceWave({ voice, bars = 29, className }: VoiceWaveProps) {
  const root = useRef<SVGSVGElement>(null);
  const scope = useRef<Scope | null>(null);
  const width = bars * BAR_W + (bars - 1) * GAP;
  const mid = (bars - 1) / 2;

  useEffect(() => {
    if (!root.current || prefersReducedMotion()) return;
    const { lo, hi, ms } = LIVELINESS[voice];
    scope.current = createScope({ root: root.current }).add(() => {
      animate('[data-bar]', {
        // bars near the middle reach higher, so the wave reads as a voice, not noise
        scaleY: (_el?: unknown, i: number = 0) => {
          const centre = 1 - Math.abs(i - mid) / (mid + 1);
          return utils.random(lo, lo + (hi - lo) * (0.35 + 0.65 * centre), 2);
        },
        duration: () => utils.random(ms[0], ms[1]),
        delay: stagger(18, { from: 'center' }),
        ease: 'inOutSine',
        loop: true,
        alternate: true,
        onLoop: (self) => { self.refresh(); },
      });
    });
    return () => scope.current?.revert();
  }, [voice, mid]);

  return (
    <svg ref={root} viewBox={`0 0 ${width} ${HEIGHT}`} width="100%" height={HEIGHT} preserveAspectRatio="xMidYMid meet"
      className={`block max-w-[360px] transition-colors duration-300 ${COLOUR[voice]} ${className ?? ''}`} aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const centre = 1 - Math.abs(i - mid) / (mid + 1);
        const rest = 0.08 + 0.1 * centre;
        return (
          <rect key={i} data-bar="" x={i * (BAR_W + GAP)} y={0} width={BAR_W} height={HEIGHT} rx={BAR_W / 2}
            fill="currentColor" opacity={0.55 + 0.45 * centre}
            style={{ transformBox: 'fill-box', transformOrigin: 'center', transform: `scaleY(${rest})` }} />
        );
      })}
    </svg>
  );
}
