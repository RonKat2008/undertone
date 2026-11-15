'use client';

/**
 * One spoken practice: the microphone, the coach's voice and the /ws/practice socket, folded
 * into the session reducer. Everything is torn down on end, on failure and on unmount.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { apiBase } from '@/lib/config';
import { practiceSocketUrl } from '@/lib/practice/audio';
import { parseServerMessage, type PracticeClientMessage, type PracticeServerMessage } from '@/lib/practice/model';
import { INITIAL_SESSION, reduceSession, type PracticeSession } from '@/lib/practice/session';
import { CoachPlayer, MicError, micAvailable, openMic, type MicCapture } from './audio-engine';

interface Live {
  id: number;
  ws: WebSocket | null;
  mic: MicCapture | null;
  player: CoachPlayer;
  /** Ready arrived: mic audio may flow and End sends {type:'end'}. */
  ready: boolean;
  /** A final message arrived; the socket closing next is expected. */
  finished: boolean;
}

export interface PracticeControls {
  session: PracticeSession;
  start(): void;
  end(): void;
  reset(): void;
  /** Loudness 0-1 of the coach's voice or your microphone, right now. */
  level(who: 'coach' | 'you'): number;
}

function send(live: Live | null, msg: PracticeClientMessage): void {
  if (live?.ws?.readyState === WebSocket.OPEN) live.ws.send(JSON.stringify(msg));
}

function stopAudio(live: Live): void {
  live.mic?.stop();
  live.mic = null;
  live.player.close();
}

export function usePracticeSession(): PracticeControls {
  const [session, dispatch] = useReducer(reduceSession, INITIAL_SESSION);
  const live = useRef<Live | null>(null);
  const attempt = useRef(0);

  const teardown = useCallback(() => {
    attempt.current += 1;
    const l = live.current;
    live.current = null;
    if (!l) return;
    if (l.ws) {
      l.ws.onopen = null;
      l.ws.onmessage = null;
      l.ws.onclose = null;
      l.ws.onerror = null;
      if (l.ws.readyState === WebSocket.OPEN || l.ws.readyState === WebSocket.CONNECTING) l.ws.close(1000);
    }
    stopAudio(l);
  }, []);

  useEffect(() => teardown, [teardown]);

  const onMessage = useCallback((l: Live, m: PracticeServerMessage) => {
    if (m.type === 'practice.ready') {
      l.ready = true;
      l.mic?.setSending(true);
    } else if (m.type === 'practice.state') {
      l.player.setSpeaker(m.state);
    } else if (m.type === 'practice.scoring') {
      l.mic?.setSending(false);
    } else if (m.type === 'practice.result' || m.type === 'practice.no_result' || m.type === 'practice.error') {
      l.finished = true;
      stopAudio(l);
    }
    dispatch({ type: 'server', message: m });
  }, []);

  const connect = useCallback((l: Live) => {
    const url = practiceSocketUrl(apiBase());
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      teardown();
      dispatch({ type: 'fail', code: 'unreachable', address: url });
      return;
    }
    ws.binaryType = 'arraybuffer';
    l.ws = ws;
    let opened = false;
    ws.onopen = () => { opened = true; };
    ws.onmessage = (ev: MessageEvent<string | ArrayBuffer>) => {
      if (typeof ev.data !== 'string') { l.player.enqueue(ev.data); return; }
      const m = parseServerMessage(ev.data);
      if (m) onMessage(l, m);
    };
    ws.onclose = () => {
      if (live.current?.id !== l.id) return;
      const expected = l.finished;
      teardown();
      if (!expected) dispatch({ type: 'fail', code: opened ? 'closed' : 'unreachable', address: url });
    };
  }, [onMessage, teardown]);

  const start = useCallback(() => {
    teardown();
    dispatch({ type: 'start' });
    if (!micAvailable()) { dispatch({ type: 'fail', code: 'insecure' }); return; }
    const id = attempt.current;
    // Created inside the click, so the browser lets the coach's voice play.
    const l: Live = { id, ws: null, mic: null, player: new CoachPlayer(() => send(live.current, { type: 'playback_done' })), ready: false, finished: false };
    live.current = l;
    void openMic((chunk) => {
      if (l.ready && l.ws?.readyState === WebSocket.OPEN) l.ws.send(chunk);
    }).then((mic) => {
      if (attempt.current !== id) { mic.stop(); return; }
      l.mic = mic;
      connect(l);
    }, (e: unknown) => {
      if (attempt.current !== id) return;
      teardown();
      dispatch({ type: 'fail', code: e instanceof MicError ? e.code : 'mic_failed' });
    });
  }, [connect, teardown]);

  const end = useCallback(() => {
    const l = live.current;
    if (l?.ready && l.ws?.readyState === WebSocket.OPEN) {
      send(l, { type: 'end' });
      l.mic?.setSending(false);
      l.player.bargeIn();
      dispatch({ type: 'end_requested' });
      return;
    }
    teardown();
    dispatch({ type: 'reset' });
  }, [teardown]);

  const reset = useCallback(() => {
    teardown();
    dispatch({ type: 'reset' });
  }, [teardown]);

  const level = useCallback((who: 'coach' | 'you') => {
    const l = live.current;
    if (!l) return 0;
    return who === 'coach' ? l.player.level() : l.mic?.level() ?? 0;
  }, []);

  return { session, start, end, reset, level };
}
