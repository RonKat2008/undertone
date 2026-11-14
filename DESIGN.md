# Undertone Design System

## Research Findings

### 1. The Tells of AI-Generated UI ("AI Slop")
AI code-generation tools naturally gravitate to the statistical "middle" of modern web design, resulting in a homogenized aesthetic often referred to as "AI slop." Key tells include:
*   **The Palette:** An over-reliance on purple-to-blue or pink-to-cyan gradients used as background washes, text fills, or glowing button accents.
*   **Glassmorphism for Decoration:** Gratuitous use of frosted glass (`backdrop-filter: blur()`) panels with glowing 1px cyan/white borders over complex mesh gradients, used purely for decoration rather than functional layering.
*   **The Cardocalypse:** Heavy nesting of uniform rounded cards within other rounded cards, each with identical padding, drop shadows, and pill-shaped badges.
*   **Predictable Layouts:** The inescapable 3-column feature grid centered under a hero section featuring a bold gradient headline ("Unlock your potential") and two pill buttons.
*   **Typographic Monotony:** Exclusively using Inter or similar system sans-serifs with no typographic scale or tension. Every element carries the same visual weight.
*   **Superfluous Elements:** Emoji as icons, sparkle icons for any "smart" feature, ambient floating glowing orbs, decorative left-border color accents, and animation applied to everything without reason.

### 2. How Authored Design is Made
To avoid the "AI slop" aesthetic, Undertone draws from rigorous, opinionated design traditions:
*   **Swiss / International Typographic Style:** Uses the grid not just as a container, but as an engine for dynamic, asymmetrical balance. It relies on flush-left, ragged-right text, generous proportional margins, and structural white space. Hierarchy is established through pure typographic scale and weight rather than decorative rules.
*   **Editorial & Print Layout:** Mimics the pacing of a physical magazine or annotated manuscript. It uses hierarchy by scale, strong margins, hairline rules, pull quotes, and marginalia. Elements break the grid intentionally for depth.
*   **Dieter Rams' Principles:** "Good design is as little design as possible." Stripping away the non-essential so the core function speaks clearly.
*   **Edward Tufte (Data-Ink):** Maximizing the "data-ink ratio." Eliminating chartjunk. Using sparklines (word-sized graphics) and small multiples to allow easy comparison of dense information over time (e.g., voice, volume, and hand energy).
*   **Music and Dance Notation:** Translating 4D temporal events (speech, movement) into 2D spatial layouts. The UI acts as a graphical score for a conversation, where time moves horizontally and intensity moves vertically.
*   **Audio-Hardware Interfaces (Teenage Engineering):** Immediate tactile-visual connection. Minimalist but dense information design. Color used functionally (coding parameters) rather than just aesthetically. Playful, constrained UI that acts as a tangible instrument rather than an abstract admin dashboard.

### 3. Real References
We borrow principles from strong point-of-view design:
1.  **Klim Type Foundry / Dinamo:** Impeccable digital typography presentation; dramatic scale contrast between massive display type and crisp technical data. *(Borrow: Type scale extremes and rigorous baseline alignment.)*
2.  **Teenage Engineering (OP-1 / OP-Z):** Using stark, saturated semantic colors against stark backgrounds to represent distinct parameters; playful, constrained, specific visual metaphors. *(Borrow: Glyph notation and semantic haptic colors.)*
3.  **SiteInspire / Minimal Gallery:** Editorial web design emphasizing asymmetry, structural white space, and zero unnecessary decoration. *(Borrow: Generous margins and off-center focal points.)*
4.  **Edward Tufte's Books:** The use of marginalia for annotations alongside the main text. *(Borrow: The live judge verdicts placed in the margin beside the transcript.)*
5.  **AIGA Eye on Design:** Bold use of hairline rules to divide space without boxing content into cards. *(Borrow: Hairline rules instead of card shadows.)*
6.  **Mobbin:** Dense UI research cataloging that prioritizes the artifact over the container. *(Borrow: The "un-designed" feel where the data is the design.)*

---

## "Never" List (Verification Rules)
If a screen violates any of these, it fails verification.
- [ ] No purple-to-blue or cyan-to-pink gradients.
- [ ] No glassmorphism (frosted glass blur) used for decoration.
- [ ] No rounded cards with drop shadows acting as generic containers.
- [ ] No 3-column uniform feature grids.
- [ ] No gradient text.
- [ ] No emoji as icons; no generic "sparkle" icons.
- [ ] No placeholder copy ("lorem ipsum" or "Unlock your potential").
- [ ] No continuous, idle looping animations (other than live indicators/recording dots).
- [ ] No unmotivated decorative color (color must carry specific meaning).
- [ ] No Inter/system default fonts.
- [ ] No text centered for layout padding; use purposeful alignment (flush-left).

---

## "Always" List (Principles)
- **Data is the design.** (Reason: The score is what matters; the UI just holds it.)
- **Hierarchy through extreme scale.** (Reason: Display elements must be legible from across a room during a demo, while technical details remain quiet.)
- **Semantic color only.** (Reason: A color means a specific pattern or speaker; it never decorates.)
- **Editorial spacing.** (Reason: We are typesetting a manuscript, not building an admin dashboard.)
- **Describe behavior, never the person.** (Reason: Coaching must remain objective and actionable.)

---

## The System

### Concept: A Score for a Conversation
The dashboard is the printed score (Paper); the phone is the metronome in your pocket (Ink).

### Color Tokens
Colors are defined in OKLCH for perceptual uniformity and mapped to Tailwind.
*   **Paper (Dashboard bg):** Warm off-white (`oklch(0.98 0.01 90)`)
*   **Paper-Well (Dashboard wells):** Slightly darker paper (`oklch(0.96 0.01 90)`)
*   **Ink (Dashboard text, Mobile bg, "Me"):** Near-black (`oklch(0.15 0.01 270)`)
*   **Ink-Mid (Secondary text):** Mid-grey (`oklch(0.5 0.0 0)`)
*   **Hairline Rules:** Very faint ink (`oklch(0.9 0.0 0)`)
*   **Other (The other speaker):** Quiet warm grey (`oklch(0.6 0.02 60)`)

**Semantic Pattern Colors:**
*   `interrupt`: Vermilion (`oklch(0.6 0.2 25)` / Hex: `#E03C31`)
*   `wrap_up`: Amber (`oklch(0.7 0.18 70)` / Hex: `#D97706`)
*   `filler`: Ochre (`oklch(0.75 0.15 85)` / Hex: `#B48A14`)
*   `slow_down`: Blue (`oklch(0.6 0.15 250)` / Hex: `#2563EB`)
*   `still`: Violet (`oklch(0.6 0.15 300)` / Hex: `#7C3AED`)
*   `success`: Green (`oklch(0.65 0.15 150)` / Hex: `#16A34A`)
*   `tap` / `approve`: Ink (`oklch(0.15 0.01 270)` / Hex: `#111827` or Paper `#FAFAFA` on mobile)

*Note: For React Native, fallback to the Hex codes provided.*

### Type Scale
*   **Instrument Serif:** Display typography, massive nudge messages.
*   **Geist:** UI text, labels, general copy.
*   **Geist Mono:** Tabular-nums for ALL numbers, latency, confidence, timers.

### Spacing Rhythm & Layout
*   Use a rigid baseline grid.
*   Employ asymmetric, editorial columns (e.g., wide center for transcript, narrow margins for verdicts).
*   Separate sections with hairline rules, never with boxed cards.
*   Use generous margins (like a printed book).

### Motion Rules
*   Animate only `transform`, `opacity`, and `clip-path`.
*   Motion explains what just happened (e.g., the rhythm of a haptic tap).
*   Respect `prefers-reduced-motion` (glyphs show static states).

### Glyph Spec
Every pattern has a visual notation mapping rhythm to physical layout.
Bars sit on a baseline. Width = duration. Height = intensity. Gap = silence between taps.

*   `tap`: 1 short, low bar.
*   `interrupt`: 2 tall, narrow bars, close together.
*   `filler`: 1 medium bar.
*   `wrap_up`: 3 bars stepping up in height.
*   `slow_down`: 1 long wedge rising slowly.
*   `still`: 2 wide, low, rounded bars, far apart.
*   `success`: a low bar then a tall bar.
*   `approve`: 2 tiny ticks.
*   `status_good`: 1 long, medium bar.
*   `status_talking`: 2 long, medium bars.
*   `status_ask`: 3 long, medium bars.

### Do / Don't Examples
*   **Do:** Place the transcript flush left, using indentation for the other speaker.
*   **Don't:** Put speaker turns in chat bubbles like iMessage.
*   **Do:** Show "315 ms" in Geist Mono next to a judge verdict.
*   **Don't:** Add a "latency" label with a clock emoji.
*   **Do:** Display a full-width vermilion banner dropping in for an `interrupt` nudge.
*   **Don't:** Use a standard toast notification with a drop shadow.
