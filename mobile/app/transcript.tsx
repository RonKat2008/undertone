/**
 * What was said in one kept conversation, with the recording pinned at the bottom.
 * Opened with the session id, like the debrief: /transcript?id=…
 * Transcript text is speech from the room: untrusted, rendered as plain text only.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import { getTranscript, mediaUrl, type SessionTranscript, type TranscriptResult, type TranscriptTurn } from '@/api/client';
import { activeTurnIndex, markFillers } from '@/api/transcript';
import { usePlayback, type Playback } from '@/audio/player';
import { useBus } from '@/bus/use-bus';
import { Header } from '@/ui/Header';
import { EmptyState, Screen, T, clock, howLong, when } from '@/ui/kit';
import { useReduceMotion } from '@/ui/motion';
import { PlayerBar } from '@/ui/PlayerBar';
import { Failed, Fetching, NotPaired } from '@/ui/States';
import { C, S, TOUCH, alpha, hueFor } from '@/ui/theme';

const SCROLL_PAUSE_MS = 4000; // after the wearer scrolls by hand, leave the scroll alone this long
const FOLLOW_MARGIN = S[8]; // keep the active turn this far below the top while following
const BAR_SOFT = 0.35; // your turns' bar when not under the playhead
/** The transcript names no one, so the other person gets one stable hue. */
const THEM_HUE = hueFor('them');

export default function TranscriptScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { mode } = useBus();

  useEffect(() => {
    if (!id) return;
    let on = true;
    setResult(null);
    getTranscript(id).then(
      (r) => { if (on) setResult(r); },
      () => { if (on) setResult({ kind: 'unreachable', message: '' }); },
    );
    return () => { on = false; };
  }, [id, attempt, mode]);

  if (result?.kind === 'ok') return <Script t={result.data} dropped={result.dropped} />;

  const retry = () => { setResult(null); setAttempt((n) => n + 1); };
  const body = !id ? <EmptyState icon="talk" title="Nothing to show" line="Open a conversation to read what was said." />
    : mode === 'unpaired' || result?.kind === 'not-paired' ? <NotPaired />
      : !result ? <Fetching />
        : result.kind === 'not-found' ? <EmptyState icon="talk" title="No transcript for this one" line="The laptop didn’t keep what was said." />
          : <Failed onRetry={retry} />;
  return (
    <Screen>
      <Header title="Transcript" />
      {body}
    </Screen>
  );
}

function Script({ t, dropped }: { t: SessionTranscript; dropped: number }) {
  const url = mediaUrl(t.audio_url);
  const pb = usePlayback(url);
  const reduce = useReduceMotion();
  const scroll = useRef<ScrollViewInstance>(null);
  const rowY = useRef<Record<string, number>>({});
  const handScrollAt = useRef(0);

  const pos = pb.status.currentTime - t.audio_offset_s; // conversation seconds under the playhead
  const engaged = Boolean(url) && (pb.status.playing || pb.status.currentTime > 0);
  const active = engaged ? activeTurnIndex(t.turns, pos) : -1;
  const activeId = active >= 0 ? t.turns[active].turn_id : null;

  // Follow the playhead while it plays, unless the wearer is reading elsewhere.
  useEffect(() => {
    if (!activeId || !pb.status.playing || Date.now() - handScrollAt.current < SCROLL_PAUSE_MS) return;
    const y = rowY.current[activeId];
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, y - FOLLOW_MARGIN), animated: !reduce });
  }, [activeId, pb.status.playing, reduce]);

  const length = t.duration_s ?? (t.turns.length ? t.turns[t.turns.length - 1].end : null);
  const line = [when(t.started_at), length !== null ? howLong(length) : ''].filter(Boolean).join(', ');

  return (
    <Screen scroll={false} footer={url ? <PlayerBar pb={pb} what="the recording" pinned /> : undefined}>
      <ScrollView ref={scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}
        onScrollBeginDrag={() => { handScrollAt.current = Date.now(); }}>
        <Header title="Transcript" />
        {line ? <T v="small" num style={styles.meta}>{line}</T> : null}
        {t.turns.length === 0 ? <T v="small" style={styles.note}>No words were caught in this one.</T> : null}
        {t.turns.map((turn) => (
          <View key={turn.turn_id} onLayout={(e) => { rowY.current[turn.turn_id] = e.nativeEvent.layout.y; }}>
            <Turn turn={turn} engaged={engaged} active={turn.turn_id === activeId} pb={url ? pb : null} offset={t.audio_offset_s} />
          </View>
        ))}
        {dropped > 0 ? <T v="caption" style={styles.note}>{dropped === 1 ? 'One line couldn’t be read and is left out.' : `${dropped} lines couldn’t be read and are left out.`}</T> : null}
        {!url ? <T v="caption" style={styles.note}>No recording was kept for this one.</T> : null}
      </ScrollView>
    </Screen>
  );
}

function Turn({ turn, engaged, active, pb, offset }: { turn: TranscriptTurn; engaged: boolean; active: boolean; pb: Playback | null; offset: number }) {
  const me = turn.speaker === 'me';
  const who = me ? 'You' : 'Them';
  // While the recording runs, the turn under the playhead is in text colour and the rest recede.
  const ink = engaged ? (active ? C.text : C.muted) : me ? C.text : C.muted;
  const runs = markFillers(turn.text, turn.fillers);
  const label = `${who}, at ${clock(turn.start)}: ${turn.text}`;
  const hue = me ? C.accent : THEM_HUE;
  // Your turns carry a soft teal bar; the turn under the playhead gets it at full strength.
  const bar = active ? hue : me ? alpha(C.accent, BAR_SOFT) : 'transparent';
  const body = (
    <>
      <View style={[styles.bar, { backgroundColor: bar }]} />
      <View style={styles.flex}>
        <View style={styles.cue}>
          <T v="caption" strong color={hue}>{who}</T>
          <T v="caption" num>{clock(turn.start)}</T>
        </View>
        <T v="body" color={ink} style={styles.words}>
          {runs.map((r, i) => (r.filler ? <Text key={i} style={styles.filler}>{r.text}</Text> : r.text))}
        </T>
      </View>
    </>
  );
  if (!pb) return <View style={styles.turn} accessible accessibilityLabel={label}>{body}</View>;
  return (
    <Pressable onPress={() => pb.seek(turn.start + offset, true)} accessibilityRole="button"
      accessibilityLabel={label} accessibilityHint="Plays the recording from here"
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.turn, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: S[7] },
  meta: { marginBottom: S[4] },
  turn: { flexDirection: 'row', gap: S[3], paddingVertical: S[3], minHeight: TOUCH },
  bar: { width: 3, borderRadius: 1.5 },
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  cue: { flexDirection: 'row', alignItems: 'baseline', gap: S[3] },
  words: { marginTop: S[1] },
  filler: { textDecorationLine: 'underline', textDecorationColor: C.muted },
  note: { marginTop: S[5] },
});
