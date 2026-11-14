/** Unit tests for how backend answers become real data, "nothing yet" or a shown failure. Run: npm test. */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { computeStats } from '../graph/model.ts';
import type { KnowledgeGraph } from '../graph/types';
import {
  ApiError, checked, emptyGraph, graphFailure, httpErrorMessage, isDebriefPayload, isPeople, isProfile, isSessionList,
  isWeekly, recordFailure, toGraphResult, unreadableMessage,
} from './results.ts';

const BASE = 'http://localhost:59999';
const graph = (extra: Partial<KnowledgeGraph> = {}): KnowledgeGraph => ({
  nodes: [{ id: 'me', kind: 'me', label: 'Me', weight: 1, last_seen: null, meta: {} },
    { id: 'person:sam', kind: 'person', label: 'Sam', weight: 1, last_seen: 1, meta: {} }],
  edges: [{ source: 'me', target: 'person:sam', kind: 'talked_with', weight: 1 }],
  stats: computeStats([]), generated_at: 100, sample: false, ...extra,
});

describe('graph answers', () => {
  test('a real graph is drawn as is', () => {
    const r = toGraphResult(graph(), 30, BASE, '/graph?days=30');
    assert.equal(r.source, 'live');
    assert.equal(r.data.nodes.length, 2);
    assert.equal(r.days, 30);
  });
  test('the backend’s own illustration (sample: true) is treated as empty, never drawn', () => {
    const r = toGraphResult(graph({ sample: true }), 7, BASE, '/graph?days=7');
    assert.equal(r.source, 'empty');
    assert.equal(r.data.nodes.length, 0);
    assert.equal(r.data.generated_at, 100);
    assert.equal(r.error, null);
  });
  test('a malformed answer is an error that names the address, with nothing to draw', () => {
    const r = toGraphResult({ nodes: 'x' }, 30, BASE, '/graph?days=30');
    assert.equal(r.source, 'invalid');
    assert.equal(r.data.nodes.length, 0);
    assert.match(r.error ?? '', /localhost:59999/);
    assert.doesNotMatch(r.error ?? '', /days=/);
  });
  test('unreachable keeps the message and draws nothing', () => {
    const r = graphFailure(new ApiError(`Cannot reach the backend at ${BASE}`, 0), 90, BASE);
    assert.equal(r.source, 'unreachable');
    assert.equal(r.error, `Cannot reach the backend at ${BASE}`);
    assert.equal(r.data.nodes.length, 0);
    assert.match(graphFailure('weird', 90, BASE).error ?? '', /59999/);
  });
  test('the empty graph has zero stats', () => {
    assert.deepEqual(emptyGraph(5).stats, { conversations: 0, people: 0, topics: 0, minutes_spoken: 0, open_commitments: 0 });
  });
});

describe('list and record reads', () => {
  test('an empty list is real data, not a failure', () => {
    assert.deepEqual(checked([], isSessionList, BASE, '/sessions'), { ok: true, data: [] });
    assert.deepEqual(checked([], isPeople, BASE, '/people'), { ok: true, data: [] });
  });
  test('a body of the wrong shape is a failure naming the address and path', () => {
    const r = checked({ sessions: [] }, isSessionList, BASE, '/sessions?include=all');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error, unreadableMessage(BASE, '/sessions'));
    assert.equal(checked([{ session_id: 1 }], isSessionList, BASE, '/sessions').ok, false);
  });
  test('profile, weekly and debrief shapes', () => {
    assert.equal(isProfile({ sessions: 0, crutch_words: [], recurring_issues: [] }), true);
    assert.equal(isProfile({ sessions: 0 }), false);
    assert.equal(isWeekly({ trend: [] }), true);
    assert.equal(isWeekly({ ok: false }), false);
    assert.equal(isDebriefPayload({ session_id: 's', data: { headline_fact: 'h' }, audio_url: null }), true);
    assert.equal(isDebriefPayload({ session_id: 's', data: null }), false);
  });
  test('a 404 means "none", anything else is an error to show', () => {
    assert.deepEqual(recordFailure(new ApiError('no debrief', 404), BASE), { kind: 'not_found' });
    assert.deepEqual(recordFailure(new ApiError('boom', 500), BASE), { kind: 'error', message: 'boom' });
    assert.deepEqual(recordFailure(new TypeError(''), BASE), { kind: 'error', message: `Cannot reach the backend at ${BASE}` });
  });
  test('HTTP errors quote the backend', () => {
    assert.equal(httpErrorMessage(BASE, '/sessions/x/debrief', 404, { ok: false, error: { message: 'no debrief for x' } }),
      `The backend at ${BASE} answered /sessions/x/debrief with: no debrief for x`);
    assert.equal(httpErrorMessage(BASE, '/graph?days=7', 502, null), `The backend at ${BASE} answered /graph with: HTTP 502`);
    assert.equal(httpErrorMessage(BASE, '/p', 422, { detail: 'bad' }), `The backend at ${BASE} answered /p with: bad`);
  });
});
