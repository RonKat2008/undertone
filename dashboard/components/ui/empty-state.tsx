import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** One sentence: what will appear here and what makes it appear. "Your conversations show up here after the band hears one." */
  children: ReactNode;
  /** One action that fixes the emptiness (a Button or TextLink). Optional. */
  action?: ReactNode;
}

/** An empty list or a failed load. One sentence and at most one action; no illustration, no icon. */
export function EmptyState({ children, action }: EmptyStateProps) {
  return (
    <div className="qi-empty">
      <p className="qi-empty-text">{children}</p>
      {action ?? null}
    </div>
  );
}
