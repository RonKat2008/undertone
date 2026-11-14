'use client';

import { Popover as BasePopover } from '@base-ui/react/popover';
import { Tooltip as BaseTooltip } from '@base-ui/react/tooltip';
import type { ReactElement, ReactNode } from 'react';

/** Mount once (the shell does) so adjacent tooltips open instantly after the first. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <BaseTooltip.Provider delay={500} closeDelay={0}>{children}</BaseTooltip.Provider>;
}

export interface TooltipProps {
  /** A few words naming what the trigger does. Never information the reader needs: touch screens never see it. */
  content: ReactNode;
  /** One focusable element, usually an icon-only Button. */
  children: ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

/** Names an icon-only control on hover and focus. Not for explanations; use inline text or a Popover. */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={side} sideOffset={6} className="z-50">
          <BaseTooltip.Popup className="qi-tooltip">{content}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}

export interface PopoverProps {
  /** The trigger element; it opens the popover on click, and on hover when `openOnHover`. */
  trigger: ReactElement;
  /** Short content: two or three sentences and at most one link. */
  children: ReactNode;
  openOnHover?: boolean;
  side?: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'center' | 'end';
  /** Names the popup for screen readers. */
  label: string;
}

/** A small explanation that works on touch too (the shell's status uses it). */
export function Popover({ trigger, children, openOnHover = false, side = 'bottom', align = 'end', label }: PopoverProps) {
  return (
    <BasePopover.Root>
      <BasePopover.Trigger render={trigger} openOnHover={openOnHover} delay={200} closeDelay={150} />
      <BasePopover.Portal>
        <BasePopover.Positioner side={side} align={align} sideOffset={8} className="z-50">
          <BasePopover.Popup className="qi-float qi-popover" aria-label={label}>{children}</BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
