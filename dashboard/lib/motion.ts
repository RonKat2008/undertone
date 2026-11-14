/**
 * Quiet Ink motion presets. The only motion values the site uses; CSS mirrors them as
 * --dur-fast / --dur-base / --dur-slow and --ease-out / --ease-in-out in app/globals.css.
 *
 * Rules (DESIGN.md "Motion"): motion clarifies a state change or is absent. 150-250 ms,
 * transform and opacity only, never `transition: all`. Exits are faster than entries.
 * Under prefers-reduced-motion, movement is dropped and only a short opacity fade remains.
 *
 * Tools: `motion` (import from "motion/react", render `m.*` inside <MotionProvider>) for
 * state-driven enter/exit/layout; `animejs` v4 for imperative SVG or sequenced work on a ref
 * (createScope + scope.revert() in an effect). Never animate one element with both.
 */
import type { Transition, Variants } from 'motion/react';

/** Durations in milliseconds, for CSS-in-JS and anime.js. */
export const DURATION_MS = { fast: 150, base: 200, slow: 250 } as const;

/** Durations in seconds, for motion. */
export const DURATION = { fast: 0.15, base: 0.2, slow: 0.25 } as const;

/** Strong ease-out for entering and responding; ease-in-out for things moving on screen. */
export const EASE = {
  out: [0.23, 1, 0.32, 1],
  inOut: [0.77, 0, 0.175, 1],
} as const satisfies Record<string, readonly [number, number, number, number]>;

/** The same curves as CSS strings (anime.js accepts `cubicBezier(...)` from 'animejs' instead). */
export const EASE_CSS = {
  out: 'cubic-bezier(0.23, 1, 0.32, 1)',
  inOut: 'cubic-bezier(0.77, 0, 0.175, 1)',
} as const;

/** Distance for an entering element to travel, in px. Small on purpose. */
export const RISE_PX = 4;

export interface MotionPresets {
  /** Panel, row or message entering: opacity + a 4 px rise. Exit is a quicker fade. */
  enter: Variants;
  /** Pure opacity, for swapping content in place. */
  fade: Variants;
  /** Transitions to pair with the variants above. */
  transition: { enter: Transition; exit: Transition; move: Transition };
}

const REDUCED_FADE: Variants = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, transition: { duration: DURATION.fast, ease: 'linear' } },
  gone: { opacity: 0, transition: { duration: DURATION.fast, ease: 'linear' } },
};

/**
 * Presets for motion's `variants`, already adjusted for reduced motion.
 * Use with initial="hidden" animate="shown" exit="gone".
 */
export function motionPresets(reduced: boolean): MotionPresets {
  const enter: Transition = { duration: DURATION.base, ease: EASE.out };
  const exit: Transition = { duration: DURATION.fast, ease: EASE.out };
  const move: Transition = reduced ? { duration: 0 } : { duration: DURATION.slow, ease: EASE.inOut };
  if (reduced) return { enter: REDUCED_FADE, fade: REDUCED_FADE, transition: { enter, exit, move } };
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

/** Pick a duration in ms that is 0 under reduced motion. For anime.js `duration`. */
export function motionMs(ms: number, reduced: boolean = prefersReducedMotion()): number {
  return reduced ? 0 : ms;
}
