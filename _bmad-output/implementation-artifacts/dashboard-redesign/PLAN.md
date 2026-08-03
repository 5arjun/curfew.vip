# Dashboard Redesign — Master Plan

status: **COMPLETE — ready for dev** (all decisions D1–D14 locked, all questions Q1–Q16 resolved, 2026-08-03)
started: 2026-08-03 · owner: Arjun · branch: `story/3-6-dashboard-home` (worktree `fix-serato-key-camelot`)

This document is the source of truth when dev starts. Everything agreed in the
planning conversations gets written here; nothing relies on chat history.

## Process rules (set by Arjun)

- **Fresh start.** Zero carryover from the previous dashboard design — colors,
  layout, components, vibe all discarded. Do not reference or preserve any of it.
- **Step-by-step.** One topic at a time. Do NOT advance to the next topic until
  Arjun gives explicit permission.
- **References are law.** Inspiration/code Arjun sends (in `inspo/`) is
  must-incorporate, followed at full fidelity. Deviations are called out
  explicitly and agreed, never silent.
- **Scope: front end of the logged-in home dashboard only.** Data layer /
  backend / sync seam untouched. This page sets the design language for the
  whole site.

## Locked decisions

### D1 — Theme: liquid metal + liquid glass
Translucency, frosted/progressive blur, dark blacks and deep blues. The two
materials of the page:
- **Liquid metal** — `@paper-design/shaders` liquid-metal shader (per
  `inspo/liquid-metal-button.tsx`) for key interactive elements.
- **Liquid glass** — translucent frosted surfaces with progressive blur (per
  `inspo/progressive-blur-modal.tsx`'s GradientBlur treatment).

### D2 — Background: Silk shader
React Bits `Silk` animated background (`inspo/silk-background.md`), props from
Arjun's sample (speed 5, scale 1, noiseIntensity 0.3, rotation 0.4).
OPEN: final color tint (sample is mauve `#594c5f`; theme says deep blue/black — Q3).

### D3 — Hover treatment: conic border glint
`inspo/shiny-button.tsx` style — animated conic-gradient border sweep + dots
mask + shimmer, paused at rest, runs on hover/focus. Arjun: "maybe could
incorporate into the liquid metal above, like when the mouse is over a
box/section" — i.e. this is the hover language for boxes/sections, potentially
composed with the liquid-metal material.

### D4 — Left half: recent set + scrollable set archive
Modeled directly on `inspo/progressive-blur-modal.tsx` (the music-player ref).
Arjun's spec, recorded near-verbatim:
- Top of left half: info about the **most recent set** (contents TBD — Q6).
- Under it: **the list of all sets** — a self-scrolling region. "The position of
  everything remains static but this list of sets will just scroll within
  itself while everything else around it stays where it is."
- **Spotlight search at the top of this component** — "sort of like where the
  photo is here in the example" (scope of search TBD — Q5).
- **Click a set → it pops up to take up that space** (in-place expansion, like
  the ref's song modal): shows a bit more statistics — **average BPM, start and
  stop times**, "maybe something else small" (Q4).
- In the popped-up state, **at the top (where spotlight search was): an "enter
  the set" action** → navigates to the set detail screen (not yet built), and a
  **back arrow** to return to the list.
- The **blurred frosted effect and the animations** of this ref are the point:
  "on par with our liquid glass and liquid metal theme… with a few tweaks I
  really think we can make this look exactly how I want it."

Full CSS captured 2026-08-03 (`inspo/progressive-blur-modal.css`). The
mechanics that make it feel the way it does — preserve these exactly:
- **Progressive blur = 8 stacked layers**, each a `backdrop-filter` blur that
  roughly doubles (0.5 → 1 → 3 → 7 → 16 → 32 → 64 → 128px), masked by
  concentric radial-gradient rings so the blur ramps smoothly outward. When a
  modal opens, the layers fade to blur(0) with a 0.3s-delayed 0.5s ease-out.
- **House easing: `cubic-bezier(.17,1,.33,1)`** (fast-out expo-ish settle) on
  everything structural; open 0.6s, close 0.4s; the artist modal opens over 1s.
- **The background recedes**: when any modal is active, `.main-content` scales
  to 0.9 + `blur(16px) brightness(0.7)` — depth-of-field, not just an overlay.
- **Song-modal expansion**: 72px row → 400px sheet in place; the title scales
  2× from origin center-left with letter-spacing tightening to −0.03em and
  brightens to full white; the + icon spins −495° over 1.2s with an
  overshooting bezier `(.32,1.35,.75,1)`; row hover = inset white glow
  (`inset 0 0 64px rgba(255,255,255,0.075)`).
- **Typography of the ref is Hanken Grotesk — Curfew's existing display font.**
  Zero adaptation needed; use the project's `next/font` setup, not the ref's
  Google-Fonts `@import`.
- **Re-tint deviations for dev (warm → deep-blue/black theme):** `#161616` bg,
  warm inset glow `rgba(52,46,45,*)`, modal surfaces `#272322`/`#342E2D`,
  border `#232120`, pink genre dot `#EC66C6` → all become theme tokens.

### D5 — Right side: calendar of set days (reference locked 2026-08-03)
A calendar showing the days that have a recorded set as "a blip on each date or
something." Reference: `inspo/glass-calendar.tsx` (GlassCalendar — Q1 resolved).
What the ref is:
- **A frosted liquid-glass card**: `bg-black/20 backdrop-blur-xl` +
  `border-white/10` hairline, rounded-3xl, deep shadow — already dark, already
  on-theme, needs almost no reskin (unlike the light spotlight ref).
- **Days render as ONE horizontal strip** (weekday initial above each date
  circle), scrolling sideways with a hidden scrollbar — not a month grid.
  ~7–9 days visible at a time.
- Header: Weekly/Monthly tab toggle (Monthly is non-functional in the ref —
  visual only) + settings icon. Big month name ("August", text-4xl bold) that
  fades/slides in on month change (framer-motion key swap); ‹ › chevrons.
- **The "blip" affordance already exists in the ref**: today gets a small
  colored dot under the date number. Repurpose: dot = day has a recorded set
  (multi-set days / dot intensity — discussable).
- Selected day: gradient-filled circle. Demo detail: card has hover
  `scale-105` (500ms).
- Footer: "Add a note…" / "New Event" buttons — don't map to Curfew;
  repurpose/remove TBD (Q10).
Deviations to agree at calendar-topic time (Q10): re-tint the pink→orange
selected-gradient + pink dot to the deep-blue/ice theme palette; decide fate of
Weekly/Monthly tabs (make Monthly real? drop?), settings icon, and footer; and
define click behavior (select a set-day → filter/scroll the left list? open
that set expanded?). Deps: date-fns — NOT installed; framer-motion (already
noted at D6).

### D6 — Spotlight search: Apple Spotlight component with gooey filter icons
Locked 2026-08-03: `inspo/apple-spotlight.tsx` (framer-motion + lucide) is THE
spotlight search for the top of the set-list panel (slots into D4). Arjun: "I
like this animation a lot."
- **Signature effect: the gooey SVG "blob" filter** (feGaussianBlur 10 +
  feColorMatrix alpha 18/-9) — the search pill and the circular icon buttons
  visually merge/separate like liquid droplets. Keep this exactly; it is
  literally the liquid-metal theme in motion.
- **Icons on the right = SORT FILTERS** (Arjun's adaptation, replacing the ref's
  app shortcuts): date ascending/descending, set length, "etc." — final filter
  list TBD (Q8). Hovering the container springs them out one by one (stagger
  0.05s, spring bounce 0.2, they slide out from behind the pill); they retract
  and re-absorb on leave. Hovering a filter rolls its label into the input
  placeholder (blur+y morph) — this becomes the filter's affordance/tooltip.
- Other animation details to preserve: open/close spring (stiffness 550,
  damping 50) with blur(20px) + asymmetric squash (scaleX 1.3 / scaleY 1.1);
  placeholder text swaps via layoutId popLayout morph; results panel is a
  layout-animated expansion of the pill (radius 30px) with 0.1s-staggered rows;
  input autofocuses; hovered result reveals a chevron.
- **Agreed-deviation candidates (called out, pending Arjun's nod):**
  (a) ref is a light theme (bg-neutral-100/black text) → reskin to dark liquid
  glass per D1, animations untouched; (b) ref renders as a fixed fullscreen
  overlay → ours embeds inline at the top of the left set-list panel per D4
  (the open/close spring can play on focus/expand instead).
- Dep: **framer-motion — NOT installed yet**, must be added at dev time.

### D7 — Full-page zone map (locked 2026-08-03, Arjun's spec)

```
┌──────────────────────────────────────────────────────────────┐
│  Good morning/afternoon/evening, <name>          (greeting)  │
├──────────────────────────────────────────────────────────────┤
│  MOST RECENT SET — full width, top ~33%                      │
│  date · time · dancefloor # of songs · median BPM ·      →   │
│  average BPM · chart          (arrow → set view, future pg)  │
├───────────────────────────────┬──────────────────────────────┤
│  SET LIST (left)              │  RIGHT COLUMN                │
│  spotlight search + filters   │  calendar (D5, top)          │
│  (D6) on top; self-scrolling  │  most played track (wk/mo)   │
│  list of all sets (D4);       │  most played artist (wk/mo)  │
│  click set → in-place expand  │  dancefloor-detection        │
│                               │    confidence %              │
│                               │  archive odometer            │
└───────────────────────────────┴──────────────────────────────┘
```

- Greeting: time-of-day aware ("Good afternoon, <name>").
- Hero (most recent set): **date, time, dancefloor # of songs, median BPM,
  average BPM, a chart** (chart contents TBD — Q11), and an **arrow on the
  right edge** → navigates to the set view (page not built yet; same
  destination as D4's "enter the set").
- Right column, top→bottom (order tunable at right-column deep-dive):
  calendar (D5) → **most played track (week/month)** → **most played artist
  (week/month)** (added by Arjun 2026-08-03; time window for both tiles TBD —
  Q14, incl. sparse-data fallback) → confidence % of the dancefloor detection
  algorithm (improves as the DJ corrects actual dancefloor boundaries — that
  correction feature is future work; % displays now, semantics TBD — Q13) →
  **archive odometer** (Arjun's pick 2026-08-03, resolving Q12): lifetime
  totals — sets archived · hours on decks · tracks played. Copy rule: frame as
  "your archive," never "since you joined."
- Supersedes the D4 note that placed the recent-set block at the top of the
  left half — the recent set is now the full-width hero band; the left half
  below the hero is entirely the set list.

### D8 — Hero design (locked 2026-08-03)

- **Chart = dancefloor-highlighted BPM arc**: the BPM line runs across the
  WHOLE session's timeline; the detected dancefloor window glows (brighter
  stroke + subtle fill) while warm-up/wind-down stretches sit dimmed. Why: it
  makes Curfew's signature capability visible on the site's most prominent
  surface, makes the "dancefloor # of songs" stat self-explanatory, and sets
  up the right-column confidence % tile (the glow region is what the
  confidence refers to). The **key/harmonic timeline** idea was deliberately
  SAVED for Set Detail — noted in epics.md Story 3.7 (2026-08-03 carry-over
  blockquote). Q11 resolved.
- **Layout = chart-as-canvas**: the chart spans the full hero band as a
  glowing liquid-metal stroke ("bead of molten chrome tracing the set");
  date + time line above; the three stats (dancefloor songs · median BPM ·
  average BPM) float along the bottom of the band; arrow at the far right.
  No boxed inset chart, no dead space.
- **Arrow → set view = LiquidMetalButton in icon mode** (46×46 circle, arrow
  icon replacing Sparkles) with ALL its physics: shader ring, state-reactive
  speed, press-down, ripple.
- **Shell = the music player's `.content` treatment** (~50px radius card,
  hairline border, inner glow — re-tinted deep blue): hero, set list, and
  right-column cards all share this one liquid-glass shell language. (Arjun
  liked the cohesion explicitly.)
- **Time = start AND end** ("10:14 PM – 1:52 AM"), duration implied.

### D9 — Set list content spec (locked 2026-08-03)

- **Collapsed row** (72px, ref's hover inset-glow + hover-reveal icon):
  left = **date + start time** ("Fri, Aug 1 · 10:14 PM"); right =
  **dancefloor track count · duration** ("38 · 2h 12m").
- **Expanded card** (in-place, full ref song-modal mechanics — background
  recedes/blurs, 0.6s house easing): the date scales 2× (letter-spacing
  tightens, brightens to full white per ref); **stat row**: avg BPM · median
  BPM · dancefloor tracks · start–end; **body = opening-stretch teaser** —
  the first few tracks of the detected dancefloor segment as a mini
  tracklist ("how the night opened"), filling the body the way the ref's
  prose does. Top of expanded state: **back arrow** + **"Enter Set" =
  LiquidMetalButton text mode** (142px pill) → set view. Same molten
  material at both set-view entry points (hero arrow = icon mode, here =
  text mode). Q4 resolved.
- **The hero's set ALSO appears in the list** — the list is the complete
  searchable archive; the hero is a spotlight, not the newest set's home.
- **Scrolling (Arjun re-confirmed, treat as hard requirement):** the list
  scrolls entirely WITHIN its own panel — the page, hero, and right column
  never move. Hidden scrollbar per the ref CSS. Detail to carry: soften the
  scroll region's top/bottom edges with the progressive-blur language
  (GradientBlur-style fade) so rows melt out at the boundaries instead of
  clipping.

### D10 — Right column design (locked 2026-08-03; ALL items confirmed by Arjun incl. former tentatives + hover-chip upgrade — see Q15)

**Calendar:**
- **Both view modes REAL, default Monthly** (compact 7-column month grid for
  blip density); the ref's horizontal strip stays as the Weekly mode.
- Marks (unopposed proposal — tentative): set day = dot (1–3 dots for
  multi-set days, glow cap beyond), today = hairline ring, selected = filled
  circle (tint decided at palette topic).
- **Click a set-day = scroll + pulse-highlight that day's row(s) in the left
  list; if the day has exactly one set, also auto-expand it.** (Arjun: "A
  with a twist" — locked.)
- Footer (unopposed proposal — tentative): month-summary line ("August · 3
  nights · 8h 40m") replaces "Add a note"/"New Event"; settings icon removed.
- **Day-hover preview (new ref: `inspo/project-showcase.tsx`)**: a floating
  card follows the cursor via rAF lerp (factor 0.15) with scale+fade
  in/out and content crossfade as the cursor sweeps between days. Arjun's
  content spec: **text only — "1 set" / "2 sets"** for the hovered day.
  Claude's rec pending Arjun's nod: auto-size it as a chip (the ref's fixed
  280×180 is image-sized) and add one quiet line per set (start · duration)
  so the hover answers "which night was that?" without clicking. Hover
  preview is cursor-only (doesn't exist on touch; click path unaffected).
  Implementation note: the ref's rAF-lerp follow is exactly the sanctioned
  pattern from the @property/setProperty bug (unregistered vars + rAF lerp).

**Most-played card: ONE glass card** ("B for sure") — small Week | Month
toggle in the corner driving BOTH rows: track (name, artist, ×plays) +
artist (name, ×plays).

**Confidence tile:** latest-set semantics ("94% · dancefloor detection ·
latest set"), hero-grade numeral + one-line explainer (improves as the DJ
corrects boundaries; future editor's doorway). Arjun: "fine — **we can
refine this later**" (Q13 resolved-for-now, revisit before dev polish).

**Archive odometer** (proposed, no objection — tentative): 3-across lifetime
numerals (sets · hours · tracks), Hanken Grotesk, count-up on load +
odometer roll on new sets, frozen under reduced-motion. Header "Your
archive."

### D11 — Palette: ABYSS CYAN (locked 2026-08-03, picked from the palette lab)

Winning candidate B. Token set (names TBD against `tokens.css` conventions at
dev time; values may micro-tune when applied to the real shaders/components,
with WCAG-AA contrast verification à la `tokens.test.ts` as a dev task):

| Role | Value |
|---|---|
| Base (page) | `#04070C` |
| Shell (cards) | `#091018` |
| Raised (expanded/hover surfaces) | `#0F1824` |
| Hairline border | `#16283A` |
| Silk tint | `#1B3242` (secondary lobe `#122334`; the Silk component takes ONE `color` prop — use `#1B3242`) |
| Accent | `#7FD8F2` (glacial cyan) |
| Accent-soft (today-ring, secondary) | `#4FB2D6` |
| Accent glow | `rgba(127,216,242,0.5)` |
| On-accent (text on filled accent) | `#04131C` |
| Liquid metal | `#D2E4EC → #7A96A8` |
| Inset shell glow | `rgba(24,52,72,0.5)` |
| Row hover glow | `rgba(127,216,242,0.09)` |
| Text ramp | `#EAF3F8` at 100 / 72 / 45 / 22% |

Replaces every ref hardcode: music player warm browns, calendar pink/orange,
shiny-button `blue`/`#8484ff`, silk demo mauve `#594c5f` (Q3 resolved).
Arjun picked B knowing it's kin to the current site accent (flagged in the
lab) — bonus: the eventual site-wide cascade to nav/auth will be gentle.

**Clarified for Arjun (2026-08-03): the palette-lab mocks are throwaway CSS
approximations for judging COLOR ONLY** — the real build renders from the
actual references (WebGL Silk shader, paper-design liquid-metal shader,
gooey-filter spotlight, 8-layer progressive blur, framer-motion physics) at
full fidelity. Nothing from the lab's markup carries into the product.

### D12 — Spotlight search behavior (locked 2026-08-03)

- **Search by date** — typing/selecting a date filters the archive to that
  date's set(s).
- **Search by song** — "only sets with that song will appear": results are
  SETS (filtered to those containing the queried track), never loose tracks.
- **Search by artist** — CONFIRMED by Arjun 2026-08-03 (Q16 resolved): sets
  containing tracks by the queried artist appear, same filtering model as
  song search.
- **Results = the list itself filters live** (matching "only sets … will
  appear"), rather than the ref's separate dropdown results panel — the
  archive is the results surface. Deviation from ref noted and intentional.
- **Filter icons FINAL (Q8 closed): date asc/desc + set length.** Q9's two
  adaptations (dark reskin, inline placement) stand confirmed.

### D13 — Cold/sparse state (locked 2026-08-03)

Arjun: "it will have to be stale/empty until they DJ." No fake data, no
demo content. Zones render their real shells with calm awaiting-first-set
placeholder copy; calendar simply has no blips; tiles show quiet em-dash
values. Copy obeys the product rules: history-as-asset framing, never
"since you joined," never nagging. Dev task: every component ships an
empty variant (the launch experience IS this state — go-forward-only
ingestion, no backfill).

### D14 — Greeting (locked 2026-08-03)

Time-aware text only ("Good evening, <name>"). Nothing beside it, no
buttons, no date. Revisit only if Arjun asks.

## Suggested build order (for dev kickoff — non-binding)

1. Tokens (D11 Abyss Cyan into `tokens.css` conventions + contrast tests) +
   deps install (framer-motion, date-fns, React Bits Silk).
2. Page scaffold: zone-map layout (D7) + shell language + Silk background.
3. Hero (D8): arc chart w/ dancefloor glow, stats, metal arrow.
4. Set list (D4/D9): rows → internal scroll + edge fades → in-place expand
   (progressive-blur mechanics) → Enter Set pill.
5. Spotlight (D6/D12): gooey pill + filters + live list filtering.
6. Right column (D5/D10): calendar (monthly grid + strip, blips, hover chip,
   click-to-scroll) → most-played card → confidence tile → odometer.
7. Cold-state variants (D13) everywhere.
8. One polish/motion pass at the end (per Arjun's established preference),
   incl. reduced-motion + WebGL-context budget + color-guard compliance.

## Open questions

| # | Question | Status |
|---|---|---|
| Q1 | ~~Calendar reference~~ — RESOLVED 2026-08-03: `inspo/glass-calendar.tsx` received (see D5). | ✅ resolved |
| Q2 | ~~progressive-blur-modal full CSS~~ — RESOLVED 2026-08-03: Arjun pasted the full stylesheet, saved verbatim to `inspo/progressive-blur-modal.css`. Reference set is now complete. | ✅ resolved |
| Q3 | ~~Silk tint~~ — RESOLVED 2026-08-03 by D11: deep petrol `#1B3242` (Abyss Cyan silk). | ✅ resolved |
| Q4 | ~~Expanded set card contents~~ — RESOLVED 2026-08-03: stat row (avg BPM · median BPM · dancefloor tracks · start–end) + opening-stretch teaser (see D9). | ✅ resolved |
| Q5 | ~~Spotlight search scope~~ — RESOLVED 2026-08-03 into D12 (date + song; artist pending Q16). | ✅ resolved |
| Q6 | ~~Most-recent-set data~~ — RESOLVED by D7: date, time, dancefloor # of songs, median BPM, average BPM, chart, arrow → set view. | ✅ resolved |
| Q7 | ~~Full-page zone map~~ — RESOLVED: now D7. | ✅ resolved |
| Q8 | ~~Filter list~~ — RESOLVED 2026-08-03: date asc/desc + set length, final (D12). Minor impl detail left to dev: date asc/desc as one toggling icon. | ✅ resolved |
| Q9 | ~~D6 adaptations~~ — RESOLVED: confirmed (dark reskin + inline placement), never objected across rounds. | ✅ resolved |
| Q16 | ~~Artist search~~ — RESOLVED 2026-08-03: yes (D12). **All questions closed — plan complete.** | ✅ resolved |
| Q10 | ~~Calendar adaptations~~ — RESOLVED 2026-08-03 into D10 (re-tint values still land at palette topic). | ✅ resolved |
| Q11 | ~~Hero chart~~ — RESOLVED 2026-08-03: dancefloor-highlighted BPM arc (see D8); key/harmonic timeline saved for Set Detail (epics.md 3.7). | ✅ resolved |
| Q12 | ~~Fourth right-column stat~~ — RESOLVED 2026-08-03: Arjun picked the **archive odometer** (lifetime sets · hours · tracks). He also ADDED "most played artist of the week/month" as a further right-column tile (see D7). | ✅ resolved |
| Q13 | ~~Confidence % semantics~~ — RESOLVED-FOR-NOW 2026-08-03: latest-set confidence (see D10); Arjun flagged "refine later" — revisit before dev polish. | ✅ resolved (revisit) |
| Q15 | ~~Hover chip + tentatives~~ — RESOLVED 2026-08-03: Arjun approved the chip upgrade (auto-sized, "N sets" + per-set start·duration lines) AND explicitly confirmed all three tentative items (blips, footer month-summary, odometer treatment). D10 is now fully locked, nothing tentative. | ✅ resolved |
| Q14 | ~~Most-played tiles time window~~ — RESOLVED 2026-08-03: a **small week/month toggle** on the tiles (assumed one shared toggle driving both track + artist tiles — confirm at right-column deep-dive; sparse-empty-window fallback still worth deciding there too). | ✅ resolved |

## Implementation notes (for dev time — not to act on during planning)

- Deps already in `web/package.json`: `@paper-design/shaders` + `-react`,
  Tailwind v4, shadcn, lucide-react, clsx, tailwind-merge, tw-animate-css.
  To install at dev time: React Bits Silk
  (`pnpm dlx shadcn@latest add @react-bits/Silk-JS-CSS`), `framer-motion`
  (spotlight + calendar), `date-fns` (calendar).
- Liquid-metal ref interaction physics worth preserving exactly: shader speed is
  state-reactive (idle 0.6 → hover 1.0 → click burst 2.4, settling after 300ms);
  bouncy easing `cubic-bezier(0.34, 1.56, 0.64, 1)` at 0.8s; press =
  `translateY(1px) scale(0.98)` + inset shadow; click spawns a 0.6s radial
  ripple at cursor; 3D layer stack via `preserve-3d` + `translateZ` (shader ring
  → dark pill inset 2px creating the metal rim → label → hitbox); multi-layer
  stacked drop shadows that tighten on hover.
- Shiny-button ref animates registered `@property` vars **via CSS**
  (keyframes/transition) — that works; the known project bug is **runtime JS
  `setProperty` on registered vars being silently ignored** (Next 16/Tailwind
  v4). Keep any JS-driven values on unregistered vars. Port out of styled-jsx
  into the project's CSS conventions.
- `web/app/no-hardcoded-colors.test.ts` color-guard is active — all ref hex
  values must become tokens at build time. Known guard traps: `white` substring,
  `transparent` keyword, `*/` inside CSS comments.
- Shaders: budget WebGL contexts (one per page ideally); freeze under
  `prefers-reduced-motion`.
- Silk demo color `#594c5f` and shiny-button highlight `blue`/`#8484ff` are
  placeholder-tier — final palette tokens come out of Q3 + the palette topic.

## Topic log

- **2026-08-03 — Kickoff + inspo round 1.** Process rules locked. Theme locked
  (liquid metal/liquid glass, translucency, dark blacks, deep blues). Four
  references received and broken down (silk bg, liquid-metal button, shiny
  hover, progressive-blur music player); two incomplete (Q1 calendar, Q2 CSS).
  Left-half layout direction recorded (D4). Next topic proposed: full-page zone
  map (Q7) — awaiting Arjun's go.
- **2026-08-03 — Inspo round 2: spotlight locked (D6).** Apple Spotlight
  component received (`inspo/apple-spotlight.tsx`); gooey blob filter + spring
  icon fan-out recorded as must-keep; icons repurposed as sort filters
  (date asc/desc, length, etc. — Q8). New deps note: framer-motion needed.
  Q1 (calendar) and Q2 (music-player CSS) still outstanding.
- **2026-08-03 — Inspo round 3: calendar received (D5, Q1 resolved).**
  GlassCalendar saved (`inspo/glass-calendar.tsx`): frosted glass card,
  horizontal day strip, today-dot = the natural set-day blip. Adaptation
  questions banked as Q10. date-fns added to dev-time deps. Q2 (music-player
  CSS) is now the only missing reference material.
- **2026-08-03 — Zone map locked (D7, Q6+Q7 resolved).** Arjun specced the
  full page: greeting → full-width recent-set hero (top ~33%) with arrow to
  future set view → left set list / right column (calendar, most-played-track
  of week, confidence %, +1 stat). New questions Q11 (hero chart), Q12 (4th
  stat — 3 candidates proposed), Q13 (confidence semantics). All refs
  confirmed to be from 21st.dev. Q2 CSS re-paste still came through as stub;
  source pen located but bot-blocked — Arjun to copy CSS manually.
- **2026-08-03 — Reference set COMPLETE + right column finalized.** Arjun
  pasted the full progressive-blur-modal CSS (Q2 resolved; mechanics analyzed
  into D4). Q12 resolved: archive odometer picked; "most played artist
  (week/month)" added as an additional tile. Right column now: calendar →
  track (wk/mo) → artist (wk/mo) → confidence % → odometer. New Q14 (tile
  time-window + sparse fallback).
- **2026-08-03 — Q14 resolved (week/month toggle); HERO DEEP-DIVE opened**
  with Arjun's permission. On the table: Q11 (chart contents) + hero layout +
  visual treatment. Proposals presented, awaiting reactions.
- **2026-08-03 — HERO LOCKED (D8, Q11 resolved).** Arjun ruled: dancefloor-
  highlighted BPM arc, chart-as-canvas layout, liquid-metal icon-button arrow,
  shared `.content` shell, start–end time. Key-timeline chart parked in
  epics.md Story 3.7 for the set screen. **SET-LIST DEEP-DIVE opened next**
  (Arjun asked for it) — on the table: collapsed row contents, expanded-card
  contents (Q4), hero-set inclusion in the list.
- **2026-08-03 — SET LIST LOCKED (D9, Q4 resolved).** Arjun ruled: row =
  date/start + count·duration; expanded = stat row + opening-stretch teaser;
  hero set included in list; Enter Set = liquid-metal text pill; internal
  panel scrolling re-confirmed as a hard requirement (page never moves).
- **2026-08-03 — RIGHT-COLUMN DEEP-DIVE opened** (Arjun: "go"). On the table:
  calendar behavior (Q10), tile designs (track/artist/confidence/odometer),
  shared toggle confirm, Q13 semantics. Proposals presented, awaiting rulings.
- **2026-08-03 — RIGHT COLUMN LOCKED (D10; Q10 + Q13 resolved).** Arjun:
  Monthly-real calendar (B), click = scroll-highlight + single-set
  auto-expand, one most-played card, confidence fine-refine-later. NEW REF
  round 4: `project-showcase.tsx` (cursor-follow lerp preview) → calendar
  day-hover card showing "N sets". Q15 opened (hover-card content richness +
  the tentative-flagged items).
- **2026-08-03 — Q15 resolved (hover chip + all tentatives confirmed).
  PALETTE DEEP-DIVE opened** with Arjun's permission — folds in Q3 (silk
  tint), accent choice (replaces ref pinks), base blacks/blues, metal tint.
  Palette-lab artifact PUBLISHED for Arjun to react to (the format that
  worked for the 2026-07-26 site-palette decision):
  https://claude.ai/code/artifact/974e5310-df6f-43a6-9c75-dbe52e74c88a —
  4 candidates on deep blue-black bases: **A Periwinkle Current** (#8B8DFF,
  from Arjun's shiny-button ref), **B Abyss Cyan** (#7FD8F2, kin to the
  current site accent — flagged honestly), **C Moonlight Chrome** (accentless;
  metal-as-color, cold white-blue glows #AFC6EA), **D Cobalt Night** (#3E6BFF,
  boldest/most club). Each includes base/shell/raised/silk/accent/metal
  tokens + mini-mocks of the locked design. Mixing allowed. Whatever wins
  CASCADES SITE-WIDE eventually (nav/auth re-tint is follow-up scope, not
  this branch). Awaiting Arjun's pick → then tokens get named in this doc.
- **2026-08-03 — PALETTE LOCKED: ABYSS CYAN (D11; Q3 resolved).** Arjun picked
  B from the lab; full token table banked in D11. Also confirmed to him that
  the lab mocks were color-judgment placeholders only — real components render
  from the actual refs at full fidelity.
- **2026-08-03 — FINAL THREE TOPICS LOCKED (D12 spotlight behavior, D13 cold
  state, D14 greeting; Q5/Q8/Q9 closed, Q16 opened on artist search).**
  Suggested build order added. Plan is feature-complete pending Q16 +
  Arjun's read-through.
- **2026-08-03 — PLAN COMPLETE.** Q16 confirmed (artist search yes). Arjun
  read the plan, approved, and asked for commit + a dev-kickoff prompt.
  Planning phase CLOSED — everything downstream is dev, driven by this doc.
