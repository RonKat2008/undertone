'use client';

import { animate, createScope, createTimeline, stagger, svg } from 'animejs';
import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

export interface HowArtProps {
  /** Animate while true (the parent sets it when the art scrolls into view). */
  active: boolean;
}

/** Builds the looping motion inside `root`; may return a function that undoes non-style changes. */
type Build = (root: SVGSVGElement) => (() => void) | void;

const soft = (v: string, pct: number): string => `color-mix(in oklch, var(${v}) ${pct}%, transparent)`;

/** Elements scaled around their own centre. */
const SELF: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center' };

/** Runs `build` in an anime scope while active (and motion is allowed); reverts to the static frame otherwise. */
function useArtMotion(active: boolean, build: Build): RefObject<SVGSVGElement | null> {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!active || !root || prefersReducedMotion()) return;
    let undo: (() => void) | void;
    const scope = createScope({ root: ref }).add(() => {
      undo = build(root);
    });
    return () => {
      scope.revert();
      if (undo) undo();
    };
  }, [active, build]);
  return ref;
}

function Art({ svgRef, children }: { svgRef: RefObject<SVGSVGElement | null>; children: ReactNode }) {
  return (
    <svg
      ref={svgRef}
      viewBox="0 0 160 120"
      width="100%"
      aria-hidden="true"
      focusable="false"
      style={{ maxWidth: 200, height: 'auto', display: 'block', overflow: 'visible' }}
    >
      {children}
    </svg>
  );
}

/* ---------- Band: hears speech ---------- */

const CX = 80;
const CY = 60;
const ARCS = [
  { r: 34, color: 'var(--accent)', opacity: 0.75 },
  { r: 46, color: 'var(--kind-conversation)', opacity: 0.5 },
  { r: 58, color: 'var(--kind-person)', opacity: 0.32 },
] as const;

/** The upper arc of a circle around the band face, from -150deg to -30deg. */
function arcPath(r: number): string {
  const dx = (r * Math.cos(Math.PI / 6)).toFixed(1);
  const y = (CY - r / 2).toFixed(1);
  return `M${(CX - Number(dx)).toFixed(1)} ${y} A${r} ${r} 0 0 1 ${(CX + Number(dx)).toFixed(1)} ${y}`;
}

const ARC_ORIGIN: CSSProperties = { transformBox: 'view-box', transformOrigin: `${CX}px ${CY}px` };

const buildBand: Build = (root) => {
  animate(root.querySelectorAll('.ha-arc'), {
    scale: [0.82, 1.12],
    opacity: [0.95, 0],
    duration: 2600,
    delay: stagger(650),
    ease: 'outSine',
    loop: true,
  });
  animate(root.querySelectorAll('.ha-pulse'), { scale: [1, 1.35], duration: 1300, ease: 'inOutSine', alternate: true, loop: true });
  animate(root.querySelectorAll('.ha-glow'), { opacity: [0.55, 1], duration: 1300, ease: 'inOutSine', alternate: true, loop: true });
};

export function BandArt({ active }: HowArtProps) {
  const ref = useArtMotion(active, buildBand);
  return (
    <Art svgRef={ref}>
      <circle cx={CX} cy={CY} r={44} fill={soft('--accent', 10)} />
      {ARCS.map((a) => (
        <path key={a.r} className="ha-arc" d={arcPath(a.r)} fill="none" stroke={a.color} strokeWidth={3} strokeLinecap="round" opacity={a.opacity} style={ARC_ORIGIN} />
      ))}
      <rect x={14} y={49} width={132} height={22} rx={11} fill={soft('--kind-habit', 28)} stroke="var(--line-strong)" strokeWidth={1.5} />
      <rect x={22} y={57} width={26} height={6} rx={3} fill={soft('--kind-habit', 45)} />
      <rect x={112} y={57} width={26} height={6} rx={3} fill={soft('--kind-habit', 45)} />
      <rect x={60} y={39} width={40} height={42} rx={14} fill="var(--surface)" stroke="var(--line-strong)" strokeWidth={1.5} />
      <rect className="ha-glow" x={65} y={44} width={30} height={32} rx={10} fill={soft('--accent', 22)} opacity={0.8} />
      <circle className="ha-pulse" cx={CX} cy={CY} r={8} fill={soft('--accent', 30)} style={SELF} />
      <circle cx={CX} cy={CY} r={4.5} fill="var(--accent)" />
    </Art>
  );
}

/* ---------- Phone: buzzes with a nudge ---------- */

const PHONE = { x: 54, y: 10, w: 52, h: 100, rx: 11 } as const;
const RINGS = [
  { pad: 7, color: 'var(--accent)', opacity: 0.5 },
  { pad: 15, color: 'var(--kind-promise)', opacity: 0.28 },
] as const;

const buildPhone: Build = (root) => {
  const tl = createTimeline({ loop: true, loopDelay: 1400 });
  tl.add(
    root.querySelectorAll('.ha-body'),
    { translateX: [{ to: -2 }, { to: 2 }, { to: -1.5 }, { to: 1.5 }, { to: 0 }], duration: 520, ease: 'inOutSine' },
    0,
  )
    .add(root.querySelectorAll('.ha-ring'), { scale: [0.92, 1.18], opacity: [0.75, 0], duration: 1500, delay: stagger(220), ease: 'outSine' }, 0)
    .add(root.querySelectorAll('.ha-pill'), { scale: [0.9, 1], opacity: [0.6, 1], duration: 600, ease: 'outBack(1.6)' }, 80);
};

export function PhoneArt({ active }: HowArtProps) {
  const ref = useArtMotion(active, buildPhone);
  const { x, y, w, h, rx } = PHONE;
  return (
    <Art svgRef={ref}>
      <ellipse cx={80} cy={60} rx={62} ry={50} fill={soft('--accent', 8)} />
      {RINGS.map((r) => (
        <rect key={r.pad} className="ha-ring" x={x - r.pad} y={y - r.pad} width={w + r.pad * 2} height={h + r.pad * 2} rx={rx + r.pad} fill="none" stroke={r.color} strokeWidth={2} opacity={r.opacity} style={SELF} />
      ))}
      <g className="ha-body" style={SELF}>
        <rect x={x + 4} y={y + 5} width={w} height={h} rx={rx} fill={soft('--kind-promise', 22)} />
        <rect x={x} y={y} width={w} height={h} rx={rx} fill="var(--surface)" stroke="var(--line-strong)" strokeWidth={2} />
        <rect x={x + 5} y={y + 8} width={w - 10} height={h - 16} rx={7} fill="var(--surface-2)" />
        <rect x={74} y={y + 3} width={12} height={2.5} rx={1.25} fill="var(--line-strong)" />
        <rect x={x + 11} y={30} width={22} height={4} rx={2} fill="var(--line)" />
        <rect x={x + 11} y={80} width={30} height={4} rx={2} fill="var(--line)" />
        <rect x={x + 11} y={88} width={18} height={4} rx={2} fill="var(--line)" />
        <g className="ha-pill" style={SELF}>
          <rect x={x + 3} y={50} width={w - 6} height={16} rx={8} fill={soft('--accent', 24)} stroke="var(--accent)" strokeWidth={1.25} />
          <circle cx={x + 8.5} cy={58} r={2} fill="var(--accent)" />
          <text x={x + 29.5} y={60.5} textAnchor="middle" fontSize={7} fontWeight={600} fill="var(--text)" style={{ fontFamily: 'inherit' }}>
            Slow down
          </text>
        </g>
      </g>
    </Art>
  );
}

/* ---------- Page: the coach's debrief ---------- */

const LINES = [
  { y: 44, w: 66 },
  { y: 58, w: 58 },
  { y: 72, w: 70 },
  { y: 86, w: 42 },
] as const;
const MARKED = 1;
const LINE_X = 46;

const buildPage: Build = (root) => {
  const line = root.querySelector<SVGPathElement>('.ha-underline');
  if (line) {
    animate(svg.createDrawable(line), { draw: ['0 0', '0 1'], duration: 1500, ease: 'inOutSine', alternate: true, loop: true, loopDelay: 1100 });
  }
  animate(root.querySelectorAll('.ha-mark'), { opacity: [0.45, 1], duration: 1500, ease: 'inOutSine', alternate: true, loop: true, loopDelay: 1100 });
  animate(root.querySelectorAll('.ha-quote'), { translateY: [0, -2.5], rotate: [0, -6], duration: 1800, ease: 'inOutSine', alternate: true, loop: true });
  return () => {
    if (!line) return;
    line.removeAttribute('stroke-dasharray');
    line.removeAttribute('stroke-dashoffset');
    line.removeAttribute('pathLength');
    line.style.strokeLinecap = '';
  };
};

export function PageArt({ active }: HowArtProps) {
  const ref = useArtMotion(active, buildPage);
  const marked = LINES[MARKED];
  const uy = marked.y + 8;
  return (
    <Art svgRef={ref}>
      <rect x={40} y={20} width={92} height={96} rx={11} fill={soft('--coach', 20)} />
      <rect x={34} y={13} width={92} height={96} rx={11} fill="var(--surface)" stroke="var(--line-strong)" strokeWidth={1.5} />
      <rect x={100} y={23} width={18} height={8} rx={4} fill={soft('--kind-habit', 34)} />
      <g className="ha-quote" fill="var(--coach)" stroke="var(--coach)" strokeWidth={2} strokeLinecap="round" style={SELF}>
        <circle cx={49} cy={29} r={3.4} stroke="none" />
        <path d="M45.8 29.4 Q46 23.6 51.2 21.6" fill="none" />
        <circle cx={58.5} cy={29} r={3.4} stroke="none" />
        <path d="M55.3 29.4 Q55.5 23.6 60.7 21.6" fill="none" />
      </g>
      <rect className="ha-mark" x={LINE_X - 4} y={marked.y - 4} width={marked.w + 8} height={13} rx={4} fill={soft('--accent', 16)} />
      {LINES.map((l, i) => (
        <rect key={l.y} x={LINE_X} y={l.y} width={l.w} height={5} rx={2.5} fill={i === MARKED ? 'var(--text)' : 'var(--line-strong)'} opacity={i === MARKED ? 0.75 : 1} />
      ))}
      <path
        className="ha-underline"
        d={`M${LINE_X - 1} ${uy} C ${LINE_X + 18} ${uy - 2.2}, ${LINE_X + marked.w - 22} ${uy + 2.4}, ${LINE_X + marked.w + 2} ${uy - 0.8}`}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={2.6}
        strokeLinecap="round"
      />
    </Art>
  );
}
