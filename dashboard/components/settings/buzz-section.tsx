'use client';

import { useState } from 'react';
import { Button, Disclosure, PatternMark, toast } from '@/components/ui';
import { testBuzz } from '@/lib/api/client';
import type { HapticPattern } from '@/lib/bus/contracts';
import { PATTERNS } from '@/lib/bus/patterns';
import { BUZZ_GROUPS, buzzResult, plainError } from '@/lib/api/settings-model';

/** Every buzz as a plain-word row with its mark and a Try button. Closed by default. */
export function BuzzSection() {
  const [played, setPlayed] = useState<{ pattern: HapticPattern; n: number } | null>(null);
  const [busy, setBusy] = useState<HapticPattern | null>(null);

  async function tryBuzz(pattern: HapticPattern, title: string) {
    setBusy(pattern);
    setPlayed((p) => ({ pattern, n: (p?.n ?? 0) + 1 }));
    try {
      const result = buzzResult(await testBuzz(pattern, title));
      if (result.ok) toast(result.text);
      else toast(result.text, { description: 'Pair your phone above, then try again.' });
    } catch (e) {
      toast.error(`Couldn’t send it. ${plainError(e)}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Disclosure summary="Try each buzz on your phone">
      <div className="grid gap-6 pt-3">
        {BUZZ_GROUPS.map((g) => (
          <div key={g.title}>
            <h3 className="mb-1 text-caption text-muted">{g.title}</h3>
            <ul className="settings-buzz-list">
              {g.rows.map((row) => (
                <li key={row.pattern} className="grid min-h-[56px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-2 sm:grid-cols-[108px_minmax(0,1fr)_auto]">
                  <span className="order-last col-span-2 text-coach sm:order-none sm:col-span-1" aria-hidden>
                    <PatternMark pattern={row.pattern} withLabel={false} size={11}
                      playKey={played?.pattern === row.pattern ? played.n : undefined} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body font-medium text-fg">{row.title}</span>
                    <span className="block text-caption text-muted">{PATTERNS[row.pattern].feel}</span>
                  </span>
                  <Button size="small" loading={busy === row.pattern} onClick={() => void tryBuzz(row.pattern, row.title)}
                    aria-label={`Try ${row.title}`}>Try</Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Disclosure>
  );
}
