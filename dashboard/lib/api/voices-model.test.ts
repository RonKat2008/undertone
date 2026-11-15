/** Unit tests for voice memory's data shaping on the Settings page. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BAND_WORDS, bandReadiness, cleanName, ENROL_PASSAGE, enrolCountdown, enrolFailure, isoAgo, parseReprocess, parseVoiceList, parseWearer,
  reprocessWords, sortVoices, voiceMeta, wearerWords, type KnownVoice,
} from './voices-model.ts';

const NOW = Date.parse('2026-11-14T12:00:00Z');
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const voice = (extra: Partial<KnownVoice>): KnownVoice => ({ voice_id: 'v1', name: 'Dylan', named: true, last_heard: null, conversations: 0, ...extra });

describe('parsing', () => {
  test('reads the wearer and drops what the page does not show', () => {
    assert.deepEqual(parseWearer({ state: 'provisional', has_voiceprint: true, samples: 2, seconds: 31.5, last_heard: hoursAgo(3) }),
      { state: 'provisional', has_voiceprint: true, last_heard: hoursAgo(3) });
  });
  test('rejects an unknown state or a missing flag', () => {
    assert.equal(parseWearer({ state: 'maybe', has_voiceprint: false }), null);
    assert.equal(parseWearer({ state: 'none' }), null);
    assert.equal(parseWearer(null), null);
  });
  test('reads a voice list, counting conversations, newest first', () => {
    const list = parseVoiceList({
      enabled: true, model: 'titanet',
      wearer: { state: 'enrolled', has_voiceprint: true, last_heard: null },
      voices: [
        { voice_id: 'v1', name: 'Unknown voice 1', named: false, last_heard: hoursAgo(48), sessions: ['a'] },
        { voice_id: 'v2', name: 'Sam', named: true, last_heard: hoursAgo(1), sessions: ['b', 'c'] },
      ],
    });
    assert.ok(list);
    assert.equal(list.wearer.state, 'enrolled');
    assert.deepEqual(list.voices.map((v) => [v.name, v.conversations]), [['Sam', 2], ['Unknown voice 1', 1]]);
  });
  test('voice memory off: no voices field is an empty list', () => {
    assert.deepEqual(parseVoiceList({ enabled: false, wearer: { state: 'none', has_voiceprint: false } }),
      { enabled: false, wearer: { state: 'none', has_voiceprint: false, last_heard: null }, voices: [] });
  });
  test('rejects a list with a broken voice or an error body', () => {
    assert.equal(parseVoiceList({ enabled: true, wearer: { state: 'none', has_voiceprint: false }, voices: [{ name: 'x' }] }), null);
    assert.equal(parseVoiceList({ detail: 'Not Found' }), null);
  });
  test('reprocess counts what was queued', () => {
    assert.deepEqual(parseReprocess({ queued: ['a', 'b'], skipped: ['c'] }), { queued: 2, skipped: 1 });
    assert.equal(parseReprocess({ queued: 2 }), null);
  });
});

describe('words', () => {
  test('each wearer state reads plainly, with when it last heard you', () => {
    const w = wearerWords({ state: 'provisional', has_voiceprint: true, last_heard: hoursAgo(3) }, NOW);
    assert.equal(w.word, 'Guessing');
    assert.equal(w.tone, 'warn');
    assert.equal(w.heard, 'Last heard you 3 hours ago.');
    assert.equal(wearerWords({ state: 'none', has_voiceprint: false, last_heard: null }, NOW).word, 'Not learned yet');
    assert.equal(wearerWords({ state: 'enrolled', has_voiceprint: true, last_heard: null }, NOW).heard, null);
  });
  test('no state sentence carries a number or a percentage', () => {
    for (const state of ['none', 'provisional', 'confirmed', 'enrolled'] as const) {
      const w = wearerWords({ state, has_voiceprint: false, last_heard: null }, NOW);
      assert.doesNotMatch(`${w.word} ${w.sentence}`, /\d|%/);
    }
  });
  test('an unreadable time is left out', () => {
    assert.equal(isoAgo('not a date', NOW), null);
    assert.equal(isoAgo(null, NOW), null);
    assert.equal(isoAgo(hoursAgo(0), NOW), 'just now');
  });
  test('voice meta line', () => {
    assert.equal(voiceMeta(voice({ named: false, last_heard: hoursAgo(1), conversations: 3 }), NOW), 'Not named yet, last heard an hour ago, in 3 conversations');
    assert.equal(voiceMeta(voice({ conversations: 1 }), NOW), 'In 1 conversation');
    assert.equal(voiceMeta(voice({}), NOW), 'Not heard yet');
  });
  test('never-heard voices sort last', () => {
    const out = sortVoices([voice({ voice_id: 'a', name: 'B' }), voice({ voice_id: 'b', last_heard: hoursAgo(5) }), voice({ voice_id: 'c', name: 'A' })]);
    assert.deepEqual(out.map((v) => v.voice_id), ['b', 'c', 'a']);
  });
});

describe('band readiness', () => {
  test('listening needs a connection and sound', () => {
    assert.equal(bandReadiness({ connected: true, mic_on: true, always_on: false }), 'listening');
    assert.equal(bandReadiness({ connected: true, mic_on: false, always_on: true }), 'listening');
    assert.equal(bandReadiness({ connected: true, mic_on: false, always_on: false }), 'connected');
    assert.equal(bandReadiness({ connected: false, mic_on: true, always_on: true }), 'disconnected');
    assert.equal(bandReadiness(null), 'none');
  });
  test('every readiness has plain words without numbers', () => {
    for (const r of ['listening', 'connected', 'disconnected', 'none'] as const) assert.doesNotMatch(BAND_WORDS[r].sentence, /\d/);
  });
});

describe('enrolment', () => {
  test('failures in plain words', () => {
    assert.match(enrolFailure(0, 'Cannot reach the backend'), /can’t reach/);
    assert.match(enrolFailure(409, 'The backend at x answered /voices/wearer/enrol with: no band audio (the band is not attached or RECORD_AUDIO=0)'), /band isn’t sending sound/);
    assert.match(enrolFailure(409, '... with: voice memory is off (VOICE_MEMORY=0)'), /turned off/);
    assert.match(enrolFailure(422, '... with: only 1.2 s of speech heard; need 6 s'), /didn’t hear enough/);
    assert.match(enrolFailure(503, 'voice model unavailable'), /voice model/);
    for (const s of [0, 409, 422, 503, 500]) assert.doesNotMatch(enrolFailure(s, 'only 1.2 s heard'), /\d/);
  });
  test('countdown never goes below zero and ends at zero', () => {
    assert.deepEqual(enrolCountdown(0, 15), { left: 15, over: false });
    assert.deepEqual(enrolCountdown(14_100, 15), { left: 1, over: false });
    assert.deepEqual(enrolCountdown(15_000, 15), { left: 0, over: true });
    assert.deepEqual(enrolCountdown(60_000, 15), { left: 0, over: true });
  });
  test('the passage is about forty-five words', () => {
    const words = ENROL_PASSAGE.split(/\s+/).length;
    assert.ok(words >= 40 && words <= 50, `${words} words`);
  });
  test('reprocess toast', () => {
    assert.equal(reprocessWords({ queued: 0, skipped: 2 }), 'There were no earlier conversations to fix.');
    assert.match(reprocessWords({ queued: 1, skipped: 0 }), /^Fixing 1 earlier conversation\./);
    assert.match(reprocessWords({ queued: 7, skipped: 0 }), /^Fixing 7 earlier conversations\./);
  });
  test('names are trimmed and limited', () => {
    assert.equal(cleanName('  Sam   Ortiz '), 'Sam Ortiz');
    assert.equal(cleanName('   '), null);
    assert.equal(cleanName('x'.repeat(81)), null);
  });
});
