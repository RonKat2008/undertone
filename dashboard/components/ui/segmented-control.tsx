'use client';

import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import type { ReactNode } from 'react';

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** Names the control for screen readers: "Time range", "Theme". */
  label: string;
}

/**
 * Picks one of two to four options that filter or set something in place (7 / 30 / 90 days,
 * Dark / Light). Always has a value; pressing the current option keeps it.
 */
export function SegmentedControl<T extends string>({ options, value, onValueChange, label }: SegmentedControlProps<T>) {
  return (
    <ToggleGroup
      className="qi-segmented"
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const picked = next[0] as T | undefined;
        if (picked && picked !== value) onValueChange(picked);
      }}
    >
      {options.map((o) => (
        <Toggle key={o.value} value={o.value} className="qi-segment">{o.label}</Toggle>
      ))}
    </ToggleGroup>
  );
}
