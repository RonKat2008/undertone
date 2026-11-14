'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useBus } from '@/lib/bus/use-bus';
import { useSyncExternalStore } from 'react';

function subscribe() {
  return () => {};
}
function getSnapshot() {
  return true;
}
function getServerSnapshot() {
  return false;
}

export function Masthead() {
  const pathname = usePathname();
  const { state, startSession, stopSession } = useBus();

  const mounted = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const formatTime = (seconds: number) => {
    if (isNaN(seconds)) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const navLinks = [
    { href: '/', label: 'Live' },
    { href: '/studio', label: 'Studio' },
    { href: '/debrief', label: 'Debrief' },
    { href: '/pair', label: 'Pair & devices' },
    { href: '/calibration', label: 'Calibration' },
  ];

  if (!mounted) return (
    <header className="border-b border-hairline py-3 px-4 min-h-[57px]"></header>
  );

  const sessionActive = state?.sessionStatus === 'active';
  const elapsed = state?.elapsedS || 0;
  const coachName = state?.activeCoach?.name || 'Default Coach';
  
  // We'll infer connected states simply, defaulting to showing some data or "Offline"
  const battery = state?.bandStatus?.battery_pct ?? 100;
  const micOn = state?.bandStatus?.mic_on ?? true;
  const phoneStatus = state?.deviceStatus?.connected ? 'connected' : 'offline'; 

  return (
    <header className="border-b border-hairline py-3 px-4 flex flex-wrap items-center justify-between text-sm gap-y-3 gap-x-6">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <h1 className="font-serif text-2xl m-0 leading-none">Undertone</h1>
        <div className="flex items-center gap-2 text-ink-mid">
          <span>{coachName}</span>
        </div>
        <div className="flex items-center gap-2 text-ink-mid">
          Band: <span className="text-ink">{battery}%</span>
          {micOn && <span className="w-2 h-2 rounded-full bg-blue-500 inline-block" title="Mic On"></span>}
        </div>
        <div className="flex items-center gap-2 text-ink-mid">
          Phone: <span className="text-ink">{phoneStatus}</span>
        </div>
      </div>
      
      <nav className="flex flex-wrap items-center gap-4 text-ink-mid">
        {navLinks.map(link => (
          <Link 
            key={link.href} 
            href={link.href}
            className={`hover:text-ink transition-colors ${pathname === link.href ? 'text-ink font-medium' : ''}`}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-4 ml-auto md:ml-0">
        <div className="font-mono tabular-nums text-base">
          {formatTime(elapsed)}
        </div>
        <button 
          onClick={sessionActive ? stopSession : startSession}
          className="border border-ink px-3 py-1 hover:bg-ink hover:text-paper transition-colors"
        >
          {sessionActive ? 'Stop session' : 'Start session'}
        </button>
      </div>
    </header>
  );
}
