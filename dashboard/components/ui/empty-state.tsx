import type { ReactNode } from 'react';
import { ListeningMark, type ListeningState } from './listening-mark';

export interface EmptyStateProps {
  /** One sentence: what will appear here and what makes it appear. */
  children: ReactNode;
  /** One action that fixes the emptiness (a Button). Optional. */
  action?: ReactNode;
  /** The listening mark above the sentence: listening while waiting for data, idle when nothing will come, offline on a failed load. */
  mark?: ListeningState | 'none';
}

/** An empty list or a failed load: the listening mark, one sentence, at most one action. */
export function EmptyState({ children, action, mark = 'listening' }: EmptyStateProps) {
  return (
    <div className="qi-empty">
      {mark !== 'none' ? <ListeningMark state={mark} size="lg" /> : null}
      <p className="qi-empty-text">{children}</p>
      {action ?? null}
    </div>
  );
}
