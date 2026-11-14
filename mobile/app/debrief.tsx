import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';
import { getDebrief, getTranscript, listPeople, listSessions, mediaUrl, tagPerson, type DebriefPayload, type DebriefView, type Load, type TranscriptResult } from '@/api/client';
import { METRIC_KEYS, isNum, parseDebrief, type MetricKey, type SessionListItem } from '@/api/parse';
import { usePlayback } from '@/audio/player';
import type { HapticPattern, Person, TimelinePoint } from '@/bus/contracts';
import { useBus } from '@/bus/use-bus';
import { Glyph, glyphWidth } from '@/ui/Glyph';
import { Header } from '@/ui/Header';
import { PlayerBar } from '@/ui/PlayerBar';
import { Btn, Label, Rule, Screen, StateMark, T, clock } from '@/ui/kit';
import { Failed, Fetching, Notice, NotPaired } from '@/ui/States';
import { C, F, R, S } from '@/ui/theme';

type Metric = MetricKey;
type Usual = Partial<Record<Metric, number>>;

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

type Fetched = Load<DebriefPayload> | { kind: 'no-sessions' };

/** No id: the latest conversation's debrief. A conversation that closed quietly has none. */
async function readDebrief(id: string | undefined): Promise<Fetched> {
  if (id) return getDebrief(id);
  const list = await listSessions();
  if (list.kind !== 'ok') return list;
  const latest = list.data[0];
  return latest ? getDebrief(latest.session_id) : { kind: 'no-sessions' };
}

export default function DebriefScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, mode } = useBus();
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [past, setPast] = useState<SessionListItem[]>([]);
  const busCopy = state.debrief && (!id || id === state.debrief.session_id) ? state.debrief : null;
  const fromBus = useMemo(() => {
    const data = busCopy ? parseDebrief(busCopy.data) : null;
    return busCopy && data ? { session_id: busCopy.session_id, data, audio_url: busCopy.audio_url || null } : null;
  }, [busCopy]);

  useEffect(() => {
    if (fromBus) return;
    let on = true;
    setFetched(null);
    readDebrief(id).then(
      (r) => { if (on) setFetched(r); },
      () => { if (on) setFetched({ kind: 'error', message: 'Cannot reach the laptop.', unreachable: true }); },
    );
    return () => { on = false; };
  }, [id, fromBus, mode, attempt]);

  // Every number gets a reference: your own usual, the median of your past regular conversations.
  useEffect(() => {
    if (mode === 'unpaired') return;
    let on = true;
    listSessions().then((s) => { if (on && s.kind === 'ok') setPast(s.data); });
    return () => { on = false; };
  }, [mode]);

  const retry = () => setAttempt((n) => n + 1);
  const payload = fromBus ?? (fetched?.kind === 'ok' ? fetched.data : null);
  const others = past.filter((s) => s.mode === 'regular' && s.session_id !== payload?.session_id);
  const usual: Usual = {};
  METRIC_KEYS.forEach((k) => { usual[k] = median(others.map((s) => s.numbers?.[k] ?? null).filter(isNum)); });
  if (isNum(state.metrics?.baseline_wpm) && state.metrics.baseline_wpm > 0) usual.wpm = state.metrics.baseline_wpm; // the wearer's own baseline, when the bus has it
  const nudges = fromBus ? state.marks.filter((m) => m.kind === 'nudge' && m.pattern).map((m) => ({ ts: m.ts, pattern: m.pattern as HapticPattern })) : [];

  const body = mode === 'unpaired' ? <NotPaired />
    : payload ? <Body d={payload.data} audio={mediaUrl(payload.audio_url)} sessionId={payload.session_id} usual={usual} nudges={nudges} baseline={usual.wpm ?? 160} />
      : !fetched ? <Fetching what="Fetching the debrief…" />
        : fetched.kind === 'no-sessions' ? <Notice title="No conversations yet." body="A debrief appears here after a conversation ends." />
          : fetched.kind === 'none' ? (
            <Notice title="No debrief for this one." body="Very short or quiet conversations close without one. If it only just ended, it may still be on its way.">
              <Btn small label="Check again" onPress={retry} style={{ marginTop: S[4], alignSelf: 'flex-start' }} />
            </Notice>
          )
            : fetched.kind === 'error' ? <Failed message={fetched.message} unreachable={fetched.unreachable} onRetry={retry} />
              : <NotPaired />;
  return (
    <Screen>
      <Header title="Debrief" />
      {body}
    </Screen>
  );
}

/** The coach's summary, read aloud by a synthetic voice. Not the conversation itself. */
function Recap({ url }: { url: string }) {
  const pb = usePlayback(url);
  return (
    <View style={{ borderWidth: 1, borderColor: C.ruleStrong, borderRadius: R.key, backgroundColor: C.well, padding: S[4], marginTop: S[6] }}>
      <PlayerBar pb={pb} title="Spoken recap" subtitle="The coach’s summary, read aloud. Not your conversation." what="the spoken recap" />
    </View>
  );
}

/** The real audio of the conversation, and the way into its transcript. */
function Recording({ sessionId, headline }: { sessionId: string; headline: string }) {
  const router = useRouter();
  const [t, setT] = useState<TranscriptResult | null>(null);
  useEffect(() => { let on = true; getTranscript(sessionId).then((r) => on && setT(r)); return () => { on = false; }; }, [sessionId]);
  const url = t?.kind === 'ok' ? mediaUrl(t.data.audio_url) : null;
  const open = () => router.push({ pathname: '/transcript', params: headline ? { id: sessionId, headline } : { id: sessionId } });
  const note = !t ? 'Checking the laptop for a recording…'
    : t.kind === 'not-found' ? 'The laptop has no record of what was said in this one.'
      : t.kind === 'unreachable' || t.kind === 'not-paired' ? 'Cannot reach the laptop to check for a recording.'
        : 'No recording was kept for this one.';
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingTop: S[4], marginTop: S[5] }}>
      {url ? <RecordingPlayer url={url} /> : (
        <View>
          <T v="displayS" color={C.fg2}>Recording</T>
          <T v="small" style={{ marginTop: S[1] }}>{note}</T>
        </View>
      )}
      {t?.kind === 'not-found' ? null : (
        <Pressable onPress={open} accessibilityRole="link" accessibilityLabel="What was said: open the transcript" hitSlop={8}
          style={({ pressed }) => ({ marginTop: S[3], paddingVertical: S[2], alignSelf: 'flex-start', opacity: pressed ? 0.55 : 1 })}>
          <T v="body" style={{ textDecorationLine: 'underline' }}>What was said →</T>
        </Pressable>
      )}
    </View>
  );
}

function RecordingPlayer({ url }: { url: string }) {
  const pb = usePlayback(url);
  return <PlayerBar pb={pb} title="Recording" subtitle="Your actual conversation, as the band heard it." what="the recording" />;
}

const NUMBERS: { k: Metric; what: string; fmt: (v: number) => string }[] = [
  { k: 'talk_ratio', what: 'of the time you talked', fmt: (v) => `${Math.round(v * 100)}%` },
  { k: 'interruptions', what: 'interruptions', fmt: (v) => String(Math.round(v)) },
  { k: 'questions', what: 'questions asked', fmt: (v) => String(Math.round(v)) },
  { k: 'fillers_per_min', what: 'fillers a minute', fmt: (v) => v.toFixed(1) },
  { k: 'wpm', what: 'words a minute', fmt: (v) => String(Math.round(v)) },
];

function Body({ d, audio, sessionId, usual, nudges, baseline }: { d: DebriefView; audio: string | null; sessionId: string; usual: Usual; nudges: { ts: number; pattern: HapticPattern }[]; baseline: number }) {
  return (
    <View>
      {/* the key element: the headline sentence, with a word-sized pace sparkline */}
      <T v="displayL" color={d.headline_fact ? C.fg : C.fg3}>{d.headline_fact || 'No headline for this one.'}</T>
      <Sparkline points={d.timeline} baseline={baseline} />

      {d.strength ? (
        <>
          <Label style={{ marginTop: S[7] }}>What worked</Label>
          <T v="textL" style={{ marginTop: S[2] }}>{d.strength}</T>
        </>
      ) : null}

      {d.one_fix || d.if_then ? <Rule emphasis style={{ marginTop: S[7] }} /> : null}
      {d.one_fix ? (
        <>
          <Label color={C.fg} style={{ marginTop: S[3] }}>One thing to fix</Label>
          <T v="textL" style={{ marginTop: S[2] }}>{d.one_fix}</T>
        </>
      ) : null}
      {/* the plan: a hanging italic with the quote mark in the margin, no left bar */}
      {d.if_then ? (
        <View style={{ marginTop: S[5] }} accessibilityLabel={`Your plan for next time: ${d.if_then}`}>
          <T v="displayM" italic color={C.fg2} style={{ position: 'absolute', left: -15, top: 0 }}>“</T>
          <T v="displayM" italic>{d.if_then}”</T>
          <T v="small" style={{ marginTop: S[2] }}>Your plan for next time</T>
        </View>
      ) : null}

      {audio ? <Recap url={audio} /> : (
        <View style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingTop: S[4], marginTop: S[6] }}>
          <T v="displayS" color={C.fg2}>Spoken recap</T>
          <T v="small" style={{ marginTop: S[1] }}>No spoken recap for this one. The laptop reads the coach’s summary aloud when its voice is switched on.</T>
        </View>
      )}
      <Recording sessionId={sessionId} headline={d.headline_fact} />

      {/* five numbers, each with its own reference inline: never a bare stat tile */}
      <View style={{ marginTop: S[7] }}>
        {NUMBERS.map(({ k, what, fmt }) => {
          const v = d.numbers[k];
          const ref = usual[k];
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: S[3] }}>
              <T v="numL" color={v === null ? C.fg3 : C.fg} style={{ width: 118 }}>{v === null ? '–' : fmt(v)}</T>
              <View style={{ flex: 1 }}>
                <T v="body">{what}</T>
                {ref !== undefined ? <T v="small" color={C.fg3}>usual {fmt(ref)}</T> : null}
              </View>
            </View>
          );
        })}
      </View>
      {d.vs_last_time ? <T v="small" style={{ marginTop: S[2] }}>Against your last time: {d.vs_last_time}</T> : null}

      <Traces points={d.timeline} bookmarks={d.bookmarks.map((b) => b.ts)} nudges={nudges} baseline={baseline} />

      <Label style={{ marginTop: S[7] }}>Bookmarks</Label>
      {d.bookmarks.length === 0 ? <T v="small" style={{ marginTop: S[2] }}>None in this conversation.</T> : null}
      {d.bookmarks.map((b, i) => (
        <View key={i} style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingTop: S[3], marginTop: S[3] }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: S[3] }}>
            <T v="numM">{clock(b.ts)}</T>
            <T v="label">{b.source === 'promise' ? 'promise heard' : 'you tapped'}</T>
          </View>
          {b.snippet ? <T v="displayS" style={{ marginTop: S[2] }}>“{b.snippet}”</T> : null}
          {b.what_happened ? <T v="small" style={{ marginTop: S[2] }}>{b.what_happened}</T> : null}
          {b.follow_up ? (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: S[2], marginTop: S[2] }}>
              <T v="label">follow up</T><T v="body" style={{ flex: 1 }}>{b.follow_up}</T>
            </View>
          ) : null}
        </View>
      ))}

      {d.notes.length > 0 ? <Label style={{ marginTop: S[7] }}>Notes</Label> : null}
      {d.notes.map((note, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: S[3], marginTop: S[2] }}>
          <T v="numS" color={C.fg3} style={{ width: 14, textAlign: 'right', marginTop: 3 }}>{i + 1}</T>
          <T v="body" style={{ flex: 1 }}>{note}</T>
        </View>
      ))}

      {d.best_moment_quote ? (
        <View style={{ marginTop: S[7] }}>
          <Label>Best moment</Label>
          <T v="displayM" italic style={{ marginTop: S[2] }}>“{d.best_moment_quote}”</T>
        </View>
      ) : null}

      <TagPerson sessionId={sessionId} />
    </View>
  );
}

/** Tufte's word-sized line: pace across the conversation, your usual band shaded (§8 Debrief). */
function Sparkline({ points, baseline }: { points: TimelinePoint[]; baseline: number }) {
  const pts = points.filter((p) => p.wpm > 0);
  if (pts.length < 2) return null;
  const W = 64, H = 14, lo = 100, hi = 230;
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const y = (v: number) => H - 1 - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - 2);
  const top = y(baseline * 1.25), bottom = y(baseline * 0.75);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[2], marginTop: S[3] }} accessibilityLabel="Pace across the conversation against your usual band">
      <Svg width={W} height={H}>
        <Rect x={0} width={W} y={top} height={bottom - top} fill={C.well} />
        <Polyline points={pts.map((p) => `${x(p.t).toFixed(1)},${y(p.wpm).toFixed(1)}`).join(' ')} fill="none" stroke={C.fg} strokeWidth={1.25} />
      </Svg>
      <T v="small">pace, against your usual band</T>
    </View>
  );
}

/** Pace, volume and hand energy on one time axis (small multiples, kept). */
function Traces({ points, bookmarks, nudges, baseline }: { points: TimelinePoint[]; bookmarks: number[]; nudges: { ts: number; pattern: HapticPattern }[]; baseline: number }) {
  const [W, setW] = useState(350);
  if (points.length < 2) return null;
  const H = 46;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const rows: { key: 'wpm' | 'volume_db' | 'hand_energy'; label: string; min: number; max: number; band?: [number, number] }[] = [
    { key: 'wpm', label: 'Pace', min: 100, max: 230, band: [baseline * 0.75, baseline * 1.25] },
    { key: 'volume_db', label: 'Volume', min: -34, max: -8 },
    { key: 'hand_energy', label: 'Hand energy', min: 0, max: 1, band: [0.3, 0.7] },
  ];
  return (
    <View style={{ marginTop: S[7] }} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      <Label>Voice and body</Label>
      {rows.map((r) => {
        const pts = points.filter((p) => r.key !== 'wpm' || p.wpm > 0);
        const y = (v: number) => H - 4 - ((Math.min(r.max, Math.max(r.min, v)) - r.min) / (r.max - r.min)) * (H - 8);
        return (
          <View key={r.key} style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingTop: S[2], marginTop: S[2] }}>
            <T v="small" color={C.fg}>{r.label}</T>
            {r.key === 'wpm' && nudges.length ? (
              <View style={{ height: 18, marginTop: S[1] }} accessibilityLabel={`Nudges at ${nudges.map((n) => clock(n.ts)).join(', ')}`}>
                {nudges.map((n, i) => (
                  <View key={i} style={{ position: 'absolute', bottom: 0, left: Math.min(W - glyphWidth(n.pattern, 14), Math.max(0, x(n.ts))) }}>
                    <Glyph pattern={n.pattern} size={14} />
                  </View>
                ))}
              </View>
            ) : null}
            <Svg width={W} height={H}>
              {r.band ? <Rect x={0} width={W} y={y(r.band[1])} height={y(r.band[0]) - y(r.band[1])} fill={C.well} /> : null}
              {bookmarks.filter((t) => t >= t0 && t <= t1).map((t, i) => <Line key={i} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke={C.fg3} strokeWidth={1} strokeDasharray="2 3" />)}
              <Polyline points={pts.map((p) => `${x(p.t).toFixed(1)},${y(p[r.key]).toFixed(1)}`).join(' ')} fill="none" stroke={C.fg} strokeWidth={1.75} />
            </Svg>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: S[1] }}>
        <T v="numS" color={C.fg3}>{clock(t0)}</T>
        <T v="numS" color={C.fg3}>{clock(t1)}</T>
      </View>
      <T v="small" color={C.fg3} style={{ marginTop: S[1] }}>Dashed: bookmarks. Shaded: your usual range.</T>
    </View>
  );
}

function TagPerson({ sessionId }: { sessionId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [tagged, setTagged] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let on = true; listPeople().then((p) => { if (on && p.kind === 'ok') setPeople(p.data); }); return () => { on = false; }; }, []);
  // The laptop creates the person on first tag; until it says yes, nothing is shown as tagged.
  const tag = (name: string) => {
    const clean = name.trim();
    if (!clean) return;
    setError(null);
    setTagged(clean);
    tagPerson(sessionId, clean).then(
      () => setNewName(''),
      (e: unknown) => { setTagged(null); setError(e instanceof Error ? e.message : 'That did not work.'); },
    );
  };
  return (
    <View style={{ marginTop: S[7], borderTopWidth: 1, borderTopColor: C.rule, paddingTop: S[4] }}>
      <T v="displayM">{tagged ? `Tagged: ${tagged}` : 'Who was this with?'}</T>
      <T v="small" style={{ marginTop: S[1] }}>{tagged ? 'This conversation now counts toward your pattern with them.' : 'Tagging builds a brief for the next time you talk.'}</T>
      {/* Errors are ink and words, never vermilion: vermilion is `interrupt`. */}
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[2], marginTop: S[3] }} accessibilityLiveRegion="polite">
          <StateMark kind="fault" /><T v="body" style={{ fontFamily: F.sansMedium, flex: 1 }}>{error}</T>
        </View>
      ) : null}
      {tagged ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: S[3], marginTop: S[4] }}>
          <TextInput value={newName} onChangeText={setNewName} placeholder="Their name" placeholderTextColor={C.fg3} autoCorrect={false} maxLength={40}
            returnKeyType="done" onSubmitEditing={() => tag(newName)} accessibilityLabel="Name of the person this was with"
            style={{ flex: 1, minHeight: 48, fontFamily: F.sans, color: C.fg, fontSize: 16, backgroundColor: C.well, borderWidth: 1, borderColor: C.ruleStrong, borderRadius: R.key, paddingVertical: S[3], paddingHorizontal: 14 }} />
          <Btn small label="Tag" onPress={() => tag(newName)} disabled={!newName.trim()} />
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S[3], marginTop: S[4] }}>
        {people.map((p) => {
          const on = tagged === p.name;
          return (
            <Pressable key={p.person_id} onPress={() => tag(p.name)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: S[5], justifyContent: 'center', borderWidth: 1, borderColor: on ? C.fg : C.ruleStrong, borderRadius: R.key, backgroundColor: on ? C.fg : pressed ? C.rule : C.well })}>
              <T v="body" color={on ? C.bg : C.fg} style={{ fontFamily: F.sansMedium }}>{p.name}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
