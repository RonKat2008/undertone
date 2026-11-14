/**
 * The built-in sample graph (40 nodes over 90 days), shown in mock mode, when the backend
 * is unreachable, or when it answers `sample: true`. Always labelled "sample" on screen.
 * Times are relative to `now` so the 7 / 30 / 90 day windows always have something in them.
 */
import type { SessionSummary } from '@/lib/bus/contracts';
import { buildAdjacency, computeStats, neighbourIds, windowGraph } from './model.ts';
import type { GraphEdge, GraphEdgeKind, GraphNode, GraphNodeDetail, GraphQuote, KnowledgeGraph } from './types';

const DAY = 86400;

interface ConvoSeed {
  id: string;
  daysAgo: number;
  duration_s: number;
  talk_ratio: number;
  wpm: number;
  coach_id: string;
  headline: string;
  people: string[];
  topics: string[];
  habits: string[];
  promises: string[];
  quotes: { ts: number; speaker: 'me' | 'other'; text: string }[];
}

const PEOPLE: { id: string; label: string; relation: string }[] = [
  { id: 'p-sam', label: 'Sam', relation: 'Co-founder' },
  { id: 'p-alex', label: 'Alex', relation: 'Manager' },
  { id: 'p-priya', label: 'Priya', relation: 'Interviewer' },
  { id: 'p-jordan', label: 'Jordan', relation: 'Designer' },
  { id: 'p-mei', label: 'Mei', relation: 'Investor' },
  { id: 'p-dana', label: 'Dana', relation: 'Friend' },
  { id: 'p-theo', label: 'Theo', relation: 'New hire' },
];

const TOPICS: { id: string; label: string }[] = [
  { id: 't-roadmap', label: 'Q1 roadmap' },
  { id: 't-hiring', label: 'Hiring' },
  { id: 't-trip', label: 'Sam’s trip to Lisbon' },
  { id: 't-pricing', label: 'Pricing' },
  { id: 't-fundraise', label: 'Seed round' },
  { id: 't-design', label: 'Onboarding redesign' },
  { id: 't-offsite', label: 'Team offsite' },
  { id: 't-case', label: 'Case interview prep' },
];

const HABITS: { id: string; label: string; rule_id: string; rate: number; trend: string }[] = [
  { id: 'h-long', label: 'Answers past 45 s', rule_id: 'long_turn', rate: 0.44, trend: 'better' },
  { id: 'h-interrupt', label: 'Starting before they finish', rule_id: 'interrupt', rate: 0.31, trend: 'same' },
  { id: 'h-pace', label: 'Speeding up mid-answer', rule_id: 'pace', rate: 0.27, trend: 'worse' },
  { id: 'h-basically', label: '“Basically”', rule_id: 'crutch', rate: 0.22, trend: 'better' },
];

const PROMISES: { id: string; label: string; to: string; open: boolean; quote: string }[] = [
  { id: 'c-deck', label: 'Send Sam the deck', to: 'p-sam', open: true, quote: 'I’ll send you the deck tonight.' },
  { id: 'c-intro', label: 'Intro Mei to Jordan', to: 'p-mei', open: true, quote: 'Let me introduce you to Jordan this week.' },
  { id: 'c-review', label: 'Review Theo’s first PR', to: 'p-theo', open: false, quote: 'I’ll look at your PR before lunch.' },
  { id: 'c-numbers', label: 'Share churn numbers with Alex', to: 'p-alex', open: true, quote: 'I can get you the churn numbers by Friday.' },
  { id: 'c-call', label: 'Call Dana back', to: 'p-dana', open: false, quote: 'I’ll call you on Sunday, promise.' },
  { id: 'c-followup', label: 'Thank-you note to Priya', to: 'p-priya', open: true, quote: 'I’ll follow up with a short note.' },
];

const CONVERSATIONS: ConvoSeed[] = [
  { id: 's-20261113-1602', daysAgo: 0.3, duration_s: 312, talk_ratio: 0.7, wpm: 171, coach_id: 'interview', headline: 'You talked 70% of the time and asked Sam 0 questions about his trip.',
    people: ['p-sam'], topics: ['t-trip', 't-fundraise'], habits: ['h-long'], promises: ['c-deck'],
    quotes: [{ ts: 41, speaker: 'other', text: 'Lisbon was wild, honestly. I have a lot to tell you.' }, { ts: 52, speaker: 'me', text: 'Nice. So, basically, about the deck for Mei…' }, { ts: 288, speaker: 'me', text: 'I’ll send you the deck tonight.' }] },
  { id: 's-20261112-1130', daysAgo: 1.2, duration_s: 498, talk_ratio: 0.48, wpm: 164, coach_id: 'listener', headline: 'You started before Alex finished 3 times in 8 minutes.',
    people: ['p-alex'], topics: ['t-roadmap', 't-pricing'], habits: ['h-interrupt'], promises: ['c-numbers'],
    quotes: [{ ts: 120, speaker: 'other', text: 'The thing I keep coming back to is, uh, whether the annual plan…' }, { ts: 123, speaker: 'me', text: 'Right, the annual plan is the lever.' }, { ts: 470, speaker: 'me', text: 'I can get you the churn numbers by Friday.' }] },
  { id: 's-20261111-0915', daysAgo: 2.4, duration_s: 95, talk_ratio: 1, wpm: 158, coach_id: 'personal', headline: 'Practice: “basically” went from 6 to 3 across three rounds.',
    people: [], topics: ['t-case'], habits: ['h-basically'], promises: [],
    quotes: [{ ts: 30, speaker: 'me', text: 'The market is, — pause — about four billion dollars.' }] },
  { id: 's-20261110-1700', daysAgo: 3.5, duration_s: 1260, talk_ratio: 0.38, wpm: 152, coach_id: 'listener', headline: 'You asked Jordan 9 questions and talked 38% of the time.',
    people: ['p-jordan', 'p-theo'], topics: ['t-design', 't-hiring'], habits: [], promises: ['c-review'],
    quotes: [{ ts: 300, speaker: 'me', text: 'What made you pick the two-step flow?' }, { ts: 312, speaker: 'other', text: 'People bailed at the permissions screen.' }, { ts: 1190, speaker: 'me', text: 'I’ll look at your PR before lunch.' }] },
  { id: 's-20261109-1410', daysAgo: 5.2, duration_s: 644, talk_ratio: 0.61, wpm: 179, coach_id: 'interview', headline: 'Your longest answer ran 71 seconds; the goal was under 45.',
    people: ['p-priya'], topics: ['t-case', 't-pricing'], habits: ['h-long', 'h-pace'], promises: ['c-followup'],
    quotes: [{ ts: 210, speaker: 'other', text: 'Walk me through how you would size it.' }, { ts: 214, speaker: 'me', text: 'Sure. So there are three parts: customers, frequency, price.' }, { ts: 630, speaker: 'me', text: 'I’ll follow up with a short note.' }] },
  { id: 's-20261106-1900', daysAgo: 8.1, duration_s: 1820, talk_ratio: 0.52, wpm: 160, coach_id: 'personal', headline: 'An even conversation: 52% you, 6 questions each way.',
    people: ['p-dana'], topics: ['t-offsite'], habits: [], promises: ['c-call'],
    quotes: [{ ts: 900, speaker: 'other', text: 'You seem calmer than last month.' }, { ts: 1790, speaker: 'me', text: 'I’ll call you on Sunday, promise.' }] },
  { id: 's-20261102-1000', daysAgo: 12.3, duration_s: 2100, talk_ratio: 0.66, wpm: 174, coach_id: 'interview', headline: 'Mei asked about burn twice; you answered the second time in one sentence.',
    people: ['p-mei', 'p-sam'], topics: ['t-fundraise', 't-pricing', 't-hiring'], habits: ['h-pace', 'h-long'], promises: ['c-intro'],
    quotes: [{ ts: 640, speaker: 'other', text: 'What is your monthly burn today?' }, { ts: 1410, speaker: 'me', text: 'Forty-two thousand a month, eighteen months of runway.' }, { ts: 2050, speaker: 'me', text: 'Let me introduce you to Jordan this week.' }] },
  { id: 's-20261028-1530', daysAgo: 17.4, duration_s: 760, talk_ratio: 0.57, wpm: 166, coach_id: 'listener', headline: 'You cut Alex off twice in the first five minutes, then not again.',
    people: ['p-alex'], topics: ['t-roadmap'], habits: ['h-interrupt'], promises: [],
    quotes: [{ ts: 260, speaker: 'me', text: 'Sorry, go on. Finish the thought.' }] },
  { id: 's-20261021-1100', daysAgo: 24.2, duration_s: 1440, talk_ratio: 0.44, wpm: 158, coach_id: 'listener', headline: 'Team offsite planning: three people, you held 44% of the floor.',
    people: ['p-jordan', 'p-sam', 'p-theo'], topics: ['t-offsite', 't-hiring'], habits: ['h-basically'], promises: [],
    quotes: [{ ts: 400, speaker: 'other', text: 'Can we keep it to two days this time?' }, { ts: 405, speaker: 'me', text: 'Basically yes, two days, one of them offline.' }] },
  { id: 's-20261005-1400', daysAgo: 40.2, duration_s: 900, talk_ratio: 0.72, wpm: 181, coach_id: 'interview', headline: 'Mock interview: 72% talk share and 5 hedges in the opening answer.',
    people: ['p-priya'], topics: ['t-case'], habits: ['h-pace', 'h-long', 'h-basically'], promises: [],
    quotes: [{ ts: 60, speaker: 'me', text: 'I think, maybe, the answer is probably price.' }] },
  { id: 's-20260920-0930', daysAgo: 55.3, duration_s: 1680, talk_ratio: 0.63, wpm: 169, coach_id: 'listener', headline: 'Roadmap review with Alex and Sam ran 28 minutes; 63% you.',
    people: ['p-alex', 'p-sam'], topics: ['t-roadmap', 't-design'], habits: ['h-interrupt', 'h-long'], promises: [],
    quotes: [{ ts: 1200, speaker: 'other', text: 'Let’s park redesign until January.' }] },
  { id: 's-20260826-1800', daysAgo: 80.1, duration_s: 600, talk_ratio: 0.5, wpm: 161, coach_id: 'personal', headline: 'First coached conversation: a 10 minute catch-up with Dana.',
    people: ['p-dana'], topics: ['t-trip'], habits: [], promises: [],
    quotes: [{ ts: 200, speaker: 'other', text: 'Is that thing on your wrist listening?' }, { ts: 204, speaker: 'me', text: 'Only to me. It tells me when I rush.' }] },
];

const edge = (source: string, target: string, kind: GraphEdgeKind, weight = 1): GraphEdge => ({ source, target, kind, weight });

/** The full 90-day sample graph. */
export function fullSampleGraph(now: number): KnowledgeGraph {
  const seenAt = (c: ConvoSeed) => Math.round(now - c.daysAgo * DAY);
  const lastFor = (pred: (c: ConvoSeed) => boolean) => {
    const hits = CONVERSATIONS.filter(pred);
    return hits.length ? Math.max(...hits.map(seenAt)) : null;
  };
  const count = (pred: (c: ConvoSeed) => boolean) => CONVERSATIONS.filter(pred).length;

  const nodes: GraphNode[] = [{ id: 'me', kind: 'me', label: 'You', weight: CONVERSATIONS.length, last_seen: Math.max(...CONVERSATIONS.map(seenAt)), meta: { sessions: CONVERSATIONS.length } }];
  for (const p of PEOPLE) {
    const n = count((c) => c.people.includes(p.id));
    nodes.push({ id: `person:${p.id}`, kind: 'person', label: p.label, weight: n, last_seen: lastFor((c) => c.people.includes(p.id)), meta: { relation: p.relation, sessions: n } });
  }
  for (const t of TOPICS) {
    const n = count((c) => c.topics.includes(t.id));
    nodes.push({ id: `topic:${t.id}`, kind: 'topic', label: t.label, weight: n, last_seen: lastFor((c) => c.topics.includes(t.id)), meta: { sessions: n } });
  }
  for (const h of HABITS) {
    const n = count((c) => c.habits.includes(h.id));
    nodes.push({ id: `habit:${h.id}`, kind: 'habit', label: h.label, weight: n, last_seen: lastFor((c) => c.habits.includes(h.id)), meta: { rule_id: h.rule_id, rate: h.rate, trend: h.trend } });
  }
  for (const p of PROMISES) {
    nodes.push({ id: `commitment:${p.id}`, kind: 'commitment', label: p.label, weight: 1, last_seen: lastFor((c) => c.promises.includes(p.id)), meta: { open: p.open, quote: p.quote } });
  }
  for (const c of CONVERSATIONS) {
    nodes.push({ id: `conversation:${c.id}`, kind: 'conversation', label: conversationLabel(c, now), weight: Math.round(c.duration_s / 60), last_seen: seenAt(c),
      meta: { duration_s: c.duration_s, talk_ratio: c.talk_ratio, wpm: c.wpm, coach_id: c.coach_id, headline: c.headline } });
  }

  const edges: GraphEdge[] = [];
  for (const p of PEOPLE) {
    const n = count((c) => c.people.includes(p.id));
    if (n) edges.push(edge('me', `person:${p.id}`, 'talked_with', n));
  }
  for (const h of HABITS) edges.push(edge('me', `habit:${h.id}`, 'showed', h.rate));
  for (const p of PROMISES) {
    edges.push(edge('me', `commitment:${p.id}`, 'promised'));
    edges.push(edge(`commitment:${p.id}`, `person:${p.to}`, 'about'));
  }
  for (const c of CONVERSATIONS) {
    const cid = `conversation:${c.id}`;
    if (c.people.length === 0) edges.push(edge(cid, 'me', 'part_of'));
    for (const p of c.people) edges.push(edge(`person:${p}`, cid, 'part_of'));
    for (const t of c.topics) edges.push(edge(cid, `topic:${t}`, 'about'));
    for (const h of c.habits) edges.push(edge(cid, `habit:${h}`, 'showed'));
    for (const p of c.promises) edges.push(edge(cid, `commitment:${p}`, 'promised'));
  }
  return { nodes, edges, stats: computeStats(nodes), generated_at: Math.round(now), sample: true };
}

function conversationLabel(c: ConvoSeed, now: number): string {
  const who = c.people.map((id) => PEOPLE.find((p) => p.id === id)?.label ?? id);
  const date = new Date((now - c.daysAgo * DAY) * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return who.length ? `${who.join(', ')} · ${date}` : `Practice · ${date}`;
}

export function sampleGraph(days: number, now: number = Date.now() / 1000): KnowledgeGraph {
  return windowGraph(fullSampleGraph(now), days, now);
}

function toSummary(node: GraphNode, people: GraphNode[]): SessionSummary {
  const sessionId = node.id.replace(/^conversation:/, '');
  const m = node.meta;
  const person = people[0]?.id.replace(/^person:/, '') ?? null;
  return {
    session_id: sessionId,
    started_at: new Date((node.last_seen ?? 0) * 1000).toISOString(),
    duration_s: Number(m.duration_s ?? 0),
    coach_name: String(m.coach_id ?? 'coach'),
    mode: m.coach_id === 'personal' && person === null ? 'practice' : 'regular',
    person_id: person,
    headline_fact: String(m.headline ?? ''),
    numbers: { talk_ratio: Number(m.talk_ratio ?? 0), interruptions: 0, questions: 0, fillers_per_min: 0, wpm: Number(m.wpm ?? 0) },
  };
}

/** What GET /graph/node/{id} would answer, computed from the sample graph. */
export function sampleNodeDetail(graph: KnowledgeGraph, id: string): GraphNodeDetail | null {
  const node = graph.nodes.find((n) => n.id === id);
  if (!node) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const adj = buildAdjacency(graph.edges);
  const neighbours = [...neighbourIds(adj, id)].map((n) => byId.get(n)).filter((n): n is GraphNode => n !== undefined);
  const convNodes = node.kind === 'conversation' ? [node]
    : node.kind === 'me' ? graph.nodes.filter((n) => n.kind === 'conversation')
      : neighbours.filter((n) => n.kind === 'conversation');
  const sorted = [...convNodes].sort((a, b) => (b.last_seen ?? 0) - (a.last_seen ?? 0));
  const conversations = sorted.map((c) => toSummary(c, [...neighbourIds(adj, c.id)].map((n) => byId.get(n)).filter((n): n is GraphNode => n?.kind === 'person')));
  const quotes: GraphQuote[] = [];
  for (const c of sorted) {
    const seed = CONVERSATIONS.find((s) => `conversation:${s.id}` === c.id);
    if (!seed) continue;
    for (const q of seed.quotes) {
      if (node.kind === 'commitment' && q.text !== node.meta.quote) continue;
      quotes.push({ session_id: seed.id, ts: q.ts, speaker: q.speaker, text: q.text });
    }
  }
  return { node, neighbours, conversations: conversations.slice(0, 8), quotes: quotes.slice(0, 4) };
}
