/**
 * SEAM FILE (plan.md section 7): plays every HapticPattern from contracts with expo-haptics.
 *
 * iOS exposes short taps only (no "vibrate for 400 ms" in Expo Go), so each pattern is a
 * sequence of impacts on timers, built from the same pulse spec the glyphs draw:
 *   - a short pulse   -> one impact, style chosen by its level
 *   - a long pulse    -> impacts repeated every 40 ms for its duration (reads as one buzz)
 *   - a ramp          -> the same, with the style rising soft -> light -> medium -> heavy
 * That gives each pattern a distinct rhythm:
 *   tap . | interrupt X X | filler o | wrap_up . o X | slow_down ~~~~/ | still ~  ~ |
 *   success (system "success") | approve ' ' | status_* one, two or three long even buzzes
 *
 * The app must be in the foreground (the Live screen keeps the screen awake).
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import type { HapticPattern } from '@/bus/contracts';
import { PATTERNS, type Pulse } from '@/bus/patterns';

const { ImpactFeedbackStyle: Style } = Haptics;
const TICK_MS = 40;

let timers: ReturnType<typeof setTimeout>[] = [];
let enabled = true;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  if (!on) stop();
}

export function stop(): void {
  timers.forEach(clearTimeout);
  timers = [];
}

function styleFor(level: number): Haptics.ImpactFeedbackStyle {
  if (level >= 0.9) return Style.Heavy;
  if (level >= 0.55) return Style.Medium;
  if (level >= 0.3) return Style.Light;
  return Style.Soft;
}

function fire(fn: () => Promise<void>): void {
  fn().catch(() => undefined); // a missed tap must never crash the session
}

function at(ms: number, fn: () => Promise<void>): void {
  if (ms <= 0) return fire(fn);
  timers.push(setTimeout(() => fire(fn), ms));
}

function schedulePulse(p: Pulse, pattern: HapticPattern, intensity: number): void {
  const level = Math.max(0.05, Math.min(1, p.level * (0.5 + intensity / 2)));
  if (pattern === 'approve' || (pattern === 'tap' && intensity < 0.5)) {
    return at(p.at, () => Haptics.selectionAsync());
  }
  if (p.shape === 'ramp') {
    const steps = Math.max(4, Math.round(p.dur / TICK_MS));
    for (let i = 0; i < steps; i++) {
      const rise = (i + 1) / steps;
      const style = rise < 0.3 ? Style.Soft : rise < 0.55 ? Style.Light : rise < 0.8 ? Style.Medium : Style.Heavy;
      at(p.at + i * TICK_MS, () => Haptics.impactAsync(style));
    }
    return;
  }
  if (p.dur >= 200) {
    // one long, even buzz
    const style = p.shape === 'soft' ? Style.Soft : styleFor(level);
    const steps = Math.round(p.dur / TICK_MS);
    for (let i = 0; i < steps; i++) at(p.at + i * TICK_MS, () => Haptics.impactAsync(style));
    return;
  }
  const sharp = pattern === 'interrupt' ? Style.Rigid : styleFor(level);
  at(p.at, () => Haptics.impactAsync(sharp));
}

/** Web has no Taptic Engine. Android Chrome can vibrate; iOS Safari cannot (that is the point of the app). */
function playOnWeb(pattern: HapticPattern): void {
  const nav = globalThis.navigator as (Navigator & { vibrate?: (p: number[]) => boolean }) | undefined;
  if (!nav?.vibrate) return;
  const out: number[] = [];
  let cursor = 0;
  for (const p of PATTERNS[pattern].pulses) {
    if (p.at > cursor) out.push(0, p.at - cursor);
    out.push(Math.max(p.dur, 20));
    cursor = p.at + p.dur;
  }
  try { nav.vibrate(out); } catch { /* not allowed without a user gesture */ }
}

/** Play one pattern. A new call cuts off whatever is still playing. `intensity` is 0-1. */
export function play(pattern: HapticPattern, intensity = 1): void {
  if (!enabled || !(pattern in PATTERNS)) return;
  stop();
  if (Platform.OS === 'web') return playOnWeb(pattern);
  if (pattern === 'success') {
    return fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
  }
  for (const pulse of PATTERNS[pattern].pulses) schedulePulse(pulse, pattern, intensity);
}

/** How long the pattern takes, in ms (for callers that queue patterns). */
export function duration(pattern: HapticPattern): number {
  return PATTERNS[pattern]?.total ?? 0;
}
