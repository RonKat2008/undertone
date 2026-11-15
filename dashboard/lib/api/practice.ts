/**
 * REST reads for spoken practice: GET /practice/results, /practice/results/{id}, /practice/goals.
 * Never throws: each read is real data or a failure that names the address tried.
 */
import { apiBase } from '@/lib/config';
import {
  isPracticeGoals, isPracticeResult, isPracticeResultList,
  type PracticeGoals, type PracticeResult, type PracticeResultSummary,
} from '@/lib/practice/model';
import {
  ApiError, checked, errorMessage, httpErrorMessage, recordFailure, unreachableMessage, unreadableMessage,
  type Fetched, type RecordResult,
} from '@/lib/api/results';

async function getJson(path: string): Promise<unknown> {
  const base = apiBase();
  let res: Response;
  try {
    res = await fetch(base + path, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(unreachableMessage(base), 0);
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(httpErrorMessage(base, path, res.status, body), res.status);
  return body;
}

async function read<T>(path: string, valid: (v: unknown) => v is T): Promise<Fetched<T>> {
  try {
    return checked(await getJson(path), valid, apiBase(), path);
  } catch (e) {
    return { ok: false, error: errorMessage(e, unreachableMessage(apiBase())) };
  }
}

/** Past practices, newest first. */
export const listPracticeResults = (): Promise<Fetched<PracticeResultSummary[]>> => read('/practice/results', isPracticeResultList);

/** The goals set by the latest practice (an empty list before the first one). */
export const getPracticeGoals = (): Promise<Fetched<PracticeGoals>> => read('/practice/goals', isPracticeGoals);

/** One practice result. 'not_found' when there is no such practice. */
export async function getPracticeResult(id: string): Promise<RecordResult<PracticeResult>> {
  const path = `/practice/results/${encodeURIComponent(id)}`;
  try {
    const body = await getJson(path);
    return isPracticeResult(body) ? { kind: 'ok', data: body } : { kind: 'error', message: unreadableMessage(apiBase(), path) };
  } catch (e) {
    return recordFailure(e, apiBase());
  }
}
