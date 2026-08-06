# Story 4.1: Style Evolution trend view (excludes low-confidence)

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want a month-over-month trend of my BPM range, genre diversity, and key usage that excludes likely-rehearsal sessions,
so that I can see how my style is actually evolving in real gigs.

## Context & Authority

**No separate design-spec doc exists for this story** (unlike 3.8/3.10, which had a dedicated pre-authored design session). The epics.md ACs plus the "Design decisions locked this session" block below are this story's authority — they were worked out directly with Arjun before any code was written, closing two gaps the PRD's own review flagged as never resolved (see D-1/D-2).

**Sources:**
- `epics.md` §Story 4.1 (lines 796–807) + Epic 4 overview (lines 790–794, the "played = played-on-Curfew" copy rule) + Story 1.8 (lines 329–340, the FR-27 signal) + Story 1.10 (lines 354–365, the frozen contract).
- PRD `prd.md:215` (FR-9) and the PRD review's own flagged gap: `review-rubric.md:28,32` — *"FR-9's 'genre diversity' is used as a trend metric... but is never defined numerically anywhere in the PRD or Glossary."* Same gap applies to key-usage. **Both closed by D-1/D-2 below.**
- `ARCHITECTURE-SPINE.md`: AD-1 (edge owns derivation; cloud may only SQL-reaggregate over synced rows — informs where this story's aggregation may legally live), AD-2/AD-3 (derived-only sync, frozen `shared/` contract — **this story touches zero `shared/` files**), AD-12 (genre normalized on the edge, `taxonomy_version` stored per play — informs the one-line caveat in Dev Notes, not a build requirement today).
- UX `EXPERIENCE.md`: line 73 (trend chart = one chip-toggled chart, metrics never stacked), line 91 (exact insufficient-history copy), line 74 (Chart Summary "one shared utility" register), line 98 (chart-failed state).
- `SPEC.md:46-48` (CAP-6) and `SPEC.md:124` (accepted risk: genre coverage is permanently ~80%, no coverage guard on the diversity trend — informational, not an AC).
- `deferred-work.md:61` — the dashboard's own soundcheck-set leak explicitly names this story's exclude-visibly pattern as its future fix. **Not this story's job**; Task 10 below just leaves a pointer.
- `sprint-status.yaml` action item **ai-4** (Epic 1 retro, still open) — *"Add one sentence to Story 4.1 re: 865-play rapid-preview blind spot (no density ceiling)."* **Closed by this file** (see D-7) — no code change owed, just the documented sentence.

## Design decisions locked this session (2026-08-06, Arjun)

1. **D-1 — Genre diversity = Shannon entropy**, not a distinct-genre count or top-genre-share. `H = -Σ pᵢ·log2(pᵢ)` over each month's merged `genre_breakdown` play-count proportions. Closes the PRD's own flagged gap.
2. **D-2 — Key usage = "key diversity/spread," using the SAME entropy formula** as D-1, applied to per-play `camelot_key` tallies instead of genre buckets. One shared `shannonEntropy(counts: number[]): number` pure function, two call sites — not two different diversity algorithms.
3. **D-3 — New month-bucketed chart component.** Does **not** extend or reuse `DetailArc`/`energyArc.ts` (3.8) — that component's monotone-cubic curve, DR-2 click-to-jump focus, and key-timeline strip are all per-play-arc concerns that don't apply to monthly aggregates, and "BPM range" needs a min/max band, which a single-stroke line can't express anyway. The new component shares only the **visual language**: chrome-gradient stroke, `CursorChip` hover, and the Chart Summary caption-underneath idiom.
4. **D-4 — Confidence exclusion is binary in practice.** `confidence.rs::classify()` only ever returns `1.0` or `0.2` (agent/src-tauri/src/confidence.rs:121-128) — "low-confidence" simply means `derived.confidence.value < 1.0`. No threshold to configure. The "N low-confidence sessions hidden — show them?" reveal is **one page-level toggle** (not per-metric) and **resets to hidden on every page load** — it is not persisted.
5. **D-5 — Insufficient-history gate is calendar-month based**, computed over **all** synced sets (before confidence exclusion): fewer than 2 distinct local-calendar months represented → insufficient-history state. Gating on the *unfiltered* history (not the post-exclusion set) matters: a DJ with real spread across months who happens to have mostly low-confidence sets should see the trend (with the reveal affordance available), never a misleading "not enough yet."
6. **D-6 — Default chip selection = last-selected metric**, persisted in `localStorage`; falls back to BPM range (the FR-9/AC-1 list order, and UJ-5's own worked example) on first-ever visit.
7. **D-7 — ai-4 closure.** The low-confidence tier has no upper density ceiling: an 865-play zero-long-gap session and a 4-play zero-long-gap session both register identically low-confidence. This is a known, accepted limitation of a frozen, do-not-tune signal (Epic 1 retro D4) — document it in code (a comment on the exclusion logic pointing here), do not attempt to fix it.
8. **D-8 — A month with zero surviving (non-excluded) sets after confidence filtering renders as a gap in the trend line, not a fabricated zero.** Mirrors the codebase's existing "never guess a value it doesn't have" discipline (AD-11; `bpm_distribution`'s defined-but-honest-empty-value contract; `genre_breakdown.no_genre_count`'s always-visible-never-folded rule).

## Acceptance Criteria

Extends epics.md Story 4.1 AC-1…AC-4 (epics.md:804-807); AC-5/AC-6 are new, closing the D-1/D-2 gaps.

1. **(extends epics AC-1)** Given ≥1 month of synced sets, Style Evolution shows BPM range, genre diversity, and key-usage patterns month-over-month, **one chip-toggled chart at a time** (never stacked small-multiples — EXPERIENCE.md:73), via a **new** month-bucketed chart component (D-3). Chip selection persists across visits via `localStorage`, defaulting to BPM range on first visit (D-6). *(FR-9, UX-DR6)*
2. **(extends epics AC-2)** Sessions with `derived.confidence.value < 1.0` (D-4) are excluded from the trend **by default but never silently**: a single page-level "N low-confidence sessions hidden — show them?" affordance reveals them, recomputing whichever chart is currently shown. The reveal **resets to hidden on every page load** — never persisted (D-4). A month with zero surviving sets after exclusion is a gap in the line, never a fabricated zero (D-8). A real set is never erased from the DJ's own history without their knowledge. *(FR-27)*
3. **(extends epics AC-3)** Given fewer than 2 distinct local-calendar months across **all** synced sets — computed pre-exclusion (D-5) — the insufficient-history state renders with the exact copy from `EXPERIENCE.md:91`: *"Two more sets and Style Evolution has something to show you."* Positive-framed, console-voice register — not an error. *(UX-DR19)*
4. **(extends epics AC-4)** Each of the 3 charts ships a Chart Summary text-equivalent, following the established "one generator, three duties" pattern (visible caption + aria text-equivalent + render-failure fallback — see `energyArc.ts:126-146`'s `arcTextEquivalent` as the template to follow, not to call directly; the metrics differ). *(UX-DR7, UX-DR21)*
5. **(new, closes D-1 / PRD gap)** Genre diversity per month = Shannon entropy `H = -Σ pᵢ·log2(pᵢ)` over that month's merged `genre_breakdown` bucket proportions (sets summed by local-calendar month). Plays with no genre are **excluded from the entropy calculation** but their count is **always disclosed** alongside the chart (never silently folded in or dropped — mirrors `genre_breakdown.no_genre_count`'s existing "never omitted" contract).
6. **(new, closes D-2 / PRD gap)** Key-usage diversity per month = the same Shannon entropy formula (AC-5) applied to that month's per-play `camelot_key` tallies, merged across the month's surviving sets. Plays with no key are excluded from the calculation but their count is disclosed the same honest way.

## Tasks / Subtasks

> Suggested order: pure aggregation lib → chart summary generators → chart component → chip toggle → reveal affordance → insufficient-history state → page wiring → a11y → doc writebacks → verification.

- [ ] **Task 1 — Month-bucketing + diversity-index pure lib** (AC: 1, 2, 3, 5, 6)
  - [ ] New `web/lib/sets/styleEvolution.ts`, mirroring the existing `web/lib/sets/{hero,listModel,rightColumn,dancefloor}.ts` convention: pure, deterministic, built over `SetRecord[]` from the frozen seam, never mutating it.
  - [ ] `localMonthKey(iso: string | null): string` — mirror `localDayKey` (`listModel.ts:51-57`) exactly, but truncated to `YYYY-MM`. Local time, not UTC (a gig's date is the DJ's local date — same discipline as `format.ts`'s doc comment).
  - [ ] `shannonEntropy(counts: number[]): number` — pure math helper, `H = -Σ pᵢ·log2(pᵢ)` where `pᵢ = counts[i] / Σcounts`. Zero-length or all-zero input → `0`, not `NaN`/`Infinity` (mirrors `bpm_distribution`'s "defined value, never NaN" discipline). A single nonzero category → `0` (no diversity). Unit-test the edge cases explicitly.
  - [ ] `monthsSpanned(sets: SetRecord[]): number` — distinct `localMonthKey` count across **all** sets, pre-exclusion (D-5) — backs the insufficient-history gate (AC-3).
  - [ ] Per-month aggregation, computed twice per call (excluding vs. including low-confidence sets — D-4's reveal toggle needs both):
    - `bpmRange`: `{ min, max } | null` — min-of-mins / max-of-maxes over that month's `derived.bpm_distribution.{min,max}` across surviving sets; `null` (gap, not 0 — D-8) when no surviving sets that month.
    - `genreDiversity`: `{ index: number, no_genre_count: number } | null` — merge `derived.genre_breakdown.buckets` by genre name across the month's surviving sets, sum `play_count`, run through `shannonEntropy`; `no_genre_count` summed and always disclosed (AC-5). `null` when no surviving sets that month.
    - `keyDiversity`: `{ index: number, no_key_count: number } | null` — walk `plays[].camelot_key` (NOT `derived.camelot_mixing_stats` — that field is harmonic transition-compatibility, a different concept; do not reach for it here) across the month's surviving sets, tally by raw Camelot string, run through `shannonEntropy`; nulls counted as `no_key_count`, disclosed (AC-6). `null` when no surviving sets that month.
  - [ ] Low-confidence partition: `sets.filter(s => s.derived.confidence.value < 1.0)` (D-4) — expose the count and the excluded sets separately so the page can render the reveal affordance and recompute on demand.
  - [ ] Unit tests: month bucketing across a year boundary and a DST transition (mirror the existing DST-monotonic discipline used elsewhere in this codebase); entropy edge cases; exclusion/reveal producing different per-month values; a month with all-excluded sets producing a gap not a zero.

- [ ] **Task 2 — Chart Summary generators (3 new)** (AC: 4)
  - [ ] One generator per metric, each following energyArc.ts's "one generator, three duties" pattern (visible caption + aria text-equivalent + render-failure fallback — same function, never three). Templated min/max/direction register, adapted to month-over-month framing (e.g. "BPM range widened from 118–124 to 122–130 since March").
  - [ ] Diversity-index copy needs its own phrasing (an entropy value has no natural "ranged X–Y" reading) — keep it in the same calm console voice as the rest of the product; a quick pass against `writing-guidelines` before this ships is worth it given it's genuinely new copy, not a restatement of an existing register.

- [ ] **Task 3 — New month-bucketed trend chart component** (AC: 1)
  - [ ] `web/app/components/style-evolution/TrendChart.tsx` (or similar) — new component, NOT a fork of `DetailArc`/`energyArc.ts` (D-3). X-axis = ordered month buckets (categorical, not continuous time — a real structural difference from the energy arc's time domain). Y-axis is metric-dependent: BPM range renders as a min/max band; genre/key diversity render as a single line.
  - [ ] Shares only the chrome-gradient stroke visual language + `CursorChip` (`web/app/components/ui/CursorChip.tsx`) hover treatment + the Chart Summary caption underneath.
  - [ ] No zoom/pan (epics AC-1 precedent carries over). No DR-2 click-to-jump focus — there's no "jump to a track" concept for a monthly aggregate.
  - [ ] Render failure falls through to the Chart Summary text (UX-DR19 `chart-failed` state, matches the 3.8 precedent at `EXPERIENCE.md:98`).

- [ ] **Task 4 — Metric chip toggle** (AC: 1)
  - [ ] 3 chips: BPM Range / Genre Diversity / Key Usage — one chart visible at a time (EXPERIENCE.md:73). New component, but match the existing chip/hover-glow visual language already used for genre chips (StatsColumn/Tracklist) and sort chips (SpotlightSearch) rather than inventing a new visual idiom.
  - [ ] Selection persists via `localStorage`; first-ever visit defaults to BPM range (D-6).
  - [ ] Fully keyboard-operable (Tab/Enter/Space) — UX-DR21.

- [ ] **Task 5 — Low-confidence reveal affordance** (AC: 2)
  - [ ] A single page-level row/banner, rendered only when the excluded count > 0: *"N low-confidence sessions hidden — show them?"* On reveal, recompute the currently-shown metric's per-month values including the previously-excluded sets (Task 1's dual computation). Copy must say "hidden," never "excluded"/"removed" — matches epics.md AC-2's exact register.
  - [ ] Resets to hidden on every page load (D-4) — no persistence, unlike Task 4's chip selection.

- [ ] **Task 6 — Insufficient-history state** (AC: 3)
  - [ ] Gate: `monthsSpanned(allSets) < 2` (D-5), computed pre-exclusion.
  - [ ] Render the exact copy from `EXPERIENCE.md:91`: *"Two more sets and Style Evolution has something to show you."* Static copy, not a computed "N more sets" count — no other story in this codebase computes a live version of this number; don't build one here either.

- [ ] **Task 7 — Page wiring** (AC: 1, 2, 3)
  - [ ] Replace the throwaway stub at `web/app/(authenticated)/style-evolution/page.tsx` (currently a placeholder explicitly waiting on this story). Read through the **existing** `getRecentSets()` seam (`web/lib/sets/index.ts:36-38`) — it already returns the DJ's **full** synced history sorted newest-first, despite the "recent" name; no new data-access function is needed.
  - [ ] Server component computes Task 1's pure model and passes it to a client sub-component that owns the chip-toggle + chart + reveal-affordance interactivity (mirrors the dashboard's server-page/client-sub-component split — `dashboard/page.tsx` → `AgentStatusBanner`/`ConfidenceTile`, etc.).
  - [ ] **No nav changes needed** — `FloatingNav.tsx:48` already routes `/style-evolution` (Story 3.5's route-slug reservation).

- [ ] **Task 8 — Accessibility** (AC: 4)
  - [ ] WCAG 2.2 AA (UX-DR21): the Chart Summary text is the accessible equivalent for each chart (already the established pattern — no separate aria work needed beyond wiring the generator's output into the container's aria label, as 3.8 does).
  - [ ] Chip toggle and reveal affordance keyboard/focus-ring reachable per the rest of the product's lavender-glow focus convention.

- [ ] **Task 9 — Doc writebacks** (AC: context)
  - [ ] `sprint-status.yaml`: mark action item **ai-4** `done`, with a note pointing at D-7 above.
  - [ ] `deferred-work.md:61` (the dashboard soundcheck-leak entry): append a note that this story's reveal-affordance pattern now has a real, shipped reference implementation to copy — do not close that entry, it's still a separate, un-scheduled dashboard fix.

- [ ] **Task 10 — Verification & gates** (AC: all)
  - [ ] `web/` lint/typecheck/test suite green.
  - [ ] Real-browser walkthrough (per 3.6–3.10 precedent, 1440 + 375): chip toggle switches charts and persists across a reload; reveal affordance works and resets on reload; insufficient-history renders against a fixture trimmed to <2 calendar months; a forced chart-render failure falls through to the Chart Summary text; zero console errors.

## Dev Notes

- **Data source:** `getRecentSets()` (`web/lib/sets/index.ts:36-38`) — same seam as the dashboard, already returns the full synced history. No `shared/` contract change, no new data-access function.
- **Fields to use:** `derived.bpm_distribution.{min,max}`, `derived.genre_breakdown.{buckets,no_genre_count}`, `derived.confidence.value`, per-play `camelot_key`, `set.started_at` (local-month bucketing key).
- **Field NOT to use:** `derived.camelot_mixing_stats` — that's harmonic transition-compatibility (in-key/out-of-key/no-key between consecutive plays), a different concept from "which keys got played." Reaching for it here would be the wrong data source for AC-6.
- **AD-12 caveat (informational, no code guard owed today):** genre normalization is versioned (`taxonomy_version` per play). Merging `genre_breakdown` across a month's sets assumes a stable taxonomy version, which holds today (the taxonomy table has never changed) — leave a one-line comment near the merge, nothing more.
- **No agent-side or `shared/` changes** — this is a pure `web/` story built entirely on fields already synced (`1-10-freeze-the-shared-sync-contract.md`'s frozen contract already carries everything needed).
- **Reuse:** `CursorChip` (`web/app/components/ui/CursorChip.tsx`) for hover; `format.ts` formatters where applicable (e.g. `formatBpm`). The dashboard's server-page/client-sub-component split is the structural precedent to follow.

### Project Structure Notes

- New: `web/lib/sets/styleEvolution.ts` (+ `.test.ts`), `web/app/components/style-evolution/*` (chart + chip-toggle + reveal-affordance components).
- Replaced: `web/app/(authenticated)/style-evolution/page.tsx` (currently a Story 3.5 throwaway stub).
- Unchanged: `web/app/components/nav/FloatingNav.tsx` (route already wired), `shared/` (frozen contract untouched), `agent/` (no changes).
- Follows the existing `web/lib/sets/*` pure-function-over-`SetRecord[]` convention (`hero.ts`, `listModel.ts`, `rightColumn.ts`, `dancefloor.ts`) — no variance from established structure.

### References

- [Source: epics.md#Story 4.1, lines 796-807] — ACs 1-4, FR-9/FR-27/UX-DR6/DR7/DR19 citations.
- [Source: epics.md#Story 1.8, lines 329-340] — FR-27 signal origin.
- [Source: epics.md#Story 1.10, lines 354-365] — frozen `shared/` contract.
- [Source: prd.md:215] — FR-9 statement.
- [Source: review-rubric.md:28,32] — the never-resolved genre-diversity/key-usage definition gap, closed by D-1/D-2.
- [Source: ARCHITECTURE-SPINE.md#AD-1, AD-2, AD-3, AD-12] — aggregation boundary, frozen-contract discipline, taxonomy-version caveat.
- [Source: EXPERIENCE.md, lines 73, 74, 91, 98] — chip-toggle/one-chart-at-a-time, Chart Summary register, insufficient-history exact copy, chart-failed fallback.
- [Source: SPEC.md, lines 46-48, 124] — CAP-6 intent/success, accepted genre-coverage risk.
- [Source: agent/src-tauri/src/confidence.rs, lines 95-135] — binary confidence signal, backs D-4/D-7.
- [Source: shared/src/index.ts, lines 181-187] — `derived.confidence` field, explicitly earmarked for this story.
- [Source: web/lib/sets/energyArc.ts, lines 126-189] — `arcTextEquivalent`, the Chart Summary generator pattern to follow.
- [Source: web/lib/sets/listModel.ts, lines 51-57] — `localDayKey`, the local-time bucketing precedent for the new `localMonthKey`.
- [Source: web/lib/sets/index.ts, lines 31-38] — `getRecentSets()`, the data-access seam this story reuses unchanged.
- [Source: deferred-work.md, line 61] — the dashboard's own low-confidence leak, naming this story's pattern as its future fix.
- [Source: sprint-status.yaml action item ai-4] — the open 865-play blind-spot note this story closes.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
