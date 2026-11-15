'use client';

/**
 * Everything Home reads, loaded in parallel and refreshed when a conversation ends or its
 * debrief lands. Live state (band, phone, session) comes from the bus, as in the shell.
 */
import { useCallback, useEffect, useState } from 'react';
import { getBandAlwaysOn, getDebrief, listDevices, listSessions, type DebriefPayload, type DeviceInfo } from '@/lib/api/client';
import { getActiveCoach, getHomePeople, getOverview, type ActiveCoach } from '@/lib/api/home';
import { newestConversations, type HomePerson, type Overview } from '@/lib/api/home-model';
import type { SessionSummary } from '@/lib/bus/contracts';
import { isLive } from '@/lib/bus/reducer';
import { useBus } from '@/lib/bus/use-bus';

export interface HomeData {
  phase: 'loading' | 'ready' | 'unreachable';
  sessions: SessionSummary[];
  latest: SessionSummary | null;
  debrief: DebriefPayload | null;
  overview: Overview | null;
  people: HomePerson[];
  coach: ActiveCoach | null;
  paired: boolean | null;
  alwaysOn: boolean | null;
}

const EMPTY: HomeData = {
  phase: 'loading', sessions: [], latest: null, debrief: null, overview: null, people: [], coach: null, paired: null, alwaysOn: null,
};

const real = <T,>(v: T | null | 'unreachable'): T | null => (v === 'unreachable' ? null : v);

async function loadAll(inProgressId: string | null): Promise<HomeData> {
  const [sessions, overview, people, coach, devices, alwaysOn] = await Promise.all([
    listSessions(),
    getOverview(7),
    getHomePeople(30),
    getActiveCoach(),
    listDevices().then((d): DeviceInfo[] | null => d).catch(() => null),
    getBandAlwaysOn(),
  ]);
  if (!sessions.ok && overview === 'unreachable') return { ...EMPTY, phase: 'unreachable' };
  const list = sessions.ok ? newestConversations(sessions.data, inProgressId) : [];
  const latest = list[0] ?? null;
  const d = latest ? await getDebrief(latest.session_id) : null;
  return {
    phase: 'ready',
    sessions: list,
    latest,
    debrief: d?.kind === 'ok' ? d.data : null,
    overview: real(overview),
    people: real(people) ?? [],
    coach: real(coach),
    paired: devices ? devices.some((x) => x.paired) : null,
    alwaysOn,
  };
}

export function useHomeData(): HomeData & { retry: () => void } {
  const { state } = useBus();
  const [data, setData] = useState<HomeData>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  // A conversation ending, its debrief landing, or the laptop coming back changes what there is to show.
  const liveId = isLive(state) && state.session ? state.session.id : null;
  const busKey = `${state.session?.endedAt ?? ''}|${state.debrief?.at ?? ''}|${state.status === 'live'}`;

  useEffect(() => {
    let on = true;
    loadAll(liveId).then((next) => {
      if (on) setData(next);
    });
    return () => {
      on = false;
    };
  }, [busKey, liveId, attempt]);

  const retry = useCallback(() => {
    setData((d) => ({ ...d, phase: 'loading' }));
    setAttempt((a) => a + 1);
  }, []);

  return { ...data, retry };
}
