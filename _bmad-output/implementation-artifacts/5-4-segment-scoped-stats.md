---
baseline_commit: 8f017b38824da1d3b315d4a9747d8744188c2644
---

# Story 5.4: Segment-scoped stats

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Read first:** `epics.md`'s Story 5.4 refinement note (2026-08-11) — the MVP-narrowing this story implements — and `_bmad-output/implementation-artifacts/5-3-segment-editor-design.md` §0/D-30 (the dividing line this story is the other half of). **As of this story's creation, Story 5.3 has shipped its full write path AND editing UI (sprint-status: `review`) but is not yet committed to git** — confirm it's committed before starting this story's dev pass (`/usr/bin/git log`; the system `git` on PATH is too old for some worktree ops per project memory). 5.3 shipped `web/app/components/set-detail/SegmentSelector.tsx` + `useSegmentEditor.ts` — a chip-list selector, but it is an **editing-target** selector (`editor.activeId`, defaults to `null` — nothing being edited) wired **deliberately apart** from view-scope. `web/app/components/set-detail/model.ts`'s `ScopeFrame.activeSegmentId` doc comment says so explicitly: *"Recomputing stats against the segment being edited is Story 5.4's, and doing it here would make every arrow press rewrite the whole right column."* This story does not extend or reuse `editor.activeId` — it adds an independent, always-populated view-scope selection (see Task 1/2 and Dev Notes). This story remains read/view-only; it never writes a `segments` row and does not depend on 5.3's write path.

## Story

As a DJ,
I want per-set stats sliceable by dancefloor segment,
so that a night with more than one real dancefloor — a cocktail-hour floor and a post-dinner peak, say — never has one of them silently hidden behind the other.

## Acceptance Criteria

1. **Given** a set with exactly one dancefloor segment (today's common case), **Then** Set Detail's stats behave exactly as Story 3.7 ships them today — dancefloor/whole-night toggle, no segment picker shown. *(Regression guard — the common case must not change.)*
2. **Given** a set with two or more dancefloor segments, **When** the DJ selects a specific one, **Then** the FR-6/FR-7 stats (`StatsColumn`), the energy arc (`DetailArc`), and the tracklist annotations all recompute scoped to exactly that segment's plays — replacing today's silent, un-selectable "longest wins" pick (`primaryDancefloorSegment`). *(FR-15, AR-13, epics.md D-30)*
3. **Given** a set with no dancefloor segments, **Then** whole-set stats show as before — segments are additive, never required. *(Unchanged from today.)*
4. **Given** a set with several dancefloor segments, **Then** every dashboard surface that currently shows one segment's stats (the set-list row, the hero band) discloses that more exist rather than silently picking one and staying quiet — closes the named gap in `deferred-work.md` line 759. *(Disclosure only; selecting *among* them stays a Set Detail interaction, not a dashboard one.)*
5. **Given** `dinner`/`performance`/`custom` segment types, **Then** this story does nothing with them — they stay past this story's scope exactly as Story 5.3's D-32/D-33 MVP guard left them (schema-ready, write-blocked). Cross-type comparison ("dinner hour vs. dancefloor") is explicitly deferred, not built here.

## Scope Boundaries (read before starting)

- **In:** replacing `SetDetail.tsx`'s hardcoded `primaryDancefloorSegment` pick with a DJ-selectable one when 2+ dancefloor segments exist (AC #2); the selector UI that drives it; a `floorSegmentCount`-shaped disclosure on the three dashboard surfaces that currently call `primaryDancefloorSegment` silently (AC #4); the one-segment and zero-segment fallback paths staying byte-for-byte what they are today (AC #1, #3).
- **Out — deferred product scope:** `dinner`/`performance`/`custom` segment types and any comparison across them (AC #5 — this is Story 5.3's D-33 boundary, inherited here, not re-opened).
- **Out — Story 5.3's editing UI and write path:** `SegmentSelector.tsx`/`useSegmentEditor.ts` (5.3 Task 6, D-30), the write path (RLS grants, boundary-integrity trigger, sync-wipe fix), drag/tap-to-mark, keyboard a11y — this story reads `segments` rows, it never writes one, and does not touch `editor.activeId`. It adds a **separate** view-scope selection alongside the existing editing selection (see Task 2, Dev Notes) — confirmed as the intended split by `model.ts`'s own `activeSegmentId` doc comment, not a new judgment call.
- **Out:** any new Supabase migration, RLS grant, or `agent`/`shared` change. Every field this story needs (`segments.id`/`first_play_id`/`last_play_id` and the resolved `DancefloorSegment[]`) was already added to the read model by Story 5.3 Task 1 (already landed — see `web/lib/sets/index.ts`'s `SET_WITH_PLAYS_SELECT`, `dancefloor.ts`'s `dancefloorSegments()`). This is a `web/`-only story.
- **Out:** a literal side-by-side/two-pane comparison view. Set Detail's whole architecture (Story 3.7's D1) is "one frame at a time" — `frame.segment` scopes everything, and flipping the dancefloor/whole toggle already works by swapping which frame is active, not by rendering two. This story extends that same single-frame model to "one *of several dancefloor segments*, at a time" rather than introducing a second, parallel frame concept. (Flagged as a judgment call in Dev Notes — surfaced for Arjun to confirm, not re-derived from nothing.)

## Tasks / Subtasks

- [x] Task 1: DJ-selectable segment state (AC: #1, #2, #3)
  - [x] 1.1 `SetDetail.tsx`: replace `const segment = useMemo(() => primaryDancefloorSegment(set.segments), [set.segments])` (currently line 33 — verify against HEAD at dev time, this file has moved since story creation) with state seeded from `dancefloorSegments(set.segments)` — default to index 0 (today's longest-first sort order, `byPrimaryRank` in `dancefloor.ts`), so a 1-segment or 0-segment set renders byte-identical to today (AC #1, #3: no behavior change, no picker shown). A 2+-segment set additionally exposes a setter the picker (Task 2) calls. **Do not touch `editor`/`editor.activeId`** (from `useSegmentEditor`, already wired into `frame.activeSegmentId`/`frame.editingBounds`) — this is a new, separate piece of state, not a rename or repurposing of the editor's.
  - [x] 1.2 `frame` (`SetDetail.tsx`'s `useMemo` building `ScopeFrame`) already derives `plays`/`peakPosition` from `segment` — no shape change needed to `ScopeFrame` (`model.ts`) itself, since "the selected one" and "the primary one" are the same type (`DancefloorSegment | null`), and `activeSegmentId`/`editingBounds` are additive fields this task does not touch (`model.ts`'s own doc comment on `activeSegmentId` names this exact split as deliberate — see Dev Notes). Verify `flipScope`'s focus-clearing precedent (clears `focus` on a dancefloor/whole scope change) applies the same way when the *selected segment* changes — a focus computed under segment A shown while segment B is active would mix two frames the same way a stale whole/dancefloor focus would.
  - [x] 1.3 Tests: `SetDetail`-level (or the smallest testable unit the existing suite uses for this component) covering the three counts — 0 segments → whole-set frame, exactly as today; 1 segment → that segment's frame, exactly as today, no picker; 2+ segments → defaults to index 0 (the old `primaryDancefloorSegment` pick), selectable to any other, with no effect on `editor.activeId`/editing state.

- [x] Task 2: Segment picker UI (AC: #2)
  - [x] 2.1 Build a **new, independent** view-scope selector — do not extend `SegmentSelector.tsx`'s state (`editor.activeId`) to double as view-scope; `model.ts`'s `activeSegmentId` doc comment explains why they're kept apart (live edit nudges would otherwise re-render the whole stats column on every arrow-key press). Reuse what's safe to reuse: `dancefloorSegments()` for the data, and `SegmentSelector.tsx`'s chip-list visual/markup pattern (`sd-segment-chips`, `sd-segment-chip`) for consistency — but drive it off Task 1's new state, a plain click-to-select with no edit-mode side effect. Whether this ends up as its own visually-distinct control or is later merged with `SegmentSelector` into one combined affordance (click selects for viewing; a nested action still enters edit mode) is a UI-consolidation call worth flagging to Arjun once both are on screen together and can be judged side by side — don't preemptively merge the *state*, that part is settled.
  - [x] 2.2 Render only when `dancefloorSegments(set.segments).length > 1` (AC #1: a 1-segment set shows no picker — don't add UI clutter for the overwhelmingly common case).
  - [x] 2.3 Selecting a chip updates Task 1's state; `StatsColumn`, `DetailArc`, `Tracklist` all re-render off the existing single `frame` prop — no new prop plumbing beyond what `SetDetail.tsx` already threads (mirrors the dancefloor/whole toggle's existing data flow in `SetHeader.tsx`'s `onScopeChange`). Confirm it has zero effect on `editor.activeId` / `SegmentSelector`'s own selection — the two controls must be able to point at different segments simultaneously (viewing floor 1's stats while editing floor 2's boundary is a valid state, not a bug).
  - [x] 2.4 Tests: chip list renders N chips for a real several-segment fixture set (the reference is fixture set 975 — 3 real dancefloor segments per `deferred-work.md`'s corrected count); hidden entirely for 0/1-segment sets; selecting a chip changes `frame.plays` to exactly that segment's window (cross-check against `dancefloor.test.ts`'s existing `dancefloorSegments()` fixtures); selecting a view-scope chip does not change `editor.activeId` and vice versa.

- [x] Task 3: Dashboard disclosure for silently-hidden segments (AC: #4)
  - [x] 3.1 `web/lib/sets/listModel.ts` (line 117, `primaryDancefloorSegment(set.segments)`), `web/lib/sets/rightColumn.ts` (line 114), `web/app/components/dashboard/HeroBand.tsx` (line 20): alongside the existing single pick, also compute `dancefloorSegments(set.segments).length` and expose it (e.g. a `floorSegmentCount` field on `SetRowModel` / the right-column model / `HeroBand`'s props) — plumbing only, no new interaction on the dashboard itself (picking among segments stays a Set Detail affordance, Task 2).
  - [x] 3.2 UI: a quiet disclosure (e.g. "+2 more floors") beside the existing dancefloor-scoped stat wherever `floorSegmentCount > 1`, matching the app's established never-silently-hide-plurality house style (same spirit as FR-27's "exclude-visibly" and Story 5.3's D-30 rationale for the editor's own selector). Exact copy is a writing-guidelines pass, not this task's to word from scratch — the plumbing + a placeholder string is the bar.
  - [x] 3.3 Tests: `listModel.test.ts`/`rightColumn.test.ts` cases for `floorSegmentCount` on a 1-segment and a several-segment fixture set; a render-level check (whichever test style the sibling dashboard component tests already use) that the disclosure appears only when count > 1.

- [x] Task 4: Docs owed by this story (AC: —)
  - [x] 4.1 `deferred-work.md`: close the line-759 entry ("A set with several dancefloor segments renders only its longest, everywhere, with no affordance saying so") once Tasks 1-3 ship — it names this story as the "natural owner" already.
  - [x] 4.2 `epics.md`'s Story 5.4 refinement note (2026-08-11, the MVP-narrowing this story implements) is **already added** — verify it's still accurate against whatever actually ships, don't re-add it.

- [x] Task 5: Gate (web-only — no `agent/`, no `shared/`, no `supabase/`)
  - [x] 5.1 Confirm no new Supabase migration or query shape is needed — Story 5.3 Task 1 already extended `SET_WITH_PLAYS_SELECT` with everything this story reads. If a dev-time gap is found, it belongs to Story 5.3's read model, not a new migration here.
  - [x] 5.2 `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (vitest) — all four, actually run.
  - [x] 5.3 Browser pass at 1440 against the local seeded stack (fixture set 975 — 3 dancefloor segments): confirmed the picker appears only at 2+, switching segments re-scopes stats/arc/tracklist together (verified via a Dancefloor-1→2 switch: header stat, energy arc, in-key %, tempo, genres, set-shape all recomputed), the dashboard disclosure renders correctly (set-list row, expanded sheet header, sheet stats — all show "+N more floor(s)"), and a 0/1-segment set is pixel-identical (no picker renders). Zero console errors/warnings. Also directly verified view/edit independence: selecting an edit-target chip (Dancefloor 3) while the view stayed on Dancefloor 2 left both states correctly independent. **375px live pass not completed this session** — hit a compounding tooling wall (Chrome window stuck at an OS-level ~500px minimum width that `resize_window` couldn't get under, Playwright MCP locked by a concurrent session, then the claude-in-chrome extension itself started erroring on fresh tabs). Arjun opted to skip the live check and accept CSS reasoning instead: both new pieces (`.sd-view-segment-selector`, `.dz-floor-disclosure`) reuse existing `flex-wrap`/no-fixed-width patterns from `SegmentSelector`/`.dz-row-meta` with no new `overflow`/`ellipsis`/fixed-width introduced — verified `.dz-row-meta` (where the dashboard disclosure lives) carries no truncation rule, only the unrelated `.dz-actions-date` does. Worth a real 375px pass next time the tooling cooperates.

## Dev Notes

### The "one frame at a time" call (flagged, not silently decided)

Story 3.7's D1 invariant is that Set Detail has exactly one active scope at a time — the dancefloor/whole toggle works by swapping which `frame` is live, never by rendering two side by side. This story extends that same model to segment selection (pick ONE of several dancefloor segments to be the active frame) rather than building a literal two-up comparison view, because: (a) it's the smaller, precedent-consistent change — no new dual-frame plumbing across `StatsColumn`/`DetailArc`/`Tracklist`; (b) `deferred-work.md`'s actual complaint is invisibility ("no affordance saying so"), not the lack of a side-by-side view; (c) Story 5.3's D-30 language ("the real comparison view is 5.4's") is satisfied by making every segment visible and selectable — a DJ can already compare two segments by picking one, reading its stats, then picking the other. **This is this story's one open judgment call** — surface it to Arjun before or during dev if a literal side-by-side view was actually intended; nothing here is unrecoverable if that call flips, since Task 1/2's selector state is the same either way, only the render (one frame vs. two) would change.

### View-scope vs. edit-target: two states, confirmed by 5.3's own code (not this story's judgment call)

Story 5.3 shipped `SegmentSelector.tsx` + `useSegmentEditor.ts` — a chip-list "which floor am I editing" selector (`editor.activeId`, defaults to `null`). It is wired into `ScopeFrame` as `activeSegmentId`/`editingBounds`, **deliberately decoupled** from `frame.segment` (the view-scoping value `StatsColumn` reads). This is not an inference — `model.ts`'s own doc comment on `activeSegmentId` states it outright: *"Recomputing stats against the segment being edited is Story 5.4's, and doing it here would make every arrow press rewrite the whole right column."* Concretely, as 5.3 actually shipped: a DJ can already click a `SegmentSelector` chip to start editing "Dancefloor 2," and `StatsColumn` keeps showing "Dancefloor 1" (the longest, via `primaryDancefloorSegment`) the entire time — that gap is exactly what this story's Task 1/2 close, with a **new, independent** selection, not a repurposing of `editor.activeId`.

The one thing still open is presentation, not state: whether the view-scope selector (Task 2) ships as its own visually distinct chip list alongside `SegmentSelector`, or the two get merged into one control later (click = view; a nested action = edit) once both exist and can be judged together on screen. Don't pre-merge them speculatively — ship Task 2's selector as its own thing first.

### Client-side recompute, not cloud SQL (AR-8 note)

Epics.md's original AC-1 language ("via cloud SQL re-aggregation over `plays`") reflects AR-8's *permissive* "cloud may re-aggregate" — not a requirement. Story 3.7 already established the shipped pattern: `plays[]` for the whole set is fetched once per Set Detail load (needed for the full tracklist regardless of scope — `Tracklist.tsx` renders from `set.plays`, never a scope-filtered slice), and every stat/scope recompute (`scopedPlays`, `segmentStats`, `StatsColumn`'s `useMemo`s) runs client-side against that already-fetched array. This story continues that pattern for per-segment scoping — there is no reason to stand up a second, server-side aggregation path for data already sitting in the client. Do not add a new Supabase RPC or query for this story.

### What already exists (Story 5.3, shipped but uncommitted as of this story's creation)

- `web/lib/sets/dancefloor.ts`: `DancefloorSegment` now carries `id`/`firstPlayId`/`lastPlayId` alongside `start`/`end`; `dancefloorSegments(segments)` returns every dancefloor segment on a set, ranked longest-first (`byPrimaryRank`); `primaryDancefloorSegment` is `dancefloorSegments(...)[0] ?? null` — the exact interim pick this story replaces with a real DJ choice. `playsInSegment`/`segmentStats` are unchanged and already scope-agnostic (they take a `SegmentBounds`, not a specific row) — reuse them, don't re-derive.
- `web/lib/sets/index.ts`: `SET_WITH_PLAYS_SELECT` already selects `segments(id, type, source, confirmed, first_play_id, last_play_id, first_play:..., last_play:...)` and `plays(id, ...)`. Nothing to add here.
- `web/lib/sets/types.ts`: `SetRecord.segments?: DancefloorSegment[]` already carries the full array (not just the primary pick) — the multi-segment data has been available to every consumer since 5.3 Task 1 landed; only the UI has not caught up.
- `web/app/components/set-detail/SetDetail.tsx`: `segment` (still `primaryDancefloorSegment`, unchanged — Task 1 replaces this), `editor` (`useSegmentEditor(set, revealPosition)` — 5.3's editing state, do not touch), `editingBounds` (derived from `editor.draft`, feeds the arc mirror), `frame` (now includes `activeSegmentId`/`editingBounds` alongside `segment`/`plays`/`peakPosition` — additive, Task 1 doesn't need to change this shape), `<SegmentSelector editor={editor} editable={editable} />` rendered above the tracklist (5.3's editing-target chip list — leave as-is, Task 2 adds a sibling, not a replacement).
- `web/app/components/set-detail/model.ts`: `ScopeFrame.activeSegmentId`/`editingBounds` — read their doc comments before touching anything nearby, they explain the view/edit split this story must preserve.
- `web/app/components/set-detail/SegmentSelector.tsx` + `useSegmentEditor.ts`: the editing-target chip list and its hook. `useSegmentEditor`'s `activeId` defaults to `null` (nothing being edited) — different default semantics than this story's view-scope state needs (always populated when segments exist). Read for the chip-list visual pattern (`sd-segment-chips`/`sd-segment-chip` classes), not for its state.
- `StatsColumn.tsx` reads `frame.plays` exclusively — already scope-reactive, needs zero changes for AC #2.

### Architecture compliance

- **AD-8 / AR-8:** this story performs read-only client-side recomputation over already-synced `plays[]` — no new write path, no new agent/shared surface. See the AR-8 note above.
- **Additive-only, web-only:** no migration, no RLS change. If dev work surfaces a genuine read-model gap, that is Story 5.3 Task 1's territory (already landed) to extend, not a new migration to invent here.
- **D1 (Story 3.7, ARCHITECTURE / UX pattern):** one scope frame at a time — see the judgment-call note above.

### Previous-story intelligence (5.3)

- Story 5.3 is at sprint-status `review` (functionally shipped, full write path + editing UI) but **uncommitted** as of this story's creation — `git log` is still at this story's `baseline_commit`. Confirm 5.3 is actually committed before starting this story's dev pass; do not build on top of local uncommitted diffs that could be lost or overwritten.
- Story 5.3's Task 6 selector (`SegmentSelector.tsx`/`useSegmentEditor.ts`) has landed, and its state (`editor.activeId`) is confirmed — by `model.ts`'s own doc comment, not just this story's inference — to be intentionally separate from view-scope. Task 2 builds a new, independent selection; it does not extend or repurpose the editor's.
- `deferred-work.md`'s line-759 entry is the single clearest statement of this story's actual job — read it in full before starting, it is effectively a second, independently-written mini-spec for AC #2/#4. Note it was written before 5.3's editing UI shipped, so its "no affordance saying so" framing is now slightly stale: there IS an affordance now (`SegmentSelector`), it just doesn't scope the stats — the gap is narrower than the entry's original wording but not closed.

### Project Structure Notes

- Modified: `web/app/components/set-detail/SetDetail.tsx` (Task 1); new selector component under `web/app/components/set-detail/` (Task 2, separate from `SegmentSelector.tsx` — see Dev Notes); `web/lib/sets/{listModel,rightColumn}.ts`, `web/app/components/dashboard/HeroBand.tsx` (Task 3).
- No `agent/`, no `shared/`, no `supabase/` files touched at all — a strict `web/`-only story, same shape as Story 5.3's own contrast with 5.2's three-workspace diff.
- `deferred-work.md`, `epics.md` (Task 4) — the epics.md refinement note already exists as of this story's creation; do not re-add it.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` §Story 5.4 + its 2026-08-11 refinement note (this story's own scope-narrowing justification); §Story 5.3's D-30/D-32/D-33 (the dividing line this story completes the other half of); AR-8 (permissive cloud re-aggregation), AR-13 (zero/one/several dancefloor segments), FR-15]
- [Source: `_bmad-output/implementation-artifacts/5-3-segment-editor-design.md` §0 (dividing line table — "Full multi-segment comparison UI ... the real comparison view is 5.4's, D-30"), D-30, D-24]
- [Source: `_bmad-output/implementation-artifacts/5-3-segment-editor.md` — Task 1 (the read-model extension this story consumes), Task 6 (the editing selector this story explicitly does NOT reuse the state of), Scope Boundaries ("Out — Story 5.4: segment-scoped stat recomputation; full multi-segment comparison UI")]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:759` — "A set with several dancefloor segments renders only its longest, everywhere, with no affordance saying so" — names this story as owner, gives the real (corrected) sample count: 15 of 58 sets; note per Dev Notes this framing is now slightly stale post-5.3]
- [Source: `web/lib/sets/dancefloor.ts` — `DancefloorSegment`, `dancefloorSegments`, `primaryDancefloorSegment`, `playsInSegment`, `segmentStats`, all already shaped for this story per their own doc comments ("Story 5.4 builds segment-scoped stats on them")]
- [Source: `web/lib/sets/setDetail.ts` — `scopedPlays`, the `Scope` type, the client-side recompute pattern this story extends]
- [Source: `web/app/components/set-detail/SetDetail.tsx` — the `segment`/`editor`/`frame` construction this story's Task 1 changes; `flipScope`, the focus-clearing precedent Task 1.2 extends]
- [Source: `web/app/components/set-detail/model.ts` — `ScopeFrame.activeSegmentId`'s doc comment, the authoritative source for the view/edit split this story must preserve (see Dev Notes)]
- [Source: `web/app/components/set-detail/StatsColumn.tsx` — reads `frame.plays` exclusively, already scope-reactive, needs no change for AC #2]
- [Source: `web/app/components/set-detail/SegmentSelector.tsx`, `useSegmentEditor.ts` — Story 5.3's editing-target selector and hook; reuse the chip markup pattern only, never `editor.activeId` for view-scope]
- [Source: `web/lib/sets/listModel.ts:117`, `web/lib/sets/rightColumn.ts:114`, `web/app/components/dashboard/HeroBand.tsx:20` — the three dashboard call sites Task 3 extends with a disclosure count]
- [Source: `web/lib/sets/dancefloor.test.ts` — existing `dancefloorSegments()`/`primaryDancefloorSegment` test shapes and the `seg()` fixture helper, mirror for this story's new test cases]

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

None.

### Completion Notes List

- Two flagged items resolved per Dev Notes' own framing, not silently decided: (1) AC #1 shipped as "pick one dancefloor to view at a time" (single-frame model, matching Story 3.7's D1), not a literal side-by-side comparison view; (2) `SegmentViewSelector` shipped as its own visually distinct chip list, not merged with Story 5.3's `SegmentSelector` — both now on screen together for Arjun to judge a later consolidation call.
- Task 3 scoped to two dashboard surfaces with a real single-set stat to disclose beside (`listModel.ts`'s set-list row/sheet, `HeroBand.tsx`) rather than three. `rightColumn.ts`'s own `primaryDancefloorSegment` call was left untouched — it aggregates across many sets into one most-played tally with no single per-set stat to attach a "+N more floors" disclosure beside, so there was no silent-and-misleading single pick to fix there. Documented in the deferred-work.md closure note.
- `resolveViewSegment` (new pure function, `web/lib/sets/setDetail.ts`) is the tested seam Task 1's state resolves through; `SetDetail.tsx`'s own render logic was left thin and untested directly (no existing render-test harness for the full `SetDetail` tree — the codebase's established pattern is pure-function tests + targeted component render tests, followed here).
- Dashboard components (`SetListPanel.tsx`, `HeroBand.tsx`) could not get render-assertion tests: both call hooks (`usePrefersReducedMotion` et al.) that read `window.matchMedia` synchronously during initial render, which crashes under this repo's jsdom-less `renderToStaticMarkup` test harness. Covered instead by pure-function tests on the shared `floorDisclosureLabel`/`floorSegmentCount` logic plus a live 1440px browser-pass verification of the actual rendered disclosure on all three surfaces (set-list row, sheet header, sheet stats).
- Gate: lint/typecheck/build/test all clean (842 tests passing). Browser pass completed at 1440px only — see Task 5.3's note for why 375px was skipped (tooling failure, not a code concern) and the CSS-based reasoning accepted in its place.

### File List

- `web/lib/sets/setDetail.ts` — `resolveViewSegment`
- `web/lib/sets/setDetail.test.ts` — `resolveViewSegment` tests
- `web/app/components/set-detail/SetDetail.tsx` — Task 1 state + Task 2 wiring
- `web/app/components/set-detail/SegmentViewSelector.tsx` — new (Task 2)
- `web/app/components/set-detail/segment-view-selector.test.tsx` — new (Task 2 tests)
- `web/app/set-detail.css` — `.sd-view-segment-selector`
- `web/lib/sets/listModel.ts` — `floorSegmentCount`, `floorDisclosureLabel`
- `web/lib/sets/listModel.test.ts` — `floorSegmentCount`/`floorDisclosureLabel` tests
- `web/app/components/dashboard/SetListPanel.tsx` — disclosure wiring (row, sheet header, sheet stats)
- `web/app/components/dashboard/HeroBand.tsx` — disclosure wiring
- `web/app/dashboard.css` — `.dz-floor-disclosure`
- `_bmad-output/implementation-artifacts/deferred-work.md` — closed line-759 entry
- `_bmad-output/implementation-artifacts/5-4-segment-scoped-stats.md` — this file (task checkboxes, Dev Agent Record)
