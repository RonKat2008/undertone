'use client';

import { m } from 'motion/react';
import { Feather, House, MessagesSquare, Settings2, Waypoints, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { ShellStatus } from '@/components/shell-status';
import { MotionProvider } from '@/components/ui/motion-provider';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { BusProvider } from '@/lib/bus/use-bus';
import { ICON } from '@/components/ui/icon';
import { SPRING } from '@/lib/motion';

interface Destination {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Older routes that belong to this destination until the page builders redirect them. */
  also: string[];
}

/** Five destinations. Nothing else goes in the navigation. */
const NAV: Destination[] = [
  { href: '/', label: 'Home', icon: House, also: [] },
  { href: '/insights', label: 'Insights', icon: Waypoints, also: [] },
  { href: '/conversations', label: 'Conversations', icon: MessagesSquare, also: ['/debrief'] },
  { href: '/coach', label: 'Coach', icon: Feather, also: ['/studio', '/live'] },
  { href: '/settings', label: 'Settings', icon: Settings2, also: ['/pair', '/calibration'] },
];

/** How long the Rehearse page holds a nudge on screen. Kept here for components/live until it is rebuilt. */
export const TAKEOVER_MS = 2500;

/** m:ss, or h:mm:ss past an hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
}

function isActive(path: string, d: Destination): boolean {
  const match = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`));
  return match(d.href) || d.also.some(match);
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <BusProvider>
      <MotionProvider>
        <TooltipProvider>
          <a href="#main" className="qi-btn sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50" data-variant="quiet">
            Skip to content
          </a>
          <div className="mx-auto min-h-dvh w-full max-w-[calc(var(--col-wide)+2*var(--gutter))] px-[var(--gutter)]">
            <Masthead />
            <main id="main">{children}</main>
          </div>
          <Toaster />
        </TooltipProvider>
      </MotionProvider>
    </BusProvider>
  );
}

/**
 * Below 640 px: wordmark and status on the first row, the five destinations on the second, where
 * only the current one shows its label (the others are icons with an accessible name).
 * From 640 px: one row, every destination with icon and label. Chrome stays muted; the current destination sits on a soft pill with a teal icon.
 */
function Masthead() {
  const path = usePathname();
  return (
    <header className="grid grid-cols-[1fr_auto] items-center gap-x-8 pt-3 sm:h-16 sm:grid-cols-[auto_1fr_auto] sm:pt-0">
      <Link href="/" className="col-start-1 row-start-1 -mx-1 justify-self-start rounded-[4px] px-1 py-2.5 text-[15px] font-medium leading-6 tracking-[-0.01em] text-fg">
        Undertone
      </Link>
      <nav aria-label="Main" className="col-span-2 col-start-1 row-start-2 -mx-2 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:mx-0">
        <ul className="flex items-center gap-1 sm:gap-1.5">
          {NAV.map((d) => (
            <NavItem key={d.href} destination={d} active={isActive(path, d)} />
          ))}
        </ul>
      </nav>
      <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">
        <ShellStatus />
      </div>
    </header>
  );
}

function NavItem({ destination, active }: { destination: Destination; active: boolean }) {
  const Icon = destination.icon;
  return (
    <li className="relative">
      <Link
        href={destination.href}
        aria-current={active ? 'page' : undefined}
        className={`relative flex h-10 min-w-10 items-center justify-center gap-2 rounded-[10px] px-2.5 text-[15px] font-medium leading-6 transition-colors duration-150 ${
          active ? 'text-fg' : 'text-muted hover:text-fg'
        }`}
      >
        {active ? (
          <m.span
            layoutId="nav-current"
            aria-hidden
            className="absolute inset-0 rounded-[10px] bg-[color-mix(in_oklch,var(--text)_8%,transparent)] shadow-[inset_0_0_0_1px_var(--line)]"
            transition={SPRING}
          />
        ) : null}
        <Icon {...ICON} size={active ? 16 : 18} aria-hidden className={`relative sm:size-4 ${active ? 'text-accent' : ''}`} />
        <span className={`relative ${active ? '' : 'max-sm:sr-only'}`}>{destination.label}</span>
      </Link>
    </li>
  );
}
