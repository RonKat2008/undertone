/**
 * Insights: the report wire shapes (GET /reports/*, mirrored from contracts/events.ts and
 * backend/contracts.py), their boundary checks, the page's URL state, and the plain-word helpers
 * the views use. Pure: no fetch, no React. Tested in reports-model.test.ts.
 */

// ---------- wire shapes (subset the page reads; extra fields are ignored) ----------
export type RelationshipKind =
  | 'friend' | 'partner' | 'family' | 'boss' | 'report' | 'coworker' | 'client' | 'teacher' | 'student'
  | 'service' | 'acquaintance' | 'stranger' | 'unknown';
export type RelationshipSource = 'decisions' | 'rules' | 'user';
export type ReportDirection = 'up' | 'down' | 'same' | 'insufficient_data';

export interface ReportWindow { days: number; start: number; end: number; previous_start: number }
export interface ReportDelta {
  metric: string;
  current: number | null;
  previous: number | null;
  change: number | null;
  direction: ReportDirection;
  better: boolean | null;
  sample: number;
  previous_sample: number;
}
export interface ReportBucket { start: string; days: number; count: number }
export interface ReportRank { node_id: string; label: string; conversations: number; minutes: number }
export interface ReportCount { node_id: string; label: string; count: number }
export interface ReportHighlight { kind: string; text: string; node_ids: string[] }
export interface GraphFocus { node_ids: string[]; edges: { source: string; target: string }[] }
export interface ReportTotals {
  conversations: number; minutes_spoken: number; minutes_together: number;
  interruptions: number; questions: number; nudges: number; quiet_marks: number;
}
export interface ReportPromiseCounts { made: number; open: number; done: number; overdue: number }
export interface ReportHabitCount {
  rule_id: string; node_id: string; label: string; total: number; buzzed: number; quiet: number;
  conversations: number; per_conversation: number | null; trend: ReportDelta;
}
export interface ReportConversation {
  session_id: string; node_id: string; started_at: number; minutes: number; minutes_spoken: number;
  headline: string; person_node_id: string | null; topic_ids: string[];
}
export interface ReportPromise {
  id: string; bookmark_id: number; text: string; quote: string | null;
  person_id: string | null; person_name: string | null; person_node_id: string | null;
  session_id: string; conversation_node_id: string; made_at: number; age_days: number; open: boolean;
  closed_by: 'manual' | 'auto' | null; closed_at: number | null; evidence: string | null;
  due_day: string | null; overdue: boolean;
}
export interface ReportQuote { session_id: string; ts: number; text: string }
export interface ReportRelationshipGroup { kind: RelationshipKind; people: number; conversations: number; minutes: number; node_ids: string[] }

export interface OverviewReport {
  window: ReportWindow; totals: ReportTotals; habits: ReportHabitCount[];
  promises: ReportPromiseCounts; top_people: ReportRank[]; top_topics: ReportRank[];
  by_relationship: ReportRelationshipGroup[]; highlights: ReportHighlight[];
  insufficient_data: boolean; graph_focus: GraphFocus;
}
export interface PersonReportSummary {
  person_id: string; node_id: string; name: string; conversations: number; minutes_together: number;
  minutes_spoken: number; last_talked: number | null; relationship: RelationshipKind | null;
  relationship_confidence: number | null; relationship_source: RelationshipSource | null;
  sentence: string | null; open_promises: number; top_topics: ReportRank[];
}
export interface ByPersonReport { window: ReportWindow; people: PersonReportSummary[]; untagged_conversations: number; graph_focus: GraphFocus }
export interface PersonReport {
  window: ReportWindow; person: PersonReportSummary; topics: ReportRank[]; promises: ReportPromise[];
  habits: ReportCount[]; timeline: ReportConversation[]; graph_focus: GraphFocus;
}
export interface TopicReportSummary {
  topic_id: string; node_id: string; label: string; conversations: number; minutes_together: number;
  last_discussed: number | null; trend: ReportDelta; people: ReportRank[]; sentence: string | null; promises: number;
}
export interface ByTopicReport { window: ReportWindow; topics: TopicReportSummary[]; graph_focus: GraphFocus }
export interface TopicReport {
  window: ReportWindow; topic: TopicReportSummary; series: ReportBucket[]; promises: ReportPromise[];
  quotes: ReportQuote[]; habits: ReportCount[]; timeline: ReportConversation[]; graph_focus: GraphFocus;
}
export interface HabitReport { habit: ReportHabitCount; series: ReportBucket[]; by_person: ReportCount[]; by_topic: ReportCount[]; if_then: string[] }
export interface HabitsReport { window: ReportWindow; habits: HabitReport[]; graph_focus: GraphFocus }
export interface PromisesReport { window: ReportWindow; counts: ReportPromiseCounts; open: ReportPromise[]; done: ReportPromise[]; graph_focus: GraphFocus }

// ---------- boundary checks: enough to render safely ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isGraphFocus(v: unknown): v is GraphFocus {
  return isObj(v) && isArr(v.node_ids) && v.node_ids.every(isStr) && isArr(v.edges)
    && v.edges.every((e) => isObj(e) && isStr(e.source) && isStr(e.target));
}
const isRank = (v: unknown) => isObj(v) && isStr(v.node_id) && isStr(v.label) && isNum(v.conversations);
const isCount = (v: unknown) => isObj(v) && isStr(v.node_id) && isStr(v.label) && isNum(v.count);
const isPromise = (v: unknown) => isObj(v) && isStr(v.id) && isStr(v.text) && typeof v.open === 'boolean' && isStr(v.session_id);
const isConversation = (v: unknown) => isObj(v) && isStr(v.session_id) && isStr(v.headline) && isNum(v.started_at);
const isPersonSummary = (v: unknown) => isObj(v) && isStr(v.person_id) && isStr(v.node_id) && isStr(v.name) && isNum(v.conversations);
const isTopicSummary = (v: unknown) => isObj(v) && isStr(v.topic_id) && isStr(v.node_id) && isStr(v.label) && isObj(v.trend);
const isHabitCount = (v: unknown) => isObj(v) && isStr(v.node_id) && isStr(v.label) && isNum(v.total) && isObj(v.trend);
const every = (v: unknown, item: (x: unknown) => boolean) => isArr(v) && v.every(item);
const base = (v: unknown): v is Record<string, unknown> => isObj(v) && isObj(v.window) && isGraphFocus(v.graph_focus);

export const isOverviewReport = (v: unknown): v is OverviewReport =>
  base(v) && isObj(v.totals) && isNum(v.totals.conversations) && isObj(v.promises) && every(v.top_people, isRank)
  && every(v.top_topics, isRank) && every(v.highlights, (h) => isObj(h) && isStr(h.text)) && every(v.habits, isHabitCount)
  && every(v.by_relationship, (g) => isObj(g) && isStr(g.kind) && every(g.node_ids, isStr));
export const isByPersonReport = (v: unknown): v is ByPersonReport => base(v) && every(v.people, isPersonSummary);
export const isPersonReport = (v: unknown): v is PersonReport =>
  base(v) && isPersonSummary(v.person) && every(v.topics, isRank) && every(v.promises, isPromise)
  && every(v.habits, isCount) && every(v.timeline, isConversation);
export const isByTopicReport = (v: unknown): v is ByTopicReport => base(v) && every(v.topics, isTopicSummary);
export const isTopicReport = (v: unknown): v is TopicReport =>
  base(v) && isTopicSummary(v.topic) && every(v.series, isObj) && every(v.promises, isPromise)
  && every(v.quotes, (q) => isObj(q) && isStr(q.text)) && every(v.timeline, isConversation);
export const isHabitsReport = (v: unknown): v is HabitsReport =>
  base(v) && every(v.habits, (h) => isObj(h) && isHabitCount(h.habit) && every(h.series, isObj) && every(h.by_person, isCount) && every(h.by_topic, isCount));
export const isPromisesReport = (v: unknown): v is PromisesReport =>
  base(v) && isObj(v.counts) && every(v.open, isPromise) && every(v.done, isPromise);

// ---------- URL state: ?view=people&days=7&node=person:alex ----------
export const INSIGHT_VIEWS = ['overview', 'people', 'topics', 'habits', 'promises'] as const;
export type InsightView = (typeof INSIGHT_VIEWS)[number];
export const RANGES = [7, 30, 90] as const;
export type RangeDays = (typeof RANGES)[number];
export const DEFAULT_RANGE: RangeDays = 30;

export interface InsightsUrlState {
  view: InsightView;
  days: RangeDays;
  /** The selected node id ("person:alex", "topic:pricing", "habit:fillers", "commitment:3"). */
  node: string | null;
}

const NODE_ID = /^(person|topic|habit|commitment|conversation):[\w.:-]{1,160}$/;

export function parseInsightsUrl(search: string | URLSearchParams): InsightsUrlState {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const rawView = q.get('view');
  const view = (INSIGHT_VIEWS as readonly string[]).includes(rawView ?? '') ? (rawView as InsightView) : 'overview';
  const d = Number(q.get('days'));
  const days = (RANGES as readonly number[]).includes(d) ? (d as RangeDays) : DEFAULT_RANGE;
  const rawNode = q.get('node');
  return { view, days, node: rawNode && NODE_ID.test(rawNode) ? rawNode : null };
}

/** A query string ("?..." or "") for `state`, keeping unrelated params such as ?bus=. Defaults are left out. */
export function writeInsightsUrl(current: string, state: InsightsUrlState): string {
  const q = new URLSearchParams(current);
  const set = (key: string, value: string | null) => (value === null ? q.delete(key) : q.set(key, value));
  set('view', state.view === 'overview' ? null : state.view);
  set('days', state.days === DEFAULT_RANGE ? null : String(state.days));
  set('node', state.node);
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** Which view owns a node: a person opens People, a topic Topics, and so on. Conversations have no view. */
export function viewForNode(nodeId: string): InsightView | null {
  const kind = nodeId.split(':', 1)[0];
  if (kind === 'person') return 'people';
  if (kind === 'topic') return 'topics';
  if (kind === 'habit') return 'habits';
  if (kind === 'commitment') return 'promises';
  return null;
}

/** "person:alex" -> "alex". The id after the kind prefix. */
export function nodeKey(nodeId: string): string {
  const i = nodeId.indexOf(':');
  return i >= 0 ? nodeId.slice(i + 1) : nodeId;
}

// ---------- focus on the map ----------
export interface FocusSet {
  nodes: ReadonlySet<string>;
  /** Undirected edge keys, "a|b" with a < b. */
  edges: ReadonlySet<string>;
}

export const edgeKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export function focusSet(focus: GraphFocus | null | undefined): FocusSet | null {
  if (!focus || focus.node_ids.length === 0) return null;
  return { nodes: new Set(focus.node_ids), edges: new Set(focus.edges.map((e) => edgeKey(e.source, e.target))) };
}

/**
 * A node and its one-hop neighbours, for a selection whose report has not arrived yet (or a node
 * that has no report). `adjacent` lists edges as [a, b] pairs.
 */
export function oneHopFocus(id: string, edges: readonly { source: string; target: string }[]): FocusSet {
  const nodes = new Set([id]);
  const keys = new Set<string>();
  for (const e of edges) {
    if (e.source !== id && e.target !== id) continue;
    nodes.add(e.source === id ? e.target : e.source);
    keys.add(edgeKey(e.source, e.target));
  }
  return { nodes, edges: keys };
}

/** A habit's neighbourhood: the habit, you, and the people and topics it showed up with. */
export function habitFocus(h: HabitReport): GraphFocus {
  const ids = [...h.by_person, ...h.by_topic].map((c) => c.node_id);
  return {
    node_ids: ['me', h.habit.node_id, ...ids],
    edges: [{ source: 'me', target: h.habit.node_id }, ...ids.map((id) => ({ source: h.habit.node_id, target: id }))],
  };
}

/** A promise's neighbourhood: you, the promise, the person and the conversation it was made in. */
export function promiseFocus(p: ReportPromise): GraphFocus {
  const ids = ['me', p.id, p.conversation_node_id, ...(p.person_node_id ? [p.person_node_id] : [])];
  const edges = [{ source: 'me', target: p.id }, { source: p.conversation_node_id, target: p.id }];
  if (p.person_node_id) edges.push({ source: p.id, target: p.person_node_id });
  return { node_ids: ids, edges };
}

// ---------- plain words ----------
const REL_WORD: Record<Exclude<RelationshipKind, 'unknown'>, { word: string; phrase: string }> = {
  friend: { word: 'Friend', phrase: 'a friend' },
  partner: { word: 'Partner', phrase: 'your partner' },
  family: { word: 'Family', phrase: 'family' },
  boss: { word: 'Boss', phrase: 'your boss' },
  report: { word: 'Reports to you', phrase: 'someone who reports to you' },
  coworker: { word: 'Coworker', phrase: 'a coworker' },
  client: { word: 'Client', phrase: 'a client' },
  teacher: { word: 'Teacher', phrase: 'a teacher' },
  student: { word: 'Student', phrase: 'a student' },
  service: { word: 'Service provider', phrase: 'a service provider' },
  acquaintance: { word: 'Acquaintance', phrase: 'an acquaintance' },
  stranger: { word: 'Stranger', phrase: 'a stranger' },
};

/** The kinds a person can pick, in menu order. */
export const RELATIONSHIP_CHOICES = Object.keys(REL_WORD) as Exclude<RelationshipKind, 'unknown'>[];

export function relationshipLabel(kind: Exclude<RelationshipKind, 'unknown'>): string {
  return REL_WORD[kind].word;
}

/** Below this, an inferred relationship is said with "Probably". */
const SURE = 0.6;

/**
 * The relationship in a word or two, or null when nothing is known (say nothing then).
 * A label the wearer set, or a confident guess, is said plainly; a weaker guess gets "Probably".
 */
export function relationshipWord(kind: RelationshipKind | null | undefined, confidence?: number | null, source?: RelationshipSource | null): string | null {
  if (!kind || kind === 'unknown') return null;
  const entry = REL_WORD[kind];
  if (!entry) return null;
  if (source === 'user' || confidence === null || confidence === undefined || confidence >= SURE) return entry.word;
  return `Probably ${entry.phrase}`;
}

/** For the overview, which only groups people by relationship: node id -> kind. */
export function relationshipByNode(groups: readonly ReportRelationshipGroup[]): Map<string, RelationshipKind> {
  const out = new Map<string, RelationshipKind>();
  for (const g of groups) for (const id of g.node_ids) out.set(id, g.kind);
  return out;
}

/** How a habit moved against the previous window, in words. Null when there is too little to say. */
export function habitDirection(trend: ReportDelta): { word: string; tone: 'good' | 'bad' | 'neutral' } | null {
  if (trend.direction === 'insufficient_data') return null;
  if (trend.direction === 'same') return { word: 'steady', tone: 'neutral' };
  if (trend.direction === 'down') return { word: 'easing', tone: trend.better === false ? 'bad' : 'good' };
  return { word: 'more often', tone: trend.better === true ? 'good' : 'bad' };
}

/** A topic's trend in words: "new this month", "coming up more", "coming up less". */
export function topicDirection(trend: ReportDelta, days: number): string | null {
  if (trend.direction === 'up' && (trend.previous ?? 0) === 0) return days === 7 ? 'new this week' : 'new lately';
  if (trend.direction === 'up') return 'coming up more';
  if (trend.direction === 'down') return 'coming up less';
  if (trend.direction === 'same') return 'as often as before';
  return null;
}

/** "a minute", "12 minutes", "1 hour 5 minutes" from minutes. */
export function minutesWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return 'under a minute';
  if (m === 1) return 'a minute';
  if (m < 60) return `${m} minutes`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  const hours = h === 1 ? '1 hour' : `${h} hours`;
  return rest === 0 ? hours : `${hours} ${rest} min`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const DAY_S = 86400;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "today", "yesterday", "Tuesday", "3 Nov" for a unix time, against `now` (both seconds, UTC days). */
export function dayWords(ts: number, now: number): string {
  const day = Math.floor(ts / DAY_S);
  const today = Math.floor(now / DAY_S);
  const d = new Date(day * DAY_S * 1000);
  if (day === today) return 'today';
  if (day === today - 1) return 'yesterday';
  if (day === today + 1) return 'tomorrow';
  if (Math.abs(day - today) < 7) return WEEKDAYS[d.getUTCDay()];
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** When a promise is due, in plain words. Null when it named no clear day. */
export function dueWords(p: Pick<ReportPromise, 'due_day' | 'overdue' | 'open'>, now: number): string | null {
  if (!p.due_day) return null;
  const ts = Date.parse(`${p.due_day}T12:00:00Z`) / 1000;
  if (!Number.isFinite(ts)) return null;
  const when = dayWords(ts, now);
  if (p.open && p.overdue) return `was due ${when}`;
  return `due ${when}`;
}

/**
 * Split a report sentence into text and numbers so the numbers can be set as InlineStats.
 * "You interrupt Alex 2.3x as often (3.7 against 1.6)" -> text, {2.3, "x"}, text, {3.7}, ...
 * Numbers inside words (e.g. "1:1") are left as text.
 */
export type SentencePart = { text: string } | { value: number; decimals: number; suffix: string };

export function splitNumbers(sentence: string): SentencePart[] {
  const out: SentencePart[] = [];
  const re = /(^|[\s(])(\d+(?:\.\d+)?)(%|x(?=\s|$|[,.)]))?(?=[\s,.)]|$)/g;
  let last = 0;
  for (let m = re.exec(sentence); m; m = re.exec(sentence)) {
    const start = m.index + m[1].length;
    if (start > last) out.push({ text: sentence.slice(last, start) });
    const num = m[2];
    const dot = num.indexOf('.');
    out.push({ value: Number(num), decimals: dot >= 0 ? num.length - dot - 1 : 0, suffix: m[3] ?? '' });
    last = start + num.length + (m[3]?.length ?? 0);
  }
  if (last < sentence.length) out.push({ text: sentence.slice(last) });
  return out;
}
