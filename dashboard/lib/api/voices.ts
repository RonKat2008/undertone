/**
 * Voice memory calls for the Settings page (backend/voices/routes.py). Answers are validated
 * in voices-model.ts; failures are ApiErrors carrying the HTTP status (0 = unreachable).
 */
import { apiBase } from '@/lib/config';
import { ApiError, httpErrorMessage, unreachableMessage, unreadableMessage } from './results';
import { ENROL_SECONDS, parseReprocess, parseVoiceList, parseWearer, type ReprocessResult, type VoiceList, type WearerVoice } from './voices-model';

async function call(path: string, init?: RequestInit): Promise<unknown> {
  const base = apiBase();
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError(unreachableMessage(base), 0);
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(httpErrorMessage(base, path, res.status, body), res.status);
  return body;
}

function valid<T>(body: unknown, parse: (v: unknown) => T | null, path: string): T {
  const out = parse(body);
  if (out === null) throw new ApiError(unreadableMessage(apiBase(), path), 200);
  return out;
}

const post = (path: string, body: unknown = {}) => call(path, { method: 'POST', body: JSON.stringify(body) });
const voicePath = (id: string) => `/voices/${encodeURIComponent(id)}`;

/** GET /voices: whether voice memory is on, the wearer's state and every other voice. */
export async function getVoices(): Promise<VoiceList> {
  return valid(await call('/voices'), parseVoiceList, '/voices');
}

/**
 * POST /voices/wearer/enrol. Blocks for `seconds` while the band records the wearer alone, then
 * learns the voice. 409: voice memory off or no band audio; 422: not enough speech; 503: no voice model.
 */
export async function enrolWearer(seconds: number = ENROL_SECONDS): Promise<WearerVoice> {
  const path = '/voices/wearer/enrol';
  return valid(await post(path, { seconds }), parseWearer, path);
}

/** DELETE /voices/wearer: forget the wearer's voiceprint. */
export async function forgetWearer(): Promise<WearerVoice> {
  return valid(await call('/voices/wearer', { method: 'DELETE' }), parseWearer, '/voices/wearer');
}

/** POST /voices/reprocess with no ids: re-label every recorded conversation (queued in the background). */
export async function reprocessAll(): Promise<ReprocessResult> {
  return valid(await post('/voices/reprocess'), parseReprocess, '/voices/reprocess');
}

/** POST /voices/{id}/name. */
export async function nameVoice(voice_id: string, name: string): Promise<void> {
  await post(`${voicePath(voice_id)}/name`, { name });
}

/** DELETE /voices/{id}: the voiceprint and its samples are deleted. */
export async function forgetVoice(voice_id: string): Promise<void> {
  await call(voicePath(voice_id), { method: 'DELETE' });
}
