import { useKeepAwake } from 'expo-keep-awake';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View, useWindowDimensions } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Line } from 'react-native-svg';
import { addBookmarkFeedback } from '@/haptics/feedback';
import type { HapticPattern } from '@/bus/contracts';
import { PATTERNS } from '@/bus/patterns';
import { isLive, wordFromReason, type Mark } from '@/bus/reducer';
import { useBus, useNow } from '@/bus/use-bus';
import { Glyph } from '@/ui/Glyph';
import { Budget, Metronome, QuarterNote, amplitude } from '@/ui/Metronome';
import { Btn, Link, StateMark, T, clock } from '@/ui/kit';
import { useReduceMotion } from '@/ui/motion';
import { C, DUR, EASE, F, R, S, TONE } from '@/ui/theme';

const STATUS_MS = 3000; // "How am I doing?" holds 3 s, then the pendulum returns
const SUCCESS_MS = 1500; // practice: only `success` takes over, for 1.5 s
const FADE_MS = 400;
const DEFAULT_BASELINE = 160;

interface Take { key: string; pattern: HapticPattern; title: string; detail: string; at: number; hold: number }

/** Which buzz owns the field right now, if any (§5.3). */
function useTakeover(candidate: Take | null, ended: boolean) {
  const reduce = useReduceMotion();
  const field = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState<Take | null>(null);
  const key = candidate?.key ?? null;

  useEffect(() => {
    if (!candidate || ended) return;
    const left = candidate.hold - (Date.now() - candidate.at);
    if (left <= 0) return;
    setShown(candidate);
    field.stopAnimation();
    field.setValue(1); // the cut is instant: it must match the buzz
    const id = setTimeout(() => {
      Animated.timing(field, { toValue: 0, duration: reduce ? 0 : FADE_MS, easing: EASE.exit, useNativeDriver: false })
        .start(({ finished }) => { if (finished) setShown((s) => (s?.key === candidate.key ? null : s)); });
    }, left);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ended]);

  // The field always clears when the session ends.
  useEffect(() => {
    if (ended) { field.stopAnimation(); field.setValue(0); setShown(null); }
  }, [ended, field]);

  return { shown, field };
}

/** The metronome: almost empty on purpose. It lives on the table during a conversation. */
export default function LiveScreen() {
  useKeepAwake();
  const { state, send, mode, buzzes } = useBus();
  const router = useRouter();
  const now = useNow(250);
  const [marked, setMarked] = useState(0);
  const [centre, setCentre] = useState({ w: 350, h: 420 });
  const { height: screenH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const session = state.session;
  const live = isLive(state);
  const ended = !!session?.endedAt;
  const practice = session?.mode === 'practice';
  const elapsed = session ? ((session.endedAt ?? now) - session.startedAt) / 1000 : 0;

  // The takeover: a regular-mode nudge or a third-party buzz holds 2.5 s; in practice only `success`, 1.5 s.
  const n = state.lastNudge;
  const foreign = buzzes[0] && buzzes[0].source_app !== 'undertone' ? buzzes[0] : null;
  let candidate: Take | null = null;
  if (n?.pattern && (!practice || n.pattern === 'success')) {
    candidate = { key: n.id, pattern: n.pattern, title: n.title, detail: n.detail, at: n.at, hold: practice ? SUCCESS_MS : DUR.hold };
  }
  if (foreign && (!candidate || foreign.at > candidate.at)) {
    candidate = { key: `f${foreign.id}`, pattern: foreign.pattern, title: foreign.label, detail: `from ${foreign.source_app}`, at: foreign.at, hold: DUR.hold };
  }
  const { shown: take, field } = useTakeover(candidate, ended);
  const status = state.lastStatus && now - state.lastStatus.at < STATUS_MS ? state.lastStatus : null;

  const policy = session?.policy;
  const budgetTotal = policy?.budget_per_session ?? 3;
  const budgetLeft = Math.min(state.budgetLeft ?? budgetTotal, budgetTotal);
  const focus = state.coach?.nudge_rules.find((r) => r.id === policy?.focus_rule_id)?.haptic ?? 'slow_down';
  const coachName = state.coach ? (/coach$/i.test(state.coach.name) ? state.coach.name : `${state.coach.name} coach`) : 'No coach yet';
  const offline = state.status === 'offline';

  const wpm = state.metrics?.wpm ?? 0;
  const baseline = state.metrics?.baseline_wpm ?? DEFAULT_BASELINE;
  const tolerance = policy?.tolerance ?? 0.25;
  const lastPace = n?.pattern === 'slow_down' ? n : null;
  const ritFrom = lastPace ? lastPace.at + DUR.hold : null;

  const keysH = live ? 96 : 64;
  const keysBottom = S[4];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1 }}>
        <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: keysH + keysBottom + S[4] }}>
          {/* top: coach and clock; the mode in italic; listening and the budget */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: S[3] }}>
            <T v="displayS" style={{ flex: 1, paddingRight: S[3], marginTop: 6 }}>{coachName}</T>
            <T v="numL" accessibilityLabel={`Session time ${clock(elapsed)}`}>{clock(elapsed)}</T>
          </View>
          <T v="body" italic color={C.fg2} style={{ marginTop: S[1] }}>
            {practice ? `Practice · round ${Math.max(1, state.practice.round)}` : focus === 'slow_down' ? 'Regular · only taps when you rush' : `Regular · taps for: ${PATTERNS[focus].action.toLowerCase()}`}
          </T>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[2] }}>
              <StateMark kind={offline ? 'fault' : live ? 'listening' : mode === 'mock' ? 'off' : 'on'} />
              <T v="small" color={offline ? C.fg : C.fg2} style={offline ? { fontFamily: F.sansMedium } : null}>
                {offline ? 'Offline: laptop unreachable' : live ? 'Listening' : mode === 'mock' ? 'Demo feed' : 'Connected'}
              </T>
            </View>
            {!practice && session ? <Budget left={budgetLeft} total={budgetTotal} /> : null}
          </View>

          {/* the centre */}
          <View style={{ flex: 1, marginTop: S[5] }} onLayout={(e) => setCentre({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
            {status?.pattern ? (
              <StatusReply mark={status} />
            ) : practice ? (
              <Drill live={live} ended={ended} />
            ) : (
              <Pendulum wpm={live ? wpm : 0} baseline={baseline} tolerance={tolerance} width={centre.w} height={centre.h} screenH={screenH}
                dim={!live} ritFrom={ritFrom}
                lastNudge={live && n?.pattern ? n : null}
                idle={!session ? 'Double-tap the band to begin.' : ended ? 'Conversation ended.' : null}
                after={ended ? (
                  <Link label={state.debrief ? 'Read the debrief' : 'The debrief is being written…'} onPress={() => router.push('/debrief')} />
                ) : !session ? <T v="small" style={{ marginTop: S[2] }}>Keep this screen open and the phone on you. It taps; it never rings.</T> : null}
              />
            )}
          </View>
        </View>
      </SafeAreaView>

      {/* the takeover: the field cuts to the pattern's solid at the instant of the buzz */}
      {take ? <Takeover take={take} field={field} elapsed={elapsed} wpm={wpm} baseline={baseline} top={insets.top} bottom={keysH + keysBottom + S[4]} /> : null}

      {/* thumb zone: drawn above the takeover, so it always works */}
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: keysBottom, flexDirection: 'row', gap: S[3] }}>
        {live ? (
          <>
            <Pressable
              onPress={() => { send({ cmd: 'bookmark' }); addBookmarkFeedback(); setMarked(Date.now()); }}
              accessibilityRole="button"
              accessibilityLabel="Bookmark this moment"
              style={({ pressed }) => ({
                flex: 2, height: keysH, borderRadius: R.key, borderWidth: 1, borderColor: C.ruleStrong, paddingHorizontal: S[4], justifyContent: 'center',
                backgroundColor: pressed ? C.fg : C.well,
              })}
            >
              {({ pressed }) => (
                <>
                  <T v="displayS" color={pressed ? C.bg : C.fg}>{now - marked < 1500 ? 'Marked' : 'Bookmark'}</T>
                  <T v="small" color={pressed ? C.bg : C.fg2} style={{ marginTop: 2 }}>{now - marked < 1500 ? `at ${clock(elapsed)}` : 'Mark this moment for the debrief'}</T>
                </>
              )}
            </Pressable>
            <Pressable onPress={() => send({ cmd: 'stop' })} accessibilityRole="button" accessibilityLabel="Stop"
              style={({ pressed }) => ({ flex: 1, height: keysH, borderRadius: R.key, borderWidth: 1, borderColor: C.ruleStrong, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? C.rule : C.well })}>
              <T v="body" style={{ fontFamily: F.sansMedium }}>Stop</T>
            </Pressable>
          </>
        ) : (
          <>
            <Btn label="Start" solid onPress={() => send({ cmd: 'start', mode: 'regular' })} style={{ flex: 2, minHeight: keysH }} />
            <Btn label="Practice" onPress={() => send({ cmd: 'start', mode: 'practice' })} style={{ flex: 1, minHeight: keysH }} />
          </>
        )}
      </View>
    </View>
  );
}

/** Regular mode: the pendulum, its caption and the tempo marking. */
function Pendulum({ wpm, baseline, tolerance, width, height, screenH, dim, ritFrom, lastNudge, idle, after }: {
  wpm: number; baseline: number; tolerance: number; width: number; height: number; screenH: number; dim: boolean; ritFrom: number | null;
  lastNudge: Mark | null; idle: string | null; after: React.ReactNode;
}) {
  const reduce = useReduceMotion();
  const rushing = !dim && amplitude(wpm, baseline, tolerance) > 0;
  const foot = lastNudge ? 28 : 0;
  // At rest (before or after a conversation) the rod is shorter and the words sit under its arc.
  const rod = idle ? Math.max(100, Math.min(height * 0.42, height - 220)) : Math.max(120, Math.min(screenH * 0.46, height - 40 - foot));
  // Sit the instrument a little above the optical centre of the space it has.
  const top = idle ? 0 : Math.max(0, (height - foot - (rod + 42)) * 0.4);
  const weightY = top + 6 + rod * (0.8 - ((Math.min(200, Math.max(120, baseline)) - 120) / 80) * 0.5);
  return (
    <View style={{ flex: 1 }}>
      <View style={{ alignItems: 'center', marginTop: top }}>
        <Metronome wpm={wpm} baseline={baseline} tolerance={tolerance} rodLength={rod} width={width} dim={dim} ritFrom={ritFrom} />
      </View>

      {idle ? (
        <View style={{ marginTop: S[5] }}>
          <T v="displayL">{idle}</T>
          {after}
        </View>
      ) : null}

      {/* caption: top left, beside the pivot */}
      <View style={{ position: 'absolute', left: 0, top, maxWidth: width * 0.42 }} accessibilityLiveRegion="polite">
        {idle ? null : rushing ? (
          <>
            <T v="displayM" italic color={TONE.blue.text}>{reduce ? 'fast' : 'Rushing'}</T>
            <T v="numM" color={TONE.blue.text} style={{ marginTop: S[1] }}>{wpm}<T v="small" color={C.fg2}> wpm</T></T>
          </>
        ) : (
          <>
            <T v="displayM" italic>In tempo</T>
            {wpm > 0 ? <T v="numM" color={C.fg2} style={{ marginTop: S[1] }}>{wpm}<T v="small" color={C.fg3}> wpm</T></T> : null}
          </>
        )}
      </View>

      {/* the tempo marking, beside the weight's resting height */}
      <View style={{ position: 'absolute', right: 0, top: weightY - 16, flexDirection: 'row', alignItems: 'flex-end', gap: 6 }} accessibilityLabel={`Your usual pace, ${baseline} words a minute`}>
        <QuarterNote size={24} color={dim ? C.fg3 : C.fg} />
        <T v="numM" color={dim ? C.fg3 : C.fg}>= {baseline}</T>
      </View>

      {lastNudge ? (
        <View style={{ position: 'absolute', left: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: S[2] }}>
          <Glyph pattern={lastNudge.pattern!} size={14} maxWidth={40} />
          <T v="small">Last: {lastNudge.title}</T>
          <T v="numS" color={C.fg3}>{clock(lastNudge.ts)}</T>
        </View>
      ) : null}
    </View>
  );
}

/** The full-field takeover (§5.3): solid pattern colour, glyph playing from 0, message ≥ 24 px. */
function Takeover({ take, field, elapsed, wpm, baseline, top, bottom }: { take: Take; field: Animated.Value; elapsed: number; wpm: number; baseline: number; top: number; bottom: number }) {
  const tone = TONE[PATTERNS[take.pattern].tone];
  const on = tone.on;
  const pace = take.pattern === 'slow_down';
  const from = pace ? (take.detail.match(/(\d+)\s*wpm/)?.[1] ?? String(wpm)) : null;
  return (
    <Animated.View pointerEvents="none" accessibilityLiveRegion="assertive" accessibilityLabel={`${take.title}. ${take.detail}`}
      style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: tone.solid, opacity: field, paddingHorizontal: 20, paddingTop: top + S[3], paddingBottom: bottom }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
        <T v="numL" color={on}>{clock(elapsed)}</T>
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Glyph pattern={take.pattern} size={200} color={on} playKey={take.key} maxWidth={340} rit={false} />
        <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', marginTop: S[5] }}>
          {pace ? <T v="numM" italic size={28} color={on} style={{ marginRight: S[3] }}>rit.</T> : null}
          <T v="displayXl" color={on}>{take.title}</T>
        </View>
        {pace ? (
          <T v="numM" size={24} color={on} style={{ marginTop: S[3] }}>{from} → {baseline}<T v="numM" size={24} color={on}> wpm</T></T>
        ) : (
          <T v="numM" size={24} color={on} style={{ marginTop: S[3] }}>{take.detail}</T>
        )}
      </View>
    </Animated.View>
  );
}

/** "How am I doing?": the pencil glyph counts at H = 96 while the meaning shows; 3 s, no takeover. */
function StatusReply({ mark }: { mark: Mark }) {
  return (
    <View style={{ flex: 1, justifyContent: 'center' }} accessibilityLiveRegion="polite">
      <T v="label">How am I doing?</T>
      <View style={{ marginTop: S[4], marginBottom: S[5] }}>
        <Glyph pattern={mark.pattern!} size={96} playKey={mark.id} maxWidth={350} />
      </View>
      <T v="displayM">{mark.title}</T>
      <T v="small" style={{ marginTop: S[2] }}>{mark.detail}</T>
    </View>
  );
}

/** Practice: the drill stave. Fillers land as ochre notes; only `success` takes over. */
function Drill({ live, ended }: { live: boolean; ended: boolean }) {
  const { state } = useBus();
  const reduce = useReduceMotion();
  const [w, setW] = useState(350);
  const words = state.coach?.filler_words.slice(0, 3) ?? [];
  const prompt = state.coach?.drill.prompts[0] ?? 'Tell me about yourself.';
  const caught = state.marks.filter((m) => m.kind === 'nudge' && m.pattern === 'filler');
  const span = Math.max(12, ...caught.map((m) => m.ts + 1.5));
  const p = state.practice;
  const strike = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce || p.count === 0) return;
    strike.setValue(0.6);
    Animated.timing(strike, { toValue: 1, duration: DUR.enter, easing: EASE.enter, useNativeDriver: false }).start();
  }, [p.count, reduce, strike]);

  // Notes sit at their time on the stave. A word that would run into the one before drops to a second line.
  const H = 60;
  const STAVE = 66;
  const ends = [-Infinity, -Infinity];
  const placed = caught.map((m) => {
    const word = wordFromReason(m.detail) ?? '·';
    const width = word.length * 8 + 12;
    const x = Math.min(w - 40, 4 + (m.ts / span) * (w - 44));
    const row = x >= ends[0] ? 0 : x >= ends[1] ? 1 : ends[0] <= ends[1] ? 0 : 1;
    ends[row] = x + width;
    return { m, word, x, row };
  });
  return (
    <View style={{ flex: 1 }}>
      <T v="displayS" italic>“{prompt}”</T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: S[3], marginTop: S[2] }}>
        <T v="small" color={C.fg3}>Taps on</T>
        {words.map((word) => <T key={word} v="label" color={TONE.ochre.text}>{word}</T>)}
      </View>

      {/* the drill stave */}
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <View style={{ height: STAVE + 44 }} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessibilityLabel={`Caught: ${placed.map((x) => x.word).join(', ') || 'nothing yet'}`}>
          <Svg width={w} height={STAVE + 2} style={{ position: 'absolute', top: 0 }}>
            <Line x1={0} x2={w} y1={STAVE} y2={STAVE} stroke={C.ruleStrong} strokeWidth={1} />
          </Svg>
          {placed.map(({ m, word, x, row }, i) => (
            <View key={m.id} style={{ position: 'absolute', left: x, top: 0 }}>
              <View style={{ marginTop: STAVE - H * 1.02 }}><Glyph pattern="filler" size={H} playKey={i === placed.length - 1 && live ? m.id : null} /></View>
              <T v="numS" color={C.fg2} style={{ marginTop: 4 + row * 18 }}>{word}</T>
            </View>
          ))}
        </View>
      </View>

      <View>
        <T v="label">{live ? 'Caught this round' : ended ? 'Round finished' : 'Round score'}</T>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: S[4] }}>
          <Animated.View style={{ transform: [{ scale: strike }] }}>
            <T v="numXl" color={TONE.ochre.text}>{p.count}</T>
          </Animated.View>
          {p.previous !== null ? (
            <T v="numL" color={C.fg2} style={{ marginBottom: 10 }} accessibilityLabel={`Last round ${p.previous}, this round ${p.count}`}>
              <T v="numL" color={C.fg3}>{p.previous}</T> → {p.count}
            </T>
          ) : null}
        </View>
        <T v="small" style={{ marginTop: S[1] }}>{p.previous !== null ? `Last round ${p.previous}.` : 'First round. This sets the number to beat.'}</T>
      </View>
    </View>
  );
}
