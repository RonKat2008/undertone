/** Token swatches for one theme. Values mirror app/globals.css and scripts/tokens-hex.mjs. */

interface Token { name: string; role: string; dark: [string, string]; light: [string, string] }

const COLOR_TOKENS: Token[] = [
  { name: 'bg', role: 'Page background', dark: ['oklch(17% 0.008 70)', '#120f0c'], light: ['oklch(98.5% 0.005 85)', '#fcfaf6'] },
  { name: 'surface', role: 'Inputs, popovers, the pressed segment', dark: ['oklch(21% 0.008 70)', '#1b1814'], light: ['oklch(96% 0.006 85)', '#f4f1ed'] },
  { name: 'line', role: 'Hairlines between groups and rows', dark: ['oklch(30% 0.008 70)', '#302d2a'], light: ['oklch(90% 0.006 85)', '#e0deda'] },
  { name: 'line-strong', role: 'Control borders, 3:1 on the background', dark: ['oklch(51% 0.008 70)', '#696561'], light: ['oklch(62% 0.008 80)', '#898681'] },
  { name: 'text', role: 'Content, the current destination, focus', dark: ['oklch(93% 0.008 85)', '#eae7e2'], light: ['oklch(22% 0.01 70)', '#1e1a16'] },
  { name: 'muted', role: 'Navigation, meta lines, hints, headings', dark: ['oklch(68% 0.01 80)', '#9b9891'], light: ['oklch(50% 0.01 70)', '#67625d'] },
  { name: 'accent', role: 'Your moment, and only that', dark: ['oklch(74% 0.09 195)', '#5ebdbc'], light: ['oklch(50% 0.09 195)', '#007272'] },
  { name: 'on-accent', role: 'Text on an accent fill', dark: ['oklch(17% 0.008 70)', '#120f0c'], light: ['oklch(98.5% 0.005 85)', '#fcfaf6'] },
  { name: 'danger', role: 'Failed, or about to be destroyed', dark: ['oklch(72% 0.13 28)', '#eb8376'], light: ['oklch(52% 0.17 28)', '#b6322b'] },
  { name: 'warn', role: 'Needs attention soon', dark: ['oklch(82% 0.1 80)', '#e6bd77'], light: ['oklch(52% 0.11 70)', '#915c08'] },
];

export function TokenSwatches({ theme }: { theme: 'dark' | 'light' }) {
  return (
    <div data-theme={theme} className="rounded-[8px] border border-line bg-bg p-5 text-fg">
      <p className="mb-4 text-[13px] font-medium leading-[18px] text-muted">{theme === 'dark' ? 'Dark, the default' : 'Light, chosen in Settings'}</p>
      <ul className="grid gap-3">
        {COLOR_TOKENS.map((t) => {
          const [oklch, hex] = t[theme];
          return (
            <li key={t.name} className="grid grid-cols-[28px_1fr] items-center gap-3">
              <span className="size-7 rounded-[6px] border border-line" style={{ background: `var(--${t.name})` }} aria-hidden />
              <span className="min-w-0 text-[13px] leading-[18px]">
                <span className="block"><span className="font-medium">--{t.name}</span> <span className="tabular text-muted">{oklch} {hex}</span></span>
                <span className="block truncate text-muted">{t.role}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
