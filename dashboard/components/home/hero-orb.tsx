'use client';

/**
 * The hero's living visual: the listening mark made large. A glowing core with soft concentric
 * rings, three voice ribbons flowing through it, and a slow orbit track. All motion is anime.js on
 * transform and opacity: ribbons slide sideways (seamless loop), rings and core breathe, and each
 * new turn in a live conversation swells the ribbons for a moment. Calm while listening, livelier
 * in a conversation, dim and still when the band or the laptop can't be reached.
 */
import { animate, createScope, stagger, type Scope } from 'animejs';
import { useEffect, useId, useRef } from 'react';
import type { HeroState } from '@/lib/api/home-model';
import { prefersReducedMotion } from '@/lib/motion';

const SIZE = 480;
const MID = SIZE / 2;

interface Ribbon { wave: number; amp: number; tone: string; width: number; opacity: number; speed: number }

/** wavelength (px), amplitude (px), colour, stroke, opacity, ms per wavelength */
const RIBBONS: Ribbon[] = [
  { wave: 160, amp: 34, tone: 'var(--orb)', width: 3, opacity: 0.95, speed: 2600 },
  { wave: 240, amp: 46, tone: 'var(--orb-b)', width: 2.25, opacity: 0.85, speed: 4200 },
  { wave: 120, amp: 22, tone: 'var(--orb-c)', width: 2, opacity: 0.75, speed: 3400 },
];

/** How much the ribbons swing, and how fast everything moves, in each state. */
const ENERGY: Record<HeroState, { amp: number; tempo: number; still: boolean }> = {
  conversation: { amp: 1, tempo: 0.6, still: false },
  listening: { amp: 0.5, tempo: 1, still: false },
  ready: { amp: 0.42, tempo: 1.4, still: false },
  connecting: { amp: 0.18, tempo: 1.8, still: false },
  disconnected: { amp: 0.06, tempo: 1, still: true },
  unreachable: { amp: 0.04, tempo: 1, still: true },
};

/** A sine from x = 0 to SIZE + one wavelength, so sliding left by one wavelength loops seamlessly. */
function wavePath(wave: number, amp: number): string {
  const steps = Math.ceil((SIZE + wave) / 8);
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const x = i * 8;
    const y = MID + Math.sin((x / wave) * Math.PI * 2) * amp;
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}

const PATHS = RIBBONS.map((r) => wavePath(r.wave, r.amp));

export interface HeroOrbProps {
  state: HeroState;
  /** Changes on each new turn in a live conversation; each change swells the ribbons. */
  pulseKey: number;
}

export function HeroOrb({ state, pulseKey }: HeroOrbProps) {
  const root = useRef<SVGSVGElement>(null);
  const scope = useRef<Scope | null>(null);
  const id = useId().replace(/:/g, '');
  const energy = ENERGY[state];

  useEffect(() => {
    if (!root.current || energy.still || prefersReducedMotion()) return;
    const t = energy.tempo;
    scope.current = createScope({ root: root.current }).add(() => {
      RIBBONS.forEach((r, i) => {
        animate(`.orb-ribbon-${i}`, { x: [0, -r.wave], duration: r.speed * t, ease: 'linear', loop: true });
      });
      animate('.orb-ring', {
        scale: [1, 1.06], opacity: [0.35, 0.9], duration: 2400 * t, delay: stagger(380 * t), ease: 'inOutSine', alternate: true, loop: true,
      });
      animate('.orb-core', { scale: [1, 1.07], duration: 2200 * t, ease: 'inOutSine', alternate: true, loop: true });
      animate('.orb-halo', { scale: [0.92, 1.08], opacity: [0.7, 1], duration: 3200 * t, ease: 'inOutSine', alternate: true, loop: true });
      animate('.orb-track', { rotate: [0, 360], duration: 90000, ease: 'linear', loop: true });
    });
    return () => scope.current?.revert();
  }, [energy.still, energy.tempo]);

  // A new turn: the voice swells, then settles.
  useEffect(() => {
    if (!root.current || pulseKey === 0 || energy.still || prefersReducedMotion()) return;
    const anim = animate(root.current.querySelector('.orb-swell') as SVGGElement, {
      scaleY: [1, 1.7, 1], duration: 1100, ease: 'outQuad',
    });
    return () => {
      anim.revert();
    };
  }, [pulseKey, energy.still]);

  const fade = `fade-${id}`;
  const core = `core-${id}`;
  const halo = `halo-${id}`;
  return (
    <svg ref={root} viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full overflow-visible" aria-hidden data-state={state}>
      <defs>
        <radialGradient id={core} cx="40%" cy="36%" r="70%">
          <stop offset="0" style={{ stopColor: 'color-mix(in oklch, var(--orb) 35%, white)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--orb)' }} />
          <stop offset="1" style={{ stopColor: 'color-mix(in oklch, var(--orb) 60%, var(--bg))' }} />
        </radialGradient>
        <radialGradient id={halo}>
          <stop offset="0" style={{ stopColor: 'var(--orb)', stopOpacity: 0.42 }} />
          <stop offset="0.5" style={{ stopColor: 'var(--orb)', stopOpacity: 0.12 }} />
          <stop offset="1" style={{ stopColor: 'var(--orb)', stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id={`${fade}-g`} x1="0" x2="1">
          <stop offset="0" stopColor="white" stopOpacity="0" />
          <stop offset="0.22" stopColor="white" stopOpacity="1" />
          <stop offset="0.78" stopColor="white" stopOpacity="1" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <mask id={fade}>
          <rect width={SIZE} height={SIZE} fill={`url(#${fade}-g)`} />
        </mask>
      </defs>

      <g className="orb-body" style={{ opacity: energy.still ? 0.55 : 1, transition: 'opacity 600ms ease' }}>
        <circle className="orb-halo" cx={MID} cy={MID} r={MID - 8} fill={`url(#${halo})`} style={tb} />

        <circle className="orb-track" cx={MID} cy={MID} r={206} fill="none" stroke="var(--orb)" strokeOpacity={0.22}
          strokeWidth={1} strokeDasharray="1 9" strokeLinecap="round" style={tb} />

        {[78, 112, 148, 184].map((r, i) => (
          <circle key={r} className="orb-ring" cx={MID} cy={MID} r={r} fill="none" stroke="var(--orb)"
            strokeOpacity={0.5 - i * 0.1} strokeWidth={i === 0 ? 1.5 : 1} style={{ ...tb, opacity: 0.6 }} />
        ))}

        <g mask={`url(#${fade})`}>
          <g style={{ ...tb, transform: `scaleY(${energy.amp})`, transition: 'transform 900ms cubic-bezier(0.23, 1, 0.32, 1)' }}>
            <g className="orb-swell" style={tb}>
              {RIBBONS.map((r, i) => (
                <path key={i} className={`orb-ribbon-${i}`} d={PATHS[i]} fill="none" stroke={r.tone} strokeWidth={r.width}
                  strokeOpacity={r.opacity} strokeLinecap="round" />
              ))}
            </g>
          </g>
        </g>

        <circle className="orb-core" cx={MID} cy={MID} r={54} fill={`url(#${core})`} style={tb} />
        <circle cx={MID - 16} cy={MID - 18} r={14} fill="white" opacity={0.18} />
      </g>
    </svg>
  );
}

/** Transforms on SVG children scale around their own centre. */
const tb = { transformBox: 'fill-box', transformOrigin: 'center' } as const;
