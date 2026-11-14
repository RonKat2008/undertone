'use client';

import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import type { ReactElement, ReactNode } from 'react';

export interface DialogProps {
  /** The element that opens the dialog, usually a Button. Omit when controlling `open`. */
  trigger?: ReactElement;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** A question or a short statement: "Delete this conversation?" */
  title: ReactNode;
  /** One sentence on the consequence: "The transcript and audio are removed for good." */
  description?: ReactNode;
  /** Optional form content between the description and the actions. */
  children?: ReactNode;
  /** Buttons, right-aligned; the confirming action last. Wrap the cancel button in <DialogClose>. */
  actions: ReactNode;
}

/** A modal for confirming something destructive or for a short focused form. Never for information. */
export function Dialog({ trigger, open, onOpenChange, title, description, children, actions }: DialogProps) {
  return (
    <BaseDialog.Root open={open} onOpenChange={onOpenChange ? (o) => onOpenChange(o) : undefined}>
      {trigger ? <BaseDialog.Trigger render={trigger} /> : null}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="qi-backdrop z-50" />
        <BaseDialog.Viewport className="qi-dialog-viewport z-50">
          <BaseDialog.Popup className="qi-dialog">
            <BaseDialog.Title className="qi-dialog-title">{title}</BaseDialog.Title>
            {description ? <BaseDialog.Description className="qi-dialog-desc">{description}</BaseDialog.Description> : null}
            {children ? <div className="qi-dialog-body">{children}</div> : null}
            <div className="qi-dialog-actions">{actions}</div>
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** Wraps a Button so pressing it closes the dialog: <DialogClose><Button>Cancel</Button></DialogClose>. */
export function DialogClose({ children }: { children: ReactElement }) {
  return <BaseDialog.Close render={children} />;
}
