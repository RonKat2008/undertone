import type { ElementType, ReactNode } from 'react';

export interface ProseProps {
  /** body 17 px for a debrief or recap; lead 22 px for the one thing to try; display 32 px for the home sentence. */
  size?: 'body' | 'lead' | 'display';
  /** Element to render: 'div' for several paragraphs, 'p' for one. */
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

/**
 * The coach's voice. Anything the AI wrote (debrief, recap, the home sentence, the one thing
 * to try) is set in the serif; that is the only marker, never an "AI" badge.
 * Wrap the single phrase that is "your moment" in <mark> to give it the accent.
 */
export function Prose({ size = 'body', as: Tag = 'div', className, children }: ProseProps) {
  return <Tag className={`qi-prose ${className ?? ''}`} data-size={size}>{children}</Tag>;
}
