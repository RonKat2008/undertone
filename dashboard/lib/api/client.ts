/* eslint-disable @typescript-eslint/no-unused-vars */
import { CoachSpec, Debrief, HabitProfile, SessionSummary, DailyMission, Streak, Person, WeeklyReport } from '../bus/contracts';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function listCoaches(): Promise<CoachSpec[]> {
  await delay(300);
  return [];
}

export async function buildCoach(goal: string): Promise<CoachSpec> {
  await delay(2500);
  return {
    id: 'c_generated',
    name: 'Generated Coach',
    goal,
    kind: 'custom',
    confidence_threshold: 0.8,
    keyterms: [],
    filler_words: ['like', 'um'],
    questions: {},
    nudge_rules: [],
    motion_rules: [],
    nudge_policy: { focus_rule_id: 'r1', budget_per_session: 5, min_gap_s: 60, tolerance: 0.3, silent: false },
    debrief_rubric: 'Custom rubric based on goal.',
    drill: { partner_persona: 'Colleague', prompts: ["Let's discuss..."] }
  };
}

export async function buildPersonalCoach(): Promise<CoachSpec> {
  await delay(1500);
  return await buildCoach('Personal habit improvement');
}

export async function saveCoach(_coach: CoachSpec): Promise<void> {
  await delay(500);
}

export async function activateCoach(_coachId: string): Promise<void> {
  await delay(300);
}

export async function startSession(_coachId: string, _mode: string): Promise<{ session_id: string }> {
  await delay(400);
  return { session_id: 's_new' };
}

export async function stopSession(_sessionId: string): Promise<void> {
  await delay(400);
}

export async function addBookmark(_sessionId: string, _source: string): Promise<void> {
  await delay(200);
}

export async function swapSpeakers(_sessionId: string): Promise<void> {
  await delay(300);
}

export async function createPairing(): Promise<{ code: string }> {
  await delay(500);
  return { code: '1234' };
}

export async function listDevices(): Promise<{ device_id: string; name: string; connected: boolean }[]> {
  await delay(300);
  return [{ device_id: 'd1', name: 'Undertone Band', connected: true }];
}

export async function listApps(): Promise<{ app_id: string; name: string; approved: boolean; last_used: string }[]> {
  await delay(300);
  return [{ app_id: 'a1', name: 'Timer App', approved: true, last_used: '2026-11-14T09:00:00Z' }];
}

export async function approveApp(_appId: string): Promise<void> {
  await delay(300);
}

export async function revokeApp(_appId: string): Promise<void> {
  await delay(300);
}

export async function getDebrief(_sessionId: string): Promise<{ data: Debrief; audio_url: string | null }> {
  await delay(800);
  return {
    data: {
      headline_fact: "You interrupted 3 times.",
      strength: "Good pacing.",
      one_fix: "Pause before answering.",
      if_then: "When they finish speaking, count to 2.",
      numbers: { talk_ratio: 0.65, interruptions: 3, questions: 2, fillers_per_min: 4.5, wpm: 145 },
      best_moment_quote: "Great point.",
      vs_last_time: "Pace is down 10 wpm.",
      notes: [],
      bookmarks: [],
      timeline: [],
      better_version: null
    },
    audio_url: null
  };
}

export async function listSessions(): Promise<SessionSummary[]> {
  await delay(500);
  return [{
    session_id: 's_1',
    started_at: '2026-11-14T10:00:00Z',
    duration_s: 300,
    coach_name: 'Case Interview Coach',
    mode: 'regular',
    person_id: 'p_1',
    headline_fact: 'Good questions asked.',
    numbers: { talk_ratio: 0.5, interruptions: 1, questions: 3, fillers_per_min: 2, wpm: 140 }
  }];
}

export async function getProfile(): Promise<HabitProfile> {
  await delay(400);
  return {
    sessions: 10,
    baseline_wpm: 150,
    baseline_volume_db: -15,
    crutch_words: [{ word: 'like', per_min: 2 }],
    recurring_issues: []
  };
}

export async function getMissionToday(): Promise<DailyMission> {
  await delay(300);
  return {
    date: new Date().toISOString().split('T')[0],
    focus_rule_id: 'r_quest',
    text: "Ask 3 open questions before your second story",
    if_then: "When you finish a story, ask one open question",
    target: 3,
    progress: 1,
    done: false,
    suggestions: []
  };
}

export async function chooseMission(_missionId: string): Promise<void> {
  await delay(300);
}

export async function getStreak(): Promise<Streak> {
  await delay(300);
  return {
    days: 5,
    freeze_available: true,
    week: [true, true, false, true, true, true, true]
  };
}

export async function listPeople(): Promise<Person[]> {
  await delay(400);
  return [{
    person_id: 'p_1',
    name: 'Alex',
    sessions: 4,
    pattern: 'You interrupt Alex 3x more than anyone',
    brief: 'Last time you talked 70%. Ask about his trip.'
  }];
}

export async function tagPerson(_sessionId: string, _personId: string): Promise<void> {
  await delay(300);
}

export async function getWeeklyReport(): Promise<WeeklyReport> {
  await delay(500);
  return {
    week_of: '2026-11-09',
    trend: [{ metric: 'wpm', from: 160, to: 150 }],
    best_session_id: 's1',
    biggest_improvement: 'Reduced filler words'
  };
}
