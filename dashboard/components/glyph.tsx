'use client';

/**
 * Haptic glyph: the pattern written as rhythm notation on one stave (DESIGN.md §7).
 * Time runs left to right at the real pulse timings; pitch is intensity (harder = higher).
 * `playKey` changing (or `playing`) replays it at the pattern's exact millisecond rhythm (§5.2).
 */
import type { CSSProperties, ReactNode } from 'react';
import type { HapticPattern } from '@/lib/bus/contracts';
import { PATTERNS, type Pulse } from '@/lib/bus/patterns';

interface GlyphProps {
  pattern: HapticPattern;
  /** Glyph height H in px. Width follows from the pattern's length. */
  size?: number;
  playing?: boolean;
  playKey?: string | number;
  /** Inherit `currentColor` instead of the pattern's hue. */
  mono?: boolean;
  /** A quiet mark: logged, not buzzed. Same notation, open heads, --ink-3, no hue. */
  quiet?: boolean;
  className?: string;
  title?: string;
  style?: CSSProperties;
}

const MS_PER_HEIGHT = 420; // one glyph-height of width = 420 ms

interface Geo {
  k: number;
  H: number;
  y0: number;
}

const isShort = (p: Pulse) => p.dur < 200 && !p.shape;
const headY = (g: Geo, p: Pulse) => g.y0 - p.level * 0.46 * g.H;
const headRx = (g: Geo, p: Pulse) => (p.shape === 'soft' ? 0.2 : 0.15) * g.H;

function rightEdge(g: Geo, p: Pulse, size: number): number {
  const x = p.at * g.k;
  if (p.shape === 'ramp') return (p.at + p.dur) * g.k + (size >= 48 ? 0.15 * g.H + 0.3 * g.H * 2.4 : 0.03 * g.H);
  if (p.dur < 35) return x + 0.12 * g.H;
  const head = x + 2 * headRx(g, p);
  if (p.shape === 'soft') return Math.max(head, (p.at + p.dur) * g.k + 0.04 * g.H);
  if (!isShort(p)) return Math.max(head, (p.at + p.dur) * g.k);
  return head + (p.level >= 0.9 ? 0.09 * g.H : 0.03 * g.H);
}

export function glyphWidth(pattern: HapticPattern, size: number): number {
  const g: Geo = { k: size / MS_PER_HEIGHT, H: size, y0: 0.82 * size };
  return Math.ceil(Math.max(...PATTERNS[pattern].pulses.map((p) => rightEdge(g, p, size)))) + 1;
}

export function Glyph({ pattern, size = 20, playing = false, playKey, mono = false, quiet = false, className, title, style }: GlyphProps) {
  const spec = PATTERNS[pattern];
  const H = size;
  const g: Geo = { k: H / MS_PER_HEIGHT, H, y0: 0.82 * H };
  const width = glyphWidth(pattern, size);
  const hue = !mono && !quiet;

  const strike = (p: Pulse): CSSProperties => (playing
    ? { transformBox: 'fill-box', transformOrigin: 'center', animation: `strike ${Math.max(p.dur, 120)}ms var(--ease-enter) ${p.at}ms 1 both` }
    : {});
  const draw = (p: Pulse): CSSProperties => (playing ? { animation: `draw ${p.dur}ms linear ${p.at}ms 1 both` } : {});
  const accentAnim = (p: Pulse): CSSProperties => (playing ? { animation: `accent 120ms linear ${p.at}ms 1 both` } : {});

  const parts: ReactNode[] = spec.pulses.map((p, i) => {
    const x = p.at * g.k;
    const y = headY(g, p);
    const sw = 0.06 * H;

    if (p.shape === 'ramp') {
      // hairpin "<": opens left to right over exactly `dur`
      const x1 = (p.at + p.dur) * g.k;
      const yc = g.y0 - 0.22 * H;
      const open = p.level * 0.25 * H;
      return (
        <g key={i}>
          <path d={`M${x1} ${yc - open} L${x} ${yc} L${x1} ${yc + open}`} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={draw(p)} />
          {size >= 48 && (
            <text x={x1 + 0.15 * H} y={yc + 0.1 * H} fontSize={0.3 * H} fontStyle="italic" fill="currentColor"
              style={{ fontFamily: 'var(--font-mono)', ...(playing ? { animation: 'fade-in 240ms linear 0ms 1 both' } : {}) }}>rit.</text>
          )}
        </g>
      );
    }

    if (p.dur < 35) {
      // staccato: a dot only
      return <circle key={i} cx={x + 0.06 * H} cy={y} r={0.06 * H} fill="currentColor" style={strike(p)} />;
    }

    const rx = headRx(g, p);
    const ry = 0.105 * H * (p.shape === 'soft' ? 1.05 : 1);
    const cx = x + rx;
    const filled = !quiet && p.level >= 0.55 && p.shape !== 'soft';
    const head = (
      <ellipse cx={cx} cy={y} rx={rx - (filled ? 0 : sw / 2)} ry={ry - (filled ? 0 : sw / 2)} transform={`rotate(-20 ${cx} ${y})`}
        fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'} strokeWidth={filled ? 0 : sw} />
    );
    const accent = (top: number, ax = cx) => (p.level >= 0.9 ? (
      <path d={`M${ax - 0.09 * H} ${top - 0.1 * H} L${ax + 0.09 * H} ${top - 0.05 * H} L${ax - 0.09 * H} ${top}`}
        fill="none" stroke="currentColor" strokeWidth={0.045 * H} style={accentAnim(p)} />
    ) : null);

    if (p.shape === 'soft') {
      // open whole note with a tie drawn over `dur`
      const x1 = Math.max(x + 2 * rx, (p.at + p.dur) * g.k);
      return (
        <g key={i}>
          <g style={strike(p)}>{head}</g>
          <path d={`M${x + 0.3 * rx} ${y + ry + 0.05 * H} Q${(x + x1) / 2} ${y + ry + 0.24 * H} ${x1} ${y + ry + 0.05 * H}`}
            fill="none" stroke="currentColor" strokeWidth={0.04 * H} strokeLinecap="round" style={draw(p)} />
        </g>
      );
    }

    if (!isShort(p)) {
      // held note: head plus a tenuto bar drawn for exactly `dur`
      const x0 = x + 2 * rx - 0.02 * H;
      const x1 = Math.max(x0, (p.at + p.dur) * g.k);
      return (
        <g key={i}>
          <rect x={x0} y={y - 0.045 * H} width={x1 - x0} height={0.09 * H} fill="currentColor" style={draw(p)} />
          <g style={strike(p)}>{head}</g>
          {accent(y - ry - 0.1 * H)}
        </g>
      );
    }

    // short pulse: head + stem, struck at `at`
    const stemX = cx + rx * 0.93 - 0.025 * H;
    const stemTop = y - 0.34 * H;
    return (
      <g key={i}>
        <g style={strike(p)}>
          {head}
          <line x1={stemX} x2={stemX} y1={y - 0.02 * H} y2={stemTop} stroke="currentColor" strokeWidth={0.05 * H} />
        </g>
        {accent(stemTop - 0.1 * H, stemX)}
      </g>
    );
  });

  return (
    <svg
      key={playing ? `p-${playKey ?? 0}` : 'static'}
      width={width}
      height={H}
      viewBox={`0 0 ${width} ${H}`}
      role="img"
      aria-label={title ?? `${spec.name}: ${spec.feel}`}
      className={`${hue ? `tone-${spec.tone}` : ''} shrink-0 ${className ?? ''}`}
      style={{ color: hue ? 'var(--tone)' : quiet ? 'var(--ink-3)' : undefined, overflow: 'visible', ...style }}
    >
      <line x1={0} x2={width} y1={g.y0} y2={g.y0} stroke="currentColor" strokeWidth={1} opacity={0.35} vectorEffect="non-scaling-stroke" />
      {parts}
    </svg>
  );
}
