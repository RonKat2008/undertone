/**
 * Sample library and transcripts, shown (and labelled "sample") when no backend is connected.
 * The kept conversations are the same four the rest of the dashboard samples; three filtered
 * captures show what the automatic filter drops. Recordings are synthesised (sample-audio.ts).
 */
import { SAMPLE_SESSIONS } from '../bus/sample.ts';
import type { LibrarySession, SessionTranscript, TranscriptTurn } from './types';

/** audio_url marker for a synthesised sample recording. */
export const SAMPLE_AUDIO_PREFIX = 'sample-audio:';

const FILLERS = ['um', 'uh', 'like', 'you know', 'basically', 'sort of', 'kind of', 'i mean', 'actually'];

type Line = [speaker: 'me' | 'other', text: string, pause?: number];

/** Lays lines end to end at a speaking pace, with a short gap (or `pause`) before each. */
function script(id: string, lines: Line[], startAt = 2, paceMe = 170, paceThem = 150): TranscriptTurn[] {
  let t = startAt;
  return lines.map(([speaker, text, pause], i) => {
    const words = text.split(/\s+/).filter(Boolean).length;
    const wpm = speaker === 'me' ? paceMe + ((i * 7) % 23) - 11 : paceThem + ((i * 5) % 17) - 8;
    const start = t + (i === 0 ? 0 : pause ?? 0.7);
    const end = start + (words / wpm) * 60;
    t = end;
    const lower = text.toLowerCase();
    const fillers = speaker === 'me' ? FILLERS.filter((f) => new RegExp(`(^|[^a-z'])${f}([^a-z']|$)`).test(lower)) : [];
    return { turn_id: `${id}-t${i + 1}`, speaker, text, start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10, wpm, fillers };
  });
}

const SAM = script('sam', [
  ['other', 'So I just got back on Sunday. Twelve days in Portugal, mostly Lisbon and then up the coast.'],
  ['me', 'Oh nice. Um, so I actually went to Lisbon like three years ago, and the thing about Lisbon is the hills, you know, you basically walk everywhere and you are just destroyed by the end of the day.'],
  ['other', 'Yeah, the hills are real.'],
  ['me', 'And the food, like, I mean the custard tarts, we had them every single morning. There is this one place near the river, I forget the name, but it is sort of famous, there is always a queue.'],
  ['other', 'Pastéis de Belém, probably.', 0.4],
  ['me', 'Yes! That one. Um, and then we did a day trip to Sintra, which, you know, I would say is kind of the highlight, the palaces are unreal.'],
  ['other', 'We did Sintra too, actually. And then we drove north to Porto, which I liked even more.'],
  ['me', 'Oh, I never made it to Porto. I always say I will go back. Anyway, how was work when you got back, was it a pile of email?', 1.1],
  ['other', 'Honestly not too bad. Mira covered for me.'],
  ['me', 'That is good. Um, for me this week has been kind of a lot, we are launching the new onboarding flow on Thursday and basically everything is on fire, like the copy changed twice yesterday.'],
  ['other', 'That sounds stressful.'],
  ['me', 'It is, it is. But I think it will be good. I mean, the old flow lost like forty percent of people on the second screen, so anything is better.'],
  ['other', 'Right. Well, I should head to my next thing. Good to see you.', 1.5],
  ['me', 'You too. Let us get lunch next week, I will send you a time.'],
], 1.6);

const ALEX = script('alex', [
  ['other', 'I wanted to walk through the budget for next quarter before we take it to Dana. The short version is we are about fifteen percent over where'],
  ['me', 'Over on headcount or on tools?', 0.1],
  ['other', 'Mostly tools. The headcount is where we planned. The analytics renewal came in higher than', 0.5],
  ['me', 'Higher than last year, yes, I saw the email. Can we push back on that?', 0.1],
  ['other', 'Maybe. I asked for a multi-year quote. It brings it down about eight percent.'],
  ['me', 'Okay. What would we give up if we went with the cheaper tier?'],
  ['other', 'The session replays, mainly. Support uses those a lot.'],
  ['me', 'Then I would rather keep them. What does the multi-year lock us into, three years?'],
  ['other', 'Two. With an exit after the first if usage drops below the floor.'],
  ['me', 'That seems fair. Um, do you want me to bring it to Dana or would you rather present it?', 1.2],
  ['other', 'I can present it. I would like you there for the headcount questions, though.'],
  ['me', 'Done. Send me the deck tonight and I will read it before the meeting. And Alex, sorry, I kept cutting you off earlier.', 0.9],
  ['other', 'Ha, it is fine. Thanks for saying so.'],
], 1.2, 164, 140);

const PRIYA = script('priya', [
  ['other', 'Thanks for coming in. To start, tell me about a project you are proud of.'],
  ['me', 'Sure. Um, so the one I would pick is the pricing page rebuild at my last company. Basically we had a page that had not changed in four years, and the conversion was, you know, kind of flat, and I had this hypothesis that people did not understand the difference between the two middle tiers. So I, uh, I ran interviews with about fifteen customers, and it turned out that was exactly it, they could not tell what they were paying for. So we rewrote the tiers around the jobs people were actually doing, and we tested it against the old page for three weeks, and conversion on the middle tier went up by twenty two percent, which was, I mean, the biggest single change that year.'],
  ['other', 'That is a strong result. What would you do differently?', 1.4],
  ['me', 'I would have shipped a smaller version first. We spent six weeks on it when two would have told us the same thing.'],
  ['other', 'Good. How do you decide what not to build?'],
  ['me', 'I ask what we would stop measuring if it worked. If nobody can answer that, it is not ready.'],
  ['other', 'I like that. Last one from me: why this role?'],
  ['me', 'Um, honestly, because the problem is the one I keep coming back to. You sell to teams that do not have a designer, and that is, like, every team I have ever worked with.'],
], 2.2, 179, 146);

const PRACTICE = script('practice', [
  ['me', 'So basically the plan for the quarter is to, basically, get the onboarding numbers up.'],
  ['me', 'The plan for the quarter is to get onboarding completion from sixty to seventy five percent.', 3.5],
  ['me', 'Our plan this quarter: onboarding completion from sixty to seventy five percent, by fixing the second screen.', 3.5],
], 1, 158);

const NOISE = script('noise', [
  ['other', 'Two oat flat whites and a, what was the other one?'],
  ['other', 'The cinnamon thing, yeah. Name for the order?', 1.2],
  ['other', 'Ready in five at the end of the bar.', 2.5],
], 3, 150, 150);

const TRANSCRIPTS: Record<string, Omit<SessionTranscript, 'session_id' | 'started_at' | 'duration_s'>> = {
  's-20261113-1602': { audio_url: `${SAMPLE_AUDIO_PREFIX}s-20261113-1602`, audio_offset_s: 1.5, turns: SAM },
  's-20261112-1130': { audio_url: `${SAMPLE_AUDIO_PREFIX}s-20261112-1130`, audio_offset_s: 0, turns: ALEX },
  's-20261111-0915': { audio_url: null, audio_offset_s: 0, turns: PRACTICE },
  's-20261109-1410': { audio_url: `${SAMPLE_AUDIO_PREFIX}s-20261109-1410`, audio_offset_s: 0.8, turns: PRIYA },
  's-20261113-0844': { audio_url: null, audio_offset_s: 0, turns: [] },
  's-20261112-0817': { audio_url: `${SAMPLE_AUDIO_PREFIX}s-20261112-0817`, audio_offset_s: 0, turns: NOISE },
  's-20261110-1930': { audio_url: null, audio_offset_s: 0, turns: [] },
};

const zero = { talk_ratio: 0, interruptions: 0, questions: 0, fillers_per_min: 0, wpm: 0 };

const lastEnd = (turns: TranscriptTurn[]) => turns.reduce((m, t) => Math.max(m, t.end), 0);

export const SAMPLE_LIBRARY: LibrarySession[] = [
  // Same lengths as everywhere else in the sample; the scripts are the opening minutes of each.
  ...SAMPLE_SESSIONS.map((s) => ({
    ...s,
    duration_s: Math.max(s.duration_s, Math.round(lastEnd(TRANSCRIPTS[s.session_id].turns) + 2)),
    kept: true, kept_reason: 'keep' as const, audio_url: TRANSCRIPTS[s.session_id].audio_url,
  })),
  { session_id: 's-20261113-0844', started_at: '2026-11-13T08:44:00Z', duration_s: 6, coach_name: 'Personal', mode: 'regular', person_id: null, headline_fact: 'A six-second exchange at the door.', numbers: zero, kept: false, kept_reason: 'trivial', audio_url: null },
  { session_id: 's-20261112-0817', started_at: '2026-11-12T08:17:00Z', duration_s: 24, coach_name: 'Personal', mode: 'regular', person_id: null, headline_fact: 'Other people ordering coffee; you did not speak.', numbers: zero, kept: false, kept_reason: 'noise', audio_url: `${SAMPLE_AUDIO_PREFIX}s-20261112-0817` },
  { session_id: 's-20261110-1930', started_at: '2026-11-10T19:30:00Z', duration_s: 1140, coach_name: 'Personal', mode: 'regular', person_id: null, headline_fact: 'A long call the filter judged private.', numbers: zero, kept: false, kept_reason: 'sensitive', audio_url: null },
];

/** The mock feed's own sessions (s-mock-…) and the sample debrief (s-sample) open the Sam conversation. */
export function sampleAlias(id: string): string {
  return id === 's-sample' || id.startsWith('s-mock-') ? 's-20261113-1602' : id;
}

export function sampleTranscript(id: string): SessionTranscript | null {
  const real = sampleAlias(id);
  const t = TRANSCRIPTS[real];
  const s = SAMPLE_LIBRARY.find((x) => x.session_id === real);
  if (!t || !s) return null;
  return { session_id: id, started_at: s.started_at, duration_s: s.duration_s, ...t };
}
