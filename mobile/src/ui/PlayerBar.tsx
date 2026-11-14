/**
 * The app's audio control, in Tempo (DESIGN.md): an ink key, a display-s label,
 * a hairline scrubber and tabular mono times. Used for the spoken recap and for the recording.
 * Errors are neutral words with the fault mark, never a pattern hue (§2.4).
 */
import { useState } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Polygon, Rect } from 'react-native-svg';
import type { Playback } from '@/audio/player';
import { StateMark, T, clock } from './kit';
import { C, R, S } from './theme';

const NUDGE_S = 10; // accessibility increment / decrement

export function PlayButton({ playing, onPress, label, size = 48 }: { playing: boolean; onPress: () => void; label: string; size?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: R.key, backgroundColor: pressed ? C.fg2 : C.fg, alignItems: 'center', justifyContent: 'center' })}>
      <Svg width={16} height={18}>
        {playing
          ? <><Rect x={2} y={1} width={4} height={16} fill={C.bg} /><Rect x={10} y={1} width={4} height={16} fill={C.bg} /></>
          : <Polygon points="2,1 16,9 2,17" fill={C.bg} />}
      </Svg>
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
        <View style={{ height: 2, width: `${frac * 100}%`, backgroundColor: C.fg }} />
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${frac * 100}%`, marginLeft: -2, width: 4, top: drag !== null ? 6 : 8, height: drag !== null ? 16 : 12, backgroundColor: C.fg, opacity: ready ? 1 : 0 }} />
    </View>
  );
}

/** Play / pause, scrubber and elapsed / total for one Playback. */
export function PlayerBar({ pb, title, subtitle, what }: { pb: Playback; title: string; subtitle: string; what: string }) {
  const { status } = pb;
  const duration = status.duration || 0;
  const waiting = !status.isLoaded || (status.isBuffering && !status.playing);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[4] }}>
      <PlayButton playing={status.playing} onPress={pb.toggle} label={status.playing ? `Pause ${what}` : `Play ${what}`} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: S[2] }}>
          <T v="displayS">{title}</T>
          <T v="numS" color={C.fg2}>{clock(status.currentTime)} / {duration > 0 ? clock(duration) : '–:––'}</T>
        </View>
        <Scrubber position={status.currentTime} duration={duration} onSeek={(s) => pb.seek(s)} label={`${title} position`} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[2] }}>
          {status.error ? <StateMark kind="fault" size={10} /> : null}
          <T v="small" color={status.error ? C.fg : C.fg3} style={{ flex: 1 }}>
            {status.error ? 'This recording would not play. The laptop may have dropped it.' : waiting ? 'Loading from the laptop…' : subtitle}
          </T>
        </View>
      </View>
    </View>
  );
}
