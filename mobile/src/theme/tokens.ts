export type HapticPattern = 'interrupt' | 'wrap_up' | 'filler' | 'slow_down' | 'still' | 'success' | 'tap' | 'approve' | 'status_good' | 'status_talking' | 'status_ask';

export const COLORS = {
  ink: '#111214',
  surface: '#191A1D',
  paper: '#F7F5F0',
  inkMid: '#9A9893',
  hairline: '#2A2B2F',
  other: '#78756E',
  patterns: {
    interrupt: '#E03C31',
    wrap_up: '#D97706',
    filler: '#B48A14',
    slow_down: '#2563EB',
    still: '#7C3AED',
    success: '#16A34A',
    tap: '#F7F5F0',
    approve: '#F7F5F0',
    status_good: '#16A34A',
    status_talking: '#D97706',
    status_ask: '#2563EB',
  } as Record<HapticPattern, string>,
};

export const FONTS = {
  display: 'InstrumentSerif_400Regular',
  displayItalic: 'InstrumentSerif_400Regular_Italic',
  ui: 'Geist_400Regular',
  uiMedium: 'Geist_500Medium',
  uiSemiBold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
};

export const SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const TYPE_SCALE = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  display: 48,
};
