import { Debrief, TimelinePoint } from '../../bus/contracts';

/** Generates realistic 3-trace timeline data over 180 seconds */
export function generateMockTimeline(durationS = 180): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  const step = 5; // every 5 seconds
  for (let t = 0; t <= durationS; t += step) {
    // Pace: baseline ~148 wpm, dips during listening, climbs during explanation
    const paceWave = Math.sin(t / 25) * 16 + Math.cos(t / 12) * 8;
    const wpm = Math.round(146 + paceWave + (t > 40 && t < 90 ? 12 : -6));

    // Volume: -32 dBFS (quiet listening) to -16 dBFS (engaged speech)
    const volWave = Math.sin(t / 18) * 6 + Math.cos(t / 30) * 4;
    const volume_db = Math.round((-22 + volWave) * 10) / 10;

    // Hand energy: 0.15 (still) to 0.75 (animated gesture)
    const energyWave = (Math.sin(t / 15) * 0.25 + Math.cos(t / 22) * 0.15);
    const hand_energy = Math.max(0.12, Math.min(0.88, Math.round((0.44 + energyWave) * 100) / 100));

    points.push({ t, wpm, volume_db, hand_energy });
  }
  return points;
}

export const FALLBACK_DEBRIEF: Debrief = {
  headline_fact: 'You talked 70% of the time, leaving little room for questions.',
  strength: 'Structured complex points into three clear categories before exploring details.',
  one_fix: 'Pause silently instead of filling transition pauses with "like" and "basically".',
  if_then: 'When you finish a key point, pause for two seconds and end with an open question.',
  numbers: {
    talk_ratio: 0.70,
    interruptions: 1,
    questions: 2,
    fillers_per_min: 4.2,
    wpm: 148,
  },
  best_moment_quote: 'Let\'s structure this into three buckets: supply constraints, unit margins, and distribution channels.',
  vs_last_time: 'Pace was 8 wpm slower than your baseline; interruptions down from 3.',
  notes: [
    'Walked through Q3 market expansion into European logistics network.',
    'Addressed variable cost structure and margin compression.',
    'Agreed on scheduling a dedicated deep-dive on freight contracts next Tuesday.',
  ],
  bookmarks: [
    {
      ts: 46,
      source: 'promise',
      snippet: 'I\'ll send you the updated deck and logistics model by tomorrow morning.',
      what_happened: 'Committed to delivering financial model and slide deck.',
      follow_up: 'Send updated deck and logistics model to Sam',
    },
    {
      ts: 112,
      source: 'phone',
      snippet: 'We need to verify cross-border customs regulations before opening Munich hub.',
      what_happened: 'Flagged critical regulatory risk requiring compliance sign-off.',
      follow_up: 'Confirm Munich customs clearance procedure with legal',
    },
  ],
  timeline: generateMockTimeline(180),
  better_version: {
    original: 'Like, basically we can probably scale that fast if the suppliers don\'t, you know, drop out on us.',
    rewritten: 'We can sustain this delivery velocity provided our tier-one suppliers maintain their service level agreement.',
    audio_url: null,
  },
};
