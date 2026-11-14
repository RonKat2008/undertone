'use client';

import NumberFlow, { type Format } from '@number-flow/react';

export interface InlineStatProps {
  value: number;
  /** Intl.NumberFormat options, e.g. { maximumFractionDigits: 0 } or { style: 'percent' }. */
  format?: Format;
  /** Words glued after the number inside the same span, e.g. " minutes". */
  suffix?: string;
  prefix?: string;
}

/**
 * A number inside a sentence: "You spoke for <InlineStat value={12} suffix=" minutes" /> with Sam."
 * Medium weight, tabular figures; digits roll when the value changes (static under reduced motion).
 * Never a tile, never a big number with a label above it.
 */
export function InlineStat({ value, format, suffix, prefix }: InlineStatProps) {
  return (
    <span className="qi-stat">
      <NumberFlow value={value} format={format} suffix={suffix} prefix={prefix} respectMotionPreference willChange={false} />
    </span>
  );
}
