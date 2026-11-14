/**
 * Mock or live? One switch, three ways to set it (first match wins):
 *   1. query param  ?bus=mock | ?bus=live | ?bus=http://192.168.1.20:8000   (remembered for the tab)
 *   2. env var      NEXT_PUBLIC_BUS_URL=http://localhost:8000
 *   3. nothing      -> the mock feed
 * Extra query params for the mock: ?t=46 (start there), ?freeze=1 (hold that moment), ?speed=2.
 */
const DEFAULT_LIVE = 'http://localhost:8000';
const KEY = 'undertone:bus';

export interface BusConfig {
  /** Base HTTP URL of the backend, or null for the mock feed. */
  url: string | null;
  startAt?: number;
  freeze?: boolean;
  speed?: number;
}

function normalise(value: string | null | undefined): string | null | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (value === 'mock') return null;
  if (value === 'live') return DEFAULT_LIVE;
  return value.replace(/^ws/, 'http').replace(/\/ws\/?$/, '').replace(/\/+$/, '');
}

let cached: BusConfig | null = null;

export function getBusConfig(): BusConfig {
  if (cached) return cached;
  const env = normalise(process.env.NEXT_PUBLIC_BUS_URL);
  if (typeof window === 'undefined') return { url: env ?? null };
  const q = new URLSearchParams(window.location.search);
  let chosen = normalise(q.get('bus'));
  try {
    if (chosen !== undefined) window.sessionStorage.setItem(KEY, chosen ?? 'mock');
    else chosen = normalise(window.sessionStorage.getItem(KEY));
  } catch {
    /* private mode: the query param still works for this page */
  }
  const num = (name: string) => (q.get(name) !== null && !Number.isNaN(Number(q.get(name))) ? Number(q.get(name)) : undefined);
  cached = { url: chosen !== undefined ? chosen : env ?? null, startAt: num('t'), freeze: q.get('freeze') === '1', speed: num('speed') };
  return cached;
}

export function apiBase(): string | null {
  return getBusConfig().url;
}
