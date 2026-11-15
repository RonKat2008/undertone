/** Unit tests for the practice audio helpers. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  drainDecision, floatToInt16, int16BytesToFloat, levelOf, nextStartTime, PLAYBACK_LEAD_S, practiceSocketUrl, RESAMPLE_START,
  resampleChunk, smoothLevel, splitChunks,
} from './audio.ts';

describe('practiceSocketUrl', () => {
  test('http becomes ws and https becomes wss', () => {
    assert.equal(practiceSocketUrl('http://localhost:8000'), 'ws://localhost:8000/ws/practice');
    assert.equal(practiceSocketUrl('https://coach.example.com/'), 'wss://coach.example.com/ws/practice');
    assert.equal(practiceSocketUrl('HTTP://192.168.1.20:8000'), 'ws://192.168.1.20:8000/ws/practice');
  });
});

describe('resampleChunk', () => {
  test('48 kHz to 16 kHz keeps every third sample and joins chunks without drift', () => {
    const a = Float32Array.from([0, 1, 2, 3, 4, 5, 6]);
    const b = Float32Array.from([7, 8, 9, 10, 11]);
    const r1 = resampleChunk(a, 3, RESAMPLE_START);
    assert.deepEqual([...r1.out], [0, 3, 6]);
    const r2 = resampleChunk(b, 3, r1.state);
    assert.deepEqual([...r2.out], [9]);
    const r3 = resampleChunk(Float32Array.from([12, 13]), 3, r2.state);
    assert.deepEqual([...r3.out], [12]);
  });

  test('fractional ratios interpolate, including across the chunk boundary', () => {
    const r1 = resampleChunk(Float32Array.from([0, 10, 20]), 1.5, RESAMPLE_START);
    assert.deepEqual([...r1.out], [0, 15]);
    const r2 = resampleChunk(Float32Array.from([30, 40]), 1.5, r1.state);
    assert.deepEqual([...r2.out], [30]);
    const r3 = resampleChunk(Float32Array.from([50, 60]), 1.5, r2.state);
    // t = -0.5 sits halfway between the carried 40 and 50.
    assert.deepEqual([...r3.out], [45, 60]);
  });

  test('ratio 1 passes through; empty input changes nothing', () => {
    assert.deepEqual([...resampleChunk(Float32Array.from([1, 2]), 1, RESAMPLE_START).out], [1, 2]);
    const empty = resampleChunk(new Float32Array(0), 3, RESAMPLE_START);
    assert.equal(empty.out.length, 0);
    assert.deepEqual(empty.state, RESAMPLE_START);
  });
});

describe('linear16', () => {
  test('float to int16 clips and scales', () => {
    assert.deepEqual([...floatToInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5]))], [0, 32767, -32768, 32767, -32768, 16384]);
  });

  test('little-endian bytes decode, odd tail ignored', () => {
    const bytes = new Uint8Array([0x00, 0x40, 0x00, 0xc0, 0xff, 0x7f, 0x01]);
    const out = int16BytesToFloat(bytes.buffer);
    assert.equal(out.length, 3);
    assert.equal(out[0], 0.5);
    assert.equal(out[1], -0.5);
    assert.ok(Math.abs(out[2] - 32767 / 32768) < 1e-9);
  });

  test('splitChunks cuts full chunks and keeps the rest', () => {
    const r = splitChunks(Int16Array.from([1, 2]), Int16Array.from([3, 4, 5, 6, 7]), 3);
    assert.deepEqual(r.chunks.map((c) => [...c]), [[1, 2, 3], [4, 5, 6]]);
    assert.deepEqual([...r.pending], [7]);
    assert.equal(splitChunks(new Int16Array(0), Int16Array.from([1]), 3).chunks.length, 0);
  });
});

describe('playback', () => {
  test('chunks play back to back, with a small lead when the queue is empty', () => {
    assert.equal(nextStartTime(10, 10.5), 10.5);
    assert.equal(nextStartTime(10, 9), 10 + PLAYBACK_LEAD_S);
  });

  test('playback_done waits for the queue to drain and for the coach to finish', () => {
    assert.equal(drainDecision({ pending: true, playing: 2, speaker: 'waiting' }), 'no');
    assert.equal(drainDecision({ pending: false, playing: 0, speaker: 'waiting' }), 'no');
    assert.equal(drainDecision({ pending: true, playing: 0, speaker: 'waiting' }), 'now');
    assert.equal(drainDecision({ pending: true, playing: 0, speaker: 'coach' }), 'wait');
  });
});

describe('level', () => {
  test('silence is 0, loud is capped at 1, smoothing moves toward the target', () => {
    assert.equal(levelOf(new Float32Array(64)), 0);
    assert.equal(levelOf(new Float32Array(0)), 0);
    assert.equal(levelOf(new Float32Array(64).fill(1)), 1);
    const up = smoothLevel(0, 1);
    assert.ok(up > 0 && up < 1);
    assert.ok(smoothLevel(1, 0) > up);
  });
});
