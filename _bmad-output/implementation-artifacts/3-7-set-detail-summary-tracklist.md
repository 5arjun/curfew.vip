---
baseline_commit: 913248bfaea5f77a3c48c26e18c78a056e47f5f2
---

# Story 3.7: Set Detail summary + tracklist

Status: done

## Story

As a DJ,
I want a Set Detail view with the full per-set summary and tracklist,
so that I can study exactly what I played and how it landed.

## ⚠️ Authoritative spec — read this first

**`_bmad-output/implementation-artifacts/3-7-set-detail.md` is the authoritative design spec for this story and GOVERNS on any conflict with, or omission from, this story file.** It carries every layout/interaction/state decision plus the ASCII mockup, locked section by section with Arjun on 2026-08-03. Read it fully before writing code; implement to the doc, not just the ACs below. Its companion `_bmad-output/implementation-artifacts/serato-capture-completeness.md` governs the data-capture pass (§3d) the same way — its field map and verification results are the source of truth for the agent/contract work.

**Where those docs live (branch-state prerequisite):** both docs, and ALL of Story 3.6's code this story reuses, exist only on branch `story/3-6-dashboard-home` (design commit `96ca9d3` and later; currently checked out in the `fix-serato-key-camelot` worktree). They are **not on `main` yet.** Story 3.6 is in review with no PR. **Before dev starts: merge `story/3-6-dashboard-home` into `main`, then branch `story/3-7-set-detail` off `main`.** Branching off a main that predates the 3.6 merge gives you neither the spec nor the arc renderer, detector, seam, or route this story is built on. If the 3.6 branch is not merged when dev begins, stop and get a ruling from Arjun rather than cherry-picking.

**Supersessions to know when reading `epics.md`** (design doc wins; these are expected, not conflicts):

- epics AC-3's "'View Full Tracklist' expands from the top-tracks summary" is superseded: the tracklist IS the page spine, full-length with "Load more" (§3, §3a-F).
- The 2026-08-02 refinement's "edit affordance" on the scope line is superseded by **D4: no edit affordance at all in 3.7** (arrives in 5.3 with the drag that makes it real).
- epics AC-1's "most-played tracks" is superseded by **artist-primary with conditional replays** (§3a-E): a per-set top-tracks list is filler when most tracks play once.

## Acceptance Criteria

### A. Layout & scope model (spec §3, D1–D5, L-1…L-5)

1. **Two-pane header:** A identity + B scope stacked left (~20–25%), C energy arc right (~75–80%); header **scrolls away** (not sticky). *(L-1, confirmed ratios in §5)*
2. **Whole-page scroll** — no `100dvh` fixed shell, no nested scroll regions. This is a deliberate break from the dashboard's fixed-shell signature; the full-length tracklist drives page height. Do NOT reuse the dashboard's `dashboard-shell`/`dashboard-scroll` wrappers (the current `/set/[id]` stub does — this story replaces that stub entirely). *(L-2)*
3. **Body panes:** tracklist left ~67% (the stable spine), stats column right ~33%, and the right column is **`position: sticky`** so stats + any open drill-in overlay ride along during the long tracklist scroll. Not a nested scrollbar. *(L-3, L-4)*
4. **Default scope = detected dancefloor, every open**, never persisted as a view preference. Detection + stats recompute client-side from `plays[]` via 3.6's shipped `detectDancefloor` + `segmentStats` (`web/lib/sets/dancefloor.ts`). *(D2, D5)*
5. **Scope switch is global:** the `[ Dancefloor | Whole night ]` control flips *everything* — identity-bar length/track-count, all right-column stats, arc domain, impact node — to one frame at once; the screen never mixes two frames. *(D1)*
6. **Scope switch is view-only** in 3.7: client-side recompute, nothing persisted. *(D5)*
7. **No edit affordance anywhere.** The scope line only states the detected dancefloor window (e.g. `Dancefloor 11:42–1:18 AM`). Segment editing/persistence is Story 5.3 (needs 5.1's `segments` table). *(D3, D4)*

### B. Section C — energy arc (spec §3a-C)

8. **Reuse the 3.6 arc renderer** (`web/lib/sets/energyArc.ts` `arcGeometry`/`arcTextEquivalent`; `heroArc.ts`/`HeroBand.tsx` show the current render pattern) as the 3.7 interim. Story 3.8 upgrades the *same component* to full annotated + chart-summary mode — do not fork a second arc implementation.
9. **Arc domain changes with scope:** Dancefloor mode draws *only* the dancefloor window; Whole night draws the full night; the switch **morphs** (dancefloor zooms/expands outward to reveal the full night; reverse collapses). This replaces the earlier emphasis-shading model. Reduced-motion: hard cut, no morph.

### C. Right-column stats (spec §3a-D/E + genre module, §3c)

10. **Headline stats module (D), hairline-divided; harmonic mixing is the hero:** LED pips per UX-DR11 — **pips are the hero visual, the % is the secondary readout**.
11. **BPM stat** = range + median + tiny sparkline.
12. **Genre module** (its own module, split out of D): top 3 buckets, each row `genre · % · # tracks`; hover uses the dashboard motion vocab (framer-motion spring `bounce ~0.2`, `scale`, cyan/ice glow à la `HeroBand`); `no_genre` shown honestly.
13. **Most-played — artist-primary with conditional replays (E):** show **"Most-played artists"** (ranked `artist · ×4` with count or tiny bar) **only when there's real concentration** (some artist ×2+). Artist-tagged plays only — no Unknown bucket, no untagged footnote *(CAP-5, epics AC-2)*. Rows clickable → DR-2 focus. A **"Replayed: X ×2"** line appears only if any single track's count > 1. If everything is a singleton, **the module does not render at all**. Scope-reactive. (No empty-set state needed — a zero-play set never becomes a card.)
14. **Set shape module: "Longest Play" and "Shortest Play"** — `title · artist · m:ss`, exactly these plain names (Arjun rejected cleverer ones). Click either → focuses that row (DR-2). Scope-reactive. The duration shown is the **real captured played-duration** (`played_ms`, AC-30), never the timestamp-diff proxy for the headline value.
15. **"New tracks played" module:** readout `New tracks played · 6 of 42 · [ Week | Month ]` — counts this set's tracks whose **library date-added falls within 7/30 days before the set date** (set-date-relative so it doesn't drift). Toggle flips the window. Click → focuses those rows (DR-2, the row set). Scope-reactive. Off-library plays (`in_library: false`) have no add-date → **excluded and disclosed**; the ~94% `database V2` coverage ceiling is likewise disclosed quietly, never silently shrunk. (Launch-honest by design: needs only library add-date + this set's plays, so it survives Epic 4 Decision B — unlike aging-shelf/time-to-first-play.) *(§3c, §3d)*
16. **Slot G reserved** for Story 5.5 enrichment (venue/crowd/event/notes/pics) — a visual reserved slot below the stats stack, no functionality.

### D. Section F — tracklist (spec §3a-F)

17. **Row anatomy:** left timeline rail (timestamp + node) · primary line title + artist · right-aligned **mono metadata columns `BPM · played-length · Camelot key (small chip)`** that align vertically for column scanning.
18. **`·new·` marker** on rows inside the "New tracks played" window; reacts to that module's Week/Month toggle.
19. **In-key connectors (Q1):** a marker ON the connector between consecutive rows, using the **same Camelot compatibility rule as the harmonic hero aggregate** (client rule must mirror `agent/src-tauri/src/stats/camelot.rs` exactly so the numbers agree). **Always visible but quiet.** States: **smooth** → soft cyan glow (HeroBand language) + subtle link glyph; **clash** → faint dashed/broken connector, neutral-muted — **never red, no alarm colors** *(UX-DR18)*; **no key** (either side missing) → plain grey, no marker. Hover → tooltip like `8A → 9A · compatible`.
20. **Impact node = peak of the energy arc** (highest sustained-BPM moment) within the **active scope**, highlighted node annotated `★ PEAK`. Chosen over "Longest Play" (already its own stat); ties the tracklist to the arc and 3.8's click-to-jump.
21. **Unknown-track FR-2 fallback** per row: "Unknown track data"; still render whatever timestamp/BPM/key is available.
22. **Pagination:** initial ~50 rows, **"Load more"** appends onto the page (whole-page scroll) — **never infinite scroll** *(UX-DR20, epics AC-4)*.

### E. Drill-in pattern (spec §3b, §3h)

23. Each stat is a clickable **summary module** → clicking opens a **detail overlay over the right column only** (~33% footprint, blurred backdrop over the *other* stats underneath). The tracklist never moves or shrinks.
24. The overlay **stays open**; clicking a value inside it highlights the tracklist live, no backing out required; **back arrow top-left** returns the column to the stats stack. Selected row inside the overlay shows an active state. Overlay contents are scope-reactive.
25. **DR-1 — highlight in place, never filter/hide:** dim non-matching rows, keep sequence, scroll to the first match, show a dismissable **"Focused: House ✕" pill** atop the tracklist. Hiding rows would break the timeline + the in-key connectors.
26. **DR-2 — ONE shared "focus the tracklist on these plays" mechanism** underlies genre-select, harmonic-select, BPM-band-select, most-played-artist-select, Longest/Shortest, and New-tracks — build it once; Story 3.8's arc click-to-jump reuses it. **Single-select** in 3.7 (one focus at a time; a new selection replaces the old).
27. **Genre overlay:** full ranked bucket list (`House · 41% · 17 tracks` … + `No genre · N`) with a **toggle switching genre-ranking ⇄ subgenre-ranking** (uses `subgenre_breakdown`). Row click → focus.
28. **BPM overlay:** **histogram computed client-side from `plays[]`** (`derived` only carries min/max/mean/median — bins are derived locally), ~4-BPM bars + min/max/mean/median readout. Click a **band** → focuses tracks in that BPM range.
29. **Harmonic overlay:** **transition list in play order** (`8A → 9A · smooth`, `9A → 4B · clash`, `4B → — · no key`) with a **"show clashes only"** filter; clicking a transition focuses those two rows. The **Camelot-wheel graphic is deferred to 3.8** — this overlay is the list/tabular form.
30. **Overlay vs direct-focus split:** overlays = Genre, BPM, Harmonic, Most-played-artists (full list). Direct focus with **no overlay** = Longest Play, Shortest Play (single row), New tracks played (the row set; its Week/Month toggle lives on the module).

### F. Section A — identity bar + delete (spec §3e)

31. **Identity bar:** mono `date · SESSION 975` header (matches the dashboard card header for continuity — reuse `formatSetDate`/`formatSessionLabel`) + `length · track count` second line, **scope-reactive**. `[⋯]` overflow menu top-right holds Delete (the home for future set-level actions) so delete isn't a prominent button.
32. **Delete confirm:** centered **modal with blurred background** (same blur language as the drill-in overlay), calm — no alarm colors, no red, no exclamation marks, no type-to-confirm ceremony. After-Hours voice, this copy verbatim:
    > **Delete this set?**
    > This removes it from Curfew for good — it can't be undone. Your Serato history and library aren't touched.
    > `[ Cancel ]   [ Delete ]`
33. **Delete is hard and never recoverable.** In 3.7 (pre-cloud-read, fixture-backed) it removes the row via the 3.6 seam (`deleteSet` in `web/lib/sets/index.ts`). The **permanent tombstone / suppress-id requirement** (keyed on stable session identity so no future sync ever resurrects the set — the agent retains raw, so a naive row-delete would reappear) **must be recorded into `deferred-work.md` as owed by the Supabase sync/read-path story** — carried, not implemented here.
34. After delete → return to the dashboard (set absent) + a **brief calm inline confirm**, no celebration.

### G. States (spec §3f)

35. **Sparse set (1–few plays,** e.g. fixture soundcheck id 17577**):** scope toggle **hidden**; arc with <2 points → chart-summary **text fallback** ("Single track — no arc to draw"), not a broken chart; harmonic (needs ≥2 tracks) → "Not enough tracks", never a fake 0%; Most-played and Longest/Shortest hidden by their conditional rules; tracklist rows with no connectors. The page must read **intentional, not broken**.
36. **Whole-set fallback (no distinct dancefloor detected):** scope line reads *"Whole set · no distinct dancefloor detected."*, toggle **hidden**, all stats = whole set. The honest default.
37. **Unknown-data aggregate disclosure:** honest counts (`no_genre_count`, harmonic `excluded_no_key`, `bpm_distribution.count`) surface as quiet "N unanalyzed" notes; **never silently shrink denominators**.
38. **Low-confidence set:** quiet **non-hiding** note near the header — *"Low-confidence session — likely a soundcheck or rehearsal"* — and **never hide any stat** (it's the DJ's own set).

### H. Mobile (spec §3i — designer's discretion, plan locked)

39. Panes **stack**: header (A/B, then arc C full-width) → right-column stats (D, genre, set shape, most-played, new-tracks) → tracklist F. **Drill-in overlay becomes a bottom sheet** (back arrow → sheet dismiss). Focus pill + highlight-in-place behavior unchanged. Whole-page scroll is already mobile-native.

### I. Data capture — agent + contract (spec §3d + `serato-capture-completeness.md`)

40. **`EnrichedPlay` (agent-internal → capture comprehensively):** add `played_ms` + `ended_at` (from serato4 `history_entry.end_time`; duration = `end_time − start_time`, verified 98% populated; when `end_time = -1` fall back to next-play-start or set-end) and `library_added_at` (from **`database V2` `tadd`, joined by `portable_id` full path** — NOT the serato4 `asset` join, which only links 4.6% because the tracks live on the Samsung USB). Also read **track total length, `deck`, and the `played` flag** into `EnrichedPlay` while in the joiner (cheap, wire-gated). **Honor the `played` flag** so loaded-but-not-played previews (25% of rows) don't count as plays.
41. **Wire contract (frozen → additive-only, AR-15/AD-15):** promote **`played_ms` and `library_added_at`** to `SyncPlay` as optional fields; bump `agent_version`; update `shared/schema/sync-payload.schema.json`; contract tests in `shared/` (additive-only guard must stay green). Skip album/year/bitrate/comments (no consumer).
42. **`database V2` reader wired into the serato4 enrichment path** (currently separate code paths — small cross-path task). Coverage ceiling ~94%; tracks missing from `database V2` → excluded + disclosed (feeds AC-15's disclosure). Legacy `.session` path (`legacy.rs`): capture the same new fields where present — sanity-check only, Arjun's library is serato4.
43. **Backfill the 491 local sets** through the retained-raw mechanism — reuse 3.6's `backfill::backfill_captured_serato4` pattern (change-detecting, self-terminating, clears `synced_at` via `store::mark_for_resync` only on real change so corrected sets re-sync). Idempotent, no data loss.
44. **Keep `serato-capture-completeness.md` current:** any capture/skip decision this story changes updates that field-map doc first (conscious inventory, not a trickle).

## Tasks / Subtasks

- [x] **Task 0: Branch-state preflight** (blocking)
  - [x] 0.1 Confirm `story/3-6-dashboard-home` is merged into `main` (spec docs + 3.6 code present). If not merged, halt and get Arjun's ruling.
  - [x] 0.2 Branch `story/3-7-set-detail` off `main`.
  - [x] 0.3 Read `3-7-set-detail.md` and `serato-capture-completeness.md` fully.

- [x] **Task 1: Agent capture pass** (AC: 40, 42, 44)
  - [x] 1.1 `joiner/serato4.rs`: extend the SELECT with `end_time`, `played`, `deck`, `length_sec`/`length_ms`, `portable_id`; read fully before editing — it owns the id-correlation join contract and the 3.6 `key_value`→Camelot mapping; break neither.
  - [x] 1.2 Wire a `database V2` `tadd`-by-path lookup into the serato4 enrichment path (the parser exists on the legacy path; this is the cross-path task). Sources: `/Volumes/Samsung USB/_Serato_/database V2` and/or `~/Music/_Serato_/database V2`.
  - [x] 1.3 Extend `EnrichedPlay` with `played_ms`, `ended_at`, `library_added_at`, `total_length_ms`, `deck`, `played`; apply the `end_time = -1` fallback (next-play-start, else set-end); filter stats/plays on the `played` flag.
  - [x] 1.4 Legacy path sanity-check (`legacy.rs`): same fields where present (`.session` field 45 carries a precomputed duration).
  - [x] 1.5 Unit + capture-path regression tests (follow 3.6's pattern: full-pipeline test through `build_serato4`).
  - [x] 1.6 Update `serato-capture-completeness.md` field-map rows to "shipped".

- [x] **Task 2: Wire contract + backfill + cloud columns** (AC: 41, 43)
  - [x] 2.1 `shared/src/index.ts`: add optional `SyncPlay.played_ms` (number|null) + `SyncPlay.library_added_at` (ISO string|null, same convention as `started_at`); update `schema/sync-payload.schema.json`; keep `additive-only.test.ts` green; bump `agent_version`.
  - [x] 2.2 Extend the backfill sweep so re-derivation with the new fields marks changed rows for resync (`mark_for_resync` — 3.6's mechanism already does this on diff; verify the new fields flow through).
  - [x] 2.3 **Supabase (derived requirement — the spec is silent, but 3.6's "same data on every device" ruling implies it):** additive migration adding `plays.played_ms` + `plays.library_added_at`, update the Story 3.2 sync RPC to write them, pgTAP + additive-only guard green. Without this the re-synced rows silently drop the new fields at the RPC boundary. If Arjun prefers to defer cloud persistence, get a ruling — don't silently drop.
  - [x] 2.4 **Regenerate the web fixture** via `agent/src-tauri/tests/export_real_fixtures.rs` (env-gated, read-only) + `web/lib/sets/build-fixture.mjs` so `recent-sets.fixture.json` carries `played_ms`/`library_added_at` — the web stats below are unbuildable without this.

- [x] **Task 3: Scope engine + shared stat computation** (AC: 4–7)
  - [x] 3.1 Reuse `detectDancefloor` + `segmentStats`; extend `web/lib/sets` with scope-window play filtering and the new derived stats (longest/shortest by `played_ms`, new-tracks by `library_added_at` window, per-transition Camelot states, BPM histogram bins, arc peak).
  - [x] 3.2 Client Camelot rule mirrors `agent/src-tauri/src/stats/camelot.rs` exactly; add a test cross-checking the client whole-set recompute against `derived.camelot_mixing_stats` on fixture set 975.
  - [x] 3.3 Scope state (Dancefloor default | Whole night), single source of truth feeding header, stats, arc, tracklist annotations at once (AC-5).

- [x] **Task 4: Page shell — header, scope line, arc** (AC: 1–3, 8–9, 31)
  - [x] 4.1 Replace the `/set/[id]` stub entirely (whole-page scroll shell; do not reuse `dashboard-shell` classes). **Note:** the stub hosts the app's only in-product `LiquidMetalButton` demo (3.6 AC-14) — flag its removal to Arjun / record in `deferred-work.md` rather than silently dropping the component's only usage; keep it only if a placement is natural.
  - [x] 4.2 Identity bar + `[⋯]` overflow + scope line + `[ Dancefloor | Whole night ]` switch (hidden per AC-35/36 rules).
  - [x] 4.3 Arc in mode C with scope-driven domain + morph transition (reduced-motion: cut).

- [x] **Task 5: Right-column stats** (AC: 10–16)
  - [x] 5.1 Headline module: harmonic hero pips + % secondary; BPM range/median/sparkline; hairline dividers.
  - [x] 5.2 Genre module (top 3, hover motion vocab).
  - [x] 5.3 Most-played artists (conditional render rules) + Replayed line.
  - [x] 5.4 Longest/Shortest Play module. 5.5 New-tracks module with Week/Month toggle + disclosures. 5.6 Reserved slot G.

- [x] **Task 6: Tracklist** (AC: 17–22)
  - [x] 6.1 Row anatomy + aligned mono metadata columns + `·new·` marker.
  - [x] 6.2 In-key connectors (three states, tooltip, quiet treatment).
  - [x] 6.3 Impact node (`★ PEAK`) from the scoped arc peak.
  - [x] 6.4 FR-2 unknown fallback. 6.5 Load more (~50 initial).

- [x] **Task 7: Drill-in + DR-2 focus mechanism** (AC: 23–30)
  - [x] 7.1 Build the single shared focus mechanism (single-select, "Focused: X ✕" pill, dim-don't-hide, scroll-to-first-match — beware the 3.6 review's `scrollIntoView`-scrolling-ancestor-shells bug; on a whole-page scroll prefer window-level scrolling).
  - [x] 7.2 Overlay frame (right-column footprint, blur, stays-open, back arrow, active row state).
  - [x] 7.3 Genre overlay (+ genre⇄subgenre toggle). 7.4 BPM overlay (histogram + band click). 7.5 Harmonic overlay (transition list + clashes-only filter). 7.6 Most-played-artists overlay (full list).

- [x] **Task 8: Delete** (AC: 32–34)
  - [x] 8.1 Blurred-modal confirm with the exact copy; delete via `deleteSet` seam; redirect + calm inline confirm on the dashboard.
  - [x] 8.2 Record the permanent-tombstone requirement in `deferred-work.md`, owed by the sync/read-path story.

- [x] **Task 9: States pass** (AC: 35–38) — sparse (use fixture 17577), whole-set fallback, aggregate disclosures, low-confidence note. All copy in After-Hours console voice, no exclamations.

- [x] **Task 10: Mobile** (AC: 39) — stacked layout + bottom-sheet drill-in at 375px; touch targets ≥44px.

- [x] **Task 11: Carry-backs + bookkeeping**
  - [x] 11.1 ⚑ **Dashboard carry-back (spec §3g):** low-confidence/no-dancefloor sets should be excluded from the dashboard **by default but VISIBLY** (Story 4.1's pattern: *"N low-confidence sessions hidden — show them"*). 3.6 currently includes the soundcheck fixture — this is a **behavior change, not already-done**. Check whether the 3.6 refinement pass already landed it; if not, record it in `deferred-work.md` as an owed 3.6/dashboard change (do NOT silently implement it inside this story without a ruling).
  - [x] 11.2 Note the 3.8 hooks: arc click-to-jump reuses DR-2 (Q4); Camelot wheel + key/harmonic timeline are 3.8's companion visualization.
  - [x] 11.3 Update sprint-status.yaml on completion.

- [x] **Task 12: Verification**
  - [x] 12.1 Full repo gate: `cargo fmt --check` / `clippy -D warnings` / `cargo test`; `pnpm lint/typecheck/test` (shared + web); supabase `db reset` + pgTAP if Task 2.3 lands.
  - [x] 12.2 **Real-browser walkthrough (non-negotiable — 3.5's and 3.6's worst bugs were only caught this way):** Playwright/headless-Chrome screenshots of: full set 975 both scopes (verify the global flip changes everything at once), the arc morph, each overlay + focus pill + dim-in-place, Longest/Shortest/new-tracks direct focus, load-more, delete flow end-to-end, sparse set 17577, mobile 375px stack + bottom sheet, keyboard-only pass (overlays operable, focus visible), reduced-motion. Zero console errors.

### Review Findings

Code review of the frontend group (`web/app/components/set-detail/*`, `web/lib/sets/setDetail.ts`, `set-detail.css`) via `bmad-code-review`, 2026-08-04. Blind Hunter + Edge Case Hunter + Acceptance Auditor run in parallel, findings deduplicated and read against the actual code before rating (several raw-agent findings turned out to be false positives once traced — see Dismissed below). Backend/capture group (agent Rust, shared schema, supabase migration) deferred to a follow-up review run, not covered here.

**Decision-needed** — resolved by Arjun, 2026-08-04

- [x] [Review][Defer] Arc silently falls back to the whole-night domain when the detected dancefloor segment doesn't overlap any BPM-carrying play — `heroArcGeometry` returns `band: null` in that case, so `DetailArc`'s `zoomed` check is false even though `frame.scope === "dancefloor"` and the scope line/toggle still read "Dancefloor." [web/app/components/set-detail/DetailArc.tsx:31], [web/lib/sets/heroArc.ts:145] — deferred: rare edge case (needs a detected dancefloor whose plays lack BPM data), low value now; natural to revisit alongside 3.8's full arc rebuild.
- [x] [Review][Defer] A single Escape keypress can close the delete-confirmation modal AND a stats drill-in veil simultaneously if both happen to be open (independent `document`-level keydown listeners in `DeleteModal` and `OverlayPanel`, no shared modal stack/priority). [web/app/components/set-detail/DeleteModal.tsx:25-27], [web/app/components/set-detail/Overlays.tsx:60-66] — deferred: low stakes, rare compound state — nothing destructive happens and few users will hit both open at once.
- [x] [Review][Dismiss] Task 3.1 says scope stats recompute "via 3.6's shipped `detectDancefloor` + `segmentStats`," but `web/lib/sets/setDetail.ts` reimplements segment-window filtering independently (`scopedPlays`, epoch-based) instead of calling `segmentStats` (string-based date comparison). [web/lib/sets/setDetail.ts], [web/lib/sets/dancefloor.ts:148] — dismissed: `segmentStats` returns pre-aggregated card stats, not a play list; `scopedPlays` is a legitimately different, necessary primitive for 3.7's needs. No code change.

**Patch** — applied by Arjun's call, 2026-08-04 (typecheck/lint/90 tests green after)

- [x] [Review][Patch] `DeleteModal`'s Escape handler doesn't check `deleting` state (unlike the backdrop click, which does) — pressing Escape mid-delete dismisses the modal while the delete request keeps running, so it looks cancelled but isn't. [web/app/components/set-detail/DeleteModal.tsx:26]
- [x] [Review][Patch] No error handling around the delete action, and no `revalidatePath`/`revalidateTag` backing the post-delete redirect — currently unreachable since the fixture-backed `deleteSet` can't throw, but this is the documented Supabase swap-in seam, worth hardening before that lands. [web/app/(authenticated)/set/[id]/actions.ts:12-15], [web/app/components/set-detail/DeleteModal.tsx:65-68]
- [x] [Review][Patch] Tracklist key-chip color reads `play.camelot_key` raw instead of through the already-built `parseCamelot` validator — a malformed key produces an invalid CSS custom-property reference (fails silently past the intended neutral fallback) instead of degrading gracefully. [web/app/components/set-detail/Tracklist.tsx:124-130]
- [x] [Review][Patch] Duplicate `.sd-module-reserved` CSS rule — two separate blocks target the same class; only one is live (enrichment slot G), the other looks orphaned from an earlier arc-slot-C ghost state. [web/app/set-detail.css:540, 811]
- [x] [Review][Patch] `scopedLength()` returns `0` (renders "0m") for a scope with exactly one timed play, instead of `null` (renders "—" — the function already supports this for zero timed plays), conflating "zero duration" with "can't measure a duration." [web/app/components/set-detail/SetHeader.tsx:31]
- [x] [Review][Patch] `newTracks()` has no guard for plays with both `title` and `artist` null, unlike its sibling `replayedTracks()` ("no identity to count") — unrelated untitled/unattributed plays collapse into one fake track, corrupting the new-tracks count and `·new·` row markers. [web/lib/sets/setDetail.ts:254]
- [x] [Review][Patch] No keyboard focus trap in `DeleteModal` — the one true modal in the app (`OverlayPanel` intentionally leaves the tracklist reachable, this doesn't); Tab/Shift+Tab can move focus into the page behind the scrim. [web/app/components/set-detail/DeleteModal.tsx]
- [x] [Review][Patch] No focus restoration on close for `DeleteModal` (Cancel/Escape) or `OverlayPanel` (back button) — focus is lost rather than returned to the `[⋯]` trigger / stat button that opened them. [web/app/components/set-detail/DeleteModal.tsx], [web/app/components/set-detail/Overlays.tsx]
- [x] [Review][Patch] `StatsColumn`'s dimmed stack uses `aria-hidden` alone while a drill-in veil is open, with no `inert` — keyboard focus can still land on visually-covered, `aria-hidden` buttons (WCAG 4.1.2). [web/app/components/set-detail/StatsColumn.tsx:104]
- [x] [Review][Patch] `setShape()`/`showShape` renders the same play as both "Longest Play" and "Shortest Play" when only one play in scope has a captured `played_ms` — misleading given the "real captured duration, never fabricated" principle the rest of the module holds to. [web/app/components/set-detail/StatsColumn.tsx:210-244], [web/lib/sets/setDetail.ts:198-212]
- [x] [Review][Patch] The "Replayed: X ×N" line is nested inside the artist-concentration-gated (`showArtists`) section, so a replayed track with a null/untagged artist never shows it — AC-13 states the Replayed condition ("any single track's count > 1") independent of the artist-concentration rule. [web/app/components/set-detail/StatsColumn.tsx:330-334]
- [x] [Review][Patch] `GenreOverlay` has no empty-state message for a zero-play scope, unlike the BPM/Harmonic/Artists overlays (which all show "No X data in this scope"). [web/app/components/set-detail/Overlays.tsx:130-208]
- [x] [Review][Patch] Touch targets below the story's own ≥44px mobile requirement (Task 10, AC-39) on 7 selectors, none resized in the `@media (max-width: 900px)` block: `.sd-scope-option` (32px), `.sd-mini-toggle button` (30px), `.sd-overflow-trigger` (36px), `.sd-overlay-back` (38px), `.sd-artist-row`/`.sd-overlay-row` (40px), `.sd-focus-pill` (36px), `.sd-histogram-band` (34px). Task 10 is checked off but the requirement isn't met. [web/app/set-detail.css]
- [x] [Review][Patch] Indentation inconsistency in `StatsColumn.tsx` — the "Set shape" and "Most-played artists" sections' `dz-dots` span sits at the same level as its parent `<section>` instead of nested one level deeper, unlike every other module in the file. Cosmetic only. [web/app/components/set-detail/StatsColumn.tsx:212, 294]
- [x] [Review][Patch] Dashboard's `?deleted=` note shows for any truthy value of the query param (not just right after an actual delete) — a shared/bookmarked/back-navigated URL re-shows "Set deleted" with nothing having just happened. Low-stakes but worth clearing the param client-side after display. [web/app/(authenticated)/dashboard/page.tsx:61]
- [x] [Review][Patch — bonus, found mid-fix, not in original agent findings] Two literal NUL bytes (`\x00`) embedded in the source between `${p.title ?? ""}` and `${p.artist ?? ""}` in the track-identity template literals — invisible on a normal read, only surfaced when an exact-string edit tool failed to match. Functionally benign as a Map-key delimiter but clearly unintentional; replaced with a plain space in both `newTracks()` and `replayedTracks()`. [web/lib/sets/setDetail.ts]

**Defer**

- [x] [Review][Defer] No authorization/ownership check in `deleteSetAction` — Server Actions are reachable independent of route-group layout gating, so anyone who knows/guesses an `external_id` could delete it. Same pre-existing gap already flagged in this story's own Dev Notes ("No auth-gating redirect exists yet on the `(authenticated)` group") and in Story 3.5's Dev Agent Record — not introduced by 3.7, not actionable without the auth-gating work landing first. [web/app/(authenticated)/set/[id]/actions.ts], [web/app/(authenticated)/layout.tsx] — deferred, pre-existing
- [x] [Review][Defer] `bpmHistogram` doesn't clamp or bucket single-outlier BPM values, which can produce a long, mostly-empty band range in the BPM overlay. Polish/enhancement, not a spec violation. [web/lib/sets/setDetail.ts:168-183] — deferred, pre-existing

**Dismissed as noise (6)** — verified false positives or already-resolved-by-design:
- `React.CSSProperties` used without an explicit `React` import in `Tracklist.tsx` — not a compile error; the codebase already relies on `React` as an ambient UMD-global type elsewhere without importing it (`GlassCalendar.tsx`, `MetalButton.tsx`, `layout.tsx`).
- Tracklist connectors computed over the unscoped full set while stats use the scoped frame — matches an explicit, dated "RESOLVED" decision in the design spec §6 ("the tracklist does NOT react to the scope flip... per D1/DR-1 as originally locked"); a stale historical Dev Agent Record line elsewhere still reads as an "open question" but that predates the resolution.
- Global `html, body { overflow-x: hidden → clip }` change in `globals.css` — deliberate, correctly-reasoned fix for `position: sticky` breaking under a scroll-container ancestor (also independently documented in this story's own Debug Log, catch #2).
- Delete modal copy ("removes it from Curfew for good — it can't be undone") vs. the deferred tombstone requirement — copy is spec-locked verbatim (AC-32); the tombstone gap is already tracked in `deferred-work.md`, owed by a future sync story.
- `DetailArc` never marks the ★ PEAK point on the curve itself — full arc annotation is explicitly 3.8 scope per the build-order table ("3.8 fills slot C: full annotated energy arc"); 3.7 reuses 3.6's thumbnail geometry as-is.
- `scopedPlays` NaN segment boundaries from an unparsable ISO string — unreachable; `segment` only ever comes from 3.6's `detectDancefloor`, which derives bounds from real play timestamps.

## Dev Notes

### Data available (frozen wire — spec §4)

- **`set.derived` (`SyncSetDerived`, `shared/src/index.ts:114`):** `most_played_tracks`, `most_played_artists`, `genre_breakdown{buckets,no_genre_count}`, `subgenre_breakdown?`, `bpm_distribution{count,min,max,mean,median}`, `camelot_mixing_stats{compatible,incompatible,excluded_no_key}`, `set_length_sec`, `track_count`, `energy_arc[{started_at,bpm}]`, `confidence{value,track_count,long_gap_count}`.
- **`plays[]` (`SyncPlay`, `shared/src/index.ts:76`):** `position`, `title`, `artist`, `started_at` (ISO), `bpm`, `genre{raw,normalized,taxonomy_version,subgenre?}`, `camelot_key`, `in_library` — plus this story's additive `played_ms` and `library_added_at`.
- **Key point:** every play carries per-play timestamp+bpm+genre+key, so **all segment-scoped stats recompute client-side**; `derived` is the whole-set default/cache. Dancefloor vs whole-night needs no schema change.

### Reuse map — build on these, do not reinvent

| Need | Existing code (on the 3.6 branch) |
|---|---|
| Data access (read/delete) | `web/lib/sets/index.ts` — `getSetById`, `deleteSet` (fixture-backed seam; Supabase swaps in later with zero component change). Import ONLY from here. |
| Dancefloor detection + segment stats | `web/lib/sets/dancefloor.ts` — `detectDancefloor(plays)`, `segmentStats(plays, segment)` (v0 global heuristic, knowingly interim → 5.2) |
| Arc geometry + a11y text | `web/lib/sets/energyArc.ts` (`arcGeometry`, `arcTextEquivalent`), `heroArc.ts`, rendered today in `web/app/components/dashboard/HeroBand.tsx` |
| Formatting | `web/lib/sets/format.ts` — `formatSetDate`, `formatSessionLabel`, `formatDuration`, `formatClock`, `formatTimeRange`, `formatBpm`, `topGenres` |
| Route | `web/app/(authenticated)/set/[id]/page.tsx` — stub to replace entirely (404s unknown ids via the seam already) |
| Motion vocab reference | `HeroBand.tsx` hover treatment; framer-motion `^12.43.0` already a dependency |
| Camelot mapping/rule | `agent/src-tauri/src/stats/camelot.rs`; joiner mapping in `joiner/serato4.rs` (3.6's `key_value` fix — 0–11 = A ring, 12–23 = B ring, `(v % 12) + 1`) |
| Backfill mechanism | `agent/src-tauri/src/backfill.rs` (`backfill_captured_serato4` — change-detecting, self-terminating), `store.rs::mark_for_resync` |
| Fixture pipeline | `agent/src-tauri/tests/export_real_fixtures.rs` (env-gated, read-only) → `web/lib/sets/build-fixture.mjs` → `recent-sets.fixture.json` (epoch→ISO conversion happens here) |
| Fixtures on hand | Set 975 (178 plays, 5.9h, real ~1h dancefloor detected) + soundcheck 17577 (1 play — the sparse-state case) |

### Architecture constraints

- **Obsidian tokens only** — no hex/oklch literals; `no-hardcoded-colors.test.ts` enforces it. The live accent is `--color-primary` (**Ember rose**, not the stale "lavender" wording in older docs); cyan/ice glow tokens exist from the dashboard work.
- **Frozen wire contract:** `shared/` changes are additive-only (AR-15/AD-15); never mutate or remove a field; new fields optional; the additive-only test is the guard.
- **AD-11 never-guess:** unmappable values → `null`/disclosed, never fabricated (e.g. `end_time = -1`, missing `tadd`).
- **UX-DR18/20/21/22:** calm console voice, no alarm colors/red/exclamations, no infinite scroll, WCAG 2.2 AA, no scroll-driven motion on logged-in surfaces, mobile-fluid.
- shadcn `ui` alias → `@/app/components/ui`; feature components → `web/app/components/set-detail/` (new grouping, matching `components/{auth,nav,dashboard}`); pure logic → `web/lib/sets/`.
- No auth-gating redirect exists yet on the `(authenticated)` group — pre-existing known gap; don't rely on it, don't silently fix it here.

### Known gotchas (all bit previous stories)

- **CSS Cascade Layers:** an *unlayered* rule beats every `@layer` rule regardless of order — keep new global CSS layered (3.5's worst bug).
- **`@property` + `setProperty` (memory `ref-property-setproperty-bug`):** runtime `setProperty` on *registered* `@property` vars is silently ignored under Next16/Tailwind v4's Lightning CSS — use **unregistered vars + rAF lerp** for runtime-animated custom props (relevant to connector glow, arc morph, overlay blur-in).
- **Lightning CSS `translate: none` trap** (same memory): base-positioning declarations can be folded into `transform` and deleted — scope base positioning to the complement media range instead.
- **`scrollIntoView` scrolled ancestor panel shells** in the 3.6 refinement (fixed in `2b1e10d`) — for DR-2's scroll-to-first-match on a whole-page scroll, prefer window-level scrolling.
- **Verify in a real browser** — repeated lesson: the worst bugs (inert Tailwind utilities, overflowing pill, overlapping badges) were only ever caught by an actual Playwright walkthrough, never by code review.

### Previous-story intelligence (3.6, status: review)

- Stack: Tailwind v4 (4.3.3), shadcn CLI 4.16.1 (Base UI, base-nova), `@phosphor-icons/react`, framer-motion 12, `@paper-design/shaders` (liquid-metal). Repo gate green expected throughout (agent 332 tests at 3.6 close).
- 3.6's key-fix means **harmonic data is real (~94% coverage)** — the hero slot is earned, not aspirational. Genre's ~46% untagged on set 975 is a **genuine library ceiling, not a reading bug** — design the disclosure against that truth.
- The dashboard fixture flows through the *fixed* Rust pipeline; after Task 2.4's regen, keep set 975 + 17577 as the two committed sets.
- 3.6's backfill already demonstrated the exact re-derive→diff→`mark_for_resync`→drain-loop re-push cycle this story's backfill rides.
- A post-review refinement pass restructured the dashboard components (`HeroBand`/`SetListPanel`/`RightColumn`/…) — trust the code on the branch over 3.6's File List when names differ.

### Testing standards

- Web logic: vitest colocated in `web/lib/sets/*.test.ts` (follow `dancefloor.test.ts`); component-free pure functions preferred for stats/scope/camelot/histogram/peak so they're unit-testable.
- Agent: unit tests colocated + capture-path regression tests through `build_serato4` (3.6 pattern); `cargo fmt --check` / `clippy -D warnings` / `cargo test` all green.
- Shared: additive-only + schema-parity guards must stay green with the new optional fields.
- Supabase (if Task 2.3): migration applies on clean `supabase db reset`; pgTAP suite + additive-only guard green.
- Browser walkthrough per Task 12.2.

### Out of scope (do not build)

- **5.1/5.3:** `segments` table, draggable-pointer segment editor, any manual-segment persistence (D3/D4).
- **3.8:** full annotated arc + chart-summary captions, Camelot wheel, key/harmonic timeline, arc click-to-jump (build DR-2 so it can hook in; don't build the hook).
- **5.5:** enrichment content (slot G stays a reserved slot). **5.2:** calibrated dancefloor detection (v0 stays). **5.4:** generalized segments.
- Cloud read path (fixture seam stays); the delete tombstone implementation (recorded, owed by the sync story).

### References

- [Source: _bmad-output/implementation-artifacts/3-7-set-detail.md] — **authoritative spec, governs on conflict/omission** (§0 dividing line, §1 D1–D5, §2 Q1–Q4, §3 layout L-1…L-5, §3a sections C/D/E/F/G, §3b DR-1/DR-2, §3c extra stats, §3d capture, §3e identity+delete, §3f states, §3g carry-backs, §3h overlay contents, §3i mobile, §4 data, §5 confirms).
- [Source: _bmad-output/implementation-artifacts/serato-capture-completeness.md] — field map + 2026-08-03 live verification (23,259 plays): `end_time` 98%, `played` 75%, `portable_id` 100%, `asset` join only 4.6% → `database V2` `tadd` ~94% is the date-added source.
- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.7] — base ACs + ⚑ notes 2026-08-02 / 2026-08-03 (the design-session note currently exists only on the 3.6 branch's copy).
- [Source: _bmad-output/implementation-artifacts/3-6-dashboard-home.md] — previous-story intelligence, file list, backfill/resync mechanism, real-data findings.
- [Source: shared/src/index.ts:76,114] — frozen `SyncPlay`/`SyncSetDerived`.
- [Memory: feedback_design_taste] — match reference intensity; plain names over clever; diagnose before cutting. [Memory: ref-property-setproperty-bug] — runtime CSS-var gotchas. [Memory: bug-serato-key-parsing] — the key-fix behind the harmonic hero.

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5) — bmad-dev-story session, 2026-08-03.

### Debug Log References

- Real-data reconnaissance before coding (all read-only): `~/Music/_Serato_/database V2` probe — 930 otrk records, `tadd`/`uadd` both 100% populated and **identical epoch-seconds values** (`tadd` is a decimal epoch string, not a date string); `master.sqlite` probe — `portable_id` is **volume-root-relative** (`Users/…` for boot-drive, `A Indian/…` for USB tracks), matching `database V2`'s own `pfil` convention exactly, so the date-added join is a direct string match, no path surgery.
- Samsung USB **not mounted** this session → date-added resolves only via the boot-drive catalogue: set 975 = 25/105 plays with an add-date (the ~94% ceiling needs the USB present; the backfill carry-forward guard makes this self-improving and never-regressing across plug/unplug cycles).
- Played-flag reality on the fixture sets (played=1 / total): 975: 105/178 · 977: 51/75 · 971: 78/154 · 967: 90/184 · 963: 28/49 · 957: 98/164 · 953: 34/49 · 17577: 1/1. `played_ms` coverage after the `-1` fallback chain: 105/105 on set 975.
- **Pre-existing break found on main:** `tests/golden_serato4.rs` was never updated by Story 3.6's key-source change (parser `Play.key` → always `None` for serato4) — the suite has been failing on `main` since the 3.6 merge (its fixture also lacked `key_value`, so the joiner's 3.6-era SELECT errored). Fixed forward here: fixture rebuilt to the live-verified real schema, expectations now pin both the 3.6 key rule and the 3.7 capture fields at golden level.
- Browser-walkthrough catches (all fixed same-session, none caught by tests/typecheck — the 3.5/3.6 lesson holds): (1) framer-motion clobbered the arc-morph transform origin (`fill-box` 50/50) → morph rebuilt as an animated SVG `viewBox` zoom (svg viewport does the clipping, `non-scaling-stroke` keeps line weight); (2) `html, body { overflow-x: hidden }` (globals.css, Story 2.2) silently made `body` the sticky scrollport while the window scrolls → `position: sticky` (stats rail + focus pill) never engaged → changed to `overflow-x: clip` (same clipping, never a scroll container — .dz's own reasoning); (3) `.sd button` reset out-specified `.sd-focus-pill`'s fill → `:where()` zero-specificity reset; (4) delete modal's `position: fixed` was captured by `.sd-identity`'s `backdrop-filter` containing block → portaled to `document.body`; (5) framer's `useReducedMotion` lagged a runtime preference flip → the morph reads `matchMedia` directly at flip time (hard cut verified at 50ms).
- `supabase db reset` + pgTAP execution: initially blocked — Docker Desktop would not start because the disk was nearly full (6.8GB free). **RESOLVED same session:** freed ~17GB (cargo target dirs + regenerable caches), Docker started cleanly on its own, `supabase db reset` applied all migrations including `20260803190000_add_play_capture_fields.sql` with no errors, and the full pgTAP suite passed — **61/61 across 3 files** (including the new `played_ms`/`library_added_at` round-trip + pre-3.7 null-field assertions, plan 10 → 13). The Supabase gate is fully green at runtime, not just statically.

### Completion Notes List

- **Agent capture pass (Tasks 1–2):** `EnrichedPlay` now captures comprehensively (`played_ms`, `ended_at`, `played`, `deck`, `total_length_ms`, `library_added_at`); `build_serato4` honors the `played` flag (previews dropped before positions/stats/durations — set 975 is now honestly 105 plays, not 178), applies the `end_time = -1` fallback (next played play's start, else `history_session.end_time`), and resolves library date-added through the new cross-path `joiner/date_added.rs` (`DateAddedIndex`: lazy, loads `~/Music` + every mounted `/Volumes/*` `database V2`; `uadd` preferred, numeric `tadd` fallback; per-catalogue symlink scope guard). Legacy path captures the same fields where present (field-45 duration; `LibraryTrack.date_added`).
- **Wire (additive, AR-15):** `SyncPlay.played_ms` (int ms) + `SyncPlay.library_added_at` (ISO) — optional; schema + TS parity + additive-only tests green; `agent_version` 0.0.0 → 0.1.0. Supabase migration `20260803190000_add_play_capture_fields.sql` adds `plays.played_ms` (bigint) + `plays.library_added_at` (timestamptz) and replaces `sync_set()` so the fields survive the RPC boundary; pgTAP extended (see Debug Log for the execution caveat).
- **Backfill:** rides 3.6's change-detecting sweep untouched except for the new **carry-forward guard**: a stored `library_added_at` survives a re-derivation run with its covering volume unmounted (matched on `started_at` + title), so drive plug/unplug cycles can neither erase dates nor re-sync 491 sets back and forth. Gains still write + re-queue exactly once. Runs on next agent launch.
- **Web (Tasks 3–10):** pure scope engine + stats in `web/lib/sets/setDetail.ts` (scoped plays, client Camelot rule mirroring `stats/camelot.rs` — cross-checked equal to `derived.camelot_mixing_stats` AND `derived.bpm_distribution` on fixture 975 in tests; transitions, histogram, set shape by real `played_ms`, set-date-relative new-tracks, artists/replays, genre/subgenre rankings, sustained-BPM arc peak). Page: whole-page scroll (no dashboard shell), header A/B ~24% + arc ~76% scrolls away, tracklist spine ~67% + sticky stats rail ~33%; global `[ Dancefloor | Whole night ]` flip changes every pane in one frame and clears any focus (never mixes frames); arc = the 3.6 heroArc geometry with a viewBox-zoom domain morph (reduced motion: hard cut). One shared DR-2 focus mechanism (positions-based, single-select, dim-never-hide, window-level scroll-to-first-match, dismissable pill) feeds genre/BPM-band/harmonic/artist/longest/shortest/new-tracks; overlays are right-column-only with blurred backdrop, stay open, back arrow, scope-reactive; mobile stacks with the same overlay as a bottom sheet. Delete = portaled calm modal with the exact spec copy → `deleteSet` seam → dashboard redirect + quiet "Set deleted." line. All §3f states verified live on fixtures 975/17577/953 (sparse, whole-set fallback, disclosures, low-confidence note — display rule: `confidence.value ≤ 0.5` or `track_count < 4`).
- **Verification:** agent `cargo fmt --check` / `clippy -D warnings` / 346 lib tests + golden suites; shared 20; web lint / typecheck / 90 tests (22 new); additive-only migrations guard. Real-browser Playwright walkthrough at 1440px and 375px: both scopes on 975 (global flip verified), arc morph + reduced-motion hard cut, genre/BPM/harmonic/artists overlays with live focus + pill + dim-in-place, longest/shortest + new-tracks direct focus, load-more ×2 to all 105 rows, delete end-to-end on 953 (modal → dashboard, set absent, calm confirm), sparse 17577, mobile stack + bottom sheet, keyboard-only pass (Enter opens overlay → focus lands on back arrow → row focus works → Escape closes), **zero console errors** on the final build. Screenshots in `.playwright-mcp/` (`sd-*.png`).
- **Carry-backs recorded in `deferred-work.md`:** permanent delete tombstone (owed by the sync/read-path story); ⚑ dashboard low-confidence exclusion (verified NOT landed by 3.6 — recorded for a ruling, not implemented); `LiquidMetalButton` demo displacement (stub replacement removed its only in-product usage); 3.8 hooks (DR-2 reuse for arc click-to-jump; wheel/timeline; same `DetailArc` upgrades).
- **Fixture regenerated** (env-gated, read-only) through the fixed pipeline: 8 sets, plays now played-filtered with `played_ms` (100%) + `library_added_at` (partial — USB unplugged; see Debug Log). `serato-capture-completeness.md` field map updated to shipped.

### File List

Agent:
- agent/src-tauri/Cargo.toml (+Cargo.lock) — version 0.0.0 → 0.1.0 (agent_version bump, AC-41)
- agent/src-tauri/src/joiner/mod.rs — `JoinedMetadata` + ended_at/played/total_length_ms/portable_path/library_added_at
- agent/src-tauri/src/joiner/serato4.rs — SELECT + mapping for the new columns; `sane_length_ms`
- agent/src-tauri/src/joiner/legacy.rs — `LibraryTrack.date_added` (uadd/tadd), `date_added_for`, join wiring
- agent/src-tauri/src/joiner/date_added.rs — NEW: cross-path `DateAddedIndex` (lazy multi-catalogue lookup)
- agent/src-tauri/src/joiner/embedded_tags.rs — fill_gaps carries the new fields through
- agent/src-tauri/src/stats/mod.rs — `EnrichedPlay` extension, enrich mapping, `resolve_played_ms`
- agent/src-tauri/src/stats/camelot.rs — test helper updated
- agent/src-tauri/src/capture.rs — played filter, set-end lookup, date lookup, assemble → CapturedPlay promotion
- agent/src-tauri/src/store.rs — `CapturedPlay.played_ms` + `library_added_at`
- agent/src-tauri/src/backfill.rs — dates param + `carry_forward_library_dates` guard
- agent/src-tauri/src/watcher/mod.rs — `DateAddedIndex` threaded through the capture chain
- agent/src-tauri/src/sync.rs, sync_queue.rs, confidence.rs — test fixtures/helpers updated
- agent/src-tauri/src/lib.rs — startup sweep constructs one lazy index
- agent/src-tauri/tests/export_real_fixtures.rs — dates + ratio assertions (+played_ms/date counts)
- agent/src-tauri/tests/golden_serato4.rs + tests/fixtures/serato4/history_session_and_entries.sql — fixed forward to the real schema (pre-existing break, see Debug Log)
- agent/src-tauri/tests/golden_legacy_library.rs — upstream fixture genuinely carries date-added; expectations updated

Shared:
- shared/src/index.ts — `SyncPlay.played_ms` / `library_added_at` (optional, AD-15)
- shared/schema/sync-payload.schema.json — same, language-neutral
- shared/src/index.test.ts — parity test split required vs all properties

Supabase:
- supabase/migrations/20260803190000_add_play_capture_fields.sql — NEW: columns + sync_set replacement
- supabase/tests/sync_set_isolation_test.sql — round-trip + pre-3.7 null-field cases (plan 10 → 13)

Web:
- web/lib/sets/setDetail.ts + setDetail.test.ts — NEW: scope engine, Camelot mirror, stats, peak (22 tests incl. fixture cross-checks)
- web/lib/sets/build-fixture.mjs — carries played_ms + library_added_at (epoch→ISO)
- web/lib/sets/recent-sets.fixture.json — regenerated through the fixed pipeline
- web/app/(authenticated)/set/[id]/page.tsx — stub replaced with the real screen
- web/app/(authenticated)/set/[id]/actions.ts — NEW: deleteSetAction (server action → seam → redirect)
- web/app/(authenticated)/dashboard/page.tsx — post-delete calm confirm line
- web/app/components/set-detail/ — NEW: model.ts, SetDetail.tsx, SetHeader.tsx, DetailArc.tsx, Tracklist.tsx, StatsColumn.tsx, Overlays.tsx, DeleteModal.tsx
- web/app/set-detail.css — NEW: the page's full style layer (sd- prefix, token-only)
- web/app/globals.css — set-detail.css import; html/body `overflow-x: hidden` → `clip` (sticky fix, see Debug Log)
- web/app/dashboard.css — .dz-deleted-note

Docs:
- _bmad-output/implementation-artifacts/serato-capture-completeness.md — field map → shipped + coverage note
- _bmad-output/implementation-artifacts/deferred-work.md — four 3.7 entries (tombstone, dashboard carry-back, LiquidMetalButton, 3.8 hooks)
- _bmad-output/implementation-artifacts/sprint-status.yaml — 3-7 → review
- _bmad-output/implementation-artifacts/3-7-set-detail-summary-tracklist.md — this bookkeeping

### Change Log

- 2026-08-03 (round 3) — Veil frost corrected to Arjun's intent: translucent (blur carries the frosting — ramp compressed to a narrow left-edge strip, full 46px frost + light ink tint + faint white sheen under all content, no blackout), confined to the right-column footprint so the tracklist's key chips never catch the ramp, histogram bands stretch to fill the panel height. **Durable gotcha found live:** a `mix-blend-mode` child turns its parent into a backdrop root, silently disabling every sibling `backdrop-filter` — the sheen must be plain translucent paint.
- 2026-08-03 (round 2) — Veil execution corrected per Arjun's screenshot (ramp = left-edge transition zone only; near-opaque scrim under the content zone; width tightened to the right-column footprint); MetalRim extracted as a shared wrapper and applied to the veil back arrow + genre⇄subgenre + Week/Month toggles; connector glyph → lucide `key` icon in a 20px chip. Ruling recorded: tracklist does NOT react to scope ("leave neither"). Gate green, zero console errors.
- 2026-08-03 (later) — Post-review refinement pass from Arjun's live test, all shipped + gate green (lint/tsc/90 web tests, zero console errors): Silk backdrop + dz-shell glint/shimmer/dots carried onto Set Detail; right-column hover washes removed; drill-in reworked into the right-side gradual-blur veil (slide-in, mobile sheet unchanged); BPM histogram rotated to horizontal bars; "in-key" wording (never "smooth"); Camelot-wheel-colored key chips (24 new tokens); CursorChip on genre rows (track count) + compact CursorChip on connectors (replacing the CSS tooltip, glyph brightened); liquid-metal rim on the scope toggle. Recorded in the design doc §6; tracklist-reacts-to-scope left as an open design question for Arjun.
- 2026-08-03 — Story 3.7 implemented end-to-end (agent capture pass, additive wire promotion, Supabase columns/RPC, backfill carry-forward guard, fixture regen, full Set Detail screen with scope engine / DR-2 focus / overlays / delete / states / mobile). Full gate green + real-browser walkthrough at desktop and 375px, zero console errors. pgTAP executed later the same session after freeing disk space (61/61 pass) — the only remaining follow-ups are the recorded carry-backs in deferred-work.md.
