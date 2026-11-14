'use client';

import { Menu as BaseMenu } from '@base-ui/react/menu';
import { MoreHorizontal } from 'lucide-react';
import { Fragment } from 'react';
import { ICON } from './icon';

export interface MenuAction {
  label: string;
  onSelect: () => void;
  /** Destructive: shown in the danger colour, listed last after a separator. Confirm it in a Dialog. */
  danger?: boolean;
  disabled?: boolean;
}

export interface MenuProps {
  actions: MenuAction[];
  /** Says what the actions apply to: "Actions for Tuesday with Sam". */
  label: string;
}

/** Overflow actions for one row or one object, behind a "…" button. Two to six actions. */
export function Menu({ actions, label }: MenuProps) {
  const safe = actions.filter((a) => !a.danger);
  const danger = actions.filter((a) => a.danger);
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger className="qi-btn" data-variant="ghost" data-size="small" data-icon-only aria-label={label}>
        <MoreHorizontal {...ICON} aria-hidden />
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={6} align="end" className="z-50">
          <BaseMenu.Popup className="qi-float qi-menu">
            {safe.map((a) => <Item key={a.label} action={a} />)}
            {danger.length > 0 && safe.length > 0 ? <BaseMenu.Separator className="qi-menu-separator" /> : null}
            {danger.map((a) => <Fragment key={a.label}><Item action={a} /></Fragment>)}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

function Item({ action }: { action: MenuAction }) {
  return (
    <BaseMenu.Item className="qi-menu-item" data-tone={action.danger ? 'danger' : undefined} disabled={action.disabled} onClick={action.onSelect}>
      {action.label}
    </BaseMenu.Item>
  );
}
