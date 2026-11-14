# DESIGN.md: Undertone, "Lamplight"

> Proposed by the web foundation branch for human approval (`AGENTS.md`: humans decide `DESIGN.md`). It replaces "Tempo". The owner's direction: simple, a really good UI, dark by default, warmer and more colourful than "black, white and lines", and no music notation.
>
> Source of truth for values: `dashboard/app/globals.css`. Hex values come from `dashboard/scripts/tokens-hex.mjs`, which uses culori (`node scripts/tokens-hex.mjs --md` prints the table; with no flag it prints contrast). Everything is visible in both themes at `/styleguide` (dev only).

## 1. Principles

1. **One primary thing per page.** Each page has one job and at most one primary (teal) button.
2. **Warm, lit and colourful.** The base is a tinted warm dark, like a room under a lamp. Teal means *you* and *the action*, amber means *the coach*, and five kind hues mark people, topics, habits, promises and conversations everywhere.
3. **Soft surfaces, one level deep.** Panels are rounded and separated by tone and soft shadow. A panel never sits inside a panel. Hairlines appear only between rows inside a list.
4. **Plain words.** Sentence case, second person, short. No jargon, percentages or scores.
5. **Motion explains.** It shows what changed, came in or is alive. Animate only transform and opacity, for 150 to 350 ms, and respect reduced motion.
6. **Dark by default, light just as rich.** Light is a warm off-white with the same hues, chosen in Settings and stored in `localStorage["undertone-theme"]`.

## 2. Colour tokens

Use the Tailwind utilities (`bg-bg`, `bg-surface`, `bg-surface-2`, `text-fg`, `text-muted`, `text-accent`, `bg-accent`, `text-coach`, `border-line`, `text-person` …) or the CSS variables. Never write a raw colour in a page.

| Token | Use | Dark oklch | Dark hex | Light oklch | Light hex |
|---|---|---|---|---|---|
| `--bg` | Page background, under the ambient light | oklch(19% 0.018 55) | #1a120c | oklch(97% 0.012 80) | #f9f4ec |
| `--surface` | Panels, menus, dialogs | oklch(23.5% 0.02 55) | #261c15 | oklch(99.5% 0.005 80) | #fffdfa |
| `--surface-2` | Inputs, quiet buttons, tracks | oklch(28% 0.022 55) | #32261f | oklch(94.5% 0.014 80) | #f2ece3 |
| `--line` | Hairlines inside lists | oklch(33% 0.02 55) | #3e332c | oklch(90% 0.014 80) | #e3ddd4 |
| `--line-strong` | Control edges (3:1) | oklch(53% 0.02 60) | #756960 | oklch(62% 0.02 70) | #8e8479 |
| `--text` | Content | oklch(95% 0.012 80) | #f3eee6 | oklch(24% 0.02 55) | #271d16 |
| `--muted` | Meta lines, hints, idle nav | oklch(76% 0.02 70) | #baafa4 | oklch(47% 0.02 60) | #645850 |
| `--accent` | Teal: your moment, the action | oklch(78% 0.11 190) | #51cec7 | oklch(52% 0.1 192) | #007976 |
| `--on-accent` | Text on teal | oklch(21% 0.03 200) | #051c1e | oklch(99% 0.005 80) | #fefbf8 |
| `--coach` | Amber: the coach's voice, highlights | oklch(82% 0.12 72) | #f4b768 | oklch(54% 0.13 58) | #a55800 |
| `--danger` | Failed, or about to be destroyed | oklch(73% 0.15 28) | #f87f71 | oklch(53% 0.18 28) | #be3029 |
| `--warn` | Needs attention soon | oklch(85% 0.13 92) | #eccb61 | oklch(53% 0.12 85) | #886600 |

Derived values: `--accent-wash`, `--coach-wash` and `--danger-wash` (16% dark, 13% light mixed into transparent), `--hover`, `--focus` (= accent), `--shadow-panel`, `--shadow-lift`, `--shadow-float` and `--scrim`. The ambient background is two radial tints (teal top left, amber top right) plus a faint grain, and is set on `body`. Do not add more.

### Categorical palette (kinds)

The five hues share lightness and chroma (dark L 76% C 0.11, light L 53% C 0.13), so none dominates. They are the same in dots, avatars, graph nodes and chips. The phone app copies these exactly.

| Kind | Hue | Icon (lucide) | Dark oklch | Dark hex | Light oklch | Light hex |
|---|---|---|---|---|---|---|
| `--kind-person` | 20 | `User` | oklch(76% 0.11 20) | #ef9494 | oklch(53% 0.13 20) | #aa474c |
| `--kind-topic` | 100 | `Hash` | oklch(76% 0.11 100) | #c1b35b | oklch(53% 0.13 100) | #7b6c00 |
| `--kind-habit` | 140 | `Repeat` | oklch(76% 0.11 140) | #8bc27f | oklch(53% 0.13 140) | #3e7d2f |
| `--kind-promise` | 245 | `Handshake` | oklch(76% 0.11 245) | #72b8f2 | oklch(53% 0.13 245) | #0a71b1 |
| `--kind-conversation` | 305 | `MessagesSquare` | oklch(76% 0.11 305) | #c19fe9 | oklch(53% 0.13 305) | #7e55a7 |

Contrast: every text token is AA (4.5:1) on `--bg` and `--surface` in both themes. The tightest are light `kind-habit` at 4.60 and light `kind-topic` at 4.81. On-accent on accent is 9.20 in dark and 5.09 in light.

## 3. Type

- **Inter** (400, 500) for everything. **Newsreader** (400) only for the coach's voice: the coach's sentences, the hero headline and `Prose`. No monospace, no small caps, no all-caps labels. Numbers use tabular numerals (`.tabular`).
- Five sizes:

| Role | Size / line | Weight | Class |
|---|---|---|---|
| caption | 13 / 18 | 400, 500 | `qi-caption`, `text-caption` |
| body | 15 / 24 | 400, 500 | `qi-body`, `text-body` |
| lead | 17 / 26 | 400 | `qi-lead`, `text-lead` |
| title | 22 / 28 | 500 | `qi-title`, `text-title` |
| display | 32 / 38 | 500 (Inter) or 400 (Newsreader) | `qi-display`, `text-display` |

- Headings use sentence case and `text-wrap: balance`.

## 4. Space, shape, depth

- Spacing: `--gap-tight` 8, `--gap-group` 16, `--gap-section` 40 (56 from 640 px), `--gutter` 16 (32 from 640 px), `--pad-panel` 20 (24 from 640 px).
- Columns: `--col-reading` 720, `--col-wide` 1040.
- Radius: controls 10 (`rounded-control`), floating layers 12 (`rounded-float`), panels 16 (`rounded-panel`), dialogs 20.
- Depth: page, then panel (surface plus `--shadow-panel`), then float (menus, popovers, dialogs, `--shadow-float`). That is the whole stack.

## 5. Shell

Five destinations, nothing else in the nav:

| Destination | Route | Icon |
|---|---|---|
| Home | `/` | House |
| Insights | `/insights` | Waypoints |
| Conversations | `/conversations` | MessagesSquare |
| Coach | `/coach` | Feather |
| Settings | `/settings` | Settings2 |

- Insights holds the graph and the reports by person, topic, habit and promise.
- Old routes highlight their new home until the page builders redirect them: `/debrief` goes to Conversations; `/studio` and `/live` go to Coach; `/pair` and `/calibration` go to Settings.
- From 640 px the shell is one row: the wordmark, the nav with icons and labels, and the status. Below 640 px the wordmark and status sit on row one and the nav on row two. There only the current destination shows its label; the others are 40 px icon buttons with accessible names. The current item sits on a soft pill that springs between items (`layoutId`).
- **One status indicator.** The `ListeningMark` and one word: Listening, Not listening, Offline or Connecting. Hover or tap shows the band and the phone in plain sentences and an "Open settings" link. It shows no numbers, ids or latency.

## 6. Primitives (`dashboard/components/ui`, import from `@/components/ui`)

| Primitive | Use it for |
|---|---|
| `Page` | Every page: title, optional lede, optional single action, width `reading` or `wide`. |
| `Section` | A titled group in a page (17/500, optional icon and aside). No rules between sections. |
| `Panel` | The one surface. Tone `default`, `coach` (amber tint) or `moment` (teal tint). Padding `normal`, `list` or `none`. With `href` it lifts on hover. Never nest. |
| `CoachNote` | The coach speaking: an amber panel with a Feather head and Newsreader body. |
| `Prose` | Newsreader text for the coach's voice, in body, lead or display size. `<mark>` highlights a phrase in teal. |
| `Avatar` | Coloured initials for a person (person hue), for you (teal) or for the coach (amber). |
| `KindDot`, `KindChip` | Mark a thing by kind with its hue and icon. Chips can link. |
| `ListeningMark` | The signature: a breathing teal orb. Use it in the shell status (`sm`) and on empty states and the hero (`lg`). States: listening, idle, offline. |
| `ShareBar` | Who talked how much: your share in teal against theirs. It shows no percentage text. |
| `PaceBar` | Where a value sat against a comfortable zone. A marker runs along a track with a green zone. |
| `Sparkline` | A small trend line with a soft fill in a kind or accent hue, drawn in on mount. |
| `Button` | Variants `primary` (teal, one per view), `quiet` (default), `ghost` and `danger`, in default or small size. It supports `loading`, `iconOnly` and `href`, and `disabled` sets `aria-disabled`. |
| `TextLink` | An inline link with a teal underline. |
| `Input`, `Textarea` | Fields with label, hint and error, wired to `aria-describedby`. |
| `List`, `ListRow` | Lists of things: a row has a title, a meta line, leading and trailing content, an optional href or onSelect, and `current`. List items stagger in. |
| `EmptyState` | No data or a failed load: the listening mark, one sentence, at most one action. |
| `InlineStat` | A number that rolls when it changes (NumberFlow), with a label, coloured by tone or kind. |
| `StatusWord` | A dot and a word for a state (neutral, quiet, moment, coach, warn, error). |
| `Disclosure` | Detail the reader can open; it is closed by default. |
| `Tabs`, `SegmentedControl` | Switch views in one place, or pick one of a few values. |
| `Menu` | Secondary actions behind an Ellipsis. Danger actions come last. |
| `Dialog` | Confirm something destructive, or a short focused task. |
| `Tooltip`, `Popover` | A short label, or a small panel opened on hover or tap. |
| `toast` | Confirm an action ("Saved", "Deleted") or report a failure in one line. |
| `Skeleton` | A loading placeholder shaped like the content. |
| `PatternMark` | Shows a buzz as dashes (long and short, strong is thicker). It is never notation. |
| `ThemeToggle` | Dark or light; it belongs in Settings. |

Base UI powers Dialog, Menu, Tooltip, Popover, Tabs, Toggle and Collapsible. Icons come from lucide-react with `ICON` (stroke 1.5, 18 px).

## 7. Motion (`dashboard/lib/motion.ts`)

- Durations: fast 150 ms, base 220 ms, slow 320 ms.
- Easings: out `cubic-bezier(.23,1,.32,1)`, in-out `cubic-bezier(.77,0,.175,1)`, plus a CSS `linear()` spring (`--ease-spring`) and `SPRING` for motion.
- Animate transform and opacity only. Exits are faster than entries.
- Patterns:
  - List stagger: 40 ms apart, at most 8 items.
  - Panels, menus and dialogs scale in from 0.95 with the spring.
  - Numbers roll up.
  - Interactive panels lift by 2 px on hover.
  - Buttons press to 0.97.
  - The listening mark breathes.
- Libraries: use `motion/react` (`LazyMotion` with `m.*`, from `MotionProvider` in the shell) for React state. Use animejs v4 for imperative SVG (sparkline draw-in, buzz replay). Never use both on one element.
- Reduced motion: `MotionConfig reducedMotion="user"`, `motionPresets(reduced)`, and a CSS block that removes transforms and stops the breathing.

## 8. Remove list

- No music notation, staffs, notes or tempo marks.
- No percentages, scores, latency, ids or dBFS.
- No jargon: bus, rule, source, mock, sample, feed state, Director.
- No small caps or all-caps labels, no monospace.
- No gradient text, purple or indigo gradients, glassmorphism or emoji.
- No nested panels, and no rules between sections.
- No takeover banners with numbers.

## 9. Copy

Plain, short, second person, sentence case. Say what happened and what to do next.

- Good: "Your phone isn't connected, so nudges can't reach you." Bad: "Device link: 0/1".
- A button names its action ("Save changes"), and the toast reuses that verb ("Saved").
- Errors don't apologise and are never vague.

## 10. Compatibility (temporary)

- `dashboard/app/legacy.css` maps the old Tempo names to Lamplight so the pages that have not been rebuilt still compile and look coherent:
  - Variables: `--paper`, `--well`, `--ink*`, `--rule*`, `--them`, the pattern hues, `--state-*`, `--s-1..9`, `--r-*`, `--ease-*`, `--dur-*` and `--k-*`.
  - Classes: `.label`, `.num*`, `.display-*`, `.text-*`, `.btn*`, `.field`, `.chip`, `.state*`, `.graph-*` and others.
  - Delete each alias as the pages stop using it.
- `components/glyph.tsx` is a shim over `PatternMark`.
- `components/shell.tsx` still exports `clock()` and `TAKEOVER_MS` for `components/live` and the debrief.
- The shell no longer has the live Start and Stop. The Coach (rehearse) builder must add `send({cmd:'start', mode})` and `send({cmd:'stop'})` to its page.
