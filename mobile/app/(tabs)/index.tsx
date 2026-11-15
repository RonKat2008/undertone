/**
 * Now: is it listening, and how am I doing right now. The orb and one big word carry the state;
 * one line supports it; at most one action. The whole screen's glow shifts colour with the state.
 * The state table lives in mobile/DESIGN.md; the choice of state lives in src/ui/now/now-state.ts.
 */
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMissionToday } from '@/api/client';
import { okData, useLoad } from '@/api/use-load';
import { addBookmarkFeedback } from '@/haptics/feedback';
import { useBus, useListVersion, useNow } from '@/bus/use-bus';
import { Ambient, Button, Card, Orb, Prose, StateWord, T, TextButton, clock } from '@/ui/kit';
import { useKeepAwakeWhile } from '@/ui/Listening';
import { useReduceMotion } from '@/ui/motion';
import { Practice } from '@/ui/now/Practice';
import { Takeover } from '@/ui/now/Takeover';
import { nowView, type NowKind, type NowView } from '@/ui/now/now-state';
import { C, GUTTER, S } from '@/ui/theme';

const MARKED_MS = 1500;

type Tone = 'calm' | 'warm' | 'off';
const TONE_COLOR: Record<Tone, string> = { calm: C.accent, warm: C.warm, off: C.muted };

function toneOf(v: NowView): Tone {
  if (v.kind === 'conversation' && v.rushing) return 'warm';
  const off: NowKind[] = ['not-paired', 'connecting', 'offline', 'band-off', 'mic-off'];
  if (off.includes(v.kind)) return 'off';
  if (v.kind === 'debrief-ready' || v.kind === 'writing') return 'warm';
  return 'calm';
}

function energyOf(v: NowView): 0 | 1 | 2 {
  if (toneOf(v) === 'off') return 0;
  return v.kind === 'conversation' || v.kind === 'practice' || v.kind === 'status' ? 2 : 1;
}

/** The page glow: three layers, cross-faded on the UI thread so a state change reads as a change of light. */
function Glow({ tone }: { tone: Tone }) {
  const reduce = useReduceMotion();
  return (
    <>
      {(Object.keys(TONE_COLOR) as Tone[]).map((t) => {
        const fade = { opacity: t === tone ? 1 : 0, transitionProperty: 'opacity', transitionDuration: reduce ? 0 : 600 } as ViewStyle;
        return (
          <Animated.View key={t} pointerEvents="none" style={[StyleSheet.absoluteFill, fade]}>
            <Ambient color={TONE_COLOR[t]} strength={t === 'off' ? 0.12 : 0.32} />
          </Animated.View>
        );
      })}
    </>
  );
}

/** Today's mission under the idle word: the coach's voice, so serif, on a soft card. Hidden when there is none. */
function Mission() {
  const version = useListVersion();
  const [load] = useLoad(getMissionToday, version);
  const m = okData(load);
  if (!m || !m.text.trim()) return null;
  const target = Math.max(1, m.target);
  return (
    <Card style={styles.mission}>
      <View style={styles.missionHead}>
        <T v="small" strong color={C.warm} style={styles.flex}>{m.done ? 'Today’s mission, done' : 'Today’s mission'}</T>
        {m.target > 1 ? <T v="small" num>{Math.min(m.progress, target)} of {target}</T> : null}
      </View>
      <Prose style={styles.missionText}>{m.text}</Prose>
      {m.if_then ? <Prose size="body" italic color={C.muted} style={styles.missionPlan}>{m.if_then}</Prose> : null}
    </Card>
  );
}

function paceLine(v: NowView): string {
  const time = clock(v.elapsedS);
  return v.wpm > 0 ? `${v.wpm} words a minute · ${time}` : `In a conversation · ${time}`;
}

export default function NowScreen() {
  const { state, mode, send, buzzes, dismissNotice } = useBus();
  const router = useRouter();
  const now = useNow(250);
  const [markedAt, setMarkedAt] = useState(0);
  const v = nowView(state, mode, buzzes, now);
  const inConversation = v.kind === 'conversation' || v.kind === 'status' || (v.kind === 'practice' && state.session?.endedAt === null);
  // Tap to start: keep the screen awake while Now is open. Always on: the root layout holds it during a conversation.
  useKeepAwakeWhile(!state.alwaysOn && mode === 'live', 'undertone-now');

  const tone = toneOf(v);
  const toneColor = TONE_COLOR[tone];
  const start = (practice: boolean) => send({ cmd: 'start', mode: practice ? 'practice' : 'regular' });
  const bookmark = () => { send({ cmd: 'bookmark' }); addBookmarkFeedback(); setMarkedAt(Date.now()); };
  const marked = now - markedAt < MARKED_MS;
  const notice = state.notice;
  const word = (w: string, line: string, color: string = C.text) => <StateWord center word={w} line={line} color={color} />;

  let body: ReactNode = null;
  let actions: ReactNode = null;
  switch (v.kind) {
    case 'not-paired':
      body = word('Not paired', 'Pair with your laptop to start.');
      actions = <Button kind="primary" wide label="Pair" onPress={() => router.push('/pair')} />;
      break;
    case 'connecting':
      body = word('Connecting', 'Looking for your laptop.');
      break;
    case 'offline':
      body = word('Not listening', 'Can’t reach your laptop. Retrying.');
      break;
    case 'status':
      body = word(v.statusWord ?? 'Doing fine', 'You asked the band.', C.accent);
      break;
    case 'conversation':
      body = word(v.wpm > 0 ? (v.rushing ? 'Rushing' : 'Steady') : 'Listening', paceLine(v), v.rushing ? C.warm : C.text);
      break;
    case 'practice':
      body = <Practice finished={!inConversation} />;
      if (!inConversation) actions = <Button wide label="Another round" onPress={() => start(true)} />;
      break;
    case 'debrief-ready':
      body = (
        <Card tint={C.warmSoft} style={styles.debrief}>
          <T v="small" strong color={C.warm}>Debrief ready</T>
          <Prose style={styles.headline} numberOfLines={5}>{notice?.headline || 'Your last conversation is ready to read.'}</Prose>
        </Card>
      );
      actions = (
        <>
          <Button kind="primary" wide label="Read debrief" onPress={() => router.push({ pathname: '/debrief', params: notice ? { id: notice.session_id } : {} })} />
          <TextButton label="Not now" color={C.muted} onPress={dismissNotice} style={styles.center} />
        </>
      );
      break;
    case 'writing':
      body = word('Writing', 'Your debrief is on its way.', C.warm);
      break;
    case 'band-off':
      body = word('Band off', 'Your band isn’t connected. Nothing is being heard.');
      break;
    case 'mic-off':
      body = word('Mic off', 'Your band’s microphone is off.');
      break;
    case 'listening':
      body = <>{word('Listening', 'Conversations start by themselves.')}<Mission /></>;
      actions = <Button wide label="Practice" onPress={() => start(true)} />;
      break;
    case 'ready':
      body = <>{word('Ready', 'Start when the conversation does.')}<Mission /></>;
      actions = (
        <>
          <Button kind="primary" wide label="Start" onPress={() => start(false)} />
          <TextButton label="Practice" color={C.text} onPress={() => start(true)} style={styles.center} />
        </>
      );
      break;
  }

  if (inConversation) {
    // Bookmark is the big key; Stop is small and quiet. Both sit above the nudge field.
    actions = (
      <View style={styles.keys}>
        <Button large icon="bookmark" label={marked ? 'Marked' : 'Bookmark'} accessibilityLabel="Bookmark this moment" onPress={bookmark} style={styles.flex} wide />
        <TextButton label="Stop" color={C.muted} onPress={() => send({ cmd: 'stop' })} style={styles.stop} />
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <Glow tone={tone} />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.flex}>
        <View style={styles.body}>
          {v.kind === 'debrief-ready' ? null : (
            <View style={styles.orb}><Orb color={toneColor} energy={energyOf(v)} pulse={v.takeover?.key ?? null} size={v.kind === 'listening' || v.kind === 'ready' ? 168 : 208} /></View>
          )}
          {body}
        </View>
      </SafeAreaView>
      {v.takeover ? <Takeover take={v.takeover} /> : null}
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  body: { flex: 1, paddingHorizontal: GUTTER, paddingTop: S[6], paddingBottom: 180 },
  orb: { alignItems: 'center', marginBottom: S[2] },
  actions: { position: 'absolute', left: GUTTER, right: GUTTER, bottom: S[5], gap: S[1] },
  center: { alignSelf: 'center', paddingHorizontal: S[5] },
  keys: { flexDirection: 'row', alignItems: 'center', gap: S[3] },
  stop: { paddingHorizontal: S[4], alignSelf: 'stretch', justifyContent: 'center' },
  debrief: { marginTop: S[8] },
  headline: { marginTop: S[3] },
  mission: { marginTop: S[7] },
  missionHead: { flexDirection: 'row', alignItems: 'center' },
  missionText: { marginTop: S[2] },
  missionPlan: { marginTop: S[3] },
});

