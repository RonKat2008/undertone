# DESIGN.md: Undertone, "Tempo"

> **DRAFT for human approval.** `AGENTS.md` makes `DESIGN.md` human-owned: agents propose, humans decide. This draft implements the approved direction, *Direction A "Tempo"*. It adds two borrowings: the VU-ballistics pace needle, and subtitle discipline with numbered transcript lines. Research, references and the audit of the current screens are in the design research note (`scratchpad/design/research.md`, not committed). Screenshots cited as `before/…png` are in that note's `before/` folder.
>
> Nothing in `dashboard/` or `mobile/` has changed yet. Section 12 lists what changes from `prompts/antigravity-swarm.md` §4b. Section 13 is the migration map for `dashboard/app/globals.css` and `mobile/src/ui/theme.ts`.

---

## 1. The one idea

**A conversation has a tempo, and you have a tempo marking.**

- Your usual pace is written at the top of every live page the way a composer writes ♩ = 160.
- The dashboard is the conductor's score being written as you speak: one stave per speaker, judge verdicts pencilled above, and every buzz written as rhythm notation on a percussion line underneath.
- The phone is the metronome in your pocket. Its pendulum stands still while you're inside your band, and it only swings when you rush.

Every decision below should trace back to this. If a choice could belong to any other app, it's wrong for this one.

**Voice.** The current copy voice is kept as it is: behaviour, never verdicts; your own past, never other people.

**Never:**
- gradients, glass or blur, blobs, emoji, sparkles;
- uniform rounded cards with soft shadows;
- a tracked-caps label on every block;
- decorative colour;
- centred heroes;
- stat tiles without a reference value;
- shadcn/ui or Lucide defaults (neither is installed; if added, restyle fully).

---

## 2. Colour

### 2.1 Rules

1. **Roles, not paint.** `--paper` is always the background surface and `--ink` is always the main foreground, in both themes. Dark mode redefines the values, not the names.
2. **A pattern hue means that pattern and nothing else.** Each hue below belongs to exactly the `HapticPattern`s listed against it in `contracts/events.ts`. It never marks:
   - connection, listening or "live";
   - errors;
   - improvement or worsening;
   - links, buttons, selection or focus.
3. **Each hue has three roles**, after Radix steps 3, 9 and 11:

   | Token | Role | Used for |
   |---|---|---|
   | `--{hue}-tint` | step 3 | highlighter wash behind a word, a selected rule row |
   | `--{hue}` | step 9, solid | glyph fill, takeover field, filler underline |
   | `--{hue}-text` | step 11 | labels and words in that pattern's colour; ≥ 4.5:1 on `--paper`, `--well` and its own tint |

   Text on a solid (the takeover) is always `--paper` and **must be ≥ 24 px**, the WCAG "large" threshold. Section 2.5 explains why.
4. **System states are neutral.** They use ink values plus shape and words (section 2.4).
5. **Dark is not neon on black.**
   - The background is blue-black `oklch(.18 .015 265)`, not `#000`.
   - Dark solids stay at chroma ≤ 0.15 and lightness .70–.80.
   - Saturated colour only ever appears at glyph size, or as the takeover field for 2.5 s.

### 2.2 Pattern → hue

| `HapticPattern` | Action shown | Hue token | Hue angle | Family |
|---|---|---|---|---|
| `interrupt` | Let them finish | `vermilion` | 30 | nudge |
| `filler` | Pause | `ochre` | 86 | nudge |
| `success` | That worked | `green` | 150 | nudge |
| `wrap_up` | Ask a question | `teal` | 200 | nudge. **Was `amber`**, 18° from ochre and indistinguishable at glyph size |
| `slow_down` | Slow down | `blue` | 255 | nudge: the one live buzz |
| `still` | Hands calm | `violet` | 305 | nudge |
| `status_good`, `status_talking`, `status_ask` | 1 / 2 / 3: "How am I doing?" | `pencil` | 60, low chroma | status. One family; the **count** is the meaning, so they share one hue and differ by glyph |
| `tap`, `approve` | Noted / waiting for approval | `rose` | 350, low chroma | system. Two quiet ticks, told apart by glyph |

**Decision for the humans: 8 hues for 11 patterns.** Eleven distinguishable, AA-passing hues don't exist on one paper. The status trio and the system pair each share a hue *within their family only*. No other pattern uses those hues.

The six nudges sit about 55° apart round the OKLCH wheel. `pencil` and `rose` are deliberately low-chroma so they never compete with a nudge.

### 2.3 Neutrals: names kept from the current `globals.css`

| Token | Use |
|---|---|
| `--paper` | page background |
| `--well` | slightly recessed surface: inputs, the metronome face, director panel |
| `--ink` | primary text, the wearer's stave and turns, rules that carry meaning |
| `--ink-2` | secondary text, the other person's turns, margin notes |
| `--ink-3` | tertiary text: line numbers, timestamps, low-confidence verdicts. **Passes AA as text now** (old `--ink-3` was 3.65:1) |
| `--rule` | decorative hairlines and stave lines (exempt from 3:1 because they carry no information alone) |
| `--rule-strong` | **new.** Interactive borders (inputs, keys) and any rule that carries meaning; ≥ 3:1 |
| `--them` | the other person's fill in the talk-ratio bar and staves; ≥ 3:1 as non-text |

Removed:
- `--mic`, because a blue mic dot collided with `slow_down`;
- `--amber`, `--amber-ink` and `--ochre-ink`, replaced by `--teal*` and `--ochre-text`.

### 2.4 System states: no pattern hue, ever

| State | Token | Shape / words |
|---|---|---|
| Listening (band mic on) | `--state-on: var(--ink)` | A filled ink dot inside a hollow ring. The ring "breathes": opacity .35 → 1 over 3.2 s, the only idle loop allowed. The word **Listening**. |
| Connected (band, phone) | `--state-on` | A filled dot and the device name. |
| Idle / not connected | `--state-off: var(--ink-3)` | A hollow ring, 1 px. |
| Offline / fault | `--state-fault: var(--ink)` | A dashed ring and the word **Offline**, set in `--ink` medium weight. No red, because red is `interrupt`. |
| Improvement / regression (History, debrief "vs last time") | inherits text colour | Old value in `--ink-3`, new value in `--ink`, joined by "→", plus a direction word: "9.1 → 5.0 fewer". **Never green.** A change under 3% gets the word "steady" and no arrow. |
| Sample data label | `--ink-2` | Small caps "sample" in a dashed 1 px `--rule-strong` box (unchanged). |
| Focus ring | `--ink` | 2 px solid outline, 2 px offset (unchanged). |

### 2.5 Token values, sRGB fallbacks and gamut

**Method.** Every value was computed OKLCH → linear sRGB (Björn Ottosson's matrices) → sRGB gamma → hex. Values outside sRGB were gamut-mapped by reducing chroma at constant L and h (CSS Color 4 style), and the table reports the clamped chroma. Contrast is the WCAG 2.x ratio of relative luminances. The generator script is `scratchpad/scripts/tokens.js` (input `tok2.json`).

**How the values ship:**
- **Web.** Write the tokens as `oklch()` in `:root`, plus a hex block for engines without OKLCH:
  ```css
  @supports not (color: oklch(0 0 0)) { :root { --paper: #F4F4EE; /* … */ } }
  ```
  Next 16 / Tailwind 4 and Safari ≥ 15.4 support `oklch()`.
- **P3 is an optional enhancement, not v1.** Every token is authored inside sRGB, so it renders identically everywhere. A later `@media (color-gamut: p3)` block may raise the *chroma only* of the six nudge solids by up to +0.04 at the same L, for the projector takeover. Keeping L fixed leaves WCAG contrast effectively unchanged, but re-run the script before shipping.
- **Mobile.** React Native gets the **hex** column; don't rely on `oklch()` parsing in RN.

**Out of gamut:** one value, light `--ochre-text`. Declared as `oklch(.47 .10 86)`, it ships as `oklch(.47 .096 86)` = `#735600`. Write the in-gamut value in CSS too.

**Light is the default theme** (`:root`).
- **Dark** applies under `:root[data-theme="dark"]`, and under `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`.
- **The phone app ships dark** (§9) because it lives in a pocket or face-down on a table. That's a product decision for the phone surface; it doesn't make dark the system default.

### 2.6 Token values (light = `:root`, dark = `[data-theme="dark"]` and the phone)

#### Light

| Token | OKLCH | sRGB hex fallback | Gamut |
|---|---|---|---|
| `--paper` | `oklch(0.965 0.007 100)` | `#F4F4EE` | in sRGB |
| `--well` | `oklch(0.935 0.009 100)` | `#EBEAE3` | in sRGB |
| `--ink` | `oklch(0.22 0.025 265)` | `#151A26` | in sRGB |
| `--ink-2` | `oklch(0.45 0.02 265)` | `#505561` | in sRGB |
| `--ink-3` | `oklch(0.52 0.015 265)` | `#656972` | in sRGB |
| `--rule` | `oklch(0.86 0.008 100)` | `#D2D1CB` | in sRGB |
| `--rule-strong` | `oklch(0.6 0.012 265)` | `#7D8088` | in sRGB |
| `--them` | `oklch(0.62 0.012 100)` | `#88867E` | in sRGB |
| `--vermilion-tint` | `oklch(0.93 0.035 30)` | `#FFE0DA` | in sRGB |
| `--vermilion` | `oklch(0.57 0.19 30)` | `#D03929` | in sRGB |
| `--vermilion-text` | `oklch(0.5 0.18 30)` | `#B32517` | in sRGB |
| `--ochre-tint` | `oklch(0.94 0.05 86)` | `#FAEAC6` | in sRGB |
| `--ochre` | `oklch(0.6 0.12 86)` | `#A07A0C` | in sRGB |
| `--ochre-text` | `oklch(0.47 0.1 86)` | `#735600` | out of sRGB: chroma 0.1 → 0.096 |
| `--green-tint` | `oklch(0.93 0.04 150)` | `#D6F0DA` | in sRGB |
| `--green` | `oklch(0.56 0.13 150)` | `#2D8949` | in sRGB |
| `--green-text` | `oklch(0.48 0.11 150)` | `#246E3A` | in sRGB |
| `--teal-tint` | `oklch(0.93 0.03 200)` | `#D2EEF0` | in sRGB |
| `--teal` | `oklch(0.56 0.09 200)` | `#188489` | in sRGB |
| `--teal-text` | `oklch(0.48 0.075 200)` | `#176A6E` | in sRGB |
| `--blue-tint` | `oklch(0.93 0.03 255)` | `#DBE9FC` | in sRGB |
| `--blue` | `oklch(0.52 0.15 255)` | `#1F68BC` | in sRGB |
| `--blue-text` | `oklch(0.47 0.14 255)` | `#155AA7` | in sRGB |
| `--violet-tint` | `oklch(0.93 0.035 305)` | `#EDE2FB` | in sRGB |
| `--violet` | `oklch(0.52 0.15 305)` | `#7D4DAD` | in sRGB |
| `--violet-text` | `oklch(0.47 0.14 305)` | `#6E4199` | in sRGB |
| `--pencil-tint` | `oklch(0.93 0.015 60)` | `#F0E6DE` | in sRGB |
| `--pencil` | `oklch(0.5 0.04 60)` | `#755E4C` | in sRGB |
| `--pencil-text` | `oklch(0.45 0.04 60)` | `#66503F` | in sRGB |
| `--rose-tint` | `oklch(0.93 0.03 350)` | `#F9E0EB` | in sRGB |
| `--rose` | `oklch(0.55 0.1 350)` | `#9D587A` | in sRGB |
| `--rose-text` | `oklch(0.48 0.1 350)` | `#874465` | in sRGB |

#### Dark

| Token | OKLCH | sRGB hex fallback | Gamut |
|---|---|---|---|
| `--paper` | `oklch(0.18 0.015 265)` | `#0E1218` | in sRGB |
| `--well` | `oklch(0.22 0.015 265)` | `#171B22` | in sRGB |
| `--ink` | `oklch(0.94 0.01 100)` | `#ECEBE4` | in sRGB |
| `--ink-2` | `oklch(0.76 0.012 265)` | `#ADB1B9` | in sRGB |
| `--ink-3` | `oklch(0.64 0.012 265)` | `#888C94` | in sRGB |
| `--rule` | `oklch(0.3 0.012 265)` | `#2B2E34` | in sRGB |
| `--rule-strong` | `oklch(0.52 0.012 265)` | `#656970` | in sRGB |
| `--them` | `oklch(0.5 0.012 265)` | `#60636A` | in sRGB |
| `--vermilion-tint` | `oklch(0.27 0.05 30)` | `#3B1C17` | in sRGB |
| `--vermilion` | `oklch(0.7 0.15 30)` | `#ED7665` | in sRGB |
| `--vermilion-text` | `oklch(0.76 0.13 30)` | `#F8907F` | in sRGB |
| `--ochre-tint` | `oklch(0.27 0.04 86)` | `#2F250E` | in sRGB |
| `--ochre` | `oklch(0.8 0.13 86)` | `#E3B750` | in sRGB |
| `--ochre-text` | `oklch(0.82 0.12 86)` | `#E7BE62` | in sRGB |
| `--green-tint` | `oklch(0.27 0.04 150)` | `#172C1C` | in sRGB |
| `--green` | `oklch(0.72 0.13 150)` | `#62BB78` | in sRGB |
| `--green-text` | `oklch(0.78 0.12 150)` | `#7CCD8E` | in sRGB |
| `--teal-tint` | `oklch(0.27 0.03 200)` | `#132B2C` | in sRGB |
| `--teal` | `oklch(0.74 0.09 200)` | `#5DBCC1` | in sRGB |
| `--teal-text` | `oklch(0.79 0.08 200)` | `#79CACF` | in sRGB |
| `--blue-tint` | `oklch(0.27 0.05 255)` | `#15273E` | in sRGB |
| `--blue` | `oklch(0.7 0.12 255)` | `#69A1E8` | in sRGB |
| `--blue-text` | `oklch(0.77 0.11 255)` | `#84B7F9` | in sRGB |
| `--violet-tint` | `oklch(0.27 0.05 305)` | `#2C203A` | in sRGB |
| `--violet` | `oklch(0.7 0.12 305)` | `#B08ADA` | in sRGB |
| `--violet-text` | `oklch(0.77 0.11 305)` | `#C4A2ED` | in sRGB |
| `--pencil-tint` | `oklch(0.27 0.015 60)` | `#2C251F` | in sRGB |
| `--pencil` | `oklch(0.74 0.035 60)` | `#BCA695` | in sRGB |
| `--pencil-text` | `oklch(0.8 0.03 60)` | `#CDBAAB` | in sRGB |
| `--rose-tint` | `oklch(0.27 0.03 350)` | `#322028` | in sRGB |
| `--rose` | `oklch(0.72 0.09 350)` | `#D08DAC` | in sRGB |
| `--rose-text` | `oklch(0.78 0.08 350)` | `#DFA3BF` | in sRGB |


### 2.7 Contrast: every text and non-text pair, computed
#### Light

| Foreground | Background | Use | Ratio | Needs | Pass |
|---|---|---|---|---|---|
| `ink` | `paper` | text | 15.67 | 4.5 | yes |
| `ink` | `well` | text | 14.33 | 4.5 | yes |
| `ink-2` | `paper` | text | 6.73 | 4.5 | yes |
| `ink-2` | `well` | text | 6.16 | 4.5 | yes |
| `ink-3` | `paper` | text | 4.98 | 4.5 | yes |
| `ink-3` | `well` | text | 4.56 | 4.5 | yes |
| `paper` | `ink` | text | 15.67 | 4.5 | yes |
| `vermilion-text` | `paper` | text | 5.94 | 4.5 | yes |
| `vermilion-text` | `well` | text | 5.44 | 4.5 | yes |
| `vermilion-text` | `vermilion-tint` | text | 5.29 | 4.5 | yes |
| `paper` | `vermilion` | large | 4.43 | 3.0 | yes |
| `vermilion` | `paper` | non-text | 4.43 | 3.0 | yes |
| `vermilion` | `well` | non-text | 4.05 | 3.0 | yes |
| `ochre-text` | `paper` | text | 6.22 | 4.5 | yes |
| `ochre-text` | `well` | text | 5.69 | 4.5 | yes |
| `ochre-text` | `ochre-tint` | text | 5.77 | 4.5 | yes |
| `paper` | `ochre` | large | 3.60 | 3.0 | yes |
| `ochre` | `paper` | non-text | 3.60 | 3.0 | yes |
| `ochre` | `well` | non-text | 3.29 | 3.0 | yes |
| `green-text` | `paper` | text | 5.61 | 4.5 | yes |
| `green-text` | `well` | text | 5.13 | 4.5 | yes |
| `green-text` | `green-tint` | text | 5.12 | 4.5 | yes |
| `paper` | `green` | large | 3.97 | 3.0 | yes |
| `green` | `paper` | non-text | 3.97 | 3.0 | yes |
| `green` | `well` | non-text | 3.63 | 3.0 | yes |
| `teal-text` | `paper` | text | 5.70 | 4.5 | yes |
| `teal-text` | `well` | text | 5.22 | 4.5 | yes |
| `teal-text` | `teal-tint` | text | 5.19 | 4.5 | yes |
| `paper` | `teal` | large | 4.04 | 3.0 | yes |
| `teal` | `paper` | non-text | 4.04 | 3.0 | yes |
| `teal` | `well` | non-text | 3.69 | 3.0 | yes |
| `blue-text` | `paper` | text | 6.23 | 4.5 | yes |
| `blue-text` | `well` | text | 5.70 | 4.5 | yes |
| `blue-text` | `blue-tint` | text | 5.62 | 4.5 | yes |
| `paper` | `blue` | large | 5.03 | 3.0 | yes |
| `blue` | `paper` | non-text | 5.03 | 3.0 | yes |
| `blue` | `well` | non-text | 4.60 | 3.0 | yes |
| `violet-text` | `paper` | text | 6.60 | 4.5 | yes |
| `violet-text` | `well` | text | 6.03 | 4.5 | yes |
| `violet-text` | `violet-tint` | text | 5.88 | 4.5 | yes |
| `paper` | `violet` | large | 5.34 | 3.0 | yes |
| `violet` | `paper` | non-text | 5.34 | 3.0 | yes |
| `violet` | `well` | non-text | 4.89 | 3.0 | yes |
| `pencil-text` | `paper` | text | 6.80 | 4.5 | yes |
| `pencil-text` | `well` | text | 6.22 | 4.5 | yes |
| `pencil-text` | `pencil-tint` | text | 6.10 | 4.5 | yes |
| `paper` | `pencil` | large | 5.48 | 3.0 | yes |
| `pencil` | `paper` | non-text | 5.48 | 3.0 | yes |
| `pencil` | `well` | non-text | 5.01 | 3.0 | yes |
| `rose-text` | `paper` | text | 6.25 | 4.5 | yes |
| `rose-text` | `well` | text | 5.72 | 4.5 | yes |
| `rose-text` | `rose-tint` | text | 5.56 | 4.5 | yes |
| `paper` | `rose` | large | 4.63 | 3.0 | yes |
| `rose` | `paper` | non-text | 4.63 | 3.0 | yes |
| `rose` | `well` | non-text | 4.24 | 3.0 | yes |
| `rule-strong` | `paper` | non-text | 3.57 | 3.0 | yes |
| `them` | `paper` | non-text | 3.29 | 3.0 | yes |
| `ink-3` | `paper` | non-text | 4.98 | 3.0 | yes |

#### Dark

| Foreground | Background | Use | Ratio | Needs | Pass |
|---|---|---|---|---|---|
| `ink` | `paper` | text | 15.79 | 4.5 | yes |
| `ink` | `well` | text | 14.54 | 4.5 | yes |
| `ink-2` | `paper` | text | 8.76 | 4.5 | yes |
| `ink-2` | `well` | text | 8.06 | 4.5 | yes |
| `ink-3` | `paper` | text | 5.59 | 4.5 | yes |
| `ink-3` | `well` | text | 5.15 | 4.5 | yes |
| `paper` | `ink` | text | 15.79 | 4.5 | yes |
| `vermilion-text` | `paper` | text | 8.32 | 4.5 | yes |
| `vermilion-text` | `well` | text | 7.66 | 4.5 | yes |
| `vermilion-text` | `vermilion-tint` | text | 6.78 | 4.5 | yes |
| `paper` | `vermilion` | large | 6.61 | 3.0 | yes |
| `vermilion` | `paper` | non-text | 6.61 | 3.0 | yes |
| `vermilion` | `well` | non-text | 6.08 | 3.0 | yes |
| `ochre-text` | `paper` | text | 10.72 | 4.5 | yes |
| `ochre-text` | `well` | text | 9.87 | 4.5 | yes |
| `ochre-text` | `ochre-tint` | text | 8.60 | 4.5 | yes |
| `paper` | `ochre` | large | 10.01 | 3.0 | yes |
| `ochre` | `paper` | non-text | 10.01 | 3.0 | yes |
| `ochre` | `well` | non-text | 9.21 | 3.0 | yes |
| `green-text` | `paper` | text | 9.84 | 4.5 | yes |
| `green-text` | `well` | text | 9.06 | 4.5 | yes |
| `green-text` | `green-tint` | text | 7.77 | 4.5 | yes |
| `paper` | `green` | large | 7.99 | 3.0 | yes |
| `green` | `paper` | non-text | 7.99 | 3.0 | yes |
| `green` | `well` | non-text | 7.36 | 3.0 | yes |
| `teal-text` | `paper` | text | 10.04 | 4.5 | yes |
| `teal-text` | `well` | text | 9.24 | 4.5 | yes |
| `teal-text` | `teal-tint` | text | 7.95 | 4.5 | yes |
| `paper` | `teal` | large | 8.46 | 3.0 | yes |
| `teal` | `paper` | non-text | 8.46 | 3.0 | yes |
| `teal` | `well` | non-text | 7.79 | 3.0 | yes |
| `blue-text` | `paper` | text | 9.09 | 4.5 | yes |
| `blue-text` | `well` | text | 8.37 | 4.5 | yes |
| `blue-text` | `blue-tint` | text | 7.28 | 4.5 | yes |
| `paper` | `blue` | large | 7.04 | 3.0 | yes |
| `blue` | `paper` | non-text | 7.04 | 3.0 | yes |
| `blue` | `well` | non-text | 6.48 | 3.0 | yes |
| `violet-text` | `paper` | text | 8.74 | 4.5 | yes |
| `violet-text` | `well` | text | 8.05 | 4.5 | yes |
| `violet-text` | `violet-tint` | text | 7.11 | 4.5 | yes |
| `paper` | `violet` | large | 6.74 | 3.0 | yes |
| `violet` | `paper` | non-text | 6.74 | 3.0 | yes |
| `violet` | `well` | non-text | 6.20 | 3.0 | yes |
| `pencil-text` | `paper` | text | 10.01 | 4.5 | yes |
| `pencil-text` | `well` | text | 9.22 | 4.5 | yes |
| `pencil-text` | `pencil-tint` | text | 8.04 | 4.5 | yes |
| `paper` | `pencil` | large | 8.10 | 3.0 | yes |
| `pencil` | `paper` | non-text | 8.10 | 3.0 | yes |
| `pencil` | `well` | non-text | 7.45 | 3.0 | yes |
| `rose-text` | `paper` | text | 9.07 | 4.5 | yes |
| `rose-text` | `well` | text | 8.35 | 4.5 | yes |
| `rose-text` | `rose-tint` | text | 7.35 | 4.5 | yes |
| `paper` | `rose` | large | 7.26 | 3.0 | yes |
| `rose` | `paper` | non-text | 7.26 | 3.0 | yes |
| `rose` | `well` | non-text | 6.69 | 3.0 | yes |
| `rule-strong` | `paper` | non-text | 3.41 | 3.0 | yes |
| `them` | `paper` | non-text | 3.13 | 3.0 | yes |
| `ink-3` | `paper` | non-text | 5.59 | 3.0 | yes |

**Reading the contrast table:**
- **`text`** means body or label text; it needs 4.5:1.
- **`large`** is `--paper` text on a pattern solid (the takeover); it needs 3:1 and is allowed **only at ≥ 24 px** regular or ≥ 18.67 px bold.
- **`non-text`** means glyphs, solids, meaningful rules and fills against the surface; it needs 3:1 (WCAG 1.4.11).

**Every pair passes.** The tightest pairs are the ones to watch when tweaking:
- light `ink-3` on `well`: 4.56 (text);
- dark `them` on `paper`: 3.13 (non-text);
- light `ochre` on `well`: 3.29 (non-text);
- light `them` on `paper`: 3.29 (non-text);
- dark `rule-strong` on `paper`: 3.41;
- light `paper` on `ochre` (takeover text): 3.60. This is why takeover text must stay ≥ 24 px, and why the light ochre takeover has no small print at all.

`--rule` is decorative, so it isn't checked. Never use it as the only boundary of an interactive control: use `--rule-strong` for that.

---

## 3. Type

### 3.1 Families

All three families are free for commercial web and app use. Every pick was checked in the font file for tabular figures.

| Role | Family | Licence | Tabular figures | Dashboard (Next) | Phone (Expo) |
|---|---|---|---|---|---|
| **Display**: headings, the debrief sentence, the nudge message, the tempo marking, if-then plans (italic) | [Newsreader](https://fonts.google.com/specimen/Newsreader) (Production Type), variable `opsz` 6–72, `wght` 200–800, roman + italic | [SIL OFL 1.1](https://openfontlicense.org) | `tnum`, `pnum`, `lnum`, `onum`; **tabular by default** | `next/font/google`: `Newsreader({ subsets:['latin'], axes:['opsz'], style:['normal','italic'], variable:'--font-display' })` | `@expo-google-fonts/newsreader`: `Newsreader_300Light`, `Newsreader_400Regular`, `Newsreader_400Regular_Italic`, `Newsreader_500Medium` |
| **Text**: UI, transcript, margin notes, **real small caps** for labels | [Ronzino](https://github.com/collletttivo/ronzino) (Collletttivo; Luigi Gorlero, Annunziato Pio Mazzaferro), Regular / Medium / Bold + Obliques | SIL OFL 1.1 (repo README) | `tnum`, `pnum`, `lnum`, `onum`, `smcp`, `c2sc` (verified); proportional by default | self-host: copy `fonts/Ronzino-{Regular,Medium,Oblique}.woff2` to `dashboard/app/fonts/`, then `next/font/local` with `variable:'--font-text'` | copy the `.otf` files to `mobile/assets/fonts/`, then `useFonts({ Ronzino_400: require(...), Ronzino_500: …, Ronzino_400_Oblique: … })` |
| **Numbers**: every changing number, timings, confidence, line numbers, tempo words in italic (*rit.*, *a tempo*) | [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) 400 / 500 + italic | SIL OFL 1.1 | monospaced, so tabular inherently | `next/font/google`: `IBM_Plex_Mono({ weight:['400','500'], style:['normal','italic'], variable:'--font-mono' })` | `@expo-google-fonts/ibm-plex-mono`: `IBMPlexMono_400Regular`, `IBMPlexMono_400Regular_Italic`, `IBMPlexMono_500Medium` |

**Fallback if self-hosting Ronzino is a problem:** [Schibsted Grotesk](https://fonts.google.com/specimen/Schibsted+Grotesk) (OFL, Google Fonts, `tnum` + `zero`). It has no `smcp`, so labels become sentence-case `--ink-2` 13 px instead of small caps.

**Removed:** `geist`, `@fontsource/instrument-serif`, `@expo-google-fonts/geist`, `@expo-google-fonts/geist-mono`, `@expo-google-fonts/instrument-serif`. Instrument Serif has **no tabular figures** (checked in the font file), and the Instrument Serif + Geist pair is the most common generated-UI stack of 2025–26.

**Expo caveat.** The Expo Google Fonts package ships static instances at the text optical size, so very large Newsreader on the phone is a touch heavier than the desktop's `opsz` 72. Use **Light 300** for phone display sizes ≥ 40 px.

### 3.2 Scale

Everything on the projector the presenter points at is ≥ 20 px. Nothing on the Live screen is below 13 px.

| Token | Family | Desktop 1440 | Phone 390 | Line height | Used for |
|---|---|---|---|---|---|
| `display-xl` | Newsreader opsz 72, 400 (phone 300) | 112 | 64 | 0.92 | takeover message, the tempo marking `♩ = 160` |
| `display-l` | Newsreader 400 | clamp(48, 5vw, 72) | 40 | 1.0 | debrief headline sentence, Today mission |
| `display-m` | Newsreader 400 | 40 | 30 | 1.05 | page titles, mode word, coach name |
| `display-s` | Newsreader 400 / italic | 26 | 22 | 1.15 | names, if-then plan (italic), pull quote |
| `subtitle` | Ronzino 400 | 32 | — | 1.25 | the live partial, 2 lines max (§6.4) |
| `text-l` | Ronzino 400 | 19 | 18 | 1.45 | finalised transcript turns |
| `text-m` | Ronzino 400 | 16 | 16 | 1.45 | body |
| `text-s` | Ronzino 400 / oblique | 14 | 14 | 1.4 | margin notes, meta, help |
| `label` | Ronzino 500 + `all-small-caps` | 14 | 14 | 1.2 | short labels (≤ 3 words) |
| `num-xl` | Plex Mono 400 | 120 | 88 | 0.85 | live pace |
| `num-l` | Plex Mono 400 | 56 | 44 | 0.9 | debrief numbers, session clock on phone |
| `num-m` | Plex Mono 400 | 24 | 22 | 1.1 | instrument readouts, takeover reason line (≥ 24 px, see §2.5) |
| `num-s` | Plex Mono 400 | 13 | 13 | 1.3 | line numbers, confidence, latency, timecodes |

Measure: transcript and debrief prose run 45–75 characters per line. The takeover message is one line where it fits.

### 3.3 Figures

- **Every number that changes** is set in Plex Mono, or in Ronzino or Newsreader with `font-variant-numeric: tabular-nums lining-nums`.
  - Keep the `.num` class name; it becomes Plex Mono plus `tabular-nums`.
  - Drop the current `letter-spacing: -0.03em` on `.num` above 40 px only.
- **Numbers inside display sentences** ("ran 18 seconds … 214 words a minute") use Newsreader's default tabular lining figures, so they align across re-renders.
- **Static prose numbers** in Ronzino may stay proportional.
- **Clock and timecodes:** always `m:ss` (`0:46`), with `h:mm:ss` only past an hour. Transcript citations are `page:line` (`3:12`), see §6.4.
- **Units are smaller than the number** (one step down, `--ink-2`), and set after it with a thin space: `214 wpm`.

### 3.4 Labels: small caps replace tracked caps

The current `.caps` (10.5 px Geist, uppercase, 0.13 em tracking) appears on nearly every block (`before/dash-live-c-later-desktop.png`, `before/mob-today.png`). Replace it as follows:

- **`.label`:**
  ```css
  font-family: var(--font-text);
  font-weight: 500;
  font-size: 14px;
  font-variant-caps: all-small-caps;
  letter-spacing: .05em;
  color: var(--ink-2);
  ```
  On mobile use `fontVariant: ['small-caps']` with the source string in lowercase, since iOS honours `smcp` when the font has it.
- **Write label text in sentence case in source.** Screen readers then read words, and `text-transform` is never used.
- **Delete at least half of the existing labels.** A block whose content is self-explanatory doesn't get one:
  - a pace number with "wpm" after it needs no "PACE";
  - a transcript with a speaker cue column needs no "YOU" / "THEM" heading.
- **Tabs** (phone tab bar, dashboard nav) are `text-s` sentence case, not caps. The current tab is `--ink` with a 2 px underline; the others are `--ink-2`.

---

## 4. Space, grid, borders, elevation

### 4.1 Spacing

- **Base unit 4 px.** Steps: `--s-1` 4, `--s-2` 8, `--s-3` 12, `--s-4` 16, `--s-5` 24, `--s-6` 32, `--s-7` 48, `--s-8` 64, `--s-9` 96.
- **Vertical rhythm:** sections are separated by `--s-7`, related blocks by `--s-5`, and lines inside a block by `--s-2`.

### 4.2 Dashboard grid (1440)

**The page:**
- 12 columns, 24 px gutters.
- **Asymmetric margins:** 72 px left (the score margin, where bar numbers and line numbers hang) and 40 px right.
- Content width is therefore 1328 px.

**Live screen layout:**

```
| 72 px margin | c1 ─ c4                 | c5 ─ c9                   | c10 ─ c12            |
 masthead ─────────────────────────────────────────────────────────────────────────────
 tempo line  | ♩ = 160 · Regular       | pace VU needle + 192      | hands · volume        |
             | budget: ● ● ○           |                           |                      |
 score ──────┼─ your stave ─────────────────────────────────────────────────────────────
  bar nos    ├─ their stave ────────────────────────────────────────────────────────────
             └─ percussion line (glyphs) ───────────────────────────────────────────────
 transcript  | c1 ─ c7: cue col 96 px + numbered lines        | c8 ─ c9: margin | c10 ─ c12: quiet log,
             |                                                 | notes           | counters, monologue
```

- **1024:** 8 columns. Margin notes fold under each turn, and the right rail moves below the transcript.
- **768 and 390:** single column, ordered tempo line → score → transcript. No horizontal scroll. The dashboard at phone width is a fallback only, because the phone app is the phone UI.
- **Other pages** use the same 72/40 margins. Their main text column spans c1–c7 and the secondary column c9–c12, with c8 left empty on purpose.
  - Debrief: headline c1–c8, numbers c9–c12.
  - Studio: sentence c1–c10, sheet rules c1–c7, settings c9–c12.

### 4.3 Phone grid (390)

- Margins 20 px left and 20 px right. Text is ranged left; nothing is centred except the metronome pivot.
- 4 columns, 12 px gutters.
- Touch targets ≥ 48 px. The Bookmark key is 96 px tall and full width at the thumb zone; Stop sits beside it at a third of the width, 96 px tall.

### 4.4 Radius and borders

| Token | Value | Use |
|---|---|---|
| `--r-key` | 4 px | buttons, inputs, chips (the "key" of an instrument) |
| `--r-0` | 0 | everything else: no rounded panels or cards |
| `--r-note` | 50% | noteheads, dots, rings only |

**Borders:**
- 1 px `--rule` for decorative hairlines and stave lines.
- 1 px `--rule-strong` for interactive boundaries.
- 2 px `--ink` for the **one** emphasis rule per page, e.g. above "One thing to fix".
- No boxed cards.
- **No coloured left-border accents.** The debrief's if-then plan currently uses a 3 px ink bar; replace it with a hanging italic (§8).

### 4.5 Elevation

Only two things sit above the page:

1. **The director panel** (backtick / three-finger tap). `--well` background, 1 px `--rule-strong` border, and one shadow tinted from ink with a single light source:
   ```
   --shadow-panel: 0 1px 1px oklch(.22 .025 265 / .08), 0 4px 8px oklch(.22 .025 265 / .08), 0 16px 32px oklch(.22 .025 265 / .10);
   ```
   In dark, multiply the alphas by 2.
2. **The nudge takeover.** A full-width band of the pattern solid, no shadow, with a 1 px `--ink` rule on its bottom edge. It covers content; it doesn't float.

Nothing else gets a shadow: no hover lift and no card shadows.

---

## 5. Motion

### 5.1 Tokens

| Token | Value | Use |
|---|---|---|
| `--ease-enter` | `cubic-bezier(.05,.7,.1,1)` (M3 emphasized decelerate) | anything arriving: takeover band, new turn, status reply |
| `--ease-exit` | `cubic-bezier(.3,0,.8,.15)` (M3 emphasized accelerate) | anything leaving: takeover folding into the log |
| `--ease-std` | `cubic-bezier(.2,0,0,1)` | hover / press / state changes |
| `linear` | — | anything that *is* time: ramps, held notes, playheads, the score scroll |
| `--dur-press` | 120 ms | button press |
| `--dur-enter` | 240 ms | entries |
| `--dur-exit` | 200 ms | exits |
| `--dur-hold` | 2500 ms | how long a takeover holds |
| `--dur-breath` | 3200 ms | the listening ring, the only idle loop |

**Rules:**
- Animate only `transform`, `opacity` and `clip-path` (unchanged).
- **Motion mirrors the haptic.** Whenever a pattern is shown *as an event*, its glyph plays at the pattern's real millisecond timing (§5.2), starting at the same instant `play()` is called on the phone.
- **Nothing else loops** except the listening ring, the live caret, and the pendulum while outside the band.
- No fade-and-slide on page sections and no hover transitions on blocks.

### 5.2 How each pattern animates: from `PATTERNS` in `lib/bus/patterns.ts` (identical in `mobile/src/bus/patterns.ts`)

Every pulse `{at, dur, level, shape}` becomes one notation element (§7). The element's animation:

- **Starts at exactly `at` ms.** Rhythm is never stretched.
- **Short pulses** (`dur` < 200, no shape) **strike**:
  - scale .6 → 1.08 → 1 and opacity .25 → 1;
  - over `max(dur, 120)` ms, `--ease-enter`;
  - the 120 ms floor keeps a 28 ms tick visible, but the *next* strike still begins at its own `at`.
- **Long pulses** (`dur` ≥ 200) **draw**: `clip-path: inset(0 100% 0 0)` → `inset(0)` over exactly `dur` ms, `linear`. The notehead strikes at `at`.
- **Ramps** draw the hairpin opening over exactly `dur` ms, `linear`.
- **Accents** (`level` ≥ .9) flash the accent mark from opacity 0 → 1 → .7 in 120 ms at `at`.

| Pattern | Pulses (ms): `at` + `dur` @ level | Total | What the eye sees |
|---|---|---|---|
| `slow_down` | 0 + 720 @ .85, ramp | 720 | the hairpin opens left → right for 720 ms, *rit.* fades in at 0 |
| `filler` | 0 + 90 @ .6 | 90 | one filled note strikes |
| `interrupt` | 0 + 55 @ 1 · 130 + 55 @ 1 | 185 | two high accented notes strike 130 ms apart: sharp, close |
| `wrap_up` | 0 + 70 @ .4 · 190 + 70 @ .7 · 380 + 70 @ 1 | 450 | three notes climb, 190 ms apart; the last is accented |
| `still` | 0 + 240 @ .35 soft · 620 + 240 @ .35 soft | 860 | two low open whole-notes each draw their tie for 240 ms, with a long rest between |
| `success` | 0 + 60 @ .4 · 150 + 80 @ 1 | 230 | a low open note, then a high accented filled note |
| `tap` | 0 + 45 @ .3 | 45 (shown 120) | one small open note strikes |
| `approve` | 0 + 28 @ .25 · 120 + 28 @ .25 | 148 | two staccato dots tick 120 ms apart |
| `status_good` | 0 + 420 @ .6 | 420 | one held note: head strikes, tenuto bar draws 420 ms |
| `status_talking` | 0 + 420 · 720 + 420 @ .6 | 1140 | two held notes, 300 ms rest |
| `status_ask` | 0 + 420 · 720 + 420 · 1440 + 420 @ .6 | 1860 | three held notes, 300 ms rests; visibly slower and more even than any nudge |

**Implementation note.** iOS plays a `success` notification haptic rather than the pulse list, and long pulses are 40 ms impact trains (`mobile/src/haptics/player.ts`). The glyph still follows the pulse list, because that is the designed rhythm.

### 5.3 Takeover choreography

**Dashboard:**

| Time | What happens |
|---|---|
| t = 0 | The band drops from the top: `translateY(-100%)` → `0`, `--dur-enter`, `--ease-enter`. The glyph starts playing at 0, inside the moving band. |
| 0 → 2500 ms | Hold. |
| 2500 ms | The band folds up (`--dur-exit`, `--ease-exit`) while a copy of the glyph lands on the percussion line at the event's time position (opacity 0 → 1, 200 ms). |

**Phone:**

| Time | What happens |
|---|---|
| t = 0 | The field cuts to the pattern solid. The cut is instant, because it must match the buzz. The glyph plays from 0. |
| 0 → 2500 ms | The message and reason are on screen. |
| 2500 ms | The field fades back to `--paper` over 400 ms `--ease-exit`, and "last: Slow down · 0:46" remains in `text-s`. |
| session end | The field always clears on `session.ended`, unlike `before/mob-live-h-practice-success.png`, where it stayed green. |

**Practice mode:**
- **Fillers get no takeover.** The notehead strikes on the percussion line / drill stave, the word gets its ochre underline, and the count increments with a strike.
- **Only `success`** gets a band, and it is held for 1500 ms.

### 5.4 Reduced motion

`prefers-reduced-motion` on the web and `AccessibilityInfo.isReduceMotionEnabled` on the phone:

| Element | Behaviour |
|---|---|
| Glyphs | Render their final frame immediately. They are still shown, still coloured. |
| Takeover | Appears and disappears instantly, with no translate. The hold is unchanged. |
| Pendulum | Never swings. It tilts statically to +14° and the readout says **fast · 214**. Colour carries the change. |
| VU needle | Jumps to the value with no ballistics. |
| Listening ring | Static ring at full opacity. |
| Caret | Static. |

### 5.5 The metronome pendulum (phone Live, Regular mode)

**Geometry:**
- The pivot is at the horizontal centre, 34% down the content area.
- The rod is 46% of the screen height, 3 px wide, pointing *down* from the pivot like an inverted metronome, so the thumb never hides it.
- A sliding weight (a 22 × 14 px rectangle, `--r-key`) sits on the rod at a height set by the wearer's tempo: `baseline_wpm` maps 120–200 onto 80%–30% of rod length, so a slower habitual pace hangs lower, as on a real metronome. The tempo marking `♩ = 160` is set beside the weight in `num-m`.
- Behind it is an arc scale of 9 ticks at ±24°, in `--rule`.

**Inputs:**
- `metrics.wpm` (1 Hz);
- `baseline_wpm`;
- `policy.tolerance` (regular: .25).

The band is `[0, baseline × (1 + tolerance)]`. Only the upper edge matters; slow speech is never flagged live.

**States:**

1. **Inside the band: still.**
   - The rod is vertical, in `--ink`.
   - Nothing moves except the listening ring.
   - The caption under the pendulum reads **"In tempo"** in `display-s` italic, and the pace is shown small in `num-m` `--ink-2`.
2. **Above the band: swinging.**
   - Amplitude `A = clamp((wpm − upper) / (0.25 × baseline), 0, 1) × 16° + 8°`, so 8° just over the edge and 24° max.
   - Half-period = `60000 / (wpm / 2)` ms. At 214 wpm that's ≈ 561 ms per side; the wearer's speed literally sets the beat.
   - Motion is `rotate` on a sine easing (`cubic-bezier(.37,0,.63,1)` each half-swing).
   - Rod and weight change to `--blue`. This is semantically correct: the swing *is* the slow-down condition.
   - Entering the swing, the amplitude eases in over 600 ms.
   - The caption reads **"Rushing · 214"**, with the number in `num-m`.
3. **The `slow_down` nudge fires** (budget allowing):
   - the takeover floods `--blue`;
   - the glyph hairpin draws over 720 ms;
   - the message is *rit.* **Slow down**, with `214 → 160` beneath in `num-m`.
   - After the takeover, the pendulum's half-period lengthens linearly to 900 ms over 720 ms (the ramp's duration), then continues per state 1 or 2.
4. **Back inside the band:** the amplitude decays to 0 over two half-swings (damped), and the rod settles vertical and returns to `--ink`.

The pendulum shows state; it never buzzes. Buzzes are governed only by the nudge policy (budget 3, gap, warm-up). A swinging pendulum with an empty budget is correct and expected.

**Budget:** three noteheads at the top right, `num-s` sized, filled `--blue` while available. One turns hollow (`--ink-3` ring) per buzz spent.

### 5.6 VU needle ballistics (dashboard pace instrument)

- **Scale:**
  - a 100° arc mapping 100 → 240 wpm, tick labels every 20 in `num-s`;
  - the band `[baseline × .75, baseline × 1.25]` engraved as a bracket in `--ink-2`;
  - the zone above the upper edge is a hairline arc in `--blue` with `--blue-tint` fill. It is the only blue on the instrument at rest.
- **Ballistics (VU, after ANSI C16.5 / IEC 60268-17):**
  - the needle reaches 99% of a step in **300 ms**, with ≈ 1% overshoot and the same fall time;
  - implement as a damped spring on `rotate` with a rAF loop: ζ ≈ 0.8, ω₀ chosen so 99% settling = 300 ms (≈ 20 rad/s);
  - metrics arrive at 1 Hz, so each sample becomes the spring target.
- **Colour:** the needle is `--ink`. While pace sits above the band, the needle and the big number turn `--blue-text`. This keeps the current behaviour of turning the pace number blue when fast, which is correct.
- **Readout:** `num-xl` pace below the needle pivot, then `wpm` in `text-s` `--ink-2`, then "your usual 160" in `text-s`.

---

## 6. Transcript formatting

The transcript is set like a screenplay crossed with a court record.

### 6.1 Speaker cue column

- **Desktop:** a 96 px column to the left of the text.
  - The cue is the speaker's name in `label` small caps: "you", or "sam" when a person is tagged, otherwise "them".
  - Under the name: the turn's start time in `num-s` `--ink-3`.
  - Under that, for the wearer's turns only: the turn's wpm in `num-s`, which turns `--blue-text` if it was above the band.
- **Phone debrief:** the cue sits above the turn on its own line, not in a column.

### 6.2 Turns

- The wearer's turns are `text-l` in `--ink`.
- The other person's turns are `text-l` in `--ink-2`, indented 32 px past the cue column. This keeps the current indent, which works (`before/dash-live-c-later-desktop.png`).
- **Filler words** in the wearer's turns:
  - on Live: a 2 px `--ochre` underline, 3 px offset;
  - in the debrief: an `--ochre-tint` highlighter wash behind the word, with the word in `--ochre-text`.
- **Interrupted turn starts:** a 2 px `--vermilion` caret mark (`‸`) in the gutter at the line where the overlap began.
- **Margin notes** (judge verdicts) are `text-s` Ronzino *oblique*, `--ink-2`.
  - Each sits in c8–c9 beside its turn, aligned to the turn's first line.
  - Confidence goes at the right edge in `num-s`.
  - Verdicts with confidence < .6 use `--ink-3`.
  - The source mark "decisions · 212 ms" becomes `num-s` `--ink-3` with no middle-dot chains: write `212 ms`, and put the source in the `title` attribute.

### 6.3 Numbered lines and page:line citations

- **The debrief's full transcript is paginated at 25 lines per page**, after US court-transcript format.
  - Every line is numbered 1–25 in the 72 px left margin, in `num-s` `--ink-3`, right-aligned.
  - Each page opens with `p. 3` in `num-s`.
- **The Live transcript log** shows numbers on every 5th line only (5, 10, 15 …) to stay quiet. It uses the same page/line counting, so citations agree between Live and the debrief.
- **Bookmarks, promises, signals and nudges are cited as `page:line`** (`3:12`) in `num-m`, with the clock `0:46` beside them in `num-s` `--ink-3`.
  - Clicking a citation scrolls the debrief transcript to that line.
  - On the timeline, each bookmark carries its citation as its label.

### 6.4 The live partial: subtitle rule

The text being spoken *right now* (`transcript.partial`) is set as a subtitle:

- Projector: `subtitle` style (32 px Ronzino).
- **At most 2 lines and about 42 characters per line**, bottom-weighted: break so the top line is the shorter one.
- When the partial grows past 2 lines, drop the oldest words from the top; never grow a wall.
- On `turn.final`, the subtitle clears (opacity 1 → 0, 120 ms). The finished turn appears in the numbered log above (opacity 0 → 1 with `translateY(4px)` → 0, 240 ms `--ease-enter`).
- The caret stays (static under reduced motion).
- **The phone never shows the live transcript in Regular mode.** Calm: the metronome is the whole screen.

---

## 7. Glyphs: rhythm notation

`Glyph` (`dashboard/components/glyph.tsx`, `mobile/src/ui/Glyph.tsx`) keeps its props and still draws from the `Pulse[]` data. Only the drawing changes: from bars (which read as signal-strength and bar-chart icons, `before/mob-patterns.png`) to notation on one stave.

### 7.1 Geometry

For glyph height `H` (px), the time scale stays `k = H / 420` px per ms (the current `MS_PER_HEIGHT`).

| Element | Rule |
|---|---|
| **Stave** | One hairline at `y0 = 0.82H`, full glyph width, stroke 1 px, `currentColor` at 35% opacity. |
| **Pitch = intensity** | A notehead's centre sits at `y = y0 − level × 0.46H`, so harder pulses sit higher, like higher notes. |
| **Notehead** | Ellipse `rx = 0.15H`, `ry = 0.105H`, rotated −20°, left edge at `x = at × k`. **Filled** if `level ≥ .55`; **open** (stroke `0.06H`) if `level < .55`. |
| **Stem** | For short pulses (`dur < 200`, no shape): from the head's right edge, up `0.34H`, stroke `0.05H`. |
| **Held note** (`dur ≥ 200`, no shape) | No stem. A **tenuto bar** from the head's right edge to `x = (at + dur) × k`, thickness `0.09H`, at the head's y. |
| **Soft** (`shape: 'soft'`) | An open, wide **whole note** (`rx = 0.2H`), no stem, plus a thin tie arc (stroke `0.04H`) spanning `dur × k`. |
| **Staccato** (`dur < 35`) | A dot only, `r = 0.06H`, at the head position. |
| **Accent** (`level ≥ .9`) | A `>` wedge `0.18H` wide, `0.1H` above the stem top (or above the head when there is no stem). |
| **Ramp** (`shape: 'ramp'`) | A **hairpin `<`**: two strokes (`0.06H`) from an apex at `(at × k, y0 − 0.22H)` opening to `((at + dur) × k, y0 − 0.22H ± level × 0.25H)`. At `H ≥ 48` px, add *rit.* in Plex Mono italic at `0.3H` after the hairpin. |
| **Colour** | `currentColor` = the pattern's hue solid (`--{hue}`) on light or dark; `mono` uses `currentColor` from the parent. |
| **Minimum size** | `H = 14` px inline (margins, logs), 34 px in lists, 64–96 px on Pattern tester rows, 160–240 px in takeovers. |
| **Accessible name** | unchanged: `` `${name}: ${feel}` `` |

### 7.2 Per pattern, as drawn

| Pattern | Drawing | Hue |
|---|---|---|
| `slow_down` | one hairpin `<` 720 ms long (+ *rit.* at large sizes) | blue |
| `filler` | one filled mid-height note with stem | ochre |
| `interrupt` | two filled high notes with stems and accents, close together (130 ms) | vermilion |
| `wrap_up` | three notes climbing: open low, filled mid, filled high + accent | teal |
| `still` | two open low whole notes with ties, far apart (620 ms) | violet |
| `success` | open low note then filled high note + accent | green |
| `tap` | one small open low note with stem | rose |
| `approve` | two staccato dots | rose |
| `status_good` | one held note: filled head + 420 ms tenuto bar | pencil |
| `status_talking` | two held notes | pencil |
| `status_ask` | three held notes | pencil |

The status glyphs are visibly longer, lower-chroma and evenly spaced, so they read as counting, not as a nudge. The Pair page's vocabulary table (`before/dash-pair-desktop.png`) is the reference sheet and should show all eleven at `H = 34`.

---

## 8. Dashboard screens

Each screen gets **one** key element. Spend boldness there and keep everything else quiet.

### Live: key element, the tempo line and the score

- **Masthead (56 px):**
  - the wordmark "Undertone" in Newsreader `display-s`;
  - nav in `text-s` sentence case;
  - right side: coach name · band state (§2.4 shapes) · phone state · `0:46` clock in `num-m` · Start / Stop key.
  - "Mock feed" becomes the `sample`-style dashed label, not a bordered pill.
- **Tempo line (c1–c12, about 200 px):**
  - c1–c4: `♩ = 160` in `display-xl` (♩ in Newsreader, number tabular); under it the mode word *Regular* / *Practice* in `display-s` italic, then the budget (three `--blue` noteheads, emptied one per buzz).
  - c5–c9: the VU pace needle (§5.6) with `num-xl` pace.
  - c10–c12: hand energy as a horizontal VU strip, frozen ← natural → overdoing, with the natural zone bracketed. Its needle is `--ink`, not violet: violet is reserved for the `still` *buzz*. Under it, the volume reading as three words (quiet / your usual / loud), with the current one in `--ink` and the others in `--ink-3`.
- **Score (full width, about 150 px):**
  - two staves, yours in `--ink` and theirs in `--them`;
  - turns drawn as filled phrase blocks whose length is duration;
  - bar lines every 10 s, with `num-s` bar numbers in the 72 px margin;
  - a playhead at the right edge, with the score scrolling left (`linear`);
  - **the percussion line** underneath: every pattern that fired, or was logged quietly, sits at its time. A buzz is drawn filled in its hue. A **quiet mark** (logged, not buzzed) is drawn in `--ink-3` outline: same notation, no colour, because no buzz happened.
  - Signals (`nerves`, `checked_out`) are a small diamond on the percussion line, outline `--ink-2`, with the word in the margin. They are observations, so they get no hue.
  - The talk ratio is a 4 px rule under the score: ink vs `--them`, with a 1 px `--ink` target tick and `54%` in `num-m` at the left.
- **Transcript (c1–c7) + margin notes (c8–c9):** §6.
- **Right rail (c10–c12), the quiet log:**
  - quiet marks as `0:27 [glyph 14 px] Let them finish`;
  - fillers/min, questions and interruptions as `num-l` numbers, each with its own baseline beside it ("usual 3.1");
  - the current-turn timer: a 2 px rule that fills toward the limit. **It never changes colour**, because amber/teal is `wrap_up`; at the limit it gains the `wrap_up` glyph at 14 px only if `wrap_up` is a buzzing rule in practice.
- **Takeover:** §5.3. Message in `display-xl` `--paper`, the reason in `num-m` (≥ 24 px), latency "slip → tap 0.9 s" in `num-m`.
- **"How am I doing?" reply:** a 64 px strip under the masthead with the `pencil` glyph playing at `H = 24` and the meaning ("Talking too much") in `display-s`. It holds 3 s and folds. No takeover.
- **Idle:** "Double-tap the band to start." in `display-l`, then the active coach's rules as a list of glyph (34 px) + action + condition in `num-s`.

### Studio: key element, the sentence being written

- "I want to …" in `display-l`, with the goal typed in Newsreader italic (keep it; it is the best moment on the screen, `before/dash-studio-c-coach-sheet-desktop.png`).
- **Suggestions:** three lines under the input, set as *italic* Newsreader `display-s` in `--ink-2`, each preceded by "or". Drop the evenly spaced link strip.
- **Generating:** each spec section appears in order with `--ease-enter`, and the word "writing" uses the caret. Don't mark progress in green: a finished section simply gets its content.
- **Coach sheet:** the rule rows stay as *condition → glyph → action*.
  - Pace is marked "the one buzz" in `--blue-text`. This is correct, because it *is* `slow_down`.
  - The other rows read "tracked quietly" in `--ink-3`.
  - The haptic picker shows glyphs, not a native `<select>` (Radix Select or a listbox; styled per this file).
- **Library:** the prebuilt and saved coaches as a ruled list, plus the personal coach.
  - The crutch-word bars use `--ochre-tint` fill with `--ochre-text` counts. This is correct, because crutch words are what `filler` buzzes on.
  - Trend words are "getting better", "steady" and "rising", in ink, never green or red.

### Debrief: key element, the headline sentence

- Keep the reading order and the copy (`before/dash-debrief-desktop.png`).
- The headline is `display-l` with tabular lining figures.
- **"One thing to fix"** sits under the page's single 2 px `--ink` rule. The if-then plan is set as a **hanging italic**: `display-m` italic, with the opening quote mark hanging into the margin and no left bar.
- **Numbers:**
  - each of the five gets its own reference *inline*: `66%` `num-l`, then "you talked · usual 55%" in `text-s`;
  - **no green follow-ups**: "Promise heard" and "Follow up" are `label` in `--ink-2`;
  - a pace sparkline (Tufte, word-sized, 64 × 14 px, `--ink`, band shaded `--well`) sits inside the sentence that mentions pace.
- **Voice and body small multiples:** keep. Nudge marks on them are the actual glyph at 14 px in its hue, bookmarks are a `page:line` label, and signals are an `--ink-2` diamond.
- **Bookmarks** are cited `3:12`, with the snippet in Newsreader `display-s` and the implied follow-up in `text-m`.
- **The full transcript** is paginated and numbered (§6.3), collapsed by default.

### Pair & devices: key element, the pairing code

- The code `K7M 2QX` in `num-l`, with the QR beside it (unchanged).
- Phone state uses §2.4 shapes. **Not green.**
- Connected apps: a pending request gets the `approve` glyph (rose) and the words "waiting for you". That is correct, because it is what `approve` means.
- **The vocabulary table** shows all eleven glyphs in notation at 34 px. It is the reference sheet for the whole system.

### Calibration: key element, the live motion trace

- Each step is a ruled row (Hold still / Gesture / Fidget) with a progress *rule* filling over 5 s (`linear`), not a ring.
- The trace is a sparkline in `--ink`.
- The finished state reads "Calibrated." in `display-m` `--ink`, not green. The current screen turns it green (`before/dash-calibration-desktop.png`), which is a leak.

---

## 9. Phone screens

The phone ships **dark** (§2.5): `--paper` and `--ink` are the dark values.

### Today: key element, the mission sentence

- Keep the mission copy and the if-then plan (`before/mob-today.png`), but replace its left bar with a hanging italic.
- **Streak:** the last seven days as seven noteheads on a stave.
  - A practised day is a filled `--ink` head.
  - A day covered by a freeze is an open head with a tie to the next day.
  - Today is an open head.
  - No broken-streak state, ever.
- The date line is `text-s` sentence case ("Saturday 14 November"), not caps.
- **Listening** uses the §2.4 ring, not a blue dot.

### Live: key element, the metronome (§5.5)

- **Top:** coach name in `display-s`, then mode in *italic* `text-m`: *Regular · only taps when you rush*. On the right, the clock in `num-l` and the budget noteheads.
- **Centre:** the pendulum, caption and pace.
- **Bottom:** Bookmark (96 px, full width, `--well` key with a 1 px `--rule-strong` border; label "Bookmark" in `display-s`) and Stop.
- **Practice mode replaces the pendulum with the drill stave:**
  - the drill prompt in `display-s` italic;
  - the crutch words as `label`s;
  - a stave across the middle where each caught crutch word lands as an ochre `filler` note with the word under it in `num-s`;
  - the round count in `num-xl` `--ochre-text`;
  - round score "5 → 2" in `num-l`;
  - `success` gets the only takeover.
- **"How am I doing?":** the `pencil` glyph at `H = 96` plays its count while the meaning shows in `display-m`. It holds 3 s, then returns to the pendulum.

### Debrief

The same reading order as the dashboard: headline, what worked, one thing to fix + hanging plan, the five numbers each with "usual", play, three small multiples, bookmarks cited `page:line`, notes, "Tag who this was with".

### History: key element, the weekly sentence

- "Fillers fell from 9.1 to 5.0 a minute across four conversations." in `display-m`.
- Trend rows: `9.1 → 5.0 fewer`, with old in `--ink-3` and new in `--ink`. **No green.**
- Each conversation row: date in `num-s`, headline in `display-s`, then a pace sparkline and two numbers with references, not a five-number stat row.

### People

- The person's name in `display-l`, "your pattern" sentence in `text-m`, and "next time" as a hanging italic `display-s`.
- The comparison is with the wearer's own conversations with others, which is allowed and already worded correctly.
- Drop the filled `--well` box behind "next time".

### Pattern tester: key element, the glyph playing

- Rows of: glyph (`H = 64`), name in `display-s`, feel in `text-m`, `pattern_id` in `num-s`.
- Tap plays the glyph and calls `play()` at the same instant.
- Grouped: **Nudges** (six), **How am I doing?** (three), **System** (two).

### Connected apps

- A ruled list: app name in `display-s`, origin in `num-s`, last used in `text-s`.
- Pending requests lead the list with the `approve` glyph and Approve / Decline keys.
- Errors are `--ink` with the word "Couldn't reach the laptop": **not vermilion**.

### Pair

- Left-aligned headline. The viewfinder frame is kept, but the placeholder text is left-aligned inside it.
- "Use demo pairing" is a `text-m` link under the two keys, not a third box.

---

## 10. Do and don't

| Don't (seen in `before/`) | Do |
|---|---|
| Blue mic dot in masthead and tab bar (`dash-live-*`, `mob-today.png`); blue = `slow_down` | Ink dot in a breathing ring + the word "Listening" |
| Green "connected" dot (`dash-pair-desktop.png`), green "Calibrated.", green "promise heard / follow up" (`dash-debrief-desktop.png`), green improvements (`mob-history.png`); green = `success` | Ink, shape, words: "9.1 → 5.0 fewer" |
| Violet hand-energy needle (`dash-live-c-later-desktop.png`) | Ink needle; violet appears only when the `still` buzz fires |
| Amber `wrap_up` beside ochre `filler` (`mob-patterns.png`) | Teal `wrap_up`, ochre `filler` |
| Tracked-caps label on every block: PACE, HAND ENERGY, QUIET MARKS · 3, WHAT WORKED | Real small caps on ≤ 3-word labels only; delete labels whose content explains itself |
| Signal-bar glyphs and a solid right-triangle for `slow_down` | Notation: notes, stems, accents, a hairpin |
| Instrument Serif numbers ("18 … 214 … 160") with proportional figures | Newsreader, tabular by default |
| Five full-bleed ochre takeovers in one practice round (`dash-live-g-practice-desktop.png`, `mob-live-f-practice-filler.png`) | Notes land on the drill stave; only `success` takes over |
| Green takeover left on screen after the round (`mob-live-h-practice-success.png`) | Field clears after 2.5 s and always on `session.ended` |
| Static grey wedge and "Quiet so far" as the phone Live idle (`mob-live-b-midconversation.png`) | A still pendulum with "In tempo"; it swings only when rushing |
| Stat rows without references (debrief five-up, history rows) | Every number with "usual …" or a sparkline |
| 3 px left bar on the if-then plan | Hanging italic with the quote mark in the margin |
| `vermilion` for offline / errors | Ink + dashed ring + the word |
| Projecting `next dev` (the "N" badge in every `dash-*-desktop.png`) | `next build && next start` for the demo |
| **Keep:** script-style transcript, margin notes, debrief order, small multiples, the takeover's scale, all copy | — |

---

## 11. Copy

Unchanged rules from `prompts/antigravity-swarm.md`:
- behaviour, never the person;
- the wearer's own past, never other people;
- actions, not verdicts, in nudges.

Two additions:
1. **Tempo words** (*rit.* on slow down, *a tempo* when back in band) are allowed as italic grace notes next to plain English, never instead of it.
2. **No middle-dot meta chains.** Write `212 ms`, not `decisions · 212 ms`.

---

## 12. Changes from the current spec (`prompts/antigravity-swarm.md` §4b, §5, §6)

| Current spec | This draft | Why |
|---|---|---|
| §4b "Concept: a score for a conversation" | Kept, made literal: tempo marking, staves, percussion line, metronome | The concept was right; the surface didn't show it |
| §4b glyphs: "bars on a baseline" | Rhythm notation (§7) on the same pulse data | Bars read as stock signal and chart icons |
| §4b colours: `interrupt` vermilion, `wrap_up` **amber**, `filler` ochre, `slow_down` blue, `still` violet, `success` green, **`tap`/`approve` ink** | `wrap_up` → **teal**; `tap`/`approve` → **rose**; `status_*` → **pencil**; each hue gets tint / solid / text; all text pairs AA | Amber ≈ ochre; ink was also every text colour; vermilion and green text failed AA |
| §4b "colour is never decoration" | Extended: **no pattern hue for system states** (§2.4) | Blue mic, green connected, green improvement and red offline all leaked |
| §4b paper: "warm off-white", near-black ink | Cool manuscript paper `oklch(.965 .007 100)`, blue-black ink `oklch(.22 .025 265)` | Cream + brown-black is a generated-UI default |
| §4b type: Instrument Serif / Geist / Geist Mono | Newsreader / Ronzino / IBM Plex Mono | `tnum` on the display face; real small caps; off the default stack |
| §4b "labels are small caps" (implemented as tracked uppercase) | True `smcp`, ≤ 3 words, half as many labels | Most repeated generic tell |
| §4b phone "ink": the inverted system | Kept as the phone default; dark tokens are blue-black, chroma ≤ .15 | Not neon on black |
| §4b motion | Pattern-timed animation (§5.2), M3 easing for entry/exit only, VU ballistics, pendulum | Motion mirrors the haptic |
| §5 Live: "spine" talk-ratio bar on top | The tempo line leads; talk ratio becomes a rule under the score | Pace is the one live buzz; it leads |
| §5 Live: mode / budget left rail | Folded into the tempo line | Asymmetric grid; frees the left margin for bar and line numbers |
| §5 Live: monologue timer "warms toward amber" | No colour change (§8) | Amber/teal belongs to `wrap_up` |
| §5 Live: practice nudges use the full takeover | Only `success` takes over in practice | Strict haptics, calm screen |
| §5 Debrief: transcript "collapsed" | Paginated, 25 numbered lines, bookmarks cited `page:line` | Court-record borrowing |
| §6 Live: "one very large glyph area" | The metronome pendulum (§5.5) | The approved direction's key object |
| — | Live partial follows the subtitle rule (§6.4) | Projector readability |

---

## 13. Migration map: for the implementer

### 13.1 `dashboard/app/globals.css`

**Keep these names; only the values change:**
`--paper`, `--well`, `--ink`, `--ink-2`, `--ink-3`, `--rule`, `--them`, `--vermilion`, `--ochre`, `--blue`, `--violet`, `--green`.

**Add:**
- `--rule-strong`;
- `--{vermilion,ochre,green,teal,blue,violet,pencil,rose}-tint`;
- `--{…}-text`;
- `--teal`, `--pencil`, `--rose`;
- `--state-on`, `--state-off`, `--state-fault`;
- the `--ease-*`, `--dur-*`, `--s-*`, `--r-*` and `--shadow-panel` tokens;
- a `[data-theme="dark"]` block, a `prefers-color-scheme` block, and an `@supports not (color: oklch(0 0 0))` hex block (values in §2.6).

**Remove:**

| Old | Replace with |
|---|---|
| `--amber` | `--teal` |
| `--amber-ink` | `--teal-text` |
| `--ochre-ink` | `--ochre-text` |
| `--mic` | `--state-on` (`bg-mic` → `bg-ink` + ring) |

**`@theme inline`:**
- map every new token (`--color-teal`, `--color-teal-text`, `--color-teal-tint`, …);
- point `--font-serif` at `var(--font-display)`, `--font-sans` at `var(--font-text)` and `--font-mono` at `var(--font-mono)`;
- keep the `font-serif` / `font-sans` / `font-mono` utility names so the class churn is small.

**Tone classes.** `.tone-{hue}` sets:
```css
--tone: var(--{hue});
--tone-text: var(--{hue}-text);
--tone-tint: var(--{hue}-tint);
--tone-on: var(--paper);
```
Add `.tone-teal`, `.tone-pencil`, `.tone-rose`. Delete `.tone-amber` and `.tone-ink`.

**Utility classes:**

| Old | New |
|---|---|
| `.caps` | `.label` (§3.4) |
| `.serif` | Newsreader |
| `.num` | Plex Mono + `tabular-nums` |
| `.btn` radius | `--r-key` |
| `.btn-solid` | stays ink on paper |

**Known leaks to fix:**

| File | Line | Change |
|---|---|---|
| `components/shell.tsx` | 68 | `bg-mic` → §2.4 ring |
| `components/shell.tsx` | 73 | phone dot `bg-green` → `bg-ink` |
| `components/shell.tsx` | 77 | `border-green` / `border-vermilion` status pill → neutral |
| `app/pair/page.tsx` | 97 | `text-green` → `text-ink` |
| `app/pair/page.tsx` | 108 | `bg-green` → `bg-ink` |
| `app/debrief/page.tsx` | 80, 84 | `!text-green` → `!text-ink-2` |
| `app/calibration/page.tsx` | 124 | `text-green` → `text-ink` |
| `app/studio/page.tsx` | 103, 127 | `text-green` → `text-ink-2` |
| `components/live/live.tsx` | 390 | `bg-violet` hand needle → `bg-ink` |
| `components/live/live.tsx` | 311 | keep: the success line with the `success` glyph is legitimate; use `text-green-text` |

`components/live/live.tsx:330` (`text-blue` on fast pace) is legitimate. Make it `text-blue-text`.

**Fonts:**
- `app/layout.tsx`: replace the `geist` and `@fontsource/instrument-serif` imports with `next/font/google` (Newsreader, IBM Plex Mono) and `next/font/local` (Ronzino).
- `package.json`: remove `geist` and `@fontsource/instrument-serif`.

### 13.2 `mobile/src/ui/theme.ts`

React Native gets the hex fallbacks. Use the **dark** column of §2.6.

**Rename `C` to role names**, because the old names were inverted (`C.ink` was the background):

| Old | New | Hex |
|---|---|---|
| `C.ink` | `C.bg` | `#0E1218` |
| `C.well` | `C.well` | `#171B22` |
| `C.rule` | `C.rule` | `#2B2E34` |
| — | `C.ruleStrong` | `#656970` |
| `C.paper` | `C.fg` | `#ECEBE4` |
| `C.paper2` | `C.fg2` | `#ADB1B9` |
| `C.paper3` | `C.fg3` | `#888C94` |
| `C.them` | `C.them` | `#60636A` |
| `C.mic` | — | removed (listening = ring in `C.fg`) |

**`TONE`:**
- `Record<Tone, string>` becomes `Record<Tone, { tint; solid; text; on }>` with `on = C.bg`.
- Call sites:
  - `TONE.x` used as a text colour → `TONE.x.text`;
  - used as a fill or glyph → `TONE.x.solid`.
- `TAKEOVER[x].bg` → `TONE[x].solid`; `TAKEOVER[x].fg` → `TONE[x].on`. Delete `TAKEOVER`.

**`F`:** `serif` → `Newsreader_400Regular` (display sizes ≥ 40 → `Newsreader_300Light`), `serifItalic` → `Newsreader_400Regular_Italic`, `sans` → `Ronzino_400`, `sansMedium` → `Ronzino_500`, `mono` → `IBMPlexMono_400Regular`, plus `monoItalic` → `IBMPlexMono_400Regular_Italic`.

**Known leaks:**

| File | Line | Change |
|---|---|---|
| `app/(tabs)/history.tsx` | 52 | `TONE.green` → `C.fg`, plus the direction word |
| `app/(tabs)/index.tsx` | 47 | `C.mic` → ring |
| `app/(tabs)/live.tsx` | 65 | `TONE.vermilion` for offline, `C.mic` for live → §2.4 |
| `app/(tabs)/settings.tsx` | 30 | green / vermilion status → §2.4 |
| `app/(tabs)/_layout.tsx` | 34 | `C.mic` → `C.fg` dot |
| `app/apps.tsx` | 46 | `TONE.vermilion` error → `C.fg` |
| `app/debrief.tsx` | 100, 104 | `TONE.green` → `C.fg2` |

### 13.3 `lib/bus/patterns.ts` / `mobile/src/bus/patterns.ts` (shared verbatim; owned by Claude Code per `AGENTS.md`)

- **`Tone` union:** `'ink' | 'vermilion' | 'amber' | 'ochre' | 'blue' | 'violet' | 'green'` becomes `'vermilion' | 'ochre' | 'green' | 'teal' | 'blue' | 'violet' | 'pencil' | 'rose'`.
- **`tone` fields:**
  - `wrap_up` → `teal`;
  - `tap` and `approve` → `rose`;
  - `status_*` → `pencil`.
- Pulse data is **unchanged**.
- Edit both copies, or run `scripts/sync-shared.sh`.

---

## 14. Open questions for the humans

1. **8 hues for 11 patterns** (§2.2): status trio share `pencil`, and `tap`/`approve` share `rose`. Accept, or ask for eleven distinct hues (they would not all pass AA and stay distinguishable)?
2. **Ronzino vs Schibsted Grotesk:** Ronzino gives real small caps but needs two self-hosted font sets. Schibsted is Google-hosted, with no small caps.
3. **Phone ships dark only?** This draft says yes, and the light tokens exist if you want a phone light mode later.
4. **Paper grain:** the current faint noise texture isn't specified here. Keep it at its current 5.5% alpha, or drop it. The cool paper reads fine without it.
5. **P3 boost for the projector takeover:** optional and not in v1. Only worth it if the projector is P3, which is unlikely.
