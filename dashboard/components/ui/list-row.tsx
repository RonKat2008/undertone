import Link from 'next/link';
import type { ReactNode } from 'react';

export interface ListRowProps {
  /** The main text: who, or what the conversation was about. */
  title: ReactNode;
  /** One quiet line under the title: when, how long, with whom. */
  meta?: ReactNode;
  /** A short leading column, e.g. a time ("9:40"). Optional. */
  leading?: ReactNode;
  /** Right side: a StatusWord, a Sparkline, or a Menu. Stays clickable above the row link. */
  trailing?: ReactNode;
  /** Makes the whole row a link. */
  href?: string;
  /** Makes the whole row a button (use instead of href for in-page selection). */
  onSelect?: () => void;
  /** Marks the row as the current selection (accent wash). Set aria-current on its page if it is one. */
  current?: boolean;
  /** Let the title wrap instead of truncating with an ellipsis. */
  wrap?: boolean;
}

/**
 * One row in a list. The whole row is the target (44 px minimum), separated by hairlines.
 * Put rows inside <ul className="qi-list"> via <List>.
 */
export function ListRow({ title, meta, leading, trailing, href, onSelect, current = false, wrap = false }: ListRowProps) {
  const interactive = Boolean(href || onSelect);
  const titleNode = href ? (
    <Link href={href} className="qi-row-link qi-row-title" aria-current={current ? 'page' : undefined}>{title}</Link>
  ) : onSelect ? (
    <button type="button" onClick={onSelect} className="qi-row-link qi-row-title w-full bg-transparent p-0 text-left" aria-pressed={current}>
      {title}
    </button>
  ) : (
    <span className="qi-row-title">{title}</span>
  );
  return (
    <div className="qi-row" data-interactive={interactive || undefined} data-current={current || undefined}
      data-leading={leading !== undefined ? '' : undefined} data-wrap={wrap || undefined}>
      {leading !== undefined ? <span className="qi-row-leading">{leading}</span> : null}
      <span className="qi-row-main">
        {titleNode}
        {meta ? <span className="qi-row-meta">{meta}</span> : null}
      </span>
      <span className="qi-row-trailing">{trailing}</span>
    </div>
  );
}

/** The list that holds ListRows. Renders a plain <ul>; pass one ListRow per child. */
export function List({ children, label }: { children: ReactNode[] | ReactNode; label?: string }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <ul className="qi-list" aria-label={label}>
      {items.map((child, i) => <li key={(child as { key?: string } | null)?.key ?? i}>{child}</li>)}
    </ul>
  );
}
