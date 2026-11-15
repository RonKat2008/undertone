/**
 * Web Audio for spoken practice: the microphone (AudioWorklet -> 16 kHz linear16 chunks) and the
 * coach's voice (24 kHz linear16 chunks scheduled back to back, stopped at once on barge-in).
 * The maths lives in lib/practice/audio.ts; this file only wires browser objects together.
 */
import {
  COACH_RATE, DRAIN_GRACE_MS, MIC_RATE, RESAMPLE_START, drainDecision, floatToInt16, int16BytesToFloat, levelOf,
  nextStartTime, resampleChunk, splitChunks, type ResampleState,
} from '@/lib/practice/audio';
import type { PracticeSpeaker } from '@/lib/practice/model';
import type { LocalFailure } from '@/lib/practice/session';

const WORKLET_URL = '/practice-mic-worklet.js';
const ANALYSER_SIZE = 1024;

export class MicError extends Error {
  readonly code: LocalFailure;
  constructor(code: LocalFailure) {
    super(code);
    this.code = code;
  }
}

/** True when this page may ask for the microphone at all (secure context with mediaDevices). */
export function micAvailable(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function micFailure(e: unknown): LocalFailure {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'mic_denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no_mic';
  return 'mic_failed';
}

function readLevel(analyser: AnalyserNode, scratch: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(scratch);
  return levelOf(scratch);
}

export interface MicCapture {
  /** Loudness 0-1 right now. */
  level(): number;
  /** Send chunks only while on (after practice.ready, until the end). */
  setSending(on: boolean): void;
  stop(): void;
}

/** A context at 16 kHz when the browser can feed the mic into one; otherwise its own rate (we resample). */
function micContext(stream: MediaStream): { ctx: AudioContext; source: MediaStreamAudioSourceNode } {
  try {
    const ctx = new AudioContext({ sampleRate: MIC_RATE });
    try {
      return { ctx, source: ctx.createMediaStreamSource(stream) };
    } catch {
      void ctx.close();
    }
  } catch {
    /* this browser cannot open a 16 kHz context */
  }
  const ctx = new AudioContext();
  return { ctx, source: ctx.createMediaStreamSource(stream) };
}

/** Ask for the microphone and start capturing. Throws a MicError in plain categories. */
export async function openMic(onChunk: (chunk: ArrayBuffer) => void): Promise<MicCapture> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  } catch (e) {
    throw new MicError(micFailure(e));
  }
  const stopTracks = () => stream.getTracks().forEach((t) => t.stop());
  let ctx: AudioContext | null = null;
  try {
    const opened = micContext(stream);
    ctx = opened.ctx;
    await ctx.resume();
    await ctx.audioWorklet.addModule(WORKLET_URL);
    return wireMic(ctx, opened.source, onChunk, stopTracks);
  } catch {
    stopTracks();
    if (ctx) void ctx.close();
    throw new MicError('mic_failed');
  }
}

function wireMic(ctx: AudioContext, source: MediaStreamAudioSourceNode, onChunk: (chunk: ArrayBuffer) => void, stopTracks: () => void): MicCapture {
  const node = new AudioWorkletNode(ctx, 'practice-mic', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
  const analyser = ctx.createAnalyser();
  analyser.fftSize = ANALYSER_SIZE;
  source.connect(node);
  source.connect(analyser);
  node.connect(ctx.destination); // keeps the worklet pulled; it outputs silence
  const scratch = new Float32Array(ANALYSER_SIZE);
  const ratio = ctx.sampleRate / MIC_RATE;
  let sending = false;
  let resample: ResampleState = RESAMPLE_START;
  let pending: Int16Array = new Int16Array(0);
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (!sending) return;
    const r = resampleChunk(e.data, ratio, resample);
    resample = r.state;
    const split = splitChunks(pending, floatToInt16(r.out));
    pending = split.pending;
    split.chunks.forEach((c) => onChunk(c.buffer as ArrayBuffer));
  };
  return {
    level: () => readLevel(analyser, scratch),
    setSending: (on) => {
      sending = on;
      if (!on) { pending = new Int16Array(0); resample = RESAMPLE_START; }
    },
    stop: () => {
      sending = false;
      node.port.onmessage = null;
      source.disconnect();
      node.disconnect();
      stopTracks();
      void ctx.close().catch(() => undefined);
    },
  };
}

/**
 * The coach's voice. Chunks play back to back; on barge-in every scheduled source stops at once
 * and the queue resets. When an utterance has fully played, `onDone` fires once (playback_done).
 */
export class CoachPlayer {
  private readonly ctx: AudioContext;
  private readonly out: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly scratch = new Float32Array(ANALYSER_SIZE);
  private readonly sources = new Set<AudioBufferSourceNode>();
  private queueEnd = 0;
  private pending = false;
  private speaker: PracticeSpeaker = 'waiting';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly onDone: () => void;

  /** Create inside the Start click, so the browser lets it play. */
  constructor(onDone: () => void) {
    this.onDone = onDone;
    this.ctx = new AudioContext();
    this.out = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = ANALYSER_SIZE;
    this.out.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    void this.ctx.resume().catch(() => undefined);
  }

  enqueue(bytes: ArrayBuffer): void {
    const samples = int16BytesToFloat(bytes);
    if (samples.length === 0 || this.ctx.state === 'closed') return;
    const buffer = this.ctx.createBuffer(1, samples.length, COACH_RATE);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.out);
    const at = nextStartTime(this.ctx.currentTime, this.queueEnd);
    src.start(at);
    this.queueEnd = at + buffer.duration;
    this.sources.add(src);
    this.pending = true;
    this.clearTimer();
    src.onended = () => {
      this.sources.delete(src);
      this.check();
    };
  }

  setSpeaker(speaker: PracticeSpeaker): void {
    this.speaker = speaker;
    if (speaker === 'you') this.bargeIn();
    else this.check();
  }

  /** You started talking: silence the coach now and drop what is queued. No playback_done follows. */
  bargeIn(): void {
    this.sources.forEach((src) => {
      src.onended = null;
      try { src.stop(); } catch { /* not started yet */ }
      src.disconnect();
    });
    this.sources.clear();
    this.queueEnd = 0;
    this.pending = false;
    this.clearTimer();
  }

  level(): number {
    return this.sources.size > 0 ? readLevel(this.analyser, this.scratch) : 0;
  }

  close(): void {
    this.bargeIn();
    void this.ctx.close().catch(() => undefined);
  }

  private check(): void {
    const decision = drainDecision({ pending: this.pending, playing: this.sources.size, speaker: this.speaker });
    if (decision === 'now') this.finish();
    else if (decision === 'wait' && this.timer === null) {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (drainDecision({ pending: this.pending, playing: this.sources.size, speaker: this.speaker }) !== 'no') this.finish();
      }, DRAIN_GRACE_MS);
    }
  }

  private finish(): void {
    this.pending = false;
    this.clearTimer();
    this.onDone();
  }

  private clearTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
