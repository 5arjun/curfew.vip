---
baseline_commit: 0d9bf793f5bde725fd67df59d73b2f0df13d91f2
---

# Story 5.1: Segments overlay schema

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a cloud-only `segments` overlay table with a fixed type enum, disjoint from content columns,
so that segment overlays never touch agent-written content and stay web-authored.

## Acceptance Criteria

1. **Given** the schema, **Then** `segments` rows are overlay / cloud-only, web-authored, never written back to the agent. *(AR-8)*
2. **Given** segment `type`, **Then** it is the fixed enum {dancefloor, dinner, performance, custom}. *(AR-15)*
3. **Given** a segment, **Then** it references a set without altering that set's content columns. *(AR-8)*

*(Source: `_bmad-output/planning-artifacts/epics.md` — Epic 5: Set Segments & Layer 2 Enrichment, Story 5.1. Traces to PRD FR-14/FR-28, §4.5 "Set Segments".)*

## Scope Boundaries (read before starting)

This story is **schema only**, mirroring Story 3.1's own boundary discipline exactly:

- **No detection algorithm.** Story 5.2's job — this story's table just needs to be able to hold whatever 5.2 eventually writes into it.
- **No editor UI, no draggable dividers, no keyboard interaction.** Story 5.3's job.
- **No segment-scoped stat recomputation.** Story 5.4's job.
- **No `source`/`status`/`confirmed` column.** Every row this story's schema can create is confirmed by construction — nothing writes an unconfirmed row until 5.2 exists. Do not speculate this column now; see Dev Notes "Why no suggested/confirmed state yet."
- **No INSERT/UPDATE/DELETE grant or RLS write policy on `segments`.** Same reasoning Story 3.1 used, and the same state `sets.visibility` is *still* in seven stories later — see Dev Notes "Why no write grants yet."
- **No Layer 2 enrichment columns** (venue/crowd/notes/photos) — Story 5.5's separate table.

## Tasks / Subtasks

- [x] Task 1: Write the migration (AC: #1, #2, #3)
  - [x] 1.1 `supabase migration new create_segments` → `supabase/migrations/<timestamp>_create_segments.sql`
  - [x] 1.2 Create `public.segments` per the exact schema in Dev Notes below (`id`, `set_id`, `dj_id`, `type`, `label`, `first_play_id`, `last_play_id`, `created_at`)
  - [x] 1.3 Enable RLS; add the `dj_id`-owner SELECT policy (AD-7 pattern), named `segments_select_own` to match `sessions_select_own`/`sets_select_own`/`plays_select_own`
  - [x] 1.4 **In the same migration**, explicitly `revoke all on public.segments from anon, authenticated;` before granting SELECT — see Dev Notes "The hosted auto-expose trap" for why this is not optional even though RLS is enabled and no write grant is intended
  - [x] 1.5 `grant select on public.segments to authenticated, anon;`
  - [x] 1.6 Do **not** add any INSERT/UPDATE/DELETE grant or policy in this migration
- [x] Task 2: Extend the generic grant-matrix sweep (AC: #1)
  - [x] 2.1 Add `'segments'` to the two hardcoded 7-table arrays in `supabase/tests/grant_matrix_test.sql` (the `anon`/`authenticated` INSERT-denied sweep at line 30 and the `anon` DELETE-denied sweep at line 39) — the TRUNCATE sweeps and the two catalog-driven generic sweeps at the bottom of the file already cover any new table automatically, but the INSERT/DELETE checks are hardcoded lists and will silently skip `segments` unless added
  - [x] 2.2 Bump `select plan(51)` to `plan(53)` (two new rows land in the now-8-table INSERT and DELETE `unnest` sweeps) and update the file's leading plan-count comment
- [x] Task 3: Verify additive-only + isolation locally (AC: #1, #2, #3)
  - [x] 3.1 `supabase start` then `supabase migration up` — confirm the migration applies cleanly
  - [x] 3.2 `supabase/scripts/check-additive-only-migrations.sh supabase/migrations` — confirm it passes
  - [x] 3.3 Manually insert a `segments` row with `type = 'custom'` and no `label` — confirm the CHECK constraint rejects it; insert one with a `label` — confirm it's accepted
  - [x] 3.4 Manually insert a `segments` row with an out-of-enum `type` — confirm the CHECK constraint rejects it
- [x] Task 4: Write the pgTAP isolation test (AC: #1, #2, #3)
  - [x] 4.1 Create `supabase/tests/segments_isolation_test.sql`, mirroring `supabase/tests/sessions_sets_plays_isolation_test.sql`'s structure (seed two DJs via `auth.users`, seed one `sessions`/`sets`/`plays` row chain per DJ, seed a `segments` row referencing each DJ's own `plays` rows)
  - [x] 4.2 Cover: cross-DJ SELECT isolation both directions; `anon` sees zero `segments` rows; `authenticated` has zero write access (`throws_ok` against `42501` for INSERT/UPDATE/DELETE, matching Case 5's shape in the 3.1 suite)
  - [x] 4.3 Cover negative-path constraint coverage (matching 3.1's Case 1c/1d/1e/1h/1i shape): out-of-enum `type` rejected (`23514`), `type='custom'` with null `label` rejected, a dangling `first_play_id`/`last_play_id` reference rejected (`23503`)
  - [x] 4.4 Cover cascade: deleting the referenced `auth.users` row removes the DJ's `segments` row too (mirrors 3.1's Case 7); deleting the referenced `plays` row removes the `segments` row that pointed at it (proves the `on delete cascade` from Ruling 1 — see Dev Notes)
  - [x] 4.5 `supabase test db supabase/tests` — confirm the full suite (including the updated `grant_matrix_test.sql`) passes
- [x] Task 5: Close the two account-deletion runbook forward-hooks (AC: #1)
  - [x] 5.1 `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` §2 already names this story and states the cascade *should* already be covered by its ruling — confirm that for real against local Postgres (not assumed from the DDL), same discipline Story 3.1 used on itself, and update the note from "should" to "confirmed" once verified
  - [x] 5.2 §3's export query list already has the `segments` line added (`select * from public.segments where dj_id = '<uuid>';`) — no further edit needed, just confirm it's present
- [x] Task 6: Update `supabase/README.md`'s migration tree map (AC: #1)
  - [x] 6.1 Add the new migration filename to the `migrations/` block in the top-of-file tree, matching the existing entry format (`  <filename>  # <one-line> (Story 5.1)`)
  - [x] 6.2 Add `segments_isolation_test.sql` to the `tests/` block the same way

## Dev Notes

### Schema (exact column list)

```sql
create table public.segments (
  id             uuid primary key default gen_random_uuid(),
  set_id         uuid not null references public.sets (id) on delete cascade,
  dj_id          uuid not null references public.djs (id) on delete cascade,
  type           text not null check (type in ('dancefloor', 'dinner', 'performance', 'custom')),
  label          text,
  first_play_id  uuid not null references public.plays (id) on delete cascade,
  last_play_id   uuid not null references public.plays (id) on delete cascade,
  created_at     timestamptz not null default now(),
  check ((type = 'custom' and label is not null) or (type <> 'custom'))
);
```

- **`dj_id` denormalized directly onto `segments`** (not just reachable via `set_id` join), matching AD-7 and the exact pattern `sessions`/`sets`/`plays` already established in Story 3.1 — RLS stays a fast direct-column comparison (`auth.uid() = dj_id`), never a join-based policy.
- **No FK cycle risk:** `set_id`, `first_play_id`, `last_play_id` are three independent FKs (to `sets`, `plays`, `plays` respectively) — nothing here references `segments` itself.

### Why FK-pair boundaries, not timestamp or position columns

`first_play_id`/`last_play_id` reference actual `plays` rows rather than storing a `start_at`/`end_at` timestamp pair or a raw `position` range. Ruling reached in party-mode design session, 2026-08-10 (installed-agent room: Winston/Amelia/Boundary):

- **5.3's own mental model is "point at the first and last track that count"** (2026-08-02 refinement note on Story 5.3) — that is a row reference, not a derived timestamp.
- **5.4's per-segment stat re-aggregation** joins `plays` directly through these two FKs (`where position between (select position from plays where id = first_play_id) and (select position from plays where id = last_play_id)`, or an equivalent join) — no separate boundary representation to keep in sync.
- **5.3's arc-view rendering** derives its timestamp bounds by reading `plays.started_at` off the two joined rows — never store the timestamp redundantly; a stored duplicate could drift from the actual track it's supposed to bracket (same "don't duplicate a derivable value" reasoning Story 1.6 used for keeping `genre_raw` as the sole source of truth over `genre_normalized`).
- **Ties/inclusive-exclusive ambiguity is eliminated by construction** — you are never asking "is this millisecond in or out," you are asking "is this track in or out," a question the product's own domain (a set is a sequence of tracks) already answers unambiguously.
- **`on delete cascade` on both FKs is deliberate**, not a default nobody looked at: if a future format-drift backfill (Story 3.4's territory) ever needs to delete/replace a `plays` row, a `segments` row still pointing at it is meaningless and should die with it rather than silently dangle. `plays` rows are not currently deleted by any shipped story — this is a forward-looking guard, not a response to an observed failure.

### Why no suggested/confirmed state yet

The epic-level summary (`epics.md`, Epic 5 intro) describes segments as "algorithm-suggested, confirmed via drag or keyboard, or added manually" — implying an unconfirmed state can exist. This story's own ACs (1–3, above) say nothing about it, and deliberately so: **do not add a `source`/`status` column speculatively.** Story 1.10's Debug Log is the concrete cautionary precedent in this codebase — a draft contract added Epic-5-shaped fields (`segments`, `visibility`) before the consuming story existed to define their exact shape, and both had to be surgically removed before the sync contract's freeze. The exact shape here (`source enum {suggested, manual}` + a separate `confirmed boolean`, vs. a single collapsed `status enum {suggested, confirmed, manual}`) is a real design fork that only Story 5.2's actual algorithm design can resolve correctly. 5.2 adds it as an **additive-only** migration when it exists to need it — same pattern as `20260803190000_add_play_capture_fields.sql` and `20260731130000_add_play_subgenre.sql`, both bolted on by the story that actually consumed them, never spec'd in advance.

### Why no write grants yet

`segments` ships schema-only: RLS SELECT-own-row policy, **zero** INSERT/UPDATE/DELETE grants — deliberately matching Story 3.1's own precedent, not diverging from it. The naive argument for shipping write grants now is that `sessions`/`sets`/`plays` withheld them because the write path was agent-RPC-shaped and undesigned, while `segments` is DJ-direct-from-browser and RLS-shaped from day one, so "the ambiguity that justified waiting doesn't apply here." That argument was raised and rejected in the 2026-08-10 design session: **`sets.visibility` is the exact same kind of column** — web-authored, DJ-direct, RLS-shaped, no agent in the loop — and it *still* shipped with zero write grants in Story 3.1 and remains ungranted seven stories later. The actual, observed pattern in this codebase is "schema-only until the story that owns the write UX exists," full stop, with no recorded exception. AD-8 confirms web-side mutations belong behind Supabase/PostgREST + RLS (not a custom mutation server), which is the mechanism 5.3 (and 5.2, for algorithm-written suggestions — necessarily cloud-side, since AC-1 forbids the agent ever writing this overlay column per AR-8) will use when it exists. Story 5.3 may also want UPDATE-in-place for a drag-reposition versus DELETE-and-reinsert for a boundary change — an open question this story should not pre-empt by guessing a policy shape.

### The hosted auto-expose trap (read before writing the migration)

**This is the single highest-risk item in this story.** `supabase/migrations/20260807140000_harden_table_and_function_grants.sql` documents a real production incident: the **hosted** Supabase project runs the legacy `auto_expose_new_tables` behavior, which auto-grants the *full* privilege set (`DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`) to **both** `anon` and `authenticated` on every newly created table — silently, regardless of what the migration file itself grants. Local `supabase db reset` does **not** reproduce this (the modern not-auto-exposed default applies locally), so this cannot be caught by running the local pgTAP suite alone; it was only caught by inspecting the hosted project directly and cross-referencing against Supabase's own security advisor.

Every prior table in this codebase shipped intending SELECT-only (or SELECT+narrow-column-UPDATE), but on hosted actually got full CRUD+TRUNCATE until `20260807140000` explicitly `revoke all ... ; grant select ...`'d each one back into line. **`segments` must not repeat this**: Task 1.4 requires the *same* explicit `revoke all on public.segments from anon, authenticated;` before the `grant select` in the *creating* migration itself — do not rely on "I only wrote a GRANT SELECT statement, so that's all it has" being true on the hosted project. RLS being enabled does not save you here either: RLS doesn't filter `TRUNCATE`, and an unintended `INSERT`/`UPDATE`/`DELETE` grant sitting unused by any policy is a landmine for the next migration, not a no-op forever (see `deferred-work.md:71` for the fuller structural gap this project still carries — no generic `relrowsecurity` sweep, no generic non-SELECT-privilege sweep — which is exactly why Task 2 manually extends `grant_matrix_test.sql`'s hardcoded arrays rather than assuming a new table is automatically covered).

### Project Structure Notes

- New migration: `supabase/migrations/<timestamp>_create_segments.sql` (Task 1).
- New test: `supabase/tests/segments_isolation_test.sql` (Task 4).
- Modified: `supabase/tests/grant_matrix_test.sql` (Task 2 — extend two hardcoded arrays, bump plan count).
- Modified: `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` (already updated 2026-08-10 to name this story in both forward-hooks — Task 5 just confirms/closes them for real).
- Modified: `supabase/README.md` (Task 6 — tree map only).
- No `agent/`, `web/`, or `shared/` files touched — pure `supabase/`-only, per this story's own Scope Boundaries (mirrors Story 3.1's own zero-cross-workspace footprint).

### References

- [Source: `_bmad-output/planning-artifacts/epics.md` — Epic 5 intro + Story 5.1, Story 5.2 (dependency), Story 5.3 (dependency, 2026-08-02 refinement note), Story 5.4 (dependency)]
- [Source: `_bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md` §4.5 FR-14/FR-15/FR-28]
- [Source: `_bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md` AD-7 (per-DJ isolation), AD-8 (all cloud mutation via Supabase+RLS, no custom mutation server), AD-16 (session immutable anchor, agent upsert content-only)]
- [Source: `supabase/migrations/20260730204057_create_sessions_sets_plays.sql` — direct structural template: table shape, RLS, GRANT ordering, comment style]
- [Source: `supabase/migrations/20260807140000_harden_table_and_function_grants.sql` — the hosted auto-expose incident this story's Task 1.4 exists to not repeat]
- [Source: `supabase/tests/sessions_sets_plays_isolation_test.sql` — pgTAP structural template]
- [Source: `supabase/tests/grant_matrix_test.sql` — generic grant sweep this story's Task 2 extends; see its own header comment for why it exists]
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:71` — the unfixed structural gap (no generic relrowsecurity/non-SELECT sweep) that makes Task 2's manual extension necessary rather than automatic]
- [Source: `_bmad-output/implementation-artifacts/1-10-freeze-the-shared-sync-contract.md` — the cautionary precedent for not speculating the suggested/confirmed column shape]
- [Source: `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` §2/§3 — the two forward-hooks this story closes]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via bmad-dev-story skill

### Debug Log References

- `supabase migration new create_segments` → generated `20260810153813_create_segments.sql`.
- `supabase start` / `supabase migration up` — migration applied cleanly against local Postgres (Docker), no errors.
- `supabase/scripts/check-additive-only-migrations.sh supabase/migrations` — passed ("All migrations under supabase/migrations are additive-only.").
- Manual constraint verification via `docker exec -i supabase_db_name-pending psql -U postgres` (transaction rolled back, no residue):
  - `type='custom'` with no `label` → rejected, `segments_check` CHECK violation.
  - `type='custom'` with a `label` → accepted, round-tripped unchanged.
  - out-of-enum `type` (`'bogus'`) → rejected, `segments_type_check` CHECK violation.
- `supabase test db supabase/tests` — full suite: `Files=10, Tests=224, Result: PASS` (both before and after the doc-only edits in Task 5/6).

### Completion Notes List

- Implemented `public.segments` exactly per the story's Dev Notes schema: `id`, `set_id`, `dj_id`, `type` (enum CHECK), `label`, `first_play_id`, `last_play_id`, `created_at`, plus the `type='custom' requires label` CHECK. RLS enabled with a single `segments_select_own` SELECT policy (AD-7 direct-column pattern). No INSERT/UPDATE/DELETE grant or policy added, per Scope Boundaries.
- Applied the hosted auto-expose-trap mitigation from Task 1.4/Dev Notes: `revoke all on public.segments from anon, authenticated;` precedes `grant select ...` in the same migration, matching `20260807140000_harden_table_and_function_grants.sql`'s precedent rather than assuming a bare `grant select` is sufficient on hosted.
- Extended `grant_matrix_test.sql`'s two hardcoded 7-table arrays (the `anon`/`authenticated`-adjacent INSERT-denied sweep and the `anon` DELETE-denied sweep) to include `'segments'`, per Task 2.1 — deliberately left the two TRUNCATE arrays unchanged since the file's own catalog-driven generic TRUNCATE sweep already covers any new table automatically. Bumped `plan(51)` → `plan(53)` and corrected the leading comment's arithmetic to reflect that only 2 of the 4 set-wide blocks grew (16 + 14, not 4×8).
- Wrote `segments_isolation_test.sql` (13 pgTAP assertions) mirroring `sessions_sets_plays_isolation_test.sql`'s structure: two-DJ seed chain through segments, CHECK-constraint negative paths (out-of-enum type, custom-without-label) and one positive path (custom-with-label), FK dangling-reference rejection on both `first_play_id` and `last_play_id`, cross-DJ SELECT isolation both directions, `anon` zero-rows, `authenticated` zero write access (INSERT/UPDATE/DELETE all `42501`), and two cascade proofs: deleting `auth.users` removes the DJ's `segments` row, and deleting the referenced `plays` row (via `first_play_id`) independently removes the `segments` row pointing at it.
- **Flagged and corrected a stale premise in the story text itself:** Task 5.2 asserted "§3's export query list already has the `segments` line added — no further edit needed, just confirm it's present." That was false — the actual runbook only had a forward-hook TODO *describing* the line, not the line itself in the executable query block. Added the line for real, removed the now-resolved TODO, and additionally updated several other stale "segments doesn't exist yet" sentences elsewhere in the runbook (top summary, Status line, the deletion-procedure cascade list, References) that the story's task list didn't explicitly call out but were left inconsistent by the same gap. Did not touch anything outside `ACCOUNT-DELETION-EXPORT-RUNBOOK.md`'s existing scope.
- Task 5.1: confirmed the `segments.dj_id ... on delete cascade` + `first_play_id`/`last_play_id ... on delete cascade` chain for real against local Postgres (both via manual SQL and via `segments_isolation_test.sql`'s two Case 7 assertions), and updated the runbook's §2 language from "should already be covered" to "closed, no manual step needed."
- Task 6: added the new migration and test file to `supabase/README.md`'s existing tree map, matching its established entry format. Did not attempt to backfill the tree map's pre-existing gaps for migrations/tests from Stories 3.2 onward — out of this story's scope.
- Full local gate run for real, twice (once after Task 4, once again after the Task 5/6 doc edits): `supabase start` + `supabase migration up` (clean apply), additive-only guard (pass), `supabase test db supabase/tests` (`Files=10, Tests=224, Result: PASS`).

### File List

- `supabase/migrations/20260810153813_create_segments.sql` (new)
- `supabase/tests/segments_isolation_test.sql` (new)
- `supabase/tests/grant_matrix_test.sql` (modified — extended two hardcoded arrays, bumped plan(51)→plan(53), corrected plan-count comment)
- `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` (modified — closed both Story 5.1 forward-hooks for real; corrected a stale premise in §3's export query list; updated related stale "segments doesn't exist yet" text; added the new migration to References)
- `supabase/README.md` (modified — added the new migration and test file to the tree map)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — `5-1-segments-overlay-schema: ready-for-dev` → `in-progress` → `review`)

## Change Log

- 2026-08-10: Implemented `public.segments` overlay table (migration, RLS, hosted auto-expose-trap mitigation), extended `grant_matrix_test.sql`, added `segments_isolation_test.sql` (13 assertions, full suite `Files=10, Tests=224, Result: PASS`), closed both `ACCOUNT-DELETION-EXPORT-RUNBOOK.md` forward-hooks (including correcting a stale "already done" premise in Task 5.2's own text), and updated `supabase/README.md`'s tree map. Status → review.
