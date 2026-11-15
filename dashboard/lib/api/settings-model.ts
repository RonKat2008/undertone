/**
 * Pure shaping for the Settings page: backend answers in, plain words out. No fetching here
 * (see settings.ts); everything is unit-tested in settings-model.test.ts.
 */
import type { HapticPattern } from '../bus/contracts';
import type { AppInfo, DeviceInfo } from './types';

// ---------- the band ----------

/** GET /band/status, as the backend sends it (band.status event plus `always_on`). */
export interface BandStatus {
  connected: boolean;
  battery_pct: number | null;
  mic_on: boolean;
  always_on: boolean;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The fields the page shows, or null when the body is not a band status. The transport is dropped on purpose. */
export function parseBandStatus(body: unknown): BandStatus | null {
  if (!isObj(body) || typeof body.connected !== 'boolean' || typeof body.mic_on !== 'boolean') return null;
  const pct = typeof body.battery_pct === 'number' && Number.isFinite(body.battery_pct) ? Math.round(Math.min(100, Math.max(0, body.battery_pct))) : null;
  return { connected: body.connected, mic_on: body.mic_on, battery_pct: pct, always_on: body.always_on === true };
}

export type BatteryTone = 'good' | 'low' | 'empty' | 'unknown';

/** Battery as a word plus the number: "Full, 92%", "Low, 14%". */
export function batteryWords(pct: number | null): { word: string; tone: BatteryTone } {
  if (pct === null) return { word: 'Not reported', tone: 'unknown' };
  if (pct >= 90) return { word: `Full, ${pct}%`, tone: 'good' };
  if (pct >= 40) return { word: `Good, ${pct}%`, tone: 'good' };
  if (pct >= 20) return { word: `Getting low, ${pct}%`, tone: 'low' };
  return { word: `Low, ${pct}%. Charge it soon`, tone: 'empty' };
}

// ---------- the phone ----------

export type PhoneState = 'connected' | 'paired' | 'none';

/** Phones worth listing: paired or connected. A pairing nobody claimed is not a phone yet. */
export function pairedPhones(devices: DeviceInfo[]): DeviceInfo[] {
  return devices
    .filter((d) => d.paired || d.connected)
    .slice().sort((a, b) => Number(b.connected) - Number(a.connected) || (b.last_seen ?? 0) - (a.last_seen ?? 0));
}

export function phoneState(devices: DeviceInfo[]): PhoneState {
  const phones = pairedPhones(devices);
  if (phones.some((d) => d.connected)) return 'connected';
  return phones.length > 0 ? 'paired' : 'none';
}

export const PHONE_WORD: Record<PhoneState, string> = {
  connected: 'Connected',
  paired: 'Paired, not connected',
  none: 'Not paired',
};

/** "K7M2QX" -> "K7M 2QX": two groups of three read and type more easily. */
export function groupCode(code: string): string {
  const c = code.trim().toUpperCase();
  return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

/** The laptop address a phone types by hand: "http://172.20.10.2:8000/" -> "172.20.10.2:8000". */
export function typedAddress(serverUrl: string): string {
  return serverUrl.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '');
}

// ---------- time ----------

/** A past moment in plain words: "just now", "5 minutes ago", "yesterday", "3 days ago". */
export function ago(seconds: number | null | undefined, nowMs: number = Date.now()): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null;
  const s = Math.max(0, nowMs / 1000 - seconds);
  if (s < 90) return 'just now';
  const min = Math.round(s / 60);
  if (min < 60) return `${min} minutes ago`;
  const h = Math.round(s / 3600);
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.round(s / 86400);
  if (d === 1) return 'yesterday';
  if (d < 60) return `${d} days ago`;
  return `${Math.round(d / 30)} months ago`;
}

// ---------- connected apps ----------

/** Pending first (newest ask first), then approved (most recently used first). Removed apps are not shown. */
export function sortApps(apps: AppInfo[]): { pending: AppInfo[]; approved: AppInfo[] } {
  return {
    pending: apps.filter((a) => a.status === 'pending').slice().sort((a, b) => b.created_at - a.created_at),
    approved: apps
      .filter((a) => a.status === 'approved')
      .slice().sort((a, b) => (b.last_used ?? 0) - (a.last_used ?? 0) || a.name.localeCompare(b.name)),
  };
}

export function appMeta(app: AppInfo, nowMs: number = Date.now()): string {
  if (app.status === 'pending') {
    const when = ago(app.created_at, nowMs);
    return when ? `Asked ${when}` : 'Waiting for you';
  }
  const used = ago(app.last_used, nowMs);
  return used ? `Last buzzed you ${used}` : 'Has not buzzed you yet';
}

// ---------- test buzzes ----------

export interface BuzzRow {
  pattern: HapticPattern;
  /** What the buzz asks of you, in plain words. */
  title: string;
}

export interface BuzzGroup {
  title: string;
  rows: BuzzRow[];
}

/** Every buzz the phone can play, named by what it means. Pattern ids never reach the screen. */
export const BUZZ_GROUPS: BuzzGroup[] = [
  {
    title: 'Nudges during a conversation',
    rows: [
      { pattern: 'slow_down', title: 'Slow down' },
      { pattern: 'filler', title: 'Pause instead of a filler word' },
      { pattern: 'interrupt', title: 'Let them finish' },
      { pattern: 'wrap_up', title: 'Wrap up and ask a question' },
      { pattern: 'still', title: 'Keep your hands calm' },
      { pattern: 'success', title: 'That worked' },
    ],
  },
  {
    title: 'When you ask how it is going',
    rows: [
      { pattern: 'status_good', title: 'You are doing fine' },
      { pattern: 'status_talking', title: 'You are talking a lot' },
      { pattern: 'status_ask', title: 'Ask them a question' },
    ],
  },
  {
    title: 'Small signals',
    rows: [
      { pattern: 'tap', title: 'Noted' },
      { pattern: 'approve', title: 'Something is waiting for you' },
    ],
  },
];

/** The toast after "Try": whether a phone got it. */
export function buzzResult(delivered: number): { ok: boolean; text: string } {
  if (delivered > 1) return { ok: true, text: `Sent to your ${delivered} phones` };
  if (delivered === 1) return { ok: true, text: 'Sent to your phone' };
  return { ok: false, text: 'No phone is connected' };
}

// ---------- calibration ----------

export const MOTION_PHASES = [
  { id: 'still', title: 'Hold still', hint: 'Rest your hand on the table and keep it there.' },
  { id: 'gesture', title: 'Talk with your hands', hint: 'Move the way you do when you explain something.' },
  { id: 'fidget', title: 'Fidget', hint: 'Tap, twist a pen, bounce your wrist.' },
] as const;

/** Seconds per phase; the backend records each for this long (backend/session.py calibrate_motion). */
export const PHASE_SECONDS = 5;

/** Where a running movement calibration is, from the time since it started. */
export function motionPhase(elapsedMs: number): { index: number; secondsLeft: number; finishing: boolean } {
  const phaseMs = PHASE_SECONDS * 1000;
  const total = phaseMs * MOTION_PHASES.length;
  if (elapsedMs >= total) return { index: MOTION_PHASES.length - 1, secondsLeft: 0, finishing: true };
  const index = Math.max(0, Math.floor(elapsedMs / phaseMs));
  const secondsLeft = Math.max(1, Math.ceil((phaseMs * (index + 1) - Math.max(0, elapsedMs)) / 1000));
  return { index, secondsLeft, finishing: false };
}

// ---------- errors ----------

/**
 * A failure in plain words. Unreachable (status 0) says so; otherwise the backend's own reason,
 * without the address and path the shared client prefixes.
 */
export function plainError(e: unknown, unreachable = 'Undertone can’t reach the server on this laptop.'): string {
  const status = isObj(e) && typeof e.status === 'number' ? e.status : null;
  const message = e instanceof Error ? e.message : '';
  if (status === 0 || /^Cannot reach/i.test(message)) return unreachable;
  if (status === 403) return 'Only this laptop or your paired phone can do that.';
  const said = message.includes(' with: ') ? message.slice(message.indexOf(' with: ') + 7) : message;
  const clean = said.trim().replace(/^HTTP \d+$/, '').replace(/\.$/, '');
  if (!clean) return 'That didn’t work. Try again.';
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}.`;
}
