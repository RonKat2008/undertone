/**
 * Lamplight motion presets. The only motion values the site uses; CSS mirrors them as
 * --dur-fast / --dur-base / --dur-slow and --ease-out / --ease-in-out / --ease-spring in
 * app/globals.css.
 *
 * Rules (DESIGN.md "Motion"): motion shows what changed. 150-320 ms, transform and opacity
 * only, never `transition: all`. Exits are quicker than entries. Under prefers-reduced-motion,
 * movement is dropped and a short opacity fade remains.
 *
 * Tools: `motion` (import from "motion/react", render `m.*` inside <MotionProvider>) for
 * state-driven enter/exit, layout, springs and list stagger; `animejs` v4 for imperative SVG
 * or sequenced work on a ref (createScope + scope.revert() in an effect). Never animate one
 * element with both.
 */
import type { Transition, Variants } from 'motion/react';

/** Durations in milliseconds, for CSS-in-JS and anime.js. */
export const DURATION_MS = { fast: 150, base: 220, slow: 320 } as const;

/** Durations in seconds, for motion. */
export const DURATION = { fast: 0.15, base: 0.22, slow: 0.32 } as const;

type Bezier = [number, number, number, number];

/** Strong ease-out for entering and responding; ease-in-out for things moving on screen. */
export const EASE: { out: Bezier; inOut: Bezier } = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
};

/** The same curves as CSS strings. */
export const EASE_CSS = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
} as const;

/** A gentle spring (small overshoot) for panels, sheets, the nav pill. */
export const SPRING: Transition = { type: 'spring', duration: 0.38, bounce: 0.18 };

/** Distance an entering element travels, in px. */
export const RISE_PX = 8;

/** Delay between list items entering together, in seconds. Capped so long lists never crawl. */
export const STAGGER = 0.04;
export const STAGGER_MAX_ITEMS = 8;

export interface MotionPresets {
  /** A panel, row or message entering: opacity + an 8 px rise. Exit is a quicker fade. */
  enter: Variants;
  /** Pure opacity, for swapping content in place. */
  fade: Variants;
  /** Parent of staggered children: put on the list, give each item `enter`. */
  list: Variants;
  transition: { enter: Transition; exit: Transition; move: Transition };
}

const REDUCED: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: DURATION.fast, ease: 'linear' } },
  gone: { opacity: 0, transition: { duration: DURATION.fast, ease: 'linear' } },
};

/**
 * Presets for motion's `variants`, already adjusted for reduced motion.
 * Use with initial="hidden" animate="shown" exit="gone".
 */
export function motionPresets(reduced: boolean): MotionPresets {
  const enter: Transition = { duration: DURATION.slow, ease: EASE.out };
  const exit: Transition = { duration: DURATION.fast, ease: EASE.out };
  const move: Transition = reduced ? { duration: 0 } : SPRING;
  const list: Variants = { hidden: {}, shown: { transition: { staggerChildren: reduced ? 0 : STAGGER } }, gone: {} };
  if (reduced) return { enter: REDUCED, fade: REDUCED, list, transition: { enter, exit, move } };
  return {
    enter: {
      hidden: { opacity: 0, y: RISE_PX },
      shown: { opacity: 1, y: 0, transition: enter },
      gone: { opacity: 0, y: 0, transition: exit },
    },
    fade: {
      hidden: { opacity: 0 },
      shown: { opacity: 1, transition: enter },
      gone: { opacity: 0, transition: exit },
    },
    list,
    transition: { enter, exit, move },
  };
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * For imperative code (anime.js, WAAPI) outside React state: true when the viewer asked for
 * less motion. On the server it answers true, so nothing animates before hydration.
 * In components prefer `useReducedMotion` from motion/react.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(REDUCED_QUERY).matches;
}

/** A duration in ms that is 0 under reduced motion. For anime.js `duration`. */
export function motionMs(ms: number, reduced: boolean = prefersReducedMotion()): number {
  return reduced ? 0 : ms;
}
