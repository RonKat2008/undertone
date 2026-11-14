# Undertone phone: Quiet Ink

The phone is a glance, not a dashboard. The band's buzz is the interface; the screen answers
"is it listening, how am I doing" in two seconds, and afterwards "what should I do differently
next time". The website shares this visual system.

## Principles

1. **Calm.** One big word, one supporting line, at most one action per state.
2. **Less, but better.** Every element helps answer "what do I do differently next time?". At most
   two levels of disclosure (the screen, then one "More"). No screen explains itself in paragraphs.
3. **Plain words.** Never show confidence numbers, scores, latency, ids, server addresses, units like
   dBFS, or the words "bus", "rule", "source", "demo", "sample". Uncertainty is said in words
   ("Probably a friend" is fine; "0.72" is not).
4. **The coach speaks in serif.** Text the AI wrote (debrief lines, recap, mission, the plan) is set in
   Newsreader. Facts and controls are Inter. No "AI" badges.
5. **Hairlines and space, not boxes.** No cards, nested boxes, glass, gradients, glows, decorative dots
   or pills, emoji, coloured borders, or grids of metric tiles. Controls (buttons, the segmented
   control, the sheet) are the only filled shapes.
6. **One accent, one meaning: your moment.** The nudge field, the one thing to try, the primary action,
   the unread mark. Never decoration, never a status colour.
7. **Motion explains a change or is absent.** 120-240 ms, transform and opacity only, on the UI thread
   (Reanimated), cut to nothing under Reduce Motion. Tab switches do not animate.
8. **No music.** No notes, staves, metronomes, pendulums, tempo markings or rhythm metaphors. Pace is
   "Steady" or "Rushing". Buzz patterns are named in words; where a mark helps (pattern tester), short
   and long dashes match the buzz.

## Tokens (`src/ui/theme.ts`)

Converted from the website's oklch values with culori.

| Token | oklch | Hex | Use |
|---|---|---|---|
| `bg` | 17% .008 70 | `#120F0C` | the page |
| `surface` | 21% .008 70 | `#1B1814` | quiet buttons, segmented track, sheet |
| `pressed` | 25% .008 70 | `#24211E` | a row or quiet button while pressed |
| `line` | 30% .008 70 | `#302D2A` | hairline rules |
| `lineStrong` | 42% .008 70 | `#504C48` | selected segment, scrubber track |
| `text` | 93% .008 85 | `#EAE7E2` | primary text (15.5:1) |
| `muted` | 68% .01 80 | `#9B9891` | secondary text (6.6:1) |
| `faint` | 52% .01 80 | `#6C6863` | disabled labels only (3.5:1, never meaning) |
| `accent` | 74% .09 195 | `#5EBDBC` | your moment (8.6:1) |
| `onAccent` | = bg | `#120F0C` | text on the accent field |
| `warn` | 80% .1 75 | `#E4B572` | needs you: an app waiting, a lost connection |
| `danger` | 72% .12 30 | `#E68677` | destructive actions only (unpair, revoke) |

Spacing is a 4 pt base: `S[1..9]` = 4, 8, 12, 16, 20, 24, 32, 48, 64. Gutter 20. Section gap 48.
Radius: 12 on controls, 20 on the sheet top, nothing else is rounded. Touch targets at least 44 pt;
buttons are 52 pt tall, the in-conversation Bookmark 88 pt.

## Type

Four faces: Inter Regular, Inter Medium, Newsreader Regular, Newsreader Italic. Six sizes.

| Role | Face | Size / line | Use |
|---|---|---|---|
| `display` | Inter Medium, -1.6 | 52 / 58 | the Now state word. One per screen. |
| `title` | Inter Medium, -0.8 | 34 / 40 | tab titles, a headline sentence |
| `lead` | Inter Medium, -0.3 | 22 / 28 | an empty-state sentence, a sheet title |
| `body` | Inter Regular (Medium for `strong`) | 17 / 24 | reading text, row titles, button labels |
| `small` | Inter Regular, muted | 15 / 20 | when, how long, a row's detail |
| `caption` | Inter Regular/Medium, muted | 13 / 18 | section labels, footnotes |
| `Prose` | Newsreader (Italic for the plan) | 17, 22 or 34 | the coach's voice only |

Numbers that change (times, counts, pace) use tabular numerals (`num`). No monospace family.
Sentence case everywhere; no tracked capitals or small caps.

## Components (`src/ui/kit.tsx`)

| Component | When |
|---|---|
| `Screen` | every screen: safe area top, gutter, optional `title` (tabs) and pinned `footer` |
| `Header` | pushed screens: back control, optional title |
| `T` | all non-coach text, by role |
| `Prose` | coach-written text only |
| `StateWord` | Now: the one big word, its line, its action as children |
| `Button` | `primary` (accent fill): the one thing to do. `quiet` (surface fill): anything else. `danger` (text only, danger colour): unpair, revoke. Has pressed (0.97 scale), disabled and loading states. `large` for Bookmark. |
| `TextButton` | an inline action in a line ("Read transcript", "Not now"). Accent by default. |
| `Row` | one list item: title (serif when coach-written), one detail line, small meta on the right. Full-bleed press highlight, hairline below. `unread` puts the accent mark before the title. |
| `Rule` | the only divider |
| `Section` | a group with a quiet caption label and 48 pt above |
| `Segmented` | two or three peers ("All / People") |
| `Disclosure` | the one "More" on a screen |
| `Sheet` | a short task over the current screen (tag a person, pick a mission) |
| `EmptyState` | nothing yet / not paired / can't reach: a sentence, a line, at most one action |
| `States` (`NotPaired`, `Failed`, `Fetching`) | the shared honest states every data screen uses |
| `Pattern` (`PATTERN_WORDS`, `patternWord`, `PatternMark`) | a buzz pattern in words, and its dash mark |

Inline style objects are avoided; each file keeps its styles in `StyleSheet.create`.

## Structure

Three tabs (expo-router `Tabs`, screens stay mounted): **Now**, **Conversations**, **You**.
Pushed: Debrief, Transcript, Connected apps, Buzz patterns. Pair is a full-screen modal.

## Now: the state table

Exactly one state shows. Order is priority, top wins.

| State | Word | Line | Action |
|---|---|---|---|
| Not paired | Not paired | Pair with your laptop to start. | Pair (primary) |
| Connecting (first time) | Connecting | Looking for your laptop. | none |
| Laptop unreachable | Not listening | Can't reach your laptop. Retrying. | none |
| Nudge just fired (2.5 s) | the pattern's words ("Slow down") on a full accent field | none | Bookmark stays usable |
| "How am I doing?" reply (3 s) | the verdict ("Doing fine") | You asked the band. | none |
| In a conversation | Steady / Rushing (accent) | pace and elapsed time, small | Bookmark (large), Stop (small, quiet) |
| Practice round | the crutch-word count | the prompt in serif; last round | Stop |
| Debrief ready | Debrief ready (caption) + the headline in serif | | Read debrief (primary), Not now (text) |
| Writing the debrief | Writing your debrief | Usually under a minute. | none |
| Band not connected | Band off | Nothing is being heard. | none |
| Mic off | Mic off | Your band's microphone is off. | none |
| Listening, quiet (always on) | Listening | Conversations start by themselves. Then today's mission in serif. | Practice (quiet) |
| Ready (tap to start) | Ready | Start when the conversation does. Then today's mission. | Start (primary), Practice (text) |

## Copy

Plain, short, second person, sentence case, no exclamation marks. Say what is true and what to do:
"Can't reach your laptop. Retrying." not "Error: connection failed". Actions are verbs ("Pair",
"Read debrief", "Try again"). Never blame: describe behaviour, not the person.
