# Story 3.7 — Set Detail summary + tracklist (design working doc)

> Living design doc. Captures decisions from the step-by-step design session (Arjun, 2026-08-03) as they lock, so nothing is lost before the story is written for dev. Feeds back into `epics.md` §Story 3.7 once stable.
>
> **Source inputs already read:** `epics.md` Story 3.7 block + both ⚑ refinements (2026-08-02, 2026-08-03), `3-6-dashboard-home.md` (shipped: dancefloor v0 detector, reusable arc renderer, data-access seam, `plays[]` contract), `shared/src/index.ts` (`SyncPlay`, `SyncSetDerived`), `dj-stats.md`, stitch `curfew_set_detail` reference, current `/set/[id]` route stub.

---

## 0. The dividing line (what 3.7 owns vs. later stories)

**3.7 = the read-back shell.** It builds everything that renders from data already in hand (`set.derived` + `plays[]`, correct post key-fix). Anything that **persists a new user-authored artifact** (edited segment, enrichment tags) needs the cloud `segments` overlay table (Story 5.1), which does not exist yet — so it is out of scope here.

Build order for this page:

| Story | Adds to Set Detail | Depends on |
|---|---|---|
| **3.7 (now)** | Full shell: identity bar, delete-set, scope line (shows v0-detected dancefloor), scope switch (view-only recompute), headline stats, most-played, full tracklist. Reserves arc slot (C) + enrichment slot (G). | 3.6 (shipped) |
| **3.8 (next)** | Fills slot C: full annotated energy arc + chart summary. Key/harmonic timeline companion candidate. "Click chart → jump to track" hook. | 3.7 |
| **5.1** | Cloud `segments` overlay table — where a manual segment can be stored. | — |
| **5.2** | Replaces v0 dancefloor detector with per-DJ-calibrated. Scope line gets smarter, no UI change. | 5.1 |
| **5.3** | "Edit" affordance goes live: two draggable pointers over the tracklist; persists manual segment ("remember my edit"). | 5.1 |
| **5.4** | Generalizes scope to any segment (dinner vs. peak). | 5.1–5.3 |
| **5.5** | Fills slot G: Layer 2 enrichment (venue, crowd, event type, notes, pics). | — |
| **5.7** | Location venue suggestion into 5.5 form. | 5.5 |

---

## 1. Locked decisions (this session)

- **D1 — Scope switch is global.** Dancefloor ⟷ Whole night switches *everything* (C/D/E + arc emphasis + impact track) to one frame at once; the screen never mixes two frames. (Arjun, 2026-08-03)
- **D2 — Default scope = dancefloor, every open.** Not persisted as a view preference. (Arjun, 2026-08-03)
- **D3 — Manual segment edits ARE stored** — but storage needs 5.1's table + 5.3's drag, so **persistence lands in 5.3, not 3.7.** (Arjun, 2026-08-03)
- **D4 — "Edit" affordance: option B — omit entirely in 3.7.** Don't ship a control that can't act. The scope line just states the detected dancefloor; the edit affordance arrives in 5.3 with the drag that makes it real. (Arjun, 2026-08-03)
- **D5 — Scope switch in 3.7 is view-only** — client-side recompute from `plays[]` (reuses 3.6's `detectDancefloor` + segment-scoped stat recompute), nothing persisted.

## 2. Quick ideas captured (Arjun, 2026-08-03) — all buildable from `plays[]`

- **Q1 — In-key transition markers between tracklist rows.** Icon/visual on the connector showing Camelot-compatible vs. clashing transition (play N → N+1). This is the harmonic timeline in tracklist form.
- **Q2 — Per-track BPM** in each tracklist row (`SyncPlay.bpm`).
- **Q3 — Per-track "length played"** = next play's `started_at` − this play's `started_at`; last track = set-end − its start.
- **Q4 — [3.8 cross-story hook]** Clicking the energy-arc chart jumps to the corresponding track(s) in the tracklist by timestamp. Not built in 3.7; noted for 3.8.

## 3. Screen layout (LOCKED — two-pane, whole-page scroll)

Desktop:

```
┌───────────────────────────────┬──────────────────────────────┐
│ A  date · SESSION 975     [⋯] │                              │
│    length · track count       │   C  Energy arc              │
│ B  Dancefloor 11:42–1:18 AM   │   (thumbnail now → full 3.8) │
│    [ Dancefloor | Whole night]│                              │   ← header, scrolls away
├───────────────────────────────┴──────────────────────────────┤
│  F. TRACKLIST (spine, ~67%)        │  RIGHT STATS COL (~33%)  │
│  ▸ full-length, "load more"        │  D. BPM · Harmonic pips  │  ← sticky (rec)
│  ▸ highlights/dims live on select  │  Genre (top 3)           │
│  ▸ the whole PAGE scrolls          │  E. Most-played          │
│    (no nested scroll region)       │  ······················· │
│                                    │  G. Enrichment (reserved)│
└──────────────────────────────────────────────────────────────┘
```

- **L-1 — Header is two columns:** A (identity, compact) + B (scope) stacked on the left; C (energy arc) on the right, earning the visual weight. Arc is NOT time-axis-aligned with the tracklist — acceptable; 3.8 click-to-jump works by timestamp lookup. (Arjun, 2026-08-03)
- **L-2 — Whole-page scroll — the deliberate break from the dashboard.** No `100dvh` fixed shell, no nested scroll regions (the dashboard's signature). Header scrolls away; the full-length tracklist drives page height. (Arjun, 2026-08-03)
- **L-3 — Right stats column is `sticky`** (recommended, pending final confirm) so stats + any open drill-in overlay ride along during the long tracklist scroll — required for drill-in highlighting to stay usable deep in the list. Not a nested scrollbar.
- **L-4 — Body is two panes:** tracklist left (~67%, the stable spine), stats column right (~33%).
- **L-5 — Mobile:** designer's discretion (Arjun) — plan: stack (header → arc → stats → tracklist), drill-in becomes a bottom sheet instead of a right panel.

## 3a. Section detail

- **C. Energy arc** — REUSE the 3.6 thumbnail arc renderer as the 3.7 interim; 3.8 upgrades the *same component* to full annotated + chart-summary mode. **Arc domain changes with scope (D1):** Dancefloor mode draws *only* the dancefloor window; Whole night draws the full night; the switch **morphs** (dancefloor zooms/expands outward to reveal the full night; reverse collapses). This replaces the earlier "emphasis shading" model. (Arjun, 2026-08-03)
- **D. Headline stats** — hairline-divided; **harmonic mixing is the hero** (LED pips per UX-DR11, **pips as the hero visual, % as secondary readout**). BPM = range + median + tiny sparkline. Genre split out into its own module (below).
- **Genre module** — top 3 buckets, each row = `genre · % · # tracks`. Hover = dashboard motion vocab (framer-motion spring `bounce ~0.2`, `scale`, cyan/ice glow à la `HeroBand`). `no_genre` shown honestly.
- **E. Most-played — LOCKED (Arjun, 2026-08-03):** **artist-primary with conditional replays.** Per-set, most tracks play once, so a ranked "top tracks" list is filler. Show **"Most-played artists"** (ranked `artist · ×4`, count or tiny bar, artist-tagged only CAP-5, clickable→focus DR-2, scope-reactive) only when there's real concentration (any artist ×2+). Surface a **"Replayed: X ×2"** line only if any track count>1. If everything's a singleton, the module simply doesn't render — a set with no concentration has no most-played story, and that's fine. (No empty-set state needed — a zero-play set never becomes a card.)
- **F. Tracklist** — LOCKED (Arjun, 2026-08-03):
  - **Row anatomy:** left timeline rail (timestamp + node); primary line = title + artist; right-aligned mono metadata columns = **BPM · played-length (real duration) · Camelot key (small chip)** that align vertically for column scanning; **`·new·` marker** on rows inside the "New tracks played" window (reacts to Week/Month toggle).
  - **In-key connector (Q1):** marker sits ON the connector between consecutive rows, using the **same Camelot rule as D's harmonic-hero** (aggregate 78% smooth == these markers). **Always visible but quiet.** States: **smooth** → soft cyan glow (HeroBand language) + subtle link glyph; **clash** → faint dashed/broken connector, neutral-muted (**never red / no alarm colors**, UX-DR18); **no key** (either side missing) → plain grey, no marker. Hover → `8A → 9A · compatible`.
  - **Impact node:** the highlighted node = **peak of the energy arc** (highest sustained-BPM moment), annotated `★ PEAK`. Ties the tracklist highlight to the arc + 3.8 click-to-jump. Chosen over "Longest Play" (already its own stat) as the more additive highlight. Within active scope.
  - **Unknown-track FR-2 fallback:** "Unknown track data"; still show any available timestamp/BPM/key.
  - **Pagination:** initial ~50 rows, "Load more" appends onto the page (whole-page scroll), never infinite (UX-DR20).
  - Segment-editor drag is Story 5.3, NOT here (D4).
- **G. Enrichment** — RESERVED slot (Story 5.5): venue / crowd / event type / notes / pics.

## 3b. The drill-in pattern (LOCKED)

Unified across BPM / Harmonic / Genre:

- Each stat is a **summary module** (right column) → **clickable**.
- Click → **detail overlay over the right column only** (~33% footprint, blurred backdrop over the *other* stats underneath). Tracklist never moves or shrinks — it was already the left ~67%.
- Overlay **stays open**; clicking any value inside it (e.g. a genre outside the top 3) **highlights/dims the tracklist live** (in place — never hides rows; see DR-1), no backing out required. **Back arrow** (overlay top-left) returns the column to the stats stack.
- **DR-1 — Highlight in place, don't filter/hide.** Dim non-matching rows, keep sequence, scroll to first match, show a dismissable "Focused: House ✕" pill atop the tracklist. Hiding rows would break the timeline + the in-key connectors (Q1). (Arjun, 2026-08-03)
- **DR-2 — Shared "focus the tracklist on these plays" mechanism** underlies genre-select, harmonic-clash-select, AND the 3.8 arc click-to-jump (Q4). Build once in 3.7; 3.8 reuses. (Arjun, 2026-08-03)
- Overlay contents: **Genre** → all buckets + `no_genre`; **Harmonic** → every transition (smooth/clash/no-key), clashes callable; **BPM** → full histogram + min/max/mean/median.

## 3c. Extra stats (LOCKED this session)

- **Set shape module (right column):** **"Longest Play"** and **"Shortest Play"** — `title · artist · m:ss`. Plain names (Arjun rejected "Longest on the floor"/"Quickest cut" as try-hard; matches [[feedback_design_taste]] — plain, well-executed). Click either → focuses that row (DR-2). Scope-reactive. Uses real captured duration (below), never the timestamp proxy for the headline value. (Arjun, 2026-08-03)
- **"New tracks played" (right column):** readout `New tracks played · 6 of 42 · [ Week | Month ]` — count of this set's tracks whose **library date-added** is within 7/30 days **before the set date** (set-date-relative so it doesn't drift). Toggle flips the window. Click → focuses those rows (DR-2). Scope-reactive. **Launch-honest** — needs only (add-date + this set's plays), so it survives Epic 4 Decision B (unlike aging-shelf/time-to-first-play). Off-library plays (`in_library:false`) have no add-date → excluded + disclosed. (Arjun, 2026-08-03)

## 3d. Serato capture completeness (agent + contract) — LOCKED direction

**Principle (Arjun, 2026-08-03):** `EnrichedPlay` is internal to the agent → make it **comprehensive** (cheap in one joiner pass, future-proof). `SyncPlay` is the **frozen wire contract** → keep it **consumer-gated**, additive-only (AR-15). EnrichedPlay holds the full picture; the wire carries only what a story renders.

**This session's contract change (additive, one backfill):**
- **Capture `played duration` / `ended_at`** — real on-air time (Serato computes it; research verified `end − start == duration`, self-consistent; honors the "Played" flag). Powers Q3 per-row length + Longest/Shortest Play.
- **Capture library `date-added`** — powers "New tracks played."
- **Also read into EnrichedPlay while in the joiner (cheap):** track total length, deck assignment, "Played" flag. Promote to wire only when a consumer lands.
- **Skip until a story needs them:** album, year, bitrate, comments.
- **Backfill** the 491 local sets via the retained-raw mechanism (same as the 3.6 Camelot key-fix).

**Verification owed (5 min, not a build risk):** confirm Serato 4+ `master.sqlite` `history_entry` carries the duration + date-added columns (Serato computes both; research confirmed them in the legacy `.session` format — need to confirm the serato4 column names). Bundle with the duration check.

**TODO:** draft a standalone "Serato capture completeness" plan artifact (field-by-field source→EnrichedPlay→SyncPlay→consumer map) so future field needs are a conscious inventory, not a trickle. (Arjun asked, 2026-08-03.)

## 3e. Section A — identity bar + delete (LOCKED, Arjun 2026-08-03)

- **Identity bar:** mono `date · SESSION 975` header (matches dashboard card header for continuity) + `length · track count` on a second line, **scope-reactive** (dancefloor by default, recomputes on Whole-night). `[⋯]` overflow top-right holds Delete now (home for future set-level actions), so delete isn't a prominent button.
- **Delete = never recoverable (Arjun).** Requires a **permanent tombstone / suppress-id** keyed on stable session identity (`session_identity`/`set_id`) so **no future sync ever resurrects it** (agent retains raw → a naive row-delete would reappear). In 3.7 (pre-sync, `synced_at` NULL) delete removes the row via the 3.6 seam; **the suppression requirement must be honored when the Supabase sync/read path lands — carry into the sync story.**
- **Confirm dialog:** centered **modal with blurred background** (same blur language as the drill-in overlay), calm / no-alarm / no red / no exclamation, After-Hours voice. Copy clarifies **Curfew ≠ Serato**:
  > **Delete this set?**
  > This removes it from Curfew for good — it can't be undone. Your Serato history and library aren't touched.
  > `[ Cancel ]   [ Delete ]`
- No type-to-confirm ceremony (alarmist). After delete → return to dashboard (set absent) + brief calm inline confirm, no celebration.

## 3f. States (LOCKED, Arjun 2026-08-03)

- **Sparse set (1–few plays)** — e.g. soundcheck id 17577. Scope toggle **hidden** (no dancefloor to toggle). Arc <2 points → chart-summary text fallback ("Single track — no arc to draw"), not a broken chart. Harmonic needs ≥2 tracks → "Not enough tracks," not a fake 0%. Most-played / Longest·Shortest hidden (conditional rules). Tracklist rows with no connectors (no transitions). Intentional, not broken.
- **Whole-set fallback (no distinct dancefloor detected)** — scope line: *"Whole set · no distinct dancefloor detected."* Toggle **hidden**. All stats = whole set. The honest default.
- **Unknown track data (FR-2)** — per-row fallback (§F) + **aggregate disclosure**: honest counts (`no_genre_count`, harmonic `excluded_no_key`, bpm `count`) surface as quiet "N unanalyzed" notes; never silently shrink denominators.
- **Low-confidence set** — **quiet non-hiding note** near header (*"Low-confidence session — likely a soundcheck or rehearsal"*); **never hide any stat** (it's the DJ's own set; never-silently-hide principle). Rare in practice (see carry-back below).

## 3g. Cross-story carry-backs

- **⚑ Dashboard (3.6) — exclude low-confidence sets from the dashboard, VISIBLY (Arjun, 2026-08-03).** Realistically a soundcheck/no-dancefloor set shouldn't populate the dashboard. But per Story 4.1's binding principle a real set is **never silently hidden** — so use the Style-Evolution pattern: hidden by default with a quiet reversible *"N low-confidence sessions hidden — show them"* affordance. This is why 3.7's sparse/low-confidence states are rare-but-necessary (still reachable when opened / by direct URL). **3.6 currently INCLUDES the soundcheck fixture on the dashboard — this is a behavior change, not already-done.** Carry back to 3.6/dashboard.
- **⚑ Sync story — permanent delete tombstone** (see §3e): never-recoverable delete must suppress re-sync forever.
- **⚑ 3.8 — click energy-arc → jump to track** (Q4) reuses 3.7's DR-2 focus mechanism.

## 3h. Drill-in overlay contents (LOCKED, Arjun 2026-08-03)

Shared frame: right-column footprint, blurred backdrop over other stats, **stays open**, back-arrow top-left, row-click → focus tracklist (DR-2, **single-select** in 3.7 + "Focused: X ✕" pill), selected row shows active, scope-reactive.

- **Genre overlay** — full ranked bucket list (`House · 41% · 17 tracks` … + `No genre · N`). A **toggle switches genre-ranking ⇄ subgenre-ranking** view (uses `subgenre_breakdown`). Row → focus.
- **BPM overlay** — **histogram** computed client-side from `plays[]` (derived only carries min/max/mean/median; bins are derived), ~4-BPM bars + min/max/mean/median readout. Click a **band** → focuses tracks in that BPM range.
- **Harmonic overlay** — **transition list** in play order (`8A → 9A · smooth`, `9A → 4B · clash`, `4B → — · no key`), a **"show clashes only"** filter, transition-click → focuses those two rows. **Camelot-wheel graphic deferred to 3.8's key/harmonic timeline companion** — this overlay is the list/tabular form.
- **Overlay vs direct-focus:** overlays = Genre, BPM, Harmonic, Most-played-artists (full list). Direct-focus (no overlay) = Longest Play, Shortest Play (single track), New tracks played (focuses the set of rows; Week/Month toggle on the module).

## 3i. Mobile (designer's discretion — Arjun)

Two panes can't sit side-by-side → **stack**: header (A/B, then arc C full-width) → right-column stats (D, genre, set-shape, most-played, new-tracks) → tracklist F. Drill-in overlay becomes a **bottom sheet** (not a right panel); back-arrow → sheet dismiss. Focus pill + highlight behavior unchanged. Whole-page scroll already mobile-native.

## 4. Available data (from `shared/src/index.ts`)

- **`set.derived` (`SyncSetDerived`):** `most_played_tracks`, `most_played_artists`, `genre_breakdown{buckets,no_genre_count}`, `subgenre_breakdown?`, `bpm_distribution{count,min,max,mean,median}`, `camelot_mixing_stats{compatible,incompatible,excluded_no_key}`, `set_length_sec`, `track_count`, `energy_arc[{started_at,bpm}]`, `confidence{value,track_count,long_gap_count}`.
- **`plays[]` (`SyncPlay`):** `position`, `title`, `artist`, `started_at`(ISO), `bpm`, `genre{raw,normalized,taxonomy_version,subgenre?}`, `camelot_key`, `in_library`.
- **Key point:** every play carries per-play timestamp+bpm+genre+key, so **all segment-scoped stats recompute client-side** — dancefloor vs. whole-night needs no schema change. `derived` is the whole-set default/cache.

## 5. Open threads

- [x] **Layout** — two-pane, whole-page scroll, header A+B|C. (§3, L-1..L-5)
- [x] **Section C placeholder** — reuse thumbnail arc; domain morphs with scope. (§3a)
- [x] **Section D** — harmonic-hero pips + BPM; genre its own module. (§3a)
- [x] **Drill-in pattern** — right-column overlay, stays open, highlight-in-place. (§3b)
- [x] **L-3** — sticky right stats column, confirmed. Header A/B ~20-25%, arc ~75-80%, confirmed.
- [x] **Section F** — tracklist row anatomy, in-key connector, impact node = arc peak, pagination. (§3a)
- [x] **Extra stats** — Longest/Shortest Play, New tracks played, duration+date-added capture. (§3c, §3d)
- [x] **Section A** — identity bar + delete-set confirm. (§3e)
- [x] **Section E** — artist-primary, conditional replays. (§3a)
- [x] **Genre/BPM/Harmonic overlay contents.** (§3h)
- [x] **States** — sparse, whole-set fallback, unknown, low-confidence. (§3f)
- [x] **Mobile** — stacked + bottom-sheet drill-in. (§3i)
- [x] **Serato capture completeness** plan artifact → `serato-capture-completeness.md`.
- [x] **Folded into `epics.md` Story 3.7** (⚑ 2026-08-03 design-session note, points here as authoritative spec).
- [ ] **Commit these docs** (currently uncommitted in the 3.6 worktree — not yet discoverable by a fresh session).
- [ ] **Write the dev-ready story file** (`bmad-create-story`) when 3.7 goes to build.
