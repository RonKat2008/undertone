'use client';

import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';

export interface TabItem {
  value: string;
  label: ReactNode;
  /** Optional lucide icon element before the label; turns teal on the active tab. */
  icon?: ReactNode;
  content: ReactNode;
}

export interface TabsProps {
  items: TabItem[];
  /** Uncontrolled starting tab. Prefer keeping the tab in the URL and passing `value`. */
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  /** Names the tab list for screen readers. */
  label: string;
}

/**
 * Switches between views of the same thing (Transcript / Debrief / Audio). Two to four tabs; the
 * current one sits on a raised pill that springs between them. For a filter or a setting use SegmentedControl.
 */
export function Tabs({ items, defaultValue, value, onValueChange, label }: TabsProps) {
  return (
    <BaseTabs.Root
      defaultValue={defaultValue ?? items[0]?.value}
      value={value}
      onValueChange={onValueChange ? (v) => onValueChange(String(v)) : undefined}
    >
      <BaseTabs.List className="qi-tabs-list" aria-label={label}>
        {items.map((t) => (
          <BaseTabs.Tab key={t.value} value={t.value} className="qi-tab">{t.icon}{t.label}</BaseTabs.Tab>
        ))}
        <BaseTabs.Indicator className="qi-tabs-indicator" />
      </BaseTabs.List>
      {items.map((t) => (
        <BaseTabs.Panel key={t.value} value={t.value} className="qi-tabs-panel">{t.content}</BaseTabs.Panel>
      ))}
    </BaseTabs.Root>
  );
}
