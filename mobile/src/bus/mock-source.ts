import { BusSource } from './socket-source';
import { BusEvent, CoachSpec, HabitProfile, SessionSummary, DailyMission, Streak, Person, WeeklyReport } from './contracts';

export const MOCK_COACHES: CoachSpec[] = [
  {
    id: 'c1',
    name: 'Consulting Prep',
    goal: 'Sound structured and confident',
    kind: 'prebuilt',
    confidence_threshold: 0.8,
    keyterms: ['MECE', 'profitability', 'market sizing'],
    filler_words: ['like', 'basically', 'um'],
    questions: {},
    nudge_rules: [],
    motion_rules: [],
    nudge_policy: { focus_rule_id: 'filler', budget_per_session: 5, min_gap_s: 60, tolerance: 0.3, silent: false },
    debrief_rubric: 'Consulting case interviews',
    drill: { partner_persona: 'MBB interviewer', prompts: [] }
  }
];

export const MOCK_HABIT_PROFILE: HabitProfile = {
  sessions: 12,
  baseline_wpm: 150,
  baseline_volume_db: -20,
  crutch_words: [{ word: 'like', per_min: 5 }],
  recurring_issues: []
};

export const MOCK_SESSIONS: SessionSummary[] = [];

export const MOCK_MISSION: DailyMission = {
  date: new Date().toISOString().split('T')[0],
  focus_rule_id: 'filler',
  text: 'Pause instead of saying like',
  if_then: 'When thinking, pause',
  target: 5,
  progress: 2,
  done: false,
  suggestions: []
};

export const MOCK_STREAK: Streak = {
  days: 5,
  freeze_available: true,
  week: [true, true, true, false, true, true, false]
};

export const MOCK_PEOPLE: Person[] = [];

export const MOCK_WEEKLY_REPORT: WeeklyReport = {
  week_of: '2026-11-09',
  trend: [],
  best_session_id: null,
  biggest_improvement: 'Fewer interruptions'
};

export const MOCK_DEVICES = [{ id: 'd1', name: 'Undertone Band', connected: true }];
export const MOCK_APPS = [{ id: 'a1', name: 'Google Meet' }];

export class MockBusSource implements BusSource {
  private listeners: ((e: BusEvent) => void)[] = [];
  private active = false;
  private timer: any = null;
  private intervals: any[] = [];

  subscribe(onEvent: (e: BusEvent) => void): () => void {
    this.listeners.push(onEvent);
    return () => {
      this.listeners = this.listeners.filter(l => l !== onEvent);
    };
  }

  private emit(e: BusEvent) {
    if (!this.active) return;
    this.listeners.forEach(l => l(e));
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.loop();
  }

  stop(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.intervals.forEach(i => clearInterval(i));
    this.intervals = [];
  }

  private loop() {
    if (!this.active) return;
    if (this.timer) clearTimeout(this.timer);
    this.intervals.forEach(i => clearInterval(i));
    this.intervals = [];

    const now = Date.now();
    let delay = 0;

    const schedule = (ms: number, e: BusEvent) => {
      this.timer = setTimeout(() => {
        this.emit({ ...e, ts: e.type === 'metrics' ? undefined : ((e as any).ts ?? (Date.now() - now) / 1000) } as any);
      }, delay + ms);
      delay += ms;
    };

    schedule(100, { type: 'band.status', connected: true, transport: 'ble', battery_pct: 80, mic_on: true });
    schedule(100, { type: 'device.status', device_id: 'd1', name: 'Undertone Band', connected: true });
    schedule(100, { type: 'coach.activated', coach: MOCK_COACHES[0] });
    schedule(100, { type: 'session.started', session_id: 's1', coach_id: 'c1', mode: 'regular', policy: MOCK_COACHES[0].nudge_policy, ts: 0 });

    schedule(1000, { type: 'transcript.partial', speaker: 'other', text: "Let's dive into the profitability issue." });
    schedule(2000, { type: 'turn.final', turn_id: 't1', speaker: 'other', text: "Let's dive into the profitability issue.", start: 1, end: 3, wpm: 120, fillers: [] });
    schedule(200, { type: 'judge', turn_id: 't1', results: {}, latency_ms: 150, source: 'decisions' });

    schedule(1000, { type: 'transcript.partial', speaker: 'me', text: "So I think we should definitely..." });
    schedule(500, { type: 'nudge', rule_id: 'interrupt', haptic: 'interrupt', message: "Let them finish", reason: "Interrupted", confidence: 0.9, latency_ms: 600, budget_left: 5, ts: 4.5 });

    schedule(2000, { type: 'turn.final', turn_id: 't2', speaker: 'me', text: "So I think we should definitely look at variable costs.", start: 3.5, end: 5.5, wpm: 140, fillers: [] });
    schedule(200, { type: 'judge', turn_id: 't2', results: {}, latency_ms: 180, source: 'decisions' });

    schedule(10000, { type: 'nudge', rule_id: 'wrap_up', haptic: 'wrap_up', message: "Ask a question", reason: "Talking too long", confidence: 0.9, latency_ms: 800, budget_left: 4, ts: 16 });

    schedule(5000, { type: 'transcript.partial', speaker: 'me', text: "And like, the margins are basically..." });
    schedule(500, { type: 'nudge', rule_id: 'filler', haptic: 'filler', message: "Pause", reason: "Filler words", confidence: 0.8, latency_ms: 600, budget_left: 3, ts: 21 });

    schedule(5000, { type: 'motion', state: 'fidget', hand_energy: 0.8, speaker_context: 'other', confidence: 0.9, ts: 26 });
    schedule(500, { type: 'nudge', rule_id: 'still', haptic: 'still', message: "Hands calm", reason: "Fidgeting", confidence: 0.9, latency_ms: 700, budget_left: 2, ts: 26.5 });

    schedule(10000, { type: 'nudge', rule_id: 'success', haptic: 'success', message: "Great structure", reason: "Clear framework", confidence: 0.9, latency_ms: 1000, budget_left: 2, ts: 36 });

    schedule(5000, { type: 'status.reply', verdict: 'talking_too_much', haptic: 'status_talking', ts: 41 });

    schedule(5000, { type: 'bookmark', source: 'promise', text: "I'll send you the deck", ts: 46 });

    schedule(5000, { type: 'signal', kind: 'nerves', detail: "Talking fast", ts: 51 });
    schedule(5000, { type: 'signal', kind: 'checked_out', detail: "Low energy", ts: 56 });

    schedule(5000, { type: 'session.ended', session_id: 's1' });
    schedule(2000, {
      type: 'debrief',
      session_id: 's1',
      audio_url: null,
      data: {
        headline_fact: "You talked 70% of the time",
        strength: "Clear frameworks",
        one_fix: "Pause instead of saying like",
        if_then: "When thinking, pause",
        numbers: { talk_ratio: 0.7, interruptions: 1, questions: 2, fillers_per_min: 5, wpm: 150 },
        best_moment_quote: "Let's structure this into three buckets",
        vs_last_time: "Slightly better on fillers",
        notes: ["Discussed market entry"],
        bookmarks: [{ ts: 46, source: 'promise', snippet: "I'll send you the deck", what_happened: "Promised follow up", follow_up: "Send deck" }],
        timeline: [],
        better_version: null
      }
    });

    this.timer = setTimeout(() => {
      if (this.active) this.loop();
    }, delay + 5000);

    let timeS = 0;
    const metricsInterval = setInterval(() => {
      if (!this.active || timeS > 70) {
        clearInterval(metricsInterval);
        return;
      }
      this.emit({
        type: 'metrics',
        talk_ratio: 0.6,
        interruptions: 1,
        questions: 0,
        fillers_per_min: 3,
        wpm: 150 + Math.random() * 20,
        baseline_wpm: 150,
        monologue_s: timeS > 15 ? timeS - 15 : timeS,
        volume_db: -20 + Math.random() * 5,
        volume_state: 'ok',
        hand_energy: 0.3 + Math.random() * 0.2
      });
      timeS++;
    }, 1000);
    this.intervals.push(metricsInterval);
  }
}
