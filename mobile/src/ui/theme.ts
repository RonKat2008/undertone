/** "Ink": the dashboard's paper system inverted. Hex equivalents of the OKLCH tokens. */
import type { Tone } from '@/bus/patterns';

export const C = {
  ink: '#15120F', // background
  well: '#1F1B17',
  rule: '#322C26',
  paper: '#F4EFE6', // text
  paper2: '#ADA598',
  paper3: '#787063',
  them: '#8B8377',
  mic: '#3D8BFF',
} as const;

/** One colour per haptic pattern, tuned for a dark background. */
export const TONE: Record<Tone, string> = {
  ink: C.paper,
  vermilion: '#F0603F',
  amber: '#F2AA3C',
  ochre: '#D2AC45',
  blue: '#5A96F8',
  violet: '#A283EE',
  green: '#55B980',
};

/** Background for the full-screen takeover, and the text colour that sits on it. */
export const TAKEOVER: Record<Tone, { bg: string; fg: string }> = {
  ink: { bg: C.paper, fg: C.ink },
  vermilion: { bg: '#D9482A', fg: C.paper },
  amber: { bg: '#F2AA3C', fg: C.ink },
  ochre: { bg: '#D2AC45', fg: C.ink },
  blue: { bg: '#2A66D9', fg: C.paper },
  violet: { bg: '#7453CF', fg: C.paper },
  green: { bg: '#2F8F5B', fg: C.paper },
};

export const F = {
  serif: 'InstrumentSerif_400Regular',
  serifItalic: 'InstrumentSerif_400Regular_Italic',
  sans: 'Geist_400Regular',
  sansMedium: 'Geist_500Medium',
  mono: 'GeistMono_400Regular',
} as const;

