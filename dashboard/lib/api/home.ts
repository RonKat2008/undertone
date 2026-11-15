/**
 * The extra reads the Home page needs. Each never throws: it returns the real data, null for
 * "nothing to show" (including a 404 on an optional route), or 'unreachable'.
 */
import type { CoachSpec, NudgeRule } from '@/lib/bus/contracts';
import { apiBase } from '@/lib/config';
import { parseOverview, parsePeople, type HomePerson, type Overview } from './home-model.ts';

export type Read<T> = T | null | 'unreachable';

async function getJson(path: string): Promise<unknown | null | 'unreachable'> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path);
  } catch {
    return 'unreachable';
  }
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/** GET /reports/overview?days=N */
export async function getOverview(days = 7): Promise<Read<Overview>> {
  const body = await getJson(`/reports/overview?days=${days}`);
  if (body === 'unreachable') return body;
  return parseOverview(body);
}

/** GET /reports/by-person?days=N, with the "next time" line from GET /people. */
export async function getHomePeople(days = 30): Promise<Read<HomePerson[]>> {
  const [byPerson, people] = await Promise.all([getJson(`/reports/by-person?days=${days}`), getJson('/people')]);
  if (byPerson === 'unreachable') return byPerson;
  const briefs = new Map<string, string>();
  if (Array.isArray(people)) {
    for (const p of people) {
      if (p && typeof p === 'object' && typeof p.person_id === 'string' && typeof p.brief === 'string') briefs.set(p.person_id, p.brief);
    }
  }
  return parsePeople(byPerson, briefs);
}

export interface ActiveCoach {
  name: string;
  goal: string;
  rules: Pick<NudgeRule, 'id' | 'haptic' | 'message'>[];
}

/** The coach that is listening now: GET /health names it, GET /coaches describes it. */
export async function getActiveCoach(): Promise<Read<ActiveCoach>> {
  const [health, coaches] = await Promise.all([getJson('/health'), getJson('/coaches')]);
  if (health === 'unreachable' || coaches === 'unreachable') return 'unreachable';
  if (!health || typeof health !== 'object' || !Array.isArray(coaches)) return null;
  const id = (health as { active_coach?: unknown }).active_coach;
  const coach = (coaches as CoachSpec[]).find((c) => c && c.id === id);
  if (!coach || typeof coach.name !== 'string') return null;
  const rules = (Array.isArray(coach.nudge_rules) ? coach.nudge_rules : [])
    .filter((r) => r && r.enabled !== false && typeof r.message === 'string')
    .map(({ id: ruleId, haptic, message }) => ({ id: ruleId, haptic, message }));
  return { name: coach.name, goal: typeof coach.goal === 'string' ? coach.goal : '', rules };
}
