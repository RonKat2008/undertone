'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Load something for a key (the view, range and selection it depends on). While the key's answer
 * is pending the result is null, so the screen shows a skeleton and never a previous key's data.
 * `retry` loads the same key again; `quiet` reloads it without going back to the skeleton.
 * A null key loads nothing.
 */
export function useLoad<T>(key: string | null, load: (signal: AbortSignal) => Promise<T>): {
  result: T | null;
  retry: () => void;
  quiet: () => void;
} {
  const [state, setState] = useState<{ key: string | null; attempt: number; result: T | null }>({ key: null, attempt: 0, result: null });
  const [attempt, setAttempt] = useState(0);
  const [loud, setLoud] = useState(true);

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    load(controller.signal).then((result) => {
      if (!controller.signal.aborted) setState({ key, attempt, result });
    });
    return () => controller.abort();
    // `load` is rebuilt every render; the key says when it means something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => { setLoud(true); setAttempt((a) => a + 1); }, []);
  const quiet = useCallback(() => { setLoud(false); setAttempt((a) => a + 1); }, []);
  const current = state.key === key && (state.attempt === attempt || !loud);
  return { result: key !== null && current ? state.result : null, retry, quiet };
}
