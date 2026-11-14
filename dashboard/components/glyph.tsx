'use client';

/**
 * Haptic glyph: the notation for one pattern. Bars on a baseline; width is duration,
 * height is intensity, spacing is the gap between taps. `playKey` changing (or `playing`)
 * replays the bars in the pattern's real rhythm.
 */
import type { CSSProperties } from 'react';
import type { HapticPattern } from '@/lib/bus/contracts';
import { PATTERNS } from '@/lib/bus/patterns';

interface GlyphProps {
  pattern: HapticPattern;
  /** Height in px. Width follows from the pattern's length. */
  size?: number;
  playing?: boolean;
  playKey?: string | number;
  /** Use the pattern's semantic colour (default) or inherit `currentColor`. */
  mono?: boolean;
  className?: string;
  title?: string;
}

const MS_PER_HEIGHT = 420; // one glyph-height of width = 420 ms

export function glyphWidth(pattern: HapticPattern, size: number): number {
  const spec = PATTERNS[pattern];
  const k = size / MS_PER_HEIGHT;
  return Math.max(...spec.pulses.map((p) => p.at * k + Math.max(p.dur * k, size * 0.11))) + 1;
}

export function Glyph({ pattern, size = 20, playing = false, playKey, mono = false, className, title }: GlyphProps) {
  const spec = PATTERNS[pattern];
  const k = size / MS_PER_HEIGHT;
  const minW = size * 0.11;
  const width = glyphWidth(pattern, size);
  const base = size - 1;
  const usable = size - 2;

  return (
    <svg
      key={playing ? `p-${playKey ?? 0}` : 'static'}
      width={width}
      height={size}
      viewBox={`0 0 ${width} ${size}`}
      role="img"
      aria-label={title ?? `${spec.name}: ${spec.feel}`}
      className={`${mono ? '' : `tone-${spec.tone}`} shrink-0 ${className ?? ''}`}
      style={{ color: mono ? undefined : 'var(--tone)', overflow: 'visible' }}
    >
      <line x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} stroke="currentColor" strokeWidth={1} opacity={0.35} />
      {spec.pulses.map((p, i) => {
        const x = p.at * k;
        const w = Math.max(p.dur * k, minW);
        const h = Math.max(usable * p.level, 2);
        const anim: CSSProperties = playing
          ? { animation: `${p.shape === 'ramp' ? 'glyph-ramp' : 'glyph-bar'} ${Math.max(p.dur, 160)}ms ${p.shape === 'ramp' ? 'linear' : 'ease-out'} ${p.at}ms 1 both` }
          : {};
        const style: CSSProperties = { transformBox: 'fill-box', transformOrigin: 'center bottom', ...anim };
        if (p.shape === 'ramp') {
          return <polygon key={i} points={`${x},${base} ${x + w},${base} ${x + w},${base - h}`} fill="currentColor" style={style} />;
        }
        return <rect key={i} x={x} y={base - h} width={w} height={h} rx={p.shape === 'soft' ? Math.min(h / 2, w / 2) : 0} fill="currentColor" style={style} />;
      })}
    </svg>
  );
}
