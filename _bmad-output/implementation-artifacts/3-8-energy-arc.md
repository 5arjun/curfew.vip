# Story 3.8 — Energy arc chart + chart summary (design working doc)

> Living design doc. Captures decisions from the planning session (Arjun, 2026-08-04) as they lock. Feeds back into `epics.md` §Story 3.8 as the authoritative spec.
>
> **Source inputs already read:** `epics.md` Story 3.8 block + ⚑ refinement (2026-08-02), `3-7-set-detail.md` (§3a-C arc, DR-2 focus mechanism, Q4 hook), `3-7-set-detail-summary-tracklist.md` (constraints 8/20/26/29, review-defer on the no-BPM dancefloor edge), `deferred-work.md` (3.8 hooks entry + arc fallback edge), current `DetailArc.tsx` / `energyArc.ts` / `heroArc.ts`.

---

## 0. The dividing line (what 3.8 owns vs. not)

**3.8 = the full-mode upgrade of the ONE arc renderer, plus its harmonic time companion.** Same `DetailArc` component 3.7 mounted in slot C — upgraded in place, never forked (epics ⚑ 2026-08-02).

| In 3.8 | Out of 3.8 |
|---|---|
| Full annotated arc (chrome look, monotone curve, median baseline, edge ticks, ★ peak mark, hover names) | Zoom/pan (explicitly "no zoom/pan in v1", AC-1) |
| Chart Summary caption — visible, scoped, also the aria text-equivalent + render-failure fallback | **Camelot-wheel graphic — CUT entirely** (D-1); the 3.7 transition list stays the tabular form |
| Arc click-to-jump via 3.7's DR-2 focus mechanism (Q4) | Dashboard hero/thumbnail changes — **untouched** (D-3); full mode is set-detail only |
| **Key timeline strip** under the arc (D-2) — the harmonic companion, time form | Peak time in the caption (D-13: detection not accurate enough to caption) |
| DST/UTC+offset monotonic-timeline verification (AC-5) | Dancefloor detection improvements (5.2 — the chart just consumes the segment, edge ticks sharpen for free) |
| Fix the deferred no-BPM-dancefloor silent-fallback edge (D-4) | Persisted segments / manual edit (5.1/5.3) |

## 1. Locked decisions (Arjun, 2026-08-04)

- **D-1 — Camelot wheel CUT; key timeline IN.** Of 3.7's two "companion candidates," the wheel graphic is dropped (own design story, list form suffices); the **key timeline** — each play's Camelot key as a horizontal strip in time — ships in 3.8. (§3b)
- **D-2 — Click-to-jump is in.** Nearest-point mapping → DR-2 `setFocus`. (§3c)
- **D-3 — Dashboard thumbnail untouched.** Clean and glanceable wins; full mode exists only on set detail. Thumbnail keeps its aria-only text equivalent (that satisfies AC-2's "every chart" — the summary generator IS its aria string).
- **D-4 — Fix the deferred edge:** dancefloor scope whose window has no BPM-carrying plays must not silently draw the whole night while the scope line reads "Dancefloor." Resolution in §3e.
- **D-5 — Chrome look STAYS.** The epic's "lavender 2px stroke, no fill, dashed baseline" predates the built visual direction — treat as outdated sketch. Keep the smooth-chrome gradient stroke + soft gradient area fill; the "dashed baseline" idea survives as the median line (D-6).
- **D-6 — Dashed baseline = MEDIAN BPM** of the active scope ("the room's resting pulse"), with an identifying hover — the shared CursorChip idiom (`Median · 124 BPM`) so it's never a mystery line.
- **D-7 — No axes.** No y-axis, no permanent BPM labels. Time gets only sparse mono ticks: **start · end**, plus **dancefloor edges** when viewing whole-night. (Edges sharpen automatically when 5.2's real detection engine lands.)
- **D-8 — Monotone curve, hand-rolled.** Replace the polyline with a monotone cubic (Fritsch–Carlson style — smooth, never overshoots the data). **NOT shadcn/Recharts** — that would fork the renderer, break the viewBox morph + non-scaling chrome stroke; ruled after flag. ~40 lines in `energyArc.ts`, zero new deps. The thumbnail inherits the smoother curve (same geometry — acceptable, consistent).
- **D-9 — Hover = song name ONLY.** 50–60 points in a dancefloor section; a multi-line tooltip is too much. Compact CursorChip with the track title, nearest-point by x. Click = jump. (Hover does NOT pre-highlight the tracklist row.)
- **D-10 — ★ PEAK = small mark on the curve** with an identifying hover (`★ Peak · <track>`), not an always-on label. Must be the SAME peak the tracklist impact node computes — one source of truth, never two peak algorithms.
- **D-11 — No further annotations.** No `·new·` marks, no genre-change markers on the curve. AC-4's "UJ-1 genre-gap climax reachable without the chart" is satisfied by the tracklist + genre module, not by chart annotation.
- **D-12 — Caption: visible quiet one-liner, bottom-right of the graph.** Same generator serves three duties: visible caption, aria text-equivalent (AC-4), render-failure fallback (AC-3).
- **D-13 — Caption content = min–max range + direction, scope-reactive.** Register locked: *"BPM ranged 122–128, climbing through the back half."* NO peak time in the caption (BPM-only detection can't place it accurately enough to state as prose).
- **D-14 — Peak definition: moving time-window of ~10% of the active scope's duration** (8–10% band acceptable), highest window-average BPM; the annotated play = the play nearest the winning window's center. Relative windowing so short and long sets both behave.
- **D-15 — DST/offset (AC-5): most efficient path, legible for future moves.** Keep epoch-ms math (monotonic by construction in UTC); verify at dev time what offset info the wire's `started_at` ISO strings actually carry, and store/display set-local via offset — additive contract touch only if verification demands it.
- **D-16 — Render failure = error boundary** around the SVG that swaps in the caption block. No stricter definition needed.
- **D-17 — Mobile tap = jump immediately** (no two-step preview); the "Focused: X ✕" pill names the track, so the preview step is redundant.
- **D-18 — Morph vs annotations:** text/marks live in an HTML overlay positioned from arc geometry; overlay fades out during the scope morph, back in after. The SVG keeps the viewBox tween + `non-scaling-stroke`.
- **D-19 — Process: same as 3.7.** This design doc now → dev-ready story file (`bmad-create-story`) when it goes to build → dev → one polish pass at end ([[feedback_polish_at_end]]).

## 2. Anatomy (slot C, full mode)

```
┌──────────────────────────────────────────────────────────────┐
│                                          ★ ← peak mark        │
│        ╭─╮        ╭──── chrome gradient curve (monotone)      │
│   ╭────╯ ╰────────╯   ╲                                       │
│ - ┼ - - - - - - - - - - ┼ - -  ← dashed median line (hover ID)│
│  ╱                       ╲___                                 │
│ ▁▁▁▁ gradient area fill ▁▁▁▁▁▁                                │
├──────────────────────────────────────────────────────────────┤
│ ▓▓▓▓│▓▓▓▓▓│▓▓┊▓▓▓│▓▓▓▓  ← key timeline strip (Camelot colors)│
├──────────────────────────────────────────────────────────────┤
│ 11:42 PM      ⌐ dancefloor ¬            1:18 AM   (mono ticks)│
│                     BPM ranged 122–128, climbing through the  │
│                     back half.               ← caption (right)│
└──────────────────────────────────────────────────────────────┘
```

## 3. Section detail

### 3a. The curve (full mode)

- Same `DetailArc`, same `heroArcGeometry` domain/morph machinery (viewBox tween, reduced-motion hard cut — all shipped in 3.7, untouched).
- `energyArc.ts` gains a monotone-cubic path generator (D-8) emitting `path`/`area` d-strings; polyline output retired.
- Median line: dashed, quiet, spans the plotted domain at `y(median)` of the active scope (client recompute for dancefloor, `derived.bpm_distribution.median` for whole-set). CursorChip on hover (D-6).
- Edge ticks (D-7): mono, small, below the strip — scope start/end times; in whole-night scope, two additional quiet ticks at the detected dancefloor edges.
- ★ peak mark (D-10, D-14): small node + star on the curve at the peak play's point; hover CursorChip `★ Peak · <title>`; click jumps like any point. Reuses the tracklist impact-node computation (extract to one shared function if 3.7 inlined it).

### 3b. Key timeline strip (the harmonic companion — D-1)

- Thin strip directly under the arc, **sharing the arc's exact time domain and morphing with it** (same viewBox/domain math — it zooms with the scope flip).
- Each play = one segment spanning its played window, tinted with its **existing 24-token `--camelot-*` color** (3.7's key-chip system — the strip is those chips, laid out in time).
- Seams between segments carry the in-key language: **in key** → seamless/soft cyan seam; **out of key** → faint dashed break (never red, UX-DR18); **no key** → neutral grey segment, plain seam. Identical Camelot rule as the harmonic hero + connectors.
- Hover → compact CursorChip (`9A · <track title>`); click → DR-2 focus (same as arc click). 
- Sparse states: strip hides with the arc's <2-point fallback; all-no-key set → strip self-hides (nothing to say).
- Fine visual knobs (strip height, whether wide segments show inline key codes) = designer discretion at dev, polish pass at end.

### 3c. Click-to-jump (Q4 → D-2)

- Desktop: pointer tracks nearest point by x (generous hit area — the whole plot is the target, not 6px dots); hover shows the name chip (D-9); click → map point → play `position` → `setFocus` (DR-2, single-select, "Focused: ✕" pill, scroll-to-row) — the mechanism 3.7 built for exactly this.
- Mobile: tap = jump immediately (D-17).
- Key-strip segments click-to-jump identically.

### 3d. Chart Summary caption (AC-2/3/4)

- One pure generator (evolves `arcTextEquivalent`): templated **min–max + direction**, e.g. *"BPM ranged 122–128, climbing through the back half."* Direction vocabulary: climbing / easing down / holding steady (threshold reuse: |Δ| < 4 BPM = steady); "through the back half" style phrasing derived from where the trend concentrates (first/back half comparison) — templated, never freeform.
- Scope-reactive (D-13): dancefloor caption when scoped, whole-night caption otherwise; recomputes with the flip.
- Rendered as the quiet bottom-right one-liner (D-12) AND wired as the container's aria text-equivalent AND rendered standalone by the error boundary on render failure (D-16). One string, three duties.
- Dashboard thumbnail: same generator, aria-only (D-3).

### 3e. States + the D-4 fix

- **<2 plottable points** — existing text fallback stands ("Single track / No tempo data — no arc to draw").
- **D-4 fix — dancefloor window contains no BPM-carrying plays:** the scope must stay honest. Compute the band from the segment's *time bounds* (independent of whether plays fall inside); if the scoped window has no plottable points, show the in-scope chart-summary fallback (*"No tempo data in the dancefloor window."*) rather than silently drawing the whole night under a "Dancefloor" scope line. (`heroArc.ts:145` band-null path.)
- **Render failure** — error boundary → caption block (D-16).
- **DST/cross-midnight (AC-5)** — epoch-ms UTC math keeps x monotonic through a fall-back hour; tick labels render set-local via offset (D-15 verification at dev time). No repeated-hour x-collisions, no negative deltas — also protects 5.2's segment detection downstream.

## 4. Data

- Everything renders from what 3.7 already has: `derived.energy_arc[{started_at,bpm}]`, `derived.bpm_distribution.median`, `plays[]` (`position`, `title`, `camelot_key`, `started_at`, `bpm`), detected/recomputed `DancefloorSegment`, DR-2 `Focus` model (positions-based, source-agnostic — built to accept this).
- Played-window end for key-strip segments: next play's start (3.7's Q3 logic) or real `ended_at` where captured.
- Only possible contract touch: AC-5 offset verification (D-15) — additive-only if needed, `SyncPlay` stays frozen/consumer-gated (AR-15).

## 5. Open threads

- [x] Scope boundary — wheel out, key timeline in, click-to-jump in, dashboard untouched, edge fix in. (D-1..D-4)
- [x] Visual direction — chrome stays, median baseline, no axes, monotone hand-rolled. (D-5..D-8)
- [x] Annotations — hover names only, small ★ peak, nothing else. (D-9..D-11)
- [x] Caption — placement, content, register, scope behavior. (D-12, D-13)
- [x] Peak algorithm — 10%-of-scope moving window, shared with impact node. (D-14)
- [x] AC-5 / failure / morph mechanics. (D-15, D-16, D-18)
- [x] Interactions — nearest point, mobile tap-jumps. (D-2, D-9, D-17)
- [ ] Key-strip fine knobs (height, inline key codes) — designer discretion at dev (§3b).
- [ ] D-15 wire verification (what offset does `started_at` carry?) — first dev task.
- [ ] Fold a ⚑ pointer into `epics.md` §Story 3.8 (done alongside this doc).
- [ ] Write the dev-ready story file (`bmad-create-story`) when 3.8 goes to build.
- [ ] Commit these docs on the `story/3-8-energy-arc` branch.
