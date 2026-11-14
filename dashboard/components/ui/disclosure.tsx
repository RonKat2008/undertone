'use client';

import { Collapsible } from '@base-ui/react/collapsible';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { ICON } from './icon';

export interface DisclosureProps {
  /** What opening shows, in a few words: "Show the full transcript". */
  summary: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}

/**
 * The second level of disclosure (and the last: never nest one Disclosure in another).
 * Use it for detail most people do not need: the full transcript, how a habit is measured.
 */
export function Disclosure({ summary, defaultOpen, open, onOpenChange, children }: DisclosureProps) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange ? (o) => onOpenChange(o) : undefined}>
      <Collapsible.Trigger className="qi-disclosure-trigger">
        <ChevronRight {...ICON} size={16} aria-hidden />
        {summary}
      </Collapsible.Trigger>
      <Collapsible.Panel className="qi-disclosure-panel">{children}</Collapsible.Panel>
    </Collapsible.Root>
  );
}
