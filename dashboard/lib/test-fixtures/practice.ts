/**
 * TEST-ONLY fixture: made-up practice results for the practice unit tests.
 * No page or component may import this; the dashboard only ever shows real data.
 */
import type { PracticeGoal, PracticeResult, PracticeResultSummary } from '../practice/model';

export function goal(over: Partial<PracticeGoal> = {}): PracticeGoal {
  return {
    measure: 'fillers', title: 'Fewer filler words', target: 'Under 3 filler words a minute; you had 7',
    target_min: null, target_max: 3, unit: 'per minute', actual: 7, from_answer: 2, evidence: 'um, so, like, the plan', ...over,
  };
}

export function result(over: Partial<PracticeResult> = {}): PracticeResult {
  return {
    id: 'p1', coach_id: 'c1', coach_name: 'Maya', started_at: '2026-11-14T10:00:00Z', duration_s: 290, overall: 72,
    summary: 'Clear answers, a little rushed at the start.',
    sub_scores: [{ measure: 'pace', label: 'Pace', score: 80, source: 'measured', detail: '148 words a minute' }],
    strengths: [{ title: 'Clear structure', detail: 'You led with the point.', from_answer: 1 }],
    goals: [goal()],
    previous_goals: [{ goal: goal(), now: 4, met: false, detail: '4 a minute this time' }],
    answers: [{
      index: 1, question: 'Tell me about a project.', text: 'I led the launch.', words: 4, speaking_s: 2, wpm: 120,
      fillers: [], fillers_per_min: 0, hedges: [], long_pauses: 0, time_to_start_s: 1.2,
    }],
    totals: {
      answers: 1, words: 4, speaking_s: 2, wpm: 120, filler_count: 0, fillers_per_min: 0, top_fillers: [], hedges: 0,
      long_pauses: 0, mean_answer_s: 2, mean_time_to_start_s: 1.2,
    },
    judged_by: 'gemini', ended_early: false, ...over,
  };
}

export function summary(over: Partial<PracticeResultSummary> = {}): PracticeResultSummary {
  return { id: 'p1', coach_name: 'Maya', started_at: '2026-11-14T10:00:00Z', duration_s: 290, overall: 72, answers: 5, goals_met: 1, goals_checked: 2, ...over };
}
