/** Unit tests for the practice wire shapes and plain words. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  checkWords, clampScore, dayWords, durationWords, evidenceWords, fromAnswerWords, goalsMetWords, isPracticeGoals, isPracticeResult,
  isPracticeResultList, parseServerMessage, questionWords, scoreBand, scoreWords, sourceWords, trendDomain, trendValues, trendWords,
} from './model.ts';
import { goal, result, summary } from '../test-fixtures/practice.ts';

describe('boundary checks', () => {
  test('a full result passes; nulls for unmeasured values pass', () => {
    assert.ok(isPracticeResult(result()));
    assert.ok(isPracticeResult(result({ goals: [goal({ actual: null, evidence: null, from_answer: null, unit: null })] })));
    assert.ok(isPracticeResult(result({ previous_goals: [{ goal: goal(), now: null, met: null, detail: 'Not measured' }] })));
  });

  test('broken results fail', () => {
    assert.equal(isPracticeResult({ ...result(), overall: '72' }), false);
    assert.equal(isPracticeResult({ ...result(), sub_scores: [{ measure: 'volume', label: 'x', score: 1, source: 'measured', detail: '' }] }), false);
    assert.equal(isPracticeResult({ ...result(), goals: [{ ...goal(), actual: 'seven' }] }), false);
    assert.equal(isPracticeResult(null), false);
  });

  test('summaries and goals', () => {
    assert.ok(isPracticeResultList([summary(), summary({ id: 'p2', goals_met: null, goals_checked: 0 })]));
    assert.equal(isPracticeResultList([{ id: 'x' }]), false);
    assert.ok(isPracticeGoals({ result_id: null, started_at: null, coach_name: null, overall: null, goals: [] }));
    assert.ok(isPracticeGoals({ result_id: 'p1', started_at: 'x', coach_name: 'Maya', overall: 70, goals: [goal()] }));
    assert.equal(isPracticeGoals({ goals: [] }), false);
  });
});

describe('parseServerMessage', () => {
  test('reads each known message', () => {
    assert.deepEqual(parseServerMessage('{"type":"practice.state","state":"coach"}'), { type: 'practice.state', state: 'coach' });
    assert.equal(parseServerMessage('{"type":"practice.scoring"}')?.type, 'practice.scoring');
    assert.equal(parseServerMessage(JSON.stringify({ type: 'practice.result', result: result() }))?.type, 'practice.result');
    assert.equal(parseServerMessage(JSON.stringify({ type: 'practice.ready', coach_name: 'Maya', planned_questions: 5, previous_goals: [] }))?.type, 'practice.ready');
    assert.equal(parseServerMessage('{"type":"practice.caption","role":"you","text":"hi","question":null}')?.type, 'practice.caption');
    assert.equal(parseServerMessage('{"type":"practice.error","code":"busy","message":"x"}')?.type, 'practice.error');
  });

  test('rejects junk and unknown shapes', () => {
    assert.equal(parseServerMessage('not json'), null);
    assert.equal(parseServerMessage('{"type":"practice.state","state":"singing"}'), null);
    assert.equal(parseServerMessage('{"type":"practice.error","code":"oops","message":"x"}'), null);
    assert.equal(parseServerMessage('{"type":"practice.result","result":{}}'), null);
    assert.equal(parseServerMessage('[1,2]'), null);
  });
});

describe('plain words', () => {
  test('sources and checks', () => {
    assert.equal(sourceWords('measured'), 'From your numbers');
    assert.equal(sourceWords('judged'), 'Coach’s judgement');
    assert.ok(sourceWords('rules').length > 0);
    assert.deepEqual(checkWords(true), { tone: 'met', word: 'Met' });
    assert.deepEqual(checkWords(false), { tone: 'not_yet', word: 'Not yet' });
    assert.equal(checkWords(null).tone, 'unknown');
  });

  test('question count', () => {
    assert.equal(questionWords(2, 5), 'Question 2 of about 5');
    assert.equal(questionWords(null, 5), 'Getting started');
    assert.equal(questionWords(6, 5), 'Question 6');
  });

  test('durations and days', () => {
    assert.equal(durationWords(30), 'under a minute');
    assert.equal(durationWords(70), 'about a minute');
    assert.equal(durationWords(290), 'about 5 minutes');
    const now = new Date(2026, 10, 14, 15).getTime();
    assert.equal(dayWords(new Date(2026, 10, 14, 9).toISOString(), now), 'Today');
    assert.equal(dayWords(new Date(2026, 10, 13, 22).toISOString(), now), 'Yesterday');
    assert.equal(dayWords(new Date(2026, 10, 11, 9).toISOString(), now), '3 days ago');
    assert.equal(dayWords(new Date(2026, 9, 2, 9).toISOString(), now), 'Oct 2');
    assert.equal(dayWords('garbage', now), '');
  });

  test('scores', () => {
    assert.equal(scoreBand(80), 'high');
    assert.equal(scoreBand(50), 'mid');
    assert.equal(scoreBand(10), 'low');
    assert.equal(scoreWords(90), 'Excellent');
    assert.equal(scoreWords(20), 'A starting point');
    assert.equal(clampScore(140), 100);
    assert.equal(clampScore(Number.NaN), 0);
  });

  test('trend oldest first, and in words', () => {
    const list = [summary({ id: 'c', overall: 80 }), summary({ id: 'b', overall: 70 }), summary({ id: 'a', overall: 60 })];
    assert.deepEqual(trendValues(list), [60, 70, 80]);
    assert.match(trendWords([60, 70, 80]), /gone up over 3/);
    assert.match(trendWords([80, 60]), /gone down/);
    assert.match(trendWords([70, 71]), /steady/);
    assert.match(trendWords([70]), /Not enough/);
    assert.deepEqual(trendDomain([48, 51]), [38, 61]);
    assert.deepEqual(trendDomain([5, 98]), [0, 100]);
    assert.deepEqual(trendDomain([]), [0, 100]);
  });

  test('evidence is quoted once', () => {
    assert.equal(evidenceWords('228 words a minute there'), '“228 words a minute there”');
    assert.equal(evidenceWords('“um” ×2 in that answer'), '“um” ×2 in that answer');
    assert.equal(evidenceWords('  '), null);
    assert.equal(evidenceWords(null), null);
  });

  test('goal counts and answer references', () => {
    assert.equal(goalsMetWords(summary({ goals_met: 1, goals_checked: 2 })), '1 of 2 earlier goals met');
    assert.equal(goalsMetWords(summary({ goals_met: null, goals_checked: 0 })), null);
    assert.equal(fromAnswerWords(3), 'From answer 3');
    assert.equal(fromAnswerWords(null), null);
  });
});
