'use client';

/**
 * DEPRECATED compatibility shim. The musical glyph is retired (no notation anywhere); this
 * renders the non-musical PatternMark so the pages that still import Glyph compile.
 * New code: import { PatternMark } from '@/components/ui'. Delete this file once nothing imports it.
 */
import type { CSSProperties } from 'react';
import type { HapticPattern } from '@/lib/bus/contracts';
import { PatternMark } from '@/components/ui/pattern-mark';

interface GlyphProps {
  pattern: HapticPattern;
  size?: number;
  playing?: boolean;
  playKey?: string | number;
  mono?: boolean;
  quiet?: boolean;
  className?: string;
  title?: string;
  style?: CSSProperties;
}

/** Old glyph sizes ran 18-200 px; the mark stays word-sized. */
const MAX_MARK = 16;

export function Glyph({ pattern, size = 20, playing = false, playKey, quiet = false, className, style }: GlyphProps) {
  return (
    <span className={className} style={{ color: quiet ? 'var(--muted)' : undefined, ...style }}>
      <PatternMark pattern={pattern} withLabel={false} size={Math.min(size, MAX_MARK)} playKey={playing ? playKey ?? 0 : undefined} />
    </span>
  );
}
