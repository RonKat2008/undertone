import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Mono, Newsreader } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { Shell } from '@/components/shell';

/** Display: headings, the debrief sentence, the nudge message, the tempo marking. Tabular figures by default. */
const display = Newsreader({ subsets: ['latin'], axes: ['opsz'], style: ['normal', 'italic'], variable: '--font-display', display: 'swap' });

/** Text: UI, transcript, margin notes, real small caps for labels. Self-hosted, SIL OFL 1.1 (app/fonts/OFL.txt). */
const text = localFont({
  variable: '--font-text',
  display: 'swap',
  src: [
    { path: './fonts/Ronzino-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Ronzino-Oblique.woff2', weight: '400', style: 'italic' },
    { path: './fonts/Ronzino-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Ronzino-MediumOblique.woff2', weight: '500', style: 'italic' },
  ],
});

/** Numbers: every changing number, timings, confidence, line numbers. */
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], style: ['normal', 'italic'], variable: '--font-plex-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'Undertone',
  description: 'A speech coach you wear in real conversations.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${text.variable} ${mono.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
