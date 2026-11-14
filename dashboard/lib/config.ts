/**
 * Which backend the dashboard talks to (first match wins):
 *   1. query param  ?bus=http://192.168.1.20:8000   (remembered for the tab)
 *   2. env var      NEXT_PUBLIC_BUS_URL=http://localhost:8000
 *   3. nothing      -> the host this page was loaded from, on port 8000
 *                      (localhost on the laptop, the laptop's address from a phone on the same network)
 * There is no offline feed: every screen shows the wearer's real data, or says why it cannot.
 */
export const BACKEND_PORT = 8000;
const KEY = 'undertone:bus';

export interface BusConfig {
  /** Base HTTP URL of the backend. */
  url: string;
}

/** A backend address in canonical form ("ws://h:1/ws/" -> "http://h:1"), or undefined when blank or not an address. */
export function normaliseBusUrl(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const v = value.trim();
  if (!/^(https?|wss?):\/\/[^/\s]+/i.test(v)) return undefined;
  return v.replace(/^ws/i, 'http').replace(/\/ws\/?$/, '').replace(/\/+$/, '');
}

/** The default address: the page's own host on the backend port. */
export function defaultBusUrl(hostname: string | null | undefined): string {
  const host = hostname && hostname.length > 0 ? hostname : 'localhost';
  return `http://${host}:${BACKEND_PORT}`;
}

export interface BusUrlInputs {
  /** The ?bus= query value, if any. */
  query?: string | null;
  /** The value remembered for this tab, if any. */
  stored?: string | null;
  /** NEXT_PUBLIC_BUS_URL. */
  env?: string | null;
  /** window.location.hostname. */
  hostname?: string | null;
}

/** Pure: picks the backend address from the inputs above. */
export function resolveBusUrl({ query, stored, env, hostname }: BusUrlInputs): string {
  return normaliseBusUrl(query) ?? normaliseBusUrl(stored) ?? normaliseBusUrl(env) ?? defaultBusUrl(hostname);
}

let cached: BusConfig | null = null;

export function getBusConfig(): BusConfig {
  if (cached) return cached;
  const env = process.env.NEXT_PUBLIC_BUS_URL;
  if (typeof window === 'undefined') return { url: resolveBusUrl({ env }) };
  const query = normaliseBusUrl(new URLSearchParams(window.location.search).get('bus'));
  let stored: string | null = null;
  try {
    if (query) window.sessionStorage.setItem(KEY, query);
    else stored = window.sessionStorage.getItem(KEY);
  } catch {
    /* private mode: the query param still works for this page */
  }
  cached = { url: resolveBusUrl({ query, stored, env, hostname: window.location.hostname }) };
  return cached;
}

export function apiBase(): string {
  return getBusConfig().url;
}
