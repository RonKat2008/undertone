/** Unit tests for the Coach page's plain-language shaping. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { CoachSpec, NudgeRule } from '../bus/contracts';
import {
  canBuildPersonal, goalSentence, shortGoal, habitLines, howOften, listensFor, orderCoaches, parseCondition, sentenceFromInstructions, whenSentence,
} from './coach.ts';

const rule = (id: string, when: string, message: string, extra: Partial<NudgeRule> = {}): NudgeRule => ({ id, when, haptic: 'tap', message, ...extra });

const coach = (extra: Partial<CoachSpec> = {}): CoachSpec => ({
  id: 'c', name: 'Coach', goal: 'Speak plainly. Then more.', kind: 'prebuilt', confidence_threshold: 0.8, keyterms: [], filler_words: [],
  questions: {}, nudge_rules: [], motion_rules: [],
  nudge_policy: { focus_rule_id: 'pace', budget_per_session: 3, min_gap_s: 120, tolerance: 0.25, silent: false },
  debrief_rubric: '', drill: { partner_persona: '', prompts: [] }, ...extra,
});

describe('conditions', () => {
  test('parses a simple comparison', () => {
    assert.deepEqual(parseCondition('judge.hedging.p >= 0.8'), { scope: 'judge', path: ['hedging', 'p'], op: '>=', value: '0.8' });
  });
  test('anything else is not parsed', () => {
    assert.equal(parseCondition('metrics.wpm > 1 and metrics.x < 2')?.value, '1 and metrics.x < 2');
    assert.equal(parseCondition('nonsense'), null);
  });
});

describe('when a rule buzzes, in words', () => {
  const c = coach({
    questions: {
      vague_quantity: { type: 'noul', instructions: "Answer YES if the wearer describes an amount, size, impact, or change using only vague words ('a lot') where a number would fit. Answer NO otherwise." },
    },
  });
  test('metrics rules read as a sentence with no number', () => {
    const s = whenSentence(rule('pace', 'metrics.wpm > 190', 'Slow down'), c);
    assert.equal(s, 'When you start talking faster than your comfortable pace.');
    assert.doesNotMatch(s, /\d/);
  });
  test('core judge questions use the built-in wording', () => {
    assert.match(whenSentence(rule('h', 'judge.hedging.p >= 0.8', 'Say it plainly'), c), /hedges/);
    assert.equal(whenSentence(rule('a', 'judge.asked_question.p < 0.2', 'Ask'), c), 'When you go a while without asking them anything.');
  });
  test('a custom question becomes a sentence about you', () => {
    assert.equal(whenSentence(rule('v', 'judge.vague_quantity.p >= 0.8', 'Put a number on it'), c), 'When you describe an amount.');
  });
  test('motion rules', () => {
    assert.equal(whenSentence(rule('f', 'motion.fidget_while_other_s > 8', 'Hands calm'), c), 'When your hands fidget while they are talking.');
  });
  test('an unknown condition falls back to the words', () => {
    assert.equal(whenSentence(rule('x', 'judge.mystery.p >= 0.8', 'Breathe.'), c), 'When the coach notices it is time to breathe.');
  });
  test('a "but" clause is kept, since it carries the meaning', () => {
    assert.equal(
      sentenceFromInstructions("Answer YES only if the wearer's turn tells a story about a past situation, but never states how it turned out (no outcome). Answer NO otherwise."),
      'When your turn tells a story about a past situation, but never states how it turned out.',
    );
  });
  test('instructions without a yes-clause give nothing', () => {
    assert.equal(sentenceFromInstructions('Judge where the answer appears.'), null);
  });
});

describe('what a coach listens for', () => {
  const c = coach({
    nudge_rules: [
      rule('fill', 'metrics.fillers_per_min > 6', 'Pause instead', { haptic: 'filler' }),
      rule('pace', 'metrics.wpm > 190', 'Slow down', { haptic: 'slow_down' }),
      rule('off', 'metrics.talk_ratio > 0.5', 'Ask them', { enabled: false }),
      rule('dup', 'metrics.fillers_per_min > 9', 'Pause instead'),
      rule('a', 'metrics.monologue_s > 45', 'Wrap up'),
      rule('b', 'metrics.interruptions > 2', 'Let them finish'),
    ],
    motion_rules: [rule('m', 'metrics.hand_energy > 0.85', 'Smaller gestures'), rule('n', 'motion.state == fidget', 'Hands calm')],
  });
  const lines = listensFor(c);
  test('the buzzing rule comes first, disabled and repeated words are dropped, at most five', () => {
    assert.equal(lines[0].words, 'Slow down');
    assert.equal(lines[0].buzzes, true);
    assert.equal(lines.length, 5);
    assert.ok(!lines.some((l) => l.words === 'Ask them'));
    assert.equal(lines.filter((l) => l.words === 'Pause instead').length, 1);
    assert.ok(lines.slice(1).every((l) => !l.buzzes));
  });
  test('a personal coach buzzes for every rule in practice', () => {
    assert.ok(listensFor({ ...c, kind: 'personal' }).every((l) => l.buzzes));
  });
});

describe('goal and habits', () => {
  test('goal keeps its first sentence', () => {
    assert.equal(goalSentence('Speak plainly. Then more.'), 'Speak plainly.');
    assert.equal(goalSentence('listen more'), 'listen more.');
  });
  test('short goal cuts at a word', () => {
    const g = shortGoal('Give structured, direct answers in job and case interviews: answer the question that was asked.', 40);
    assert.equal(g, 'Give structured, direct answers in job…');
    assert.equal(shortGoal('Be kind.'), 'Be kind.');
  });
  test('how often, in words', () => {
    assert.equal(howOften(3.38), 'A few times a conversation');
    assert.equal(howOften(0.12), 'Now and then');
    assert.equal(howOften(1), 'About once a conversation');
  });
  test('habit lines are sorted by how often and say the direction', () => {
    const lines = habitLines({
      sessions: 8, baseline_wpm: 160, baseline_volume_db: null, crutch_words: [],
      recurring_issues: [
        { rule_id: 'pace', label: 'Speaking fast', rate: 0.12, trend: 'worse' },
        { rule_id: 'fillers', label: 'Filler words', rate: 3.38, trend: 'better' },
        { rule_id: 'filler', label: 'Filler words', rate: 0.5, trend: 'worse' },
      ],
    });
    assert.deepEqual(lines.map((l) => [l.label, l.trend]), [['Filler words', 'Getting better'], ['Speaking fast', 'Happening more']]);
  });
  test('the personal coach needs a few conversations', () => {
    assert.equal(canBuildPersonal(null), false);
    assert.equal(canBuildPersonal({ sessions: 2, baseline_wpm: null, baseline_volume_db: null, crutch_words: [], recurring_issues: [] }), false);
    assert.equal(canBuildPersonal({ sessions: 3, baseline_wpm: null, baseline_volume_db: null, crutch_words: [], recurring_issues: [] }), true);
  });
  test('coaches: active first, then built-in, then yours', () => {
    const list = orderCoaches([coach({ id: 'z', name: 'Mine', kind: 'custom' }), coach({ id: 'b', name: 'B' }), coach({ id: 'a', name: 'A' })], 'b');
    assert.deepEqual(list.map((c) => c.id), ['b', 'a', 'z']);
  });
});
