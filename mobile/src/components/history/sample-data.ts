import { SessionSummary, WeeklyReport } from '../../bus/contracts';

export const SAMPLE_PEOPLE: Record<string, string> = {
  'p-alex': 'Alex Chen',
  'p-marcus': 'Marcus Vance',
  'p-elena': 'Elena Rostova',
  'p-sarah': 'Sarah Jenkins',
};

export const SAMPLE_WEEKLY_REPORT: WeeklyReport = {
  week_of: '2026-11-09',
  trend: [
    { metric: 'interruptions', from: 3.4, to: 0.8 },
    { metric: 'talk_ratio', from: 0.68, to: 0.52 },
    { metric: 'fillers_per_min', from: 5.2, to: 1.8 },
    { metric: 'wpm', from: 172, to: 148 },
    { metric: 'questions', from: 1.2, to: 3.8 },
  ],
  best_session_id: 's-best-1',
  biggest_improvement: 'Interruptions dropped from 3.4 to 0.8 per conversation (−76% vs baseline)',
};

export const SAMPLE_SESSIONS: SessionSummary[] = [
  {
    session_id: 's-today-1',
    started_at: '2026-11-14T15:20:00Z',
    duration_s: 840,
    coach_name: 'Consulting Prep',
    mode: 'regular',
    person_id: 'p-marcus',
    headline_fact: 'Held a steady 146 wpm and asked 4 diagnostic questions before proposing a framework.',
    numbers: {
      talk_ratio: 0.48,
      interruptions: 0,
      questions: 4,
      fillers_per_min: 1.2,
      wpm: 146,
    },
  },
  {
    session_id: 's-best-1',
    started_at: '2026-11-13T10:15:00Z',
    duration_s: 1320,
    coach_name: 'Active Listener',
    mode: 'regular',
    person_id: 'p-alex',
    headline_fact: 'Zero interruptions across 22 minutes; let Alex complete 6 consecutive explanations.',
    numbers: {
      talk_ratio: 0.38,
      interruptions: 0,
      questions: 7,
      fillers_per_min: 0.8,
      wpm: 142,
    },
  },
  {
    session_id: 's-nov12-1',
    started_at: '2026-11-12T16:45:00Z',
    duration_s: 600,
    coach_name: 'Pacing & Pause',
    mode: 'practice',
    person_id: null,
    headline_fact: 'Paused for 1.8 seconds after each prompt instead of filling with crutch words.',
    numbers: {
      talk_ratio: 0.72,
      interruptions: 1,
      questions: 2,
      fillers_per_min: 2.1,
      wpm: 154,
    },
  },
  {
    session_id: 's-nov11-1',
    started_at: '2026-11-11T11:00:00Z',
    duration_s: 1800,
    coach_name: 'Executive Presence',
    mode: 'regular',
    person_id: 'p-elena',
    headline_fact: 'Spoke 42% of the time, down from 64% in your previous session together.',
    numbers: {
      talk_ratio: 0.42,
      interruptions: 1,
      questions: 5,
      fillers_per_min: 1.6,
      wpm: 149,
    },
  },
  {
    session_id: 's-nov10-1',
    started_at: '2026-11-10T14:30:00Z',
    duration_s: 960,
    coach_name: 'Consulting Prep',
    mode: 'practice',
    person_id: null,
    headline_fact: 'Market sizing drill: 3 clear buckets with zero trailing filler pauses.',
    numbers: {
      talk_ratio: 0.81,
      interruptions: 0,
      questions: 3,
      fillers_per_min: 2.4,
      wpm: 158,
    },
  },
];
