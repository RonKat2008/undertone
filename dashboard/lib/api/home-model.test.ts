/** Unit tests for the Home page's data shaping. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SessionSummary } from '../bus/contracts';
import {
  durationWords, heroState, newestConversations, nextTimeHint, paceWords, parseOverview, parsePeople, relativeWhen, shareWords,
} from './home-model.ts';

const overview = {
  totals: { conversations: 5, minutes_spoken: 34.8, minutes_together: 69, nudges: 11 },
  highlights: [{ kind: 'improved', text: 'You asked more questions.' }, { kind: 'topic', text: '' }],
  top_people: [{ node_id: 'person:alex', label: 'Alex', conversations: 2, minutes: 29 }, { label: 'no id' }],
  top_topics: [{ node_id: 'topic:vendor-api', label: 'vendor api', conversations: 2, minutes: 29 }],
  series: [{ conversations: 0 }, { conversations: 1 }, { bad: true }],
  insufficient_data: false,
};

describe('parseOverview', () => {
  test('keeps real totals, highlights and ranked items, dropping malformed rows', () => {
    const o = parseOverview(overview);
    assert.ok(o);
    assert.deepEqual(o.totals, { conversations: 5, minutesTogether: 69, nudges: 11 });
    assert.deepEqual(o.highlights, ['You asked more questions.']);
    assert.equal(o.topPeople.length, 1);
    assert.equal(o.topTopics[0].label, 'vendor api');
    assert.deepEqual(o.perDay, [0, 1]);
  });

  test('drops the "too few to compare" sentence and reports insufficient data', () => {
    const o = parseOverview({ totals: { conversations: 0 }, insufficient_data: true, highlights: [{ kind: 'insufficient_data', text: '0 conversations' }] });
    assert.ok(o);
    assert.deepEqual(o.highlights, []);
    assert.equal(o.insufficient, true);
    assert.equal(o.totals.minutesTogether, null);
  });

  test('rejects a wrong shape', () => {
    assert.equal(parseOverview(null), null);
    assert.equal(parseOverview({ totals: {} }), null);
  });
});

describe('people', () => {
  test('parsePeople hides unknown relationships, adds hints and sorts by conversations', () => {
    const body = { people: [
      { person_id: 'sam', name: 'Sam', conversations: 1, relationship: 'unknown', last_talked: 5 },
      { person_id: 'priya', name: 'Priya', conversations: 3, relationship: 'Friend', last_talked: 9 },
      { name: 'No id' },
    ] };
    const people = parsePeople(body, new Map([['priya', 'Last time you talked 50%. Follow up: ask Priya about the wedding.']]));
    assert.ok(people);
    assert.deepEqual(people.map((p) => p.name), ['Priya', 'Sam']);
    assert.equal(people[0].relationship, 'friend');
    assert.equal(people[0].hint, 'Ask Priya about the wedding.');
    assert.equal(people[1].relationship, null);
    assert.equal(parsePeople({}), null);
  });

  test('nextTimeHint never keeps a percentage', () => {
    assert.equal(nextTimeHint('Last time you talked 70%.'), null);
    assert.equal(nextTimeHint(null), null);
    assert.equal(nextTimeHint('Ask about his trip.'), 'Ask about his trip.');
  });
});

describe('sessions and words', () => {
  const s = (id: string, started_at: string, mode: SessionSummary['mode'] = 'regular') =>
    ({ session_id: id, started_at, mode } as SessionSummary);

  test('newestConversations sorts newest first and leaves out practice', () => {
    const out = newestConversations([s('a', '2026-11-10T10:00:00Z'), s('p', '2026-11-13T10:00:00Z', 'practice'), s('b', '2026-11-12T10:00:00Z')]);
    assert.deepEqual(out.map((x) => x.session_id), ['b', 'a']);
  });

  test('newestConversations leaves out the conversation in progress', () => {
    const out = newestConversations([s('a', '2026-11-10T10:00:00Z'), s('live', '2026-11-14T10:00:00Z')], 'live');
    assert.deepEqual(out.map((x) => x.session_id), ['a']);
  });

  test('relativeWhen and durationWords read plainly', () => {
    const now = Date.parse('2026-11-14T12:00:00');
    assert.equal(relativeWhen(new Date(now - 30_000).toISOString(), now), 'just now');
    assert.equal(relativeWhen(new Date(now - 20 * 60000).toISOString(), now), '20 minutes ago');
    assert.equal(relativeWhen(new Date(now - 3 * 3600000).toISOString(), now), '3 hours ago');
    assert.equal(relativeWhen('2026-11-13T09:00:00', now), 'yesterday');
    assert.equal(relativeWhen('2026-11-11T09:00:00', now), '3 days ago');
    assert.equal(relativeWhen('nope', now), '');
    assert.equal(durationWords(30), 'under a minute');
    assert.equal(durationWords(660), '11 minutes');
  });

  test('share and pace are words, not numbers', () => {
    assert.equal(shareWords(0.5, 'Sam'), 'You and Sam talked about evenly');
    assert.equal(shareWords(0.7, 'Sam'), 'You did most of the talking with Sam');
    assert.equal(paceWords(150), 'An easy pace');
    assert.equal(paceWords(190), 'Fast');
    assert.doesNotMatch(shareWords(0.3, 'Sam') + paceWords(120), /\d/);
  });
});

describe('heroState', () => {
  const base = { busStatus: 'live' as const, bandConnected: true, micOn: false, alwaysOn: false, inSession: false };
  test('maps live state to one plain state', () => {
    assert.equal(heroState({ ...base, busStatus: 'offline' }), 'unreachable');
    assert.equal(heroState({ ...base, busStatus: 'connecting', bandConnected: null }), 'connecting');
    assert.equal(heroState({ ...base, inSession: true }), 'conversation');
    assert.equal(heroState({ ...base, bandConnected: false }), 'disconnected');
    assert.equal(heroState({ ...base, alwaysOn: true }), 'listening');
    assert.equal(heroState({ ...base, micOn: true }), 'listening');
    assert.equal(heroState(base), 'ready');
  });
});
