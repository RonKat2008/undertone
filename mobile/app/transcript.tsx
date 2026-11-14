/**
 * What was said: the real recording of one kept conversation, with its transcript as a script.
 * Opened with the session id, like the debrief: /transcript?id=…  (optional &headline=…).
 * Transcript text is speech from the room: untrusted, rendered as plain text only.
 */
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { getTranscript, listSessions, mediaUrl, type SessionTranscript, type TranscriptResult, type TranscriptTurn } from '@/api/client';
import { activeTurnIndex, markFillers } from '@/api/transcript';
import { usePlayback, type Playback } from '@/audio/player';
import { Header } from '@/ui/Header';
import { PlayerBar } from '@/ui/PlayerBar';
import { Btn, SampleTag, Screen, T, clock } from '@/ui/kit';
import { C } from '@/ui/theme';

const SCROLL_PAUSE_MS = 4000; // after the wearer scrolls by hand, leave the scroll alone this long

export default function TranscriptScreen() {
  const { id, headline: headlineParam } = useLocalSearchParams<{ id?: string; headline?: string }>();
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [headline, setHeadline] = useState<string | null>(headlineParam ?? null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    let on = true;
    setResult(null);
    getTranscript(id).then((r) => on && setResult(r));
    return () => { on = false; };
  }, [id, attempt]);

  useEffect(() => {
    if (!id || headlineParam) return;
    let on = true;
    listSessions().then((s) => { const row = s.data.find((x) => x.session_id === id); if (on && row) setHeadline(row.headline_fact); });
    return () => { on = false; };
  }, [id, headlineParam]);

  const sample = result?.kind === 'ok' && result.sample;
  return (
    <Screen scroll={false} style={{ flex: 1, paddingBottom: 0 }}>
      <Header title="What was said" right={<SampleTag show={sample} />} />
      {!id ? <Notice title="Nothing to show." body="Open a conversation from History to read what was said." />
        : !result ? <T v="serif" size={28} color={C.paper3}>Fetching what was said…</T>
          : result.kind === 'not-found' ? <Notice title="The laptop has no conversation by that name." body="It may have been a capture the laptop chose not to keep." />
            : result.kind === 'unreachable' ? (
              <Notice title="Laptop unreachable" body={`${result.message} Check the laptop is awake and on this Wi-Fi.`}>
                <Btn small label="Try again" onPress={() => setAttempt((n) => n + 1)} style={{ marginTop: 16, alignSelf: 'flex-start' }} />
              </Notice>
            ) : <Script t={result.data} headline={headline} dropped={result.dropped} />}
    </Screen>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <View>
      <T v="serif" size={28}>{title}</T>
      <T v="small" style={{ marginTop: 6 }}>{body}</T>
      {children}
    </View>
  );
}

function Script({ t, headline, dropped }: { t: SessionTranscript; headline: string | null; dropped: number }) {
  const url = mediaUrl(t.audio_url);
  const pb = usePlayback(url);
  const scroll = useRef<ScrollViewInstance>(null);
  const rowY = useRef<Record<string, number>>({});
  const listY = useRef(0);
  const [barH, setBarH] = useState(0);
  const handScrollAt = useRef(0);

  const pos = pb.status.currentTime - t.audio_offset_s; // conversation seconds under the playhead
  const engaged = Boolean(url) && (pb.status.playing || pb.status.currentTime > 0);
  const active = engaged ? activeTurnIndex(t.turns, pos) : -1;
  const activeId = active >= 0 ? t.turns[active].turn_id : null;

  // Follow the playhead while it plays, unless the wearer is reading elsewhere.
  useEffect(() => {
    if (!activeId || !pb.status.playing || Date.now() - handScrollAt.current < SCROLL_PAUSE_MS) return;
    const y = rowY.current[activeId];
    if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(0, listY.current + y - barH - 12), animated: true });
  }, [activeId, pb.status.playing, barH]);

  const started = new Date(t.started_at);
  const length = t.duration_s ?? (t.turns.length ? t.turns[t.turns.length - 1].end : 0);
  const when = Number.isNaN(started.getTime()) ? 'Unknown date'
    : `${started.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <ScrollView ref={scroll} stickyHeaderIndices={[1]} showsVerticalScrollIndicator={false} style={{ flex: 1, marginHorizontal: -20 }}
      contentContainerStyle={{ paddingBottom: 40 }} onScrollBeginDrag={() => { handScrollAt.current = Date.now(); }}>
      <View style={{ paddingHorizontal: 20 }}>
        <T v="caps">{when} · {clock(length)}</T>
        {headline ? <T v="serif" size={28} style={{ marginTop: 6 }}>{headline}</T> : null}
      </View>

      <View onLayout={(e) => setBarH(e.nativeEvent.layout.height)} style={{ backgroundColor: C.ink, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.rule }}>
        {url ? <PlayerBar pb={pb} title="Recording" subtitle="Your actual conversation. Tap a line to hear it." what="the recording" /> : (
          <View style={{ borderWidth: 1, borderColor: C.rule, padding: 14 }}>
            <T v="serif" size={22} color={C.paper2}>Recording</T>
            <T v="small">No recording was kept for this one.</T>
          </View>
        )}
      </View>

      <View style={{ paddingHorizontal: 20, paddingTop: 14 }} onLayout={(e) => { listY.current = e.nativeEvent.layout.y; }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
          <T v="caps" color={C.paper}>The script · {t.turns.length} turns</T>
          <T v="caps" size={9.5}>dotted: filler words</T>
        </View>
        {t.turns.length === 0 ? <T v="small" style={{ marginTop: 10 }}>No words were caught in this one.</T> : null}
        {dropped > 0 ? <T v="small" style={{ marginTop: 6 }}>{dropped === 1 ? 'One line' : `${dropped} lines`} could not be read and {dropped === 1 ? 'is' : 'are'} left out.</T> : null}
        {t.turns.map((turn) => (
          <View key={turn.turn_id} onLayout={(e) => { rowY.current[turn.turn_id] = e.nativeEvent.layout.y; }}>
            <Line turn={turn} active={turn.turn_id === activeId} playing={pb.status.playing} pb={url ? pb : null} offset={t.audio_offset_s} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Line({ turn, active, playing, pb, offset }: { turn: TranscriptTurn; active: boolean; playing: boolean; pb: Playback | null; offset: number }) {
  const me = turn.speaker === 'me';
  const who = me ? 'You' : 'Them';
  const runs = markFillers(turn.text, turn.fillers);
  const body = (
    <View style={{ flexDirection: 'row', gap: 12, paddingVertical: 12, paddingRight: 10, paddingLeft: 10, borderLeftWidth: 3, borderLeftColor: active ? C.paper : 'transparent', backgroundColor: active ? C.well : 'transparent' }}>
      <View style={{ width: 46 }}>
        <T v="caps" color={me ? C.paper : C.them}>{who}</T>
        <T v="mono" size={12} color={C.paper3} style={{ marginTop: 3 }}>{clock(turn.start)}</T>
      </View>
      <T v="body" size={me ? 17 : 16} color={me ? C.paper : C.paper2} style={{ flex: 1 }}>
        {runs.map((r, i) => r.filler
          ? <T key={i} v="body" size={me ? 17 : 16} color={C.paper3} style={{ textDecorationLine: 'underline', textDecorationStyle: 'dotted', textDecorationColor: C.paper3 }}>{r.text}</T>
          : r.text)}
      </T>
    </View>
  );
  if (!pb) return <View style={{ borderTopWidth: 1, borderTopColor: C.rule }} accessible accessibilityLabel={`${who}, at ${clock(turn.start)}: ${turn.text}`}>{body}</View>;
  return (
    <Pressable onPress={() => pb.seek(turn.start + offset, true)} accessibilityRole="button"
      accessibilityLabel={`${who}, at ${clock(turn.start)}: ${turn.text}`} accessibilityHint="Plays the recording from this line"
      accessibilityState={{ selected: active && playing }}
      style={({ pressed }) => ({ borderTopWidth: 1, borderTopColor: C.rule, opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  );
}
