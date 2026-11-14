/**
 * "Tempo" tokens for the phone (DESIGN.md §2.6, dark column; the phone ships dark).
 * React Native gets the sRGB hex fallbacks, never oklch().
 * Names are roles: `bg` is always the surface, `fg` always the main foreground.
 */
import { Easing } from 'react-native';
import type { Tone } from '@/bus/patterns';

export const C = {
  bg: '#0E1218', // --paper (dark): blue-black, not #000
  well: '#171B22', // recessed surface: keys, the metronome face
  rule: '#2B2E34', // decorative hairlines and stave lines only
  ruleStrong: '#656970', // interactive borders and rules that carry meaning (≥ 3:1)
  fg: '#ECEBE4', // --ink (dark)
  fg2: '#ADB1B9', // secondary text
  fg3: '#888C94', // tertiary text: timestamps, line numbers (passes AA)
  them: '#60636A', // the other person's fill
} as const;

/** System states are neutral (§2.4): ink, shape and words. Never a pattern hue. */
export const STATE = { on: C.fg, off: C.fg3, fault: C.fg } as const;

export interface ToneSet {
  /** Step 3: highlighter wash, selected row. */
  tint: string;
  /** Step 9: glyph fill, takeover field, filler underline. */
  solid: string;
  /** Step 11: words in that pattern's colour (≥ 4.5:1 on bg, well and tint). */
  text: string;
  /** Text on the solid (the takeover). Only at ≥ 24 px. */
  on: string;
}

/** A pattern hue means that pattern and nothing else (§2.2). */
export const TONE: Record<Tone, ToneSet> = {
  vermilion: { tint: '#3B1C17', solid: '#ED7665', text: '#F8907F', on: C.bg },
  ochre: { tint: '#2F250E', solid: '#E3B750', text: '#E7BE62', on: C.bg },
  green: { tint: '#172C1C', solid: '#62BB78', text: '#7CCD8E', on: C.bg },
  teal: { tint: '#132B2C', solid: '#5DBCC1', text: '#79CACF', on: C.bg },
  blue: { tint: '#15273E', solid: '#69A1E8', text: '#84B7F9', on: C.bg },
  violet: { tint: '#2C203A', solid: '#B08ADA', text: '#C4A2ED', on: C.bg },
  pencil: { tint: '#2C251F', solid: '#BCA695', text: '#CDBAAB', on: C.bg },
  rose: { tint: '#322028', solid: '#D08DAC', text: '#DFA3BF', on: C.bg },
};

/**
 * Families (§3.1): Newsreader for display, Ronzino for text and real small caps,
 * IBM Plex Mono for every number that changes.
 */
export const F = {
  serif: 'Newsreader_400Regular',
  serifLight: 'Newsreader_300Light', // display sizes ≥ 40 px on the phone
  serifItalic: 'Newsreader_400Regular_Italic',
  serifLightItalic: 'Newsreader_300Light_Italic',
  sans: 'Ronzino_400',
  sansMedium: 'Ronzino_500',
  sansOblique: 'Ronzino_400_Oblique',
  mono: 'IBMPlexMono_400Regular',
  monoItalic: 'IBMPlexMono_400Regular_Italic',
  monoMedium: 'IBMPlexMono_500Medium',
} as const;

/** Spacing, base 4 (§4.1). */
export const S = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64, 9: 96 } as const;

/** Radius (§4.4): keys only; everything else is square. */
export const R = { key: 4 } as const;

/** Motion (§5.1). */
export const EASE = {
  enter: Easing.bezier(0.05, 0.7, 0.1, 1),
  exit: Easing.bezier(0.3, 0, 0.8, 0.15),
  std: Easing.bezier(0.2, 0, 0, 1),
  sine: Easing.bezier(0.37, 0, 0.63, 1),
} as const;
export const DUR = { press: 120, enter: 240, exit: 200, hold: 2500, breath: 3200 } as const;
