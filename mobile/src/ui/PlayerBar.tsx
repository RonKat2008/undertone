/**
 * The app's audio control, in the debrief's visual language: a round paper button, a serif label,
 * a hairline scrubber and mono times. Used for the spoken recap and for the recording.
 */
import { useState } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import type { Playback } from '@/audio/player';
import { T, clock } from './kit';
import { C, TONE } from './theme';

const NUDGE_S = 10; // accessibility increment / decrement

export function PlayButton({ playing, onPress, label, size = 52 }: { playing: boolean; onPress: () => void; label: string; size?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <T v="mono" size={size * 0.35} color={C.ink}>{playing ? 'II' : '▶'}</T>
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
  const frac = duration > 0 ? Math.min(1, shown / duration) : 0;
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
      accessibilityValue={{ text: `${clock(shown)} of ${clock(duration)}` }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => onSeek(Math.min(duration, Math.max(0, position + (e.nativeEvent.actionName === 'increment' ? NUDGE_S : -NUDGE_S))))}
      style={{ height: 28, justifyContent: 'center' }}
    >
      <View pointerEvents="none" style={{ height: 2, backgroundColor: C.rule }}>
        <View style={{ height: 2, width: `${frac * 100}%`, backgroundColor: C.paper }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${frac * 100}%`, marginLeft: -6, width: 12, top: drag !== null ? 6 : 8, height: drag !== null ? 16 : 12, backgroundColor: C.paper, opacity: ready ? 1 : 0 }} />
    </View>
  );
}

/** Play / pause, scrubber and elapsed / total for one Playback. */
export function PlayerBar({ pb, title, subtitle, what }: { pb: Playback; title: string; subtitle: string; what: string }) {
  const { status } = pb;
  const duration = status.duration || 0;
  const waiting = !status.isLoaded || (status.isBuffering && !status.playing);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <PlayButton playing={status.playing} onPress={pb.toggle} label={status.playing ? `Pause ${what}` : `Play ${what}`} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
          <T v="serif" size={24}>{title}</T>
          <T v="mono" size={13} color={C.paper2}>{clock(status.currentTime)} / {duration > 0 ? clock(duration) : '–:––'}</T>
        </View>
        <Scrubber position={status.currentTime} duration={duration} onSeek={(s) => pb.seek(s)} label={`${title} position`} />
        <T v="small" size={12.5} color={status.error ? TONE.vermilion : C.paper3}>
          {status.error ? 'This recording would not play. The laptop may have dropped it.' : waiting ? 'Loading from the laptop…' : subtitle}
        </T>
      </View>
    </View>
  );
}
