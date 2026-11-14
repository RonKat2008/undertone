import { Person } from '../../bus/contracts';

export const SAMPLE_PEOPLE: Person[] = [
  {
    person_id: 'p_alex',
    name: 'Alex Chen',
    sessions: 14,
    pattern: 'You interrupt Alex 3× more than anyone else in your team.',
    brief: 'Last time you talked 70%. Ask about his trip to Kyoto before diving into the sprint review.',
  },
  {
    person_id: 'p_sarah',
    name: 'Sarah Jenkins',
    sessions: 9,
    pattern: 'Monologues average 54 seconds before pausing. Talk ratio reaches 68%.',
    brief: 'Give her room after the quarterly roadmap update. She had two unaddressed concerns last week.',
  },
  {
    person_id: 'p_marcus',
    name: 'Marcus Vance',
    sessions: 6,
    pattern: 'Filler words jump to 7/min during technical explanations.',
    brief: 'Take a breath before answering architecture questions. Aim for MECE structure.',
  },
  {
    person_id: 'p_elena',
    name: 'Dr. Elena Rostova',
    sessions: 4,
    pattern: 'Speaking pace spikes to 175 wpm when defending timelines.',
    brief: 'Keep cadence under 140 wpm. Confirm agreement on milestones before debating scope.',
  },
  {
    person_id: 'p_david',
    name: 'David Kim',
    sessions: 2,
    pattern: 'Hand fidgeting detected during 45% of his speaking turns.',
    brief: 'Keep hands grounded on the table while listening. Ask for his perspective first.',
  },
];
