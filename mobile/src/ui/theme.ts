/**
 * "Quiet Ink" tokens for the phone (mobile/DESIGN.md). Dark only.
 * Hex values are the website's oklch tokens converted with culori, so both surfaces match.
 * Names are roles, not colours: `accent` means "your moment" and nothing else.
 */

export const C = {
  bg: '#120F0C', //        oklch(17% .008 70)  the page
  surface: '#1B1814', //   oklch(21% .008 70)  a raised control: quiet button, segmented track, sheet
  pressed: '#24211E', //   oklch(25% .008 70)  a row or quiet button while pressed
  line: '#302D2A', //      oklch(30% .008 70)  hairline rules
  lineStrong: '#504C48', // oklch(42% .008 70) the selected segment, scrubber track
  text: '#EAE7E2', //      oklch(93% .008 85)  primary text (15.5:1 on bg)
  muted: '#9B9891', //     oklch(68% .01 80)   secondary text (6.6:1 on bg)
  faint: '#6C6863', //     oklch(52% .01 80)   disabled text only (never meaning)
  accent: '#5EBDBC', //    oklch(74% .09 195)  your moment: the nudge, the one thing to try, the primary action
  onAccent: '#120F0C', //  text on the accent field (8.6:1)
  warn: '#E4B572', //      oklch(80% .1 75)    something needs you: an app waiting, a lost connection
  danger: '#E68677', //    oklch(72% .12 30)   destructive actions only (unpair, revoke)
} as const;

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

/** Radius: controls only. Rows, sections and text never sit in boxes. */
export const R = { control: 12, sheet: 20 } as const;

/** Smallest touch target (Apple HIG). */
export const TOUCH = 44;

/** Motion (ms). Short, transform/opacity only; zero under Reduce Motion. */
export const DUR = { press: 120, state: 200, enter: 240, exit: 180, nudge: 2500, status: 3000 } as const;
