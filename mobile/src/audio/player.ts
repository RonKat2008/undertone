/**
 * Shared playback rules for every player in the app (spoken recap, recording):
 *   - only one plays at a time: starting one pauses whichever was playing;
 *   - it plays through the speaker even with the ring switch on silent;
 *   - it pauses when its screen loses focus; `useAudioPlayer` releases it on unmount.
 * expo-audio SDK 58: useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync({ playsInSilentMode }).
 */
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

let current: { key: object; pause: () => void } | null = null;
let modeSet: Promise<void> | null = null;

/** Once per app run. Playback only (no recording), so iOS routes it to the speaker, not the earpiece. */
function ensureAudioMode(): Promise<void> {
  if (!modeSet) {
    modeSet = setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'doNotMix', shouldPlayInBackground: false })
      .catch(() => { modeSet = null; }); // try again on the next play
  }
  return modeSet ?? Promise.resolve();
}

export interface Playback {
  player: AudioPlayer;
  status: AudioStatus;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Seek to `seconds` in the recording, optionally starting playback. */
  seek: (seconds: number, andPlay?: boolean) => void;
}

export function usePlayback(url: string | null): Playback {
  const player = useAudioPlayer(url, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const key = useRef({}).current;
  const alive = useRef(true);

  const pause = useCallback(() => { if (alive.current) player.pause(); }, [player]);

  const play = useCallback(() => {
    if (!url) return;
    if (current && current.key !== key) current.pause();
    current = { key, pause };
    void ensureAudioMode().then(() => { if (alive.current && current?.key === key) player.play(); });
  }, [url, key, pause, player]);

  const seek = useCallback((seconds: number, andPlay = false) => {
    if (!url) return;
    const to = Math.max(0, player.duration > 0 ? Math.min(seconds, player.duration) : seconds);
    void player.seekTo(to).catch(() => undefined);
    if (andPlay) play();
  }, [url, player, play]);

  const toggle = useCallback(() => {
    if (status.playing) return pause();
    if (status.duration && status.currentTime >= status.duration - 0.2) void player.seekTo(0).catch(() => undefined);
    play();
  }, [status.playing, status.duration, status.currentTime, player, pause, play]);

  // Leaving the screen (pushing another one on top, or going back) pauses.
  useFocusEffect(useCallback(() => () => pause(), [pause]));

  // Unmount: stop answering pause requests; useAudioPlayer itself releases the native player.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (current?.key === key) current = null;
    };
  }, [key]);

  return { player, status, play, pause, toggle, seek };
}
