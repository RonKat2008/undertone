/** Unit tests for the practice session reducer. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { PracticeServerMessage } from './model.ts';
import { failureWords, INITIAL_SESSION, MAX_CAPTIONS, reduceSession, speakerWords, type PracticeSession, type SessionAction } from './session.ts';
import { goal, result } from '../test-fixtures/practice.ts';

const msg = (message: PracticeServerMessage): SessionAction => ({ type: 'server', message });
const run = (actions: SessionAction[], from: PracticeSession = INITIAL_SESSION) => actions.reduce(reduceSession, from);
const ready = msg({ type: 'practice.ready', coach_name: 'Maya', planned_questions: 5, previous_goals: [goal()] });

describe('reduceSession', () => {
  test('start, ready and the coach asking', () => {
    const s = run([{ type: 'start' }, ready, msg({ type: 'practice.state', state: 'coach' }),
      msg({ type: 'practice.caption', role: 'coach', text: 'Tell me about a project you led.', question: 1 })]);
    assert.equal(s.phase, 'live');
    assert.equal(s.coachName, 'Maya');
    assert.equal(s.planned, 5);
    assert.equal(s.previousGoals.length, 1);
    assert.equal(s.speaker, 'coach');
    assert.equal(s.question, 1);
    assert.equal(s.coachLine, 'Tell me about a project you led.');
  });

  test('your captions do not replace the question; growing captions merge', () => {
    const s = run([{ type: 'start' }, ready,
      msg({ type: 'practice.caption', role: 'coach', text: 'Why?', question: 2 }),
      msg({ type: 'practice.caption', role: 'you', text: 'Because', question: 2 }),
      msg({ type: 'practice.caption', role: 'you', text: 'Because it mattered', question: 2 }),
      msg({ type: 'practice.caption', role: 'you', text: '   ', question: 2 })]);
    assert.equal(s.coachLine, 'Why?');
    assert.equal(s.captions.length, 2);
    assert.equal(s.captions[1].text, 'Because it mattered');
    assert.notEqual(s.captions[0].key, s.captions[1].key);
  });

  test('captions are capped', () => {
    const many = Array.from({ length: MAX_CAPTIONS + 4 }, (_, i): SessionAction =>
      msg({ type: 'practice.caption', role: i % 2 ? 'you' : 'coach', text: `line ${i}`, question: i }));
    assert.equal(run([{ type: 'start' }, ready, ...many]).captions.length, MAX_CAPTIONS);
  });

  test('a caption without a question number keeps the current one', () => {
    const s = run([{ type: 'start' }, ready,
      msg({ type: 'practice.caption', role: 'coach', text: 'First', question: 1 }),
      msg({ type: 'practice.caption', role: 'coach', text: 'Thanks, nice.', question: null })]);
    assert.equal(s.question, 1);
  });

  test('scoring then result; a late close is not a failure', () => {
    const r = result();
    const s = run([{ type: 'start' }, ready, { type: 'end_requested' }, msg({ type: 'practice.scoring' }),
      msg({ type: 'practice.result', result: r }), { type: 'fail', code: 'closed' }]);
    assert.equal(s.phase, 'result');
    assert.equal(s.result?.id, r.id);
    assert.equal(s.failure, null);
  });

  test('a close mid-session is a failure; so is a backend error', () => {
    assert.equal(run([{ type: 'start' }, ready, { type: 'fail', code: 'closed' }]).failure, 'closed');
    assert.equal(run([{ type: 'start' }, msg({ type: 'practice.error', code: 'busy', message: 'x' })]).failure, 'busy');
    const u = run([{ type: 'start' }, { type: 'fail', code: 'unreachable', address: 'ws://h:1/ws/practice' }]);
    assert.equal(u.address, 'ws://h:1/ws/practice');
  });

  test('no result, warnings cleared when you speak, reset', () => {
    const n = run([{ type: 'start' }, ready, msg({ type: 'practice.no_result', message: 'Nothing to score.' })]);
    assert.equal(n.phase, 'no_result');
    assert.equal(n.noResult, 'Nothing to score.');
    const w = run([{ type: 'start' }, ready, msg({ type: 'practice.warning', code: 'mic_quiet', message: 'Speak up' })]);
    assert.equal(w.warning, 'Speak up');
    assert.equal(reduceSession(w, msg({ type: 'practice.state', state: 'you' })).warning, null);
    assert.deepEqual(reduceSession(w, { type: 'reset' }), INITIAL_SESSION);
  });

  test('messages are ignored before start and after the end', () => {
    assert.equal(reduceSession(INITIAL_SESSION, ready).phase, 'before');
    const done = run([{ type: 'start' }, msg({ type: 'practice.error', code: 'no_key', message: 'x' })]);
    assert.equal(reduceSession(done, ready).phase, 'error');
  });
});

describe('words', () => {
  test('every failure has a plain sentence and the address when known', () => {
    assert.match(failureWords('unreachable', 'ws://h:1/ws/practice'), /ws:\/\/h:1/);
    assert.match(failureWords('insecure', null), /localhost/);
    for (const c of ['no_key', 'agent_refused', 'agent_lost', 'mic_silent', 'busy', 'bad_message', 'mic_denied', 'no_mic', 'mic_failed', 'closed'] as const) {
      assert.ok(failureWords(c, null).length > 10);
    }
  });

  test('speaker words name the coach', () => {
    assert.equal(speakerWords('coach', 'Maya'), 'Maya is asking');
    assert.equal(speakerWords('you', null), 'You’re answering');
  });
});
