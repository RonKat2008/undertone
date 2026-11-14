/**
 * Canned data for the mock feed and for screens whose backend does not exist yet.
 * Anything from here that reaches the screen outside the mock session is labelled "sample".
 * Shared verbatim between dashboard/lib/bus and mobile/src/bus.
 */
import type {
  CoachSpec, DailyMission, Debrief, HabitProfile, NudgePolicy, Person, SessionSummary, Streak,
  TimelinePoint, WeeklyReport,
} from './contracts';

export const REGULAR_POLICY: NudgePolicy = {
  focus_rule_id: 'pace', budget_per_session: 3, min_gap_s: 30, tolerance: 0.25, silent: false,
};
export const PRACTICE_POLICY: NudgePolicy = {
  focus_rule_id: 'crutch', budget_per_session: 99, min_gap_s: 0, tolerance: 0, silent: false,
};

export const INTERVIEW_COACH: CoachSpec = {
  id: 'interview',
  name: 'Interview',
  goal: 'Give structured, direct answers in case interviews: answer the question that was asked, lead with the point, and keep each answer under two minutes without hedging.',
  kind: 'prebuilt',
  confidence_threshold: 0.8,
  keyterms: ['case interview', 'profitability', 'framework', 'revenue', 'margin', 'same-store sales', 'MECE'],
  filler_words: ['um', 'uh', 'like', 'you know', 'kind of', 'basically', 'actually', 'I mean'],
  questions: {
    bottom_line_first: {
      type: 'score',
      instructions: 'Where does the direct answer appear in the turn?',
      criteria: ['Never answers', 'Answer buried at the end', 'Answer in the middle', 'Answer in the first sentence'],
    },
    vague_quantity: { type: 'noul', instructions: 'Does the wearer describe an amount with only vague words where a number would fit?' },
    undercut_number: { type: 'noul', instructions: 'Does the wearer state a number and then weaken it in the same breath?' },
    structure: {
      type: 'choice',
      instructions: 'How is the answer organised?',
      criteria: { framework: 'Names its parts before going into them', list: 'A run of points with no stated structure', stream: 'One unbroken thought' },
    },
  },
  nudge_rules: [
    { id: 'pace', when: 'metrics.wpm > 200', haptic: 'slow_down', message: 'Slow down', cooldown_s: 120, enabled: true },
    { id: 'interrupt', when: 'judge.interrupted.p >= 0.8', haptic: 'interrupt', message: 'Let them finish', cooldown_s: 60, enabled: true },
    { id: 'long_turn', when: 'metrics.monologue_s > 45', haptic: 'wrap_up', message: 'Ask a question', cooldown_s: 90, enabled: true },
    { id: 'filler', when: 'metrics.fillers_per_min > 6', haptic: 'filler', message: 'Pause', cooldown_s: 45, enabled: true },
    { id: 'hedging', when: 'judge.hedging.p >= 0.8', haptic: 'tap', message: 'Say it plainly', cooldown_s: 90, enabled: true },
  ],
  motion_rules: [
    { id: 'fidget_listening', when: 'motion.fidget_while_other_s > 8', haptic: 'still', message: 'Hands calm', cooldown_s: 90, enabled: true },
  ],
  nudge_policy: REGULAR_POLICY,
  debrief_rubric: 'Lead with the most telling number against the goal. Quote one answer that led with the point. The fix is about answer structure, not personality.',
  drill: {
    partner_persona: 'A calm senior consultant running a first-round case interview.',
    prompts: ['Tell me about yourself.', 'Why consulting?', 'Walk me through how you would size the market for oat milk.'],
  },
};

export const LISTENER_COACH: CoachSpec = {
  id: 'listener',
  name: 'Listener',
  goal: 'Be the better listener: talk less than 40% of the time, let the other person finish, and ask open questions.',
  kind: 'prebuilt',
  confidence_threshold: 0.8,
  keyterms: [],
  filler_words: ['um', 'uh', 'like', 'you know'],
  questions: {
    self_redirect: { type: 'noul', instructions: 'Did the wearer steer the topic back to themselves?' },
    listening_depth: {
      type: 'score',
      instructions: 'How well does the turn show the wearer heard the other person?',
      criteria: ['Ignores what was said', 'Generic acknowledgement', 'Reflects the content back', 'Reflects content and feeling'],
    },
    unsolicited_advice: { type: 'noul', instructions: 'Did the wearer give advice that was not asked for?' },
  },
  nudge_rules: [
    { id: 'pace', when: 'metrics.wpm > 200', haptic: 'slow_down', message: 'Slow down', cooldown_s: 120, enabled: true },
    { id: 'interrupt', when: 'judge.interrupted.p >= 0.8', haptic: 'interrupt', message: 'Let them finish', cooldown_s: 60, enabled: true },
    { id: 'talk_share', when: 'metrics.talk_ratio > 0.4', haptic: 'wrap_up', message: 'Ask them a question', cooldown_s: 120, enabled: true },
    { id: 'self_redirect', when: 'judge.self_redirect.p >= 0.8', haptic: 'tap', message: 'Back to their story', cooldown_s: 90, enabled: true },
  ],
  motion_rules: [
    { id: 'fidget_listening', when: 'motion.fidget_while_other_s > 8', haptic: 'still', message: 'Hands calm', cooldown_s: 90, enabled: true },
  ],
  nudge_policy: { ...REGULAR_POLICY, tolerance: 0.3 },
  debrief_rubric: 'Lead with talk share against 40%. Quote one moment where the wearer reflected back what was said.',
  drill: {
    partner_persona: 'A friend describing a hard week at work.',
    prompts: ['Ask me three open questions in a row.', 'Summarise what I just said before you add anything.'],
  },
};

export const SAMPLE_PROFILE: HabitProfile = {
  sessions: 9,
  baseline_wpm: 160,
  baseline_volume_db: -21,
  crutch_words: [
    { word: 'basically', per_min: 2.8 },
    { word: 'like', per_min: 2.1 },
    { word: 'um', per_min: 1.4 },
  ],
  recurring_issues: [
    { rule_id: 'long_turn', label: 'Answers that run past 45 seconds', rate: 0.44, trend: 'better' },
    { rule_id: 'interrupt', label: 'Starting before they finish', rate: 0.31, trend: 'same' },
    { rule_id: 'pace', label: 'Speeding up mid-answer', rate: 0.27, trend: 'worse' },
  ],
};

export const PERSONAL_COACH: CoachSpec = {
  id: 'personal',
  name: 'Personal',
  goal: 'Drill your own crutch words: catch each one, then replace it with a pause.',
  kind: 'personal',
  confidence_threshold: 0.7,
  keyterms: ['basically', 'like'],
  filler_words: ['basically', 'like', 'um'],
  questions: {},
  nudge_rules: [
    { id: 'crutch', when: 'metrics.fillers_per_min > 0', haptic: 'filler', message: 'Pause', cooldown_s: 0, enabled: true },
    { id: 'pace', when: 'metrics.wpm > 200', haptic: 'slow_down', message: 'Slow down', cooldown_s: 20, enabled: true },
    { id: 'long_turn', when: 'metrics.monologue_s > 30', haptic: 'wrap_up', message: 'Land it', cooldown_s: 30, enabled: false },
  ],
  motion_rules: [
    { id: 'frozen', when: 'metrics.hand_energy < 0.1', haptic: 'still', message: 'Move your hands', cooldown_s: 20, enabled: false },
  ],
  nudge_policy: PRACTICE_POLICY,
  debrief_rubric: 'Report the round score against the previous round only.',
  drill: {
    partner_persona: 'A patient interviewer who waits through pauses.',
    prompts: ['Tell me about yourself.', 'What is a problem you solved recently?', 'Why this firm?'],
  },
};

export const SAMPLE_COACHES: CoachSpec[] = [INTERVIEW_COACH, LISTENER_COACH, PERSONAL_COACH];

const TIMELINE: TimelinePoint[] = [
  [0, 0, -30, 0.3], [5, 0, -29, 0.67], [10, 150, -19, 0.5], [15, 152, -27, 0.18], [20, 158, -18, 0.6],
  [25, 174, -17, 0.58], [30, 172, -28, 0.07], [35, 172, -18, 0.5], [40, 186, -16, 0.45], [45, 211, -12, 0.09],
  [50, 202, -13, 0.4], [55, 178, -27, 0.3], [60, 170, -19, 0.47],
].map(([t, wpm, volume_db, hand_energy]) => ({ t, wpm, volume_db, hand_energy }));

export const SAMPLE_DEBRIEF: Debrief = {
  headline_fact: 'Your cost answer ran 18 seconds without a pause and climbed to 214 words a minute. Your usual pace is 160.',
  strength: 'You opened with a question, “Is the drop across all stores, or just a few?”, before offering any theory. Your hands were moving while you asked it.',
  one_fix: 'You began “Right, so it’s cannibalisation” while the interviewer was still describing the newer stores, and the rent overrun had to be repeated.',
  if_then: 'When they are mid-sentence, wait for the full stop, then count one beat before you start.',
  numbers: { talk_ratio: 0.66, interruptions: 1, questions: 1, fillers_per_min: 5, wpm: 178 },
  best_moment_quote: 'Is the drop across all stores, or just a few of them?',
  vs_last_time: 'Fillers went from 7.5 to 5.0 a minute since your last case. Interruptions went from 2 to 1.',
  notes: [
    'Case: a regional coffee chain, about eighty stores, profits down twenty percent in two years.',
    'The drop sits mostly in stores opened in the last three years; rent on the new sites is far above plan.',
    'You split profit into revenue (same-store sales, traffic, ticket size, mix) and cost (rent, labour, beans).',
    'You promised a one-page breakdown tonight.',
  ],
  bookmarks: [
    {
      ts: 30.5, source: 'phone',
      snippet: 'Maybe. I hadn’t finished. Rent on the new sites is also far above plan.',
      what_happened: 'You marked the moment the interviewer said they had not finished. It followed your cannibalisation answer, which started over their sentence.',
      follow_up: null,
    },
    {
      ts: 61, source: 'promise',
      snippet: 'Yes. I’ll send you the deck tonight.',
      what_happened: 'You promised the one-page breakdown, due tonight.',
      follow_up: 'Send the one-page cost breakdown tonight',
    },
  ],
  timeline: TIMELINE,
  better_version: {
    original: 'I’d split it into revenue and cost. On revenue I’d look at same-store sales, then traffic against ticket size, then the mix, and on cost I’d go through rent, labour and beans store by store, and honestly I think you’d find it’s the rent…',
    rewritten: 'I think it is rent. The new sites carry fixed costs the volume does not cover yet. I would confirm with rent per store against sales per store. Does that match what you are seeing?',
    audio_url: null,
  },
};

export const SAMPLE_MISSION: DailyMission = {
  date: '2026-11-14',
  focus_rule_id: 'long_turn',
  text: 'End three answers with a question before they pass 30 seconds.',
  if_then: 'When I finish my second point, I ask one open question.',
  target: 3,
  progress: 1,
  done: false,
  suggestions: [
    { focus_rule_id: 'interrupt', text: 'Let the other person finish five times in a row.' },
    { focus_rule_id: 'pace', text: 'Keep one full answer inside 150 to 170 words a minute.' },
    { focus_rule_id: 'crutch', text: 'One practice round with two or fewer “basically”.' },
  ],
};

export const SAMPLE_STREAK: Streak = { days: 4, freeze_available: true, week: [true, true, false, true, true, true, true] };

export const SAMPLE_PEOPLE: Person[] = [
  { person_id: 'p-sam', name: 'Sam', sessions: 4, pattern: 'You talk 70% of the time with Sam, against 55% across everyone else.', brief: 'Last time you talked 70% and asked no questions about his trip. Open with one.' },
  { person_id: 'p-alex', name: 'Alex', sessions: 3, pattern: 'You start before Alex finishes about three times a conversation, against once with others.', brief: 'Alex pauses mid-sentence. Wait one extra beat before you answer.' },
  { person_id: 'p-priya', name: 'Priya', sessions: 2, pattern: 'Your pace runs 12% above your usual with Priya.', brief: 'First answer: one breath before you start.' },
];

export const SAMPLE_SESSIONS: SessionSummary[] = [
  { session_id: 's-20261113-1602', started_at: '2026-11-13T16:02:00Z', duration_s: 312, coach_name: 'Interview', mode: 'regular', person_id: 'p-sam', headline_fact: 'You talked 70% of the time and asked Sam 0 questions about his trip.', numbers: { talk_ratio: 0.7, interruptions: 2, questions: 0, fillers_per_min: 7.5, wpm: 171 } },
  { session_id: 's-20261112-1130', started_at: '2026-11-12T11:30:00Z', duration_s: 498, coach_name: 'Listener', mode: 'regular', person_id: 'p-alex', headline_fact: 'You started before Alex finished 3 times in 8 minutes.', numbers: { talk_ratio: 0.48, interruptions: 3, questions: 4, fillers_per_min: 6.1, wpm: 164 } },
  { session_id: 's-20261111-0915', started_at: '2026-11-11T09:15:00Z', duration_s: 95, coach_name: 'Personal', mode: 'practice', person_id: null, headline_fact: 'Practice: “basically” went from 6 to 3 across three rounds.', numbers: { talk_ratio: 1, interruptions: 0, questions: 0, fillers_per_min: 4.2, wpm: 158 } },
  { session_id: 's-20261109-1410', started_at: '2026-11-09T14:10:00Z', duration_s: 644, coach_name: 'Interview', mode: 'regular', person_id: 'p-priya', headline_fact: 'Your longest answer ran 71 seconds; the goal was under 45.', numbers: { talk_ratio: 0.61, interruptions: 1, questions: 2, fillers_per_min: 9.1, wpm: 179 } },
];

export const SAMPLE_WEEKLY: WeeklyReport = {
  week_of: '2026-11-09',
  trend: [
    { metric: 'fillers_per_min', from: 9.1, to: 5.0 },
    { metric: 'talk_ratio', from: 0.7, to: 0.66 },
    { metric: 'interruptions', from: 3, to: 1 },
    { metric: 'wpm', from: 179, to: 178 },
  ],
  best_session_id: 's-20261112-1130',
  biggest_improvement: 'Fillers fell from 9.1 to 5.0 a minute across four conversations.',
};
