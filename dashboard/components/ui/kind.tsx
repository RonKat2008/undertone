import { Handshake, Hash, MessagesSquare, Repeat, User, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ICON } from './icon';

/** The five kinds of thing Undertone knows about. Each has one hue, used everywhere it appears. */
export type Kind = 'person' | 'topic' | 'habit' | 'promise' | 'conversation';

export const KINDS: Kind[] = ['person', 'topic', 'habit', 'promise', 'conversation'];

export const KIND_ICON: Record<Kind, LucideIcon> = {
  person: User,
  topic: Hash,
  habit: Repeat,
  promise: Handshake,
  conversation: MessagesSquare,
};

export const KIND_LABEL: Record<Kind, string> = {
  person: 'Person',
  topic: 'Topic',
  habit: 'Habit',
  promise: 'Promise',
  conversation: 'Conversation',
};

/** The CSS colour of a kind, for SVG fills and strokes (graph nodes, chart marks). */
export function kindColor(kind: Kind): string {
  return `var(--kind-${kind})`;
}

/** An 8 px dot in the kind's hue, before a name in a list or a legend. */
export function KindDot({ kind, label }: { kind: Kind; label?: string }) {
  return <span className="qi-kind-dot" data-kind={kind} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />;
}

export interface KindChipProps {
  kind: Kind;
  children: ReactNode;
  /** Makes the chip a link (to that person, topic or habit). */
  href?: string;
  /** Hide the kind icon when the context already says the kind. */
  icon?: boolean;
}

/** A topic, habit, promise or person named inline: a soft pill in the kind's hue with its icon. */
export function KindChip({ kind, children, href, icon = true }: KindChipProps) {
  const Icon = KIND_ICON[kind];
  const content = (
    <>
      {icon ? <Icon {...ICON} size={14} aria-hidden /> : null}
      {children}
    </>
  );
  if (href) return <Link href={href} className="qi-chip" data-kind={kind}>{content}</Link>;
  return <span className="qi-chip" data-kind={kind}>{content}</span>;
}
