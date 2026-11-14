/**
 * "Quiet Ink, warm" tokens for the phone (mobile/DESIGN.md). Dark only.
 * Every hex is converted from an oklch value with culori so the website can match it exactly.
 *
 * Meanings:
 *   accent (teal)  your moment and the primary action: a nudge, the one thing to try, Start, Pair.
 *   warm (amber)   the coach's voice and highlights: the plan, "Rushing", something waiting on you.
 *   HUES           categorical: people, topics, habits. Same lightness and chroma, so none shouts.
 */

export const C = {
  bgDeep: '#0E0804', //    oklch(14% .016 55)  under the page: the tab bar, the scrim
  bg: '#160D08', //        oklch(17% .018 55)  the page, a warm near-black
  surface: '#221812', //   oklch(22% .02 55)   cards, sheet, inputs
  raised: '#2D211A', //    oklch(26% .022 55)  a quiet button, a selected segment, an avatar well
  pressed: '#352820', //   oklch(29% .024 55)  anything while pressed
  line: '#3B3029', //      oklch(32% .02 55)   hairlines inside a list only
  lineStrong: '#564A43', // oklch(42% .02 55)  meter tracks, scrubber track
  text: '#EFEAE2', //      oklch(94% .012 80)  primary text (16:1 on bg)
  muted: '#B0A69B', //     oklch(73% .02 70)   secondary text (8:1 on bg)
  faint: '#7A6F66', //     oklch(55% .02 65)   disabled and placeholder text only
  accent: '#5EBDBC', //    oklch(74% .09 195)
  accentSoft: '#0A3535', // oklch(30% .045 195) teal wash: selected segment, icon wells, the listening glow
  onAccent: '#160D08', //  text on teal or amber fills
  warm: '#E8A869', //      oklch(78% .11 65)
  warmSoft: '#432A15', //  oklch(31% .05 60)   amber wash
  warn: '#E8A869', //      = warm: something waiting on you, a lost connection
  danger: '#E97871', //    oklch(70% .14 25)   destructive actions only
} as const;

/** Categorical hues, oklch(72% .11 h): coral 30, gold 90, sage 150, sky 240, rose 350. */
export const HUES = ['#E1897B', '#BFA14C', '#6FB880', '#5EADE2', '#D887AE'] as const;

/** A stable hue for a key (a person, a topic): the same person is always the same colour. */
export function hueFor(key: string): string {
  // FNV-1a over the lower-cased key, then a finaliser so short names spread across the five hues.
  let h = 2166136261;
  const k = key.trim().toLowerCase();
  for (let i = 0; i < k.length; i += 1) h = Math.imul(h ^ k.charCodeAt(i), 16777619) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return HUES[h % HUES.length];
}

/** Colour with alpha, for washes and glows built from a token. */
export function alpha(hex: string, a: number): string {
  const v = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0');
  return `${hex}${v}`;
}

/** Four faces, loaded once in app/_layout.tsx. Newsreader is the coach's voice; Inter is everything else. */
export const F = {
  serif: 'Newsreader_400Regular',
  serifItalic: 'Newsreader_400Regular_Italic',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
} as const;

/** Six sizes, nothing else. */
export const SIZE = { caption: 13, small: 15, body: 17, lead: 22, title: 34, display: 52 } as const;

/** Spacing on a 4 pt base. Use the steps, not raw numbers. */
export const S = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 7: 32, 8: 48, 9: 64 } as const;

/** Page gutter. */
export const GUTTER = S[5];

/** Radius: 12 on controls, 18 on cards, 24 on the sheet. */
export const R = { control: 12, card: 18, sheet: 24 } as const;

/** Smallest touch target (Apple HIG). */
export const TOUCH = 44;

/** One soft shadow for a raised card (iOS shadow*, Android elevation, web boxShadow). */
export const SHADOW = {
  shadowColor: '#000000',
  shadowOpacity: 0.35,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 6,
} as const;

/** Motion (ms). Transform/opacity only; zero under Reduce Motion. */
export const DUR = { press: 120, state: 220, enter: 280, exit: 180, stagger: 45, nudge: 2500, status: 3000 } as const;

/** Springs (duration + damping ratio form). */
export const SPRING = { settle: { duration: 420, dampingRatio: 0.85 }, sheet: { duration: 340, dampingRatio: 0.82 } } as const;
