---
baseline_commit: 8f017b38824da1d3b315d4a9747d8744188c2644
---

# Story 5.3: Segment editor

Status: in-progress (code review complete, 2 decisions + 8 patches all resolved 2026-08-11 — see Review Findings; Task 10.3's 375 viewport browser pass is the one remaining owed item, unrelated to the review, still blocked on the same Playwright-profile/Chrome-maximized environment issue noted in Completion Notes)

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

> **Read first:** `_bmad-output/implementation-artifacts/5-3-segment-editor-design.md` — the design working doc from the 2026-08-11 party-mode session. **D-27 through D-37 there are locked decisions**; this story cites and implements them, it does not re-derive them. Every decision in that doc is closed — nothing is left open for a dev-time judgment call the design session didn't already make.

## Story

As a DJ,
I want to confirm/adjust suggested boundaries by dragging or keyboard, or add my own,
so that segmenting a set is fast, precise, and accessible.

## Acceptance Criteria

1. **Given** suggested boundaries, **Then** they render as draggable dividers over the energy arc; a "+" adds a manual boundary. *(FR-14, FR-28, UX-DR9)*
2. **Given** keyboard-only use, **Then** Tab reaches a boundary, arrows nudge, Enter confirms — a full keyboard path. *(UX-DR9, UX-DR20, UX-DR21)*
3. **Given** confirm, **Then** it commits; segments remain editable anytime. *(UX-DR9)*
4. **Given** each segment, **Then** it is typed **dancefloor only for this story's MVP** — see the note below. *(FR-14, D-33)*

> **⚑ Refinement (Arjun, 2026-08-02).** The editor renders as draggable pointers **over the tracklist** (bracket the dancefloor by pointing at the first and last track that count), in addition to over the arc. This editor and Story 5.5's Layer-2 enrichment share **one Set Detail editing surface** (the tracklist), not two separate screens.
>
> **⚑ Design session (Arjun + installed-agent room, 2026-08-11), D-33.** AC #4 narrows for this story's MVP to **dancefloor-only**: the DJ can create/edit/confirm dancefloor segments; `dinner`/`performance`/custom typing and labels are deferred to a later story, not cut from the product. See `epics.md` §Story 5.3 for the full note and Scope Boundaries below.

## Scope Boundaries (read before starting)

Per the design doc's §0 dividing line:

- **In:** the sync-wipe fix protecting DJ-authored segments from `sync_set`'s plays delete+reinsert (D-27); the DJ-direct write path — RLS grants, column-scoped UPDATE, the boundary-integrity trigger (D-28, D-29); the dancefloor-only MVP guard (D-32); the tracklist gutter-handle editor, arc mirroring, suggested/confirmed visual states, keyboard a11y, tap-primary/drag-enhancement (D-34–D-37); a bare multi-segment selector (D-30); the read-model extension every one of the above depends on (Task 1 — a gap the design session did not surface and this story's own research did, see Dev Notes).
- **Out — Story 5.4:** segment-scoped stat recomputation; full multi-segment comparison UI (this story's selector is a navigation floor only, not a comparison view).
- **Out — Story 5.5:** Layer 2 enrichment's own fields (venue/crowd/notes/photos) — shares this story's Set Detail page as one editing surface, never one component.
- **Out — deferred past this story (D-31):** durable per-DJ calibration-profile storage. 5.2's own change log already resolved this as a live runtime computation, not a persisted profile — it was never actually owed here, correcting a phantom forward-hook from 5.2's design doc (D-16).
- **Out — deferred product scope (D-33):** `dinner`/`performance`/`custom` segment types and custom labels. The schema enum already supports them (5.1); this story's DB guard (D-32) and UI both restrict writes to `dancefloor` only, removable in whichever later story ships the rest.
- **Out:** anything touching `agent/` or `shared/`. This story is **two workspaces only** (`supabase/`, `web/`) — no Rust, no wire-contract change. Contrast with 5.2, which was the epic's first three-workspace diff.

## Tasks / Subtasks

- [x] Task 1: Extend the read model — segment and play identity (prerequisite for every task below; not itself an AC, but nothing else in this story is buildable without it — see Dev Notes "The gap the design session didn't surface")
  - [x] 1.1 `web/lib/sets/index.ts`: add `id` to `PlayRow` and its select list (`SET_WITH_PLAYS_SELECT`, currently `plays(position, title, artist, started_at, bpm, genre_raw, genre_normalized, subgenre, taxonomy_version, camelot_key, in_library, played_ms, library_added_at, track_id)` — **no `id` today**, per `web/lib/sets/index.ts:69-84`). The write path needs a play's own uuid to construct a segment INSERT/UPDATE payload.
  - [x] 1.2 Same file: extend `SegmentRow` (`index.ts:116-122`) and the `segments(...)` embed in `SET_WITH_PLAYS_SELECT` (`index.ts:159`) to select `id, first_play_id, last_play_id` as plain columns, **in addition to** the two existing `first_play:plays!segments_first_play_id_fkey(started_at)` / `last_play:...` embeds (keep those — display code reads `started_at` off them today, don't break it). No `id` or FK columns are selected today; only `type, source, confirmed` plus the two nested `started_at`s.
  - [x] 1.3 `web/lib/sets/dancefloor.ts`: extend `DancefloorSegment` (currently `{ start: string; end: string }`, lines 25-28, **no `id` field at all**) to `{ id: string; firstPlayId: string; lastPlayId: string; start: string; end: string }`. Update `toSegments()` in `index.ts` (lines 280-288) to carry the new fields through. `primaryDancefloorSegment` (lines 44-55) and its tie-break logic are **unchanged** — every existing consumer (dashboard card, hero, `rightColumn`) keeps reading it exactly as today; this story does not touch those call sites.
  - [x] 1.4 Add `dancefloorSegments(segments)` (plural — all `dancefloor`-typed rows, same sort as `primaryDancefloorSegment` for determinism) alongside `primaryDancefloorSegment` in `dancefloor.ts`, for Task 6's selector. Do not delete or rename the singular helper.
  - [x] 1.5 `web/lib/sets/types.ts`: `SetRecord.plays[].id` and the extended `SetRecord.segments[]` shape.
  - [x] 1.6 Tests: `index.test.ts`, `dancefloor.test.ts` — extend fixtures with `id`s; add a `dancefloorSegments()` case (zero/one/several, matching the fixture's real several-segment set).

- [x] Task 2: Migration — write grants, boundary-integrity trigger, MVP guard, sync-wipe fix (AC: #3, #4; D-27, D-28, D-29, D-32)
  - [x] 2.1 `supabase migration new add_segments_write_path` → new timestamped file.
  - [x] 2.2 RLS + grants (D-28): `grant insert, delete on public.segments to authenticated;` with matching `dj_id = auth.uid()` policies (`segments_insert_own`, `segments_delete_own`, AD-7 shape, mirroring `segments_select_own`). Column-scoped UPDATE: `grant update (confirmed, type, label, first_play_id, last_play_id) on public.segments to authenticated;` plus a matching `segments_update_own` USING/WITH CHECK policy on `dj_id = auth.uid()`. `set_id`, `dj_id`, `source`, `created_at` are **not** in the UPDATE column grant — not reachable regardless of row ownership.
  - [x] 2.3 Boundary-integrity trigger (D-29), one `before insert or update` function + trigger on `segments`, in this order:
    1. Resolve `NEW.first_play_id`/`NEW.last_play_id` to `plays.position`; reject (`raise exception`) if first's position > last's.
    2. Reject if either boundary play's `set_id` ≠ `NEW.set_id` (closes the deferred FK/set-consistency gap from `5-1-segments-overlay-schema.md`'s and `deferred-work.md`'s review — see Dev Notes correction on the "AD-19" citation those entries used). Checked on UPDATE too, not just INSERT.
    3. Reject if any other row with the same `set_id` and the same `type` has an overlapping position range (`not (other.last_position < NEW.first_position or other.first_position > NEW.last_position)`, excluding `NEW.id` itself on UPDATE).
    4. MVP guard (D-32): reject if `NEW.type <> 'dancefloor'`. One line, in the same function, removable the day a later story ships the other types — comment it as such.
  - [x] 2.4 Sync-wipe fix (D-27), same migration, `create or replace function public.sync_set(...)` (same 5-arg signature, rebuilt from `20260810193000`'s current body — **not** an older ancestor; see 5.2's own Dev Agent Record for the exact regression this mistake caused last time). Add, inside the existing transaction, **before** the current `delete from public.plays where set_id = ... and dj_id = ...` (`20260810193000_add_segments_source_confirmed.sql:159`):
     - Capture: for every `segments` row on `computed_set_id` where `confirmed = true or source = 'manual'`, resolve `first_play_id`/`last_play_id` to their current `position`s **independently** (two boundaries, not one unit — see D-27's per-boundary note) into a temp structure keyed by `segments.id`.
     - After the existing plays reinsert, rebind: for each captured segment, resolve its two positions back to the freshly-inserted `plays.id`s and `update public.segments set first_play_id = ..., last_play_id = ... where id = ...`.
     - Per-boundary shrink handling: if a captured position no longer exists in the new play set, clamp to the nearest remaining valid position and `raise warning` (same style as the existing suggested-segment skip warnings a few lines below) — **never delete the row.**
     - This is additive to the existing suggested-segment materialization block (`20260810193000:193-286`), not a replacement of it — that block's own explicit `delete ... where source = 'suggested' and not confirmed` (line 153-157) is untouched.
  - [x] 2.5 `supabase/scripts/check-additive-only-migrations.sh` passes.

- [x] Task 3: pgTAP coverage for Task 2 (AC: #3, #4)
  - [x] 3.1 `segments_isolation_test.sql`: new positive-path cases — `authenticated` can INSERT/UPDATE(-scoped-columns)/DELETE their own row (currently Case 5 asserts the **opposite**, zero write access — that assertion must be rewritten, not just added to, since 5.1's zero-write-grant state is exactly what this story changes). New negative cases: UPDATE attempting to touch `set_id`/`dj_id`/`source`/`created_at` is rejected by the column grant (not the trigger); cross-DJ INSERT/UPDATE/DELETE rejected by RLS. Plan bump.
  - [x] 3.2 New test cases (same file or a new `segments_write_path_test.sql`, matching whichever sibling-file convention `sync_set_isolation_test.sql` set): ordering violation rejected (D-29.1); FK/set-consistency violation rejected — a boundary play from a different set (D-29.2); overlap violation rejected — two same-type ranges on one set (D-29.3); non-`dancefloor` type rejected (D-29.4/D-32); each rejection asserts the *specific* exception, not a generic constraint code.
  - [x] 3.3 `sync_set_isolation_test.sql`: new cases — a `confirmed = true` segment survives a re-sync with its boundaries rebound to the new play ids at the same position (D-27's core guarantee, the one this whole task exists to prove); a re-sync that shrinks past a confirmed segment's boundary clamps rather than deletes the row, and warns.
  - [x] 3.4 Full `supabase test db supabase/tests` green; `grant_matrix_test.sql` — **do not** add `segments` to a new `authenticated`-scoped array (deferred-work.md notes no such array exists yet for any table; not this story's gap to close).

- [x] Task 4: Web write layer (AC: #1, #3; D-28)
  - [x] 4.1 New `web/lib/sets/segmentWrites.ts` (or extend `web/lib/sets/index.ts` if the codebase's convention is one file per concern — check `web/lib/sets/` for the write-side precedent, e.g. `deleteSet`, before picking a location): `confirmSegment(id)` → `update({ confirmed: true })`; `adjustSegmentBoundary(id, { firstPlayId?, lastPlayId? })` → `update(...)`; `createManualSegment(setId, firstPlayId, lastPlayId)` → `insert({ set_id, type: 'dancefloor', source: 'manual', confirmed: true, first_play_id, last_play_id })`; `deleteSegment(id)` → `delete()`. All via `supabase-js` against the RLS-scoped grants from Task 2 — no RPC (AD-8's generic "web-side mutations go through Supabase/RLS" clause already licenses this; it is not a fifth agent-write amendment, this is a DJ-direct write and AD-8's agent-write amendment list doesn't apply).
  - [x] 4.2 Surface the trigger's specific rejection reasons (ordering / overlap / wrong-set / wrong-type) as distinct, user-legible errors — not a raw Postgres error string. Exact copy is Paige's/a writing-guidelines pass, not this story's to word from scratch, but the plumbing to distinguish the four cases must exist.
  - [x] 4.3 Tests: mock/integration coverage for each write function against the new grants (unit-level, not a full pgTAP re-run from the web side).

- [x] Task 5: Editor UI — tracklist gutter handles, tap-primary/drag-enhancement, suggested/confirmed states (AC: #1, #3; D-34, D-35, D-37)
  - [x] 5.1 `web/app/components/set-detail/Tracklist.tsx`: boundary handles render as a sibling element **between** two `<li>` rows (mirror the existing `connectorAfter`/`.sd-connector` pattern at lines 84, 142-163 — same "sibling div inside the `<li>`, gated by index, keyed off `play.position`" shape already established for hover transitions), not on a row. Bracketed rows get a left-edge rail class. Primary interaction: **tap-to-mark** — tapping a row while "placing a boundary" sets that boundary's play id; no pointer-drag tracking in this pass (D-37 — no drag library exists, `framer-motion` is a dependency but its drag gestures are unused anywhere in this codebase today, first-use-of-capability if picked up later). **Do not touch `.sd-row`'s existing `data-position` attribute or the `<li>`'s `key={play.position}`** — `SetDetail.tsx`'s scroll-to-focus effect queries `[data-position="..."]` directly; the new handle is an additional sibling, never a replacement of or change to that element. **Rows render from `set.plays` (the whole set), never `frame.plays` (the scope-filtered slice)** — `Tracklist.tsx:59` already establishes this for the existing dimming logic; handle placement/indexing must follow the same rule, since a segment's own boundaries can legitimately sit anywhere in the full timeline regardless of which scope is currently viewed.
  - [x] 5.2 A hover-revealed "+" affordance in the same gutter, between any two rows, starts a new manual boundary at that point (AC #1's fallback path).
  - [x] 5.3 Suggested (`source='suggested', confirmed=false`) vs. confirmed segments get distinct visual states (D-35): dashed/lower-opacity handles + rail for suggested, with an explicit confirm affordance nearby; solid/full-opacity for confirmed (manual or confirmed-suggestion — no visual distinction between the two once confirmed).
  - [x] 5.4 `SetHeader.tsx`'s scope line (`scopeLine`, lines 80-82) currently reads **"no edit affordance anywhere (5.3 ships it with the drag that makes it real)"** in its own file header comment (lines 16-17) — this story is that drag. Update the comment once the affordance exists; the `formatTimeRange` display text itself does not need to change.
  - [x] 5.5 Desktop drag as an enhancement (D-37, later in this task's build order, not blocking): layer pointer-drag onto the same handles, computing the nearest row via the existing `getBoundingClientRect()`-based math pattern already used for `DetailArc.tsx`'s hover (`clientX → rect → domain`, see Task 7) — reuse the idiom, don't invent a second one.
  - [x] 5.6 Tests: React Testing Library coverage for tap-to-mark, the "+" affordance, and the suggested/confirmed visual state switch.

- [x] Task 6: Multi-segment selector (AC: —; D-30)
  - [x] 6.1 A chip/list selector above the tracklist (or in `SetHeader`) driven by Task 1.4's `dancefloorSegments()` — one chip per segment ("Dancefloor 1 · N tracks"), plus "+ New". Selecting a chip makes that segment's handles the active/editable ones in the tracklist; non-selected segments still render their rail (dimmed), never hidden.
  - [x] 6.2 `SetDetail.tsx`'s `frame` object (the single source of truth threaded to every child, lines 45-53) needs the actively-selected segment's id alongside `frame.segment` — extend, don't replace, since every existing consumer (`DetailArc`, `Tracklist`, `StatsColumn`) still reads `frame.segment` as today for the primary/scoped view.
  - [x] 6.3 Tests: selector renders N chips for a real several-segment fixture set; switching selection updates which handles are active.

- [x] Task 7: Keyboard accessibility (AC: #2; D-36)
  - [x] 7.1 Each handle: a real focusable widget in the Tab order, `role="slider"`-equivalent (or the closest correct ARIA role for a two-ended range — verify against current ARIA APG guidance, not memorized knowledge, since no such widget exists anywhere in this codebase to copy from — `SetSimilarity.tsx:82-170`'s documented `tabIndex`/`aria-hidden` trap is the only related precedent, and it's a cautionary one, not a pattern to reuse).
  - [x] 7.2 Arrow keys nudge the focused boundary one track-position at a time; Enter confirms (AC #2 verbatim).
  - [x] 7.3 `aria-valuenow` = position, **plus `aria-valuetext` = the actual track name + timestamp** — a bare number is not an accessible implementation of this AC. Pair with a live-region announcement on every nudge ("Dancefloor now starts at [Track Name], 12:04am").
  - [x] 7.4 Verify focus-ring contrast against both `surface` and `surface-container` per UX-DR21's WCAG 2.2 AA floor (the existing lavender-glow focus-ring convention, if one exists in the design tokens — check before inventing a new one).
  - [x] 7.5 Tests: keyboard-only interaction path (Tab → arrows → Enter) covering the full confirm flow.

- [x] Task 8: Arc mirroring (AC: #1; D-34)
  - [x] 8.1 `DetailArc.tsx`'s existing `sd-arc-band` group (lines 496-525 — two `aria-hidden` edge `<line>`s + a wash `<rect>`, no pointer events today) reflects the actively-edited segment's live boundary state. The arc is **not** a second independent drag target — Task 5's tracklist handles are the only interaction surface; the arc updates from the same state, via `heroArc.ts`'s existing `timeAtX`/`mapX` (already exported, no new geometry math needed for the mirror itself).
  - [x] 8.2 If a future desktop-drag pass (Task 5.5) ever wants the arc's edge lines to themselves be draggable, that reuses `DetailArc.tsx`'s existing hit-plane pattern (`hitRef`, `getBoundingClientRect()` → viewBox math, lines 342-431) — not required by this story's ACs, noted only so nobody re-derives the math from scratch later.
  - [x] 8.3 Tests: arc band re-renders when the active segment's boundary changes (visual-regression or prop-level, matching whatever test style `DetailArc.test.tsx` already uses for `frame.segment`).

- [x] Task 9: Docs owed by this story (AC: —)
  - [x] 9.1 `ARCHITECTURE-SPINE.md`: add **AD-24** — the DJ-direct write path for `segments` (RLS + column-scoped grants + the D-29 boundary-integrity trigger). This is a generic-RLS web mutation under AD-8's existing rule, not a fifth agent-write amendment — say so explicitly so a future reader doesn't conflate it with AD-20–23's shape.
  - [x] 9.2 Same file: amend **AD-16**'s "Known violation... assigned to Story 5.3" bullet (line 160) and **AD-23**'s "Known hazard, assigned forward" bullet (line 229) — both now say **closed**, with the capture-and-rebind mechanism and a dated note, matching how 5.2 amended AD-8/AD-16/AD-17 in its own pass rather than leaving the spine contradicting itself.
  - [x] 9.3 `deferred-work.md`: close the launch-blocker entry ("Deferred from: dev of 5-2-segment-detection-algorithm") and the three "Deferred from: code review of 5-1-segments-overlay-schema" entries this story's trigger (D-29) closes (FK/set-consistency, `dj_id`-vs-`set_id` consistency, boundary ordering) and the overlap-policy entry. Leave the `segments_isolation_test.sql` `set_id`-cascade gap and the `grant_matrix_test.sql` authenticated-sweep gap alone — both are explicitly pre-existing, cross-table structural gaps, not this story's to close (per those same entries' own text).
  - [x] 9.4 `epics.md`'s Story 5.3 refinement note (D-33, dancefloor-only MVP) is **already added** (2026-08-11) — verify it's still accurate against whatever actually ships, don't re-add it.
  - [x] 9.5 **Correct a repeating citation error, do not repeat it:** `deferred-work.md`'s Story 5.1 review entries and `5-2-segment-detection-algorithm.md:125,161` both cite "AD-19's pattern" for a "derive, don't trust" principle. **AD-19 in the actual spine is the subscription-billing AD** (`ARCHITECTURE-SPINE.md:184`) — unrelated. No AD anywhere in the spine uses "derive, don't trust" phrasing (grepped, zero hits). This story's Task 2.3/9.1 close the underlying gap for real (the D-29 trigger); do not attach the false AD-19 citation to that closure — either cite the new AD-24 or describe the principle without a false citation.

- [x] Task 10: Gate (run for real, two workspaces — no `agent/`, no `shared/`)
  - [x] 10.1 Supabase: `supabase start`, `supabase migration up` from a full reset, additive-only guard, full `supabase test db supabase/tests`.
  - [x] 10.2 Web: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (vitest) — all four, actually run.
  - [~] 10.3 Browser pass at 1440 and 375 against the local seeded stack (memory `ref-local-browser-pass`'s gotchas apply): confirm a suggestion, drag/tap-adjust a boundary, add a manual boundary, switch between several segments on the reference multi-segment set, full keyboard-only pass. Zero console errors/warnings at both viewports.

### Review Findings

Adversarial (Blind Hunter), Edge Case Hunter, and Acceptance Auditor reviews run in parallel against the full diff, then verified by direct code reading before triage. Doc-closure claims (AD-24, AD-16/AD-23, `deferred-work.md`'s 5 entries) and every Dev Agent Record deviation claim were checked against the actual diff — see the review summary for what was confirmed accurate.

**2 decision-needed, both resolved by Arjun (2026-08-11):**

- [x] [Review][Decision] `segments_validate()`'s security-definer exemption is scoped wider than `sync_set` — the guard (`if current_user <> 'authenticated' then return NEW`) waives all four boundary checks for *any* non-`authenticated` caller, not specifically `sync_set`, and even for `sync_set` only the overlap check is genuinely needed. **Ruling: accept as documented.** `service_role` already bypasses RLS in this stack by design, so this is not a new attack surface — narrowing it would add real complexity (a session-local flag) for a guarantee the platform's own trust model doesn't require. [`supabase/migrations/20260811120000_add_segments_write_path.sql:97-99`]
- [x] [Review][Patch] `SegmentSelector` re-clicking the active chip silently discards a dirty draft — `onClick={() => editor.selectSegment(selected ? null : segment.id)}` reuses the same `selectSegment(null)` path as an explicit Cancel, with no check on `editor.dirty`. A double-tap of the already-active chip (plausible on touch) discards an unsaved drag/tap edit with zero warning. **Ruling: no-op while dirty** — re-clicking the active chip with an unsaved edit does nothing; the DJ must use the explicit Cancel button to discard, matching Cancel's role as the only intentional-discard path. **Fixed**: `selectSegment(null)` now returns early when `dirty`. [`web/app/components/set-detail/useSegmentEditor.ts`, `SegmentSelector.tsx:92`]

**8 patch findings, all applied 2026-08-11:**

- [x] [Review][Patch] Boundary handles for every segment share one global editor state, so interacting with a non-active segment's handle silently edits the *active* segment instead — `Tracklist.tsx` renders a `SegmentBoundaryHandle` for every segment (not just the active one), but every handle's `onClick`/`onKeyDown`/drag all wire to `editor.startPlacing`/`nudge`/`commit`/`setEdge`, which operate on the single `draft` tied to `activeId`, never the segment the DJ actually touched. On any set with 2+ dancefloor segments, tabbing to or clicking an inactive handle either no-ops visibly or mutates the wrong segment's boundary — a real violation of AC #2. Independently found by two review layers reading the diff from different angles, then confirmed by direct read of the current code. **Fixed**: every handle now carries its own `segmentId`; `useSegmentEditor`'s new `ensureActive(segmentId)` resolves "the segment this interaction targets," switching the active segment first when it differs, before any tap/drag/nudge/commit acts. [`web/app/components/set-detail/Tracklist.tsx`, `SegmentBoundaryHandle.tsx`, `useSegmentEditor.ts`]
- [x] [Review][Patch] Boundary handle remounts every time its boundary crosses into a different tracklist row, breaking two shipped behaviors — rows are `<li key={play.position}>`, and each handle renders as a sibling gated by `segmentLayout.startsAt`/`endsAt` (position-keyed maps), so moving a boundary across a row moves the handle to a *different DOM parent*; React cannot reconcile across that and unmounts/remounts it. (a) The 2026-08-11 changelog's "continuous drag" fix relies on `grip.style.transform`/`data-dragging` living on one persistent DOM node — the moment a drag crosses the first row, that node is replaced and the fix reverts to the pre-fix per-row snap. (b) Arrow-key nudging that crosses a row unmounts the focused `<button>`, dropping DOM focus after the first press — the story's own 1440 browser pass verified only a single nudge, never two consecutive presses, which is why this wasn't caught. **Fixed, without the full overlay-layer rewrite**: (a) the "no CSS transition, live transform" drag state is now a React-owned prop (`useSegmentEditor`'s `draggingSegmentId`/`draggingEdge`, surfaced via `onDragStateChange`) rather than an imperative `dataset` write on a ref that goes stale across a remount — whichever DOM node is currently rendered gets `data-dragging` correctly. (b) a one-shot `justNudgedEdge` signal tells the freshly-mounted handle to reclaim DOM focus via `useLayoutEffect`, self-clearing one frame later via `requestAnimationFrame`. [`web/app/components/set-detail/useSegmentEditor.ts`, `SegmentBoundaryHandle.tsx`]
- [x] [Review][Patch] `commit()` and `selectSegment()` have no re-entrancy/pending guard — the boundary handle's Enter-key path calls `onCommit()` directly, bypassing the `disabled={pending}` guard the visible Confirm button has, so rapid double-Enter can fire two concurrent write actions racing the D-29 overlap check. Separately, `selectSegment` (every chip's `onClick`) isn't guarded by `pending` either, so switching the active segment while a previous commit is in flight lets that commit's later `leaveEditMode()` silently close the newly-selected segment's fresh draft. **Fixed**: `ensureActive` (the new common gate for every cross-segment interaction) returns `null` while `pending`, and the handle's own Enter-key handler checks `pending` before calling `onCommit`. [`web/app/components/set-detail/useSegmentEditor.ts`, `SegmentBoundaryHandle.tsx`]
- [x] [Review][Patch] `confirmSegment`/`adjustSegmentBoundary` report success on a zero-row UPDATE match — an UPDATE that matches no row (stale/deleted segment id) is not a Postgres error, so both functions return normally with nothing written. `deleteSegment` documents and accepts this exact limitation; these two do not, and `commit()`'s own staleness path (`activeSegment` going `null` while `draft.segmentId` is still set) can reach it — the DJ sees the editor close as if the write landed when nothing was written. **Fixed**: both now chain `.select("id")` and throw `not-permitted` via a new `assertRowMatched` helper when zero rows come back. Regression tests added. [`web/lib/sets/segmentWrites.ts`, `segmentWrites.test.ts`]
- [x] [Review][Patch] `sync_set`'s suggested-segment materialization never checks overlap against the confirmed/manual segments just rebound earlier in the same call — every other validity check in that loop (type, integer bounds, in-range, resolves-to-real-play) is warn-and-skip, but overlap against existing rows is not checked at all. A confirmed segment plus a re-sync whose detector proposes an overlapping range leaves an inert, unconfirmable suggested row in the table with no explanation until the DJ tries to confirm it. **Fixed**: the loop now applies the same overlap check `segments_validate()` uses (warn-and-skip, matching every other check in the loop). Verified live: this exact scenario was already latent in `sync_set_isolation_test.sql`'s own "confirmed-survives" fixture (its re-sync payload proposes a suggestion at the confirmed floor's exact range) — the fix's warning fired there on the first `supabase db reset`, and a new assertion locks in that no phantom duplicate lands. [`supabase/migrations/20260811120000_add_segments_write_path.sql`, `supabase/tests/sync_set_isolation_test.sql`]
- [x] [Review][Patch] Finishing a drag re-arms tap-placement for the same edge — `onPointerDown` and `onClick` are both bound to the boundary grip; `preventDefault()` on `pointerdown` does not suppress the native `click` that follows (click isn't in the pointer-event compatibility-mouse-event suppression list, and `setPointerCapture` keeps it targeted at the grip). So completing a drag still fires `onClick` → `onStartPlacing(edge)` afterward, and the very next tap anywhere in the tracklist unexpectedly moves that boundary again. **Fixed**: a `didDragRef` set on real pointer movement is checked (and reset) inside `onClick`, distinguishing a completed drag from a stationary tap. [`web/app/components/set-detail/SegmentBoundaryHandle.tsx`]
- [x] [Review][Patch] `reasonFromMessage` has no bucket for the pre-existing `segments_manual_confirmed_check` CHECK constraint — reachable in principle through the grant-writable `confirmed`/`type` columns; falls through to `"unknown"` today since no current UI path sends `confirmed: false`. Low priority — taxonomy-completeness gap, not a live bug. **Fixed**: new `SegmentWriteReason` value `"invalid-state"`, matched on the constraint name, with a DJ-facing copy line and a test case. [`web/lib/sets/segmentWrites.ts`, `SegmentSelector.tsx`, `segmentWrites.test.ts`]
- [x] [Review][Patch] Drag's `window` pointer listeners have no unmount-time cleanup and no `event.isPrimary` check — listeners are only released via `pointerup`/`pointercancel`, so a subtree unmount mid-drag (e.g. forced by the remount finding above) leaks them; a second touch finger during an active drag can also start a concurrent, conflicting drag since only `event.button` is checked. Low priority — real but narrow. **Fixed**: an `!event.isPrimary` guard added to `onPointerDown`; the drag gesture's cleanup closure is stashed in a ref and also invoked from a `useEffect` unmount handler, so it always runs once regardless of whether `pointerup` ever fires. [`web/app/components/set-detail/SegmentBoundaryHandle.tsx`]

**Gate re-run after patches (2026-08-11):** `supabase db reset` clean, 275/275 pgTAP (274 + 1 new regression case), additive-only guard clean, 828/828 vitest (825 + 3 new regression cases), lint/typecheck/build green across all 3 workspaces.

**Verified, not findings (for the record):**
- Capture-and-reinsert vs. the story's sketched capture-and-rebind: the `on delete cascade` claim checks out; the shipped mechanism correctly preserves identity/`created_at`/clamp-with-warning.
- The D-27 clamp legitimately colliding two segments onto an identical position after a severe shrink is the *documented, intended* consequence of the trigger's sync-exemption (design doc's own reason #2) — not a new defect. It also has a DJ-facing recovery path the initial pass missed: DELETE isn't gated by the trigger at all, so "Remove" resolves a collision even in the degenerate single-play-set case.
- `SetPlay.id` optional / `SegmentBounds` split, the AD-19 mis-citation correction, and all doc closures (AD-24 new; AD-16/AD-23 "closed"; `deferred-work.md`'s 5 entries) — all checked against the actual diffs and match what's claimed, including an honestly-scoped "partly closed" entry for the pre-existing `dj_id`/`set_id` gap.
- `sync_set`'s rebind loop `last_id is null` branch is unreachable dead code (the `last_id` query's own filter always matches at least the row already found for `first_id`) — harmless, no functional impact, not worth a patch.
- The three pre-recorded known gaps (375px viewport, jsdom event-wiring, `dj_id`/`set_id` cross-check) are the only pre-existing gaps found. One caveat: the boundary-handle-routing patch finding above is a *concrete, confirmed* bug the "event wiring untested" gap allowed to ship undetected, not merely a restatement of that gap.

## Dev Notes

### The gap the design session didn't surface

The 2026-08-11 party-mode session (see the design doc) locked eleven decisions on the sync fix, write policy, trigger shape, and UI model — but never checked whether the **read path** could actually support any of it. It can't, today: `web/lib/sets/index.ts`'s `SegmentRow`/`PlayRow` types select neither `segments.id` nor `plays.id` at all (`index.ts:69-84,116-122,159`), and `dancefloor.ts`'s `DancefloorSegment` type (`dancefloor.ts:25-28`) has no `id` field either. Without a segment's own id, there's nothing to `UPDATE`/`DELETE` by. Without a play's own id, there's nothing to write into `first_play_id`/`last_play_id`. **Task 1 is not in the design doc and is not optional** — it's a prerequisite this story's own research found, and every other task depends on it.

### Boundary-integrity trigger — exact shape (D-29)

```sql
create or replace function public.segments_validate() returns trigger as $$
declare
  v_first_pos int;
  v_last_pos  int;
  v_first_set uuid;
  v_last_set  uuid;
begin
  select position, set_id into v_first_pos, v_first_set from public.plays where id = NEW.first_play_id;
  select position, set_id into v_last_pos,  v_last_set  from public.plays where id = NEW.last_play_id;

  if v_first_set <> NEW.set_id or v_last_set <> NEW.set_id then
    raise exception 'segment boundary references a play outside its own set';
  end if;

  if v_first_pos > v_last_pos then
    raise exception 'segment boundaries reversed (first position % > last position %)', v_first_pos, v_last_pos;
  end if;

  if NEW.type <> 'dancefloor' then
    raise exception 'only dancefloor segments can be written (MVP guard, Story 5.3 D-32)';
  end if;

  if exists (
    select 1 from public.segments s
    join public.plays fp on fp.id = s.first_play_id
    join public.plays lp on lp.id = s.last_play_id
    where s.set_id = NEW.set_id
      and s.id <> NEW.id
      and s.type = NEW.type
      and fp.position <= v_last_pos
      and lp.position >= v_first_pos
  ) then
    raise exception 'segment overlaps an existing % segment for this set', NEW.type;
  end if;

  return NEW;
end;
$$ language plpgsql security invoker set search_path = '';

create trigger segments_validate_trigger
  before insert or update on public.segments
  for each row execute function public.segments_validate();
```

`security invoker` (the default) is correct here, not `security definer` — the function only needs the SELECT access the calling DJ already has on their own `plays`/`segments` rows via RLS; there is no reason to elevate. `NEW.id <> s.id` is safe on INSERT (a fresh row has no matching `id` yet) as well as UPDATE.

### RLS write grants — exact shape (D-28)

```sql
grant insert, delete on public.segments to authenticated;
grant update (confirmed, type, label, first_play_id, last_play_id) on public.segments to authenticated;

create policy segments_insert_own on public.segments
  for insert with check (auth.uid() is not null and auth.uid() = dj_id);

create policy segments_update_own on public.segments
  for update using (auth.uid() is not null and auth.uid() = dj_id)
             with check (auth.uid() is not null and auth.uid() = dj_id);

create policy segments_delete_own on public.segments
  for delete using (auth.uid() is not null and auth.uid() = dj_id);
```

Matches `segments_select_own`'s exact AD-7 shape. `set_id`, `dj_id`, `source`, `created_at` are absent from the column-scoped `grant update (...)` list — a DJ cannot UPDATE them regardless of RLS, because the grant itself never offers the column.

### Sync-wipe fix — exact shape (D-27)

Extends `sync_set`'s existing body (`20260810193000_add_segments_source_confirmed.sql`), same 5-arg signature, same `create or replace function` pattern 5.2 used on 5.1's original. Insert the capture step immediately before line 159's `delete from public.plays`, and the rebind step immediately after the plays reinsert (lines 161-191) completes, both inside the same transaction:

```sql
-- Capture (before the plays delete): each DJ-authored segment's boundaries,
-- independently, by position — not "does this segment still fit."
create temp table if not exists _segment_capture (
  segment_id uuid, first_position int, last_position int
) on commit drop;

insert into _segment_capture
select s.id, fp.position, lp.position
from public.segments s
join public.plays fp on fp.id = s.first_play_id
join public.plays lp on lp.id = s.last_play_id
where s.set_id = computed_set_id
  and (s.confirmed or s.source = 'manual');

-- ... existing plays delete + reinsert, unchanged ...

-- Rebind (after the plays reinsert): resolve each captured position back to
-- the freshly-minted plays.id, per boundary, clamping independently if a
-- position no longer exists (never delete a DJ-authored row).
update public.segments s set first_play_id = (
  select p.id from public.plays p
  where p.set_id = computed_set_id
  order by abs(p.position - c.first_position) asc, p.position asc
  limit 1
)
from _segment_capture c
where s.id = c.segment_id;
-- (mirror for last_play_id; raise warning when the resolved position != the
-- captured position, i.e. a clamp actually happened)
```

The exact clamp query above is illustrative of the intent (nearest remaining position), not a literal copy-paste — the dev agent should verify it against the real `plays` row shape and add the `raise warning` on the clamp path per D-27's requirement.

### Architecture compliance (the walls you must not hit)

- **AD-8:** this story's writes are **DJ-direct via RLS**, the generic "web-side mutations go through Supabase/RLS" clause — **not** a fifth entry in AD-8's four-named-agent-write-amendment list (AD-20–23). Do not write an amendment that reads like a fifth agent write; it isn't one.
- **AD-16 / AD-23:** both currently say this story's sync-wipe hazard is "assigned to Story 5.3" / "assigned forward" — Task 9.2 is not optional, the spine must not keep saying "assigned" once this story lands the fix, or it starts contradicting itself the same way 5.2's own review caught happening to AD-16/AD-23 last time.
- **AD-11 (never guess):** the clamp-on-shrink path (D-27) is the one place this story invents a value (the nearest valid position) rather than deriving one exactly — justified explicitly in the design doc (D-27) as the accepted alternative to silently deleting DJ-authored data, not a violation of AD-11's spirit so much as its one deliberately-scoped exception, same shape as AD-9's "default is public but only for sets synced after joining the social layer" carve-out.
- **Additive-only everywhere:** the migration is a `create or replace function` + new grants/policies/trigger — no destructive DDL, passes the additive-only guard the same way `20260731130000_add_play_subgenre.sql` and `20260810193000` did before it.

### Previous-story intelligence (5.1, 5.2)

- **5.1's and 5.2's own deferred-work entries name this story as the owner of exactly what Task 2/3 build** — FK/set consistency, boundary ordering, overlap policy, and the sync-wipe hazard. Read `deferred-work.md`'s "Deferred from: code review of 5-1-segments-overlay-schema" and "Deferred from: dev of 5-2-segment-detection-algorithm" sections in full before starting Task 2 — they are effectively a second, independently-written spec for the same trigger and fix this story's design doc already committed to; the two should agree, and if they don't, the disagreement is worth surfacing rather than silently picking one.
- **A citation error has propagated across two prior stories' text** — see Task 9.5. Don't be the third.
- **5.2's own regression** (rebuilding `sync_set` from a stale ancestor, silently dropping the `deleted_sets` tombstone check) is the concrete reason Task 2.4 says "not an older ancestor" in bold. Verify against `20260810193000`'s actual current body, not a remembered shape.
- **ai-14** (diff-check Dev Notes/File List against `git diff --stat` before promoting to review) and **ai-18** (aria/visible drift is a literal review line) both apply here — Task 5-8's UI work is exactly the kind of surface ai-18 exists for.

### Project Structure Notes

- Modified: `web/lib/sets/index.ts`, `dancefloor.ts`, `types.ts` (Task 1); new or extended `web/lib/sets/segmentWrites.ts` (Task 4); `web/app/components/set-detail/{Tracklist,SetHeader,SetDetail,DetailArc}.tsx` (Tasks 5-8); corresponding test files.
- New Supabase migration (Task 2); modified `supabase/tests/segments_isolation_test.sql`, `sync_set_isolation_test.sql` (Task 3); `supabase/README.md` tree map.
- Modified: `ARCHITECTURE-SPINE.md` (AD-24 new; AD-16/AD-23 amended), `deferred-work.md` (Task 9.3).
- `epics.md`'s Story 5.3 note and `5-3-segment-editor-design.md` already exist — read, don't re-derive.
- No `agent/`, no `shared/` files touched at all (contrast 5.2's three-workspace diff).

### References

- [Source: `_bmad-output/implementation-artifacts/5-3-segment-editor-design.md` — D-27..D-37, §0 scope, §2 write-path shape diagram]
- [Source: `_bmad-output/planning-artifacts/epics.md` §Story 5.3 + both ⚑ notes; Epic 5 intro]
- [Source: `_bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md` FR-14 (line 299), FR-15 (line 303), FR-28 (line 307)]
- [Source: `_bmad-output/planning-artifacts/epics.md:109,126,127` — UX-DR9, UX-DR20, UX-DR21 (defined only here, not in the PRD or UX-designs docs)]
- [Source: `ARCHITECTURE-SPINE.md` AD-7 (line 96, RLS isolation pattern), AD-8 (line 102, web-mutation rule + its four agent-write amendments — this story is not a fifth), AD-16 (line 151, esp. the line-159/160 amendments this story must close), AD-23 (line 218, esp. line 229's "assigned forward" this story closes)]
- [Source: `supabase/migrations/20260810153813_create_segments.sql` — original schema, zero-write-grant state this story ends]
- [Source: `supabase/migrations/20260810193000_add_segments_source_confirmed.sql` — current `sync_set` body (lines 71-290) this story's Task 2.4 extends; the suggested-segment materialization block (lines 193-286) this story does not touch]
- [Source: `supabase/tests/segments_isolation_test.sql` — Case 5's zero-write-grant assertion this story must rewrite, not just add to]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md` — "Deferred from: code review of 5-1-segments-overlay-schema" (FK/set consistency, ordering, overlap, all assigned here); "Deferred from: dev of 5-2-segment-detection-algorithm" (the launch-blocker sync-wipe hazard, assigned here)]
- [Source: `web/lib/sets/index.ts:69-84,105-159,270-301` — `PlayRow`/`SegmentRow`/`SET_WITH_PLAYS_SELECT`/`toSegments`/`toSetRecord`, the exact gap Task 1 closes]
- [Source: `web/lib/sets/dancefloor.ts` — `DancefloorSegment`, `primaryDancefloorSegment` (unchanged by this story), `playsInSegment`/`segmentStats`]
- [Source: `web/app/components/set-detail/SetDetail.tsx` — the `frame` single-source-of-truth object (lines 45-53) Task 6.2 extends; `flipScope`'s focus-clearing precedent (lines 100-103)]
- [Source: `web/app/components/set-detail/Tracklist.tsx:84,142-163` — the existing `connectorAfter`/`.sd-connector` between-rows pattern Task 5.1 mirrors]
- [Source: `web/app/components/set-detail/DetailArc.tsx:118-127,153-169,253-259,342-431,496-525` — `frame.segment` usage, the `sd-arc-band` group Task 8 extends, the hit-plane pointer-math pattern]
- [Source: `web/app/components/set-detail/SetHeader.tsx:16-17,80-82,134-155` — the scope toggle, and its own file comment already pointing at this story]
- [Source: `web/lib/sets/heroArc.ts` — `heroArcGeometry`, `timeAtX`/`mapX`, the geometry Task 8 reuses rather than re-derives]
- [Source: `web/package.json` — confirmed no drag/gesture library; `framer-motion` present but its drag primitives are unused anywhere in this codebase today]
- [Source: `_bmad-output/implementation-artifacts/5-2-segment-detection-algorithm.md` — Dev Agent Record's stale-ancestor regression (the reason Task 2.4 is explicit about which body to rebuild from); the AD-19 mis-citation at lines 125,161 this story corrects]

## Dev Agent Record

### Agent Model Used

Claude Opus 5 (`claude-opus-5`), bmad-dev-story, 2026-08-11.

### Debug Log References

- `supabase db reset` → full migration replay clean, seed loads.
- `supabase test db supabase/tests` → **274/274 pass** across 11 files from a fresh reset.
- Root `pnpm lint` / `typecheck` / `test` / `build` → all four green at workspace scope (3 workspaces). **813 vitest tests pass.**
- `check-additive-only-migrations.sh` → clean.

### Completion Notes List

**The story's sketched sync fix could not have worked, and would have failed silently.** Task 2.4 and the Dev Notes both described capture-and-**rebind**: capture each boundary's `position` before the plays delete, then `update public.segments set first_play_id = …` after the reinsert. `segments.first_play_id`/`last_play_id` carry `on delete cascade`, so `delete from public.plays` has **already deleted those rows** by the time that update runs — it would have matched zero rows and shipped the exact data loss the story exists to fix, with every gate green. Implemented as capture-and-**reinsert** instead: DJ-authored rows are captured whole into a `jsonb` local, and written back after the reinsert under their **original `id` and `created_at`**, so segment identity (which is what D-28 actually needed for 5.4's stat-slicing and D-17's active-learning signal) survives. `deferred-work.md`, `epics.md` and AD-24 all record the correction, since the shape is counter-intuitive and the failure mode is invisible.

**The D-29 trigger had to be exempted for `sync_set`, and that is load-bearing rather than a loophole.** `sync_set` is `SECURITY DEFINER`, so `current_user` inside it is the function owner rather than `authenticated`, and `segments_validate` returns early for any non-`authenticated` caller. Three independent reasons, all documented in the function header: (1) Epic 5's charter forbids an overlay nicety poisoning a content sync — a trigger able to `raise` would have silently undone AD-23's warn-and-skip promise, so a DJ's night of plays could fail to sync because the detector proposed two touching floors; (2) D-27's clamp can legitimately produce an overlap, and the restore must be able to write a row the DJ-facing rule rejects; (3) D-32's `dancefloor`-only guard restricts what a DJ may *create*, not what may be *restored*. The check is unforgeable from a client, and RLS still constrains every row either way — it decides which validations apply, never who owns what. Asserted directly in `segments_write_path_test.sql`.

**`grant_matrix_test.sql`'s generic trigger-function sweep caught a real hole in my own migration.** New Postgres functions are born with `EXECUTE` granted to `PUBLIC`, so `segments_validate()` was client-executable until an explicit `revoke`. That sweep exists because `record_deleted_set()` shipped anon-executable in Story 4.7 while the very next migration was busy revoking the three functions someone had remembered to list. It worked exactly as designed.

**`pnpm build` caught a server/client boundary violation the other three gates could not.** `useSegmentEditor` (a client hook) imported `playIdAtPosition` from `segmentWrites.ts`, which reaches `@/lib/supabase/server` — pulling the server client into the browser bundle. Lint, typecheck and vitest were all green on it. `playIdAtPosition` moved to `segmentEditor.ts` (pure, client-safe) where it belonged anyway.

**Two shape gaps in the story's own Task 1 spec, closed as found.** (a) Task 1.3's `DancefloorSegment` field list omits `confirmed`, but Task 5.3 requires distinguishing suggested from confirmed segments visually — the field is now carried through `toSegments`. (b) `SegmentBounds` was split out of `DancefloorSegment` for the pure scoping functions (`playsInSegment`, `segmentStats`, `heroArcGeometry`, `scopedPlays`) that read only `start`/`end`: widening them to demand row identity they never touch would have forced dozens of synthetic test timelines to mint uuids asserting nothing. `SetPlay.id` is **optional**, matching `session_label`/`segments`' own additive-augmentation precedent on that type — a fixture-backed play genuinely has no cloud row, and the editor renders read-only for such a set rather than pretending otherwise.

**Task 9.5's citation claim is itself slightly wrong, and I did not propagate it.** The story says `deferred-work.md` **and** `5-2-segment-detection-algorithm.md:125,161` both cite "AD-19's pattern". 5-2 quotes the phrase *"derive rather than trust"* but carries **no AD-19 citation** — the mis-citation originates at `5-1-segments-overlay-schema.md:71` and was copied verbatim into `deferred-work.md`. Both of those are corrected in place with dated notes; nothing was "corrected" in 5-2, where there was nothing to correct.

**Deviation: no React Testing Library, and it needs a ruling.** Tasks 5.6/6.3/7.5/8.3 ask for RTL coverage. This repo has **neither RTL nor a DOM environment**, by an explicitly documented choice in both existing `prop-threading.test.tsx` suites, and adding them is a dependency decision rather than a dev-time one (a HALT condition). Coverage is split along the seam the codebase already uses instead: `segment-editor-threading.test.tsx` asserts what reaches the DOM (19 cases, every threaded prop with a negative control), and the behaviour behind it is asserted as pure functions — the full keyboard mapping AC #2 names was **extracted into `boundaryKeyAction`** specifically so it is testable without a DOM, plus every position rule in `segmentEditor.test.ts` (25 cases) and every write payload in `segmentWrites.test.ts` (15 cases). What this genuinely does **not** cover is event wiring: that clicking a row while armed calls `tapRow`, that `preventDefault` fires on Enter. Flagged rather than papered over.

**The 1440 browser pass found four defects no other gate could see.** Every one shipped through green lint, typecheck, 813 tests and a clean build.

1. **The grip rendered ~830px from the rail it belongs to.** `.sd-boundary-line` is `flex: 1`, so with the line first in DOM order it stretched and pushed the grip to the far right edge of the tracklist — nowhere near the timeline rail or the "+" in the same gutter. Grip now renders first; measured at x=196 against the "+" at x=199 and the rail at x=142.
2. **Selecting a segment past row 50 armed an editor pointing at nothing.** The tracklist pages at 50 rows; Dancefloor 2 starts at position 69. Selecting it showed Confirm/Cancel/Remove while its handles sat unrendered below the fold — editing controls for a segment the DJ could neither see nor reach. `useSegmentEditor` now takes a `revealPosition` callback; `SetDetail` shares the exact paging math `setFocus` has used since 3.7 (extracted, not duplicated), and `nudge` reveals too so a downward arrow cannot unmount the focused handle mid-interaction.
3. **Two different names for the same track, read aloud.** The handle's `aria-valuetext` said "Untitled track" while the live-region nudge said "an untitled track" — a non-sighted DJ heard different names depending on whether they focused the boundary or arrowed onto it. Both now build from one `boundaryValueText`, with five regression cases.
4. **Active-segment rows and `:hover` used the same token**, so hovering any of the 46 rows inside the selected floor produced no visible change. The selection wash dropped to `--color-abyss-row-line` (~4%), leaving `--color-abyss-row-hover` (~9%) to mean hover again.

**What the 1440 pass verified end-to-end, against the real database:** AC #3 (confirm → `confirmed` flips to `t` while `source` stays `suggested`, D-18 intact); AC #1 tap-to-mark (69|79 → 69|75 persisted) and the "+" manual path (41 affordances on free rows only, writing `('manual', true, 'dancefloor', 60, 64)`); AC #2 (arrow nudge 50→49 with `defaultPrevented`, Enter committing it to `4|49`); D-30 segment switching (paging to 100 rows, 11 active rail rows, other floors' handles rendered inactive); D-34 arc mirroring (`data-editing="true"` band tracking the draft); and the full D-29 rejection chain — dragging 60..64 into 69..75 surfaced "That would overlap another dancefloor on this set." with the row left untouched at 60|64 and the DJ still editing. Seven sliders in the tab order, none `aria-hidden`, `tabIndex` 0. **Zero console messages at 1440.**

**NOT performed: the 375 viewport.** Chrome is maximized (`outerWidth: 0`), so the extension's `resize_window` is silently ignored, and the Playwright MCP profile is locked by a concurrent session. The phone-width CSS is therefore **unverified in a browser**: the `max-width` block that pulls `.sd-boundary`/`.sd-add-boundary` in to the 58px rail column and forces `.sd-add-boundary-button` to `opacity: 1` (no hover on touch) has never been seen rendering. That block matters more than usual here — D-37 made touch the *primary* interaction. Owed before this story is called done.

**Instrumentation note for whoever runs it next:** the Chrome extension's synthetic coordinate clicks and `key` presses did not reach this page — arrow keys scrolled the window instead of hitting the focused handle. Driving via `element.click()` and dispatched `KeyboardEvent`s worked correctly and is what the results above rest on. That is an instrumentation limit, not an app defect: the same handler, given a real bubbling keydown, returned `defaultPrevented: true` and moved the boundary.

**Concurrent session active on this repo.** `deferred-work.md` changed on disk mid-session, and `5-4-segment-scoped-stats.md`, `epics.md`'s 5.4 note, `.memlog.md` and `track-320.png` are another session's work — deliberately excluded from the File List below.

### File List

**New — `supabase/`**
- `supabase/migrations/20260811120000_add_segments_write_path.sql`
- `supabase/tests/segments_write_path_test.sql`

**New — `web/`**
- `web/lib/sets/segmentWrites.ts`
- `web/lib/sets/segmentWrites.test.ts`
- `web/lib/sets/segmentEditor.ts`
- `web/lib/sets/segmentEditor.test.ts`
- `web/app/components/set-detail/useSegmentEditor.ts`
- `web/app/components/set-detail/SegmentBoundaryHandle.tsx`
- `web/app/components/set-detail/SegmentSelector.tsx`
- `web/app/components/set-detail/segment-editor-threading.test.tsx`

**Modified — `supabase/`**
- `supabase/tests/segments_isolation_test.sql` (Case 5 rewritten: zero-write-grant → the write path; plan 19 → 27)
- `supabase/tests/sync_set_isolation_test.sql` (D-27 rebind/clamp/loss cases; plan 28 → 35)
- `supabase/README.md` (tree map)

**Modified — `web/`**
- `web/lib/sets/index.ts` (`PlayRow.id`, `SegmentRow` identity, select string, `toSetPlay`, `toSegments`, write re-exports)
- `web/lib/sets/index.test.ts`
- `web/lib/sets/types.ts` (`SetPlay`; `SetRecord.plays` widened)
- `web/lib/sets/dancefloor.ts` (`SegmentBounds`, `DancefloorSegment` identity + `confirmed`, `dancefloorSegments`)
- `web/lib/sets/dancefloor.test.ts`
- `web/lib/sets/fixtureSegments.ts`
- `web/lib/sets/heroArc.ts` / `web/lib/sets/setDetail.ts` (bound-only signatures → `SegmentBounds`)
- `web/lib/sets/listModel.test.ts` / `web/lib/sets/rightColumn.test.ts` (segment factories carry identity)
- `web/app/(authenticated)/set/[id]/actions.ts` (four segment server actions)
- `web/app/components/set-detail/SetDetail.tsx` (editor state, selector, `editingBounds`)
- `web/app/components/set-detail/Tracklist.tsx` (handles, rail, tap target, "+" gutter)
- `web/app/components/set-detail/DetailArc.tsx` (live band mirror)
- `web/app/components/set-detail/SetHeader.tsx` (stale forward-reference comment closed)
- `web/app/components/set-detail/model.ts` (`ScopeFrame.activeSegmentId`, `.editingBounds`)
- `web/app/set-detail.css`

**Modified — docs**
- `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md` (AD-24 new; AD-16 + AD-23 closed)
- `_bmad-output/implementation-artifacts/deferred-work.md` (5 entries closed/partly closed)
- `_bmad-output/implementation-artifacts/5-1-segments-overlay-schema.md` (AD-19 citation corrected at source)
- `_bmad-output/planning-artifacts/epics.md` (Story 5.3 note: capture-and-rebind → capture-and-reinsert)
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

## Change Log

- **2026-08-11 — Story 5.3 implemented (Tasks 1-9; Task 10 gate green except the browser pass).** DJ-direct `segments` write path: RLS INSERT/DELETE grants + column-scoped UPDATE (D-28), a four-check boundary-integrity trigger (D-29, D-32), and the D-27 sync-wipe fix. Read model extended with segment/play identity (Task 1). Tracklist gutter-handle editor with tap-primary interaction and desktop drag, suggested/confirmed visual states, a multi-segment selector, full keyboard path, and live arc mirroring. **AD-24 added; AD-16's "known violation" and AD-23's "assigned forward" both closed.**
- **2026-08-11 — correction to the story's own sync-fix design.** Capture-and-rebind replaced with capture-and-reinsert: the `on delete cascade` deletes the segments rows before any rebinding UPDATE could run, so the sketched fix would have matched zero rows and shipped the bug it was written to fix. See Completion Notes.
- **2026-08-11 — 1440 browser pass: four defects found and fixed.** Grip pushed to the far edge of the tracklist by `flex: 1` on the line; selecting a segment past the 50-row page armed an editor whose handles were not rendered; `aria-valuetext` and the live region disagreed on the untitled-track wording; active-segment rows and `:hover` shared a token, killing hover feedback across 46 rows. All four passed lint, typecheck, 813 tests and a clean build. Added `boundaryValueText` (+5 regression cases) and `revealPosition` (sharing `setFocus`'s paging math). **375 viewport not performed** — Chrome maximized, Playwright profile held by a concurrent session; the phone-width CSS block remains unverified in a browser and is owed before done.
- **2026-08-11 — polish pass (Arjun's 10-point review).** An explicit **edit mode** now exists rather than being implied by selection state. Selecting a floor: pins the action bar (sticky, glass, only while editing — a floor can run eighty rows and Confirm/Cancel/Remove must not scroll away), **scrolls to the floor's first boundary** so the DJ can see where it currently starts, and **dims the tracks outside it** (0.42, lighter than DR-2's 0.25 focus dim — those tracks are context, not filtered-out matches). Confirm and Cancel both **leave** edit mode; leaving the controls up after a successful write read as "nothing happened". The gutter **"+" is edit-mode only** (a stray click in a row gap could previously start a segment) and is reached through a new **"+ New" chip**, which is also the only entry point on a set with no floors at all. Handle grips gained a ring and a real glow — they were hard to see. Chip hover **swaps the label to "Edit"** (two faces sliding in a clipped box; the hover face is `aria-hidden`, so the accessible name stays the segment's own). The **"+" no longer paints its own 44px touch target** as a large bordered circle floating off the rail — the target is invisible padding and only an 18px chip is drawn, the same grip/target split the boundary handle uses. Dragging is now **continuous**: the grip's transform is rewritten from live rects every frame (rAF-throttled, straight to `style`, no React re-render), so crossing a track no longer teleports it, and CSS eases the last few pixels home on release. The hint shrank to "Pick where it starts." and only appears while adding.
- **2026-08-11 — where Story 5.5 goes.** Arjun's ruling: the edit mode above **is** the host for Layer 2 enrichment (venue/crowd/notes/photos), entered against the already-selected segment. Recorded as a refinement note on `epics.md` §Story 5.5, including the two consequences it forces — enrichment becomes segment-scoped rather than set-scoped, and 5.5 owns the additive migration plus the widening of AD-24's column-scoped UPDATE grant.
- **2026-08-11 — code review: 2 decisions + 8 patches, all resolved same-session.** Adversarial, edge-case, and acceptance-auditor reviews run in parallel against the full diff, findings verified by direct code read before triage. Real defects, independently confirmed: boundary handles were wired to global editor state rather than per-segment identity (a violation of AC #2 on any multi-segment set — interacting with a non-active handle silently edited the *active* segment instead); handles remounted on every row crossed, quietly defeating the shipped "continuous drag" fix and dropping keyboard focus after one arrow-key nudge; `commit()`/`selectSegment()` had no re-entrancy guard against `pending`; `confirmSegment`/`adjustSegmentBoundary` reported success on a zero-row UPDATE match; `sync_set`'s suggested-segment loop never checked overlap against just-rebound confirmed/manual segments (verified live against the existing `sync_set_isolation_test.sql` fixture, which had been exercising this exact gap all along without an assertion to catch it); a completed drag's trailing `click` event re-armed tap-placement; two low-priority taxonomy/cleanup gaps. Every finding fixed same-session — see Review Findings for the resolution of each. Doc closures (AD-24, AD-16/AD-23, `deferred-work.md`) and every Dev Agent Record deviation claim were independently verified accurate; no overclaiming found. Gate re-run clean: 275/275 pgTAP, 828/828 vitest, lint/typecheck/build green across 3 workspaces. **Task 10.3's 375px browser pass remains the one outstanding item, unrelated to this review** — still blocked on the Chrome-maximized/Playwright-profile environment issue, owed before this story is truly done.
