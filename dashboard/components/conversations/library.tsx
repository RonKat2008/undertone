'use client';

/**
 * /conversations: a search field and every conversation, grouped by day, newest first.
 * A quiet "Show hidden" brings back the ones that were set aside, each with its reason in
 * plain words. Hide and Show again live in each row's menu; both are optimistic and roll back
 * with a toast when the backend says no. Search and the toggle live in the URL.
 */
import { AudioLines, Eye, EyeOff, MessagesSquare } from 'lucide-react';
import { m, useReducedMotion } from 'motion/react';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { SearchField } from '@/components/conversations/search-field';
import {
  Avatar, Button, EmptyState, ICON, List, ListRow, Menu, Page, Panel, Skeleton, StatusWord, Tooltip, toast,
} from '@/components/ui';
import { listConversations, listPeople, setKept, type LibraryResult } from '@/lib/api/client';
import type { Person } from '@/lib/bus/contracts';
import { useBus } from '@/lib/bus/use-bus';
import { dayHeading, hiddenReason, IN_PROGRESS_HEADLINE, lengthLabel, shownHeadline } from '@/lib/conversations/display';
import { conversationHref } from '@/lib/conversations/links';
import {
  applyKept, dayKey, filterSessions, groupByDay, parseLibraryUrl, restoreSession, timeOfDay, writeLibraryUrl, type LibraryUrlState,
} from '@/lib/conversations/model';
import type { LibrarySession } from '@/lib/conversations/types';
import { motionPresets } from '@/lib/motion';

export function Library() {
  const params = useSearchParams();
  const url = useMemo(() => parseLibraryUrl(params.toString()), [params]);
  const { state } = useBus();
  const [result, setResult] = useState<LibraryResult | null>(null);
  const [list, setList] = useState<LibrarySession[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState(url.q);
  const [showHidden, setShowHidden] = useState(url.all);

  // A conversation ending, or its debrief landing, changes what there is to show.
  const busKey = `${state.session?.endedAt ?? ''}|${state.debrief?.at ?? ''}`;

  useEffect(() => {
    let on = true;
    listConversations(true).then((r) => {
      if (!on) return;
      setResult(r);
      setList(r.data);
    });
    listPeople().then((p) => on && p.ok && setPeople(p.data)).catch(() => undefined);
    return () => { on = false; };
  }, [busKey, attempt]);

  function writeUrl(patch: Partial<LibraryUrlState>) {
    const next = { ...parseLibraryUrl(window.location.search), ...patch };
    window.history.replaceState(null, '', `${window.location.pathname}${writeLibraryUrl(window.location.search, next)}`);
  }

  const names = useMemo(() => new Map(people.map((p) => [p.person_id, p.name])), [people]);
  const personName = (id: string | null) => (id ? names.get(id) ?? null : null);

  async function setShown(session: LibrarySession, kept: boolean) {
    const previous = session;
    setList((l) => applyKept(l, session.session_id, kept));
    try {
      await setKept(session.session_id, kept);
      if (!kept) {
        toast('Hidden', {
          description: showHidden ? undefined : 'Turn on “Show hidden” to see it again.',
          action: { label: 'Undo', onClick: () => void setShown({ ...session, kept: false, kept_reason: null }, true) },
        });
      } else {
        toast('Showing it again');
      }
    } catch {
      setList((l) => restoreSession(l, previous));
      toast.error(kept ? 'Couldn’t show that conversation again. Try once more.' : 'Couldn’t hide that conversation. Try once more.');
    }
  }

  const failed = result !== null && result.source !== 'live';
  const kept = list.filter((s) => s.kept);
  const hiddenCount = list.length - kept.length;
  const pool = showHidden ? list : kept;
  const matched = filterSessions(pool, query, personName);
  const groups = groupByDay(matched);
  const today = dayKey(new Date().toISOString());

  const controls = (
    <div className="mb-8 flex items-center gap-2">
      <SearchField value={query} label="Search conversations" placeholder="Search"
        onChange={(q) => { setQuery(q); writeUrl({ q }); }} />
      {hiddenCount > 0 || showHidden ? (
        <Button variant="ghost" aria-pressed={showHidden} className={showHidden ? '!bg-[var(--accent-wash)] !text-accent' : undefined}
          onClick={() => { setShowHidden(!showHidden); writeUrl({ all: !showHidden }); }}>
          {showHidden ? <Eye {...ICON} aria-hidden /> : <EyeOff {...ICON} aria-hidden />}
          <span className="hidden sm:inline">Show hidden</span>
          <span className="sm:hidden">Hidden</span>
        </Button>
      ) : null}
    </div>
  );

  let body;
  if (!result) body = <LibrarySkeleton />;
  else if (failed) {
    body = (
      <EmptyState mark="offline" action={<Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}>
        Undertone on your laptop isn’t answering, so your conversations can’t load right now.
      </EmptyState>
    );
  } else if (pool.length === 0) {
    body = (
      <EmptyState action={hiddenCount > 0 ? undefined : <Button href="/settings">Set up your band</Button>}>
        {hiddenCount > 0 ? 'Every conversation so far is hidden. Turn on “Show hidden” to see them.' : 'Wear the band and talk. Each conversation shows up here a moment after it ends.'}
      </EmptyState>
    );
  } else if (matched.length === 0) {
    body = (
      <EmptyState mark="none" action={<Button onClick={() => { setQuery(''); writeUrl({ q: '' }); }}>Clear the search</Button>}>
        Nothing matches “{query.trim()}”.
      </EmptyState>
    );
  } else {
    body = (
      <div className="grid gap-8">
        {groups.map((g, gi) => (
          <DayGroup key={g.key} heading={dayHeading(g.key, today)} index={gi}>
            {g.items.map((s) => (
              <Row key={s.session_id} s={s} person={personName(s.person_id)} onShown={(k) => void setShown(s, k)} />
            ))}
          </DayGroup>
        ))}
      </div>
    );
  }

  return (
    <Page title="Conversations">
      {result && !failed && list.length > 0 ? controls : null}
      {body}
    </Page>
  );
}

/** One day: a quiet heading and its conversations in one panel. Day groups rise in, one after another. */
function DayGroup({ heading, index, children }: { heading: string; index: number; children: ReactNode }) {
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  return (
    <m.section aria-label={heading} variants={presets.enter} initial="hidden" animate="shown"
      transition={{ delay: reduced ? 0 : Math.min(index, 4) * 0.06 }}>
      <h2 className="mb-2 px-1 text-caption font-medium text-muted">{heading}</h2>
      <Panel padding="list">
        <List label={`Conversations, ${heading}`} animate={index < 2}>{children}</List>
      </Panel>
    </m.section>
  );
}

function Row({ s, person, onShown }: { s: LibrarySession; person: string | null; onShown: (kept: boolean) => void }) {
  const headline = shownHeadline(s.headline_fact);
  const reason = hiddenReason(s);
  const going = s.headline_fact.trim() === IN_PROGRESS_HEADLINE;
  const length = lengthLabel(s.duration_s);
  const meta = [timeOfDay(s.started_at), length, person].filter(Boolean).join(' · ');
  const label = headline ?? 'this conversation';
  return (
    <ListRow
      href={conversationHref(s.session_id)}
      wrap
      leading={person ? <Avatar name={person} size="md" /> : <NoPerson />}
      title={headline ? <span className={reason ? 'text-muted' : undefined}>{headline}</span>
        : going ? <StatusWord tone="moment">Still going</StatusWord>
          : <span className="font-normal text-muted">No debrief for this one</span>}
      meta={(
        <span className="flex flex-wrap items-center gap-x-2">
          <span>{meta}</span>
          {reason ? <span className="rounded-full bg-surface-2 px-2 text-fg">{reason}</span> : null}
        </span>
      )}
      trailing={(
        <>
          {s.audio_url ? (
            <Tooltip content="Recording kept">
              <span tabIndex={0} role="img" aria-label="Recording kept" className="grid h-8 w-8 place-items-center rounded-full text-conversation focus-visible:outline-2 focus-visible:outline-accent">
                <AudioLines {...ICON} size={16} aria-hidden />
              </span>
            </Tooltip>
          ) : null}
          <Menu label={`More for ${label}`} actions={[
            s.kept
              ? { label: 'Hide', icon: EyeOff, onSelect: () => onShown(false) }
              : { label: 'Show again', icon: Eye, onSelect: () => onShown(true) },
          ]} />
        </>
      )}
    />
  );
}

/** The leading mark for a conversation nobody was tagged in: the conversation hue, not a blank. */
function NoPerson() {
  return (
    <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-[color-mix(in_oklch,var(--kind-conversation)_16%,var(--surface))] text-conversation">
      <MessagesSquare {...ICON} size={16} />
    </span>
  );
}

function LibrarySkeleton() {
  return (
    <div role="status" aria-label="Loading conversations" className="grid gap-8">
      {[3, 2].map((rows, g) => (
        <div key={g}>
          <Skeleton width={90} />
          <Panel padding="list">
            {Array.from({ length: rows }, (_, i) => (
              <div key={i} className="flex items-center gap-3.5 px-3.5 py-3">
                <Skeleton shape="circle" height={36} />
                <div className="flex-1"><Skeleton width={`${70 - i * 12}%`} /><Skeleton width="30%" /></div>
              </div>
            ))}
          </Panel>
        </div>
      ))}
    </div>
  );
}
