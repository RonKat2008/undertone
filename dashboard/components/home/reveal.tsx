'use client';

/** Scroll-linked entrances for Home: a block rises in once as it comes into view, children stagger. */
import { m, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';
import { EASE } from '@/lib/motion';

const VIEWPORT = { once: true, amount: 0.25 } as const;

export function Reveal({ children, className, delay = 0, as = 'div' }: { children: ReactNode; className?: string; delay?: number; as?: 'div' | 'section' | 'li' }) {
  const reduced = useReducedMotion() ?? false;
  const Tag = m[as];
  return (
    <Tag className={className} initial={{ opacity: 0, y: reduced ? 0 : 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={VIEWPORT}
      transition={{ duration: 0.6, ease: EASE.out, delay: reduced ? 0 : delay }}>
      {children}
    </Tag>
  );
}

/** A list whose items enter one after another (80 ms apart, at most 8). */
export function Stagger({ children, className, as = 'ul' }: { children: ReactNode; className?: string; as?: 'ul' | 'div' | 'ol' }) {
  const reduced = useReducedMotion() ?? false;
  const Tag = m[as];
  return (
    <Tag className={className} initial="hidden" whileInView="shown" viewport={VIEWPORT}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: reduced ? 0 : 0.08 } } }}>
      {children}
    </Tag>
  );
}

export function StaggerItem({ children, className, as = 'li' }: { children: ReactNode; className?: string; as?: 'li' | 'div' }) {
  const reduced = useReducedMotion() ?? false;
  const Tag = m[as];
  return (
    <Tag className={className} variants={{
      hidden: { opacity: 0, y: reduced ? 0 : 18, scale: reduced ? 1 : 0.97 },
      shown: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease: EASE.out } },
    }}>
      {children}
    </Tag>
  );
}
