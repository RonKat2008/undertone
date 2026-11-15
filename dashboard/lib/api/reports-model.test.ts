/** Unit tests for the Insights report model. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  dayWords, dueWords, edgeKey, focusSet, habitDirection, habitFocus, isByPersonReport, isGraphFocus, isOverviewReport,
  isPromisesReport, minutesWords, nodeKey, oneHopFocus, parseInsightsUrl, promiseFocus, relationshipByNode, relationshipWord,
  splitNumbers, topicDirection, viewForNode, writeInsightsUrl, type HabitReport, type ReportDelta, type ReportPromise,
} from './reports-model.ts';

const NOW = Date.parse('2026-11-14T15:00:00Z') / 1000;
const delta = (over: Partial<ReportDelta>): ReportDelta => ({
  metric: 'habit_per_conversation', current: 1, previous: 1, change: 0, direction: 'same', better: null, sample: 5, previous_sample: 5, ...over,
});
const focus = { node_ids: ['me'], edges: [] };
const window = { days: 30, start: 0, end: 1, previous_start: 0 };
const promise = (over: Partial<ReportPromise> = {}): ReportPromise => ({
  id: 'commitment:1', bookmark_id: 1, text: 'Send the notes', quote: null, person_id: 'alex', person_name: 'Alex',
  person_node_id: 'person:alex', session_id: 's1', conversation_node_id: 'conversation:s1', made_at: NOW - 86400 * 3,
  age_days: 3, open: true, closed_by: null, closed_at: null, evidence: null, due_day: null, overdue: false, ...over,
});

describe('url state', () => {
  test('defaults and round trip, keeping other params', () => {
    assert.deepEqual(parseInsightsUrl(''), { view: 'overview', days: 30, node: null });
    const s = writeInsightsUrl('?bus=http%3A%2F%2Flocalhost%3A8813', { view: 'people', days: 7, node: 'person:alex' });
    assert.equal(s, '?bus=http%3A%2F%2Flocalhost%3A8813&view=people&days=7&node=person%3Aalex');
    assert.deepEqual(parseInsightsUrl(s), { view: 'people', days: 7, node: 'person:alex' });
    assert.equal(writeInsightsUrl('?view=topics&days=7', { view: 'overview', days: 30, node: null }), '');
  });

  test('rejects unknown views, ranges and node ids', () => {
    assert.deepEqual(parseInsightsUrl('?view=hack&days=12&node=javascript:alert(1)'), { view: 'overview', days: 30, node: null });
    assert.equal(parseInsightsUrl('?node=topic:apartment-hunt').node, 'topic:apartment-hunt');
  });

  test('nodes map to their view', () => {
    assert.equal(viewForNode('person:alex'), 'people');
    assert.equal(viewForNode('topic:x'), 'topics');
    assert.equal(viewForNode('habit:fillers'), 'habits');
    assert.equal(viewForNode('commitment:3'), 'promises');
    assert.equal(viewForNode('conversation:s1'), null);
    assert.equal(viewForNode('me'), null);
    assert.equal(nodeKey('topic:on-call:rotation'), 'on-call:rotation');
  });
});

describe('validation', () => {
  test('accepts real-shaped reports and rejects broken ones', () => {
    assert.equal(isGraphFocus(focus), true);
    assert.equal(isGraphFocus({ node_ids: [1], edges: [] }), false);
    assert.equal(isByPersonReport({ window, people: [], untagged_conversations: 0, graph_focus: focus }), true);
    assert.equal(isByPersonReport({ window, people: [{ name: 'x' }], graph_focus: focus }), false);
    assert.equal(isPromisesReport({ window, counts: {}, open: [promise()], done: [], graph_focus: focus }), true);
    assert.equal(isOverviewReport({ window, graph_focus: focus }), false);
    assert.equal(isOverviewReport({
      window, graph_focus: focus, totals: { conversations: 0 }, promises: {}, top_people: [], top_topics: [], highlights: [],
      habits: [], by_relationship: [],
    }), true);
  });
});

describe('focus', () => {
  test('edge keys are undirected', () => {
    assert.equal(edgeKey('b', 'a'), edgeKey('a', 'b'));
    const f = focusSet({ node_ids: ['me', 'person:a'], edges: [{ source: 'person:a', target: 'me' }] });
    assert.ok(f?.edges.has(edgeKey('me', 'person:a')));
    assert.equal(focusSet({ node_ids: [], edges: [] }), null);
    assert.equal(focusSet(null), null);
  });

  test('one hop takes the node and its neighbours only', () => {
    const f = oneHopFocus('person:a', [
      { source: 'me', target: 'person:a' }, { source: 'conversation:1', target: 'person:a' }, { source: 'conversation:1', target: 'topic:x' },
    ]);
    assert.deepEqual([...f.nodes].sort(), ['conversation:1', 'me', 'person:a']);
    assert.equal(f.edges.size, 2);
  });

  test('habit and promise neighbourhoods', () => {
    const h: HabitReport = {
      habit: { rule_id: 'fillers', node_id: 'habit:fillers', label: 'Filler words', total: 3, buzzed: 0, quiet: 3, conversations: 2, per_conversation: 1.5, trend: delta({}) },
      series: [], by_person: [{ node_id: 'person:a', label: 'A', count: 2 }], by_topic: [{ node_id: 'topic:x', label: 'x', count: 1 }], if_then: [],
    };
    assert.deepEqual(habitFocus(h).node_ids, ['me', 'habit:fillers', 'person:a', 'topic:x']);
    assert.equal(promiseFocus(promise()).edges.length, 3);
    assert.equal(promiseFocus(promise({ person_node_id: null })).node_ids.length, 3);
  });
});

describe('words', () => {
  test('relationship: nothing when unknown, plain when sure, hedged when not', () => {
    assert.equal(relationshipWord(null), null);
    assert.equal(relationshipWord('unknown', 0.9, 'decisions'), null);
    assert.equal(relationshipWord('boss', 1, 'user'), 'Boss');
    assert.equal(relationshipWord('friend', 0.8, 'decisions'), 'Friend');
    assert.equal(relationshipWord('friend', 0.4, 'rules'), 'Probably a friend');
    assert.equal(relationshipWord('coworker', 0.2, 'user'), 'Coworker');
    const m = relationshipByNode([{ kind: 'friend', people: 1, conversations: 1, minutes: 1, node_ids: ['person:p'] }]);
    assert.equal(m.get('person:p'), 'friend');
  });

  test('habit direction never reads as a number', () => {
    assert.equal(habitDirection(delta({ direction: 'insufficient_data' })), null);
    assert.deepEqual(habitDirection(delta({ direction: 'down', better: true })), { word: 'easing', tone: 'good' });
    assert.deepEqual(habitDirection(delta({ direction: 'up', better: false })), { word: 'more often', tone: 'bad' });
    assert.deepEqual(habitDirection(delta({ direction: 'same' })), { word: 'steady', tone: 'neutral' });
  });

  test('topic direction', () => {
    assert.equal(topicDirection(delta({ direction: 'up', previous: 0 }), 7), 'new this week');
    assert.equal(topicDirection(delta({ direction: 'up', previous: 2 }), 30), 'coming up more');
    assert.equal(topicDirection(delta({ direction: 'insufficient_data' }), 30), null);
  });

  test('minutes and days', () => {
    assert.equal(minutesWords(0.2), 'under a minute');
    assert.equal(minutesWords(1), 'a minute');
    assert.equal(minutesWords(47), '47 minutes');
    assert.equal(minutesWords(125), '2 hours 5 min');
    assert.equal(dayWords(NOW - 3600, NOW), 'today');
    assert.equal(dayWords(NOW - 86400, NOW), 'yesterday');
    assert.equal(dayWords(Date.parse('2026-11-11T09:00:00Z') / 1000, NOW), 'Wednesday');
    assert.equal(dayWords(Date.parse('2026-10-02T09:00:00Z') / 1000, NOW), '2 Oct');
  });

  test('due words say overdue plainly and stay silent without a day', () => {
    assert.equal(dueWords(promise(), NOW), null);
    assert.equal(dueWords(promise({ due_day: '2026-11-11', overdue: true }), NOW), 'was due Wednesday');
    assert.equal(dueWords(promise({ due_day: '2026-11-15' }), NOW), 'due tomorrow');
    assert.equal(dueWords(promise({ due_day: 'garbage' }), NOW), null);
  });

  test('numbers in report sentences are split out for InlineStat', () => {
    const parts = splitNumbers('You interrupt Alex 2.3x as often as in your other conversations (3.7 against 1.6 a conversation).');
    const nums = parts.filter((p) => 'value' in p);
    assert.deepEqual(nums, [{ value: 2.3, decimals: 1, suffix: 'x' }, { value: 3.7, decimals: 1, suffix: '' }, { value: 1.6, decimals: 1, suffix: '' }]);
    assert.equal(parts.map((p) => ('text' in p ? p.text : `${p.value}${p.suffix}`)).join(''),
      'You interrupt Alex 2.3x as often as in your other conversations (3.7 against 1.6 a conversation).');
    assert.deepEqual(splitNumbers('You talk 58% of the time.').filter((p) => 'value' in p), [{ value: 58, decimals: 0, suffix: '%' }]);
    assert.deepEqual(splitNumbers('Down from 5 last 1:1.').filter((p) => 'value' in p), [{ value: 5, decimals: 0, suffix: '' }]);
  });
});
