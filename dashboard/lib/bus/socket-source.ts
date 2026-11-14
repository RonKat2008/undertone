/**
 * SEAM FILE (plan.md section 7): the live source behind the same `useBus()` hook the mock uses.
 *
 * - Events: one WebSocket to `<backend>/ws`; every message is a BusEvent (contracts.ts).
 *   Reconnects with backoff, so a backend restart mid-demo heals by itself.
 * - On connect it reads /health, /coaches and /devices once so the masthead is right
 *   before the first event arrives.
 * - Director commands become REST calls. Start/stop/bookmark/tap use the real session routes.
 *   Test nudges are published on the bus when the backend runs with DEV=1 (takeover + phone);
 *   otherwise they go straight to the phone through /haptics/test.
 */
import type { BusEvent, CoachSpec } from './contracts';
import { PATTERNS } from './patterns';
import type { BusSource, DirectorCommand, SourceHandlers } from './types';

const BACKOFF_MS = [500, 1000, 2000, 4000];

export function toWsUrl(base: string, path: string): string {
  return base.replace(/^http/, 'ws').replace(/\/+$/, '') + path;
}

export function createSocketSource(baseUrl: string): BusSource {
  const base = baseUrl.replace(/\/+$/, '');
  let handlers: SourceHandlers | null = null;
  let ws: WebSocket | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let attempts = 0;
  let stopped = false;
  let sessionStartedAt: number | null = null;

  async function json<T>(path: string, init?: RequestInit): Promise<T | null> {
    try {
      const res = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  }
  const post = <T,>(path: string, body?: unknown) => json<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

  function emit(event: BusEvent): void {
    if (event.type === 'session.started') sessionStartedAt = Date.now();
    if (event.type === 'session.ended') sessionStartedAt = null;
    handlers?.onEvent(event);
  }
  const ts = () => (sessionStartedAt === null ? 0 : +((Date.now() - sessionStartedAt) / 1000).toFixed(1));

  async function hydrate(): Promise<void> {
    const [health, coaches, devices] = await Promise.all([
      json<{ session_id: string | null; active_coach: string }>('/health'),
      json<CoachSpec[]>('/coaches'),
      json<{ devices: { device_id: string; name: string; connected: boolean }[] }>('/devices'),
    ]);
    if (stopped) return;
    const coach = coaches?.find((c) => c.id === health?.active_coach) ?? null;
    if (coach) emit({ type: 'coach.activated', coach });
    for (const d of devices?.devices ?? []) emit({ type: 'device.status', device_id: d.device_id, name: d.name, connected: d.connected });
    // We joined a session that is already running: show it rather than the idle page.
    if (health?.session_id && coach && sessionStartedAt === null) {
      emit({ type: 'session.started', session_id: health.session_id, coach_id: coach.id, mode: 'regular', policy: coach.nudge_policy, ts: 0 });
    }
  }

  function open(): void {
    if (stopped) return;
    handlers?.onStatus(attempts === 0 ? 'connecting' : 'offline');
    let socket: WebSocket;
    try {
      socket = new WebSocket(toWsUrl(base, '/ws'));
    } catch {
      return again();
    }
    ws = socket;
    socket.onopen = () => {
      attempts = 0;
      handlers?.onStatus('live');
      void hydrate();
    };
    socket.onmessage = (msg) => {
      try {
        const data = JSON.parse(String(msg.data)) as BusEvent;
        if (data && typeof data.type === 'string') emit(data);
      } catch {
        /* not JSON: ignore */
      }
    };
    socket.onclose = () => {
      if (ws === socket) ws = null;
      again();
    };
    socket.onerror = () => socket.close();
  }

  function again(): void {
    if (stopped) return;
    handlers?.onStatus('offline');
    const wait = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
    attempts += 1;
    retry = setTimeout(open, wait);
  }

  function send(command: DirectorCommand): void {
    switch (command.cmd) {
      case 'start':
        void post('/session/start', { mode: command.mode });
        return;
      case 'stop':
      case 'debrief':
        void post('/session/stop');
        return;
      case 'bookmark':
        void post('/session/bookmark', { source: 'phone' });
        return;
      case 'status':
        void post('/session/tap'); // the backend picks the verdict from live metrics
        return;
      case 'nudge': {
        const spec = PATTERNS[command.pattern];
        // With DEV=1 the nudge goes on the bus: the takeover shows and the hub forwards it to the
        // phone. Without DEV there is no /dev/publish, so buzz the phone directly instead.
        void post('/dev/publish', {
          type: 'nudge', rule_id: 'test', haptic: command.pattern, message: spec.action,
          reason: 'Test from the dashboard', confidence: null, latency_ms: 0, budget_left: 0, ts: ts(),
        }).then((ok) => (ok ? null : post('/haptics/test', { pattern: command.pattern, label: spec.action })));
        return;
      }
      case 'signal':
        void post('/dev/publish', { type: 'signal', kind: command.kind, detail: 'Raised from the dashboard', ts: ts() });
        return;
      case 'motion':
        void post('/dev/publish', {
          type: 'motion', state: command.state, speaker_context: 'me', confidence: 0.8, ts: ts(),
          hand_energy: command.state === 'still' ? 0.06 : command.state === 'gesture' ? 0.5 : 0.82,
        });
        return;
      case 'replay':
      case 'seek':
        return; // only the mock can rewind
    }
  }

  return {
    kind: 'socket',
    start(h) {
      handlers = h;
      stopped = false;
      attempts = 0;
      open();
    },
    stop() {
      stopped = true;
      handlers = null;
      if (retry) clearTimeout(retry);
      ws?.close();
      ws = null;
    },
    send,
  };
}
