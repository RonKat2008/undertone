import { CoachSpec, HabitProfile } from '@/lib/bus/contracts';

export const PREBUILT_INTERVIEW: CoachSpec = {
  id: 'coach_interview',
  name: 'Technical & Executive Interview',
  goal: 'Structure answers with upfront conclusions, maintain concise monologues under 45s, and clarify constraints before solving.',
  kind: 'prebuilt',
  confidence_threshold: 0.82,
  keyterms: ['trade-off', 'latency', 'bottleneck', 'invariants', 'failure mode', 'scalability'],
  filler_words: ['basically', 'kind of', 'sort of', 'um', 'like', 'you know'],
  questions: {
    interrupted: {
      type: 'noul',
      instructions: 'Did the candidate interrupt the interviewer before a natural conversational pause?'
    },
    answer_structure: {
      type: 'choice',
      instructions: 'How was the answer structured in the first 15 seconds?',
      criteria: {
        bottom_line_first: 'Stated key conclusion or recommendation upfront before expanding',
        wandering: 'Began with narrative background without clear hypothesis',
        defensive: 'Justified past choices defensively rather than answering the prompt'
      }
    },
    technical_depth: {
      type: 'score',
      instructions: 'Rate architectural precision and quantitative calibration on a 1-5 scale',
      criteria: [
        '1: Superficial buzzwords without concrete mechanics',
        '2: Conceptual understanding but lacks edge case handling',
        '3: Clear components identified with realistic trade-offs',
        '4: Quantitative estimates and failure-domain analysis',
        '5: Rigorous synthesis of scale limits and degradation paths'
      ]
    }
  },
  nudge_rules: [
    {
      id: 'r_interview_interrupted',
      when: 'judge.interrupted.p >= 0.80',
      haptic: 'interrupt',
      message: 'Let them finish',
      cooldown_s: 30,
      enabled: true
    },
    {
      id: 'r_interview_monologue',
      when: 'metrics.monologue_s > 45',
      haptic: 'wrap_up',
      message: 'Check in with interviewer',
      cooldown_s: 60,
      enabled: true
    },
    {
      id: 'r_interview_pace',
      when: 'metrics.wpm > 175',
      haptic: 'slow_down',
      message: 'Slow your pace',
      cooldown_s: 45,
      enabled: true
    },
    {
      id: 'r_interview_fillers',
      when: 'metrics.fillers_per_min > 4.5',
      haptic: 'filler',
      message: 'Pause and collect thoughts',
      cooldown_s: 60,
      enabled: false
    }
  ],
  motion_rules: [
    {
      id: 'm_interview_fidget',
      when: 'motion.state == "fidget" && motion.hand_energy > 0.70',
      haptic: 'still',
      message: 'Anchor your hands',
      cooldown_s: 30,
      enabled: true
    }
  ],
  nudge_policy: {
    focus_rule_id: 'r_interview_monologue',
    budget_per_session: 5,
    min_gap_s: 60,
    tolerance: 0.25,
    silent: false
  },
  debrief_rubric: 'Candidate should deliver structured top-down responses, keep monologues strictly under 45 seconds, acknowledge interviewer feedback immediately, and maintain steady measured delivery (130-150 wpm).',
  drill: {
    partner_persona: 'Skeptical Systems Architect',
    prompts: [
      '"Walk me through how you would handle network partitions in our distributed cache."',
      '"Why wouldn\'t you just use Postgres for that scale?"',
      '"Tell me about a time an outage occurred under your watch."'
    ]
  }
};

export const PREBUILT_LISTENER: CoachSpec = {
  id: 'coach_listener',
  name: 'Active Listener & 1:1 Partner',
  goal: 'Keep talk ratio below 40%, let partner speak without cutting in, and ask clarifying questions instead of offering unprompted solutions.',
  kind: 'prebuilt',
  confidence_threshold: 0.75,
  keyterms: ['tell me more', 'how did that feel', 'what do you need', 'what happened next', 'makes sense'],
  filler_words: ['right right', 'yeah yeah', 'obviously', 'actually', 'totally'],
  questions: {
    talk_ratio_high: {
      type: 'noul',
      instructions: 'Is the wearer dominating speaking time during a peer check-in?'
    },
    listening_mode: {
      type: 'choice',
      instructions: 'What was the character of the wearer\'s response?',
      criteria: {
        open_question: 'Asked an open question inviting deeper reflection',
        advice_giving: 'Offered premature advice or solutions before listening',
        validation: 'Acknowledged and validated the other person\'s experience'
      }
    },
    curiosity_depth: {
      type: 'score',
      instructions: 'Rate conversational curiosity and openness from 1 to 5',
      criteria: [
        '1: Dismissive or checked out',
        '2: Waiting for a gap to counter-argue',
        '3: Attentive listening with neutral acknowledgment',
        '4: Probing question uncovering latent assumptions',
        '5: Deep generative inquiry that shifts the speaker\'s frame'
      ]
    }
  },
  nudge_rules: [
    {
      id: 'r_listener_cut_off',
      when: 'judge.interrupted.p >= 0.75',
      haptic: 'interrupt',
      message: 'Let them finish',
      cooldown_s: 30,
      enabled: true
    },
    {
      id: 'r_listener_talk_ratio',
      when: 'metrics.talk_ratio > 0.45 && metrics.monologue_s > 30',
      haptic: 'wrap_up',
      message: 'Pass the floor back',
      cooldown_s: 60,
      enabled: true
    },
    {
      id: 'r_listener_fillers',
      when: 'metrics.fillers_per_min > 5',
      haptic: 'filler',
      message: 'Hold the silence',
      cooldown_s: 45,
      enabled: false
    }
  ],
  motion_rules: [
    {
      id: 'm_listener_still',
      when: 'motion.state == "still" && metrics.talk_ratio < 0.2',
      haptic: 'tap',
      message: 'Engage actively',
      cooldown_s: 90,
      enabled: false
    }
  ],
  nudge_policy: {
    focus_rule_id: 'r_listener_cut_off',
    budget_per_session: 4,
    min_gap_s: 75,
    tolerance: 0.20,
    silent: false
  },
  debrief_rubric: 'Focus on conversational equilibrium: talk ratio ≤ 40%, zero interruptions, at least 3 open questions per 10 minutes of conversation, and comfortable tolerance of pauses.',
  drill: {
    partner_persona: 'Overwhelmed Direct Report',
    prompts: [
      '"I feel like our cross-functional team isn\'t taking our blockers seriously."',
      '"I\'m overwhelmed by the Q3 project timelines and need to renegotiate scope."',
      '"I don\'t think the redesign is heading in the right direction."'
    ]
  }
};

export const DEFAULT_HABIT_PROFILE: HabitProfile = {
  sessions: 14,
  baseline_wpm: 152,
  baseline_volume_db: -18,
  crutch_words: [
    { word: 'like', per_min: 2.8 },
    { word: 'basically', per_min: 1.6 },
    { word: 'you know', per_min: 1.1 },
    { word: 'actually', per_min: 0.7 }
  ],
  recurring_issues: [
    { rule_id: 'r_pace_spike', label: 'Pace spike > 175 wpm when arguing', rate: 3.4, trend: 'worse' },
    { rule_id: 'r_interrupted_excitement', label: 'Interruption during excitement', rate: 2.1, trend: 'better' },
    { rule_id: 'r_monologue_runaway', label: 'Monologue runaway > 50s', rate: 1.8, trend: 'same' },
    { rule_id: 'm_restless_fidget', label: 'Restless hand fidgeting in pauses', rate: 4.2, trend: 'worse' }
  ]
};

export function buildMockPersonalCoach(profile: HabitProfile = DEFAULT_HABIT_PROFILE): CoachSpec {
  return {
    id: 'coach_personal_wearer',
    name: 'Personal Habit Calibration',
    goal: 'Target personal recurring patterns: damp pace spikes > 175 wpm, rein in monologue creep beyond 50s, and calm hand restlessness.',
    kind: 'personal',
    confidence_threshold: 0.85,
    keyterms: ['specifically', 'for instance', 'pause', 'hear your take'],
    filler_words: profile.crutch_words.map(c => c.word),
    questions: {
      pace_control: {
        type: 'noul',
        instructions: 'Did wearer maintain steady pace (< 170 wpm) through contested discussions?'
      },
      turn_discipline: {
        type: 'choice',
        instructions: 'Characterize turn length relative to partner engagement',
        criteria: {
          concise_burst: 'Turn under 35 seconds ending in an explicit hand-off',
          extended_elaboration: 'Continued past 45 seconds without checking for comprehension',
          overrun: 'Spoke beyond 60 seconds despite subtle partner cue'
        }
      },
      composure_index: {
        type: 'score',
        instructions: 'Evaluate physical and vocal stillness on a 1-5 scale',
        criteria: [
          '1: Agitated rapid speech with frequent physical fidgeting',
          '2: Uneven cadences with visible restlessness',
          '3: Controlled delivery with minor speed surges',
          '4: Grounded vocal cadence with measured hand gestures',
          '5: Deeply centered tempo with intentional quiet pauses'
        ]
      }
    },
    nudge_rules: [
      {
        id: 'r_personal_pace',
        when: 'metrics.wpm > 175',
        haptic: 'slow_down',
        message: 'Slow your pace',
        cooldown_s: 45,
        enabled: true
      },
      {
        id: 'r_personal_monologue',
        when: 'metrics.monologue_s > 50',
        haptic: 'wrap_up',
        message: 'Ask a question',
        cooldown_s: 60,
        enabled: true
      },
      {
        id: 'r_personal_cut_off',
        when: 'judge.interrupted.p >= 0.85',
        haptic: 'interrupt',
        message: 'Let them finish',
        cooldown_s: 30,
        enabled: true
      },
      {
        id: 'r_personal_fillers',
        when: 'metrics.fillers_per_min > 3.5',
        haptic: 'filler',
        message: 'Breathe through the pause',
        cooldown_s: 60,
        enabled: false
      }
    ],
    motion_rules: [
      {
        id: 'm_personal_fidget',
        when: 'motion.state == "fidget" && motion.hand_energy > 0.70',
        haptic: 'still',
        message: 'Hands calm and resting',
        cooldown_s: 30,
        enabled: true
      }
    ],
    nudge_policy: {
      focus_rule_id: 'r_personal_pace',
      budget_per_session: 5,
      min_gap_s: 60,
      tolerance: 0.20,
      silent: false
    },
    debrief_rubric: 'Examine progress on the wearer\'s chronic tendencies: track if speed surges remained under 170 wpm, whether monologues capped before 50s, and whether filler frequency dropped below 2.0 / min.',
    drill: {
      partner_persona: 'Debate Partner with Counter-Arguments',
      prompts: [
        '"I disagree with your core premise that distributed consensus is necessary here."',
        '"Your estimates seem off by at least two quarters."',
        '"Why would we invest in this refactor when product features are slipping?"'
      ]
    }
  };
}

export function generateCustomCoachFromGoal(goal: string): CoachSpec {
  const g = goal.toLowerCase();
  const id = `coach_custom_${Date.now()}`;
  
  // Synthesize custom title based on goal keywords
  let name = 'Custom Communication Coach';
  let focusRuleId = 'r_custom_focus';
  let primaryHaptic: CoachSpec['nudge_rules'][0]['haptic'] = 'wrap_up';
  let primaryMessage = 'Check in with listener';
  let primaryWhen = 'metrics.monologue_s > 40';

  if (g.includes('interrupt') || g.includes('cut off') || g.includes('listen')) {
    name = 'Interrupt Suppression & Active Listening';
    focusRuleId = 'r_custom_interrupt';
    primaryHaptic = 'interrupt';
    primaryMessage = 'Let them finish';
    primaryWhen = 'judge.interrupted.p >= 0.78';
  } else if (g.includes('slow') || g.includes('pace') || g.includes('fast') || g.includes('rush')) {
    name = 'Pacing & Cadence Control';
    focusRuleId = 'r_custom_pace';
    primaryHaptic = 'slow_down';
    primaryMessage = 'Slow your tempo';
    primaryWhen = 'metrics.wpm > 170';
  } else if (g.includes('filler') || g.includes('um') || g.includes('like') || g.includes('concise')) {
    name = 'Precision & Economy of Speech';
    focusRuleId = 'r_custom_filler';
    primaryHaptic = 'filler';
    primaryMessage = 'Hold the silence';
    primaryWhen = 'metrics.fillers_per_min > 3.0';
  } else if (g.includes('hands') || g.includes('fidget') || g.includes('still') || g.includes('gesture')) {
    name = 'Physical Composure & Hand Grounding';
    focusRuleId = 'r_custom_still';
    primaryHaptic = 'still';
    primaryMessage = 'Rest your hands';
    primaryWhen = 'motion.state == "fidget"';
  } else if (g.includes('executive') || g.includes('summary') || g.includes('pitch') || g.includes('stakeholder')) {
    name = 'Executive Presence & Synthesis';
    focusRuleId = 'r_custom_monologue';
    primaryHaptic = 'wrap_up';
    primaryMessage = 'State bottom line';
    primaryWhen = 'metrics.monologue_s > 35';
  }

  return {
    id,
    name,
    goal: goal.trim(),
    kind: 'custom',
    confidence_threshold: 0.80,
    keyterms: ['in summary', 'key question', 'hypothesis', 'clarifying', 'next step'],
    filler_words: ['like', 'basically', 'sort of', 'actually', 'you know'],
    questions: {
      rule_adherence: {
        type: 'noul',
        instructions: `Did the speaker adhere to the stated goal: "${goal.slice(0, 70)}..."?`
      },
      delivery_mode: {
        type: 'choice',
        instructions: 'Evaluate speaker stance during the turn',
        criteria: {
          deliberate: 'Paced, responsive to feedback, concise hand-off',
          reactive: 'Defensive or hurried reaction to interruption',
          runaway: 'Excessive detail beyond the question scope'
        }
      },
      clarity_score: {
        type: 'score',
        instructions: 'Rate communicative impact and economy of words from 1 to 5',
        criteria: [
          '1: Muddled, disjointed narrative',
          '2: Wordy with delayed conclusion',
          '3: Adequate structure and clarity',
          '4: Crisp bottom-line framing with evidence',
          '5: Masterful succinct delivery'
        ]
      }
    },
    nudge_rules: [
      {
        id: focusRuleId,
        when: primaryWhen,
        haptic: primaryHaptic,
        message: primaryMessage,
        cooldown_s: 45,
        enabled: true
      },
      {
        id: 'r_secondary_cut_off',
        when: 'judge.interrupted.p >= 0.82',
        haptic: 'interrupt',
        message: 'Let them finish',
        cooldown_s: 30,
        enabled: true
      },
      {
        id: 'r_secondary_pace',
        when: 'metrics.wpm > 175',
        haptic: 'slow_down',
        message: 'Slow down',
        cooldown_s: 45,
        enabled: true
      },
      {
        id: 'r_secondary_monologue',
        when: 'metrics.monologue_s > 45',
        haptic: 'wrap_up',
        message: 'Ask a question',
        cooldown_s: 60,
        enabled: false
      }
    ],
    motion_rules: [
      {
        id: 'm_custom_fidget',
        when: 'motion.state == "fidget" && motion.hand_energy > 0.75',
        haptic: 'still',
        message: 'Anchor your posture',
        cooldown_s: 30,
        enabled: true
      }
    ],
    nudge_policy: {
      focus_rule_id: focusRuleId,
      budget_per_session: 5,
      min_gap_s: 60,
      tolerance: 0.25,
      silent: false
    },
    debrief_rubric: `Evaluate conversation against stated intent: "${goal}". Focus specifically on turn length, adherence to ${primaryMessage.toLowerCase()}, and respectful dialogic balance.`,
    drill: {
      partner_persona: 'Direct and Time-Constrained Executive',
      prompts: [
        '"Give me the bottom-line summary in two sentences."',
        '"Why are we discussing this now instead of during our quarterly review?"',
        '"What is the single biggest risk to this schedule?"'
      ]
    }
  };
}
