'use client';

/**
 * The conversations library: every kept conversation, by day, newest first. A quiet toggle
 * brings in the captures the automatic filter dropped, dimmed, with the reason and a Keep
 * action; kept ones can be hidden. Overrides are optimistic and roll back on failure.
 * Search and the toggle live in the URL. Refetches when the bus says a conversation ended
 * or its debrief landed.
 */
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { SampleTag } from '@/components/sample-tag';
import { listConversations, listPeople, setKept, type LibraryResult, type Sampled } from '@/lib/api/client';
import type { Person } from '@/lib/bus/contracts';
import { useBus } from '@/lib/bus/use-bus';
import { conversationHref } from '@/lib/conversations/links';
import {
  applyKept, dayKey, filterSessions, groupByDay, longDate, parseLibraryUrl, reasonLabel, relativeDayName, restoreSession,
  timeOfDay, writeLibraryUrl, type LibraryUrlState,
} from '@/lib/conversations/model';
import type { LibrarySession } from '@/lib/conversations/types';
import { duration } from '@/lib/graph/format';

interface RowError { id: string; message: string }

export function Library() {
  const params = useSearchParams();
  const url = useMemo(() => parseLibraryUrl(params.toString()), [params]);
  const { state } = useBus();
  const [result, setResult] = useState<LibraryResult | null>(null);
  const [list, setList] = useState<LibrarySession[]>([]);
  const [people, setPeople] = useState<Sampled<Person[]> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [rowError, setRowError] = useState<RowError | null>(null);
  const [hidden, setHidden] = useState<LibrarySession | null>(null);
  const [query, setQuery] = useState(url.q);

  // A conversation ending, or its debrief landing, changes what there is to show.
  const busKey = `${state.session?.endedAt ?? ''}|${state.debrief?.at ?? ''}`;

  function update(patch: Partial<LibraryUrlState>) {
    const next = { ...parseLibraryUrl(window.location.search), ...patch };
    window.history.replaceState(null, '', `${window.location.pathname}${writeLibraryUrl(window.location.search, next)}`);
  }

  useEffect(() => {
    let on = true;
    listConversations(url.all).then((r) => {
      if (!on) return;
      setResult(r);
      setList(r.data);
    });
    return () => { on = false; };
  }, [url.all, busKey, attempt]);

  useEffect(() => {
    let on = true;
    listPeople().then((p) => on && setPeople(p)).catch(() => undefined);
    return () => { on = false; };
  }, [busKey]);

  // Sample names only label sample conversations, never real ones.
  const names = useMemo(() => {
    const m = new Map<string, string>();
    if (people && result && people.sample === result.sample) for (const p of people.data) m.set(p.person_id, p.name);
    return m;
  }, [people, result]);
  const personName = (id: string | null) => (id ? names.get(id) ?? null : null);

  const visible = url.all ? list : list.filter((s) => s.kept);
  const matched = filterSessions(visible, query, personName);
  const groups = groupByDay(matched);
  const today = dayKey(new Date().toISOString());
  const keptCount = list.filter((s) => s.kept).length;
  const filteredCount = list.length - keptCount;
  const keptMinutes = Math.round(list.filter((s) => s.kept).reduce((m, s) => m + s.duration_s, 0) / 60);

  async function override(session: LibrarySession, kept: boolean) {
    const previous = session;
    setRowError(null);
    setHidden(kept ? null : url.all ? null : session);
    setList((l) => applyKept(l, session.session_id, kept));
    setPending((p) => new Set(p).add(session.session_id));
    try {
      await setKept(session.session_id, kept);
    } catch (e) {
      setList((l) => restoreSession(l, previous));
      setHidden(null);
      setRowError({ id: session.session_id, message: `Could not ${kept ? 'keep' : 'hide'} “${shortHeadline(session)}”: ${e instanceof Error ? e.message : 'the backend did not answer'}. It is back as it was.` });
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(session.session_id); return n; });
    }
  }

  const failed = result && (result.source === 'unreachable' || result.source === 'invalid');

  return (
    <div className="pt-6">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <div className="label flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Library</span>
            {result && <SampleTag show={result.sample} />}
          </div>
          <h1 className="display-l mt-1">Every conversation, word for word.</h1>
        </div>
        {result && !failed && (
          <dl className="flex gap-x-8 border-l border-rule pl-5">
            <div><dt className="label">Kept</dt><dd className="num text-[clamp(26px,3vw,38px)] leading-none">{keptCount}</dd></div>
            <div><dt className="label">Minutes</dt><dd className="num text-[clamp(26px,3vw,38px)] leading-none">{keptMinutes}</dd></div>
            {url.all && <div><dt className="label">Filtered out</dt><dd className="num text-[clamp(26px,3vw,38px)] leading-none text-ink-3">{filteredCount}</dd></div>}
          </dl>
        )}
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-y border-ink py-3">
        <label className="relative w-full sm:w-[300px]">
          <span className="sr-only">Search conversations</span>
          <input type="search" value={query} placeholder="Search headlines and people…" className="field text-[14px]" autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); update({ q: e.target.value }); }}
            onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); update({ q: '' }); } }} />
        </label>
        <button type="button" aria-pressed={url.all} onClick={() => { setHidden(null); update({ all: !url.all }); }}
          className="group flex items-center gap-2 text-[12.5px] text-ink-2 hover:text-ink sm:ml-auto">
          <span aria-hidden className={`flex h-3.5 w-3.5 items-center justify-center rounded-[2px] border transition-colors ${url.all ? 'border-ink bg-ink' : 'border-ink-3 group-hover:border-ink'}`}>
            {url.all && <svg width="9" height="9" viewBox="0 0 9 9"><path d="M1 4.6l2.2 2.2L8 1.8" fill="none" stroke="var(--paper)" strokeWidth="1.6" /></svg>}
          </span>
          Show filtered-out captures
        </button>
      </div>

      {hidden && (
        <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-3 bg-well/60 px-3 py-2 text-[13px]">
          <span>Hidden “{shortHeadline(hidden)}”. It is with the filtered-out captures now.</span>
          <button type="button" className="btn btn-sm" onClick={() => { const s = list.find((x) => x.session_id === hidden.session_id); if (s) void override(s, true); }}>Undo</button>
        </div>
      )}
      {rowError && (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-3 border-l-[3px] border-ink bg-well/60 px-3 py-2">
          <span className="text-[13px]"><span className="label mr-2 inline-flex items-center gap-2 !text-ink"><span className="state state-fault" aria-hidden />Not saved</span>{rowError.message}</span>
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setRowError(null)}>Dismiss</button>
        </div>
      )}

      {!result && <LibraryLoading />}
      {failed && <LibraryUnreachable message={result.error ?? 'Cannot reach the backend.'} onRetry={() => setAttempt((a) => a + 1)} />}
      {result && !failed && visible.length === 0 && <LibraryEmpty all={url.all} />}
      {result && !failed && visible.length > 0 && matched.length === 0 && (
        <div className="py-14">
          <p className="display-m">Nothing matches “{query.trim()}”.</p>
          <p className="mt-2 text-[13px] text-ink-2">Search looks at headlines and the people you tagged{url.all ? '' : ', in kept conversations'}.</p>
          <button type="button" className="btn mt-4" onClick={() => { setQuery(''); update({ q: '' }); }}>Clear the search</button>
        </div>
      )}

      {groups.map((g) => {
        const rel = relativeDayName(g.key, today);
        return (
          <section key={g.key} aria-labelledby={`day-${g.key}`} className="grid gap-x-10 border-b border-rule pb-2 pt-6 md:grid-cols-[200px_minmax(0,1fr)]">
            <h2 id={`day-${g.key}`} className="pb-2 md:sticky md:top-4 md:self-start">
              <span className="display-s block">{rel ?? longDate(g.key, today).split(' ')[0]}</span>
              <span className="label mt-1 block">{rel ? longDate(g.key, today) : longDate(g.key, today).split(' ').slice(1).join(' ')}</span>
            </h2>
            <ul className="border-t border-ink md:border-t-0">
              {g.items.map((s) => (
                <Row key={s.session_id} s={s} person={personName(s.person_id)} busy={pending.has(s.session_id)} failed={rowError?.id === s.session_id}
                  onKeep={() => void override(s, true)} onHide={() => void override(s, false)} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function shortHeadline(s: LibrarySession): string {
  const h = s.headline_fact || 'this conversation';
  return h.length > 56 ? `${h.slice(0, 54).trimEnd()}…` : h;
}

interface RowProps {
  s: LibrarySession;
  person: string | null;
  busy: boolean;
  failed: boolean;
  onKeep: () => void;
  onHide: () => void;
}

function Row({ s, person, busy, failed, onKeep, onHide }: RowProps) {
  const reason = reasonLabel(s);
  const meta = [person ? `with ${person}` : null, s.mode === 'practice' ? 'practice' : null, s.coach_name ? `${s.coach_name} coach` : null].filter(Boolean);
  return (
    <li className={`grid grid-cols-[52px_minmax(0,1fr)_auto] items-start gap-x-4 border-b border-rule py-3.5 last:border-b-0 ${failed ? 'bg-well/60' : ''}`}>
      <div className={`pt-[1px] ${reason ? 'opacity-55' : ''}`}>
        <div className="num text-[14px] leading-tight">{timeOfDay(s.started_at)}</div>
        <div className="num text-[11.5px] text-ink-3">{duration(s.duration_s)}</div>
      </div>
      <div className="min-w-0">
        <Link href={conversationHref(s.session_id)} className={`group block ${reason ? 'opacity-55 hover:opacity-100' : ''} transition-opacity`}>
          <span className="block text-[15px] leading-snug group-hover:underline group-hover:decoration-rule group-hover:underline-offset-4">{s.headline_fact || 'Untitled conversation'}</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-ink-2">
            {meta.map((m) => <span key={m as string}>{m}</span>)}
            {s.audio_url && <RecordingMark />}
          </span>
        </Link>
        {reason && <div className="label mt-1.5 !text-ink-2">Filtered out <span className="text-ink-3">·</span> <span className="normal-case tracking-normal text-[12px] italic">{reason}</span></div>}
      </div>
      <div className="pt-0.5">
        {s.kept
          ? <button type="button" className="btn btn-sm btn-quiet" disabled={busy} onClick={onHide} aria-label={`Hide “${s.headline_fact}” from the library`}>{busy ? 'Hiding…' : 'Hide'}</button>
          : <button type="button" className="btn btn-sm" disabled={busy} onClick={onKeep} aria-label={`Keep “${s.headline_fact}”`}>{busy ? 'Keeping…' : 'Keep'}</button>}
      </div>
    </li>
  );
}

/** A small waveform: this conversation has its recording. */
export function RecordingMark() {
  return (
    <span className="inline-flex items-center gap-1.5" title="The recording was kept">
      <svg width="13" height="10" viewBox="0 0 13 10" aria-hidden>
        {[[0, 4, 2], [3, 1, 8], [6, 3, 4], [9, 0, 10]].map(([x, y, h]) => <rect key={x} x={x + 0.5} y={y} width={1.6} height={h} fill="currentColor" />)}
      </svg>
      <span>recording</span>
    </span>
  );
}

function LibraryLoading() {
  return (
    <div className="pt-6" aria-busy aria-live="polite">
      <span className="sr-only">Loading conversations</span>
      {[0, 1].map((g) => (
        <div key={g} className="grid gap-x-10 border-b border-rule py-5 md:grid-cols-[200px_minmax(0,1fr)]" style={{ opacity: 1 - g * 0.35 }}>
          <div className="h-6 w-24 bg-well" />
          <div className="mt-3 space-y-4 md:mt-0">{[78, 62, 70].map((w) => <div key={w} className="h-3 bg-well" style={{ width: `${w}%` }} />)}</div>
        </div>
      ))}
    </div>
  );
}

function LibraryEmpty({ all }: { all: boolean }) {
  return (
    <div className="py-16">
      <svg width="64" height="20" viewBox="0 0 64 20" aria-hidden>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <rect key={i} x={i * 8} y={9} width={4} height={2} fill="var(--rule)" />)}</svg>
      <p className="display-m mt-3">{all ? 'Nothing captured yet.' : 'No conversations kept yet.'}</p>
      <p className="mt-2 max-w-[50ch] text-[13px] text-ink-2">
        Wear the band through a real conversation. When it ends, the words and the recording land here, and short or background captures are set aside.
      </p>
    </div>
  );
}

function LibraryUnreachable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mt-8 max-w-[64ch] border-l-[3px] border-ink pl-5">
      <div className="label flex items-center gap-2 !text-ink"><span className="state state-fault" aria-hidden />Backend</div>
      <p className="display-m mt-1">The library could not be fetched.</p>
      <p className="mt-3 text-[13.5px] text-ink-2">{message.replace(/\.$/, '')}. Check that the laptop backend is running, then try again.</p>
      <button type="button" className="btn btn-solid mt-5" onClick={onRetry}>Try again</button>
    </div>
  );
}
