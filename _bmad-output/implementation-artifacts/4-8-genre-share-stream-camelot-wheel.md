---
baseline_commit: 67b44018cb5117b3d957bd4c4ca66fad7290e79e
---

# Story 4.8: Genre share stream + Camelot wheel

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want to see which genres actually made up each month of my sets and which keys I live in,
so that I learn *how* my playing changed and not just that a diversity number moved.

## Context & Authority

**Why this story exists (Arjun, 2026-08-07).** Entropy answers "how varied" but never "varied *how*" — a DJ cannot act on `2^H = 4.2`. The two hero charts here are the answer, and both are computable **today from already-synced data with zero agent work**: the genre stream reads the `breakdown: CategoryTally[]` that `styleEvolution.ts` already computes per bucket, and the Camelot wheel reads `SyncPlay.camelot_key` (already tallied per bucket as `keyDiversity.breakdown`). The wheel is the single biggest visual-density win available on this page: it is the geometry DJs already carry in their heads, and — unlike every trend line here — it looks complete off **one** set, which is exactly the cold-start property Decision B keeps costing Epic 4.

**This is a `web/`-only story.** No `agent/`, no `shared/`, no migrations. Every field read here is already frozen and synced (AD-3). If you find yourself editing `shared/` or writing SQL, stop — you have taken a wrong turn.

**Story 4.7 is the direct parent and it landed.** It built the Tempo/Genre/Key sections this story fills, and its own Dev Notes deliberately left each section's markup "a container that can hold more than one chart child, not a single-child assumption" — for this story. Its code review carried five open items forward with the explicit note that 4.8 "will re-open this same layout." Those are G-7 below; they are context, not new scope.

**Decision B binds every string you write.** Never surface elapsed subscription time as cost — no "since you joined," no "in your N months." Frame the record as the DJ's own ("your keys", "your genre mix"). `[Source: epics.md#Epic 4 header, Decision B]`

### Design gaps found during story creation — read these before writing code

These are conflicts between the ACs and the code as it stands today. Each one is a real decision the dev agent must make and **record in Completion Notes as a numbered decision**. This is the exact shape of undocumented drift Story 4.1's review flagged repeatedly (its D-9 through D-16 were all "found in a code comment, never ratified").

**G-1 — AC-3 is violated by the code that exists today, in the same section you are adding to.** `TrendChart.tsx:493-518` ranks genres **globally within the current view** by total count and assigns `--chart-cat-{i+1}` **by rank index** (`genreColor(i)`, line 505). AC-3 names that failure mode verbatim: "A hash- or rank-derived assignment that reshuffles when the top-N set changes is a defect." And it does reshuffle live today: `breakdowns` derives from `genreSeries`, which derives from `points = revealed ? series.including : series.excluding` (`StyleEvolutionView.tsx:51-53`) — so **ticking the low-confidence reveal can recolor every genre bar**. Granularity does not (month and week partition the identical dated-set population, so global totals are equal), but reveal does.
→ Introduce a **deterministic genre → color assignment keyed on the genre NAME**, not on rank or on view state. → **Then rule whether the existing breakdown bars adopt it too.** They must: the stream and the bars sit in the same Genre section, and "techno" being blue in one and orange in the other, four inches apart, is worse than either bug alone. Recommended: one shared exported mapping (e.g. `web/lib/sets/genreColor.ts` or an export from `styleEvolution.ts`), consumed by both.

**G-2 — the palette has exactly seven slots and AC-2 wants eight things.** `tokens.css:464-473` defines `--chart-cat-1` … `--chart-cat-6` plus `--chart-cat-other`. AC-2 needs **6 named genres + a fold-the-rest "Other" band**, which is 7 — but `--chart-cat-6` is **already spent**: `TrendChart.tsx:509` uses it for the taxonomy's own literal `"Other"` genre (`CATCH_ALL_GENRE`), which is a real, playable category produced by `genre.rs` normalization and is distinct from the fold band. A 2026-08-06 review specifically protected that distinction against a silent merge.
→ Resolve explicitly. The tokens.css comment records that only the first 6 of the `dataviz` skill's **8-hue adjacency-validated order** are in use, so extending to `--chart-cat-7`/`--chart-cat-8` is legitimate — but they must be **added to `tokens.css` and re-validated against this app's actual dark chart surface** (`#0a0e13`, the `.dz-shell` glass fill), the same way the first six were, and the validation written down. `web/app/no-hardcoded-colors.test.ts` will fail the build if any color literal lands anywhere in `web/app` outside `tokens.css`.

**G-3 — N=6 (stream) vs N=5 (bars), in one section, on purpose.** `MAX_CATEGORIES = 5` in `TrendChart.tsx:80` was a deliberate 6→5 reduction (2026-08-06, Arjun: "is it possible to make the bars wider?"). AC-2 rules N=6 for the stream. The two are different geometries with different legibility budgets, so they legitimately name different genre sets.
→ **Do not "fix" them into agreeing.** Write the asymmetry into the code as a comment and into Completion Notes, so a later reviewer does not unify them. G-1's per-genre color mapping must still hold across both.

**G-4 — the Camelot wheel needs no new aggregation pass, and AC-8's asymmetry falls out for free.** `BucketPoint.keyDiversity.breakdown` (`styleEvolution.ts:116`) is already a `CategoryTally[]` of raw `camelot_key` strings per bucket. Summing it across **every bucket of one partition** (`excluding` or `including`) is exactly the wheel's aggregate — no second walk over `plays`.
→ This makes AC-8 **provable, not asserted**: the wheel responds to the reveal (different partition → different totals) but is mathematically identical under Month vs Week (both partition the same dated-set population), so the granularity toggle has nothing to act on. Record that as the decision AC-8 asks for. → **Caveat to state, not to fix:** undated sets are dropped from every bucket, so they are absent from the wheel too. `StyleEvolutionView.tsx:75-78`'s page-level `undatedDisclosure` already says this once. Do not add a second line.

**G-5 — AC-9's harmonic trend is a render task, not a computation task.** `BucketPoint.harmonicMix.rate` (0–1, `null` when no scored transitions) and `.excludedNoKey` already exist per bucket from Story 4.7 (`styleEvolution.ts:130-141, 302-318`). `TrendChart` already draws a 0–100 percentage line for `metric === "library"` against `PCT_DOMAIN` (line 287).
→ Add a `"harmonic"` case to `TrendMetric` and reuse the existing plot rather than building a second chart component. Two things this needs that do not exist yet: a **Chart Summary generator** in `styleEvolution.ts` (there is no `harmonicMixSummary` today) following the file's "one generator, three duties" pattern — the same string is the visible caption, the aria text-equivalent, **and** the error-boundary fallback, never three different strings — and the new metric added to `TrendChartErrorBoundary`'s `resetKey` (`TrendChart.tsx:364`), or a boundary tripped by one metric stays tripped for the next.

**G-6 — decide up front whether wheel cells are interactive; AC-11 is conditional on it.** AC-11 requires keyboard operability "**if** any cell is interactive" and a non-radial phone fallback "if 24 cells cannot each meet the 24×24 target minimum." At 375px, 24 radial cells cannot.
→ The cheap, fully-AC-satisfying answer is **non-interactive cells** (SC 2.5.8 governs pointer *targets*; a static graphic has none) plus the AC-11 text-equivalent, which drops the phone-degradation branch entirely. If you make cells hoverable/tappable, you owe both the keyboard path and the non-radial fallback. Pick one, record it, and do not half-build the interactive version. Precedent for how this gets ruled: Story 4.7's R-6, where the defect was **not measuring and not recording**, not the size itself.

**G-7 — Story 4.7's carried-forward items reopen here.** Its final ruling: "The five items worth revisiting are carried forward for Story 4.8, which adds a second chart to the Genre and Key sections and will re-open this same layout." They are **not new ACs** — address what your changes touch, and say in Completion Notes what you left alone:
- **R-8 (layout, most relevant):** at 320px the tile row already pushes the first chart to `y=751`, below the fold on a 720px viewport. This story adds **two more charts**. `.se-tiles`' `@media (max-width: 480px)` rule (`style-evolution.css:121`) is the single knob; 2×2 there would keep a chart in view.
- **R-10 (a11y, directly caused by this story):** the page already exposes **seven** landmarks (4 tiles + 3 sections), each `<section aria-label>`. Adding a second chart per section must **not** add more landmarks — use `<div>`/`role="group"`/headings for the sub-charts, not `<section aria-label>`.
- **R-7** (the tile row can show two different periods at once) and **R-9** (the Median BPM tile headlines a one-play soundcheck) are product judgments no AC here covers. Leave them unless your change makes them worse.

**G-8 — the Camelot wheel's geometry is the exact shape of Story 4.7's hydration bug. This is the highest-value warning in this story.** 4.7 lost real time to an SSR/hydration mismatch: full-precision float values interpolated into inline styles, where `2 ** bits` differs at the ULP level between Node's V8 and the browser's V8 (legal per spec — transcendental math is implementation-approximated, not bit-exact). A wheel is **polar → cartesian**: every spoke coordinate is `Math.cos`/`Math.sin`, which is transcendental, server-rendered, and therefore **guaranteed** to eventually diverge.
→ **Round every wheel path coordinate and every interpolated percentage to fixed decimals** (`.toFixed(2)` for SVG path strings, `.toFixed(4)` for inline-style percentages), matching the discipline `TrendChart.tsx:153-154` already documents. → The stream's own share math (`count / total`) is **integer over integer and therefore bit-identical cross-engine** — 4.7's review explicitly checked and cleared the equivalent bar-height interpolations, so it needs no rounding for correctness. Round it anyway for consistency if you like, but the wheel's trig is the one that will actually bite.

**G-9 — AC-12 needs the `sectionsReady` gate pushed one level deeper.** Today `StyleEvolutionView.tsx:83` computes `sectionsReady = monthsSpannedAll >= 2` and lines 107-149 wrap **all three sections wholesale** in it. AC-12 requires the stream and the wheel to render for a DJ with exactly one set.
→ Move the gate **inside** Genre and Key: the stream and the wheel always render (given ≥1 set); only the **secondary** trend charts (2^H per AC-5, harmonic per AC-9) show the insufficient state. Tempo stays wholly gated — it has no aggregate hero. This is structurally the same move Story 4.7's AC-8 made one level up; follow that shape rather than inventing a new one. → The `model.setCount === 0` early return (line 91) is a **separate, unaffected** case. Do not conflate them — 4.7's review found exactly this conflation.

**G-10 — AC-6 and AC-10's disclosures already exist; preserve them, do not rewrite them.** `StyleEvolutionView.tsx:64-71` already sums `no_genre_count` / `no_key_count` across the visible partition and renders `"N plays untagged"` / `"N plays without a key"`. AC-6 says "preserved **verbatim** in the new composition." Move them if the composition demands it; do not re-derive them, and do not let the wheel grow a second, differently-worded no-key line.

## Acceptance Criteria

Reproduced verbatim from `epics.md` Story 4.8:

1. **Given** the Genre section, **Then** its hero chart is a **100%-stacked share** view (stream/area) of genre composition per bucket, sourced from the `CategoryTally` breakdowns `styleEvolution.ts` already computes — no new aggregation pass. *(FR-9 extension)*
2. **Given** a long genre tail, **Then** the chart plots the top **6** genres plus an explicit **"Other"** band rather than a band per genre — legibility over completeness (N=6 ruled 2026-08-07, party mode: balances legibility against coverage at both desktop and the 375px stack width), and "Other" always labeled as an aggregate so it is never mistaken for a genre. *(UX-DR6)*
3. **Given** a genre appears in multiple buckets, **Then** its color is **deterministic and stable across buckets and across renders** — "techno" is the same color in every month and on every visit. A hash- or rank-derived assignment that reshuffles when the top-N set changes is a defect, not a detail. *(New; the failure mode that makes stacked-share charts unreadable)*
4. **Given** the categorical palette, **Then** it is drawn from the Obsidian token system (no hard-coded colors), holds AA contrast against the section background, and remains distinguishable under the common colorblind simulations — a stacked chart with N adjacent bands is the one place on this product where palette failure is total. *(UX-DR1, UX-DR21)*
5. **Given** the existing genre-diversity (2^H) trend, **Then** it survives as a **secondary** chart within the Genre section rather than being deleted — the stream shows composition, the index shows spread, and the tile in Story 4.7 shows only the current value. *(Preserves Story 4.1 AC-1)*
6. **Given** plays with no genre, **Then** Story 4.1's `no_genre_count` disclosure line is preserved verbatim in the new composition — the exclusion is still stated out loud. *(Story 4.1 AC-5)*
7. **Given** the Key section, **Then** its hero is a **Camelot wheel**: 12 spokes × 2 rings (A/B), each cell's intensity driven by play count across the DJ's surviving sets, adjacent-compatible positions legible as adjacent. *(FR-9 extension; UX-DR11's LED/hardware visual register)*
8. **Given** the wheel is an **aggregate**, not a time series, **Then** it responds to the page-level low-confidence reveal (which sets count) but **not** to the Month|Week granularity toggle (which has nothing to act on) — and the story records that asymmetry as a decision rather than leaving it to be re-litigated in review. *(Story 4.7 AC-2)*
9. **Given** the Key section, **Then** a **harmonic compatibility trend** renders alongside the wheel from `camelot_mixing_stats` — the "am I getting better at mixing" line that has been synced on every set since Story 1.7 and displayed nowhere. *(New)*
10. **Given** plays with no readable key, **Then** `no_key_count` / `excluded_no_key` are disclosed exactly as Story 4.1 AC-6 requires. *(Story 4.1 AC-6)*
11. **Given** a radial chart is not readable as a table by assistive tech, **Then** the wheel ships a text-equivalent naming the top keys and their share, is keyboard-operable if any cell is interactive, and **degrades to a non-radial representation at phone widths if 24 cells cannot each meet the 24×24 target minimum** — a wheel that only works with a mouse on a desktop fails the AA claim this epic makes. *(UX-DR7, UX-DR21, UX-DR22; 4.1's 15×15 tap-target finding)*
12. **Given** a DJ with exactly one set, **Then** both the wheel and the stream render honestly (the stream as a single bucket, not an error) — neither is gated behind the trend sections' insufficient-history state. *(Story 4.7 AC-8; Decision B)*

## Tasks / Subtasks

> Suggested order: read → settle the color mapping (it blocks both the stream and the existing bars) → pure model + summary generators with tests → the two hero components → recompose the view and re-gate → responsive/a11y → verification.

- [ ] **Task 1 — Read before writing** (no AC; prerequisite for all)
  - [ ] Read `web/lib/sets/styleEvolution.ts` in full (757 lines). Note specifically: `CategoryTally` (line 96), `MonthGenreDiversity.breakdown` / `MonthKeyDiversity.breakdown` (both already sorted **descending by count**), `BucketPoint.harmonicMix` (line 156), `BucketSeries = { buckets, excluding, including }`, and the Chart Summary generator block at line 395 with its "one generator, three duties" contract.
  - [ ] Read `web/app/components/style-evolution/StyleEvolutionView.tsx` in full (159 lines) — the composition you are restructuring. Note `points` (line 51), the two disclosure `useMemo`s (64-71), `sectionsReady` (83), the `setCount === 0` early return (91), and the three `<section className="se-section">` blocks (109-145).
  - [ ] Read `web/app/components/style-evolution/TrendChart.tsx` (1241 lines) — at minimum lines 69-120 (`TrendMetric`, `VIEW`, `MAX_CATEGORIES`, `CATCH_ALL_GENRE`), 142-155 (the hydration-rounding comment), 285-315 (`PCT_DOMAIN`, `genreColor`, `keyColor`, `RankedCategory`), 344-380 (the caption + error boundary + `resetKey`), and 460-572 (the `ranked`/`groups`/`barScale` block G-1 and G-3 are about).
  - [ ] Read `web/lib/sets/setDetail.ts` lines 40-110 — `parseCamelot` (strict: 1-12 + A/B, mirrors Rust's `str::parse::<u8>`) and `camelotCompatible` (identical / relative / same-letter ±1 with 12↔1 wrap). **Both already exist. Do not write a second Camelot parser.**
  - [ ] Read `web/app/tokens.css` lines 420-474 — the full `--camelot-1a` … `--camelot-12b` wheel (24 hues, already the exact per-key mapping Tracklist/DetailArc/the key breakdown bars use) and the `--chart-cat-*` block. The wheel's 24 cells map 1:1 onto 24 existing tokens.
  - [ ] Read `web/app/style-evolution.css` lines 60-140 and 251-380 — `.se-tiles` (+ its two media queries), `.se-section`, `.se-disclosure`, `.se-chart*`, and the `::after` tap-target enlargement pattern at line 331.
  - [ ] Read `web/app/no-hardcoded-colors.test.ts` — it walks every `.ts`/`.tsx`/`.css` under `web/app` and fails on any hex/rgb/hsl/oklch/named-color literal outside `tokens.css`. Every new color is `var(--…)`, no exceptions.
  - [ ] Confirm by grep that no wheel/radial/stacked-area component exists anywhere in `web/` today (it does not, as of story creation) — both hero charts are new UI, not a reuse.

- [ ] **Task 2 — Deterministic genre→color mapping** (AC: 3, 4) — *blocks Task 4; resolves G-1 + G-2*
  - [ ] Build a name-keyed, view-independent genre→slot assignment. It must produce the same color for `"techno"` on every bucket, at both granularities, with the reveal on and off, and across reloads. Rank-derived assignment is explicitly forbidden by AC-3.
  - [ ] Handle the two catch-alls distinctly, preserving the 2026-08-06 review's protection: the taxonomy's **literal `"Other"` genre** (a real, playable category from `genre.rs`) and the **fold-the-rest band** must keep separate names *and* separate colors, so the legend still tells them apart. The existing `otherLabel = "Other genres"` idiom (`TrendChart.tsx:485`) is the precedent.
  - [ ] G-2: if 6 named slots + literal-`"Other"` + fold-band exceeds the 7 tokens that exist, extend `tokens.css` with `--chart-cat-7`/`--chart-cat-8` from the `dataviz` skill's 8-hue adjacency-validated order, and **re-run the validation against this app's real chart surface** (`#0a0e13`) as the existing comment documents for slots 1-6. Record the check results in the token comment. AC-4 requires AA contrast **and** colorblind-simulation distinguishability, on **adjacent** bands specifically.
  - [ ] Apply the same mapping to `TrendChart`'s existing genre breakdown bars (G-1's second half) so the two charts in the Genre section never disagree. Note in a code comment that N differs (6 vs 5) **on purpose** per G-3, and that this is not a bug to unify.
  - [ ] Unit-test the stability property directly: same genre name → same color across two different top-N sets and across `excluding` vs `including`.

- [ ] **Task 3 — Pure model + Chart Summary generators** (AC: 1, 7, 8, 9, 10, 11)
  - [ ] Genre share: derive per-bucket 100%-stacked shares from the existing `genreDiversity.breakdown` — **no new pass over `plays`** (AC-1 says so literally). Top-6 by total across the visible series, remainder folded into one disclosed "Other" band (AC-2). A bucket with no categorized plays stays a gap (D-8), never a fabricated all-Other column.
  - [ ] Camelot aggregate: sum `keyDiversity.breakdown` across every bucket of the selected partition into a 24-cell tally (12 numbers × A/B), per G-4. Parse with the existing `parseCamelot`; keys that fail to parse are **not** silently dropped into a cell — count them and route them to the AC-10 disclosure alongside `no_key_count`.
  - [ ] Chart Summary generators, all exported from `styleEvolution.ts` beside the existing ones, all following the "one generator, three duties" contract (one string serves as visible caption, aria text-equivalent, and render-failure fallback — never three strings):
    - [ ] genre-share caption (AC-1/AC-9-equivalent for this chart);
    - [ ] wheel text-equivalent naming **top keys and their share** (AC-11's literal wording);
    - [ ] `harmonicMixSummary` for the new trend (AC-9) — templated direction/from-to in the register `bpmRangeSummary`/`diversityTrendSummary` already use, skipping D-8 gaps when picking first/last, and honoring `spansMultipleYears` for labels.
  - [ ] New `styleEvolution.test.ts` describe blocks for each of the above. Cover: single-bucket input (AC-12), an all-untagged bucket, a bucket whose genres all fold to Other, unparseable Camelot strings, zero scored transitions (`harmonicMix.rate === null`), and the top-6 boundary at exactly 6 and at 7 named genres.

- [ ] **Task 4 — Genre share stream component** (AC: 1, 2, 3, 4, 5, 6, 12)
  - [ ] New component under `web/app/components/style-evolution/`. 100%-stacked bands over the bucket axis. Bands must remain readable at a single bucket (AC-12 — render it as one full-height column, not an error state).
  - [ ] Colors from Task 2 only. `"Other"` is always labeled as an aggregate, never as a genre name (AC-2).
  - [ ] Per G-8: the share math is integer/integer and safe, but round any interpolated percentage to `.toFixed(4)` and any SVG path string to `.toFixed(2)` for consistency with the file family.
  - [ ] AC-5: the existing 2^H `TrendChart` stays in the Genre section as the **secondary** chart — demoted in visual hierarchy, not deleted. AC-6: the existing untagged-plays disclosure line moves with the composition, wording unchanged.

- [ ] **Task 5 — Camelot wheel component** (AC: 7, 8, 10, 11, 12) — *the story's highest-risk component; see G-6 and G-8*
  - [ ] New component: 12 spokes × 2 rings (A inner/outer, B the other — pick and comment which), each cell's **intensity** driven by play count. Adjacent-compatible positions must read as adjacent — that is the whole point of the geometry, and `camelotCompatible` already encodes the rule if you need to verify your layout.
  - [ ] Cell hue: the existing `--camelot-{n}{a|b}` tokens, 1:1 with the 24 cells. Drive intensity via opacity/lightness over the token, never a new color literal (`no-hardcoded-colors.test.ts` will catch you).
  - [ ] **G-8, non-negotiable:** every `Math.cos`/`Math.sin`-derived coordinate is rounded to fixed decimals before it reaches the DOM. This is not defensive polish — it is the precise defect Story 4.7 spent a session root-causing, and a server-rendered trig-based chart reproduces it by construction.
  - [ ] AC-11: ship the text-equivalent from Task 3. Then resolve **G-6** and record it: non-interactive cells (recommended — drops the phone-degradation branch and the keyboard path) *or* interactive cells, in which case both the keyboard path and the non-radial phone fallback are owed in full.
  - [ ] AC-12: renders honestly off one set. AC-8: it reads the reveal-selected partition and is **not** wired to the granularity toggle at all.

- [ ] **Task 6 — Harmonic compatibility trend** (AC: 9, 10)
  - [ ] Add `"harmonic"` to `TrendMetric` and render `harmonicMix.rate` (×100) against the existing `PCT_DOMAIN`, reusing `TrendChart` rather than building a second chart. Add the metric to the error boundary's `resetKey` (G-5).
  - [ ] `excludedNoKey` disclosed per AC-10, with the **same** "never omitted" discipline `no_genre_count` holds to, and worded consistently with Story 4.7's tile-level disclosure so the page does not say the same thing two ways.

- [ ] **Task 7 — Recompose `StyleEvolutionView` and re-gate** (AC: 5, 6, 9, 10, 12)
  - [ ] Genre section: stream (hero) → 2^H trend (secondary) → untagged disclosure. Key section: wheel (hero) → harmonic trend (secondary) → no-key disclosure. Tempo unchanged.
  - [ ] **G-9:** push `sectionsReady` inside Genre and Key so the two heroes always render given ≥1 set, while only the secondary trend charts show `InsufficientHistory`. Tempo stays wholly gated. Leave the `setCount === 0` early return exactly as it is.
  - [ ] **G-7/R-10:** sub-charts must not become landmarks. Keep one `<section aria-label>` per section; use headings or `role="group"` inside.

- [ ] **Task 8 — Responsive + accessibility pass** (AC: 4, 11) — *measure the DOM in a real browser; AC-11 and 4.1's review lesson both require it*
  - [ ] 1440px, 375px, 320px: sections stack, no horizontal overflow, the stream's bands stay legible at the narrow stack width (AC-2's N=6 was ruled partly on this), the wheel fits or degrades per G-6.
  - [ ] Every interactive target ≥24×24 measured via `getBoundingClientRect()`, not eyeballed. Story 4.1's review caught three defects a code-review-instead-of-measurement pass missed; 4.7's caught an 81×17 target the same way.
  - [ ] AC-4: verify adjacent-band distinguishability under protanopia/deuteranopia/tritanopia simulation, on the rendered chart, against the real surface — not from the token hex values in isolation.
  - [ ] Screen-reader pass: both new heroes announce their Chart Summary; landmark count did not grow (R-10); tab order is sensible top-to-bottom.
  - [ ] G-7/R-8: re-check where the first chart lands at 320px now that two more charts exist. `.se-tiles`' `@media (max-width: 480px)` is the knob.

- [ ] **Task 9 — Verification & gates** (AC: all)
  - [ ] Full `web` gate from `web/`: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` — all clean.
  - [ ] **Check your data source before the browser pass.** Story 4.6 landed: `web/lib/sets/index.ts` now reads **Supabase**, not `recent-sets.fixture.json` (its header comment says so explicitly, and the fixtures are retired from the production path). If the environment you point at has no sets, every page renders its empty state and the walkthrough proves nothing. Establish real data first — confirm what the dev environment actually has before concluding a chart "renders correctly."
  - [ ] Hand-built single-set and single-bucket datasets exercised through the builders in the unit suite for AC-12, matching Story 4.1/4.7's precedent of testing sparse states against real builder output rather than mutating shared data.
  - [ ] Zero console errors/warnings on `/style-evolution` at every width — specifically re-check for hydration mismatches after the wheel lands (G-8).
  - [ ] Record every decision from G-1 through G-9 you resolved, as numbered entries in Completion Notes.

## Dev Notes

- **The two hero charts are new UI with no in-repo precedent.** There is no stacked-area and no radial component in `web/` today. What you *do* reuse: `parseCamelot`/`camelotCompatible` (`setDetail.ts`), the `--camelot-*` and `--chart-cat-*` tokens, `TrendChart`'s `PCT_DOMAIN` percentage path, the `dz-shell`/`dz-dots` shell convention, and every per-bucket aggregate `styleEvolution.ts` already computes. Reaching for a charting library would be the wrong move — every chart in this app is hand-rolled SVG + absolutely-positioned HTML, deliberately.
- **`logic in `lib/sets/*`, components stay thin` is this codebase's testing contract.** There is no component-test harness (no `testing-library`, no `jsdom`) and Story 4.7 explicitly declined to invent one. New behavior gets unit coverage at the pure-function layer; component correctness is verified by the real-browser walkthrough. Do not build a component-testing harness as a side effect of this story.
- **Story 4.1's D-9 through D-16 are locked, inherited decisions, not opportunities to reconsider** while you are in this code: Week/Month granularity, `2^H` presentation over raw entropy bits, in-chart category bars, dashed straight bridges across gaps (never curved), dots always drawn, the two-way low-confidence reveal, and year-labeling once the axis spans >12 months.
- **D-8 is the governing honesty rule throughout:** a missing value is a gap, never a fabricated zero. It applies to the stream (a bucket with no categorized plays is not an all-Other column), the wheel (a key with zero plays is an empty cell, not a minimum-intensity one), and the harmonic trend (`rate === null` is a gap in the line).
- **`useSyncExternalStore` is the house pattern for every persisted UI selection in this file family.** If this story needs a new persisted control — it probably does not; AC-8 deliberately keeps the wheel off the granularity toggle — follow `GranularityToggle.tsx`/`ConversionWindowDropdown.tsx`'s exact module-scope `session`/`listeners`/`subscribe`/`getSnapshot`/`getServerSnapshot` shape. Story 4.1's review fixed a `react-hooks/set-state-in-effect` violation from a `useState`+`useEffect` version of this.
- **Worktree discipline.** This story's worktree is `/Users/arjun/.herdr/worktrees/name-pending/story-4-8-genre-share-stream-camelot-wheel`. Story 4.1 lost most of a session to edits landing in `/Users/arjun/Documents/name-pending` instead. Confirm your first Write/Edit resolves inside the worktree before doing substantive work. This project also runs concurrent sessions — expect port 3000 to be taken by someone else's dev server, use another port, and **do not `pkill -f "next dev"`** (Story 4.7 killed a sibling session's server that way).

### Project Structure Notes

- **New:** two components under `web/app/components/style-evolution/` (the share stream and the Camelot wheel); possibly a shared genre-color module under `web/lib/sets/` (Task 2) if it does not fit cleanly as a `styleEvolution.ts` export.
- **Modified:** `web/lib/sets/styleEvolution.ts` (+ `.test.ts`) — share/wheel aggregation over existing breakdowns, three new Chart Summary generators; `web/app/components/style-evolution/StyleEvolutionView.tsx` — Genre/Key recomposition and the per-section gate (G-9); `web/app/components/style-evolution/TrendChart.tsx` — `"harmonic"` metric, `resetKey`, and the Task 2 color-mapping swap; `web/app/style-evolution.css` — new hero-chart classes, possibly the `.se-tiles` 480px reflow (R-8); `web/app/tokens.css` — only if G-2 forces slots 7-8.
- **Unchanged:** `agent/`, `shared/`, `supabase/migrations/`, `web/app/(authenticated)/style-evolution/page.tsx` (the page has had no gate of its own since 4.7 — the gate lives in the view), and `web/lib/sets/index.ts` (the data seam is untouched by this story).

### References

- [Source: epics.md#Story 4.8, lines 913-936] — this story's ACs and design rationale, verbatim; the deliberately-unstoried components note follows at line 937 (treemap, "your average night", BPM ridgeline, rotation in/out, edit detection — **all out of scope here**, parked so they are not re-derived).
- [Source: epics.md#Story 4.7, lines 888-912] — the sections and tile row this story fills; AC-2 (page-level controls) and AC-8 (the gate this story narrows further).
- [Source: epics.md#Story 4.1] — the four-metric baseline; D-1 (genre entropy), D-2 (per-play `camelot_key`, explicitly *not* `camelot_mixing_stats`), D-4 (binary low-confidence), D-5 (month-based gate), D-8 (gap, never a fabricated zero), D-9–D-16 (locked).
- [Source: epics.md#Epic 4 header, Decision B] — go-forward-only; copy is history-as-asset, never a receipt.
- [Source: epics.md#UX-DR6, UX-DR7, UX-DR11, UX-DR17, UX-DR19, UX-DR21, UX-DR22, lines 100-127] — trend-chart language, Chart Summary as both fallback and text-equivalent, the LED/hardware register the wheel borrows, state patterns, the WCAG 2.2 AA floor, and desktop-first-fluid-to-phone responsive.
- [Source: prd.md#FR-9, lines 213-221] — synced 2026-08-07 to the sectioned composition + tile row; this story is a further extension, tracked in epics.md.
- [Source: 4-7-sectioned-style-evolution-summary-tiles.md] — the immediate parent: its Task-3 window-reconciliation decision, its hydration-bug Debug Log entry (G-8's source), R-1 through R-10, and Arjun's ruling carrying five items forward to this story.
- [Source: web/lib/sets/styleEvolution.ts] — `CategoryTally` (96), `MonthGenreDiversity`/`MonthKeyDiversity` (101-117), `MonthHarmonicMix` (130-141), `BucketPoint` (147-157), `aggregateBucket` (209-321), Chart Summary block (395-633), `buildSummaryTiles` (728-756).
- [Source: web/app/components/style-evolution/TrendChart.tsx] — `TrendMetric` (69), `MAX_CATEGORIES`/`CATCH_ALL_GENRE` (77-88), hydration rounding (142-155), `PCT_DOMAIN` (287), `genreColor`/`keyColor` (295-306), `resetKey` (364), the `ranked`/`groups` block (487-549).
- [Source: web/app/components/style-evolution/StyleEvolutionView.tsx] — the composition and gate this story restructures (51-91, 107-156).
- [Source: web/lib/sets/setDetail.ts, lines 47-75] — `parseCamelot`, `camelotCompatible`. Do not reimplement.
- [Source: web/app/tokens.css, lines 420-474] — `--camelot-1a`…`--camelot-12b` (24 cells, 24 tokens) and `--chart-cat-1`…`-6`/`-other` with their validation provenance.
- [Source: web/app/no-hardcoded-colors.test.ts] — the CI-enforced no-color-literals invariant covering all of `web/app`.
- [Source: web/lib/sets/index.ts, header] — Story 4.6 landed; the seam reads Supabase, the sets fixtures are retired from the production path.
- [Source: ARCHITECTURE-SPINE.md#AD-1, AD-3, AD-12] — the edge/cloud aggregation boundary, the frozen `shared/` contract (untouched here), and the taxonomy-version caveat that applies to merging genre breakdowns across buckets.

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-08-08 | Story created via `bmad-create-story`, ready-for-dev. Nine design gaps (G-1…G-9) recorded from a read of the live code against the ACs — most notably that AC-3's forbidden rank-derived color assignment is what `TrendChart` does today and reshuffles on the reveal toggle, that the categorical palette is one-to-two slots short of what AC-2 needs, and that the Camelot wheel's trig reproduces Story 4.7's SSR/hydration defect by construction. |
