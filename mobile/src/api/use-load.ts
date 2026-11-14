import { useCallback, useEffect, useState } from 'react';
import type { Load } from './client';

/**
 * Run a read whenever `key` changes, and again on `retry()`. A refetch keeps showing the last answer
 * until the new one lands; `retry()` clears it so the screen shows it is trying again.
 * `null` means the first answer has not arrived yet.
 */
export function useLoad<T>(read: () => Promise<Load<T>>, key: string): [Load<T> | null, () => void] {
  const [result, setResult] = useState<Load<T> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let on = true;
    read().then(
      (r) => { if (on) setResult(r); },
      (e: unknown) => { if (on) setResult({ kind: 'error', message: e instanceof Error ? e.message : 'Something went wrong.', unreachable: false }); },
    );
    return () => { on = false; };
    // `read` is a new closure every render; `key` names what it reads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => { setResult(null); setAttempt((n) => n + 1); }, []);
  return [result, retry];
}

/** The first failure among several reads, so a screen shows one "Laptop unreachable", not three. */
export function firstError(...loads: (Load<unknown> | null)[]): Extract<Load<unknown>, { kind: 'error' }> | null {
  for (const l of loads) if (l?.kind === 'error') return l;
  return null;
}

export function okData<T>(l: Load<T> | null): T | null {
  return l?.kind === 'ok' ? l.data : null;
}
