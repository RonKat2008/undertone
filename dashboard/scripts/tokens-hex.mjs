/**
 * Prints the colour tokens as sRGB hex with WCAG contrast against the page background and the
 * panel surface. DESIGN.md's hex columns come from this script so the phone app can copy exact
 * values. Run from dashboard/: `node scripts/tokens-hex.mjs` (table) or `--md` (markdown).
 * Keep TOKENS in step with app/globals.css.
 */
import { clampChroma, formatHex, parse, wcagContrast } from 'culori';

/** The five kinds share one lightness and chroma per theme; only the hue changes. */
const KIND_HUES = { person: 20, topic: 100, habit: 140, promise: 245, conversation: 305 };
const kinds = (l, c) => Object.fromEntries(Object.entries(KIND_HUES).map(([k, h]) => [`kind-${k}`, `oklch(${l}% ${c} ${h})`]));

export const TOKENS = {
  dark: {
    bg: 'oklch(19% 0.018 55)',
    surface: 'oklch(23.5% 0.02 55)',
    'surface-2': 'oklch(28% 0.022 55)',
    line: 'oklch(33% 0.02 55)',
    'line-strong': 'oklch(53% 0.02 60)',
    text: 'oklch(95% 0.012 80)',
    muted: 'oklch(76% 0.02 70)',
    accent: 'oklch(78% 0.11 190)',
    'on-accent': 'oklch(21% 0.03 200)',
    coach: 'oklch(82% 0.12 72)',
    danger: 'oklch(73% 0.15 28)',
    warn: 'oklch(85% 0.13 92)',
    ...kinds(76, 0.11),
  },
  light: {
    bg: 'oklch(97% 0.012 80)',
    surface: 'oklch(99.5% 0.005 80)',
    'surface-2': 'oklch(94.5% 0.014 80)',
    line: 'oklch(90% 0.014 80)',
    'line-strong': 'oklch(62% 0.02 70)',
    text: 'oklch(24% 0.02 55)',
    muted: 'oklch(47% 0.02 60)',
    accent: 'oklch(52% 0.1 192)',
    'on-accent': 'oklch(99% 0.005 80)',
    coach: 'oklch(54% 0.13 58)',
    danger: 'oklch(53% 0.18 28)',
    warn: 'oklch(53% 0.12 85)',
    ...kinds(53, 0.13),
  },
};

const hexOf = (value) => formatHex(clampChroma(parse(value), 'oklch'));

if (process.argv.includes('--md')) {
  console.log('| Token | Dark oklch | Dark hex | Light oklch | Light hex |');
  console.log('|---|---|---|---|---|');
  for (const name of Object.keys(TOKENS.dark)) {
    const d = TOKENS.dark[name];
    const l = TOKENS.light[name];
    console.log(`| \`--${name}\` | \`${d}\` | \`${hexOf(d)}\` | \`${l}\` | \`${hexOf(l)}\` |`);
  }
} else {
  for (const [theme, t] of Object.entries(TOKENS)) {
    console.log(`${theme}: on-accent on accent ${wcagContrast(t['on-accent'], t.accent).toFixed(2)}`);
    for (const [name, value] of Object.entries(t)) {
      console.log(`  ${name.padEnd(18)} ${value.padEnd(24)} ${hexOf(value)}  bg ${wcagContrast(value, t.bg).toFixed(2).padStart(5)}  surface ${wcagContrast(value, t.surface).toFixed(2).padStart(5)}`);
    }
  }
}
