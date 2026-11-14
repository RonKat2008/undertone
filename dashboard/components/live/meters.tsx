'use client';

/**
 * Live instruments. The pace needle uses VU ballistics (DESIGN.md §5.6): a damped spring
 * (zeta 0.8, omega0 20 rad/s) that settles to 99% of a step in about 300 ms, driven by rAF.
 * Each 1 Hz metrics sample becomes the spring's target.
 */
import { useEffect, useRef, type RefObject } from 'react';

const MIN = 100;
const MAX = 240;
const SWEEP = 50; // degrees either side of vertical: a 100 degree arc
const W = 300;
const H = 150;
const PX = W / 2;
const PY = H + 22; // the pivot sits below the window, as on a real meter
const R = 138;

const clampW = (v: number) => Math.min(MAX, Math.max(MIN, v));
const angle = (wpm: number) => ((clampW(wpm) - MIN) / (MAX - MIN)) * 2 * SWEEP - SWEEP;
const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return { x: PX + r * Math.sin(a), y: PY - r * Math.cos(a) };
};
const arc = (a0: number, a1: number, r: number) => {
  const p0 = pt(a0, r);
  const p1 = pt(a1, r);
  return `M${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A${r} ${r} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
};

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Drives `ref`'s rotation toward `target` degrees with VU ballistics. */
function useSpringRotation(ref: RefObject<SVGGElement | null>, target: number) {
  const sim = useRef({ x: -SWEEP, v: 0, target: -SWEEP, raf: 0, last: 0 });
  useEffect(() => {
    const s = sim.current;
    s.target = target;
    const apply = () => ref.current?.setAttribute('transform', `rotate(${s.x.toFixed(3)} ${PX} ${PY})`);
    if (reducedMotion()) {
      s.x = target; s.v = 0; apply();
      return;
    }
    if (s.raf) return;
    const zeta = 0.8;
    const w0 = 20;
    s.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - s.last) / 1000);
      s.last = now;
      // semi-implicit Euler in small sub-steps
      const n = 4;
      for (let i = 0; i < n; i++) {
        const h = dt / n;
        const a = w0 * w0 * (s.target - s.x) - 2 * zeta * w0 * s.v;
        s.v += a * h;
        s.x += s.v * h;
      }
      apply();
      if (Math.abs(s.target - s.x) < 0.02 && Math.abs(s.v) < 0.02) {
        s.x = s.target; s.v = 0; apply(); s.raf = 0;
        return;
      }
      s.raf = requestAnimationFrame(step);
    };
    s.raf = requestAnimationFrame(step);
  }, [target, ref]);
  useEffect(() => () => { if (sim.current.raf) cancelAnimationFrame(sim.current.raf); sim.current.raf = 0; }, []);
}

export function PaceMeter({ wpm, baseline, tolerance, fast }: { wpm: number | null; baseline: number | null; tolerance: number; fast: boolean }) {
  const needle = useRef<SVGGElement>(null);
  useSpringRotation(needle, angle(wpm ?? MIN));
  const ticks: number[] = [];
  for (let v = MIN; v <= MAX; v += 10) ticks.push(v);
  const lo = baseline !== null ? baseline * (1 - tolerance) : null;
  const hi = baseline !== null ? baseline * (1 + tolerance) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full max-w-[300px]" role="img"
      aria-label={wpm !== null ? `Pace ${Math.round(wpm)} words a minute${baseline !== null ? `, your usual ${Math.round(baseline)}` : ''}` : 'Pace: no reading yet'}>
      <defs><clipPath id="vu-window"><rect x={0} y={0} width={W} height={H} /></clipPath></defs>
      <g clipPath="url(#vu-window)">
        {hi !== null && hi < MAX && (
          <>
            <path d={`${arc(angle(hi), SWEEP, R)} L${pt(SWEEP, R - 12).x} ${pt(SWEEP, R - 12).y} A${R - 12} ${R - 12} 0 0 0 ${pt(angle(hi), R - 12).x} ${pt(angle(hi), R - 12).y} Z`} fill="var(--blue-tint)" />
            <path d={arc(angle(hi), SWEEP, R)} fill="none" stroke="var(--blue)" strokeWidth={1.5} />
          </>
        )}
        <path d={arc(-SWEEP, SWEEP, R)} fill="none" stroke="var(--ink)" strokeWidth={1} />
        {ticks.map((v) => {
          const major = v % 20 === 0;
          const a = angle(v);
          const p0 = pt(a, R);
          const p1 = pt(a, R - (major ? 12 : 6));
          const lp = pt(a, R + 9);
          return (
            <g key={v}>
              <line x1={p0.x} y1={p0.y} x2={p1.x} y2={p1.y} stroke="var(--ink)" strokeWidth={major ? 1.25 : 0.75} />
              {major && <text x={lp.x} y={lp.y} textAnchor="middle" fontSize={11} fill="var(--ink-3)" className="num">{v}</text>}
            </g>
          );
        })}
        {lo !== null && hi !== null && (
          <g stroke="var(--ink-2)" strokeWidth={1.5} fill="none">
            <path d={arc(angle(lo), angle(hi), R - 22)} />
            <line x1={pt(angle(lo), R - 18).x} y1={pt(angle(lo), R - 18).y} x2={pt(angle(lo), R - 26).x} y2={pt(angle(lo), R - 26).y} />
            <line x1={pt(angle(hi), R - 18).x} y1={pt(angle(hi), R - 18).y} x2={pt(angle(hi), R - 26).x} y2={pt(angle(hi), R - 26).y} />
          </g>
        )}
        <g ref={needle} transform={`rotate(${-SWEEP} ${PX} ${PY})`}>
          <line x1={PX} y1={PY} x2={PX} y2={PY - R - 4} stroke={fast ? 'var(--blue-text)' : 'var(--ink)'} strokeWidth={2} strokeLinecap="round" />
        </g>
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--rule-strong)" strokeWidth={1} />
      </g>
    </svg>
  );
}

/** Hand energy as a horizontal VU strip: frozen, natural (bracketed), overdoing. The needle is ink: violet belongs to the `still` buzz. */
export function EnergyStrip({ value }: { value: number }) {
  const v = Math.min(1, Math.max(0, value));
  const ticks = Array.from({ length: 11 }, (_, i) => i / 10);
  return (
    <div>
      <svg viewBox="0 0 300 40" preserveAspectRatio="none" className="block h-10 w-full" aria-hidden style={{ overflow: 'visible' }}>
        <line x1={0} x2={300} y1={28.5} y2={28.5} stroke="var(--ink)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {ticks.map((t) => <line key={t} x1={t * 300} x2={t * 300} y1={28} y2={t === 0.5 ? 20 : 23} stroke="var(--rule-strong)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
        <g stroke="var(--ink-2)" strokeWidth={1.5} fill="none" vectorEffect="non-scaling-stroke">
          <polyline points="90,16 90,10 210,10 210,16" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      <div className="relative -mt-10 h-10 overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-full transition-transform duration-300" style={{ transform: `translateX(${v * 100}%)`, transitionTimingFunction: 'var(--ease-std)' }}>
          <div className="absolute top-[2px] h-[34px] w-[2px] -translate-x-1/2 bg-ink" />
        </div>
      </div>
      <div className="text-s mt-1 grid grid-cols-3 text-ink-3">
        <span>frozen</span><span className="text-center">natural</span><span className="text-right">overdoing</span>
      </div>
    </div>
  );
}

/** A quarter note, drawn in the glyph style, for the tempo marking. */
export function QuarterNote({ size }: { size: number }) {
  const H = size;
  const rx = 0.2 * H;
  const ry = 0.14 * H;
  const cx = rx + 0.02 * H;
  const cy = H - ry - 0.02 * H;
  const sx = cx + rx * 0.93 - 0.03 * H;
  return (
    <svg width={cx + rx + 0.04 * H} height={H} viewBox={`0 0 ${cx + rx + 0.04 * H} ${H}`} aria-hidden className="inline-block shrink-0">
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(-20 ${cx} ${cy})`} fill="currentColor" />
      <line x1={sx} x2={sx} y1={cy - 0.02 * H} y2={0} stroke="currentColor" strokeWidth={0.065 * H} />
    </svg>
  );
}
