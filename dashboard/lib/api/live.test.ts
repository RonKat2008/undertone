/** Unit tests for the Live page's plain-language shaping. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Mark, TurnView } from '../bus/reducer';
import { clock, detections, judgeDetections, markDetection, motionDetection, paceOf, shareWords, splitFillers, turnDetections } from './live.ts';

const turn = (extra: Partial<TurnView> = {}): TurnView => ({ turn_id: 't1', speaker: 'me', text: 'um so', start: 0, end: 10, wpm: 150, fillers: [], ...extra });
const mark = (extra: Partial<Mark>): Mark => ({
  id: 'm1', kind: 'nudge', ts: 42, at: 0, pattern: 'slow_down', rule_id: 'pace', title: 'Slow down', detail: 'fast', confidence: 0.9, latency_ms: 300, ...extra,
});

describe('pace and state word', () => {
  test('rushing above the comfortable edge, steady inside, listening when you are quiet', () => {
    const m = { wpm: 200, baseline_wpm: 150 };
    assert.equal(paceOf(m, { tolerance: 0.25 }, true).word, 'Rushing');
    assert.equal(paceOf({ ...m, wpm: 160 }, { tolerance: 0.25 }, true).word, 'Steady');
    assert.equal(paceOf(m, { tolerance: 0.25 }, false).word, 'Listening');
    assert.equal(paceOf(null, null, true).word, 'Listening');
  });
  test('without a learned pace it uses a default and says so', () => {
    const p = paceOf({ wpm: 140, baseline_wpm: null }, null, true);
    assert.equal(p.learning, true);
    assert.ok(p.zone[0] < 140 && p.zone[1] > 140);
  });
  test('share in words', () => {
    assert.equal(shareWords(0.8), 'You are doing most of the talking');
    assert.equal(shareWords(0.5), 'You are sharing the talking evenly');
    assert.equal(shareWords(null), 'Nobody has spoken yet');
  });
});

describe('detections', () => {
  test('fillers, rushing and long turns from your turns only', () => {
    const d = turnDetections(turn({ fillers: ['Um', 'like'], wpm: 220, end: 60 }), 190);
    assert.deepEqual(d.map((x) => x.text), ['Filler word: um', 'Filler word: like', 'Rushing', 'Long turn']);
    assert.deepEqual(turnDetections(turn({ speaker: 'other', fillers: ['um'] }), 190), []);
  });
  test('judge answers become words, never numbers', () => {
    const d = judgeDetections(turn({
      judge: {
        latency_ms: 300, source: 'decisions', results: {
          interrupted: { kind: 'noul', p: 0.9, confidence: 0.9 },
          hedging: { kind: 'noul', p: 0.1, confidence: 0.9 },
          answered_the_question: { kind: 'noul', p: 0.2, confidence: 0.8 },
          question_type: { kind: 'choice', choice: 'open', probabilities: {}, confidence: 0.7 },
          missing_result: { kind: 'noul', p: 0.8, confidence: 0.8 },
          commitment_made: { kind: 'noul', p: 0.9, confidence: 0.9 },
        },
      },
    }));
    assert.deepEqual(d.map((x) => x.text), ['Talked over them', 'Did not answer the question', 'Good question', 'Missing result']);
    assert.ok(d.every((x) => !/\d/.test(x.text)));
  });
  test('marks: buzzes, promises, bookmarks, signals; quiet marks are left to the turns', () => {
    assert.equal(markDetection(mark({}))?.text, 'Buzzed: Slow down');
    assert.equal(markDetection(mark({ kind: 'bookmark', rule_id: 'promise' }))?.text, 'Promise made');
    assert.equal(markDetection(mark({ kind: 'bookmark', rule_id: 'phone' }))?.text, 'Bookmarked');
    assert.equal(markDetection(mark({ kind: 'signal', rule_id: 'nerves' }))?.tone, 'signal');
    assert.equal(markDetection(mark({ kind: 'quiet' })), null);
  });
  test('hands', () => {
    assert.equal(motionDetection({ id: 'x', ts: 1, state: 'fidget', whileThey: true })?.text, 'Hands: fidgeting while they talk');
    assert.equal(motionDetection({ id: 'x', ts: 1, state: 'still', whileThey: false }), null);
  });
  test('the stream is newest first', () => {
    const list = detections({
      turns: [turn({ fillers: ['um'], end: 5 }), turn({ turn_id: 't2', fillers: ['like'], end: 20 })],
      marks: [mark({ ts: 12 })], metrics: null, session: null,
    });
    assert.deepEqual(list.map((d) => d.text), ['Filler word: like', 'Buzzed: Slow down', 'Filler word: um']);
  });
});

describe('text helpers', () => {
  test('fillers are split out, longest first, whole words only', () => {
    assert.deepEqual(splitFillers('Um I mean likely, you know', ['um', 'I mean', 'like', 'you know']), [
      { text: 'Um', filler: true }, { text: ' ', filler: false }, { text: 'I mean', filler: true }, { text: ' likely, ', filler: false }, { text: 'you know', filler: true },
    ]);
  });
  test('clock', () => {
    assert.equal(clock(42), '0:42');
    assert.equal(clock(3725), '1:02:05');
  });
});
