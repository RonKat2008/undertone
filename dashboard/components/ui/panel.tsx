import { Feather } from 'lucide-react';
import Link from 'next/link';
import type { ElementType, ReactNode } from 'react';
import { ICON } from './icon';
import { Prose } from './prose';

export interface PanelProps {
  /**
   * default: the ordinary raised surface.
   * coach: an amber-tinted surface for something the coach says (prefer <CoachNote>).
   * moment: a teal-tinted surface for "your moment", at most one per page.
   */
  tone?: 'default' | 'coach' | 'moment';
  /** 'normal' pads the content; 'list' is for a List inside (rows bring their own padding); 'none' for media. */
  padding?: 'normal' | 'list' | 'none';
  /** Small coloured heading inside the panel (icon + a few words). */
  head?: ReactNode;
  /** Makes the whole panel a link that lifts on hover. */
  href?: string;
  as?: ElementType;
  className?: string;
  children: ReactNode;
}

/**
 * The one surface level: rounded 16, soft shadow, separated from the page by tone, not lines.
 * Never put a Panel inside a Panel.
 */
export function Panel({ tone = 'default', padding = 'normal', head, href, as: Tag = 'div', className, children }: PanelProps) {
  const body = (
    <>
      {head ? <div className="qi-panel-head">{head}</div> : null}
      {children}
    </>
  );
  const shared = { className: `qi-panel ${className ?? ''}`, 'data-tone': tone, 'data-padding': padding };
  if (href) return <Link href={href} {...shared} data-interactive="">{body}</Link>;
  return <Tag {...shared}>{body}</Tag>;
}

export interface CoachNoteProps {
  /** Who is speaking; defaults to "Your coach". */
  from?: ReactNode;
  /** body 17 px (default) or lead 22 px for the one thing to try. */
  size?: 'body' | 'lead';
  children: ReactNode;
}

/** Something the coach wrote, on an amber-tinted panel, in the serif. Wrap the one thing to try in <mark>. */
export function CoachNote({ from = 'Your coach', size = 'body', children }: CoachNoteProps) {
  return (
    <Panel tone="coach" head={<><Feather {...ICON} size={16} aria-hidden />{from}</>}>
      <Prose size={size}>{children}</Prose>
    </Panel>
  );
}
