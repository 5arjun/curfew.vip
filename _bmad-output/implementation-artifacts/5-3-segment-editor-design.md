# Story 5.3 — Segment editor (design working doc)

> Living design doc. Captures decisions from the party-mode design session (Arjun, 2026-08-11 — installed-agent room: Winston/Amelia/Sally/Mary/John/Paige, with Boundary walking on uninvited, 6th recorded time) as they lock. Feeds back into `epics.md` §Story 5.3 as the authoritative spec, same pattern `5-2-segment-detection-algorithm-design.md` used for its own story.
>
> **Source inputs already read:** `epics.md` Story 5.3 block + its 2026-08-02 refinement (tracklist-as-primary-mental-model), `5-1-segments-overlay-schema.md` (schema this story writes into; its three deferred items — FK/set consistency, boundary ordering, overlap policy — are this story's to close), `5-2-segment-detection-algorithm.md`/`-design.md` (D-18's `source`/`confirmed` shape this story writes `true` transitions into; D-21's sync-wipe hazard explicitly assigned forward here; D-16's calibration-storage question, closed below as already resolved by 5.2, not owed here after all), `deferred-work.md` (the launch-blocker entry, the ordering/overlap/FK-consistency gaps, the multi-segment rendering gap), current code (`web/app/components/set-detail/{SetDetail,Tracklist,DetailArc,SetHeader}.tsx`, `web/lib/sets/dancefloor.ts`'s `primaryDancefloorSegment`) confirming no drag library and no existing keyboard-slider precedent exist anywhere in the app.
>
> **Status: every decision below is locked. Nothing is left open for Arjun** — the two items this doc's session started with as escalations (D-27's shrink-handling, D-32's schema guard) were ruled by the room after Arjun handed them back; D-37 (touch interaction) was Arjun's own call. This doc is ready for `bmad-create-story` to consume directly.

---

## 0. The dividing line (what 5.3 owns vs. not)

| In 5.3 | Out of 5.3 |
|---|---|
| The sync-wipe fix protecting DJ-authored segments from `sync_set`'s plays delete+reinsert (D-27) | Segment-scoped stat recomputation using the resulting segments — Story 5.4 |
| The write path: RLS grants, column-scoped UPDATE, the ordering/overlap/FK-consistency trigger (D-28, D-29) | Full multi-segment comparison UI — a bare selector is this story's floor, the real comparison view is 5.4's (D-30) |
| The editor UI: tracklist gutter handles, arc mirroring, suggested/confirmed visual states, keyboard a11y, tap-primary/drag-enhancement (D-34–D-37) | Layer 2 enrichment's own form fields (venue/crowd/notes/photos) — Story 5.5, even though it shares this story's Set Detail page as one editing surface |
| A removable DB-level guard restricting writes to `type='dancefloor'` for the MVP (D-32) | Durable per-DJ calibration-profile storage — already resolved by 5.2 as a live runtime computation, never owed here (D-31, correcting a phantom forward-hook) |
| Confirming/adjusting suggestions, adding manual dancefloor boundaries, deleting a segment | Dinner/performance/custom segment types and labels — deferred past this story's MVP (D-33), enum stays in schema for a later story to unlock |

## 1. Locked decisions (Arjun + room, 2026-08-11)

- **D-27 — Sync-wipe fix: capture-and-rebind, not a `plays`-identity redesign.** Inside `sync_set`'s existing transaction, immediately before its `delete from plays where set_id = ...`, resolve every `confirmed = true` or `source = 'manual'` segment's `first_play_id`/`last_play_id` to their current `position`s (independently — see the per-boundary note below). After the reinsert, rebind each boundary to the new `plays.id` at the same `position`. Reuses the exact position-resolution shape 5.2 already built for materializing suggested segments, just run in reverse first. Chosen over a stable-`(set_id, position)`-keyed upsert redesign of `plays` itself: position, not UUID, was always the domain's real boundary identity (5.1's own "track, not millisecond" reasoning), so fixing this at the `segments` write path is the smaller, more targeted lever — a `plays`-identity redesign would touch every other reader of `plays.id` for a guarantee only `segments` needs.
  - **Per-boundary, not per-segment.** A segment's two boundaries can go stale independently — a resync can shrink past `last_play_id`'s position while `first_play_id`'s is still valid (Boundary's finding). Resolve and rebind each boundary on its own, never assume a segment fails or succeeds as a unit.
  - **Shrink-past-range ruling (was escalated, now closed):** if a boundary's captured position no longer exists after reinsert, **clamp to the nearest remaining valid position and `raise warning` server-side; never delete a confirmed/manual row.** Silent to the DJ — a deliberate, accepted tradeoff given how narrow the triggering condition is (requires an actual Serato-history content change, per 3.4's own reason to exist — rare, not exotic, per Mary's sizing), not a gap left for later. Delete-on-failure was rejected outright: destroying a DJ-authored row on resync is the exact D-21 disaster this decision exists to prevent, so it can never be the fallback.
  - **Transactional discipline:** capture, delete, reinsert, and rebind all happen in the same transaction as today's plays replacement — no window where a segment's FK can point at an already-deleted row.

- **D-28 — Write policy: UPDATE-in-place for drag-adjust/confirm/relabel; INSERT for a new manual boundary; DELETE for removing a segment.** Chosen because segment identity must survive an edit for 5.4's future stat-slicing and D-17's future active-learning signal to mean anything — a delete-and-reinsert would mint a new `id` for what the DJ experiences as the same segment. New RLS grants, scoped `dj_id = auth.uid()` (row-level, matching AD-7's direct-column pattern):
  - `grant insert, delete on segments to authenticated` (with matching RLS policies).
  - `grant update (confirmed, type, label, first_play_id, last_play_id) on segments to authenticated` — **column-level grant**, not policy-level. RLS answers "whose row"; this answers "which columns of that row." `set_id`, `dj_id`, `source`, `created_at` stay immutable post-creation — not reachable via UPDATE at all, regardless of row ownership.
  - `source` is never updatable (not even by its owner) — it's provenance, and D-18 already established provenance must survive confirmation.

- **D-29 — Single `before insert or update` trigger on `segments`, closing three deferred gaps at once.** One function, one join to `plays.position`, three checks, in this order:
  1. **Ordering** — `NEW.first_play_id`'s resolved position must be ≤ `NEW.last_play_id`'s.
  2. **FK/set consistency** — both boundary plays must belong to `NEW.set_id` (closes 5.1's and 5.2's deferred "derive, don't trust" item for the one write path a DJ actually controls directly — checked on UPDATE too, not just INSERT, per Boundary's finding that an UPDATE could otherwise repoint a boundary at a different set the same DJ owns).
  3. **No overlap** — no other segment of the **same `type`** in the same `set_id` may share any position range with this row. Deliberately type-scoped, not set-wide: today only `dancefloor` exists so it's a no-op distinction in practice, but it means a future `dinner` segment sitting inside a `dancefloor` range won't trip a rule that was never meant to apply across types.
  - Raises a real `raise exception` with a descriptive message on any violation — not a bare constraint-violation code, since the caller (the web app) needs to distinguish these three failure modes to give useful feedback.

- **D-30 — Multi-segment floor: a bare selector, not full comparison UI.** The instant editing ships, `primaryDancefloorSegment`'s longest-wins silent pick stops being a harmless rendering shortcut and starts being actively misleading — a DJ could edit "the" dancefloor while a second real one sits invisible. Minimum bar for this story: a plain list/chip selector ("Dancefloor 1 · 32 tracks," "Dancefloor 2 · 14 tracks," "+ New") that lets the DJ see how many exist and pick which one is active for editing. Full cross-segment comparison stays 5.4's.

- **D-31 — Calibration-profile storage is already resolved; not owed to this story after all.** 5.2's own design doc (D-16) provisionally flagged durable per-DJ calibration storage as "likely Story 5.3's territory" — but 5.2's shipped change log confirms it landed as a **live runtime computation** against raw history, not a persisted/materialized profile. That question is closed, not inherited. D-17's future active-learning loop (DJ edits reshaping calibration) stays explicitly deferred past this story too — this story's writes simply don't destroy the data that loop would eventually need, which capture-and-rebind (D-27) already guarantees as a side effect.

- **D-32 — MVP-scope DB guard: restrict writes to `type = 'dancefloor'` for now (was escalated, now closed).** A light, removable `before insert` check (or folded into D-29's trigger) rejecting any `type` other than `'dancefloor'`. Closes the gap between the AC narrowing (D-33) and the schema, which still permits the full enum — cheap, blocks nothing legitimate given this story's own scope, and is a one-line deletion the day a later story ships `dinner`/`performance`/custom labels.

- **D-33 — Refinement note owed to `epics.md`, in the 2026-08-02 note's own style: MVP narrows AC #4 to dancefloor-only.** This story's editor lets a DJ create/edit/confirm **dancefloor** segments only. `dinner`/`performance`/custom typing and custom labels are deferred to a later story, not cut from the product — the schema enum already supports them, D-32's guard is what's temporarily narrower than the schema. Recorded explicitly rather than silently narrowed, per John's process-foul precedent (FR-27, the 30-day-nudge flag) that an undocumented scope change is a foul regardless of whether the change itself is good.

- **D-34 — Tracklist gutter-handle interaction model.** A boundary is a handle rendered *between* two tracklist rows, not a selected row — matching Arjun's own "point at the first and last track that count" framing exactly. Bracketed rows get a left-edge rail/accent so the segment's extent reads at a glance without requiring interaction. `DetailArc.tsx`'s existing highlighted band mirrors this state live; the arc is **not** an independent second drag target — one source of truth (the tracklist), one reflection (the arc), avoiding two interaction surfaces fighting over the same value.

- **D-35 — Suggested and confirmed segments get genuinely distinct visual states.** Suggested/unconfirmed: dashed handles, lower-opacity rail, an explicit (calm, non-alarm-styled — copy TBD, flagged for a writing-guidelines pass, not this story's to word) confirm affordance nearby. Confirmed (whether via confirming a suggestion or a fresh manual add): solid handles, full-opacity rail, editable anytime — no visual distinction between the two *sources* once confirmed, since the DJ experiences them identically.

- **D-36 — Keyboard accessibility built fresh, no existing precedent to extend.** Codebase-wide scan found no existing arrow-key/`role="slider"`-shaped widget anywhere (only `Escape`-to-close modal handlers) — this AC is genuinely new interaction infrastructure. Each handle: `role="slider"`-equivalent, real focus ring, arrow keys nudge one track-position at a time, Enter confirms. Critically, `aria-valuenow` alone is insufficient — pair it with **`aria-valuetext` set to the actual track name and timestamp**, plus a live-region announcement on every nudge ("Dancefloor now starts at [Track Name], 12:04am"), so a non-sighted DJ gets the same "point at the track" experience a sighted one gets from the rail.

- **D-37 — Touch interaction: tap-primary, drag-as-enhancement (Arjun's explicit call).** Primary interaction for marking a boundary is **tap-to-mark** — tap the first track that counts, tap the last, done — not drag. This is closer to Arjun's own mental-model framing than dragging ever was, and it simplifies build order rather than complicating it: tap-to-mark ships as plain click handlers with no pointer-drag tracking needed (no drag library exists in this app today), and desktop drag layers on top of the same underlying position-set logic as a later enhancement, never a blocking first version.

## 2. Write-path shape (per confirm/adjust/add action)

```
DJ action in tracklist editor (tap-mark, or drag once shipped)
     │
     ▼
resolves to a position range (first_position, last_position)
     │
     ▼
UPDATE existing segment row                    OR   INSERT new segment row
  (drag-adjust / confirm / type-relabel)             (manual "+" boundary)
  — column-scoped grant (D-28)                       — dj_id/set_id derived, not client-trusted
     │                                                     │
     └───────────────────┬───────────────────────────────┘
                          ▼
        before-insert-or-update trigger (D-29 + D-32)
        ordering · FK/set consistency · no-overlap (same type) · type='dancefloor' guard
                          │
                    pass ──┴── fail → raise exception, surfaced to the editor as
                                       a specific reason (not a generic DB error)
                          ▼
                    row committed
```

```
sync_set (unrelated trigger: any re-sync of this set)
     │
     ▼
capture: resolve confirmed/manual segments' boundaries → positions (D-27)
     │
     ▼
delete + reinsert plays (existing behavior, unchanged)
     │
     ▼
rebind: positions → new plays.id, per boundary independently
  — out-of-range boundary → clamp to nearest + raise warning (D-27)
     │
     ▼
segments survive the resync intact
```

## 3. Section detail

### 3a. Sync-wipe fix (D-27)

- Runs inside `sync_set`, immediately adjacent to the existing suggested-segment materialization step from 5.2 — same function, extended scope, not a new RPC (mirrors AD-23's "widen the existing RPC" precedent rather than the AD-8 "new RPC" template).
- Only `confirmed = true` or `source = 'manual'` rows need capture-and-rebind. `('suggested', false)` rows keep 5.2's existing behavior (explicit delete + full recompute) — no change to that path.
- The per-boundary clamp is a single small helper used for both `first_play_id` and `last_play_id` independently — do not write it as a single "does this segment still fit" check.

### 3b. Write path & RLS (D-28, D-29, D-32)

- Three new grants (INSERT, UPDATE-with-column-list, DELETE), all `dj_id`-scoped via RLS, matching every prior table's AD-7 pattern in this codebase.
- The trigger function should be `security invoker` (default) — it only needs SELECT access to `plays`/`segments` the calling DJ already has via their own RLS policies; no reason to elevate.
- D-32's type guard can be its own tiny check inside the same D-29 trigger function rather than a separate trigger — one function, four checks, one error path per check.

### 3c. Multi-segment selector (D-30)

- Purely additive UI over data that already exists (`set.segments`, already fetched per the current code scan) — no new query shape needed, just stop collapsing to `primaryDancefloorSegment` unconditionally once more than one exists.
- Selecting a segment in the chip list is what makes its handles the active/interactive ones in the tracklist; non-selected segments still render their rail, dimmed, so their existence is never hidden.

### 3d. Editor interaction (D-34–D-37)

- Build order implied by D-37: tap-to-mark (click handlers, position math, no drag library) ships as the real first version; desktop drag is a later, additive enhancement on the same state.
- `DetailArc.tsx` already reads `frame.segment` for its highlighted band (confirmed by code scan) — this story extends what feeds that prop to include the actively-edited segment's live-updating boundaries, but does not add a second interactive surface to the SVG itself.
- Keyboard a11y (D-36) has no existing pattern to copy in this codebase — budget it as new work, not an extension.

### 3e. What this story deliberately does NOT do

- Does not build dinner/performance/custom segment UI or labels (D-33) — schema-ready, product-deferred.
- Does not touch Story 5.5's Layer 2 enrichment fields — shares the Set Detail page as one editing surface, not one component.
- Does not build 5.4's segment-scoped stat recomputation or full multi-segment comparison view — D-30's selector is a navigation/visibility floor only.
- Does not add calibration-profile persistence (D-31) — already closed by 5.2 as unnecessary.

## 4. References

- `_bmad-output/planning-artifacts/epics.md` — Epic 5 intro, Story 5.1 (dependency), Story 5.2 (dependency, D-18/D-21), Story 5.3 (this story's own block + 2026-08-02 refinement, + this session's D-33 note to be added), Story 5.4/5.5 (downstream dependents, scope boundary)
- `_bmad-output/implementation-artifacts/5-1-segments-overlay-schema.md` — schema this story writes into; its three deferred Dev Notes items (FK/set consistency, boundary ordering, overlap policy) are closed by D-29 here
- `_bmad-output/implementation-artifacts/5-2-segment-detection-algorithm.md` + `-design.md` — D-16 (calibration storage, closed by D-31), D-18 (`source`/`confirmed` shape this story writes `true` transitions into), D-21 (the sync-wipe hazard this story's D-27 fixes)
- `_bmad-output/implementation-artifacts/deferred-work.md` — the launch-blocker entry (D-27), the ordering/overlap/FK-consistency entries (D-29), the multi-segment rendering gap (D-30)
- `_bmad-output/party-mode/memories/installed/.memlog.md` — session record, 2026-08-11 entries, for the room dynamics behind these rulings
- Code: `web/app/components/set-detail/{SetDetail,Tracklist,DetailArc,SetHeader}.tsx`, `web/lib/sets/dancefloor.ts` — current UI/read-path this story extends; confirmed no drag library, no keyboard-slider precedent exist yet
