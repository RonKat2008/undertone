import { BusEvent, CoachSpec, Debrief } from './contracts';
import { BusSource } from './socket-source';

const coach: CoachSpec = {
  id: 'c1',
  name: 'Case Interview Coach',
  goal: 'Stop saying like and sound confident in case interviews',
  kind: 'prebuilt',
  confidence_threshold: 0.8,
  keyterms: ['market sizing', 'profitability', 'margins'],
  filler_words: ['like', 'um', 'you know'],
  questions: {},
  nudge_rules: [],
  motion_rules: [],
  nudge_policy: { focus_rule_id: 'r1', budget_per_session: 5, min_gap_s: 60, tolerance: 0.3, silent: false },
  debrief_rubric: 'Consulting case interview standards.',
  drill: { partner_persona: 'Partner', prompts: ['Market size the US'] }
};

const mockDebrief: Debrief = {
  headline_fact: "You interrupted 3 times in the first 5 minutes.",
  strength: "Structured your approach clearly.",
  one_fix: "Pause before answering.",
  if_then: "When they finish speaking, count to 2 before starting.",
  numbers: { talk_ratio: 0.65, interruptions: 3, questions: 2, fillers_per_min: 4.5, wpm: 145 },
  best_moment_quote: "Let's break this down into fixed and variable costs.",
  vs_last_time: "Pace is down 10 wpm (better).",
  notes: ["Market sizing structure", "Profitability tree"],
  bookmarks: [{ ts: 45, source: 'promise', snippet: "I'll send you the deck", what_happened: "You promised to follow up", follow_up: "Send Sam the deck" }],
  timeline: [
    { t: 10, wpm: 150, volume_db: -15, hand_energy: 0.5 },
    { t: 30, wpm: 160, volume_db: -12, hand_energy: 0.8 },
    { t: 60, wpm: 140, volume_db: -18, hand_energy: 0.3 },
  ],
  better_version: { original: "Um, so like the costs are high.", rewritten: "Our primary issue is elevated fixed costs.", audio_url: null }
};

export class MockBusSource implements BusSource {
  private listeners: ((e: BusEvent) => void)[] = [];
  private timeoutIds: NodeJS.Timeout[] = [];
  private running = false;

  subscribe(onEvent: (e: BusEvent) => void): () => void {
    this.listeners.push(onEvent);
    return () => {
      this.listeners = this.listeners.filter(l => l !== onEvent);
    };
  }

  private emit(event: BusEvent) {
    if (!this.running) return;
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private schedule(delayMs: number, eventOrFn: BusEvent | (() => void)) {
    const id = setTimeout(() => {
      if (!this.running) return;
      if (typeof eventOrFn === 'function') eventOrFn();
      else this.emit(eventOrFn);
    }, delayMs);
    this.timeoutIds.push(id);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.runSequence();
  }

  stop(): void {
    this.running = false;
    for (const id of this.timeoutIds) clearTimeout(id);
    this.timeoutIds = [];
  }

  private runSequence() {
    // Initial setup
    this.emit({ type: 'coach.activated', coach });
    this.emit({ type: 'band.status', connected: true, transport: 'ble', battery_pct: 85, mic_on: true });
    this.emit({ type: 'device.status', device_id: 'd1', name: 'Wearable Mic', connected: true });
    this.emit({ type: 'session.started', session_id: 's1', coach_id: 'c1', mode: 'regular', policy: coach.nudge_policy, ts: 0 });

    // Every second emit metrics
    for (let s = 1; s <= 90; s++) {
      this.schedule(s * 1000, () => {
        this.emit({
          type: 'metrics',
          talk_ratio: 0.6,
          interruptions: s > 15 ? 1 : 0,
          questions: s > 30 ? 1 : 0,
          fillers_per_min: s > 40 ? 5 : 2,
          wpm: 140 + Math.sin(s / 5) * 20,
          baseline_wpm: 150,
          monologue_s: s % 30,
          volume_db: -20 + Math.sin(s / 3) * 5,
          volume_state: 'ok',
          hand_energy: 0.4 + Math.sin(s / 2) * 0.3
        });
      });
    }

    // Sequence of conversation and events
    this.schedule(2000, { type: 'transcript.partial', speaker: 'other', text: 'So, ' });
    this.schedule(3000, { type: 'transcript.partial', speaker: 'other', text: "So, let's look at the market size." });
    this.schedule(4000, { type: 'turn.final', turn_id: 't1', speaker: 'other', text: "So, let's look at the market size.", start: 2, end: 4, wpm: 120, fillers: [] });
    this.schedule(4200, { type: 'judge', turn_id: 't1', results: { clarity: { kind: 'score', score: 4, max: 5, confidence: 0.9 } }, latency_ms: 200, source: 'decisions' });

    // Wearer interrupts
    this.schedule(4500, { type: 'transcript.partial', speaker: 'me', text: 'I think the US market is about...' });
    this.schedule(5500, { type: 'turn.final', turn_id: 't2', speaker: 'me', text: 'I think the US market is about 300 million people.', start: 4.5, end: 5.5, wpm: 150, fillers: [] });
    this.schedule(5650, { type: 'judge', turn_id: 't2', results: { interrupted: { kind: 'choice', choice: 'true', probabilities: { true: 0.9, false: 0.1 }, confidence: 0.9 } }, latency_ms: 150, source: 'rules' });
    this.schedule(6000, { type: 'nudge', rule_id: 'r_int', haptic: 'interrupt', message: 'Let them finish', reason: 'You interrupted', confidence: 0.9, latency_ms: 600, budget_left: 4, ts: 6 });

    // Monologue (wrap_up)
    this.schedule(15000, { type: 'turn.final', turn_id: 't3', speaker: 'me', text: '...and if we segment by age, we see a large portion in the 18 to 35 demographic, which implies a higher willingness to pay for premium features, assuming the distribution holds across urban centers...', start: 6, end: 15, wpm: 160, fillers: [] });
    this.schedule(16000, { type: 'nudge', rule_id: 'r_wrap', haptic: 'wrap_up', message: 'Ask a question', reason: 'Monologue > 45s', confidence: 0.85, latency_ms: 1000, budget_left: 3, ts: 16 });

    // Filler words climb
    this.schedule(25000, { type: 'turn.final', turn_id: 't4', speaker: 'me', text: 'So, um, like, the revenue would be, like, $500 million.', start: 20, end: 25, wpm: 130, fillers: ['um', 'like', 'like'] });
    this.schedule(26000, { type: 'nudge', rule_id: 'r_fill', haptic: 'filler', message: 'Pause', reason: 'Fillers spiking', confidence: 0.9, latency_ms: 800, budget_left: 2, ts: 26 });

    // Fidgeting while listening (still)
    this.schedule(35000, { type: 'motion', state: 'fidget', hand_energy: 0.85, speaker_context: 'other', confidence: 0.9, ts: 35 });
    this.schedule(36000, { type: 'nudge', rule_id: 'r_still', haptic: 'still', message: 'Hands calm', reason: 'Fidgeting while listening', confidence: null, latency_ms: 1000, budget_left: 1, ts: 36 });

    // Promise -> bookmark
    this.schedule(45000, { type: 'turn.final', turn_id: 't5', speaker: 'me', text: "I'll send you the deck after this meeting.", start: 40, end: 45, wpm: 140, fillers: [] });
    this.schedule(46000, { type: 'bookmark', source: 'promise', text: "I'll send you the deck", ts: 46 });

    // Nerves and checked_out signals
    this.schedule(55000, { type: 'signal', kind: 'nerves', detail: 'Pace jumped, hands frozen', ts: 55 });
    this.schedule(65000, { type: 'signal', kind: 'checked_out', detail: 'Hands still, no questions', ts: 65 });

    // status.reply
    this.schedule(70000, { type: 'status.reply', verdict: 'talking_too_much', haptic: 'status_talking', ts: 70 });

    // Success
    this.schedule(80000, { type: 'turn.final', turn_id: 't6', speaker: 'me', text: "What are your thoughts on that pricing model?", start: 75, end: 80, wpm: 130, fillers: [] });
    this.schedule(81000, { type: 'nudge', rule_id: 'r_succ', haptic: 'success', message: 'Great question', reason: 'Asked an open question', confidence: 0.95, latency_ms: 1200, budget_left: 0, ts: 81 });

    // End session
    this.schedule(90000, { type: 'session.ended', session_id: 's1' });
    this.schedule(92000, { type: 'debrief', session_id: 's1', data: mockDebrief, audio_url: null });

    // Loop
    this.schedule(100000, () => {
      if (this.running) this.runSequence();
    });
  }
}
