'use client';

import { m, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { Children, isValidElement, type ReactNode } from 'react';
import { motionPresets, STAGGER_MAX_ITEMS } from '@/lib/motion';

export interface ListRowProps {
  /** The main text: who, or what the conversation was about. */
  title: ReactNode;
  /** One quiet line under the title: when, how long, with whom. */
  meta?: ReactNode;
  /** Leading visual: an Avatar, a KindDot, or a short time ("9:40"). */
  leading?: ReactNode;
  /** Right side: a StatusWord, a Sparkline, a KindChip or a Menu. Stays clickable above the row link. */
  trailing?: ReactNode;
  /** Makes the whole row a link. */
  href?: string;
  /** Makes the whole row a button (in-page selection). Use instead of href. */
  onSelect?: () => void;
  /** The current selection (teal wash). */
  current?: boolean;
  /** Let the title wrap instead of truncating. */
  wrap?: boolean;
}

/** One row. The whole row is the target (56 px), rows are split by hairlines, hover tints the row. */
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
      {trailing ? <span className="qi-row-trailing">{trailing}</span> : <span />}
    </div>
  );
}

export interface ListProps {
  /** ListRows, each with a stable key. */
  children: ReactNode;
  /** Names the list for screen readers. */
  label?: string;
  /** Stagger the first items in on mount (default on). Turn off for lists that re-sort live. */
  animate?: boolean;
}

/** Holds ListRows. Put it in a Panel with padding="list". The first rows rise in, one after another. */
export function List({ children, label, animate = true }: ListProps) {
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  const items = Children.toArray(children).filter(isValidElement);
  if (!animate) {
    return <ul className="qi-list" aria-label={label}>{items.map((c) => <li key={c.key}>{c}</li>)}</ul>;
  }
  return (
    <m.ul className="qi-list" aria-label={label} variants={presets.list} initial="hidden" animate="shown">
      {items.map((c, i) => (
        <m.li key={c.key} variants={i < STAGGER_MAX_ITEMS ? presets.enter : undefined}>{c}</m.li>
      ))}
    </m.ul>
  );
}
