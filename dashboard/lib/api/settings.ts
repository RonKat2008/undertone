/**
 * The Settings page's extra backend calls. Pairing, devices, apps and buzzes reuse client.ts;
 * this adds the band status (with "no band attached" told apart from a failure) and unpairing.
 */
import { apiBase } from '@/lib/config';
import { ApiError, httpErrorMessage, unreachableMessage } from './results';
import { parseBandStatus, type BandStatus } from './settings-model';

export type BandResult =
  | { kind: 'ok'; band: BandStatus }
  /** The backend runs without a band (it has no /band routes, so it answers 404). */
  | { kind: 'none' }
  | { kind: 'error'; error: ApiError };

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const base = apiBase();
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError(unreachableMessage(base), 0);
  }
  const body: unknown = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/** GET /band/status. Never throws. */
export async function getBandStatus(): Promise<BandResult> {
  const path = '/band/status';
  try {
    const { status, body } = await request(path);
    if (status === 404) return { kind: 'none' };
    if (status >= 400) return { kind: 'error', error: new ApiError(httpErrorMessage(apiBase(), path, status, body), status) };
    const band = parseBandStatus(body);
    return band ? { kind: 'ok', band } : { kind: 'error', error: new ApiError('The band status could not be read.', 200) };
  } catch (e) {
    return { kind: 'error', error: e instanceof ApiError ? e : new ApiError(unreachableMessage(apiBase()), 0) };
  }
}

/** DELETE /devices/{id}: forget a paired phone. Throws an ApiError on failure. */
export async function unpairDevice(device_id: string): Promise<void> {
  const path = `/devices/${encodeURIComponent(device_id)}`;
  const { status, body } = await request(path, { method: 'DELETE' });
  if (status >= 400) throw new ApiError(httpErrorMessage(apiBase(), path, status, body), status);
}
