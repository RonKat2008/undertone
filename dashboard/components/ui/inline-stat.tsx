'use client';

import NumberFlow, { type Format } from '@number-flow/react';
import type { Kind } from './kind';

export interface InlineStatProps {
  value: number;
  /** Intl.NumberFormat options, e.g. { maximumFractionDigits: 0 }. Never percentages. */
  format?: Format;
  /** Words glued after the number, e.g. " minutes". */
  suffix?: string;
  prefix?: string;
  /** Colour by meaning: accent for your moment, coach for the coach's highlight, a kind for that kind. Default: text. */
  tone?: 'text' | 'accent' | 'coach' | Kind;
}

/**
 * A number inside a sentence: "You spoke for <InlineStat value={12} suffix=" minutes" /> with Sam."
 * Medium weight, tabular figures; digits roll up when the value changes (static under reduced motion).
 * Never a tile, never a big number with a label above it.
 */
export function InlineStat({ value, format, suffix, prefix, tone = 'text' }: InlineStatProps) {
  const isKind = tone !== 'text' && tone !== 'accent' && tone !== 'coach';
  return (
    <span className="qi-stat" data-tone={isKind ? undefined : tone} data-kind={isKind ? tone : undefined}>
      <NumberFlow value={value} format={format} suffix={suffix} prefix={prefix} respectMotionPreference willChange={false} />
    </span>
  );
}
