/**
 * Extra backend calls for the Conversations area that client.ts does not have:
 * tagging a conversation with a person, and finding the newest conversation (for /debrief).
 */
import type { Person } from '@/lib/bus/contracts';
import { apiBase } from '@/lib/config';
import { ApiError, httpErrorMessage, isPerson, unreachableMessage, unreadableMessage } from '@/lib/api/results';
import { listConversations } from '@/lib/api/client';

export interface PersonPick {
  name: string;
  /** An existing person's id; leave out to add someone new by name. */
  person_id?: string;
}

/** POST /sessions/{id}/person {name, person_id?}: answers the person's updated card. Throws on failure. */
export async function tagPerson(sessionId: string, pick: PersonPick): Promise<Person> {
  const base = apiBase();
  const path = `/sessions/${encodeURIComponent(sessionId)}/person`;
  let res: Response;
  try {
    res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: pick.name.trim(), ...(pick.person_id ? { person_id: pick.person_id } : {}) }),
    });
  } catch {
    throw new ApiError(unreachableMessage(base), 0);
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(httpErrorMessage(base, path, res.status, body), res.status);
  if (!isPerson(body)) throw new ApiError(unreadableMessage(base, path), 0);
  return body;
}

export type NewestResult = { kind: 'ok'; id: string } | { kind: 'none' } | { kind: 'error' };

/** The newest kept conversation's id, for /debrief with no id. */
export async function newestConversation(): Promise<NewestResult> {
  const r = await listConversations(false);
  if (r.source !== 'live') return { kind: 'error' };
  const newest = [...r.data].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
  return newest ? { kind: 'ok', id: newest.session_id } : { kind: 'none' };
}
