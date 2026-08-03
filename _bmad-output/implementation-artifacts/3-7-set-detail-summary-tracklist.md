# Story 3.7: Set Detail summary + tracklist

Status: ready-for-dev

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

- [ ] **Task 0: Branch-state preflight** (blocking)
  - [ ] 0.1 Confirm `story/3-6-dashboard-home` is merged into `main` (spec docs + 3.6 code present). If not merged, halt and get Arjun's ruling.
  - [ ] 0.2 Branch `story/3-7-set-detail` off `main`.
  - [ ] 0.3 Read `3-7-set-detail.md` and `serato-capture-completeness.md` fully.

- [ ] **Task 1: Agent capture pass** (AC: 40, 42, 44)
  - [ ] 1.1 `joiner/serato4.rs`: extend the SELECT with `end_time`, `played`, `deck`, `length_sec`/`length_ms`, `portable_id`; read fully before editing — it owns the id-correlation join contract and the 3.6 `key_value`→Camelot mapping; break neither.
  - [ ] 1.2 Wire a `database V2` `tadd`-by-path lookup into the serato4 enrichment path (the parser exists on the legacy path; this is the cross-path task). Sources: `/Volumes/Samsung USB/_Serato_/database V2` and/or `~/Music/_Serato_/database V2`.
  - [ ] 1.3 Extend `EnrichedPlay` with `played_ms`, `ended_at`, `library_added_at`, `total_length_ms`, `deck`, `played`; apply the `end_time = -1` fallback (next-play-start, else set-end); filter stats/plays on the `played` flag.
  - [ ] 1.4 Legacy path sanity-check (`legacy.rs`): same fields where present (`.session` field 45 carries a precomputed duration).
  - [ ] 1.5 Unit + capture-path regression tests (follow 3.6's pattern: full-pipeline test through `build_serato4`).
  - [ ] 1.6 Update `serato-capture-completeness.md` field-map rows to "shipped".

- [ ] **Task 2: Wire contract + backfill + cloud columns** (AC: 41, 43)
  - [ ] 2.1 `shared/src/index.ts`: add optional `SyncPlay.played_ms` (number|null) + `SyncPlay.library_added_at` (ISO string|null, same convention as `started_at`); update `schema/sync-payload.schema.json`; keep `additive-only.test.ts` green; bump `agent_version`.
  - [ ] 2.2 Extend the backfill sweep so re-derivation with the new fields marks changed rows for resync (`mark_for_resync` — 3.6's mechanism already does this on diff; verify the new fields flow through).
  - [ ] 2.3 **Supabase (derived requirement — the spec is silent, but 3.6's "same data on every device" ruling implies it):** additive migration adding `plays.played_ms` + `plays.library_added_at`, update the Story 3.2 sync RPC to write them, pgTAP + additive-only guard green. Without this the re-synced rows silently drop the new fields at the RPC boundary. If Arjun prefers to defer cloud persistence, get a ruling — don't silently drop.
  - [ ] 2.4 **Regenerate the web fixture** via `agent/src-tauri/tests/export_real_fixtures.rs` (env-gated, read-only) + `web/lib/sets/build-fixture.mjs` so `recent-sets.fixture.json` carries `played_ms`/`library_added_at` — the web stats below are unbuildable without this.

- [ ] **Task 3: Scope engine + shared stat computation** (AC: 4–7)
  - [ ] 3.1 Reuse `detectDancefloor` + `segmentStats`; extend `web/lib/sets` with scope-window play filtering and the new derived stats (longest/shortest by `played_ms`, new-tracks by `library_added_at` window, per-transition Camelot states, BPM histogram bins, arc peak).
  - [ ] 3.2 Client Camelot rule mirrors `agent/src-tauri/src/stats/camelot.rs` exactly; add a test cross-checking the client whole-set recompute against `derived.camelot_mixing_stats` on fixture set 975.
  - [ ] 3.3 Scope state (Dancefloor default | Whole night), single source of truth feeding header, stats, arc, tracklist annotations at once (AC-5).

- [ ] **Task 4: Page shell — header, scope line, arc** (AC: 1–3, 8–9, 31)
  - [ ] 4.1 Replace the `/set/[id]` stub entirely (whole-page scroll shell; do not reuse `dashboard-shell` classes). **Note:** the stub hosts the app's only in-product `LiquidMetalButton` demo (3.6 AC-14) — flag its removal to Arjun / record in `deferred-work.md` rather than silently dropping the component's only usage; keep it only if a placement is natural.
  - [ ] 4.2 Identity bar + `[⋯]` overflow + scope line + `[ Dancefloor | Whole night ]` switch (hidden per AC-35/36 rules).
  - [ ] 4.3 Arc in mode C with scope-driven domain + morph transition (reduced-motion: cut).

- [ ] **Task 5: Right-column stats** (AC: 10–16)
  - [ ] 5.1 Headline module: harmonic hero pips + % secondary; BPM range/median/sparkline; hairline dividers.
  - [ ] 5.2 Genre module (top 3, hover motion vocab).
  - [ ] 5.3 Most-played artists (conditional render rules) + Replayed line.
  - [ ] 5.4 Longest/Shortest Play module. 5.5 New-tracks module with Week/Month toggle + disclosures. 5.6 Reserved slot G.

- [ ] **Task 6: Tracklist** (AC: 17–22)
  - [ ] 6.1 Row anatomy + aligned mono metadata columns + `·new·` marker.
  - [ ] 6.2 In-key connectors (three states, tooltip, quiet treatment).
  - [ ] 6.3 Impact node (`★ PEAK`) from the scoped arc peak.
  - [ ] 6.4 FR-2 unknown fallback. 6.5 Load more (~50 initial).

- [ ] **Task 7: Drill-in + DR-2 focus mechanism** (AC: 23–30)
  - [ ] 7.1 Build the single shared focus mechanism (single-select, "Focused: X ✕" pill, dim-don't-hide, scroll-to-first-match — beware the 3.6 review's `scrollIntoView`-scrolling-ancestor-shells bug; on a whole-page scroll prefer window-level scrolling).
  - [ ] 7.2 Overlay frame (right-column footprint, blur, stays-open, back arrow, active row state).
  - [ ] 7.3 Genre overlay (+ genre⇄subgenre toggle). 7.4 BPM overlay (histogram + band click). 7.5 Harmonic overlay (transition list + clashes-only filter). 7.6 Most-played-artists overlay (full list).

- [ ] **Task 8: Delete** (AC: 32–34)
  - [ ] 8.1 Blurred-modal confirm with the exact copy; delete via `deleteSet` seam; redirect + calm inline confirm on the dashboard.
  - [ ] 8.2 Record the permanent-tombstone requirement in `deferred-work.md`, owed by the sync/read-path story.

- [ ] **Task 9: States pass** (AC: 35–38) — sparse (use fixture 17577), whole-set fallback, aggregate disclosures, low-confidence note. All copy in After-Hours console voice, no exclamations.

- [ ] **Task 10: Mobile** (AC: 39) — stacked layout + bottom-sheet drill-in at 375px; touch targets ≥44px.

- [ ] **Task 11: Carry-backs + bookkeeping**
  - [ ] 11.1 ⚑ **Dashboard carry-back (spec §3g):** low-confidence/no-dancefloor sets should be excluded from the dashboard **by default but VISIBLY** (Story 4.1's pattern: *"N low-confidence sessions hidden — show them"*). 3.6 currently includes the soundcheck fixture — this is a **behavior change, not already-done**. Check whether the 3.6 refinement pass already landed it; if not, record it in `deferred-work.md` as an owed 3.6/dashboard change (do NOT silently implement it inside this story without a ruling).
  - [ ] 11.2 Note the 3.8 hooks: arc click-to-jump reuses DR-2 (Q4); Camelot wheel + key/harmonic timeline are 3.8's companion visualization.
  - [ ] 11.3 Update sprint-status.yaml on completion.

- [ ] **Task 12: Verification**
  - [ ] 12.1 Full repo gate: `cargo fmt --check` / `clippy -D warnings` / `cargo test`; `pnpm lint/typecheck/test` (shared + web); supabase `db reset` + pgTAP if Task 2.3 lands.
  - [ ] 12.2 **Real-browser walkthrough (non-negotiable — 3.5's and 3.6's worst bugs were only caught this way):** Playwright/headless-Chrome screenshots of: full set 975 both scopes (verify the global flip changes everything at once), the arc morph, each overlay + focus pill + dim-in-place, Longest/Shortest/new-tracks direct focus, load-more, delete flow end-to-end, sparse set 17577, mobile 375px stack + bottom sheet, keyboard-only pass (overlays operable, focus visible), reduced-motion. Zero console errors.

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

### Debug Log References

### Completion Notes List

### File List
