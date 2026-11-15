import type { Debrief } from '../bus/contracts';

export interface Pairing {
  server_url: string;
  device_id: string;
  device_token: string;
  code: string;
  /** The exact string to encode in the QR code. */
  qr: string;
}

export interface DeviceInfo {
  device_id: string;
  name: string;
  connected: boolean;
  paired: boolean;
  last_seen: number | null;
}

export interface AppInfo {
  app_id: string;
  name: string;
  origin: string | null;
  status: 'pending' | 'approved' | 'revoked';
  created_at: number;
  last_used: number | null;
  buzzes: number;
}

export interface DebriefPayload {
  session_id: string;
  data: Debrief;
  audio_url: string | null;
}
