/** Keeping the screen awake during a conversation. */
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';

/**
 * Hold the screen awake while `active`. Unlike mounting `useKeepAwake()`, this survives flipping
 * quickly: it releases only a lock that finished activating, and never lets a release error escape
 * (on web that error is uncaught).
 */
export function useKeepAwakeWhile(active: boolean, tag: string): void {
  useEffect(() => {
    if (!active) return;
    let activated = false;
    let released = false;
    const release = () => { deactivateKeepAwake(tag).catch(() => { /* not held: nothing to release */ }); };
    activateKeepAwakeAsync(tag)
      .then(() => { activated = true; if (released) release(); })
      .catch(() => { /* wake lock unavailable (some browsers): the screen may sleep */ });
    return () => { released = true; if (activated) release(); };
  }, [active, tag]);
}
