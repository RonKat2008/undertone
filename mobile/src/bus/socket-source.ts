/**
 * SEAM FILE (plan.md section 7): the phone's live source, plus pairing storage.
 *
 * Two sockets to the laptop backend:
 *   <server>/ws                                  every BusEvent (drives the screens)
 *   <server>/ws/device/<device_id>?token=...     HapticCommand JSON (drives the Taptic Engine)
 * Both reconnect with backoff. Haptics are played ONLY from the device socket, so a nudge
 * buzzes once even though it also arrives as a `nudge` event.
 *
 * Pairing = {server_url, device_id, device_token}: scanned from the dashboard's QR code or
 * fetched with the 6-character code (POST /pair/claim). Kept in AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BusEvent, CoachSpec, HapticCommand } from './contracts';
import { isPattern } from './patterns';
import type { BusSource, DirectorCommand, SourceHandlers } from './types';

// ---------- pairing storage ----------
export interface Pairing {
  server_url: string;
  device_id: string;
  device_token: string;
}

const KEY = 'undertone:pairing';
export type StoredPairing = Pairing | 'demo' | null;

export async function loadPairing(): Promise<StoredPairing> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (value === 'demo') return 'demo';
    return isPairing(value) ? value : null;
  } catch {
    return null;
  }
}

export async function savePairing(pairing: Pairing | 'demo'): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(pairing));
}

export async function clearPairing(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

function isPairing(v: unknown): v is Pairing {
  const p = v as Pairing | null;
  return !!p && typeof p.server_url === 'string' && typeof p.device_id === 'string' && typeof p.device_token === 'string';
}

/** The text inside the dashboard's QR code. */
export function parseQr(text: string): Pairing | null {
  try {
    const v = JSON.parse(text);
    return isPairing(v) ? { server_url: v.server_url.replace(/\/+$/, ''), device_id: v.device_id, device_token: v.device_token } : null;
  } catch {
    return null;
  }
}

/** "Enter code instead": ask the backend for the pairing behind a 6-character code. */
export async function claimCode(server: string, code: string, name = 'iPhone'): Promise<Pairing> {
  const base = normaliseServer(server);
  let res: Response;
  try {
    res = await fetch(`${base}/pair/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }) });
  } catch {
    throw new Error(`Cannot reach ${base}. Same Wi-Fi as the laptop?`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(res.status === 404 ? 'That code is not on the dashboard right now.' : body?.error?.message ?? `HTTP ${res.status}`);
  // keep the address the phone actually reached; the backend's own idea of its URL may be localhost
  return { server_url: base, device_id: body.device_id, device_token: body.device_token };
}

export function normaliseServer(server: string): string {
  let s = server.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(s)) s = `http://${s}`;
  if (!/:\d+$/.test(s) && !/^https:/.test(s)) s = `${s}:8000`;
  return s;
}

// ---------- the source ----------
const BACKOFF_MS = [500, 1000, 2000, 4000];

function ws(base: string, path: string): string {
  return base.replace(/^http/, 'ws') + path;
}

/** `pairing.device_id` may be empty (EXPO_PUBLIC_BUS_URL without pairing): events only, no haptics. */
export function createSocketSource(pairing: Pairing): BusSource {
  const base = pairing.server_url.replace(/\/+$/, '');
  let handlers: SourceHandlers | null = null;
  let stopped = false;
  let sessionStartedAt: number | null = null;
  const sockets: Partial<Record<'bus' | 'device', WebSocket>> = {};
  const attempts = { bus: 0, device: 0 };
  const timers: Partial<Record<'bus' | 'device', ReturnType<typeof setTimeout>>> = {};
  let ping: ReturnType<typeof setInterval> | null = null;

  const headers = { 'Content-Type': 'application/json', 'X-Device-Token': pairing.device_token };
  async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T | null> {
    try {
      const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }

  function emit(event: BusEvent): void {
    if (event.type === 'session.started') sessionStartedAt = Date.now();
    if (event.type === 'session.ended') sessionStartedAt = null;
    handlers?.onEvent(event);
  }

  async function hydrate(): Promise<void> {
    const [health, coaches] = await Promise.all([
      json<{ session_id: string | null; active_coach: string }>('/health'),
      json<CoachSpec[]>('/coaches'),
    ]);
    if (stopped) return;
    const coach = coaches?.find((c) => c.id === health?.active_coach) ?? null;
    if (coach) emit({ type: 'coach.activated', coach });
    if (health?.session_id && coach && sessionStartedAt === null) {
      emit({ type: 'session.started', session_id: health.session_id, coach_id: coach.id, mode: 'regular', policy: coach.nudge_policy, ts: 0 });
    }
  }

  function open(which: 'bus' | 'device'): void {
    if (stopped) return;
    const url = which === 'bus'
      ? ws(base, '/ws')
      : ws(base, `/ws/device/${encodeURIComponent(pairing.device_id)}?token=${encodeURIComponent(pairing.device_token)}&name=iPhone`);
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      return retry(which);
    }
    sockets[which] = socket;
    socket.onopen = () => {
      attempts[which] = 0;
      if (which === 'bus') {
        handlers?.onStatus('live');
        void hydrate();
      }
    };
    socket.onmessage = (msg) => {
      let data: unknown;
      try { data = JSON.parse(String(msg.data)); } catch { return; }
      const d = data as { type?: string; pattern?: unknown };
      if (which === 'device') {
        if (d?.type === 'haptic' && isPattern(d.pattern)) handlers?.onHaptic?.(data as HapticCommand);
      } else if (typeof d?.type === 'string') {
        emit(data as BusEvent);
      }
    };
    socket.onerror = () => socket.close();
    socket.onclose = (e) => {
      if (sockets[which] === socket) delete sockets[which];
      // 4401: the backend no longer knows this device (new database, or unpaired on the dashboard)
      if (which === 'device' && e.code === 4401) return handlers?.onStatus('offline');
      retry(which);
    };
  }

  function retry(which: 'bus' | 'device'): void {
    if (stopped) return;
    if (which === 'bus') handlers?.onStatus('offline');
    const wait = BACKOFF_MS[Math.min(attempts[which], BACKOFF_MS.length - 1)];
    attempts[which] += 1;
    timers[which] = setTimeout(() => open(which), wait);
  }

  function send(command: DirectorCommand): void {
    switch (command.cmd) {
      case 'start': void json('/session/start', 'POST', { mode: command.mode }); return;
      case 'stop':
      case 'debrief': void json('/session/stop', 'POST', {}); return;
      case 'bookmark': void json('/session/bookmark', 'POST', { source: 'phone' }); return;
      case 'status': void json('/session/tap', 'POST', {}); return;
      case 'nudge': void json('/haptics/test', 'POST', { pattern: command.pattern, label: 'Test from the phone' }); return;
      default: return; // signals, motion and rewinding exist only in the mock
    }
  }

  return {
    kind: 'socket',
    start(h) {
      handlers = h;
      stopped = false;
      h.onStatus('connecting');
      open('bus');
      if (pairing.device_id) open('device');
      // keep-alive so NAT / the venue Wi-Fi does not drop an idle device socket
      ping = setInterval(() => { try { sockets.device?.send('ping'); } catch { /* reconnect handles it */ } }, 20000);
    },
    stop() {
      stopped = true;
      handlers = null;
      if (ping) clearInterval(ping);
      Object.values(timers).forEach((t) => t && clearTimeout(t));
      Object.values(sockets).forEach((s) => s?.close());
    },
    send,
  };
}
