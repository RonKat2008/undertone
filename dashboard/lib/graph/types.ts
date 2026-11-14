/**
 * Knowledge graph wire contract (GET /graph, GET /graph/node/{id}).
 * Fixed with the backend; times are unix seconds. Do not change shapes here alone.
 */
import type { SessionSummary } from '@/lib/bus/contracts';

export type GraphNodeKind = 'me' | 'person' | 'topic' | 'commitment' | 'habit' | 'conversation';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  weight: number;
  last_seen: number | null;
  meta: Record<string, string | number | boolean | null>;
}

export type GraphEdgeKind = 'talked_with' | 'about' | 'promised' | 'showed' | 'part_of';

export interface GraphEdge {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  weight: number;
}

export interface GraphStats {
  conversations: number;
  people: number;
  topics: number;
  minutes_spoken: number;
  open_commitments: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  generated_at: number;
  sample: boolean;
}

export interface GraphQuote {
  session_id: string;
  ts: number;
  speaker: 'me' | 'other';
  text: string;
}

export interface GraphNodeDetail {
  node: GraphNode;
  neighbours: GraphNode[];
  conversations: SessionSummary[];
  quotes: GraphQuote[];
}

/** The kinds a viewer can switch off. "me" is always shown: it is the centre. */
export type FilterKind = Exclude<GraphNodeKind, 'me'>;
