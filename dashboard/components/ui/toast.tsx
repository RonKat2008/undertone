'use client';

import { Toaster as Sonner, toast } from 'sonner';

/**
 * Mounted once by the shell. Call `toast('Coach saved')` or `toast.error('Could not reach the band')`
 * from anywhere. A toast confirms an action the person just took, in the same words as the
 * button ("Save coach" -> "Coach saved"). One line; an action only when it is Undo.
 */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      gap={8}
      offset={24}
      mobileOffset={16}
      visibleToasts={3}
      toastOptions={{
        unstyled: true,
        duration: 4000,
        classNames: {
          toast: 'qi-toast',
          title: 'qi-toast-title',
          description: 'qi-toast-desc',
          actionButton: 'qi-toast-action',
          cancelButton: 'qi-toast-action',
        },
      }}
    />
  );
}

export { toast };
