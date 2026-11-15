import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { Inter, Newsreader } from 'next/font/google';
import './globals.css';
import { Shell } from '@/components/shell';
import { THEME_SCRIPT } from '@/components/ui/theme-script';

/** Everything that is not the coach's voice: facts, controls, numbers (tabular), navigation. Weights 400 and 500. */
const inter = Inter({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-inter', display: 'swap' });

/** The coach's voice only: debrief, recap, the home sentence, the one thing to try. Weight 400. */
const newsreader = Newsreader({ subsets: ['latin'], weight: ['400'], style: ['normal'], variable: '--font-newsreader', display: 'swap' });

export const metadata: Metadata = {
  title: 'Undertone',
  description: 'A speech coach you wear in real conversations.',
};

export const viewport: Viewport = {
  themeColor: [{ color: '#1a120c' }],
  colorScheme: 'dark light',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        {/* Applies the saved theme before first paint, so light never flashes dark. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
