/**
 * SEAM FILE (plan.md section 7): the phone's live source, plus pairing storage.
 *
 * Two sockets to the laptop backend:
 *   <server>/ws                                  every BusEvent (drives the screens)
 *   <server>/ws/device/<device_id>?token=...     HapticCommand JSON (drives the Taptic Engine)
 * Both reconnect with jittered backoff (0.5 s up to 15 s). Haptics are played ONLY from the device
 * socket, so a nudge buzzes once even though it also arrives as a `nudge` event.
 *
 * All-day use (always-on): Wi-Fi drops and iOS suspending the app are normal, so
 *   - every time the bus socket opens, the phone resyncs: active coach, GET /band/status, and the
 *     open session from /health (a session that closed while we were away is closed here too);
 *   - returning from the background recycles both sockets at once instead of waiting on backoff;
 *   - a 20 s heartbeat pings the device socket and probes /health: two failures in a row mark the
 *     laptop offline and recycle the sockets (a dead Wi-Fi link can leave a socket "open" for minutes).
 *
 * Pairing = {server_url, device_id, device_token}: scanned from the dashboard's QR code or
 * fetched with the 6-character code (POST /pair/claim). Kept in AsyncStorage.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
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
const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000];
const HEARTBEAT_MS = 20000;
const REQUEST_TIMEOUT_MS = 6000;
const PROBE_FAILURES_BEFORE_OFFLINE = 2;

type Which = 'bus' | 'device';

function ws(base: string, path: string): string {
  return base.replace(/^http/, 'ws') + path;
}

/** Backoff for the n-th consecutive failure, with +-20% jitter so phones do not retry in lockstep. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const step = BACKOFF_MS[Math.min(Math.max(0, attempt), BACKOFF_MS.length - 1)];
  return Math.round(step * (0.8 + random() * 0.4));
}

interface Health { session_id: string | null; active_coach: string }

/** `pairing.device_id` may be empty (EXPO_PUBLIC_BUS_URL without pairing): events only, no haptics. */
export function createSocketSource(pairing: Pairing): BusSource {
  const base = pairing.server_url.replace(/\/+$/, '');
  let handlers: SourceHandlers | null = null;
  let stopped = false;
  let openSession: string | null = null; // the session the phone believes is open
  let busUp = false;
  let probeFailures = 0;
  let appState = (AppState.currentState ?? 'active') as AppStateStatus;
  let appSub: { remove(): void } | null = null;
  const sockets: Partial<Record<Which, WebSocket>> = {};
  const attempts: Record<Which, number> = { bus: 0, device: 0 };
  const timers: Partial<Record<Which, ReturnType<typeof setTimeout>>> = {};
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const headers = { 'Content-Type': 'application/json', 'X-Device-Token': pairing.device_token };
  async function json<T>(path: string, method = 'GET', body?: unknown): Promise<T | null> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(base + path, { method, headers, signal: abort.signal, body: body === undefined ? undefined : JSON.stringify(body) });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  function emit(event: BusEvent): void {
    if (event.type === 'session.started') openSession = event.session_id;
    if (event.type === 'session.ended' && event.session_id === openSession) openSession = null;
    handlers?.onEvent(event);
  }

  /** Bring the session in line with what the backend says is open right now. */
  function reconcileSession(health: Health, coach: CoachSpec | null): void {
    if (openSession && openSession !== health.session_id) {
      // it closed while the phone was away (or a new one replaced it): close it here too
      emit({ type: 'session.ended', session_id: openSession });
    }
    if (health.session_id && health.session_id !== openSession && coach) {
      emit({ type: 'session.started', session_id: health.session_id, coach_id: coach.id, mode: 'regular', policy: coach.nudge_policy, ts: 0 });
    }
  }

  /** Runs on every bus (re)connect: everything the phone may have missed while it was away. */
  async function hydrate(): Promise<void> {
    const [health, coaches, band] = await Promise.all([
      json<Health>('/health'),
      json<CoachSpec[]>('/coaches'),
      json<BusEvent>('/band/status'),
    ]);
    if (stopped) return;
    const coach = coaches?.find((c) => c.id === health?.active_coach) ?? null;
    if (coach) emit({ type: 'coach.activated', coach });
    if (band?.type === 'band.status') emit(band);
    if (health) reconcileSession(health, coach);
  }

  function open(which: Which): void {
    if (stopped) return;
    const pending = timers[which];
    if (pending) { clearTimeout(pending); delete timers[which]; }
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
      if (sockets[which] !== socket) return;
      attempts[which] = 0;
      if (which === 'bus') {
        busUp = true;
        probeFailures = 0;
        handlers?.onStatus('live');
        void hydrate();
      }
    };
    socket.onmessage = (msg) => {
      if (sockets[which] !== socket) return;
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
      if (sockets[which] !== socket) return; // a socket we already replaced: its close means nothing
      delete sockets[which];
      // 4401: the backend no longer knows this device (new database, or unpaired on the dashboard)
      if (which === 'device' && e.code === 4401) return handlers?.onStatus('offline');
      retry(which);
    };
  }

  function retry(which: Which): void {
    if (stopped) return;
    if (which === 'bus') { busUp = false; handlers?.onStatus('offline'); }
    const wait = backoffMs(attempts[which]);
    attempts[which] += 1;
    const pending = timers[which];
    if (pending) clearTimeout(pending);
    timers[which] = setTimeout(() => { delete timers[which]; open(which); }, wait);
  }

  /** Drop both sockets and dial again now (after the background, or a failed heartbeat). */
  function recycle(): void {
    if (stopped) return;
    (['bus', 'device'] as const).forEach((which) => {
      const old = sockets[which];
      delete sockets[which]; // detach first, so its close does not schedule a retry
      try { old?.close(); } catch { /* already gone */ }
      attempts[which] = 0;
    });
    if (busUp) { busUp = false; handlers?.onStatus('connecting'); }
    open('bus');
    if (pairing.device_id) open('device');
  }

  async function beat(): Promise<void> {
    if (stopped || appState !== 'active') return;
    try { sockets.device?.send('ping'); } catch { /* the close handler reconnects */ }
    if (!busUp) return; // already reconnecting
    const health = await json<Health>('/health');
    if (stopped) return;
    if (!health) {
      probeFailures += 1;
      if (probeFailures >= PROBE_FAILURES_BEFORE_OFFLINE) {
        probeFailures = 0;
        busUp = false;
        handlers?.onStatus('offline');
        recycle();
      }
      return;
    }
    probeFailures = 0;
    // a missed session.started / session.ended (a frame lost on a flaky link): resync
    if ((health.session_id ?? null) !== openSession) void hydrate();
  }

  function onAppState(next: AppStateStatus): void {
    const wasBackground = appState === 'background';
    appState = next;
    if (next !== 'active') return;
    // iOS suspends JS in the background: the sockets are dead or stale. Dial again now.
    if (wasBackground) recycle();
    else void beat();
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
      // keep-alive so NAT / the venue Wi-Fi does not drop an idle device socket; doubles as a liveness probe
      heartbeat = setInterval(() => { void beat(); }, HEARTBEAT_MS);
      appSub = AppState.addEventListener('change', onAppState);
    },
    stop() {
      stopped = true;
      handlers = null;
      if (heartbeat) clearInterval(heartbeat);
      appSub?.remove();
      appSub = null;
      Object.values(timers).forEach((t) => t && clearTimeout(t));
      (['bus', 'device'] as const).forEach((which) => {
        const s = sockets[which];
        delete sockets[which];
        try { s?.close(); } catch { /* already gone */ }
      });
    },
    send,
  };
}

