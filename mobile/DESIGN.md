# Undertone phone: Quiet Ink, warm

The phone is a glance, not a dashboard. The band's buzz is the interface; the screen answers
"is it listening, how am I doing" in two seconds, and afterwards "what should I do differently
next time". It should feel warm, alive and specific, never like black-and-white lines.
The website shares this system; hex values below are for reconciling with its DESIGN.md.

## Principles

1. **Calm, not empty.** On Now: one orb, one big word, one line, at most one action per state.
   Elsewhere: few things, each given room and colour.
2. **Less, but better.** Everything helps answer "what do I do differently next time?". At most two
   levels of disclosure (the screen, then one "More"). No screen explains itself in paragraphs.
3. **Plain words.** No confidence numbers, scores, latency, ids, server addresses, units like dBFS, or
   the words "bus", "rule", "source", "demo", "sample". Uncertainty is said in words.
4. **The coach speaks in serif.** Text the AI wrote (debrief lines, recap, mission, the plan, the
   "next time" line) is Newsreader. Facts and controls are Inter. No "AI" badges.
5. **Soft surfaces with depth.** Content sits on warm rounded cards (radius 18), one level deep,
   separated by tone and a soft shadow, with generous padding. Every screen has a soft radial glow at
   the top so it is never flat black. Hairlines only between rows inside a list card.
6. **Colour with meaning.** Teal is your moment and the primary action. Amber is the coach's voice
   and highlights (the plan, "Rushing", "Debrief ready", something waiting on you). A categorical set
   of five hues marks people, apps and patterns consistently (the same person is always the same
   colour). No purple gradients, glass, gradient text or emoji.
7. **Motion explains a change.** Springs between Now states, a breathing orb that reacts to state,
   staggered list entrances, press scale on buttons, springy sheets. Transform and opacity only, on the
   UI thread (Reanimated), and none of it under Reduce Motion. Tab switches do not animate.
8. **No music.** No notes, staves, metronomes, pendulums, tempo markings or rhythm metaphors. Pace is
   "Steady" or "Rushing". Buzz patterns are named in words; their mark is short and long dashes.

## Tokens (`src/ui/theme.ts`)

All converted from oklch with culori.

| Token | oklch | Hex | Use |
|---|---|---|---|
| `bgDeep` | 14% .016 55 | `#0E0804` | tab bar, under the page |
| `bg` | 17% .018 55 | `#160D08` | the page: warm near-black |
| `surface` | 22% .02 55 | `#221812` | cards, sheet, inputs |
| `raised` | 26% .022 55 | `#2D211A` | quiet buttons, avatar wells, meter track |
| `pressed` | 29% .024 55 | `#352820` | anything while pressed |
| `line` | 32% .02 55 | `#3B3029` | hairlines inside list cards |
| `lineStrong` | 42% .02 55 | `#564A43` | scrubber track |
| `text` | 94% .012 80 | `#EFEAE2` | primary text (16:1 on bg) |
| `muted` | 73% .02 70 | `#B0A69B` | secondary text (8:1) |
| `faint` | 55% .02 65 | `#7A6F66` | placeholders and disabled only |
| `accent` | 74% .09 195 | `#5EBDBC` | teal: your moment, primary action, the listening orb |
| `accentSoft` | 30% .045 195 | `#0A3535` | teal wash: selected segment, "try next time" card |
| `warm` | 78% .11 65 | `#E8A869` | amber: coach highlights, Rushing, waiting on you |
| `warmSoft` | 31% .05 60 | `#432A15` | amber wash: debrief-ready card, weekly card |
| `danger` | 70% .14 25 | `#E97871` | destructive actions only |
| `HUES` | 72% .11 h | coral `#E1897B` (30), gold `#BFA14C` (90), sage `#6FB880` (150), sky `#5EADE2` (240), rose `#D887AE` (350) | people, apps, patterns; `hueFor(key)` picks one stably |

Spacing: 4 pt base, `S[1..9]` = 4, 8, 12, 16, 20, 24, 32, 48, 64. Gutter 20, section gap 32.
Radius: 12 controls, 18 cards, 24 sheet. Touch targets at least 44 pt; buttons 52 pt; Bookmark 88 pt.
Shadow: one soft shadow (`SHADOW`) on cards and the sheet; the primary button glows faintly teal.

## Type

Four faces: Inter Regular and Medium, Newsreader Regular and Italic. Six sizes.

| Role | Face | Size / line | Use |
|---|---|---|---|
| `display` | Inter Medium, -1.6 | 52 / 58 | the Now state word |
| `title` | Inter Medium, -0.8 | 34 / 40 | tab titles; serif 34 for a debrief headline |
| `lead` | Inter Medium, -0.3 | 22 / 28 | card headings, empty states, sheet titles |
| `body` | Inter Regular / Medium | 17 / 24 | reading text, row titles, buttons |
| `small` | Inter, muted | 15 / 20 | details, section headings (Medium, text colour) |
| `caption` | Inter, muted | 13 / 18 | footnotes, tab labels |
| `Prose` | Newsreader (Italic for the plan) | 17 / 22 / 34 | coach-written text only |

Tabular numerals for anything that updates. Sentence case; no tracked capitals or small caps.

## Components (`src/ui/kit.tsx`, `src/ui/visuals.tsx`)

| Component | When |
|---|---|
| `Screen` | every screen: warm page, top glow (`glow` colour), safe area, gutter, optional title and footer |
| `Header` | pushed screens: back control, optional title |
| `T` / `Prose` | Inter text by role / the coach's serif voice |
| `Card` | a soft surface. `list` puts `Row`s edge to edge with hairlines; `tint` washes it teal or amber |
| `Row` | one list item: `leading` visual (Avatar, IconWell), title (serif if coach-written), detail, meta, chevron when tappable |
| `Section` | a group with a sentence-case heading |
| `Appear` | staggered rise-and-fade entrance for cards and rows |
| `Button` | `primary` teal fill with a soft glow, `quiet` raised fill, `danger` raised fill with danger text; optional `icon`, `loading`, `large` |
| `TextButton` | an inline action ("Not now", "Read transcript") |
| `Segmented` | two or three peers; the selected one takes the teal wash |
| `Disclosure` | the one "More", a card that opens in place |
| `Sheet` | a short task; springs up |
| `EmptyState` | a card with an icon well, a sentence, a line, at most one action |
| `StateWord` | Now's big word and line; springs in when the word changes |
| `Orb` | the listening element: breathes calmly when listening, faster in a conversation, swells once on a nudge, an empty ring when not listening |
| `Ambient` | the radial glow behind a screen |
| `Avatar` / `IconWell` / `Icon` | coloured initial for a person or app / an icon on a soft tinted square / drawn line icons (no icon font) |
| `Meter` / `Sparkline` | a share or a value against a reference / the shape of pace over time. No axes, no scores |
| `Pattern` | `PATTERN_WORDS`, `patternWord`, `PatternMark` (dashes) |
| `States` | `NotPaired`, `Failed`, `Fetching`: the honest states every data screen uses |

## Structure

Three tabs (expo-router `Tabs`, kept mounted, drawn icon + word): **Now**, **Conversations**, **You**.
Pushed: Debrief, Transcript, Connected apps, Buzz patterns. Pair is a full-screen modal.

## Now: the state table

One state shows; order is priority. The page glow and orb take the state's colour.

| State | Orb / glow | Word | Line | Action |
|---|---|---|---|---|
| Not paired | ring, grey | Not paired | Pair with your laptop to start. | Pair |
| Connecting | ring, grey | Connecting | Looking for your laptop. | none |
| Laptop unreachable | ring, grey | Not listening | Can't reach your laptop. Retrying. | none |
| Nudge (2.5 s) | full teal field, orb swells | the pattern's words ("Slow down") | | Bookmark stays usable |
| "How am I doing?" (3 s) | teal, lively | the answer ("Doing fine") | You asked the band. | none |
| In a conversation | teal lively / amber when rushing | Steady / Rushing | pace and elapsed time | Bookmark (large), Stop (small) |
| Practice round | teal lively | the count of filler words | last round; the prompt on an amber card | Stop; afterwards "Another round" |
| Debrief ready | amber | amber card: "Debrief ready" + the headline in serif | | Read debrief, Not now |
| Writing the debrief | amber, calm | Writing | Your debrief is on its way. | none |
| Band off / Mic off (always on) | ring, grey | Band off / Mic off | Nothing is being heard. | none |
| Listening (always on) | teal, calm | Listening | Conversations start by themselves. + mission card | Practice |
| Ready (tap to start) | teal, calm | Ready | Start when the conversation does. + mission card | Start, Practice |

## Copy

Plain, short, second person, sentence case, no exclamation marks. Say what is true and what to do:
"Can't reach your laptop. Retrying." Actions are verbs ("Pair", "Read debrief", "Try again").
Describe behaviour, never the person.
