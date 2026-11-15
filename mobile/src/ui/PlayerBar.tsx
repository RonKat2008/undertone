/**
 * The app's audio controls, in Quiet Ink (mobile/DESIGN.md):
 *   PlayButton   a round 44 pt key, surface fill, the glyph in text colour
 *   Scrubber     a hairline track; drag or tap to seek, adjustable for VoiceOver
 *   PlayerBar    the recording's bar (Transcript): key, scrubber, elapsed / total
 *   PlayLine     a single quiet line ("Play recap 1:12") for a short clip (Debrief)
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polygon, Rect } from 'react-native-svg';
import type { Playback } from '@/audio/player';
import { T, clock } from './kit';
import { C, GUTTER, R, S, SHADOW, TOUCH } from './theme';

const NUDGE_S = 10; // accessibility increment / decrement, in seconds
const KEY = TOUCH; // the round play key
const KEY_BIG = 60; // the recap's inviting key
const THUMB = 12;
const THUMB_DRAG = 18;
const TRACK = 2;
const NO_TIME = '–:––';

function Glyph({ playing, scale = 1 }: { playing: boolean; scale?: number }) {
  const ink = C.onAccent;
  return (
    <Svg width={14 * scale} height={16 * scale} viewBox="0 0 14 16">
      {playing
        ? <><Rect x={1.5} y={1} width={3.5} height={14} rx={1} fill={ink} /><Rect x={9} y={1} width={3.5} height={14} rx={1} fill={ink} /></>
        : <Polygon points="3,1 13.5,8 3,15" fill={ink} strokeLinejoin="round" />}
    </Svg>
  );
}

export function PlayButton({ playing, onPress, label }: { playing: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}>
      <Glyph playing={playing} />
    </Pressable>
  );
}

/** Drag or tap anywhere on the track to seek. Seeks on release so the audio does not stutter while dragging. */
export function Scrubber({ position, duration, onSeek, label }: { position: number; duration: number; onSeek: (s: number) => void; label: string }) {
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);
  const ready = duration > 0 && width > 0;
  const at = (e: GestureResponderEvent) => Math.min(1, Math.max(0, e.nativeEvent.locationX / width)) * duration;
  const shown = drag ?? position;
  const frac = duration > 0 ? Math.min(1, Math.max(0, shown / duration)) : 0;
  const thumb = drag !== null ? THUMB_DRAG : THUMB;
  return (
    <View
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => ready}
      onMoveShouldSetResponder={() => ready}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(e) => setDrag(at(e))}
      onResponderMove={(e) => setDrag(at(e))}
      onResponderRelease={(e) => { const s = at(e); setDrag(null); onSeek(s); }}
      onResponderTerminate={() => setDrag(null)}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: `${clock(shown)} of ${duration > 0 ? clock(duration) : 'unknown'}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onSeek(Math.min(duration, Math.max(0, position + (e.nativeEvent.actionName === 'increment' ? NUDGE_S : -NUDGE_S))))}
      style={styles.scrub}
    >
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.progress, { width: `${frac * 100}%` }]} />
      </View>
      {ready ? (
        <View pointerEvents="none"
          style={[styles.thumb, { width: thumb, height: thumb, borderRadius: thumb / 2, left: frac * width - thumb / 2 }]} />
      ) : null}
    </View>
  );
}

function statusLine(pb: Playback): string | null {
  if (pb.status.error) return 'This one won’t play right now.';
  return null;
}

/**
 * The recording's bar. `pinned` adds the top hairline and the home-indicator inset, for
 * use as a Screen footer.
 */
export function PlayerBar({ pb, what, pinned }: { pb: Playback; what: string; pinned?: boolean }) {
  const insets = useSafeAreaInsets();
  const { status } = pb;
  const duration = status.duration || 0;
  const problem = statusLine(pb);
  return (
    <View style={[pinned && styles.pinned, pinned && { paddingBottom: Math.max(insets.bottom, S[3]) + S[1] }]}>
      <View style={styles.bar}>
        <PlayButton playing={status.playing} onPress={pb.toggle} label={status.playing ? `Pause ${what}` : `Play ${what}`} />
        <View style={styles.flex}>
          <Scrubber position={status.currentTime} duration={duration} onSeek={(s) => pb.seek(s)} label={`Position in ${what}`} />
          <View style={styles.times}>
            <T v="caption" num>{clock(status.currentTime)}</T>
            <T v="caption" num>{duration > 0 ? clock(duration) : NO_TIME}</T>
          </View>
        </View>
      </View>
      {problem ? <T v="caption" style={styles.problem} accessibilityLiveRegion="polite">{problem}</T> : null}
    </View>
  );
}

/**
 * One quiet line for a short clip: the key, a label, and its length (or elapsed / total once
 * started). A scrubber appears only after the clip has started.
 */
export function PlayLine({ pb, label, what, big }: { pb: Playback; label: string; what: string; big?: boolean }) {
  const { status } = pb;
  const duration = status.duration || 0;
  const started = status.playing || status.currentTime > 0;
  const time = started ? `${clock(status.currentTime)} / ${duration > 0 ? clock(duration) : NO_TIME}` : duration > 0 ? clock(duration) : '';
  const problem = statusLine(pb);
  return (
    <View>
      <Pressable onPress={pb.toggle} accessibilityRole="button"
        accessibilityLabel={`${status.playing ? 'Pause' : label}${duration > 0 ? `, ${clock(duration)}` : ''}`}
        style={({ pressed }) => [styles.line, pressed && styles.linePressed]}>
        <View style={[styles.key, big && styles.keyBig]} pointerEvents="none"><Glyph playing={status.playing} scale={big ? 1.3 : 1} /></View>
        <T v={big ? 'lead' : 'body'} strong style={styles.flex}>{status.playing ? 'Pause' : label}</T>
        {time ? <T v="small" num>{time}</T> : null}
      </Pressable>
      {started && duration > 0 ? (
        <View style={[styles.lineScrub, big && styles.lineScrubBig]}>
          <Scrubber position={status.currentTime} duration={duration} onSeek={(s) => pb.seek(s)} label={`Position in ${what}`} />
        </View>
      ) : null}
      {problem ? <T v="caption" accessibilityLiveRegion="polite">{problem}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  key: { width: KEY, height: KEY, borderRadius: KEY / 2, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center' },
  keyBig: { width: KEY_BIG, height: KEY_BIG, borderRadius: KEY_BIG / 2, ...SHADOW, shadowColor: C.accent, shadowOpacity: 0.35 },
  keyPressed: { opacity: 0.8, transform: [{ scale: 0.96 }] },
  scrub: { height: TOUCH - S[3], justifyContent: 'center' },
  track: { height: TRACK, borderRadius: TRACK / 2, backgroundColor: C.lineStrong, overflow: 'hidden' },
  progress: { height: TRACK, backgroundColor: C.text },
  thumb: { position: 'absolute', backgroundColor: C.text },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -S[1] },
  bar: { flexDirection: 'row', alignItems: 'center', gap: S[4] },
  pinned: { backgroundColor: C.bgDeep, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, paddingHorizontal: GUTTER, paddingTop: S[3] },
  problem: { marginTop: S[1] },
  line: { flexDirection: 'row', alignItems: 'center', gap: S[4], minHeight: 56, marginHorizontal: -S[2], paddingHorizontal: S[2], borderRadius: R.control },
  linePressed: { opacity: 0.8 },
  lineScrub: { paddingLeft: KEY + S[4] },
  lineScrubBig: { paddingLeft: KEY_BIG + S[4] },
});
