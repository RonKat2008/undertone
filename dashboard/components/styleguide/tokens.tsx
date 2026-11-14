/** Token swatches for one theme. Values mirror app/globals.css and scripts/tokens-hex.mjs. */

type Pair = [oklch: string, hex: string];
interface Token { name: string; role: string; dark: Pair; light: Pair }

export const COLOR_TOKENS: Token[] = [
  { name: 'bg', role: 'Page background, under the ambient light', dark: ['oklch(19% 0.018 55)', '#1a120c'], light: ['oklch(97% 0.012 80)', '#f9f4ec'] },
  { name: 'surface', role: 'Panels, menus, dialogs', dark: ['oklch(23.5% 0.02 55)', '#261c15'], light: ['oklch(99.5% 0.005 80)', '#fffdfa'] },
  { name: 'surface-2', role: 'Inputs, quiet buttons, tracks', dark: ['oklch(28% 0.022 55)', '#32261f'], light: ['oklch(94.5% 0.014 80)', '#f2ece3'] },
  { name: 'line', role: 'Hairlines inside lists', dark: ['oklch(33% 0.02 55)', '#3e332c'], light: ['oklch(90% 0.014 80)', '#e3ddd4'] },
  { name: 'line-strong', role: 'Control edges, 3:1 on the background', dark: ['oklch(53% 0.02 60)', '#756960'], light: ['oklch(62% 0.02 70)', '#8e8479'] },
  { name: 'text', role: 'Content', dark: ['oklch(95% 0.012 80)', '#f3eee6'], light: ['oklch(24% 0.02 55)', '#271d16'] },
  { name: 'muted', role: 'Meta lines, hints, idle navigation', dark: ['oklch(76% 0.02 70)', '#baafa4'], light: ['oklch(47% 0.02 60)', '#645850'] },
  { name: 'accent', role: 'Your moment and the action to take', dark: ['oklch(78% 0.11 190)', '#51cec7'], light: ['oklch(52% 0.1 192)', '#007976'] },
  { name: 'on-accent', role: 'Text on a teal fill', dark: ['oklch(21% 0.03 200)', '#051c1e'], light: ['oklch(99% 0.005 80)', '#fefbf8'] },
  { name: 'coach', role: 'The coach’s voice and highlights', dark: ['oklch(82% 0.12 72)', '#f4b768'], light: ['oklch(54% 0.13 58)', '#a55800'] },
  { name: 'danger', role: 'Failed, or about to be destroyed', dark: ['oklch(73% 0.15 28)', '#f87f71'], light: ['oklch(53% 0.18 28)', '#be3029'] },
  { name: 'warn', role: 'Needs attention soon', dark: ['oklch(85% 0.13 92)', '#eccb61'], light: ['oklch(53% 0.12 85)', '#886600'] },
  { name: 'kind-person', role: 'People', dark: ['oklch(76% 0.11 20)', '#ef9494'], light: ['oklch(53% 0.13 20)', '#aa474c'] },
  { name: 'kind-topic', role: 'Topics', dark: ['oklch(76% 0.11 100)', '#c1b35b'], light: ['oklch(53% 0.13 100)', '#7b6c00'] },
  { name: 'kind-habit', role: 'Habits', dark: ['oklch(76% 0.11 140)', '#8bc27f'], light: ['oklch(53% 0.13 140)', '#3e7d2f'] },
  { name: 'kind-promise', role: 'Promises', dark: ['oklch(76% 0.11 245)', '#72b8f2'], light: ['oklch(53% 0.13 245)', '#0a71b1'] },
  { name: 'kind-conversation', role: 'Conversations', dark: ['oklch(76% 0.11 305)', '#c19fe9'], light: ['oklch(53% 0.13 305)', '#7e55a7'] },
];

export function TokenSwatches({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <div data-theme={theme} className="qi-panel" style={{ background: 'var(--bg)' }}>
      <p className="mb-4 text-[15px] font-medium leading-6">{theme === 'dark' ? 'Dark, the default' : 'Light, chosen in Settings'}</p>
      <ul className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
        {COLOR_TOKENS.map((t) => {
          const [oklch, hex] = t[theme];
          return (
            <li key={t.name} className="grid grid-cols-[32px_1fr] items-center gap-3">
              <span className="size-8 rounded-[10px] shadow-[inset_0_0_0_1px_var(--line)]" style={{ background: `var(--${t.name})` }} aria-hidden />
              <span className="min-w-0 text-[13px] leading-[18px]">
                <span className="block font-medium">{t.role}</span>
                <span className="block truncate tabular text-muted" title={oklch}>--{t.name} {hex}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
