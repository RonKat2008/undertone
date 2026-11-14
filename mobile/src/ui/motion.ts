/** Reduced motion (§5.4): AccessibilityInfo.isReduceMotionEnabled, shared by every animated part. */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

let current = false;
const listeners = new Set<(v: boolean) => void>();

function set(v: boolean) {
  if (v === current) return;
  current = v;
  listeners.forEach((l) => l(v));
}

AccessibilityInfo.isReduceMotionEnabled().then(set).catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', set);

/** For effects that only need the value at the moment they run. */
export function reduceMotionNow(): boolean {
  return current;
}

export function useReduceMotion(): boolean {
  const [v, setV] = useState(current);
  useEffect(() => {
    listeners.add(setV);
    setV(current);
    return () => { listeners.delete(setV); };
  }, []);
  return v;
}
