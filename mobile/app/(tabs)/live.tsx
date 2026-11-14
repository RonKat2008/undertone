import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { addBookmarkFeedback } from '@/haptics/feedback';
import type { HapticPattern } from '@/bus/contracts';
import { PATTERNS } from '@/bus/patterns';
import { listenState } from '@/bus/phone-state';
import { isLive } from '@/bus/reducer';
import { useBus, useNow } from '@/bus/use-bus';
import { Glyph } from '@/ui/Glyph';
import { LISTEN_LABEL, ListeningIdle, StayAwake, dotColor } from '@/ui/Listening';
import { Btn, T, clock } from '@/ui/kit';
import { C, F, TAKEOVER, TONE } from '@/ui/theme';

const TAKEOVER_MS = 2800;
const STATUS_MS = 5000;

/** The metronome: almost empty on purpose. It lives on the table during a conversation. */
export default function LiveScreen() {
  const { state, send, mode, buzzes } = useBus();
  const router = useRouter();
  const now = useNow(250);
  const [beat, setBeat] = useState(0);
  const [marked, setMarked] = useState(0);

  const session = state.session;
  const live = isLive(state);
  const practice = session?.mode === 'practice';
  const alwaysOn = state.alwaysOn;
  const listen = listenState(state);
  const statusDot = state.status === 'offline' ? TONE.vermilion : live ? C.mic : C.paper3;
  const statusText = state.status === 'offline' ? 'Laptop unreachable' : live ? 'Listening' : mode === 'mock' ? 'Demo feed' : 'Connected';
  // always-on idle shows 0:00: the last conversation's length lives in the "Last conversation" line
  const elapsed = session && (live || !state.alwaysOn) ? ((session.endedAt ?? now) - session.startedAt) / 1000 : 0;

  // What owns the centre right now: a nudge, a third-party buzz, or the answer to a single tap.
  const nudge = state.lastNudge && now - state.lastNudge.at < TAKEOVER_MS ? state.lastNudge : null;
  const foreign = buzzes[0] && buzzes[0].source_app !== 'undertone' && now - buzzes[0].at < TAKEOVER_MS ? buzzes[0] : null;
  const status = !nudge && state.lastStatus && now - state.lastStatus.at < STATUS_MS ? state.lastStatus : null;
  const pattern: HapticPattern | null = nudge?.pattern ?? (foreign ? foreign.pattern : null);
  const tone = pattern ? PATTERNS[pattern].tone : 'ink';
  const take = pattern ? TAKEOVER[tone] : null;
  const total = pattern ? PATTERNS[pattern].total : 0;
  const takeKey = nudge?.id ?? (foreign ? `f${foreign.id}` : null);

  useEffect(() => {
    if (!takeKey) return;
    const id = setInterval(() => setBeat((b) => b + 1), total + 1100);
    return () => clearInterval(id);
  }, [takeKey, total]);

  const fg = take?.fg ?? C.paper;
  const dim = take ? take.fg : C.paper2;
  const policy = session?.policy;
  const budgetTotal = Math.min(policy?.budget_per_session ?? 3, 8);
  const budgetLeft = Math.min(state.budgetLeft ?? budgetTotal, budgetTotal);
  const focus = state.coach?.nudge_rules.find((r) => r.id === policy?.focus_rule_id)?.haptic ?? 'slow_down';
  const words = state.coach?.filler_words.slice(0, 3) ?? [];
  const prompt = state.coach?.drill.prompts[0] ?? 'Tell me about yourself.';

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: take?.bg ?? C.ink }}>
      {/* Tap-to-start: awake while this tab is open (as before). Always-on: the root layout holds it during a conversation only. */}
      {!alwaysOn ? <StayAwake /> : null}
      <View style={{ flex: 1, paddingHorizontal: 20, paddingBottom: 16 }}>
        {/* top: coach, connection, clock */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingTop: 6 }}>
          <View>
            <T v="caps" color={dim}>{state.coach ? (/coach$/i.test(state.coach.name) ? state.coach.name : `${state.coach.name} coach`) : 'No coach yet'}</T>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 4 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: take ? fg : alwaysOn ? dotColor(listen) : statusDot }} />
              <T v="small" color={dim}>{alwaysOn ? LISTEN_LABEL[listen] : statusText}</T>
            </View>
          </View>
          <T v="mono" size={34} color={fg}>{clock(elapsed)}</T>
        </View>

        {/* mode line */}
        <View style={{ marginTop: 18, borderTopWidth: 1, borderTopColor: take ? fg : C.rule, paddingTop: 10, minHeight: 64 }}>
          {practice ? (
            <>
              <T v="caps" color={dim}>Practice · round {Math.max(1, state.practice.round)}</T>
              <T v="serif" size={24} color={fg} style={{ marginTop: 2 }}>“{prompt}”</T>
              <T v="small" color={dim} style={{ marginTop: 4 }}>Taps on: {words.join(', ') || 'your crutch words'}</T>
            </>
          ) : (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <T v="caps" color={dim}>Regular</T>
                <T v="body" size={17} color={fg} style={{ marginTop: 2 }}>{focus === 'slow_down' ? 'Only buzzes when you speed up' : `Buzzes for: ${PATTERNS[focus].action.toLowerCase()}`}</T>
              </View>
              <View accessibilityLabel={`${budgetLeft} of ${budgetTotal} buzzes left`} style={{ flexDirection: 'row', gap: 6 }}>
                {Array.from({ length: budgetTotal }, (_, i) => { // one mark per buzz left
                  const spent = i < budgetTotal - budgetLeft;
                  const mark = take ? fg : TONE[PATTERNS[focus].tone];
                  return <View key={i} style={{ width: budgetTotal > 4 ? 6 : 9, height: 30, borderWidth: 1, borderColor: mark, backgroundColor: spent ? 'transparent' : mark, opacity: spent ? 0.45 : 1 }} />;
                })}
              </View>
            </View>
          )}
        </View>

        {/* the centre */}
        <View style={{ flex: 1, justifyContent: 'center' }}>
          {pattern ? (
            <View accessibilityLiveRegion="assertive">
              <Glyph pattern={pattern} size={150} color={fg} playKey={`${takeKey}-${beat}`} maxWidth={330} />
              <T v="serif" size={nudge && nudge.title.length > 12 ? 62 : 78} color={fg} style={{ marginTop: 22 }}>{nudge ? nudge.title : foreign?.label}</T>
              <T v="mono" size={14} color={fg} style={{ marginTop: 10, opacity: 0.85 }}>{nudge ? nudge.detail : `from ${foreign?.source_app}`}</T>
            </View>
          ) : status?.pattern ? (
            <View accessibilityLiveRegion="polite">
              <T v="caps">How am I doing?</T>
              <View style={{ marginVertical: 18 }}><Glyph pattern={status.pattern} size={64} playKey={status.id} maxWidth={330} /></View>
              <T v="serif" size={56}>{status.title}</T>
            </View>
          ) : practice ? (
            <View>
              <T v="caps">{live ? 'Caught this round' : 'Round score'}</T>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12 }}>
                {state.practice.previous !== null ? <T v="mono" size={64} color={C.paper3}>{state.practice.previous} →</T> : null}
                <T v="mono" size={150} color={TONE.ochre} style={{ lineHeight: 150 }}>{state.practice.count}</T>
              </View>
              <T v="small">{state.practice.previous !== null ? `Last round ${state.practice.previous}.` : 'First round. This sets the number to beat.'}</T>
            </View>
          ) : state.lastNudge?.pattern && (live || !alwaysOn) ? (
            <View>
              <T v="caps">Last nudge · {clock(state.lastNudge.ts)}</T>
              <View style={{ marginVertical: 16 }}><Glyph pattern={state.lastNudge.pattern} size={72} maxWidth={330} /></View>
              <T v="serif" size={44}>{state.lastNudge.title}</T>
              <T v="small" style={{ marginTop: 6 }}>{state.lastNudge.detail}</T>
            </View>
          ) : live ? (
            <View>
              <Glyph pattern="slow_down" size={72} color={C.rule} />
              <T v="serif" size={44} color={C.paper2} style={{ marginTop: 16 }}>Quiet so far.</T>
              <T v="small" style={{ marginTop: 6 }}>Everything else is being written down for the debrief.</T>
            </View>
          ) : alwaysOn ? (
            <ListeningIdle state={state} listen={listen} isDemo={mode === 'mock'} onOpenDebrief={() => router.push('/debrief')} />
          ) : (
            <View>
              <T v="serif" size={52}>{session?.endedAt ? (practice ? 'Round finished.' : 'Conversation ended.') : 'Double-tap the band to begin.'}</T>
              {session?.endedAt && !practice ? (
                <Pressable onPress={() => router.push('/debrief')} accessibilityRole="link" style={{ marginTop: 14 }}>
                  <T v="body" style={{ textDecorationLine: 'underline', fontFamily: F.sansMedium }}>{state.debrief ? 'Read the debrief' : 'The debrief is being written…'}</T>
                </Pressable>
              ) : <T v="small" style={{ marginTop: 10 }}>Keep this screen open and the phone on you. It taps; it never rings.</T>}
            </View>
          )}
        </View>

        {/* thumb zone */}
        <Pressable
          onPress={() => { send({ cmd: 'bookmark' }); addBookmarkFeedback(); setMarked(Date.now()); }}
          disabled={!live}
          accessibilityRole="button"
          accessibilityLabel="Bookmark this moment"
          style={({ pressed }) => ({
            height: 112, borderRadius: 4, borderWidth: 1.5, borderColor: fg, alignItems: 'center', justifyContent: 'center',
            backgroundColor: pressed ? fg : 'transparent', opacity: live ? 1 : 0.35, transform: [{ scale: pressed ? 0.985 : 1 }],
          })}
        >
          {({ pressed }) => (
            <>
              <T v="serif" size={40} color={pressed ? (take?.bg ?? C.ink) : fg}>{now - marked < 1500 ? 'Marked' : 'Bookmark'}</T>
              <T v="caps" color={pressed ? (take?.bg ?? C.ink) : dim} style={{ marginTop: 2 }}>{now - marked < 1500 ? `at ${clock(elapsed)}` : 'mark this moment for the debrief'}</T>
            </>
          )}
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
          {live ? (
            <Btn label="Stop" onPress={() => send({ cmd: 'stop' })} color={fg} style={{ flex: 1 }} />
          ) : alwaysOn ? (
            <>
              {/* conversations open by themselves; starting by hand stays possible, but quieter */}
              <Btn label="Start now" onPress={() => send({ cmd: 'start', mode: 'regular' })} style={{ flex: 1 }} />
              <Btn label="Practice" onPress={() => send({ cmd: 'start', mode: 'practice' })} style={{ flex: 1 }} />
            </>
          ) : (
            <>
              <Btn label="Start" solid onPress={() => send({ cmd: 'start', mode: 'regular' })} style={{ flex: 1.4 }} />
              <Btn label="Practice" onPress={() => send({ cmd: 'start', mode: 'practice' })} style={{ flex: 1 }} />
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}
