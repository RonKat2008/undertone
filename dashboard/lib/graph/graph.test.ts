/** Unit tests for the pure graph modules. Run: npm test (node --test, no extra packages). */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { describeNode, duration, formatFact, nodeFacts, relativeDay, weightLabel } from './format.ts';
import {
  clampZoom, computeLayout, fitView, hash, labelBox, MAX_ZOOM, MIN_ZOOM, nodeRadius, placeLabels, toScreen, toWorld,
  truncate, zoomAround, type LabelCandidate,
} from './layout.ts';
import {
  buildAdjacency, computeStats, edgeIsLit, emphasisFor, filterGraph, groupByKind, isEmptyGraph, isGraphNode,
  isKnowledgeGraph, isNodeDetail, neighbourIds, searchNodes, windowGraph,
} from './model.ts';
import { fullSampleGraph, sampleGraph, sampleNodeDetail } from './sample.ts';
import type { FilterKind, GraphEdge, GraphNode, KnowledgeGraph } from './types';
import { parseGraphUrl, toggleKind, writeGraphUrl } from './url.ts';

const NOW = 1_794_000_000;
const DAY = 86400;

const node = (id: string, kind: GraphNode['kind'], label = id, extra: Partial<GraphNode> = {}): GraphNode =>
  ({ id, kind, label, weight: 1, last_seen: null, meta: {}, ...extra });
const edge = (source: string, target: string, kind: GraphEdge['kind'] = 'talked_with'): GraphEdge => ({ source, target, kind, weight: 1 });

const tiny = {
  nodes: [node('me', 'me', 'You'), node('person:sam', 'person', 'Sam'), node('person:alex', 'person', 'Alex'),
    node('topic:pricing', 'topic', 'Pricing'), node('conversation:c1', 'conversation', 'Sam · 1 Nov')],
  edges: [edge('me', 'person:sam'), edge('me', 'person:alex'), edge('person:sam', 'conversation:c1', 'part_of'),
    edge('conversation:c1', 'topic:pricing', 'about')],
};

describe('validation', () => {
  test('accepts the sample graph and rejects malformed payloads', () => {
    assert.equal(isKnowledgeGraph(fullSampleGraph(NOW)), true);
    assert.equal(isKnowledgeGraph({ nodes: 'x', edges: [], stats: {}, sample: false }), false);
    assert.equal(isKnowledgeGraph(null), false);
    assert.equal(isGraphNode({ ...node('a', 'person'), kind: 'robot' }), false);
    assert.equal(isGraphNode({ ...node('a', 'person'), weight: Number.NaN }), false);
  });

  test('accepts a sample node detail', () => {
    const g = fullSampleGraph(NOW);
    assert.equal(isNodeDetail(sampleNodeDetail(g, 'person:p-sam')), true);
    assert.equal(isNodeDetail({ node: {}, neighbours: [], conversations: [], quotes: [] }), false);
  });
});

describe('neighbours and filtering', () => {
  test('adjacency is symmetric and ignores self loops', () => {
    const adj = buildAdjacency([...tiny.edges, edge('me', 'me')]);
    assert.deepEqual([...neighbourIds(adj, 'person:sam')].sort(), ['conversation:c1', 'me']);
    assert.equal(neighbourIds(adj, 'me').has('me'), false);
    assert.equal(neighbourIds(adj, 'nobody').size, 0);
  });

  test('filterGraph drops switched-off kinds and their edges, but keeps me', () => {
    const out = filterGraph(tiny, new Set<FilterKind>(['person']));
    assert.deepEqual(out.nodes.map((n) => n.id), ['me', 'person:sam', 'person:alex']);
    assert.deepEqual(out.edges.map((e) => `${e.source}>${e.target}`), ['me>person:sam', 'me>person:alex']);
    const none = filterGraph(tiny, new Set());
    assert.deepEqual(none.nodes.map((n) => n.id), ['me']);
    assert.equal(none.edges.length, 0);
    assert.equal(isEmptyGraph(none), true);
  });

  test('emphasis: focus, near, dim; search dims non-matches', () => {
    const adj = buildAdjacency(tiny.edges);
    assert.equal(emphasisFor('person:sam', adj, 'person:sam', null), 'focus');
    assert.equal(emphasisFor('me', adj, 'person:sam', null), 'near');
    assert.equal(emphasisFor('topic:pricing', adj, 'person:sam', null), 'dim');
    assert.equal(emphasisFor('topic:pricing', adj, null, null), 'normal');
    assert.equal(emphasisFor('topic:pricing', adj, null, new Set(['topic:pricing'])), 'focus');
    assert.equal(emphasisFor('me', adj, null, new Set(['topic:pricing'])), 'dim');
    assert.equal(edgeIsLit(tiny.edges[0], 'me'), true);
    assert.equal(edgeIsLit(tiny.edges[3], 'me'), false);
    assert.equal(edgeIsLit(tiny.edges[0], null), false);
  });

  test('groupByKind sorts by weight, then label', () => {
    const g = groupByKind([node('a', 'person', 'Zed', { weight: 1 }), node('b', 'person', 'Amy', { weight: 1 }), node('c', 'person', 'Bo', { weight: 5 })]);
    assert.deepEqual(g.person.map((n) => n.label), ['Bo', 'Amy', 'Zed']);
    assert.equal(g.topic.length, 0);
  });
});

describe('search', () => {
  const nodes = [node('1', 'topic', 'Pricing'), node('2', 'topic', 'Q1 roadmap'), node('3', 'person', 'Priya'), node('4', 'topic', 'Café prices', { weight: 3 })];
  test('ranks label prefix above word prefix above substring, and ignores accents and case', () => {
    assert.deepEqual(searchNodes(nodes, 'pri').map((n) => n.id), ['1', '3', '4']);
    assert.deepEqual(searchNodes(nodes, 'cafe').map((n) => n.id), ['4']);
    assert.deepEqual(searchNodes(nodes, 'ROAD').map((n) => n.id), ['2']);
    assert.deepEqual(searchNodes(nodes, 'oadm').map((n) => n.id), ['2']);
  });
  test('empty query finds nothing', () => {
    assert.deepEqual(searchNodes(nodes, '   '), []);
  });
});

describe('window and stats', () => {
  test('the sample has about forty nodes over ninety days and shrinks with the window', () => {
    const full = fullSampleGraph(NOW);
    assert.ok(full.nodes.length >= 36 && full.nodes.length <= 44, `got ${full.nodes.length}`);
    const d7 = sampleGraph(7, NOW);
    const d30 = sampleGraph(30, NOW);
    const d90 = sampleGraph(90, NOW);
    assert.ok(d7.stats.conversations < d30.stats.conversations);
    assert.ok(d30.stats.conversations < d90.stats.conversations);
    assert.equal(d90.stats.conversations, full.nodes.filter((n) => n.kind === 'conversation').length);
    for (const g of [d7, d30, d90]) {
      const ids = new Set(g.nodes.map((n) => n.id));
      assert.ok(g.edges.every((e) => ids.has(e.source) && ids.has(e.target)), 'no dangling edges');
      assert.ok(ids.has('me'));
    }
  });

  test('windowGraph keeps only recent conversations and what they touch', () => {
    const g: KnowledgeGraph = {
      nodes: [node('me', 'me'), node('conversation:new', 'conversation', 'new', { last_seen: NOW - DAY }), node('conversation:old', 'conversation', 'old', { last_seen: NOW - 40 * DAY }),
        node('topic:a', 'topic'), node('topic:b', 'topic')],
      edges: [edge('conversation:new', 'topic:a', 'about'), edge('conversation:old', 'topic:b', 'about')],
      stats: computeStats([]), generated_at: NOW, sample: true,
    };
    const out = windowGraph(g, 7, NOW);
    assert.deepEqual(out.nodes.map((n) => n.id), ['me', 'conversation:new', 'topic:a']);
    assert.equal(out.stats.conversations, 1);
  });

  test('computeStats counts kinds, open promises and the wearer’s minutes', () => {
    const s = computeStats([
      node('c1', 'conversation', 'c', { meta: { duration_s: 600, talk_ratio: 0.5 } }),
      node('c2', 'conversation', 'c', { meta: { duration_s: 120, talk_ratio: 1 } }),
      node('p', 'person'), node('t', 'topic'), node('k1', 'commitment', 'k', { meta: { open: true } }), node('k2', 'commitment', 'k', { meta: { open: false } }),
    ]);
    assert.deepEqual(s, { conversations: 2, people: 1, topics: 1, minutes_spoken: 7, open_commitments: 1 });
  });
});

describe('sample node detail', () => {
  test('person detail lists their conversations newest first, with quotes', () => {
    const g = fullSampleGraph(NOW);
    const d = sampleNodeDetail(g, 'person:p-sam');
    assert.ok(d);
    assert.equal(d.node.label, 'Sam');
    assert.ok(d.conversations.length >= 2);
    const times = d.conversations.map((c) => Date.parse(c.started_at));
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
    assert.ok(d.quotes.length > 0 && d.quotes.length <= 4);
    assert.ok(d.neighbours.some((n) => n.id === 'me'));
  });
  test('commitment detail quotes the promise itself', () => {
    const d = sampleNodeDetail(fullSampleGraph(NOW), 'commitment:c-deck');
    assert.ok(d);
    assert.deepEqual(d.quotes.map((q) => q.text), ['I’ll send you the deck tonight.']);
  });
  test('unknown id gives null', () => {
    assert.equal(sampleNodeDetail(fullSampleGraph(NOW), 'person:nobody'), null);
  });
});

describe('layout', () => {
  const g = sampleGraph(90, NOW);
  test('places every node at a finite point, with me pinned at the centre', () => {
    const pos = computeLayout(g.nodes, g.edges);
    assert.equal(Object.keys(pos).length, g.nodes.length);
    for (const p of Object.values(pos)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
    assert.deepEqual(pos.me, { x: 0, y: 0 });
  });
  test('is deterministic', () => {
    assert.deepEqual(computeLayout(g.nodes, g.edges), computeLayout(g.nodes, g.edges));
  });
  test('people sit closer to the centre than topics on average', () => {
    const pos = computeLayout(g.nodes, g.edges);
    const mean = (kind: GraphNode['kind']) => {
      const ds = g.nodes.filter((n) => n.kind === kind).map((n) => Math.hypot(pos[n.id].x, pos[n.id].y));
      return ds.reduce((a, b) => a + b, 0) / ds.length;
    };
    assert.ok(mean('person') < mean('topic'));
  });
  test('a seeded layout keeps nodes near where they were', () => {
    const first = computeLayout(g.nodes, g.edges);
    const filtered = filterGraph(g, new Set<FilterKind>(['person', 'topic']));
    const second = computeLayout(filtered.nodes, filtered.edges, { seed: first });
    const drift = filtered.nodes.map((n) => Math.hypot(second[n.id].x - first[n.id].x, second[n.id].y - first[n.id].y));
    assert.ok(Math.max(...drift) < 260, `max drift ${Math.max(...drift)}`);
  });
  test('node radius grows with weight and stays inside its kind range', () => {
    assert.ok(nodeRadius({ kind: 'person', weight: 4 }, 4) > nodeRadius({ kind: 'person', weight: 1 }, 4));
    assert.equal(nodeRadius({ kind: 'person', weight: 9 }, 4), nodeRadius({ kind: 'person', weight: 4 }, 4));
    assert.equal(nodeRadius({ kind: 'topic', weight: 3 }, 0), nodeRadius({ kind: 'topic', weight: 0 }, 0));
  });
  test('hash is stable', () => {
    assert.equal(hash('person:p-sam'), hash('person:p-sam'));
    assert.notEqual(hash('a'), hash('b'));
  });
});

describe('view maths', () => {
  test('fitView puts the content centre at the box centre and fits it', () => {
    const pos = { a: { x: -100, y: -50 }, b: { x: 100, y: 50 } };
    const v = fitView(pos, { a: 0, b: 0 }, 400, 300, 0, 10);
    const centre = toScreen(v, { x: 0, y: 7 }); // label room shifts the centre by 7
    assert.ok(Math.abs(centre.x - 200) < 1e-6 && Math.abs(centre.y - 150) < 1e-6);
    const right = toScreen(v, pos.b);
    assert.ok(right.x <= 400 + 1e-6);
  });
  test('fitView handles an empty graph and zero size', () => {
    assert.deepEqual(fitView({}, {}, 400, 300), { k: 1, x: 200, y: 150 });
    assert.equal(fitView({ a: { x: 0, y: 0 } }, {}, 0, 0).k, 1);
  });
  test('zoomAround keeps the pointer fixed and clamps', () => {
    const v = { k: 1, x: 10, y: 20 };
    const before = toWorld(v, 150, 90);
    const z = zoomAround(v, 150, 90, 2);
    const after = toWorld(z, 150, 90);
    assert.ok(Math.abs(before.x - after.x) < 1e-9 && Math.abs(before.y - after.y) < 1e-9);
    assert.equal(zoomAround(v, 0, 0, 1000).k, MAX_ZOOM);
    assert.equal(zoomAround(v, 0, 0, 0.0001).k, MIN_ZOOM);
    assert.equal(clampZoom(1.2), 1.2);
  });
  test('toWorld inverts toScreen', () => {
    const v = { k: 1.7, x: -30, y: 44 };
    const p = toWorld(v, toScreen(v, { x: 12, y: -8 }).x, toScreen(v, { x: 12, y: -8 }).y);
    assert.ok(Math.abs(p.x - 12) < 1e-9 && Math.abs(p.y + 8) < 1e-9);
  });
});

describe('labels', () => {
  const view = { k: 1, x: 0, y: 0 };
  const c = (id: string, x: number, y: number, priority: number): LabelCandidate => ({ id, x, y, r: 5, text: 'A long label here', priority });
  test('the higher priority label gets the preferred side; the other moves', () => {
    const cands = [c('low', 0, 0, 1), c('high', 10, 2, 5)];
    const kept = placeLabels(cands, view, cands);
    assert.equal(kept.get('high'), 'below');
    assert.notEqual(kept.get('low'), 'below');
  });
  test('keeps both below when far apart', () => {
    const cands = [c('a', 0, 0, 1), c('b', 400, 0, 1)];
    const kept = placeLabels(cands, view, cands);
    assert.deepEqual([...kept.values()], ['below', 'below']);
  });
  test('a label moves off a node it would cover, and is dropped when boxed in', () => {
    const cands = [c('a', 0, 0, 1)];
    const below = [{ id: 'a', x: 0, y: 0, r: 5 }, { id: 'blocker', x: 0, y: 14, r: 6 }];
    assert.equal(placeLabels(cands, view, below).get('a'), 'above');
    const boxed = [...below, { id: 'n', x: 0, y: -14, r: 6 }, { id: 'e', x: 40, y: 0, r: 6 }, { id: 'w', x: -40, y: 0, r: 6 }];
    assert.equal(placeLabels(cands, view, boxed).size, 0);
  });
  test('labels stay inside the drawing area and off obstacles', () => {
    const edge = [c('edge', 4, 100, 1)];
    assert.equal(placeLabels(edge, view, edge, { w: 300, h: 200 }).get('edge'), 'right');
    const centre = [c('mid', 150, 100, 1)];
    const wall = { x: 0, y: 105, w: 300, h: 30 };
    assert.equal(placeLabels(centre, view, centre, { w: 300, h: 200, obstacles: [wall] }).get('mid'), 'above');
    assert.equal(placeLabels([c('out', 150, 400, 1)], view, [], { w: 300, h: 200 }).size, 0);
  });
  test('label sides sit where they say', () => {
    const cand = c('a', 0, 0, 1);
    assert.ok(labelBox(cand, view, 'above').y < 0);
    assert.ok(labelBox(cand, view, 'right').x > 0);
    assert.ok(labelBox(cand, view, 'left').x + labelBox(cand, view, 'left').w < 0);
  });
  test('label boxes scale their offset with zoom', () => {
    const b1 = labelBox(c('a', 0, 0, 1), { k: 1, x: 0, y: 0 });
    const b2 = labelBox(c('a', 0, 0, 1), { k: 2, x: 0, y: 0 });
    assert.ok(b2.y > b1.y);
  });
  test('truncate', () => {
    assert.equal(truncate('short'), 'short');
    assert.equal(truncate('abcdefghij', 5), 'abcd…');
  });
});

describe('url state', () => {
  test('defaults', () => {
    const s = parseGraphUrl('');
    assert.equal(s.days, 30);
    assert.equal(s.kinds.size, 5);
    assert.equal(s.node, null);
    assert.equal(s.view, 'graph');
  });
  test('round trip keeps other params and omits defaults', () => {
    const s = parseGraphUrl('?bus=mock&days=7&kinds=person,topic&node=person%3Ap-sam&view=list');
    assert.equal(s.days, 7);
    assert.deepEqual([...s.kinds].sort(), ['person', 'topic']);
    assert.equal(s.node, 'person:p-sam');
    const out = writeGraphUrl('?bus=mock&days=7', s);
    assert.deepEqual(parseGraphUrl(out), s);
    assert.ok(out.includes('bus=mock'));
    assert.equal(writeGraphUrl('?days=90', parseGraphUrl('')), '');
  });
  test('rejects bad values', () => {
    const s = parseGraphUrl('?days=12&kinds=robot,person&view=grid');
    assert.equal(s.days, 30);
    assert.deepEqual([...s.kinds], ['person']);
    assert.equal(s.view, 'graph');
    assert.equal(parseGraphUrl('?kinds=').kinds.size, 0);
  });
  test('toggleKind returns a new set', () => {
    const a = new Set<FilterKind>(['person']);
    const b = toggleKind(a, 'topic');
    assert.deepEqual([...a], ['person']);
    assert.deepEqual([...b].sort(), ['person', 'topic']);
    assert.deepEqual([...toggleKind(b, 'person')], ['topic']);
  });
});

describe('format', () => {
  test('duration', () => {
    assert.equal(duration(42), '42 s');
    assert.equal(duration(312), '5:12');
    assert.equal(duration(3900), '1 h 5 min');
  });
  test('relativeDay', () => {
    assert.equal(relativeDay(NOW - 100, NOW), 'today');
    assert.equal(relativeDay(NOW - DAY - 5, NOW), 'yesterday');
    assert.equal(relativeDay(NOW - 5 * DAY, NOW), '5 days ago');
    assert.equal(relativeDay(NOW - 21 * DAY, NOW), '3 weeks ago');
    assert.equal(relativeDay(null, NOW), 'never');
  });
  test('formatFact knows the contract keys and hides the ones shown elsewhere', () => {
    assert.deepEqual(formatFact('talk_ratio', 0.704), { key: 'talk_ratio', label: 'You talked', value: '70%' });
    assert.equal(formatFact('open', true)?.value, 'Open');
    assert.equal(formatFact('open', false)?.value, 'Kept');
    assert.equal(formatFact('wpm', 171.4)?.value, '171 wpm');
    assert.equal(formatFact('headline', 'x'), null);
    assert.equal(formatFact('anything', null), null);
    assert.equal(formatFact('first_met', 'May')?.label, 'First met');
  });
  test('nodeFacts, describeNode and weightLabel', () => {
    const conv = node('conversation:x', 'conversation', 'x', { last_seen: NOW - DAY, meta: { duration_s: 312, headline: 'h', talk_ratio: 0.5 } });
    assert.deepEqual(nodeFacts(conv).map((f) => f.key), ['duration_s', 'talk_ratio']);
    assert.equal(describeNode(conv, NOW), 'Conversation, last yesterday');
    assert.equal(describeNode(node('k', 'commitment', 'k', { meta: { open: true } }), NOW), 'Promise, open');
    assert.equal(weightLabel(conv), '5:12');
    assert.equal(weightLabel(node('p', 'person', 'p', { weight: 4 })), '4×');
  });
});
