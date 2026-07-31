---
baseline_commit: ddb772221d60de7b49bec63c119bfc5a891ec345
---

# Story 3.1: Sessions/sets/plays schema + visibility + content/overlay split

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want the cloud schema for `sessions`, `sets`, `plays` with a `visibility` column defaulting to private-equivalent and content vs overlay columns kept disjoint,
so that synced content lands cleanly and Phase-2 read-policies never retroactively expose Phase-1 sets.

## Acceptance Criteria

1. **Given** the schema, **Then** `sessions` (immutable anchor), `sets` (with denormalized `derived` jsonb render-cache), and `plays` (with `in_library`, raw + normalized genre, `taxonomy_version`) exist. *(AR-15)*
2. **Given** `visibility`, **Then** it is the enum {public, friends_only, private} **And** Phase-1 sets default to private-equivalent and are never retroactively exposed. *(AR-9)*
3. **Given** content vs overlay columns, **Then** they are disjoint (overlay columns exist but are agent-untouchable). *(AR-8)*
4. **Given** the change, **Then** it ships as an additive-only migration. *(AR-12)*

## Scope Boundaries (read before starting)

This story is **schema only**. Explicitly **not** in scope, even though they're adjacent:

- **No `PUT /sets/:set_id` endpoint, no `session_identity` hash computation, no content-column write grants.** That's all Story 3.2 (Idempotent set sync). This story does **not** grant `authenticated` any `INSERT`/`UPDATE` on `sessions`/`sets`/`plays` — see "Why no write grants yet" below.
- **No `segments` table, no per-track hide, no Layer 2 enrichment columns.** Those are Epic 5's job. The only overlay column this story creates is `visibility` on `sets`.
- **No RLS *read* policies granting cross-DJ access** (public/friends_only visibility actually being readable by other DJs). AD-9 says that's Phase 2. This story's RLS is the same DJ-owns-their-own-row isolation pattern already established for `djs` — nothing more.
- **No `follows` table.** Phase 2 addition per AD-15.

## Tasks / Subtasks

- [x] Task 1: Write the migration (AC: #1, #2, #4)
  - [x] 1.1 Create `supabase/migrations/<timestamp>_create_sessions_sets_plays.sql` via `supabase migration new create_sessions_sets_plays`
  - [x] 1.2 Create `sessions`, `sets`, `plays` tables per the schema in Dev Notes below
  - [x] 1.3 Enable RLS on all three tables; add the null-safe `dj_id`-owner SELECT policy (AD-7 pattern) to each
  - [x] 1.4 Add the explicit `grant select on public.<table> to authenticated, anon;` line for each table — **do not skip this**, see the GRANT gotcha in Dev Notes
  - [x] 1.5 Do **not** add any `INSERT`/`UPDATE`/`DELETE` grant or policy in this migration (see Scope Boundaries)
- [x] Task 2: Verify additive-only + isolation locally (AC: #2, #3, #4)
  - [x] 2.1 `supabase start` then `supabase migration up` — confirm the migration applies cleanly against local Postgres
  - [x] 2.2 `supabase/scripts/check-additive-only-migrations.sh supabase/migrations` — confirm it passes (new `CREATE TABLE` statements are inherently additive, but run it for real, don't assume)
  - [x] 2.3 Manually insert a `sets` row with no `visibility` value supplied and confirm it lands as `'private'`
- [x] Task 3: Write the pgTAP isolation test (AC: #2, #3)
  - [x] 3.1 Create `supabase/tests/sessions_sets_plays_isolation_test.sql`, mirroring `supabase/tests/djs_isolation_test.sql`'s structure exactly (see Dev Notes)
  - [x] 3.2 Cover: cross-DJ SELECT isolation both directions across all three tables; `anon` sees zero rows; `authenticated` has **no** write grant on any of the three tables (`throws_ok` against Postgres error `42501`) — this is the concrete proof for AC-3's "overlay columns exist but are agent-untouchable" (true of every column right now, by design)
  - [x] 3.3 `supabase test db supabase/tests` — confirm the new suite passes alongside the existing `djs_isolation_test.sql`
- [x] Task 4: Close the Story 2.11 forward-hooks (AC: #1)
  - [x] 4.1 Confirm `sessions.dj_id references public.djs(id) on delete cascade` (and `sets`/`plays` cascade transitively through their parent FK) actually cascades a `djs` row deletion through all three new tables — verify for real against local Postgres (insert rows, delete the parent `auth.users` row, confirm all three tables' rows are gone), don't just assume the DDL is correct
  - [x] 4.2 Update `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` §2 (deletion procedure) and §3 (export procedure) to close their two "Forward-hook, TODO for Story 3.1's own dev-story" notes — either confirm cascade already covers deletion (no manual step needed) or add explicit `DELETE ... WHERE dj_id = '<uuid>'` statements per the TODO's own instruction; extend the export query to join the new tables scoped to `dj_id`
  - [x] 4.3 Update `supabase/README.md`'s tree map and `pre-launch-services-checklist.md` row for this item to reflect the closed forward-hook
- [x] Task 5: Update `supabase/README.md`'s migrations list (AC: #4)
  - [x] 5.1 Add the new migration filename to the tree map (matching the existing two-entry list format)

### Review Findings

- [x] [Review][Patch] Add a CHECK enforcing `sets.ended_at >= sets.started_at` [supabase/migrations/20260730204057_create_sessions_sets_plays.sql:40-41] — resolved by decision: Arjun opted to add it now rather than defer or dismiss. Applied; verified via `supabase db reset` + `supabase test db supabase/tests` (48/48 pass) and the additive-only guard.
- [x] [Review][Patch] pgTAP suite has no negative-path coverage proving DB-level constraints actually reject bad data [supabase/tests/sessions_sets_plays_isolation_test.sql] — added cases for an invalid `visibility` value, `public`/`friends_only` round-trip, an omitted `in_library`, a duplicate `(dj_id, session_identity)` / `(set_id, position)`, and a dangling FK on `sets.session_id`/`plays.set_id`. Verified via `supabase test db supabase/tests` (48/48 pass).
- [x] [Review][Patch] Cascade-delete behavior is verified only manually (Dev Agent Record), not encoded as a permanent pgTAP regression assertion [supabase/tests/sessions_sets_plays_isolation_test.sql] — added an automated case: seed a throwaway DJ's full row chain, delete its `auth.users` row, assert all three tables' rows are gone. Verified via `supabase test db supabase/tests` (48/48 pass).
- [x] [Review][Defer] No index on `sets.dj_id` / `plays.dj_id` despite every RLS policy filtering on it [supabase/migrations/20260730204057_create_sessions_sets_plays.sql:38-39,57-58] — deferred, pre-existing
- [x] [Review][Defer] `genre_normalized`/`taxonomy_version` independence not enforced by a CHECK [supabase/migrations/20260730204057_create_sessions_sets_plays.sql:64-66] — deferred, pre-existing
- [x] [Review][Defer] `plays.position`/`camelot_key` have no format/range validation [supabase/migrations/20260730204057_create_sessions_sets_plays.sql:59,67] — deferred, pre-existing
- [x] [Review][Defer] `session_identity` has no non-empty/normalization guard [supabase/migrations/20260730204057_create_sessions_sets_plays.sql:22] — deferred, pre-existing

## Dev Notes

### Why this story exists (one paragraph)

Story 3.2 (Idempotent set sync) needs somewhere to `PUT` a parsed set into. This story lays that schema down now, with the `visibility` column and the content/overlay column split already in place, so that when Phase 2 (social feed, follows, visibility-aware read policies) ships later, it only ever **adds** RLS read-policies and never needs a data migration or a "make old sets private" backfill — Phase 1 sets are already stored private-equivalent from day one (AD-9, AD-15).

### Recommended schema

This is a concrete, ready-to-use design consistent with every constraint below. Adapt column types if you find a better fit, but the **non-negotiables** (marked ⚠️) must hold regardless of exact typing.

```sql
create table public.sessions (
  id                uuid primary key,  -- ⚠️ NO default — agent supplies hash(dj_id, session_identity) in Story 3.2, AD-16
  dj_id             uuid not null references public.djs (id) on delete cascade,
  session_identity  text not null,     -- the intrinsic pre-hash string session.id is derived from; Story 3.2 computes the value, this column just persists it
  created_at        timestamptz not null default now(),
  unique (dj_id, session_identity)
);

create table public.sets (
  id           uuid primary key,  -- ⚠️ NO default — this IS the `set_id`/`external_id` AD-16/AR-2/Story 3.2-AC-1 refer to; do not also add a separate `external_id` column, they're the same value
  session_id   uuid not null references public.sessions (id) on delete cascade,
  dj_id        uuid not null references public.djs (id) on delete cascade,  -- denormalized, see rationale below
  started_at   timestamptz not null,
  ended_at     timestamptz not null,
  derived      jsonb not null default '{}'::jsonb,  -- content column: SyncSetDerived render-cache, agent-written
  visibility   text not null default 'private'       -- overlay column: web-authored, agent-untouchable
               check (visibility in ('public', 'friends_only', 'private')),
  created_at   timestamptz not null default now()
);

create table public.plays (
  id                 uuid primary key default gen_random_uuid(),
  set_id             uuid not null references public.sets (id) on delete cascade,
  dj_id              uuid not null references public.djs (id) on delete cascade,  -- denormalized, see rationale below
  position           int not null,
  title              text,
  artist             text,
  started_at         timestamptz,
  bpm                real,
  genre_raw          text,
  genre_normalized   text,
  taxonomy_version   int,
  camelot_key        text,
  in_library         boolean not null,  -- ⚠️ never nullable — AD-11/consistency table: "never omitted, never guessed"
  created_at         timestamptz not null default now(),
  unique (set_id, position)
);

alter table public.sessions enable row level security;
alter table public.sets enable row level security;
alter table public.plays enable row level security;

grant select on public.sessions to authenticated, anon;
grant select on public.sets to authenticated, anon;
grant select on public.plays to authenticated, anon;

create policy "sessions_select_own" on public.sessions
  for select using (auth.uid() is not null and auth.uid() = dj_id);
create policy "sets_select_own" on public.sets
  for select using (auth.uid() is not null and auth.uid() = dj_id);
create policy "plays_select_own" on public.plays
  for select using (auth.uid() is not null and auth.uid() = dj_id);

-- Deliberately no INSERT/UPDATE/DELETE grant or policy on any of the three
-- tables in this migration. See "Why no write grants yet" below.
```

### Design decisions already made for you (with rationale — don't re-litigate)

- **`visibility` is `text` + `CHECK`, not a native Postgres `CREATE TYPE ... AS ENUM`.** No migration in this repo has ever used a native Postgres enum type. The closest precedent (`djs.subscription_status`, AD-19) is explicitly `text`, "not a restrictive DB enum," specifically because a `CHECK`/text column is trivially extensible under additive-only discipline while a native enum needs `ALTER TYPE ... ADD VALUE`. Match that precedent. [Source: architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md AD-19]
- **`dj_id` is denormalized directly onto `sets` and `plays`**, not just reachable via a join through `sessions`. AD-7 requires isolation to be "a Row-Level Security policy" per DJ-owned table, and every existing RLS policy in this codebase (`djs_select_own`) is a direct-column comparison, never a subquery/join. A join-based RLS policy (`session_id in (select id from sessions where dj_id = auth.uid())`) would work but is slower and diverges from the established pattern for no benefit. `session_id`/`set_id` FKs still carry the "derives from" relationship for the ER shape (AR-15); `dj_id` is there purely for RLS.
  - ⚠️ **Known gap, not this story's to close:** nothing at the DB layer guarantees a `sets.dj_id`/`plays.dj_id` actually matches its parent `session_id`'s `dj_id` — no cross-table `CHECK` can express that in Postgres without a trigger, and adding one here would be scope creep since no writer exists yet. Whoever designs Story 3.2's write path (the `SECURITY DEFINER` function or equivalent) must derive `dj_id` from the parent row it's inserting under, never trust a client-supplied value — flag this explicitly in that story rather than assuming today's schema alone prevents mismatched rows.
- **`sets.id` IS the `set_id`/`external_id`.** `SyncPayload.set.external_id` (frozen in `shared/src/index.ts`) and AD-16/AR-2's `set_id = hash(dj_id, session_identity)` are the same value under two names. Don't create both an `id` and an `external_id` column on `sets`.
- **No `INSERT`/`UPDATE` grant to `authenticated` on any of the three tables in this story ("Why no write grants yet").** AC-3 requires overlay columns to be "agent-untouchable." Right now, by simply not granting any write access at all, **every** column — content and overlay alike — is untouchable by `authenticated`/`anon`, which trivially satisfies AC-3 for this story's scope. Story 3.2 is where the actual write path gets designed, and per AD-19's own stated pattern for scoped writes ("a single Postgres `SECURITY DEFINER` function... never a raw table `UPDATE` from server code"), it's likely Story 3.2 will grant content-column access via a `SECURITY DEFINER` function rather than a raw PostgREST column grant — don't pre-empt that decision here.
- **Genre is three columns (`genre_raw`, `genre_normalized`, `taxonomy_version`), never collapsed into one.** AD-12: "The cloud stores both the raw genre string and the normalized value and a `taxonomy_version` per play, so trends (FR-9) can be recomputed consistently after the table changes." All three should be nullable (a play can have no genre at all — `shared/`'s wire type is `genre: {...} | null`).

### The GRANT gotcha (do not skip this)

From Story 2.1's code review, confirmed against real local Postgres and directly addressed to this story:

> "RLS alone is not enough — `authenticated`/`anon` need an explicit base `GRANT SELECT` or every query on an RLS-enabled table fails closed with 'permission denied,' not an RLS-filtered result... **Whoever builds the next DJ-owned table (Story 3.1's `sessions`/`sets`/`plays`) needs the same explicit `grant select` line** — RLS policies alone will silently fail closed otherwise, and depending on test order/coverage that could read as 'isolation works' when it's actually 'nobody except postgres/service_role can read anything.'"
> [Source: implementation-artifacts/deferred-work.md:191, citing supabase/migrations/20260726012050_create_djs_table.sql]

Every `CREATE TABLE` in this story's migration needs its own `grant select on public.<table> to authenticated, anon;` line, exactly like `20260726012050_create_djs_table.sql:60`. A table created by a migration (running as the `postgres` role) gets no default ACL for `anon`/`authenticated` — only `supabase_admin`-owned relations do.

### Migration file conventions (follow exactly)

- Filename: `supabase migration new create_sessions_sets_plays` → `<UTC timestamp>_create_sessions_sets_plays.sql`.
- Header comment block, matching `20260726012050_create_djs_table.sql:1-11`'s style: `-- Migration: <name>`, `-- Story 3.1 — <title> (AC-...)`, then a short rationale paragraph.
- Per-clause comments explaining *why* (RLS, grants), not just *what* — see both existing migrations for the expected density of explanation.
- **Additive-only is CI-enforced**: `supabase/scripts/check-additive-only-migrations.sh` statically scans for `DROP COLUMN`, `DROP TABLE`, `RENAME COLUMN`, `RENAME TO`, `ALTER COLUMN ... TYPE`. New `CREATE TABLE` statements are inherently additive and will pass — but run the script for real (Task 2.2), don't assume.
- [Source: supabase/README.md, supabase/migrations/20260726012050_create_djs_table.sql, supabase/migrations/20260727192439_add_djs_phone_column.sql]

### Testing standard: pgTAP, mirror `djs_isolation_test.sql` exactly

`supabase/tests/djs_isolation_test.sql` is the established pattern (`begin; ... select plan(N); ... select * from finish(); rollback;`). For the new suite:

- Seed two `auth.users` rows (triggers `handle_new_dj`, gives you two `djs` rows for free).
- Seed one `sessions`/`sets`/`plays` row per DJ via direct `insert` (as the migration-running role, before any `set local role`) — there's no `authenticated` write grant to test against yet, so seed data has to go in as an elevated role, same as `djs_isolation_test.sql` seeds `auth.users` directly.
- `set local role authenticated; set local request.jwt.claims to '{"sub":"<uuid>","role":"authenticated"}';` then `results_eq` to prove DJ A's `select` on each of the three tables returns only DJ A's rows, never DJ B's — both directions (mirror Case 3 / Case 3b).
- `throws_ok(..., '42501'::char(5), ...)` for `insert`/`update`/`delete` on all three tables as `authenticated` — proves no write grant exists yet (mirrors Case 3c). This is the concrete test evidence for AC-3.
- `set local role anon;` then confirm zero rows on all three tables (mirrors Case 4).
- One targeted case: insert a `sets` row omitting `visibility` entirely, confirm it reads back `'private'` (AC-2).
- `reset role; reset request.jwt.claims;` between each role switch, exactly as the existing file does.
- [Source: supabase/tests/djs_isolation_test.sql — read this file directly before writing the new one, don't work from this summary alone]

### Story 2.11 forward-hooks this story must close (Task 4)

Two TODOs were deliberately left in Story 2.11's account-deletion runbook, addressed by name to this story:

> "**Forward-hook, TODO for Story 3.1's own dev-story:** once `sessions`, `sets`, `plays`, `segments`, and any enrichment overlay tables land, this section must gain an explicit deletion step for them. Confirm their actual migration's `ON DELETE CASCADE` behavior back to `djs.id` before assuming step 2 already covers them — if any of those tables are **not** cascade-configured, add explicit `DELETE ... WHERE dj_id = '<uuid>'` statements here instead of assuming."
> "...once `sessions`, `sets`, `plays`, `segments`, and any enrichment overlay tables exist, extend the query above to join those tables scoped to the same `dj_id`, so the export actually covers the DJ's full derived data at that point."
> [Source: supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md §2 step 5, §3]

The recommended schema above cascades correctly (`sessions.dj_id references djs(id) on delete cascade`, `sets`/`plays` cascade transitively through their parent FK), so this should resolve as "cascade already covers it, no manual step needed" — but **verify this for real against local Postgres** (Task 4.1) rather than asserting it from the DDL alone; `segments`/enrichment tables don't exist yet (Epic 5), so the runbook's TODO for those specifically stays open, don't try to close what doesn't exist yet.

### Project Structure Notes

- New file: `supabase/migrations/<timestamp>_create_sessions_sets_plays.sql`
- New file: `supabase/tests/sessions_sets_plays_isolation_test.sql`
- Modified: `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` (close two forward-hooks)
- Modified: `supabase/README.md` (migrations tree map entry)
- Modified: `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` (row 34 — narrow/close the Story 3.1 forward-hook note)
- No `agent/`, `web/`, or `shared/` code changes — this story is `supabase/` only. If you find yourself editing anything outside `supabase/` or the two doc files above, stop and reconsider scope.
- Zero diff expected to `shared/src/index.ts` / `shared/schema/sync-payload.schema.json` — those are frozen (Story 1.10) and this story only needs to be **compatible** with them, never edit them.

### References

- [Source: _bmad-output/planning-artifacts/epics.md:577-588] — Story 3.1's own text and ACs
- [Source: _bmad-output/planning-artifacts/epics.md:82-89] — AR-8, AR-9, AR-12, AR-15 (epics.md's own numbering)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md] — AD-6 (:88-92), AD-7 (:94-98), AD-9 (:106-110), AD-12 (:124-128), AD-15 (:142-146), AD-16 (:148-155), AD-19 (:175-179), Consistency Conventions table (:181-194), Structural Seed ER diagram (:251-262)
- [Source: supabase/migrations/20260726012050_create_djs_table.sql] — the RLS + GRANT + trigger pattern to mirror
- [Source: supabase/migrations/20260727192439_add_djs_phone_column.sql] — the column-scoped grant pattern (for future reference, not used by this story since no write grants are added yet)
- [Source: supabase/tests/djs_isolation_test.sql] — pgTAP test pattern to mirror
- [Source: supabase/README.md] — additive-only rule, migration conventions
- [Source: implementation-artifacts/deferred-work.md:191] — the GRANT SELECT gotcha, addressed by name to this story
- [Source: supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md §2, §3] — the two forward-hooks addressed by name to this story
- [Source: shared/src/index.ts] — frozen `SyncPlay`, `SyncSetDerived`, `SyncPayload`, `VISIBILITY` — the wire shape this schema must be compatible with
- [Source: agent/src-tauri/src/store.rs:35-47, :389-492] — local SQLite schema (`captured_sessions`, `CapturedPlay`, `CapturedGenre`, `CapturedDerived`) already 1:1 with the frozen contract; confirms no translation gap exists between what the agent produces and what this cloud schema needs to accept
- [Source: _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/prd.md:93-110] — Glossary: Session vs Set distinction (not every Session becomes a Set — a real one-to-zero-or-more relationship, not 1:1)
- [Source: _bmad-output/planning-artifacts/epics.md:19-38 (epic-1-review-decisions-2026-07-25.md cross-ref, ai-6)] — Decision A (go-forward-only ingestion): confirmed this adds **no** schema requirement — no historical-import flag needed, "backfill" in this codebase means format-drift re-parse, not historical bulk import

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- `supabase migration new create_sessions_sets_plays` → `20260730204057_create_sessions_sets_plays.sql`
- `supabase start`, `supabase migration up` — migration applied cleanly against local Postgres
- `supabase db reset` — clean rebuild replays all four migrations in order, including the new one
- `supabase/scripts/check-additive-only-migrations.sh supabase/migrations` — "All migrations under supabase/migrations are additive-only."
- `supabase/scripts/check-additive-only-migrations.test.sh` — 32/32 self-tests still pass (script untouched)
- Manual psql: inserted a `sets` row omitting `visibility`, confirmed it reads back `'private'`
- Manual psql: seeded djs/sessions/sets/plays rows for a throwaway DJ, deleted their `auth.users` row, confirmed all four tables' rows were gone (cascade verified for real, not assumed from DDL)
- `supabase test db supabase/tests` — `Files=2, Tests=36, Result: PASS` (17 existing `djs` assertions + 19 new `sessions_sets_plays` assertions), re-run clean after `db reset`

### Completion Notes List

- Migration `20260730204057_create_sessions_sets_plays.sql` creates `sessions`, `sets`, `plays` exactly per the story's recommended schema: `visibility` as `text` + `CHECK` (not a native enum, matching `subscription_status`/AD-19 precedent), `dj_id` denormalized onto `sets`/`plays` for direct-column RLS, `sets.id` doubling as `set_id`/`external_id` (no separate column), genre kept as three nullable columns, `in_library` non-nullable. RLS enabled + `dj_id`-owner SELECT policy + explicit `grant select ... to authenticated, anon` on all three tables. No `INSERT`/`UPDATE`/`DELETE` grant or policy added anywhere in this migration — deliberate, per Scope Boundaries; this alone satisfies AC-3 for this story since no column, content or overlay, is writable yet.
- New pgTAP suite `sessions_sets_plays_isolation_test.sql` (19 assertions) mirrors `djs_isolation_test.sql`'s begin/plan/seed/`set local role`/`reset` structure: visibility-default case (AC-2), cross-DJ `SELECT` isolation in both directions across all three tables (6 `results_eq`), `authenticated` has zero write access on any of the three tables — 9 `throws_ok` against Postgres `42501` (insert/update/delete × sessions/sets/plays), and `anon` sees zero rows on all three tables. Full local suite (both files) re-run green after a clean `supabase db reset`.
- Closed both Story 2.11 forward-hooks in `ACCOUNT-DELETION-EXPORT-RUNBOOK.md`: cascade re-verified for real (not just re-asserted from the DDL) with a full four-table row set, confirmed no manual deletion step is needed since `sessions`/`sets`/`plays` all cascade through `dj_id → djs.id → auth.users.id`; export procedure (§3) extended to one scoped query per table. The runbook's forward-hook language was narrowed to point at Epic 5's `segments`/enrichment tables only (the only genuinely open item left), not re-opened for `sessions`/`sets`/`plays`. `pre-launch-services-checklist.md` row 34 and `supabase/README.md`'s migrations tree map updated to match.
- Zero `agent/`, `web/`, or `shared/` changes, per this story's own scope boundary — confirmed via `git status`/`git diff` before finishing. `shared/src/index.ts` and `shared/schema/sync-payload.schema.json` untouched.

### File List

- `supabase/migrations/20260730204057_create_sessions_sets_plays.sql` (new)
- `supabase/tests/sessions_sets_plays_isolation_test.sql` (new)
- `supabase/ACCOUNT-DELETION-EXPORT-RUNBOOK.md` (modified)
- `supabase/README.md` (modified)
- `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` (modified)
