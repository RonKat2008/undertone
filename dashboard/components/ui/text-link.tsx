import Link from 'next/link';
import type { ReactNode } from 'react';

export interface TextLinkProps {
  href: string;
  /** 'default' inherits the text colour; 'muted' for secondary links such as "All conversations". */
  tone?: 'default' | 'muted';
  /** Opens in a new tab with rel="noreferrer". Only for links that leave Undertone. */
  external?: boolean;
  className?: string;
  children: ReactNode;
}

/** An underlined link inside text or under a list. Never append an arrow to the words. */
export function TextLink({ href, tone = 'default', external = false, className, children }: TextLinkProps) {
  if (external) {
    return <a className={`qi-link ${className ?? ''}`} data-tone={tone} href={href} target="_blank" rel="noreferrer">{children}</a>;
  }
  return <Link className={`qi-link ${className ?? ''}`} data-tone={tone} href={href}>{children}</Link>;
}
