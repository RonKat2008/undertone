/**
 * Prints the Quiet Ink colour tokens as sRGB hex, with WCAG contrast against the background
 * and the surface. DESIGN.md's hex column comes from this script, so the phone app can copy
 * exact values. Run from dashboard/: `node scripts/tokens-hex.mjs`.
 * Keep TOKENS in step with app/globals.css.
 */
import { clampChroma, formatHex, parse, wcagContrast } from 'culori';

export const TOKENS = {
  dark: {
    bg: 'oklch(17% 0.008 70)',
    surface: 'oklch(21% 0.008 70)',
    line: 'oklch(30% 0.008 70)',
    'line-strong': 'oklch(51% 0.008 70)',
    text: 'oklch(93% 0.008 85)',
    muted: 'oklch(68% 0.01 80)',
    accent: 'oklch(74% 0.09 195)',
    'on-accent': 'oklch(17% 0.008 70)',
    danger: 'oklch(72% 0.13 28)',
    warn: 'oklch(82% 0.1 80)',
  },
  light: {
    bg: 'oklch(98.5% 0.005 85)',
    surface: 'oklch(96% 0.006 85)',
    line: 'oklch(90% 0.006 85)',
    'line-strong': 'oklch(62% 0.008 80)',
    text: 'oklch(22% 0.01 70)',
    muted: 'oklch(50% 0.01 70)',
    accent: 'oklch(50% 0.09 195)',
    'on-accent': 'oklch(98.5% 0.005 85)',
    danger: 'oklch(52% 0.17 28)',
    warn: 'oklch(52% 0.11 70)',
  },
};

const rows = [];
for (const [theme, tokens] of Object.entries(TOKENS)) {
  for (const [name, value] of Object.entries(tokens)) {
    const hex = formatHex(clampChroma(parse(value), 'oklch'));
    const onBg = wcagContrast(value, tokens.bg).toFixed(2);
    const onSurface = wcagContrast(value, tokens.surface).toFixed(2);
    rows.push({ theme, name, value, hex, onBg, onSurface });
  }
}
const onAccent = Object.entries(TOKENS).map(([t, k]) => `${t}: on-accent on accent ${wcagContrast(k['on-accent'], k.accent).toFixed(2)}`);

if (process.argv.includes('--md')) {
  console.log('| Token | Dark oklch | Dark hex | Light oklch | Light hex |');
  console.log('|---|---|---|---|---|');
  for (const name of Object.keys(TOKENS.dark)) {
    const d = rows.find((r) => r.theme === 'dark' && r.name === name);
    const l = rows.find((r) => r.theme === 'light' && r.name === name);
    console.log(`| \`--${name}\` | \`${d.value}\` | \`${d.hex}\` | \`${l.value}\` | \`${l.hex}\` |`);
  }
} else {
  console.table(rows);
  console.log(onAccent.join('\n'));
}
