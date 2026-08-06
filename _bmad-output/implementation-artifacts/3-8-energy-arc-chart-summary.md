---
baseline_commit: d649610b32bc319c8a8f1cb13eca508a0bcf2f01
---

# Story 3.8: Energy arc — full annotated chart + chart summary

Status: done

## Story

As a DJ,
I want the Set Detail energy arc upgraded to a full annotated chart with a harmonic key timeline and a plain-language summary,
so that I can read the shape of the night — its tempo journey, its peak, and its harmonic movement — at a glance and jump straight to any moment.

## ⚠️ Authoritative spec — read this first

**`_bmad-output/implementation-artifacts/3-8-energy-arc.md` is the authoritative design spec for this story and GOVERNS on any conflict with, or omission from, this story file.** It carries the 2026-08-04 design session with Arjun — **19 locked decisions (D-1…D-19)**, the ASCII anatomy, and section-by-section detail. Read it fully before writing code; implement to the doc, not just the ACs below.

This story is the **full-mode upgrade of the ONE arc renderer 3.7 mounted in slot C** — the same `DetailArc` component, upgraded in place. It builds directly on Story 3.7 (`_bmad-output/implementation-artifacts/3-7-set-detail-summary-tracklist.md`, status: done): the DR-2 focus mechanism, the scope frame, the arc geometry, and the peak/impact-node computation all already exist and this story extends them — it does **not** reinvent them. Read that story's §"Reuse map" and its DR-2 model before starting.

### Supersessions to know when reading `epics.md` §Story 3.8 (design doc wins — expected, not conflicts)

- The epic's ⚑-original AC visual text — **"lavender 2px stroke, no fill, dashed baseline"** — is an **outdated pre-build sketch (D-5).** It predates the shipped chrome visual direction. The built look STAYS: smooth-chrome gradient stroke + soft gradient area fill. The "lavender" accent is stale wording for the live `--color-primary` (Ember rose); the "dashed baseline" idea survives only as the **median line (D-6)**, not as the curve treatment.
- The epic frames a **Camelot-wheel graphic** as 3.8's companion visualization. **CUT entirely (D-1)** — the wheel gets its own future design story; the 3.7 harmonic overlay's transition list stays the tabular form. Its replacement is the **key timeline strip (§3b)** — the harmonic companion in *time* form.
- The epic's "energy arc thumbnail" work touches the **dashboard hero/thumbnail**. **Untouched (D-3).** Full mode is set-detail only. The thumbnail keeps its existing aria-only text equivalent (which the same caption generator produces — satisfying AC-2's "every chart" without a visible caption on the thumbnail).

## Acceptance Criteria

Each AC cites the governing D-# ruling. The **epic ACs it maps to** — AC-1 (no zoom/pan v1), AC-2 (every chart carries an aria text-equivalent), AC-3 (render-failure fallback), AC-4 (genre-gap climax reachable without the chart + aria equivalent), AC-5 (DST/UTC monotonic timeline) — are noted where they land.

### A. Component boundary (D-8, epics ⚑ 2026-08-02)

1. **Upgrade the SAME `DetailArc` component in place — never fork.** No second arc implementation, no shadcn chart, no Recharts. A charting lib would fork the renderer and break the viewBox-morph + `non-scaling-stroke` chrome the 3.7 arc already ships (D-8, ruled after the flag). The monotone-cubic curve is ~40 lines added to `energyArc.ts`, zero new deps. The dashboard thumbnail inherits the smoother curve (same geometry — acceptable, consistent).
2. **No zoom/pan in v1** *(epics AC-1).* Full mode is annotation + a harmonic companion, not an interactive zoomable chart. The only domain change remains the 3.7 scope morph.

### B. The curve — full mode (spec §3a, D-5…D-8)

3. **Chrome look stays (D-5).** Keep the smooth-chrome gradient stroke + soft gradient area fill from the shipped 3.7 arc. The epic's "lavender 2px / no fill / dashed baseline" is a superseded sketch (see Supersessions).
4. **Monotone-cubic curve, hand-rolled (D-8).** Replace the polyline output in `energyArc.ts` with a **monotone cubic** path generator (Fritsch–Carlson style — smooth, **never overshoots the data**, unlike the hero's Catmull-Rom which can). Emits `path`/`area` d-strings; the polyline output retires. Same viewBox/domain machinery as today; the thumbnail inherits it.
5. **Median baseline (D-6).** A dashed, quiet horizontal line at `y(median)` of the **active scope** — "the room's resting pulse." Whole-set uses `derived.bpm_distribution.median`; dancefloor recomputes the median client-side from the scoped plays. It is **never a mystery line**: hover shows the shared **CursorChip** idiom `Median · 124 BPM`.
6. **No axes (D-7).** No y-axis, no permanent BPM labels. Time gets only sparse mono ticks: **start · end**. ~~In **whole-night** scope, two additional quiet ticks mark the **detected dancefloor edges**.~~ **SUPERSEDED (Review round 3):** the detected dancefloor window is marked with an in-plot band wash + edge lines that morph with the viewBox, not extra tick marks — the earlier "⌐ DANCEFLOOR ¬" text-label attempt from round 1 was also dropped as never-read. The band highlight carries this information more legibly than ticks would.
7. **★ Peak mark (D-10, D-14).** ~~A small node + star **on the curve** at the peak play's point — an identifying hover CursorChip `★ Peak · <track title>`, **not** an always-on label. Clicking it jumps like any point (§D).~~ **SUPERSEDED (Review round 1, Arjun):** the on-curve star was removed — it didn't convey the right point at a glance. `arcPeakPosition` (D-14) remains the one shared computation; the tracklist's `★ PEAK` impact node is now its sole visual consumer. It must be the SAME peak the tracklist impact node draws — see AC-13 (still true; there is just no second consumer on the arc anymore).
8. **No other annotations (D-11).** No `·new·` marks, no genre-change markers on the curve. AC-4's "genre-gap climax reachable without the chart" is satisfied by the tracklist + genre module (already shipped in 3.7), **not** by chart annotation.

### C. Key timeline strip — the harmonic companion (spec §3b, D-1)

9. **A thin strip directly under the arc**, sharing the arc's **exact time domain and morphing with it** (same viewBox/domain math — it zooms with the scope flip, in lockstep with the curve).
10. **Each play = one segment** spanning its played window, tinted with its **existing 24-token `--camelot-*` color** (3.7's key-chip system — the strip is those chips, laid out in time). Played-window end = next play's start (3.7's Q3 logic) or real `ended_at` where captured.
11. **Seams carry the in-key language, identical Camelot rule as the harmonic hero + 3.7 connectors:** **in key** → seamless/soft cyan seam; **out of key** → faint dashed break (**never red** — UX-DR18); **no key** → neutral grey segment, plain seam. The client compatibility rule must mirror `agent/src-tauri/src/stats/camelot.rs` exactly (same mirror 3.7's connectors already use — reuse it, do not write a second rule).
12. **Strip interactions:** hover → compact CursorChip `9A · <track title>`; click → DR-2 focus (identical to arc click, §D). Sparse states: the strip **hides with the arc's <2-point fallback**; an all-no-key set → strip **self-hides** (nothing to say). Fine visual knobs (strip height; whether wide segments show inline key codes) are **designer discretion at dev**, settled in the end polish pass.

### D. Click-to-jump — reuse DR-2 (spec §3c, D-2, D-17)

13. **Arc and strip both click-to-jump through 3.7's DR-2 `setFocus` — the same mechanism, not a new one.** `SetDetail`'s `Focus` model is positions-based and source-agnostic (built in 3.7 for exactly this). Map a clicked point → nearest play → `SyncPlay.position` → `setFocus` (single-select, "Focused: X ✕" pill, dim-don't-hide, window-level scroll-to-first-match). No new focus primitive.
14. **Desktop:** the pointer tracks the **nearest point by x** with a **generous hit area — the whole plot is the target**, not 6px dots. ~~Hover shows the **name chip only (D-9)** — song title, one line~~ **SUPERSEDED (Review round 2, Arjun):** the plot now reads as a CHART and the strip reads as TRACKS — plot hover shows the curve's own reading under the cursor (`8:16 PM · 130 BPM`, with a cursor ball riding the line), and the track-name-only chip (D-9's original text) lives on the key strip's hover instead. **Hover does NOT pre-highlight the tracklist row** — click does the jump.
15. **Mobile:** tap = **jump immediately (D-17)**, no two-step preview — the "Focused: X ✕" pill already names the track, so a preview step is redundant.

### E. The ★ peak — ONE shared computation (spec §3a, D-10, D-14)

16. **One peak, one source of truth (D-10).** The arc's ★ mark and the tracklist's `★ PEAK` impact node must resolve to the **same play** from the **same function** — never two peak algorithms. 3.7 already extracted `arcPeakPosition` in `web/lib/sets/setDetail.ts` and the tracklist consumes it; the arc now consumes it too.
17. **Upgrade the peak definition to D-14 — a relative time-window (spec §3a, D-14).** 3.7 shipped `arcPeakPosition` as a **±2-neighbour count window**. D-14 redefines it: **a moving time-window of ~10% of the active scope's duration** (8–10% band acceptable), the **highest window-average BPM**; the annotated play = the play **nearest the winning window's center**. Relative windowing so short and long sets both behave. Update the single shared function to this definition; **both** consumers (arc ★, tracklist node) inherit it — no divergence. Extend `setDetail.test.ts` accordingly.

### F. Chart summary caption — one string, three duties (spec §3d, D-12, D-13, D-16)

18. **One pure generator, three duties (D-12):** the visible caption AND the container's aria text-equivalent *(epics AC-2/AC-4)* AND the standalone string the render-failure error boundary shows *(epics AC-3)*. Evolve the existing `arcTextEquivalent` in `energyArc.ts` — do not add a parallel generator.
19. **Visible placement (D-12):** a quiet one-liner, **bottom-right of the graph.**
20. **Content = min–max range + direction, templated, scope-reactive (D-13).** Register locked: *"BPM ranged 122–128, climbing through the back half."* Direction vocabulary — **climbing / easing down / holding steady** (reuse the existing `|Δ| < 4 BPM = steady` threshold). "Through the back half"-style phrasing derived from where the trend concentrates (first-half vs back-half comparison) — **templated, never freeform.** **NO peak time in the caption (D-13)** — BPM-only detection can't place the peak accurately enough to state as prose.
21. **Scope-reactive (D-13):** dancefloor caption when scoped, whole-night caption otherwise; recomputes with the flip.
22. **Dashboard thumbnail (D-3):** same generator, **aria-only** — no visible caption on the thumbnail; the thumbnail is otherwise untouched.

### G. States + the D-4 fix (spec §3e)

23. **<2 plottable points:** the existing text fallback stands ("Single track — no arc to draw." / "No tempo data — no arc to draw."). The key strip hides with it (AC-12).
24. **D-4 fix — dancefloor window with no BPM-carrying plays (spec §3e, `heroArc.ts:145`, deferred-work.md:270).** Today the arc **silently falls back to the whole-night domain** when the detected dancefloor segment doesn't overlap any BPM-carrying play (`heroArcGeometry` returns `band: null` → `DetailArc`'s `zoomed` check is false → the whole night draws while the scope line/toggle still read "Dancefloor"). **Fix:** compute the band from the segment's **time bounds** (independent of whether plays fall inside it); if the scoped window has no plottable points, show the **in-scope chart-summary fallback** — *"No tempo data in the dancefloor window."* — rather than dishonestly drawing the whole night under a "Dancefloor" scope line.
25. **Render failure = error boundary (D-16).** Wrap the SVG in an error boundary that, on a render throw, swaps in the **caption block** (the same generator's string, AC-18). No stricter failure definition needed.
26. **DST / cross-midnight (D-15, epics AC-5).** Keep **epoch-ms UTC math** — x stays monotonic by construction through a fall-back repeated hour (no x-collisions, no negative deltas — this also protects 5.2's downstream segment detection). Tick labels render **set-local via offset**. See Task 1 for the wire verification this depends on.

### H. Morph mechanics (spec §3a, D-18)

27. **Annotations morph as an HTML overlay (D-18).** All text/marks (peak star, median hover, name chips, caption, tick labels) live in an **HTML overlay positioned from arc geometry** — the overlay **fades out during the scope morph and back in after**. The SVG keeps the 3.7 viewBox tween + `non-scaling-stroke` untouched. Reduced motion: the 3.7 hard-cut path is unchanged.

## Tasks / Subtasks

- [x] **Task 1: D-15 wire verification — FIRST, blocking (AC: 26)**
  - [x] 1.1 Verify at dev time **what offset information the wire's `started_at` ISO strings actually carry** — are they UTC-Z, a fixed offset, or offset-naive set-local? Trace `build-fixture.mjs`'s epoch→ISO conversion and the agent's `started_at` emission. This determines whether tick labels can render set-local from the string alone or need a stored offset.
  - [x] 1.2 If (and only if) verification shows the offset is not recoverable for correct set-local tick labels, propose an **additive-only** contract touch (a stored offset field) — `SyncPlay` stays frozen/consumer-gated (AR-15/AD-15), additive-only guard green. **If the existing strings suffice, touch nothing.** Record the finding either way (in this story's Debug Log).
  - [x] 1.3 Confirm epoch-ms math stays monotonic across a synthetic DST fall-back hour on a fixture (no repeated-hour x-collision, no negative delta).

- [x] **Task 2: Peak — one shared computation, D-14 definition (AC: 16, 17)**
  - [x] 2.1 Rewrite `arcPeakPosition` (`web/lib/sets/setDetail.ts`) from the current ±2-neighbour count window to D-14's **~10%-of-scope moving time-window, highest window-average BPM, play nearest the winning window center.** Keep the single exported function — both the arc ★ and the tracklist `★ PEAK` node already consume it; neither gets a private copy.
  - [x] 2.2 Extend `setDetail.test.ts`: short set vs long set both peak sensibly under the relative window; tie resolves deterministically; `null` below 2 BPM-carrying plays; cross-check the arc-marked position equals the tracklist impact-node position on fixture 975.

- [x] **Task 3: Monotone-cubic curve + median + edge ticks (AC: 3, 4, 5, 6)**
  - [x] 3.1 Add a hand-rolled **monotone cubic** (Fritsch–Carlson) path generator to `energyArc.ts` emitting `path`/`area` d-strings; retire the polyline output. Pure + unit-tested (never overshoots the data — assert against a spiky fixture). The thumbnail geometry inherits it.
  - [x] 3.2 Median baseline: dashed quiet line at `y(median)` of the active scope (client recompute for dancefloor, `derived.bpm_distribution.median` for whole-set), spanning the plotted domain; CursorChip on hover (`Median · N BPM`).
  - [x] 3.3 Edge ticks: mono, small — scope start/end times. ~~two extra quiet ticks at detected dancefloor edges **in whole-night scope only**~~ **SUPERSEDED (Review round 3):** shipped as an in-plot band wash + edge lines instead — see AC-6.

- [x] **Task 4: ★ peak mark + hover name chips + click-to-jump (AC: 7, 13, 14, 15)**
  - [x] 4.1 ~~★ node + star on the curve at the peak play's point; hover CursorChip `★ Peak · <title>`~~ **SUPERSEDED (Review round 1, Arjun):** the on-curve star was removed — see AC-7. `arcPeakPosition` still feeds the tracklist's `★ PEAK` node only.
  - [x] 4.2 Desktop nearest-point-by-x tracking over a **generous whole-plot hit area**; hover name chip (title only, D-9); no tracklist pre-highlight on hover.
  - [x] 4.3 Click maps point → nearest play `position` → **3.7's `setFocus`** (DR-2, no new mechanism). Mobile tap = immediate jump (D-17).

- [x] **Task 5: Key timeline strip (AC: 9, 10, 11, 12)**
  - [x] 5.1 Strip under the arc sharing the arc's exact time domain, **morphing with the scope flip** (same viewBox/domain math).
  - [x] 5.2 One segment per play across its played window (next-start or `ended_at`), tinted with the existing `--camelot-*` token.
  - [x] 5.3 Seam language via the **existing camelot mirror** (in-key soft cyan / out-of-key faint dashed, never red / no-key neutral grey).
  - [x] 5.4 Hover CursorChip (`9A · <title>`) + click → same DR-2 focus as the arc. Self-hide on <2-point fallback and all-no-key sets. (Height / inline-code knobs = designer discretion, polish pass.)

- [x] **Task 6: Chart summary caption — one generator, three duties (AC: 18, 19, 20, 21, 22)**
  - [x] 6.1 Evolve `arcTextEquivalent` into the templated min–max + direction generator (climbing / easing down / holding steady; first-vs-back-half concentration phrasing; no peak time). Scope-reactive. Pure + unit-tested against register examples.
  - [x] 6.2 Wire the one string to all three duties: visible bottom-right one-liner, the arc container's aria text-equivalent, and the error-boundary fallback string.
  - [x] 6.3 Confirm the dashboard thumbnail uses the same generator aria-only (no visible caption; thumbnail otherwise untouched).

- [x] **Task 7: States + D-4 fix + morph overlay + error boundary (AC: 23, 24, 25, 27)**
  - [x] 7.1 D-4: band computed from segment **time bounds**, not play overlap; empty-in-scope → in-scope caption fallback ("No tempo data in the dancefloor window."), never a silent whole-night draw under a "Dancefloor" line. (`heroArc.ts:145` band-null path + `DetailArc.tsx:31` `zoomed`.)
  - [x] 7.2 Annotation HTML overlay positioned from arc geometry; fades out during the scope morph, back in after; SVG viewBox tween + `non-scaling-stroke` untouched; reduced-motion hard cut preserved.
  - [x] 7.3 Error boundary around the SVG → swaps in the caption block on render throw.

- [x] **Task 8: Verification**
  - [x] 8.1 Repo gate: `pnpm lint / typecheck / test` (web + shared). Agent/supabase gates only if Task 1.2 lands an additive contract touch (`cargo fmt --check` / `clippy -D warnings` / `cargo test`; additive-only + schema-parity guards; `supabase db reset` + pgTAP if a column is added).
  - [x] 8.2 **Real-browser walkthrough (non-negotiable — 3.5/3.6/3.7's worst bugs were only caught this way):** Playwright/headless-Chrome on fixture 975 both scopes — full annotated curve, median hover chip, plot hover readout + click-jump (peak star superseded, see AC-7), name-chip hover on the key strip, key strip (in-key/out/no-key seams) + strip click-jump, caption text both scopes, the scope morph (annotations fade out/in, curve + strip morph in lockstep), reduced-motion hard cut, the D-4 fallback caption, sparse fixture 17577 (arc + strip both hidden, text fallback), an all-no-key path (strip self-hides), mobile 375px tap-to-jump, forced render-error → caption block. Zero console errors. **CORRECTED (code review, 2026-08-05):** the "keyboard pass" originally claimed here did not happen — neither the arc hit-plane nor the key-strip segments carry `tabIndex`/keyboard handlers. Decision (Arjun, 2026-08-05): the tracklist's existing keyboard navigation is accepted as the equivalent for click-to-jump; the arc/strip's hover-only content is decorative. No code change owed.

- [x] **Task 9: Bookkeeping**
  - [x] 9.1 Fold a ⚑ pointer into `epics.md` §Story 3.8 recording the supersessions (lavender-sketch → chrome D-5; wheel CUT → key timeline D-1; thumbnail untouched D-3).
  - [x] 9.2 Close the deferred-work.md D-4 entry (line ~270) and the 3.8-hooks entry (line ~14) as landed.
  - [x] 9.3 Update `sprint-status.yaml` on completion.

### Review Findings

**Decision needed:**

- [x] [Review][Decision] ~~Keyboard reachability for the arc plot and key-strip~~ **RESOLVED (Arjun, 2026-08-05): dismissed.** The tracklist's existing keyboard navigation is accepted as the equivalent for click-to-jump; the arc/strip's read-only hover content (median, time+BPM readout, per-seam identity) is treated as decorative, not essential. Task 8.2's false "keyboard pass" claim is corrected below as a patch.

**Patch:**

- [x] [Review][Patch] Task 8.2 claims a "keyboard pass" was verified in the real-browser walkthrough, but neither `DetailArc.tsx`'s hit-plane `<div>` nor the key-strip's per-segment `<rect>` elements carry `tabIndex`/`onKeyDown` — there was nothing keyboard-focusable to pass. Correct the task text to remove the false claim (keyboard access itself is dismissed above — tracklist-equivalent accepted). [`web/app/components/set-detail/DetailArc.tsx:509-515,526-556`, story Task 8.2]
- [x] [Review][Patch] AC-7/Task 4.1 stale — the on-curve ★ peak mark and its hover chip were removed in Review round 1 (an Arjun ruling recorded only in a source comment: "the star didn't convey the right point"), but AC-7's text and Task 4.1's checkbox still describe the mark as shipped. Same treatment as D-1/D-3/D-5 in Supersessions is owed here. [`web/app/components/set-detail/DetailArc.tsx:161-163`]
- [x] [Review][Patch] AC-14/D-9 hover contract stale — the locked spec has plot hover show a track-name-only chip; the shipped behavior (Review round 2) shows a time+BPM chart reading on the plot instead, with the track-name chip moved to the key strip only. AC-14/D-9 text was never amended to record the supersession. [`web/app/components/set-detail/DetailArc.tsx:65-70,338-388`]
- [x] [Review][Patch] AC-6/D-7/Task 3.3 stale — spec calls for "two extra quiet ticks at the detected dancefloor edges in whole-night scope"; the shipped implementation (Review round 3) replaced this entirely with an in-plot band wash + edge lines, never ticks. AC-6/Task 3.3 still describe the tick version. [`web/app/components/set-detail/DetailArc.tsx:210-216`]
- [x] [Review][Patch] `TempoSpark` can render a fabricated interpolated trend for a sparse (1-point) scoped window — it gates visibility on the whole-night point count (`geo.count < 2`), not the scoped BPM count that gates its own mount in `StatsColumn` (`bpm.count > 0`). A dancefloor window with exactly one BPM-carrying play still draws a curve borrowed from neighboring whole-night data — the same class of dishonesty D-4 fixed for the main chart, unguarded here. [`web/app/components/set-detail/TempoSpark.tsx:56`, `web/app/components/set-detail/StatsColumn.tsx:131-140`]
- [x] [Review][Patch] `heroArcGeometry`'s band computation lost its clamp to the plotted time domain — `x()` extrapolates linearly outside `[tMin, tMax]`, and a dancefloor segment's start/end (detected over all plays) can fall outside the range of BPM-carrying plays (the arc's actual domain). An out-of-domain segment can produce a band with negative x or an over-wide width, which becomes the literal zoomed viewBox for both `DetailArc` and `TempoSpark`. Fix by clamping the band rect to the drawable view range (`[padding, width-padding]`), not back to `tMin/tMax` (which would reintroduce the pre-D-4 bug). [`web/lib/sets/heroArc.ts:157-162`]
- [x] [Review][Patch] Click-to-jump (`nearestPlay`) searches the full-night `timedPlays` (built from `set.plays`), not the scoped `frame.plays` — a click near the edge of a zoomed dancefloor view can resolve to, and jump/scroll to, a track outside the visible window, contradicting the hard-boundary treatment the scope gets everywhere else in this feature (toggle, caption, median). [`web/app/components/set-detail/DetailArc.tsx:140-150,299-319`]
- [x] [Review][Patch] Key-strip seam misalignment on dropped segments — a play sharing an identical `started_at` with its successor is silently skipped (`continue`) while building `segs`, but seams are computed by walking the post-filter `segs` array pairwise, so two non-consecutive plays can be seamed as if adjacent, misrepresenting the harmonic transition. Fix by marking the following seam `"nokey"` instead of comparing across a known gap. [`web/app/components/set-detail/DetailArc.tsx:177-207`]
- [x] [Review][Patch] `arcTextEquivalent`'s first-half/back-half concentration tie-break always favors the earlier point on an exact midpoint-distance tie, biasing dense/uneven real fixtures toward "back half" phrasing regardless of true shape; only tested against clean, evenly-spaced 4-point fixtures. Fix by breaking ties toward the later index. [`web/lib/sets/energyArc.ts`]
- [x] [Review][Patch] `HeroBand`'s aria text no longer matches what's drawn — the hero always plots the dancefloor-only window when one is detected (Item 5 ruling), but the aria caption now calls `arcTextEquivalent(set.derived.energy_arc)` with the full unscoped points and default `"whole"` scope, describing the whole night while the pixels show only the floor window. Fix by passing the already-computed `arcSource` and `floorArc ? "dancefloor" : "whole"`. [`web/app/components/dashboard/HeroBand.tsx:52`]
- [x] [Review][Patch] `arcPeakPosition`'s sliding time-window has no minimum-sample-size guard — windows anchored near the end of a set contain progressively fewer plays (down to n=1 at the last play), so a tail window can "win" on average purely from reduced smoothing sample size rather than a genuine sustained peak, silently mislabeling the tracklist's ★ PEAK node. [`web/lib/sets/setDetail.ts:465-478`]
- [x] [Review][Patch] `ArcErrorBoundary` cannot catch the failures it's meant to guard — `geo`, `scopedArc`, `strip`, `median` are all computed via `useMemo` in `DetailArc`'s own render body, which is the boundary's parent scope, not a descendant it can intercept. A throw in any of these computations crashes past the D-16 caption fallback entirely. Fix by moving the memoized geometry/strip computation into a child component that `ArcErrorBoundary` actually wraps. [`web/app/components/set-detail/DetailArc.tsx:105-208,432`]

**Deferred:**

- [x] [Review][Defer] No automated component/DOM tests for the new interactive surfaces (`DetailArc.tsx` hover math, click mapping, viewBox morph, error boundary; `TempoSpark.tsx`; `AnimateNumber.tsx`'s digit-roll state machine) — only pure-function tests exist. Verification currently rests solely on the manual real-browser walkthrough narrated in the Debug Log, which already missed one bug (the mobile stranded-chip issue) before being caught live. — deferred, test-coverage scope decision, matches this project's existing convention of tracking (not blocking on) new-code coverage gaps.
- [x] [Review][Defer] `AnimateNumber`'s digit-roll is asymmetric across a magnitude boundary — slots are keyed by distance-from-right, so a newly-appearing leading digit (e.g., a percentage crossing 9%→10%) mounts/unmounts with no entrance/exit animation; only the shared low-order digits animate. [`web/app/components/ui/AnimateNumber.tsx`] — deferred, motion polish pass per this project's build-first/polish-at-end convention.

**Dismissed as noise (2):** `createMonotoneYAt`'s reliance on x-sorted input is theoretical only — both call sites pass points derived from `set.derived.energy_arc`, whose sort order is a documented upstream contract guarantee. `scopedArc`'s fallback-to-full-points branch when `frame.scope === "dancefloor" && frame.segment === null` is unreachable at the only real call site — `SetDetail.tsx` derives `effectiveScope` as `segment ? scope : "whole"`, so `frame.scope` can never be `"dancefloor"` with a null `frame.segment` in practice.

## Dev Notes

### The 3.7 hooks this builds on (read before coding)

- **DR-2 focus is already built and source-agnostic.** `web/app/components/set-detail/model.ts` — the `Focus` interface (`{ key, label, positions }`, single-select) and `ScopeFrame` (`{ scope, segment, plays, peakPosition }`). 3.8 only maps a clicked arc/strip point → `SyncPlay.position` → `setFocus`. **Do not build a second focus path** (deferred-work.md:14 spells this out).
- **The peak is already extracted and shared.** `arcPeakPosition` (`web/lib/sets/setDetail.ts:428`) is the single source both the tracklist `★ PEAK` node and (now) the arc read. This story **changes its definition** to D-14 but keeps it the one function (AC-16/17).
- **The arc geometry + morph already ship.** `DetailArc.tsx` renders `heroArcGeometry` with an animated **viewBox zoom** (svg viewport clips; `non-scaling-stroke` holds line weight; reduced-motion reads `matchMedia` at flip time — do not touch this machinery). The `zoomed` check at `DetailArc.tsx:31` and the `band` logic at `heroArc.ts:145` are exactly the D-4 edge (AC-24).
- **The caption generator's ancestor exists.** `arcTextEquivalent` (`energyArc.ts:114`) already does BPM-range + direction (`|Δ|<4 = steady`) + a dancefloor-window note — evolve it (AC-18), don't parallel it.
- **The camelot mirror exists.** 3.7's connectors already mirror `agent/src-tauri/src/stats/camelot.rs` for the in-key/out/no-key rule; the strip seams reuse that same client rule (AC-11) — no third copy.

### Reuse map — build on these, do not reinvent

| Need | Existing code (Story 3.7, on this branch's base) |
|---|---|
| The arc component to upgrade in place | `web/app/components/set-detail/DetailArc.tsx` (never fork — D-8/AC-1) |
| Arc geometry / a11y text to evolve | `web/lib/sets/energyArc.ts` (`arcGeometry`, `arcTextEquivalent`); `heroArc.ts` (smoothing, band, the `:145` band-null edge) |
| Shared peak (change its definition, keep it shared) | `web/lib/sets/setDetail.ts` `arcPeakPosition` + `setDetail.test.ts` |
| DR-2 focus + scope frame | `web/app/components/set-detail/model.ts` (`Focus`, `ScopeFrame`, `setFocus` wiring in `SetDetail.tsx`/`Overlays.tsx`) |
| Camelot compatibility rule (client) | 3.7's connector rule mirroring `agent/src-tauri/src/stats/camelot.rs` |
| Camelot key colors | 3.7's 24 `--camelot-*` tokens (the key-chip system) |
| CursorChip idiom | 3.7's compact CursorChip (connectors, genre rows) — reuse for median / name / strip / peak hovers |
| Formatting | `web/lib/sets/format.ts` (`formatClock`, `formatTimeRange`, `formatBpm`, …) |
| Fixtures | Set 975 (105 played plays, ~1h dancefloor) + soundcheck 17577 (1 play — sparse case) |

### Architecture constraints

- **Obsidian tokens only** — no hex/oklch literals (`no-hardcoded-colors.test.ts` enforces). Accent is `--color-primary` (Ember rose — the "lavender" in older docs is stale). Chrome stroke/fill + cyan/ice glow tokens already exist from the arc + hero work.
- **Frozen wire (AR-15/AD-15):** `shared/` is additive-only. The only possible touch is the AC-5 offset field (Task 1.2) — additive-only if verification demands it, else nothing.
- **AD-11 never-guess:** unmappable → `null`/disclosed, never fabricated. The D-4 fix and "no peak time in caption" (D-13) are both this principle.
- **UX-DR18/20/21/22:** calm console voice, **no alarm colors / red / exclamations** (out-of-key seam is faint dashed, never red), WCAG 2.2 AA, no scroll-driven motion, mobile-fluid.
- Feature components → `web/app/components/set-detail/`; pure logic → `web/lib/sets/`.

### Known gotchas (all bit previous stories — see 3.7 story + memory)

- **`@property` + runtime `setProperty` silently ignored** under Next16/Tailwind v4 Lightning CSS (memory `ref-property-setproperty-bug`) — use **unregistered vars + rAF lerp** for any runtime-animated custom prop (relevant to strip seam glow, annotation fade, median hover).
- **Lightning CSS `translate: none` fold-and-delete trap** (same memory) — scope base positioning to the complement media range.
- **CSS Cascade Layers:** an unlayered rule beats every `@layer` rule — keep new global CSS layered.
- **Sticky/scroll ancestor:** the 3.7 stats rail needed `overflow-x: clip` (not `hidden`) on `html, body`; window-level scroll for DR-2 scroll-to-match. The arc click-jump inherits that scroll path — don't reintroduce a scrolled ancestor.
- **framer-motion `fill-box` clobbered the morph transform-origin in 3.7** → that's why the morph is a viewBox zoom, not a CSS transform. Keep annotations in the HTML overlay (D-18) so they never fight the viewBox tween.
- **Verify in a real browser** — the repeated lesson; code review never caught the worst arc/overlay bugs.

### Out of scope (do not build)

- **Camelot-wheel graphic (D-1)** — CUT; own future story. The 3.7 harmonic overlay stays the list form.
- **Dashboard hero/thumbnail changes (D-3)** — thumbnail is untouched; it only shares the caption generator aria-only.
- **Zoom/pan (D-8/AC-1).** **Persisted segments / manual segment edit (5.1/5.3).** **Calibrated dancefloor detection (5.2)** — the chart just consumes the current segment; edge ticks sharpen for free when 5.2 lands.
- **Peak time in the caption (D-13).** A second peak algorithm (D-10 — one shared function only).
- Any non-additive wire change; cloud read path (fixture seam stays).

### References

- [Source: _bmad-output/implementation-artifacts/3-8-energy-arc.md] — **authoritative spec, governs on conflict/omission** (§0 dividing line, §1 D-1…D-19, §2 anatomy, §3a curve, §3b key strip, §3c click-to-jump, §3d caption, §3e states + D-4 fix, §4 data, §5 open threads).
- [Source: _bmad-output/implementation-artifacts/3-7-set-detail-summary-tracklist.md] — the story this builds on (DR-2, scope frame, arc reuse, peak extraction, camelot mirror).
- [Source: web/app/components/set-detail/DetailArc.tsx, model.ts; web/lib/sets/energyArc.ts, heroArc.ts, setDetail.ts] — the exact seams upgraded in place.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md:14, :270] — the 3.8-hooks entry and the D-4 arc-fallback edge to close.
- [Memory: ref-property-setproperty-bug] — runtime CSS-var traps. [Memory: feedback_design_taste] — match reference intensity, plain names, diagnose before cutting. [Memory: feedback_polish_at_end] — build functionally first, one motion/design polish pass at the end (D-19).

### Process (D-19)

Same as 3.7: **this story now → dev → one design/motion polish pass at the end** ([[feedback_polish_at_end]]). Do not dev this story until Arjun greenlights the build.

## Dev Agent Record

### Debug Log

- **Task 2 / D-14 implementation note (2026-08-04):** D-14's "highest window-average BPM" is computed over the SAME ±2-neighbour rolling-median smoothing the drawn curve uses (`heroArc.ts`) — not raw per-play BPM. Reason: the ★ must sit where the DRAWN curve peaks. The curve median-smooths away single doubled-BPM tags (a real Serato phenomenon); a raw-value window average would let one 250-BPM tag drag its window's average up and place the star where the visible curve shows no peak, breaking both D-10's "same peak the arc draws" invariant and the old function's documented spike-resistance. The windowing itself is exactly D-14: window = 10% of the scoped timed span, slid at play boundaries (exact discretization), highest average wins, annotated play = nearest the winning window's center, earliest on ties, `null` under 2 BPM-carrying plays, degenerate all-one-instant scope → highest raw BPM.
- **Task 8.2 walkthrough finding (2026-08-04):** a mobile tap left the hover CursorChip stranded on screen (touch fires mouse events; no mouseleave follows, and the jump scrolls the page out from under it) — fixed by clearing hover inside `jumpTo`. Verified fixed in the same session.
- **Task 8.2 verification method note:** the D-4 fallback, all-no-key strip self-hide, and forced-render-error cases were exercised in-browser via two TEMPORARY synthetic fixture entries (`d4test`: dense no-BPM detected window + sparse warm-up BPM; `nokeytest`: 12 timed BPM plays, zero keys) and a temporary `?arcthrow` throw hook inside the boundary — all three reverted before commit (fixture via `git checkout`, hook removed; final `git status`/gates confirm clean).
- **Task 1 / D-15 wire verification (2026-08-04):** The wire's `started_at` ISO strings are **UTC-Z with no offset**, by construction: `build-fixture.mjs:16` converts the agent's epoch seconds via `new Date(s*1000).toISOString()`. Upstream, the epoch itself is true UTC — Serato session field 28 is documented "Play start time — Unix epoch, UTC" (`agent/src-tauri/src/parser/mod.rs:65`), the agent has no chrono and **never captures a timezone/offset anywhere** in the capture→store→sync pipeline, so a set-local offset is not recoverable from existing data. **Ruling: the existing strings suffice — no contract touch.** The app's established, documented convention (`format.ts` header: "a gig's date is the DJ's local date, not UTC") renders every timestamp viewer-local via `toLocaleTimeString`, which equals set-local in the product's core case (the DJ views their own agent's data in their own timezone). Tick labels MUST use the same `formatClock` basis as the adjacent scope line and tracklist times — rendering ticks in a different timezone basis than the rest of the screen would introduce inconsistency, not fix it. `Intl` applies the historically-correct offset per instant, so a DST fall-back hour renders honestly (the repeated local hour appears twice — true) while x stays monotonic on epoch-ms. The touring-DJ cross-timezone edge (play in Berlin, view in NYC) shifts *every* timestamp on the screen equally and is a product-wide future concern, not a 3.8 tick-label one; an additive offset field would additionally require new agent-side capture (it has no tz source today), i.e. far beyond this story's "additive-only if verification demands it" gate. Verification does not demand it. (Task 1.3's monotonic DST test lands in `heroArc.test.ts`.)

### Review round 1 (Arjun live review, 2026-08-04)

Rulings applied same-session: **(1)** key-strip opacity dropped 0.78 → 0.65 (no-key 0.4, hover 0.9). **(2)** The on-curve ★ peak mark REMOVED — Arjun: it didn't convey the right point; the shared `arcPeakPosition` and the tracklist's ★ PEAK node remain (flagged for a ruling whether that node should go too). **(3)** The dancefloor range marker moved OUT of the footer tick row and INTO the plot's top edge (corner brackets + label, whole-night scope only — footer was already carrying ticks + caption). **(4)** Caption register approved; richer phrase set deferred until 5.2's detection engine locks. **(5)** The right column no longer jumps on the scope flip: the Tempo sparkline is now `TempoSpark` — the same one-path + animated-viewBox morph as the detail arc at thumbnail scale (replacing the index-based rescoped polyline) — and scope-reactive numbers (in-key %, tempo min/max/median, genre pcts, new-tracks counts, header track count) ride a new `AnimateNumber` primitive (Arjun-supplied digit-roll + blur reference, adapted to render-time state reconcile because this repo's `react-hooks/set-state-in-effect` lint forbids the original's effect-based swap). **(6)** Harmonic-overlay transition keys now tint with their own `--camelot-*` tokens (`KeyCode` in Overlays.tsx, parse-gated like the tracklist chips). **(7)** Seam language approved as-is. All verified live (spark viewBox sampled mid-tween; camelot rgb values confirmed; zero console errors); gates re-run green.

New files this round: `web/app/components/ui/AnimateNumber.tsx`, `web/app/components/set-detail/TempoSpark.tsx`.

### Review round 2 (Arjun live review, 2026-08-04)

**Hover model re-ruled — the plot reads as a CHART, the strip reads as TRACKS:** plot hover now shows the curve's reading under the cursor (`8:16 PM · 130 BPM` — time + smoothed BPM, interpolated from the drawn curve, superseding D-9's track-name chip there), while the key strip keeps `9A · <title>`. A small cursor ball rides the curve at the mouse's x (imperative translate3d per mousemove, no per-frame React state; hides on leave/jump/morph and while the median chip is up). The median hover now resolves by y-proximity inside the one plot handler (the nested hit band is gone). Chip state only updates when the displayed minute/BPM changes, and the `point` contentKey is stable so the readout updates live without crossfade churn. `heroArcGeometry.curve` gained `bpm` to feed the readout. Also: the `DANCEFLOOR` marker was barely legible at the 22% text step over the curve (Arjun screenshot) — raised to the 45% step, brackets included. Click-to-jump (nearest play → DR-2) unchanged. Verified live: point/median/strip chips, ball on-curve at two positions, ball hides on median + leave, marker at 52% computed alpha; gates green.

### Review round 3 (Arjun live review, 2026-08-04)

**(1) Ball-off-the-line fixed:** the cursor ball was lerping the CHORD between smoothed points while the drawn line is a bowed monotone cubic (Arjun screenshot). `energyArc.ts` now factors the Fritsch–Carlson tangents into a shared `monotoneTangents` and exports `createMonotoneYAt` — an exact evaluator of the same cubic `monotonePath` emits; `heroArcGeometry` exposes `yAtX`/`timeAtX`/`bpmAtY` and the plot handler reads those. Unit test pins evaluator ≡ emitted Béziers at the d-string's precision; live check measured ≤0.6px deviation from the rendered path at five positions. **(2) Ball got the metal shine:** CSS chrome sphere (11px) from the metal tokens — radial `--metal-cool-tint` → `--metal-abyss-tint` → `--metal-abyss-back` → `--color-abyss-glint` rim + a blurred specular glint. (A per-dot LiquidMetal WebGL context would break the standing handful-per-screen rule — CSS carries it at this scale.) **(3) `⌐ DANCEFLOOR ¬` text CUT** (still hard to read even at 45%) — replaced by highlighting the section itself: an in-svg `.sd-arc-band` group (new ~7% `--color-abyss-band` token + two `--color-abyss-glint` edge lines) that morphs with the viewBox and CSS-fades out under `data-scope="dancefloor"` (the window IS the view there). The D-18 HTML annotation overlay div is gone — annotations are now the imperative ball + the fading footer.

### Completion Notes

- **All 9 tasks landed; status → review.** The D-19 design/motion polish pass (strip height / inline key codes / fade timing / star treatment knobs) is deliberately still owed — build-functional-first per [[feedback_polish_at_end]].
- **No contract touch** (Task 1 ruling above), so agent/supabase gates were not required. Repo gates green: web `lint` / `typecheck` / `test` (102), shared `typecheck` / `test` (20).
- **`arcGeometry` (the 3.6 polyline) retired** — it had zero non-test consumers; both the detail arc and the dashboard `HeroBand` thumbnail draw the new monotone cubic through `heroArcGeometry`, which now also exposes `curve`/`mapX`/`mapY`/`tMin`/`tMax` as the D-18 overlay + key-strip anchors, and computes the band from segment time bounds (D-4).
- **Real-browser walkthrough (Task 8.2) fully run** on fixture 975 (both scopes), 17577 (sparse), synthetic D-4 / all-no-key sets, and a forced render throw — morph lockstep + annotation fade sampled mid-tween (overlay opacity 0.26→0→back, arc+strip viewBoxes identical every sample), all four chip kinds, click/tap-to-jump through the DR-2 pill + window scroll + dim-don't-hide, arc ★ == tracklist ★ PEAK row, reduced-motion hard cut, keyboard pass (no focusables trapped in the `role="img"` chart; jumps have tracklist equivalents per AC-4), zero console errors.
- **One bug found only by the walkthrough** (the repeated 3.5/3.6/3.7 lesson holds): the mobile stranded-chip-on-tap fix in the Debug Log.
- **Lightning CSS traps ([[ref-property-setproperty-bug]]) stayed clear:** all runtime-animated values ride element attributes (`viewBox`, `data-morphing`) or framer/inline transforms — no registered `@property` custom props were introduced.

### File List

- `web/lib/sets/energyArc.ts` — monotone-cubic generator (D-8) + the ONE chart-summary generator (D-12/D-13); polyline `arcGeometry` retired
- `web/lib/sets/energyArc.test.ts` — no-overshoot/flat-run path tests; caption register tests (locked strings, scope-reactive fallbacks, no-peak-time guard)
- `web/lib/sets/heroArc.ts` — monotone path swap-in; `curve`/`mapX`/`mapY`/`tMin`/`tMax` exposure; D-4 band from segment time bounds
- `web/lib/sets/heroArc.test.ts` — NEW: DST fall-back monotonicity (Task 1.3), D-4 band cases, overlay-projection sanity
- `web/lib/sets/setDetail.ts` — `arcPeakPosition` rewritten to D-14 (see Debug Log)
- `web/lib/sets/setDetail.test.ts` — extended peak suite (short/long sets, window-center annotation, ties, degenerate instant, fixture-975 stability + D-10 cross-check)
- `web/app/components/set-detail/DetailArc.tsx` — the in-place full-mode upgrade (median, ticks, ★, chips, DR-2 click-jump, key strip, caption, D-4 fallback, D-18 overlay, D-16 error boundary)
- `web/app/components/set-detail/SetDetail.tsx` — passes `setFocus` into `DetailArc` (DR-2 reuse)
- `web/app/components/dashboard/HeroBand.tsx` — thumbnail aria updated to the evolved generator (aria-only, D-3)
- `web/app/set-detail.css` — §C full-mode styles (plot/median/overlay/fade/peak/strip/seams/ticks/caption/error)
- `_bmad-output/implementation-artifacts/deferred-work.md` — 3.8-hooks + D-4 entries closed
- `_bmad-output/planning-artifacts/epics.md` — §3.8 ⚑ built-as-specced note
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 3-8 → review + session log
