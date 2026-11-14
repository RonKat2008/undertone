import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';
import { getDebrief, getTranscript, listPeople, listSessions, mediaUrl, tagPerson, type DebriefPayload, type DebriefView, type Load, type TranscriptResult } from '@/api/client';
import { fmtInt, fmtOne, fmtPct, parseDebrief } from '@/api/parse';
import { usePlayback } from '@/audio/player';
import type { Person, TimelinePoint } from '@/bus/contracts';
import { useBus } from '@/bus/use-bus';
import { Header } from '@/ui/Header';
import { PlayerBar } from '@/ui/PlayerBar';
import { Btn, Rule, Screen, T, clock } from '@/ui/kit';
import { Failed, Fetching, Notice, NotPaired } from '@/ui/States';
import { C, F, TONE } from '@/ui/theme';

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

  const retry = () => setAttempt((n) => n + 1);
  const payload = fromBus ?? (fetched?.kind === 'ok' ? fetched.data : null);
  const body = mode === 'unpaired' ? <NotPaired />
    : payload ? <Body d={payload.data} audio={mediaUrl(payload.audio_url)} sessionId={payload.session_id} />
      : !fetched ? <Fetching what="Fetching the debrief…" />
        : fetched.kind === 'no-sessions' ? <Notice title="No conversations yet." body="A debrief appears here after a conversation ends." />
          : fetched.kind === 'none' ? (
            <Notice title="No debrief for this one." body="Very short or quiet conversations close without one. If it only just ended, it may still be on its way.">
              <Btn small label="Check again" onPress={retry} style={{ marginTop: 16, alignSelf: 'flex-start' }} />
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
    <View style={{ borderWidth: 1, borderColor: C.paper, padding: 14, marginTop: 22 }}>
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
    <View style={{ borderWidth: 1, borderColor: C.rule, padding: 14, marginTop: 12 }}>
      {url ? <RecordingPlayer url={url} /> : (
        <View>
          <T v="serif" size={24} color={C.paper2}>Recording</T>
          <T v="small">{note}</T>
        </View>
      )}
      {t?.kind === 'not-found' ? null : (
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel="What was said: open the transcript" hitSlop={8}
          style={({ pressed }) => ({ marginTop: 12, paddingVertical: 8, alignSelf: 'flex-start', opacity: pressed ? 0.6 : 1 })}>
          <T v="caps" color={C.paper}>What was said  →</T>
        </Pressable>
      )}
    </View>
  );
}

function RecordingPlayer({ url }: { url: string }) {
  const pb = usePlayback(url);
  return <PlayerBar pb={pb} title="Recording" subtitle="Your actual conversation, as the band heard it." what="the recording" />;
}

function Body({ d, audio, sessionId }: { d: DebriefView; audio: string | null; sessionId: string }) {
  const n = d.numbers;
  return (
    <View>
      <T v="serif" size={36} color={d.headline_fact ? undefined : C.paper3}>{d.headline_fact || 'No headline for this one.'}</T>

      {d.strength ? (
        <>
          <T v="caps" style={{ marginTop: 24 }}>What worked</T>
          <T v="body" style={{ marginTop: 4 }}>{d.strength}</T>
        </>
      ) : null}

      {d.one_fix || d.if_then ? <Rule strong style={{ marginTop: 24, height: 3 }} /> : null}
      {d.one_fix ? (
        <>
          <T v="caps" color={C.paper} style={{ marginTop: 12 }}>One thing to fix</T>
          <T v="body" size={19} style={{ marginTop: 6 }}>{d.one_fix}</T>
        </>
      ) : null}
      {d.if_then ? (
        <View style={{ borderLeftWidth: 3, borderLeftColor: C.paper, paddingLeft: 16, marginTop: 18 }}>
          <T v="serif" size={32} style={{ fontFamily: F.serifItalic }}>{d.if_then}</T>
          <T v="caps" style={{ marginTop: 6 }}>Your plan for next time</T>
        </View>
      ) : null}

      {audio ? <Recap url={audio} /> : (
        <View style={{ borderWidth: 1, borderColor: C.rule, padding: 14, marginTop: 22 }}>
          <T v="serif" size={22} color={C.paper2}>Spoken recap</T>
          <T v="small">No spoken recap for this one. The laptop reads the coach’s summary aloud when its voice is switched on.</T>
        </View>
      )}
      <Recording sessionId={sessionId} headline={d.headline_fact} />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 24, borderTopWidth: 1, borderTopColor: C.paper, paddingTop: 12 }}>
        <Num v={fmtPct(n.talk_ratio)} l="Talk ratio" big />
        <Num v={fmtInt(n.interruptions)} l="Interruptions" />
        <Num v={fmtInt(n.questions)} l="Questions" />
        <Num v={fmtOne(n.fillers_per_min)} l="Fillers / min" />
        <Num v={fmtInt(n.wpm)} l="Pace, wpm" />
      </View>
      {d.vs_last_time ? <T v="small" style={{ marginTop: 10 }}>Against your last time: {d.vs_last_time}</T> : null}

      <Traces points={d.timeline} bookmarks={d.bookmarks.map((b) => b.ts)} />

      <T v="caps" color={C.paper} style={{ marginTop: 28 }}>Bookmarks · {d.bookmarks.length}</T>
      {d.bookmarks.length === 0 ? <T v="small" style={{ marginTop: 6 }}>None in this conversation.</T> : null}
      {d.bookmarks.map((b, i) => (
        <View key={i} style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingTop: 12, marginTop: 10 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <T v="mono" size={14}>{clock(b.ts)}</T>
            <T v="caps" color={b.source === 'promise' ? TONE.green : C.paper2}>{b.source === 'promise' ? 'promise heard' : 'you tapped'}</T>
          </View>
          {b.snippet ? <T v="serif" size={23} style={{ marginTop: 4 }}>“{b.snippet}”</T> : null}
          {b.what_happened ? <T v="small" style={{ marginTop: 6 }}>{b.what_happened}</T> : null}
          {b.follow_up ? <T v="body" size={15} style={{ marginTop: 8 }}><T v="caps" color={TONE.green}>Follow up  </T>{b.follow_up}</T> : null}
        </View>
      ))}

      {d.notes.length > 0 ? <T v="caps" color={C.paper} style={{ marginTop: 28 }}>Notes</T> : null}
      {d.notes.map((note, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}><T v="mono" size={13} color={C.paper3}>{i + 1}</T><T v="body" size={15} style={{ flex: 1 }}>{note}</T></View>
      ))}

      {d.best_moment_quote ? (
        <View style={{ marginTop: 28 }}>
          <T v="caps">Best moment</T>
          <T v="serif" size={30} style={{ marginTop: 4 }}>“{d.best_moment_quote}”</T>
        </View>
      ) : null}

      <TagPerson sessionId={sessionId} />
    </View>
  );
}

function Num({ v, l, big }: { v: string; l: string; big?: boolean }) {
  return (
    <View style={{ width: big ? '100%' : '50%', marginBottom: 14 }}>
      <T v="mono" size={big ? 76 : 38} style={{ lineHeight: big ? 76 : 40 }}>{v}</T>
      <T v="caps" style={{ marginTop: 2 }}>{l}</T>
    </View>
  );
}

/** Pace, volume and hand energy on one time axis. */
function Traces({ points, bookmarks }: { points: TimelinePoint[]; bookmarks: number[] }) {
  if (points.length < 2) return null;
  const W = 340, H = 46;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const rows: { key: 'wpm' | 'volume_db' | 'hand_energy'; label: string; min: number; max: number; band?: [number, number] }[] = [
    { key: 'wpm', label: 'Pace', min: 100, max: 230, band: [120, 200] },
    { key: 'volume_db', label: 'Volume', min: -34, max: -8 },
    { key: 'hand_energy', label: 'Hand energy', min: 0, max: 1, band: [0.3, 0.7] },
  ];
  return (
    <View style={{ marginTop: 26 }}>
      <T v="caps" color={C.paper}>Voice and body</T>
      {rows.map((r) => {
        const pts = points.filter((p) => r.key !== 'wpm' || p.wpm > 0);
        const y = (v: number) => H - 4 - ((Math.min(r.max, Math.max(r.min, v)) - r.min) / (r.max - r.min)) * (H - 8);
        return (
          <View key={r.key} style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingTop: 8, marginTop: 8 }}>
            <T v="small" color={C.paper}>{r.label}</T>
            <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
              {r.band ? <Rect x={0} width={W} y={y(r.band[1])} height={y(r.band[0]) - y(r.band[1])} fill={C.well} /> : null}
              {bookmarks.filter((t) => t >= t0 && t <= t1).map((t, i) => <Line key={i} x1={x(t)} x2={x(t)} y1={0} y2={H} stroke={C.paper3} strokeWidth={1} strokeDasharray="2 3" />)}
              <Polyline points={pts.map((p) => `${x(p.t).toFixed(1)},${y(p[r.key]).toFixed(1)}`).join(' ')} fill="none" stroke={C.paper} strokeWidth={1.75} />
            </Svg>
          </View>
        );
      })}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <T v="mono" size={11} color={C.paper3}>{clock(t0)}</T><T v="caps" size={9.5}>dashed: bookmarks · shaded: your usual range</T><T v="mono" size={11} color={C.paper3}>{clock(t1)}</T>
      </View>
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
    <View style={{ marginTop: 32, borderTopWidth: 1, borderTopColor: C.paper, paddingTop: 14 }}>
      <T v="serif" size={28}>{tagged ? `Tagged: ${tagged}` : 'Who was this with?'}</T>
      <T v="small" style={{ marginTop: 4 }}>{tagged ? 'This conversation now counts toward your pattern with them.' : 'Tagging builds a brief for the next time you talk.'}</T>
      {error ? <T v="small" color={TONE.vermilion} style={{ marginTop: 6 }}>{error}</T> : null}
      {tagged ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, marginTop: 12 }}>
          <TextInput value={newName} onChangeText={setNewName} placeholder="Their name" placeholderTextColor={C.paper3} autoCorrect={false} maxLength={40}
            returnKeyType="done" onSubmitEditing={() => tag(newName)} accessibilityLabel="Name of the person this was with"
            style={{ flex: 1, fontFamily: F.sans, color: C.paper, fontSize: 18, borderBottomWidth: 1, borderBottomColor: C.paper2, paddingVertical: 10 }} />
          <Btn small label="Tag" onPress={() => tag(newName)} disabled={!newName.trim()} />
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        {people.map((p) => (
          <Pressable key={p.person_id} onPress={() => tag(p.name)} accessibilityRole="button" accessibilityState={{ selected: tagged === p.name }}
            style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 18, justifyContent: 'center', borderWidth: 1, borderColor: C.paper, backgroundColor: tagged === p.name ? C.paper : 'transparent', opacity: pressed ? 0.6 : 1 })}>
            <T v="body" color={tagged === p.name ? C.ink : C.paper}>{p.name}</T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
