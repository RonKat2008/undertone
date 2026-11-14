import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Line, Polyline, Rect } from 'react-native-svg';
import { getDebrief, listPeople, listSessions, mediaUrl, tagPerson, type DebriefPayload, type Sampled } from '@/api/client';
import type { Debrief, Person, TimelinePoint } from '@/bus/contracts';
import { useBus } from '@/bus/use-bus';
import { Header } from '@/ui/Header';
import { Rule, SampleTag, Screen, T, clock } from '@/ui/kit';
import { C, F, TONE } from '@/ui/theme';

export default function DebriefScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, mode } = useBus();
  const [fetched, setFetched] = useState<Sampled<DebriefPayload> | null>(null);
  const fromBus = !id && state.debrief ? state.debrief : null;

  useEffect(() => {
    if (fromBus) return;
    let on = true;
    (id ? getDebrief(id) : listSessions().then((s) => getDebrief(s.sample ? 'latest' : s.data[0].session_id))).then((r) => on && setFetched(r));
    return () => { on = false; };
  }, [id, fromBus, mode]);

  const payload = fromBus ?? fetched?.data ?? null;
  const sample = fromBus ? mode === 'mock' : fetched?.sample ?? true;
  return (
    <Screen>
      <Header title="Debrief" right={<SampleTag show={sample} />} />
      {payload ? <Body d={payload.data} audio={mediaUrl(payload.audio_url)} sessionId={payload.session_id} /> : <T v="serif" size={28} color={C.paper3}>Fetching the debrief…</T>}
    </Screen>
  );
}

function Recap({ url }: { url: string }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const toggle = () => {
    if (status.playing) return player.pause();
    if (status.duration && status.currentTime >= status.duration - 0.2) void player.seekTo(0);
    player.play();
  };
  const frac = status.duration ? Math.min(1, status.currentTime / status.duration) : 0;
  return (
    <Pressable onPress={toggle} accessibilityRole="button" accessibilityLabel={status.playing ? 'Pause the spoken recap' : 'Play the spoken recap'}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 1, borderColor: C.paper, padding: 14, marginTop: 22, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' }}>
        <T v="mono" size={18} color={C.ink}>{status.playing ? 'II' : '▶'}</T>
      </View>
      <View style={{ flex: 1 }}>
        <T v="serif" size={24}>Spoken recap</T>
        <View style={{ height: 2, backgroundColor: C.rule, marginTop: 8 }}><View style={{ height: 2, width: `${frac * 100}%`, backgroundColor: C.paper }} /></View>
      </View>
    </Pressable>
  );
}

function Body({ d, audio, sessionId }: { d: Debrief; audio: string | null; sessionId: string }) {
  const n = d.numbers;
  return (
    <View>
      <T v="serif" size={36}>{d.headline_fact}</T>

      <T v="caps" style={{ marginTop: 24 }}>What worked</T>
      <T v="body" style={{ marginTop: 4 }}>{d.strength}</T>

      <Rule strong style={{ marginTop: 24, height: 3 }} />
      <T v="caps" color={C.paper} style={{ marginTop: 12 }}>One thing to fix</T>
      <T v="body" size={19} style={{ marginTop: 6 }}>{d.one_fix}</T>
      <View style={{ borderLeftWidth: 3, borderLeftColor: C.paper, paddingLeft: 16, marginTop: 18 }}>
        <T v="serif" size={32} style={{ fontFamily: F.serifItalic }}>{d.if_then}</T>
        <T v="caps" style={{ marginTop: 6 }}>Your plan for next time</T>
      </View>

      {audio ? <Recap url={audio} /> : (
        <View style={{ borderWidth: 1, borderColor: C.rule, padding: 14, marginTop: 22 }}>
          <T v="serif" size={22} color={C.paper2}>Spoken recap</T>
          <T v="small">No recording for this conversation. It plays on the laptop when the voice is switched on.</T>
        </View>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 24, borderTopWidth: 1, borderTopColor: C.paper, paddingTop: 12 }}>
        <Num v={`${Math.round(n.talk_ratio * 100)}%`} l="Talk ratio" big />
        <Num v={String(n.interruptions)} l="Interruptions" />
        <Num v={String(n.questions)} l="Questions" />
        <Num v={n.fillers_per_min.toFixed(1)} l="Fillers / min" />
        <Num v={String(Math.round(n.wpm))} l="Pace, wpm" />
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
          <T v="serif" size={23} style={{ marginTop: 4 }}>“{b.snippet}”</T>
          <T v="small" style={{ marginTop: 6 }}>{b.what_happened}</T>
          {b.follow_up ? <T v="body" size={15} style={{ marginTop: 8 }}><T v="caps" color={TONE.green}>Follow up  </T>{b.follow_up}</T> : null}
        </View>
      ))}

      <T v="caps" color={C.paper} style={{ marginTop: 28 }}>Notes</T>
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
  useEffect(() => { let on = true; listPeople().then((p) => on && setPeople(p.data)); return () => { on = false; }; }, []);
  return (
    <View style={{ marginTop: 32, borderTopWidth: 1, borderTopColor: C.paper, paddingTop: 14 }}>
      <T v="serif" size={28}>{tagged ? `Tagged: ${tagged}` : 'Who was this with?'}</T>
      <T v="small" style={{ marginTop: 4 }}>{tagged ? 'This conversation now counts toward your pattern with them.' : 'Tagging builds a brief for the next time you talk.'}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
        {people.map((p) => (
          <Pressable key={p.person_id} onPress={() => { setTagged(p.name); void tagPerson(sessionId, p.name).catch(() => undefined); }} accessibilityRole="button" accessibilityState={{ selected: tagged === p.name }}
            style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: 18, justifyContent: 'center', borderWidth: 1, borderColor: C.paper, backgroundColor: tagged === p.name ? C.paper : 'transparent', opacity: pressed ? 0.6 : 1 })}>
            <T v="body" color={tagged === p.name ? C.ink : C.paper}>{p.name}</T>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
