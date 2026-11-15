'use client';

import { Activity, Check, Repeat } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Avatar, Button, EmptyState, ICON, List, ListRow, Page, Panel, Section, Skeleton, SkeletonLines, StatusWord, TextLink, toast,
} from '@/components/ui';
import { activateCoach, getProfile, listCoaches, saveCoach } from '@/lib/api/client';
import { canBuildPersonal, goalSentence, shortGoal, habitLines, listensFor, orderCoaches, type HabitDirection } from '@/lib/api/coach';
import type { CoachSpec, HabitProfile } from '@/lib/bus/contracts';
import { useBus } from '@/lib/bus/use-bus';
import { PracticeEntry } from '@/components/practice/practice-entry';
import { BuildCoach } from './build-coach';
import { ListenLines } from './listen-lines';

type Load<T> = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: T };

const DIRECTION_TONE: Record<HabitDirection, 'neutral' | 'quiet' | 'warn'> = { better: 'neutral', same: 'quiet', worse: 'warn' };

export function CoachScreen() {
  const { state, inject } = useBus();
  const [coaches, setCoaches] = useState<Load<CoachSpec[]>>({ kind: 'loading' });
  const [profile, setProfile] = useState<Load<HabitProfile>>({ kind: 'loading' });
  const [switching, setSwitching] = useState<string | null>(null);
  /** Set right after an activation, before the bus echoes it. */
  const [chosen, setChosen] = useState<string | null>(null);

  const loadCoaches = useCallback(async () => {
    try {
      setCoaches({ kind: 'ok', data: await listCoaches() });
    } catch (e) {
      setCoaches({ kind: 'error', message: e instanceof Error ? e.message : 'Could not load your coaches.' });
    }
  }, []);

  const load = useCallback(() => {
    setCoaches({ kind: 'loading' });
    setProfile({ kind: 'loading' });
    void loadCoaches();
    void getProfile().then((p) => setProfile(p.ok ? { kind: 'ok', data: p.data } : { kind: 'error', message: p.error }));
  }, [loadCoaches]);

  useEffect(() => {
    load();
  }, [load]);

  const list = useMemo(() => (coaches.kind === 'ok' ? coaches.data : []), [coaches]);
  const activeId = state.coach?.id ?? chosen;
  const active = useMemo(() => list.find((c) => c.id === activeId) ?? state.coach ?? null, [list, activeId, state.coach]);
  const ordered = useMemo(() => orderCoaches(list, active?.id ?? null), [list, active]);

  async function activate(coach: CoachSpec, save = false) {
    if (coach.id === active?.id && !save) return;
    setSwitching(coach.id);
    try {
      if (save) await saveCoach(coach);
      const on = (await activateCoach(coach.id)) ?? coach;
      inject({ type: 'coach.activated', coach: on });
      setChosen(on.id);
      toast(`${on.name} is your coach now`);
      if (save) void loadCoaches();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not switch coach.');
      throw e;
    } finally {
      setSwitching(null);
    }
  }

  if (coaches.kind === 'error') {
    return (
      <Page title="Coach" lede="Choose who listens with you, and what for.">
        <Panel>
          <EmptyState mark="offline" action={<Button onClick={load}>Try again</Button>}>
            Undertone on this laptop is not answering, so your coaches can’t load.
          </EmptyState>
        </Panel>
      </Page>
    );
  }

  return (
    <Page title="Coach" lede="Choose who listens with you, and what for." width="wide"
      action={<Button href="/live"><Activity {...ICON} size={16} aria-hidden />Rehearse</Button>}>
      <PracticeEntry coachName={active?.name ?? null} />
      <div className="mt-[var(--gap-section)] grid gap-x-8 gap-y-[var(--gap-section)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <div className="min-w-0 max-lg:contents">
          <Section title="Your coach" className="max-lg:order-1">
            <ActiveCoach coach={active} loading={coaches.kind === 'loading'} />
          </Section>
          <Section title="Build a coach" className="max-lg:order-3 max-lg:!mt-0">
            <BuildCoach canPersonal={profile.kind === 'ok' && canBuildPersonal(profile.data)}
              onBuilt={() => void loadCoaches()} onUse={(spec) => activate(spec, true)} />
          </Section>
        </div>
        <div className="min-w-0 max-lg:contents">
          <Section title="Switch coach" className="max-lg:order-2">
            <Panel padding="list">
              {coaches.kind === 'loading' ? <div className="p-5"><SkeletonLines lines={4} label="Loading coaches" /></div> : (
                <List label="Coaches">
                  {ordered.map((c) => {
                    const on = c.id === active?.id;
                    return (
                      <ListRow key={c.id} current={on} title={c.name} meta={shortGoal(c.goal)}
                        leading={<Avatar name={c.name} tone={on ? 'me' : 'coach'} size="sm" />}
                        onSelect={on ? undefined : () => void activate(c).catch(() => undefined)}
                        trailing={on
                          ? <StatusWord tone="moment"><Check {...ICON} size={14} aria-hidden className="-ml-1" />Active</StatusWord>
                          : switching === c.id ? <span className="qi-spinner" aria-label="Switching" /> : <span className="text-caption text-muted">Use</span>} />
                    );
                  })}
                </List>
              )}
            </Panel>
          </Section>
          <Section title="Your habits" className="max-lg:order-4 max-lg:!mt-0" icon={<Repeat {...ICON} size={16} aria-hidden className="text-habit" />}
            aside={<TextLink href="/insights?view=habits" tone="muted">See all in Insights</TextLink>}>
            <Habits profile={profile} />
          </Section>
        </div>
      </div>
    </Page>
  );
}

function ActiveCoach({ coach, loading }: { coach: CoachSpec | null; loading: boolean }) {
  if (loading && !coach) {
    return (
      <Panel>
        <div className="grid gap-3" role="status" aria-label="Loading your coach">
          <Skeleton width="40%" />
          <Skeleton width="80%" />
          <Skeleton shape="block" height={160} />
        </div>
      </Panel>
    );
  }
  if (!coach) {
    return (
      <Panel>
        <EmptyState mark="idle">No coach is active yet. Pick one from the list, or build your own.</EmptyState>
      </Panel>
    );
  }
  return (
    <Panel tone="moment" className="relative overflow-hidden">
      <div className="flex items-start gap-4">
        <Avatar name={coach.name} tone="coach" size="lg" />
        <div className="min-w-0">
          <h3 className="text-title text-fg text-balance">{coach.name}</h3>
          <p className="font-voice text-lead mt-1 text-pretty text-fg/90">{goalSentence(coach.goal)}</p>
        </div>
      </div>
      <div className="mt-6">
        <p className="text-body mb-2 font-medium text-fg">What it listens for</p>
        <ListenLines lines={listensFor(coach)} />
      </div>
    </Panel>
  );
}

function Habits({ profile }: { profile: Load<HabitProfile> }) {
  if (profile.kind === 'loading') return <Panel><SkeletonLines lines={3} label="Loading your habits" /></Panel>;
  if (profile.kind === 'error') return <Panel><p className="text-body text-muted">Your habits can’t load right now.</p></Panel>;
  const lines = habitLines(profile.data);
  if (lines.length === 0) {
    return <Panel><p className="text-body text-muted">After a few conversations, the habits that keep coming up appear here.</p></Panel>;
  }
  return (
    <Panel padding="list">
      <List label="Your habits">
        {lines.map((h) => (
          <ListRow key={h.key} title={h.label} meta={h.often}
            trailing={<StatusWord tone={DIRECTION_TONE[h.direction]}>{h.trend}</StatusWord>} />
        ))}
      </List>
    </Panel>
  );
}
