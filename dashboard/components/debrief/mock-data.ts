import { Debrief, TimelinePoint, BookmarkReview } from '@/lib/bus/contracts';

export interface EnrichedDebriefData extends Debrief {
  sessionMeta: {
    coachName: string;
    sessionId: string;
    date: string;
    duration: string;
    partner: string;
  };
  timelineEvents: Array<{
    t: number;
    type: 'nudge' | 'bookmark' | 'signal';
    label: string;
    pattern?: string;
    detail?: string;
  }>;
  transcriptTurns: Array<{
    turn_id: string;
    speaker: 'me' | 'other';
    text: string;
    start: number;
    end: number;
    wpm: number;
    fillers: string[];
  }>;
}

export const defaultTimelinePoints: TimelinePoint[] = [
  { t: 0, wpm: 120, volume_db: -22, hand_energy: 0.15 },
  { t: 5, wpm: 152, volume_db: -16, hand_energy: 0.35 },
  { t: 10, wpm: 150, volume_db: -15, hand_energy: 0.48 },
  { t: 15, wpm: 162, volume_db: -13, hand_energy: 0.62 },
  { t: 20, wpm: 148, volume_db: -14, hand_energy: 0.55 },
  { t: 25, wpm: 130, volume_db: -17, hand_energy: 0.42 },
  { t: 30, wpm: 164, volume_db: -12, hand_energy: 0.78 },
  { t: 35, wpm: 158, volume_db: -14, hand_energy: 0.85 },
  { t: 40, wpm: 142, volume_db: -16, hand_energy: 0.60 },
  { t: 45, wpm: 140, volume_db: -18, hand_energy: 0.38 },
  { t: 50, wpm: 138, volume_db: -19, hand_energy: 0.32 },
  { t: 55, wpm: 175, volume_db: -11, hand_energy: 0.18 },
  { t: 60, wpm: 145, volume_db: -18, hand_energy: 0.22 },
  { t: 65, wpm: 110, volume_db: -24, hand_energy: 0.12 },
  { t: 70, wpm: 135, volume_db: -18, hand_energy: 0.40 },
  { t: 75, wpm: 132, volume_db: -17, hand_energy: 0.52 },
  { t: 80, wpm: 128, volume_db: -18, hand_energy: 0.48 },
  { t: 85, wpm: 136, volume_db: -16, hand_energy: 0.45 },
  { t: 90, wpm: 130, volume_db: -19, hand_energy: 0.35 },
];

export const defaultBookmarks: BookmarkReview[] = [
  {
    ts: 45,
    source: 'promise',
    snippet: "I'll send you the deck after this meeting.",
    what_happened: "You stated a clear deliverable promise during the conversation.",
    follow_up: "Send Sam the deck",
  },
  {
    ts: 72,
    source: 'phone',
    snippet: "What are your thoughts on that pricing model?",
    what_happened: "Marked from band tap to review Sam's reaction to the value-based tier.",
    follow_up: "Review notes on elasticity",
  },
];

export const defaultDebrief: EnrichedDebriefData = {
  headline_fact: "You interrupted 3 times in the first 5 minutes.",
  strength: "Structured your approach clearly with upfront framing before calculations.",
  one_fix: "Pause before answering.",
  if_then: "When they finish speaking, count to 2 before starting.",
  numbers: {
    talk_ratio: 0.65,
    interruptions: 3,
    questions: 2,
    fillers_per_min: 4.5,
    wpm: 145,
  },
  best_moment_quote: "Let's break this down into fixed and variable costs before projecting unit volume.",
  vs_last_time: "Pace is down 10 wpm from last session (closer to 140 baseline).",
  notes: [
    "Market sizing methodology and addressable audience assumptions",
    "Profitability tree: separating fixed overhead from variable margin",
    "Customer willingness to pay in 18–35 urban demographic",
    "Agreed deliverable: send updated financial deck by end of day",
  ],
  bookmarks: defaultBookmarks,
  timeline: defaultTimelinePoints,
  better_version: {
    original: "Um, so like the costs are, you know, kind of high and we might lose margin.",
    rewritten: "Our primary vulnerability is elevated fixed overhead, which compresses net margins below 14%.",
    audio_url: null,
  },
  sessionMeta: {
    coachName: "Case Interview Coach",
    sessionId: "s_1049",
    date: "14 Nov 2026",
    duration: "12 min 30 s",
    partner: "Sam",
  },
  timelineEvents: [
    { t: 6, type: 'nudge', label: 'Let them finish', pattern: 'interrupt', detail: 'Interrupted speaker' },
    { t: 16, type: 'nudge', label: 'Ask a question', pattern: 'wrap_up', detail: 'Monologue > 45s' },
    { t: 26, type: 'nudge', label: 'Pause', pattern: 'filler', detail: 'Fillers spiking' },
    { t: 36, type: 'nudge', label: 'Hands calm', pattern: 'still', detail: 'Fidgeting while listening' },
    { t: 45, type: 'bookmark', label: "I'll send you the deck", pattern: 'promise', detail: 'Promise detected' },
    { t: 55, type: 'signal', label: 'Nerves', detail: 'Pace jumped, hands froze' },
    { t: 65, type: 'signal', label: 'Checked out', detail: 'Still hands, no questions' },
    { t: 72, type: 'bookmark', label: 'Pricing model question', pattern: 'phone', detail: 'Tapped on phone' },
    { t: 81, type: 'nudge', label: 'Great question', pattern: 'success', detail: 'Asked an open question' },
  ],
  transcriptTurns: [
    {
      turn_id: 't1',
      speaker: 'other',
      text: "So, let's look at the market size for this product in North America.",
      start: 2,
      end: 4,
      wpm: 120,
      fillers: [],
    },
    {
      turn_id: 't2',
      speaker: 'me',
      text: "I think the US market is about 300 million people, assuming roughly 100 million households.",
      start: 4.5,
      end: 5.5,
      wpm: 150,
      fillers: [],
    },
    {
      turn_id: 't3',
      speaker: 'me',
      text: "And if we segment by age, we see a large portion in the 18 to 35 demographic, which implies a higher willingness to pay for premium features, assuming the distribution holds across urban centers.",
      start: 6,
      end: 15,
      wpm: 160,
      fillers: [],
    },
    {
      turn_id: 't4',
      speaker: 'me',
      text: "So, um, like, the revenue would be, like, $500 million if we capture even three percent market share.",
      start: 20,
      end: 25,
      wpm: 130,
      fillers: ['um', 'like', 'like'],
    },
    {
      turn_id: 't5',
      speaker: 'me',
      text: "I'll send you the deck after this meeting with the full sensitivity table.",
      start: 40,
      end: 45,
      wpm: 140,
      fillers: [],
    },
    {
      turn_id: 't6',
      speaker: 'me',
      text: "What are your thoughts on that pricing model given the competitive dynamics in that tier?",
      start: 75,
      end: 80,
      wpm: 130,
      fillers: [],
    },
  ],
};
