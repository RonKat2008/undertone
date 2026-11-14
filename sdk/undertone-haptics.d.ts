/** Types for undertone-haptics.js. Pattern names match contracts/events.ts `HapticPattern`. */

export type HapticPattern =
  | 'tap' // 1 light tick
  | 'interrupt' // 2 sharp heavy taps
  | 'filler' // 1 short medium
  | 'wrap_up' // 3 rising taps
  | 'slow_down' // long soft ramp
  | 'still' // 2 soft slow pulses
  | 'success' // bright double
  | 'approve' // 2 selection ticks
  | 'status_good' // 1 slow, even buzz
  | 'status_talking' // 2 slow, even buzzes
  | 'status_ask'; // 3 slow, even buzzes

export type AppStatus = 'pending' | 'approved' | 'revoked';

export interface ConnectOptions {
  /** Base URL of the Undertone backend, e.g. "http://192.168.1.20:8000". */
  server: string;
  /** Shown to the wearer on their phone when they approve. */
  appName: string;
  /** Default true: connect() resolves only once the wearer has approved. */
  waitForApproval?: boolean;
  /** How long to wait for approval. Default 120 000 ms. */
  timeoutMs?: number;
  /** Called once if approval is still pending, so the page can say "approve on your phone". */
  onPending?: (app: { app_id: string; name: string }) => void;
  /** Drop the stored app key and register again. */
  forget?: boolean;
}

export interface BuzzOptions {
  /** Short text shown on the phone with the buzz. Defaults to the app name. */
  label?: string;
  /** 0-1. Default 1. */
  intensity?: number;
  /** One phone only. Default: every connected phone. */
  deviceId?: string;
}

export interface BuzzResult {
  ok: true;
  /** How many phones received it. 0 means no phone is connected right now. */
  delivered: number;
  pattern: HapticPattern;
}

export interface UndertoneError extends Error {
  name: 'UndertoneError';
  code: 'network' | 'pending' | 'revoked' | 'unauthorized' | 'rate_limited' | 'invalid' | 'timeout' | 'http';
  status: number;
}

export interface UndertoneClient {
  readonly server: string;
  readonly appId: string;
  readonly appName: string;
  readonly patterns: HapticPattern[];
  status(): Promise<AppStatus>;
  waitForApproval(timeoutMs?: number, onPending?: ConnectOptions['onPending']): Promise<void>;
  buzz(pattern: HapticPattern, options?: BuzzOptions): Promise<BuzzResult>;
}

export interface UndertoneStatic {
  readonly version: string;
  readonly patterns: HapticPattern[];
  connect(options: ConnectOptions): Promise<UndertoneClient>;
  /** Buzz through the client from the most recent connect(). */
  buzz(pattern: HapticPattern, options?: BuzzOptions): Promise<BuzzResult>;
}

declare const Undertone: UndertoneStatic;
export default Undertone;

declare global {
  interface Window {
    Undertone: UndertoneStatic;
  }
  // eslint-disable-next-line no-var
  var Undertone: UndertoneStatic;
}
