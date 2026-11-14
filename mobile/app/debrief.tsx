import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Line, Polygon, Polyline, Rect } from 'react-native-svg';
import { getDebrief, listPeople, listSessions, mediaUrl, tagPerson, type DebriefPayload, type Sampled } from '@/api/client';
import type { Debrief, HapticPattern, Person, SessionSummary, TimelinePoint } from '@/bus/contracts';
import { useBus } from '@/bus/use-bus';
import { Glyph, glyphWidth } from '@/ui/Glyph';
import { Header } from '@/ui/Header';
import { Label, Rule, SampleTag, Screen, T, clock } from '@/ui/kit';
import { C, F, R, S } from '@/ui/theme';

type Metric = keyof Debrief['numbers'];
type Usual = Partial<Record<Metric, number>>;

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export default function DebriefScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { state, mode } = useBus();
  const [fetched, setFetched] = useState<Sampled<DebriefPayload> | null>(null);
  const [past, setPast] = useState<SessionSummary[]>([]);
  const fromBus = !id && state.debrief ? state.debrief : null;

  useEffect(() => {
    if (fromBus) return;
    let on = true;
    (id ? getDebrief(id) : listSessions().then((s) => getDebrief(s.sample ? 'latest' : s.data[0].session_id))).then((r) => on && setFetched(r));
    return () => { on = false; };
  }, [id, fromBus, mode]);

  // Every number gets a reference: your own usual, the median of your past regular conversations.
  useEffect(() => {
    let on = true;
    listSessions().then((s) => on && setPast(s.data));
    return () => { on = false; };
  }, [mode]);

  const payload = fromBus ?? fetched?.data ?? null;
  const sample = fromBus ? mode === 'mock' : fetched?.sample ?? true;
  const others = past.filter((s) => s.mode === 'regular' && s.session_id !== payload?.session_id);
  const usual: Usual = {};
  (['talk_ratio', 'interruptions', 'questions', 'fillers_per_min', 'wpm'] as Metric[]).forEach((k) => { usual[k] = median(others.map((s) => s.numbers[k])); });
  if (fromBus && state.metrics?.baseline_wpm) usual.wpm = state.metrics.baseline_wpm;
  const nudges = fromBus ? state.marks.filter((m) => m.kind === 'nudge' && m.pattern).map((m) => ({ ts: m.ts, pattern: m.pattern as HapticPattern })) : [];

  return (
    <Screen>
      <Header title="Debrief" right={<SampleTag show={sample} />} />
      {payload ? <Body d={payload.data} audio={mediaUrl(payload.audio_url)} sessionId={payload.session_id} usual={usual} nudges={nudges} baseline={usual.wpm ?? 160} />
        : <T v="displayM" color={C.fg3}>Fetching the debrief…</T>}
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
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: S[4], borderWidth: 1, borderColor: C.ruleStrong, borderRadius: R.key, backgroundColor: pressed ? C.rule : C.well, padding: S[4], marginTop: S[6] })}>
      <View style={{ width: 48, height: 48, borderRadius: R.key, backgroundColor: C.fg, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={16} height={18}>
          {status.playing
            ? <><Rect x={2} y={1} width={4} height={16} fill={C.bg} /><Rect x={10} y={1} width={4} height={16} fill={C.bg} /></>
            : <Polygon points="2,1 16,9 2,17" fill={C.bg} />}
        </Svg>
      </View>
      <View style={{ flex: 1 }}>
        <T v="displayS">Spoken recap</T>
        <View style={{ height: 2, backgroundColor: C.rule, marginTop: S[2] }}><View style={{ height: 2, width: `${frac * 100}%`, backgroundColor: C.fg }} /></View>
      </View>
    </Pressable>
  );
}

const NUMBERS: { k: Metric; what: string; fmt: (v: number) => string }[] = [
  { k: 'talk_ratio', what: 'of the time you talked', fmt: (v) => `${Math.round(v * 100)}%` },
  { k: 'interruptions', what: 'interruptions', fmt: (v) => String(Math.round(v)) },
  { k: 'questions', what: 'questions asked', fmt: (v) => String(Math.round(v)) },
  { k: 'fillers_per_min', what: 'fillers a minute', fmt: (v) => v.toFixed(1) },
  { k: 'wpm', what: 'words a minute', fmt: (v) => String(Math.round(v)) },
];

function Body({ d, audio, sessionId, usual, nudges, baseline }: { d: Debrief; audio: string | null; sessionId: string; usual: Usual; nudges: { ts: number; pattern: HapticPattern }[]; baseline: number }) {
  return (
    <View>
      {/* the key element: the headline sentence, with a word-sized pace sparkline */}
      <T v="displayL">{d.headline_fact}</T>
      <Sparkline points={d.timeline} baseline={baseline} />

      <Label style={{ marginTop: S[7] }}>What worked</Label>
      <T v="textL" style={{ marginTop: S[2] }}>{d.strength}</T>

      <Rule emphasis style={{ marginTop: S[7] }} />
      <Label color={C.fg} style={{ marginTop: S[3] }}>One thing to fix</Label>
      <T v="textL" style={{ marginTop: S[2] }}>{d.one_fix}</T>
      {/* the plan: a hanging italic with the quote mark in the margin, no left bar */}
      <View style={{ marginTop: S[5] }} accessibilityLabel={`Your plan for next time: ${d.if_then}`}>
        <T v="displayM" italic color={C.fg2} style={{ position: 'absolute', left: -15, top: 0 }}>“</T>
        <T v="displayM" italic>{d.if_then}”</T>
        <T v="small" style={{ marginTop: S[2] }}>Your plan for next time</T>
      </View>

      {audio ? <Recap url={audio} /> : (
        <View style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingTop: S[4], marginTop: S[6] }}>
          <T v="displayS" color={C.fg2}>Spoken recap</T>
          <T v="small" style={{ marginTop: S[1] }}>No recording for this conversation. It plays on the laptop when the voice is switched on.</T>
        </View>
      )}

      {/* five numbers, each with its own reference inline: never a bare stat tile */}
      <View style={{ marginTop: S[7] }}>
        {NUMBERS.map(({ k, what, fmt }) => {
          const ref = usual[k];
          return (
            <View key={k} style={{ flexDirection: 'row', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: S[3] }}>
              <T v="numL" style={{ width: 118 }}>{fmt(d.numbers[k])}</T>
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
          <T v="displayS" style={{ marginTop: S[2] }}>“{b.snippet}”</T>
          <T v="small" style={{ marginTop: S[2] }}>{b.what_happened}</T>
          {b.follow_up ? (
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: S[2], marginTop: S[2] }}>
              <T v="label">follow up</T><T v="body" style={{ flex: 1 }}>{b.follow_up}</T>
            </View>
          ) : null}
        </View>
      ))}

      <Label style={{ marginTop: S[7] }}>Notes</Label>
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
        <T v="small" color={C.fg3}>dashed: bookmarks; shaded: your usual range</T>
        <T v="numS" color={C.fg3}>{clock(t1)}</T>
      </View>
    </View>
  );
}

function TagPerson({ sessionId }: { sessionId: string }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [tagged, setTagged] = useState<string | null>(null);
  useEffect(() => { let on = true; listPeople().then((p) => on && setPeople(p.data)); return () => { on = false; }; }, []);
  return (
    <View style={{ marginTop: S[7], borderTopWidth: 1, borderTopColor: C.rule, paddingTop: S[4] }}>
      <T v="displayM">{tagged ? `Tagged: ${tagged}` : 'Who was this with?'}</T>
      <T v="small" style={{ marginTop: S[1] }}>{tagged ? 'This conversation now counts toward your pattern with them.' : 'Tagging builds a brief for the next time you talk.'}</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: S[3], marginTop: S[4] }}>
        {people.map((p) => {
          const on = tagged === p.name;
          return (
            <Pressable key={p.person_id} onPress={() => { setTagged(p.name); void tagPerson(sessionId, p.name).catch(() => undefined); }} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={({ pressed }) => ({ minHeight: 48, paddingHorizontal: S[5], justifyContent: 'center', borderWidth: 1, borderColor: on ? C.fg : C.ruleStrong, borderRadius: R.key, backgroundColor: on ? C.fg : pressed ? C.rule : C.well })}>
              <T v="body" color={on ? C.bg : C.fg} style={{ fontFamily: F.sansMedium }}>{p.name}</T>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
