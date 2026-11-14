/swarm Build the complete visual UI for "Undertone" — a Next.js web dashboard and an Expo iPhone app — running entirely on mock data. Look and feel only. No backend, no networking, no real haptics.

**Where to work.** The workspace is the root of the `undertone` repository (the folder that contains `plan.md`, `AGENTS.md` and `contracts/`). Create and build inside exactly two folders: `dashboard/` (the website) and `mobile/` (the iPhone app), plus one file at the root, `DESIGN.md`. Everything else in the repository is read-only for you.

**How to work.** Start now and run to the end without asking me questions. When something is ambiguous, choose the option that best serves the two-minute demo, note the choice in the final report, and keep going. Order: research the design (section 4), build the foundation, fan out, verify, report.

## 1. What Undertone is

Undertone is a speech coach you wear in real conversations. A wristband hears how you talk and senses how your hands move. An AI judge scores every turn of the conversation. The moment you slip — you interrupt, ramble, say "like" too much, fidget while the other person talks — your iPhone gives you a distinct haptic tap, and a live screen shows why. Afterwards you get a short debrief. You can also build your own coach by typing one sentence ("Stop saying 'like' and sound confident in case interviews").

This UI will be shown on a projector to hackathon judges in a two-minute live demo. It has to be the most memorable screen in the room: confident, specific, obviously designed by someone with a point of view. It must not look like a dashboard template.

## 2. Read first

- `AGENTS.md` (repo root) — ownership rules. You own `dashboard/` and `mobile/` only. Never touch `backend/`, `sdk/`, `scripts/`, `fixtures/`, `contracts/`, `plan.md`, `.env`.
- `contracts/events.ts` — the exact shape of every event the UI will ever receive. Copy this file unchanged to `dashboard/lib/bus/contracts.ts` and `mobile/src/bus/contracts.ts`. Do not edit the copies or invent event shapes.
- `plan.md` sections 4, 5 and 9 — what each feature does and the demo script the screens must serve.

Every worker brief you write must cite `AGENTS.md`, `DESIGN.md` and the contracts file, because workers start with a clean context.

## 3. Scope: the look, on fake data

**In scope:** every screen below, fully designed, animated and interactive, driven by a scripted mock event feed.

**Out of scope — do not build:** WebSocket or HTTP clients, real pairing, camera access, real haptics, audio recording, authentication, any API route, any database, tests beyond type checks, Android, the stretch features (memory graph, approvals).

**The seam.** Another engineer will connect the live system after you finish, by replacing exactly these stubs. Create them, keep them tiny, and do not implement them:

| File | What you write |
|---|---|
| `dashboard/lib/bus/socket-source.ts` and `mobile/src/bus/socket-source.ts` | Export the same `BusSource` interface as the mock source; body throws `new Error('not wired yet')` |
| `dashboard/lib/api/client.ts` and `mobile/src/api/client.ts` | Typed async functions (`listCoaches`, `buildCoach(goal)`, `buildPersonalCoach`, `saveCoach`, `activateCoach`, `startSession`, `stopSession`, `addBookmark`, `swapSpeakers`, `createPairing`, `listDevices`, `listApps`, `approveApp`, `revokeApp`, `getDebrief`, `listSessions`, `getProfile`, `getMissionToday`, `chooseMission`, `getStreak`, `listPeople`, `tagPerson`, `getWeeklyReport`) that return realistic canned data after a short delay. `buildCoach` takes about 2.5 s so the "generating" state is visible |
| `mobile/src/haptics/player.ts` | `export function play(pattern: HapticPattern): void` — a no-op. The screen animation is the only feedback for now |

All UI state comes from one place per app: a `useBus()` hook backed by a pure reducer that folds `BusEvent`s into view state. Components never read the mock directly. `useBus()` uses the mock source unless `NEXT_PUBLIC_BUS_URL` (web) or `EXPO_PUBLIC_BUS_URL` (mobile) is set.

**The mock feed** is a scripted, looping, roughly 90-second session that follows the demo script: session starts → a believable consulting case-interview conversation with real sentences (never lorem ipsum) → the wearer interrupts (`interrupt` nudge) → monologues (`wrap_up`) → fillers climb (`filler`) → fidgets while listening (`still`) → one good moment (`success`) → session ends → debrief arrives. It also includes one single tap answered by `status.reply` (two buzzes, talking too much), one promise that creates an automatic bookmark ("I'll send you the deck"), one `nerves` signal and one `checked_out` signal. It emits `transcript.partial`, `turn.final`, `judge`, `metrics` every second (including volume, hand energy and baseline pace), `motion`, `signal`, `nudge` (with `budget_left` counting down from 5), `bookmark`, `band.status`, `device.status`, `session.*`, `debrief` with correct shapes and plausible numbers (judge latency 150–260 ms, nudge latency 600–1800 ms).

Add a hidden **director panel** (toggle with the backtick key on web, a three-finger tap on mobile): buttons to start/stop the session, fire each nudge and each "How am I doing?" reply, add a bookmark, raise a `nerves` or `checked_out` signal, change motion state, and jump to the debrief. It is how you will verify the screens and how the team rehearses.

## 4. Design: research first, then commit

### 4a. Research before any code — the first job, done by `@foundation`

The single worst outcome is a UI that looks AI-generated. Before designing anything, spend real effort (roughly 15–20 minutes, using web search and the browser) studying what makes interfaces look machine-made and what makes them look authored. Write the findings as the first section of `DESIGN.md`.

Research three things:

1. **The tells of AI-generated UI.** Find current write-ups and examples of "AI slop" design and list the specific tells. Start from these and confirm, extend or correct them: purple-to-blue gradients; glassmorphism cards on a dark background; a centred hero with a gradient blob and a pill button; uniform rounded cards in an even grid with identical padding and shadows; Inter or system fonts used by default; emoji as icons; a sparkle icon for anything "AI"; a coloured left-border accent on cards; three-column feature grids; every element the same visual weight; decorative colour with no meaning; animation on everything; filler copy ("Unlock your potential"); dashboards built as sidebar + stat cards + a chart.
2. **How authored design is made.** Read about, and look at real examples of: Swiss / International Typographic Style (grid, asymmetry, type as structure); editorial and print layout (hierarchy by scale, margins, rules, pull quotes, marginalia); Dieter Rams' ten principles ("as little design as possible"); Edward Tufte on data-ink, sparklines and small multiples; music and dance notation as information design (this product's concept is a score); and instrument and audio-hardware interfaces (Teenage Engineering is a useful reference for playful precision). Capture what each one would change about this UI.
3. **Real references.** Look at 6–10 real, well-regarded sites or products with a strong point of view (editorial sites, type foundries, design studios, well-made tools). For each, note one specific thing worth borrowing — a layout move, a type treatment, a way of showing live data. Borrow principles, never copy a layout or a brand.

Then write, in `DESIGN.md`:

- **"Never" list:** the AI tells, as checkable rules.
- **"Always" list:** the principles this UI follows, each with a one-line reason.
- **References:** the sites studied and what was taken from each.
- **The system:** tokens, type scale, spacing rhythm, motion rules, the glyph spec, do/don't examples.

`@verifier` checks every screen against the "Never" list. One hit fails the screen.

### 4b. The starting direction

This is the direction to build from. The research should sharpen it and may change details where you find something better. It may not dilute it into something safer or more generic. Every component follows `DESIGN.md`.

**Concept: a score for a conversation.** A musician reads a score; Undertone writes one for how you speak. The dashboard is the printed score, the phone is the metronome in your pocket.

**The signature idea — haptic glyphs.** Each of the eleven haptic patterns has a visual notation that draws its rhythm: bars on a baseline, where width is duration, height is intensity, and spacing is the gap between taps.

| Pattern | Feel | Glyph |
|---|---|---|
| `tap` | 1 light tick | one short, low bar |
| `interrupt` | 2 sharp heavy taps | two tall, narrow bars, close together |
| `filler` | 1 short medium | one medium bar |
| `wrap_up` | 3 rising taps | three bars stepping up in height |
| `slow_down` | long soft ramp | one long wedge rising slowly |
| `still` | 2 soft slow pulses | two wide, low, rounded bars, far apart |
| `success` | bright double | a low bar then a tall bar |
| `approve` | 2 selection ticks | two tiny ticks |
| `status_good` | 1 slow, even buzz | one long, medium bar |
| `status_talking` | 2 slow, even buzzes | two long, medium bars |
| `status_ask` | 3 slow, even buzzes | three long, medium bars |

The last three are the phone's answers to a single tap on the band, "How am I doing?": 1 = good, 2 = talking too much, 3 = ask a question. They read as a count, visibly slower and more even than the nudges.

Build one `Glyph` component per platform (SVG on web, `react-native-svg` on mobile) with a static state and a `playing` state that animates the bars in the pattern's real rhythm. The glyph appears everywhere a pattern is mentioned: the nudge takeover, rule editors, the nudge log, the pattern tester, the phone's live screen. It is the brand.

**Dashboard: "paper".** Warm off-white paper, near-black ink, generous margins, the feel of an annotated manuscript rather than an admin panel.

- Colour (define as CSS custom properties in OKLCH, then map into Tailwind): paper, a slightly darker paper for wells, ink, a mid ink for secondary text, hairline rules. Then one **semantic colour per pattern**, used only to mean that pattern: `interrupt` vermilion, `wrap_up` amber, `filler` ochre, `slow_down` blue, `still` violet, `success` green, `tap` and `approve` ink. The wearer ("me") is ink; the other person is a quiet warm grey. Colour is never decoration.
- Type: **Instrument Serif** for display and for the nudge message; **Geist** for interface text; **Geist Mono** with tabular figures for every number, latency and confidence. Big scale contrast: the pace number and the nudge message are huge, labels are small caps and small.
- Layout: editorial, not a card grid. No uniform rounded cards with shadows. Use rules, columns, margins and scale.
- Texture: a faint paper grain is welcome. No gradient blobs, no glassmorphism, no neon, no purple-on-dark.

**Phone: "ink".** The same system inverted: near-black background, paper-coloured type, the same semantic colours. It lives in a pocket or on the table during a conversation, so it is calm, dark and glanceable, with very large touch targets.

**Motion.** Motion explains what just happened. Animate only `transform`, `opacity` and `clip-path`. Respect `prefers-reduced-motion` (web) and the reduce-motion setting (mobile): glyphs still show, they just don't animate. No scroll-jacking, no idle animation loops except the live indicators.

**Quality bar.** Designed hover, focus-visible and pressed states on every control. WCAG AA contrast. Keyboard reachable. No emoji as icons. No placeholder text. Explicit dimensions on media so nothing shifts.

## 5. Dashboard screens (`dashboard/`, Next.js App Router, TypeScript, Tailwind)

Design for a 1440-wide projector first, then 1024, then make 768 and 390 not break (no horizontal scroll).

**Shell.** A slim masthead: the Undertone wordmark, the active coach's name, band status (connected, battery, a blue dot when the mic is on — the real band's light is solid blue while listening), phone status, session clock, a Start/Stop control. Navigation between the five screens is quiet.

**Live — the hero screen.** This is 80% of the demo. Compose it as a page of a score:

- **The spine:** a full-width talk-ratio bar across the top, ink for "me" against grey for "them", the percentage in large mono figures, a hairline marking the coach's target. It moves smoothly as metrics arrive.
- **The timeline:** a thin strip under it for the whole session, with turn blocks coloured by speaker, interruption ticks, bookmarks, and a small glyph at each nudge.
- **The script (centre column):** the live transcript set like a play script. The wearer's turns flush left in ink, the other person's indented in grey. The current partial transcript types in at the bottom. Filler words in the wearer's turns are underlined in the `filler` colour.
- **The margin notes:** beside each wearer turn, the judge's verdicts as marginalia — small tags such as "interrupted 0.91", "hedging 0.84", "tone: nervous", "clarity 2.4/5" — with the confidence in mono, and a small "decisions · 212 ms" or "rules" source mark. Low-confidence answers are visibly fainter.
- **The instruments (right rail):** pace as one very large number with a small rolling sparkline and a band showing the wearer's own usual pace; volume as a quiet / ok / loud reading against their own baseline; fillers per minute; questions asked; interruptions; and a monologue timer that warms toward amber as it nears the limit.
- **The hand-energy meter:** a required, prominent instrument. One continuous reading from frozen, through natural gesturing, to overdoing it, with the comfortable middle marked, a short live trace, the current state (still / gesture / fidget) and who was speaking.
- **Focus and budget:** the coach works on one habit per conversation and has a small budget of buzzes (five by default). Show the focus habit by name with its glyph, and the budget as five marks that are spent one by one. Slips on other habits appear as quiet marks in the margin, with no takeover. Show the mode (Regular or Practice).
- **Signals:** when a `nerves` signal (hands froze and pace jumped) or a `checked_out` signal (still hands, no questions while they talk) arrives, mark it on the timeline and note it in the margin, calmly. It is an observation, not an alarm.
- **"How am I doing?":** when a `status.reply` arrives, show the count glyph and its meaning briefly near the masthead. It is smaller than a nudge takeover.
- **The nudge takeover:** when a `nudge` arrives, a full-width band drops over the top of the page in the pattern's colour: the glyph plays its rhythm at large size, the message in big serif ("Let them finish"), and beneath it in mono the reason, the confidence and "slip → tap 1.2 s". It holds about 2.5 s, then folds into a one-line entry in a nudge log. This moment must be unmissable from the back of a room.
- **Idle state:** before a session, the page invites a double-tap on the band, with the active coach's rules listed as glyph + message.

**Studio — build a coach in one sentence.**

- A single large input, set in serif like a sentence being written: "I want to…", with three example goals as quiet suggestions.
- A generating state that feels like the coach being written: sections of the spec appear one after another.
- The result as an editable **coach sheet**: name and goal; the questions the judge will ask each turn (yes/no, choice, or score, shown differently); nudge rules as rows of *condition → glyph → message* with a per-rule toggle and a haptic picker that previews the glyph; a **focus habit** choice (exactly one rule buzzes per conversation; the rest are tracked silently) with a buzz budget and minimum gap; a sensitivity slider (maps to confidence threshold, show the number); keyterms and filler words as editable chips; the debrief rubric; the practice drill prompts.
- A prominent **Activate** action, and a library strip with the two prebuilt coaches (Interview, Listener), saved ones, and the **personal coach**: built from the wearer's own habit profile for practice mode, shown with their top crutch words and recurring issues and how each is trending.

**Debrief.** A composed page, like the closing pages of a report, in this reading order:

- The headline fact as a large serif sentence ("You asked Sam 0 questions about his trip").
- One specific strength, stated plainly.
- **One thing to fix**, given the most emphasis on the page, followed by the fix as an if-then plan set like a line to memorise ("When you hit thirty seconds, end with a question").
- The five numbers (talk ratio, interruptions, questions, fillers per minute, pace) set large in mono with small labels, and "vs last time" as a quiet comparison with the wearer's own past (handle `null`).
- An audio player, styled to match, for the 20-second spoken recap.
- **Voice and body timeline:** pace, volume and hand energy across the whole conversation as three aligned small-multiple traces on one time axis, with nudges, bookmarks and signals marked. Treat this as a designed chart, not a default chart-library plot.
- **Bookmark review:** each bookmarked moment with its transcript snippet, what happened, and any follow-up it implies ("Send Sam the deck"), distinguishing bookmarks tapped on the phone from promises caught automatically.
- Notes on what was discussed, and the full transcript, collapsed.
- The best-moment quote as a pull quote.
- "Hear the better version": the weakest answer beside its rewrite, with a play control (handle `null`).

Wording everywhere describes behaviour, never the person, and never compares the wearer with other people.

**Pair & devices.** A large QR code panel with a short pairing code beside it; the list of connected phones with live status; and **Connected apps** — third-party apps allowed to buzz the phone, each with name, last used, an approve or revoke control, and pending requests called out. Include a compact reference of all eleven glyphs with their meanings.

**Calibration.** Two short guided flows: *voice* ("say your name" → wearer identified, with a "swap speakers" control) and *motion* (hold still 5 s → gesture 5 s → fidget 5 s, each with a progress ring and a live motion trace), ending in a clear "calibrated" state.

## 6. Phone screens (`mobile/`, Expo with expo-router, TypeScript)

Target an iPhone at 390 × 844. Verify with Expo Web. Use `react-native-svg` and `react-native-reanimated`; no native modules that need a custom build.

The phone buzzes the nudges and is where the wearer reads the debrief and their history. Navigation: Today, Live, History, People, and a settings area holding Pattern tester and Connected apps.

- **Pair.** A viewfinder-style frame (a designed placeholder, no camera), "enter code instead", and a "use demo pairing" button that proceeds.
- **Today — the home screen.** The **daily mission**: one specific, slightly hard goal for today, written as an if-then plan ("When you finish a story, ask one open question"), with progress and two or three alternative missions the wearer can choose instead. A streak shown as the last seven days, counting days practised, with a gentle "freeze" that repairs a missed day; never a "you broke your streak" state. If a tagged person is coming up, their pre-meeting brief ("Last time you talked 70%. Ask about his trip").
- **Live — the metronome.** Almost empty by design: the active coach and focus habit, the mode, a connection dot, a session clock, the buzz budget as marks, and one very large glyph area in the centre. When a nudge arrives the whole screen takes the pattern's colour and the glyph plays its rhythm, with the message beneath in large serif; it then settles to "last nudge" with the time. A "How am I doing?" reply shows its count glyph and meaning. A large **Bookmark** button and a Start/Stop control at the bottom, both reachable by thumb.
- **Debrief.** A phone-sized version of the dashboard's debrief in the same reading order: headline, strength, the one fix with its if-then plan, the five numbers, play button, the three-trace timeline, bookmark review, notes. Ends with "tag who this was with".
- **History.** Past conversations as a list with date, person, coach, headline fact and the key numbers; and the weekly report: trends against the wearer's own baseline, best conversation, biggest improvement.
- **People.** Person cards: the wearer's pattern with each person ("You interrupt Alex 3× more than anyone") and the brief for next time.
- **Pattern tester.** All eleven patterns as large rows: glyph, name, what it feels like, what it means. Tapping one plays its animation (and calls `play()`).
- **Connected apps.** Who can buzz you: approve pending requests, revoke existing ones, with the source app shown on each recent buzz.

History, People, the streak and the weekly report run on sample data. Mark them with a small, designed "sample" label that one constant can switch off.

## 7. How to run this swarm

**Phase 1 — one worker, serial (`@foundation`).** Nothing else starts until it lands.
0. Do the design research in section 4a and write the first sections of `DESIGN.md`.
1. Create branch `ui`. Scaffold `dashboard/` with the current `create-next-app` (App Router, TypeScript, Tailwind, ESLint, npm) and `mobile/` with the current `create-expo-app` (expo-router, TypeScript). Each app has its own `package.json` and lockfile; do not create a root `package.json`.
2. Complete `DESIGN.md` (the system) from sections 4a and 4b.
3. Build the shared foundation in each app: tokens, fonts, the `Glyph` component with all eleven patterns, the contracts copy, the mock source, the reducer, `useBus()`, the seam stubs, the director panel, and the app shell with empty routes.
4. Post a screenshot of a **style tile** (palette, type scale, all eleven glyphs static and mid-animation, one nudge takeover) to the board. Continue without waiting unless I object.

**Phase 2 — parallel workers, each in its own working copy, at most six alive at once.** Suggested split; adjust if you see a cleaner one, but keep ownership disjoint:

| Worker | Owns |
|---|---|
| `@web-live` | `dashboard/app/(live)/**`, `dashboard/components/live/**` |
| `@web-studio` | `dashboard/app/studio/**`, `dashboard/components/studio/**` |
| `@web-pages` | Debrief, Pair & devices, Calibration routes and their component folders |
| `@mobile-live` | Pair, Today, Live, Pattern tester, Connected apps under `mobile/app/**`, each with its own component folder |
| `@mobile-review` | Debrief, History, People under `mobile/app/**`, each with its own component folder |
| `@verifier` | no source files; reviews, runs, screenshots |

Rules for workers:
- Shared files — `DESIGN.md`, tokens, `Glyph`, `lib/bus/**`, `src/bus/**`, `tailwind` and `next` config, `package.json`, lockfiles, the shell layout — belong to `@foundation` after Phase 1. A worker that needs a change there asks on the board; it does not edit them.
- A worker that needs a new dependency asks on the board first; one owner edits `package.json`.
- Dev servers: workers use ports 3001–3004 (web) and 8082+ (Expo Web). Only `@verifier` uses 3000 and 8081.
- Every worker lands its changes on `ui` before it is removed. Never remove a worker with unlanded work.
- Stay inside the screen list in sections 5 and 6. If something seems missing, note it in the final report instead of building it.

**Models.** Use the strongest available model for the coordinator, `@foundation` and `@verifier`; lighter, faster models are fine for the screen workers.

## 8. Verification — `@verifier` runs this, and a failed check is a failed change

1. `cd dashboard && npm run build && npm run lint && npx tsc --noEmit` — clean.
2. `cd mobile && npx tsc --noEmit && npx expo-doctor` — clean.
3. In the browser, open `http://localhost:3000` and, for **each** dashboard screen, take screenshots at 1440, 1024, 768 and 390 wide. For Live, capture: idle, mid-conversation, and during a nudge takeover (fire it from the director panel). For Studio: empty, generating, and the finished coach sheet.
4. Open Expo Web at a 390 × 844 viewport and screenshot every phone screen, including Live during a nudge and Today with a mission in progress.
5. Check each screenshot against `DESIGN.md` and send specific fixes back to the author: spacing and alignment, type hierarchy, colour used only semantically, no horizontal overflow, no clipped text, no console errors.
6. Let the mock session run through one full loop on the Live screen and confirm nothing stalls, overflows or grows without bound.
7. Turn on reduced motion and confirm every screen is still complete and legible.
8. Check every screenshot against the "Never" list in `DESIGN.md`. Reject anything that reads as a template or as AI-generated: uniform card grids, default component-library styling, a centred hero with a gradient, grey-on-white with one accent colour.
9. Read the copy on every screen. Reject filler text, anything that judges the person instead of describing behaviour, and any comparison with other people.

## 9. Done means

- All checks in section 8 pass on branch `ui`, committed. Do not merge to `main` and do not push.
- Both apps run with no environment variables set and play the mock session by themselves.
- Then stop. Do not start extra features.

**Final report to me**, as a walkthrough with the screenshots: what was built, the exact paths of the seam files, every dependency added, any deviation from this brief and why, and anything you judged missing.
