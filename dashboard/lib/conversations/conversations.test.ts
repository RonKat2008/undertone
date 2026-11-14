/** Unit tests for the conversations library helpers. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  activeTurnIndex, applyKept, audioPositionForTurn, clampSeek, clockTime, conversationTime, dayKey, fillerCount,
  filterSessions, fractionOf, groupByDay, longDate, parseLibrary, parseLibraryUrl, parseLibrarySession, parseTranscript,
  reasonLabel, relativeDayName, restoreSession, splitFillers, timeAtPointer, timeOfDay, transcriptText, writeLibraryUrl,
} from './model.ts';
import { SAMPLE_LIBRARY, sampleTranscript } from './sample.ts';
import { synthWav } from './sample-audio.ts';
import type { LibrarySession, TranscriptTurn } from './types';

const session = (id: string, started_at: string, extra: Partial<LibrarySession> = {}): LibrarySession => ({
  session_id: id, started_at, duration_s: 60, coach_name: 'Interview', mode: 'regular', person_id: null, headline_fact: `Headline ${id}`,
  numbers: { talk_ratio: 0.5, interruptions: 0, questions: 0, fillers_per_min: 0, wpm: 150 }, kept: true, kept_reason: 'keep', audio_url: null, ...extra,
});
const turn = (start: number, extra: Partial<TranscriptTurn> = {}): TranscriptTurn =>
  ({ turn_id: `t${start}`, speaker: 'me', text: 'hello', start, end: start + 2, wpm: 150, fillers: [], ...extra });

describe('shape checks', () => {
  test('a summary without kept fields is kept, with no recording', () => {
    const s = parseLibrarySession({ session_id: 'a', started_at: '2026-11-13T16:02:00Z', duration_s: 30, headline_fact: 'h', numbers: {} });
    assert.equal(s?.kept, true);
    assert.equal(s?.kept_reason, null);
    assert.equal(s?.audio_url, null);
    assert.equal(s?.numbers.wpm, 0);
  });
  test('kept false and a known reason survive; an unknown reason becomes null', () => {
    assert.equal(parseLibrarySession({ session_id: 'a', started_at: '2026-11-13T16:02:00Z', kept: false, kept_reason: 'noise' })?.kept_reason, 'noise');
    assert.equal(parseLibrarySession({ session_id: 'a', started_at: '2026-11-13T16:02:00Z', kept: false, kept_reason: 'weird' })?.kept_reason, null);
  });
  test('rejects things that are not sessions; drops bad list entries', () => {
    assert.equal(parseLibrarySession({ session_id: 'a', started_at: 'not a date' }), null);
    assert.equal(parseLibrarySession(null), null);
    assert.equal(parseLibrary({ sessions: [] }), null);
    assert.deepEqual(parseLibrary([{ session_id: 'a', started_at: '2026-11-13T16:02:00Z' }, 'junk'])?.map((s) => s.session_id), ['a']);
  });
  test('transcript: sorts turns, drops bad ones, defaults the offset', () => {
    const t = parseTranscript({
      session_id: 's', started_at: '2026-11-13T16:02:00Z', duration_s: 10, audio_url: '/sessions/s/audio',
      turns: [{ turn_id: 'b', speaker: 'other', text: 'second', start: 5, end: 6 }, { turn_id: 'a', speaker: 'me', text: 'first', start: 1, end: 2, fillers: ['um', 3] }, { speaker: 'robot', text: 'x', start: 0 }],
    });
    assert.ok(t);
    assert.deepEqual(t.turns.map((x) => x.turn_id), ['a', 'b']);
    assert.deepEqual(t.turns[0].fillers, ['um']);
    assert.equal(t.audio_offset_s, 0);
    assert.equal(parseTranscript({ session_id: 's', started_at: 'x' }), null);
  });
});

describe('days', () => {
  test('day key follows the local offset', () => {
    assert.equal(dayKey('2026-11-13T23:30:00Z', 0), '2026-11-13');
    assert.equal(dayKey('2026-11-13T23:30:00Z', -120), '2026-11-14'); // UTC+2
    assert.equal(dayKey('2026-11-13T02:00:00Z', 300), '2026-11-12'); // UTC-5
    assert.equal(timeOfDay('2026-11-13T16:02:00Z', -60), '17:02');
  });
  test('groups newest day first, newest first within a day', () => {
    const groups = groupByDay([
      session('a', '2026-11-12T09:00:00Z'), session('b', '2026-11-13T08:00:00Z'), session('c', '2026-11-13T16:00:00Z'), session('d', '2026-11-12T18:00:00Z'),
    ], (iso) => dayKey(iso, 0));
    assert.deepEqual(groups.map((g) => g.key), ['2026-11-13', '2026-11-12']);
    assert.deepEqual(groups[0].items.map((s) => s.session_id), ['c', 'b']);
    assert.deepEqual(groups[1].items.map((s) => s.session_id), ['d', 'a']);
    assert.deepEqual(groupByDay([]), []);
  });
  test('day names', () => {
    assert.equal(relativeDayName('2026-11-14', '2026-11-14'), 'Today');
    assert.equal(relativeDayName('2026-11-13', '2026-11-14'), 'Yesterday');
    assert.equal(relativeDayName('2026-03-01', '2026-03-02'), 'Yesterday');
    assert.equal(relativeDayName('2026-11-10', '2026-11-14'), null);
    assert.equal(longDate('2026-11-13', '2026-11-14'), 'Friday 13 November');
    assert.equal(longDate('2025-12-31', '2026-01-02'), 'Wednesday 31 December 2025');
  });
});

describe('kept and filtered', () => {
  test('reason labels in plain words', () => {
    assert.equal(reasonLabel({ kept: false, kept_reason: 'trivial' }), 'Too short to learn from');
    assert.equal(reasonLabel({ kept: false, kept_reason: 'noise' }), 'Background speech');
    assert.equal(reasonLabel({ kept: false, kept_reason: 'sensitive' }), 'Marked private');
    assert.equal(reasonLabel({ kept: false, kept_reason: null }), 'Hidden by you');
    assert.equal(reasonLabel({ kept: true, kept_reason: 'keep' }), null);
  });
  test('override is immutable and can be rolled back', () => {
    const list = [session('a', '2026-11-13T08:00:00Z'), session('b', '2026-11-13T09:00:00Z', { kept: false, kept_reason: 'noise' })];
    const next = applyKept(list, 'b', true);
    assert.equal(list[1].kept, false);
    assert.equal(next[1].kept, true);
    assert.equal(next[1].kept_reason, 'keep');
    assert.equal(next[0], list[0]);
    assert.deepEqual(restoreSession(next, list[1]), list);
  });
});

describe('search', () => {
  const names: Record<string, string> = { 'p-sam': 'Sam' };
  const items = [session('a', '2026-11-13T08:00:00Z', { headline_fact: 'You asked no questions about the trip', person_id: 'p-sam' }), session('b', '2026-11-13T09:00:00Z', { headline_fact: 'Budget review ran long' })];
  const find = (q: string) => filterSessions(items, q, (id) => (id ? names[id] ?? null : null)).map((s) => s.session_id);
  test('matches headline and person, case-insensitively, all terms', () => {
    assert.deepEqual(find('sam'), ['a']);
    assert.deepEqual(find('BUDGET'), ['b']);
    assert.deepEqual(find('sam trip'), ['a']);
    assert.deepEqual(find('sam budget'), []);
    assert.deepEqual(find('   '), ['a', 'b']);
  });
});

describe('library url', () => {
  test('round trip, keeping other params', () => {
    assert.deepEqual(parseLibraryUrl('?all=1&q=sam'), { all: true, q: 'sam' });
    assert.deepEqual(parseLibraryUrl(''), { all: false, q: '' });
    assert.equal(writeLibraryUrl('?bus=mock', { all: true, q: 'sam trip' }), '?bus=mock&all=1&q=sam+trip');
    assert.equal(writeLibraryUrl('?all=1&q=x', { all: false, q: '' }), '');
  });
});

describe('playback maths', () => {
  const turns = [turn(1), turn(4), turn(4.5), turn(10)];
  test('active turn: latest started, previous held through a pause, none before the first', () => {
    assert.equal(activeTurnIndex(turns, 0.5), -1);
    assert.equal(activeTurnIndex(turns, 1), 0);
    assert.equal(activeTurnIndex(turns, 3.9), 0);
    assert.equal(activeTurnIndex(turns, 4.6), 2);
    assert.equal(activeTurnIndex(turns, 8), 2);
    assert.equal(activeTurnIndex(turns, 99), 3);
    assert.equal(activeTurnIndex([], 5), -1);
  });
  test('seek position adds the audio offset and never goes negative', () => {
    assert.equal(audioPositionForTurn({ start: 10 }, 1.5), 11.5);
    assert.equal(audioPositionForTurn({ start: 0.2 }, -1), 0);
    assert.equal(conversationTime(11.5, 1.5), 10);
    // A seek to a turn lands that turn as the active one.
    assert.equal(activeTurnIndex(turns, conversationTime(audioPositionForTurn(turns[1], 2), 2)), 1);
  });
  test('clamping, fractions and pointer position', () => {
    assert.equal(clampSeek(-3, 100), 0);
    assert.equal(clampSeek(105, 100), 100);
    assert.equal(clampSeek(105, null), 105);
    assert.equal(fractionOf(25, 100), 0.25);
    assert.equal(fractionOf(25, null), 0);
    assert.equal(fractionOf(200, 100), 1);
    assert.equal(timeAtPointer(150, 100, 200, 60), 15);
    assert.equal(timeAtPointer(0, 100, 200, 60), 0);
    assert.equal(timeAtPointer(400, 100, 200, 60), 60);
  });
  test('clock', () => {
    assert.equal(clockTime(7.9), '0:07');
    assert.equal(clockTime(760), '12:40');
    assert.equal(clockTime(3723), '1:02:03');
    assert.equal(clockTime(Number.NaN), '0:00');
  });
});

describe('transcript text', () => {
  test('fillers are marked as whole words, longest first, case-insensitive', () => {
    const segs = splitFillers('Um, so you know, I like likes. Basically.', ['um', 'you know', 'like', 'basically']);
    assert.deepEqual(segs.filter((s) => s.filler).map((s) => s.text), ['Um', 'you know', 'like', 'Basically']);
    assert.equal(segs.map((s) => s.text).join(''), 'Um, so you know, I like likes. Basically.');
    assert.deepEqual(splitFillers('plain', []), [{ text: 'plain', filler: false }]);
    assert.deepEqual(splitFillers('a (b)', ['(b']), [{ text: 'a ', filler: false }, { text: '(b', filler: true }, { text: ')', filler: false }]);
  });
  test('markup in speech stays text', () => {
    const segs = splitFillers('<img src=x onerror=alert(1)> um', ['um']);
    assert.equal(segs[0].text, '<img src=x onerror=alert(1)> ');
  });
  test('copyable script and filler count', () => {
    const t = { turns: [turn(0, { text: 'Um hi', fillers: ['um'] }), turn(65, { speaker: 'other', text: 'Hello um', fillers: ['um'] })] };
    assert.equal(transcriptText(t, 'Sam, 13 Nov'), 'Sam, 13 Nov\n\nYou (0:00): Um hi\nThem (1:05): Hello um');
    assert.equal(transcriptText(t), 'You (0:00): Um hi\nThem (1:05): Hello um');
    assert.equal(fillerCount(t.turns), 1);
  });
});

describe('sample data', () => {
  test('every sample session parses, and kept ones have transcripts', () => {
    for (const s of SAMPLE_LIBRARY) {
      assert.ok(parseLibrarySession(s), s.session_id);
      const t = sampleTranscript(s.session_id);
      assert.ok(t && parseTranscript(t), s.session_id);
      for (let i = 1; i < t.turns.length; i++) assert.ok(t.turns[i].start >= t.turns[i - 1].end, `${s.session_id} turn ${i}`);
    }
    assert.equal(sampleTranscript('nope'), null);
    assert.ok(SAMPLE_LIBRARY.some((s) => !s.kept));
  });
  test('the synthesised WAV has a valid header and the right length', () => {
    const wav = synthWav([turn(0.5, { end: 1 })], 2, 0, 1000);
    const v = new DataView(wav.buffer);
    assert.equal(String.fromCharCode(...wav.slice(0, 4)), 'RIFF');
    assert.equal(String.fromCharCode(...wav.slice(8, 12)), 'WAVE');
    assert.equal(v.getUint32(24, true), 1000);
    assert.equal(v.getUint32(40, true), 2000);
    assert.equal(wav.length, 2044);
    assert.equal(wav[44 + 100], 128); // silence before the turn
    assert.notEqual(wav.slice(44 + 520, 44 + 980).some((b) => b !== 128), false);
  });
});
