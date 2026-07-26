# Story 2.1: Supabase cloud foundation + isolation baseline

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a Supabase prod project with preview branches, an additive-only migration pipeline, a `djs` table 1:1 with `auth.users`, and null-safe per-DJ RLS,
So that all cloud data is per-DJ isolated at the DB layer from the very first row.

## Acceptance Criteria

1. **Given** the Supabase setup, **When** a dev/PR branch is created, **Then** it gets its own preview branch and prod is a separate project. *(AR-12)*
2. **Given** a schema change, **When** shipped, **Then** it is an additive-only Supabase-CLI migration committed in the monorepo; a drop/rename of a live column is rejected. *(AR-12)*
3. **Given** a `djs` row, **Then** it is 1:1 with `auth.users`, created idempotently on verified email, **And** RLS enforces `auth.uid() IS NOT NULL AND auth.uid() = dj_id` (unreachable across DJs even with an API-layer bug). *(AR-4, AR-10, NFR-2)*
4. **Given** the account model, **Then** it anticipates an additive `subscription_status` concept for Epic 7 (no billing logic added yet). *(Epic 2 design note b)*

### Scope boundaries (binding — read before writing code)

- **This is the first story that creates a *real* Supabase schema.** Story 1.1 seeded `supabase/migrations/20260721180917_init.sql` as an intentional no-op proving the additive-only migration tree applies cleanly in CI — no table exists yet. This story adds the first real one (`djs`) plus the guard that keeps every future migration additive-only.
- **In scope:** the `djs` table migration, its idempotent-creation trigger, its RLS policy, a local pgTAP test suite proving both, an additive-only CI guard over `supabase/migrations/*.sql`, and a written runbook for the actual cloud provisioning (AC-1). **Not in scope:** any auth UI, any OAuth/passkey/phone wiring (Stories 2.3a/2.3b/2.3c), any `sessions`/`sets`/`plays` schema (Story 3.1), any billing columns (Epic 7 — AC-4 is satisfied by a documented anticipation, not new columns), any `supabase-js` client code in `web/` or `agent/` (no story before 2.10 needs the agent to authenticate, and no web screen exists to call Supabase from yet).
- **AC-1 has a real-world half this story cannot execute unattended.** "Prod is a separate project" and "a dev/PR branch gets its own preview branch" describe a live Supabase organization with billing and a GitHub App connection — an account-level action outside a coding agent's reach (no different in kind from AR-14's code-signing certs, which Epic 2's own cross-cutting notes already treat as parallel procurement, not a coding task). This story's obligation on AC-1 is: (a) confirm the **local** structure Story 1.1 already built (`supabase/config.toml`, `supabase/migrations/`) is what a real project would receive via `supabase link` + `supabase db push`, and (b) write the exact runbook Arjun follows to actually create the prod project and enable branching. Whether the live project exists is Arjun's call, tracked as Open Question #1, not a task this story can mark `[x]` on its own.
- **Do not build any RLS write policy (INSERT/UPDATE/DELETE) on `djs` in this story.** The only writer is the trigger's `SECURITY DEFINER` function; no story before 2.3c needs a DJ-writable column on this table, and AD-19 (Epic 7) later states explicitly that no RLS `UPDATE` policy on `djs` should ever grant a DJ write to it. Landing a permissive write policy now just to "look complete" would have to be walked back — leave it at read-only-via-RLS, write-only-via-trigger.
- **Do not add `stripe_customer_id`/`stripe_subscription_id`/`subscription_status`/`current_period_end` columns now.** AD-19 assigns these to an Epic 7 additive migration. AC-4 ("anticipates... no billing logic added yet") is satisfied by a doc comment on the migration + a Dev Notes pointer, not by pre-creating unused nullable columns six epics early.

## Tasks / Subtasks

- [ ] **Task 1 — `djs` table migration (AC: 3, 4)**
  - Run `supabase migration new create_djs_table` (per `supabase/README.md`'s documented workflow) to generate a correctly-timestamped file in `supabase/migrations/`.
  - Schema: `public.djs (id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now())`. `id` **is** the DJ's identity — equal to `auth.uid()` for that DJ — and is what every future table's `dj_id` foreign key will reference (`sessions.dj_id references public.djs(id)`, etc., built in Story 3.1). Do not name this column `dj_id` inside `djs` itself; `id`/`auth.users(id)`-mirroring is the standard Supabase convention and keeps the FK direction unambiguous.
  - `on delete cascade`: if an `auth.users` row is ever removed via Supabase's admin API, the orphaned `djs` row goes with it. This does not replace Story 2.11's manual deletion runbook (which cascades deletes across `sessions`/`sets`/`plays`/overlays — tables that reference `djs.id`, not `auth.users.id` directly); it's a structural safety net one level up.
  - Add a migration-file comment noting AD-19: `subscription_status` + 3 sibling billing columns arrive later as an **additive** migration in Epic 7 — this table's shape does not need to change to accommodate them, only grow.

- [ ] **Task 2 — Idempotent-creation trigger (AC: 3)**
  - Standard Supabase pattern: a `SECURITY DEFINER` function + an `AFTER INSERT ON auth.users` trigger.
    ```sql
    create function public.handle_new_dj()
    returns trigger
    language plpgsql
    security definer
    set search_path = ''
    as $$
    begin
      insert into public.djs (id) values (new.id)
      on conflict (id) do nothing;
      return new;
    end;
    $$;

    create trigger on_auth_user_created
      after insert on auth.users
      for each row execute procedure public.handle_new_dj();
    ```
  - `set search_path = ''` is deliberate (Supabase's documented hardening for `SECURITY DEFINER` functions touching `auth.users` — prevents search-path hijacking); use fully-qualified `public.djs` inside the function body, as shown.
  - Fires unconditionally on every `auth.users` insert (not gated on `email_confirmed_at`) — idempotency is `ON CONFLICT (id) DO NOTHING` on the primary key, which is all this story needs. **Do not** try to reimplement "same verified email → one account" identity-linking here: that is Supabase Auth's own cross-provider linking behavior, configured in Story 2.3b, not a Postgres trigger concern. See Open Question #2.

- [ ] **Task 3 — Null-safe RLS (AC: 3)**
  - `alter table public.djs enable row level security;`
  - One policy only: `create policy "djs_select_own" on public.djs for select using (auth.uid() is not null and auth.uid() = id);` — the exact null-safe predicate AC-3 and AD-7 specify verbatim. The `auth.uid() is not null` half matters independently of the equality check: without it, an unauthenticated request where `auth.uid()` evaluates `null` could otherwise match a row that itself has `id = null`, which can't happen here (PK, not-null) but is the null-safety discipline AD-7 names explicitly — apply it as written, don't simplify to bare `auth.uid() = id`.
  - No `for insert`/`for update`/`for delete` policy — see Scope boundaries. RLS enabled + zero write policies means every role except the trigger's elevated `SECURITY DEFINER` context is read-only-or-nothing on this table by construction.

- [ ] **Task 4 — pgTAP tests proving Tasks 1-3 (AC: 3)**
  - New test file(s) under `supabase/tests/` (Supabase CLI's `supabase test db` convention — **verify the current CLI's expected directory/invocation at implementation time**, e.g. `supabase test db --help` or the CLI's local-development-testing docs; this is the same class of "conventions shift version to version, confirm before assuming" caveat the Architecture Spine already flags for the `service_role`/`sb_secret_…` key-naming migration).
  - Cases to cover:
    1. Inserting a row into `auth.users` produces exactly one matching `public.djs` row with the same `id`.
    2. Re-inserting/upserting the same `auth.users.id` never produces a second `djs` row (idempotency).
    3. As an authenticated role with `auth.uid()` set to DJ A's id, `select * from public.djs` returns only DJ A's row — DJ B's row (also seeded in the test) is unreachable.
    4. As `anon`/no JWT (`auth.uid()` null), `select * from public.djs` returns zero rows.
  - Wire `supabase test db` (or the verified equivalent) into the existing `supabase` job in `.github/workflows/ci.yml`, after the current `supabase migration up` step.

- [ ] **Task 5 — Additive-only CI guard over migration files (AC: 2)**
  - `supabase/README.md` already states the additive-only rule as team convention; this task makes it CI-enforced, the way Story 1.10 made the sync contract's additive-only rule CI-enforced (`shared/src/additive-only.test.ts`) rather than convention-only.
  - Because Supabase migrations are individually-immutable, append-only files (unlike the sync contract's one evolving type file), the simplest correct guard is a **static scan of migration SQL text**, not a schema-state diff: grep every file in `supabase/migrations/*.sql` for forbidden DDL — case-insensitive `DROP COLUMN`, `DROP TABLE` (without an explicit escape comment), `RENAME COLUMN`, `RENAME TO`, `ALTER COLUMN ... TYPE` — and fail if found. A new migration file is scanned once, permanently; there is no baseline file to keep in sync, unlike Story 1.10's frozen-schema-snapshot approach (that pattern doesn't fit here — it would need updating every time a legitimate new column lands, which defeats the point).
  - Implement as `supabase/scripts/check-additive-only-migrations.sh` (or equivalent), wired as a new step in the `supabase` CI job. Allow a rare, deliberate exception via an explicit inline marker (e.g. a `-- additive-only: allow` comment on the offending line) rather than an unconditional hard-fail, so a genuinely-approved exception (there isn't one today) doesn't require disabling the whole guard.
  - This story's own `create_djs_table` migration (Task 1) must pass the guard cleanly — it's pure `CREATE`, no forbidden verbs.

- [ ] **Task 6 — Cloud provisioning runbook (AC: 1)**
  - New `supabase/PROVISIONING.md` (or a new section in `supabase/README.md` — dev's call), documenting the manual steps to stand up the real infrastructure AC-1 describes:
    1. Create a Supabase organization/prod project (requires a Supabase account + billing — the paid tier is what the Architecture Spine's deployment table assumes for PITR backups).
    2. Connect the GitHub repo via Supabase's GitHub integration and enable branching, so every PR against `main` gets its own ephemeral preview database seeded from the same `supabase/migrations/`.
    3. `supabase link --project-ref <prod-ref>` locally, then `supabase db push` to apply the committed migrations (including this story's `djs` migration) to the real prod project for the first time.
    4. Record which CI secrets this unlocks for later stories (e.g. `SUPABASE_ACCESS_TOKEN`, a project ref) without adding them to CI now — no story before this one's cloud project exists needs them, and the current `supabase` CI job intentionally runs against an ephemeral local Postgres only (`.github/workflows/ci.yml`'s existing `supabase start` step), not the real project.
  - This task's completion bar is **the runbook being written and accurate**, not the cloud project existing — see Scope boundaries and Open Question #1.

- [ ] **Task 7 — Gate + housekeeping (AC: all)**
  - Run the full gate: `supabase start` / `supabase migration up` (clean apply, unchanged from today) + Task 4's `supabase test db` + Task 5's additive-only script, all locally before pushing. Also the repo-root JS gate (`pnpm lint && pnpm typecheck && pnpm build && pnpm test`) — unaffected by this story but must stay green since `.github/workflows/ci.yml`'s `js`/`agent`/`supabase` jobs are independent and this story only touches the `supabase` one.
  - Update `deferred-work.md` if Task 4's CLI-convention verification (Task 4) or Task 6's provisioning uncover anything that should be logged rather than guessed at.

## Dev Notes

### Why `djs` is the only table this story creates

Story 3.1 (`sessions`/`sets`/`plays` + visibility/overlay split) is a separate, later story — deliberately. This story's job is narrower: prove per-DJ isolation works **at the database layer, from the very first row**, before any content schema exists to isolate. `djs` is that first row. Building `sessions`/`sets`/`plays` here would also be premature: those tables' `dj_id` FK needs `public.djs(id)` to already exist, so the dependency only runs one direction.

### `dj_id = auth.uid()` — reading AR-4/AD-7's isolation rule correctly

The Consistency Conventions table (ARCHITECTURE-SPINE.md) states `dj_id = auth.uid()`. In `djs` itself, the column holding that value is named `id` (Task 1's rationale). AC-3's literal phrase "`auth.uid() = dj_id`" describes the **general isolation predicate** every DJ-owned table will carry — in `sessions`/`sets`/`plays` (Story 3.1+) the column really will be named `dj_id`, referencing `djs.id`; in `djs` itself, the column being isolated on is the table's own PK. Task 3's policy (`auth.uid() = id`) is the correct instantiation of the same rule for this one table, not a deviation from it.

### Established idioms to follow (from Epic 1 + Story 1.10)

- **Null-safety is written out, never assumed.** `auth.uid() IS NOT NULL AND auth.uid() = id`, not just `auth.uid() = id` — mirrors AD-7's own phrasing verbatim and Epic 1's "never a guess, never silently defaulted" discipline (AD-11) applied to the DB layer instead of the parser.
- **CI-enforced invariants over doc-only convention**, once the artifact they protect exists. Story 1.10 built `additive-only.test.ts` the moment the sync contract froze; this story builds the migration-scan guard the moment the first real migration lands, for the same reason — a rule that only lives in a README is a rule a future PR can violate by accident.
- **Flag what can't be verified from this machine rather than guessing.** Story 1.10's `agent_version` "last N" was left an explicit unset policy; this story's pgTAP CLI invocation and the real cloud provisioning (Tasks 4, 6) get the same treatment — documented, not faked.

### Git intelligence

Recent per-story shape (Stories 1.6-1.10): context-engineer commit → implement commit → code-review commit (often with a patch round) → merge via PR, one story per branch. This is the first Epic 2 story and the first to touch `supabase/` beyond Story 1.1's no-op — expect the diff to land entirely under `supabase/` + `.github/workflows/ci.yml`, with no changes to `agent/`, `web/`, or `shared/` (no consumer of this table exists yet in either tier).

### Project Structure Notes

- **New:** `supabase/migrations/<timestamp>_create_djs_table.sql`, `supabase/tests/**` (pgTAP), `supabase/scripts/check-additive-only-migrations.sh`, `supabase/PROVISIONING.md` (or a README section).
- **Modified:** `supabase/README.md` (document the new table + the additive-only guard + link to the provisioning runbook), `.github/workflows/ci.yml` (`supabase` job gains the pgTAP-test and additive-only-scan steps), `_bmad-output/implementation-artifacts/sprint-status.yaml`.
- **Untouched (expected):** `agent/**`, `web/**`, `shared/**` — no consumer of `djs` exists in either tier yet; the `js` and `agent` CI jobs are unaffected.

### References

- [epics.md — Story 2.1, Epic 2 overview + design notes (a)(b), FR-29, AR-3/AR-4/AR-10/AR-11/AR-12/AR-14](../planning-artifacts/epics.md)
- [ARCHITECTURE-SPINE.md — AD-7 (null-safe per-DJ RLS), AD-8 (all mutation through Supabase+RLS), AD-10 (one account across providers, idempotent on verified email), AD-12/AD-14/AD-15 (additive-only migrations, enforcement arm), AD-19 (future billing columns, "no RLS UPDATE grants a DJ write" precedent), Consistency Conventions table (`dj_id = auth.uid()`), Deployment & environments (prod project + preview branches, PITR)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [SOLUTION-DESIGN.md §4 (data model narrative), §5 (security & privacy posture — RLS is enforced in the DB, not the app), §7 (environments: dedicated prod project + preview branches, additive-only CLI migrations)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md)
- [supabase/README.md — existing additive-only convention (doc-only today; Task 5 makes it CI-enforced), migration-creation workflow (`supabase migration new`)](../../supabase/README.md)
- [supabase/migrations/20260721180917_init.sql — Story 1.1's no-op seed; this story's migration is the first real one after it](../../supabase/migrations/20260721180917_init.sql)
- [.github/workflows/ci.yml — existing `supabase` job (`supabase start` + `supabase migration up` against ephemeral local Postgres); Tasks 4/5 extend it](../../.github/workflows/ci.yml)
- [1-10-freeze-the-shared-sync-contract.md — previous story; explicitly notes "no Supabase project exists yet — Epic 2 Story 2.1 is first" and established the CI-enforced-invariant pattern this story reuses](./1-10-freeze-the-shared-sync-contract.md)

## Open Questions / Assumptions

1. **[OPS — recommended default given] The real Supabase prod project + GitHub branching connection is an account-level action outside this story's (or any coding agent's) reach.** Task 6 delivers a written runbook; whether Arjun has already created the project, wants to do it now, or defers it is his call, not this story's. Recommended default: mark this story `done` once the runbook is accurate and everything code-side (Tasks 1-5) is gate-green, without waiting on the live project — mirrors how Epic 2's own design notes treat AR-14 code-signing procurement as parallel, not blocking. Whoever builds the first thing that actually needs a live cloud connection (likely Story 2.10, agent token storage, or Story 3.2, sync) is the natural forcing function if the runbook hasn't been run by then.
2. **[DESIGN — recommended default given] The `handle_new_dj` trigger fires on every `auth.users` insert unconditionally, not gated on `email_confirmed_at`.** "Idempotent on verified email" (AC-3) is read as: no duplicate `djs` row per `auth.users.id` (guaranteed by `ON CONFLICT DO NOTHING`), while "same verified email across providers → one account" is Supabase Auth's own identity-linking behavior, configured in Story 2.3b. Proceed with this reading unless Arjun intends this story to also configure Auth-level linking rules.
3. **[OPS] pgTAP / `supabase test db`'s exact CLI invocation and directory convention should be confirmed against the installed CLI version at implementation time** rather than assumed from this story's description — flagged, not guessed at, per Task 4.

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Change Log

| Date | Change |
|---|---|
| 2026-07-25 | Story 2.1 context-engineered (Supabase cloud foundation + isolation baseline): scoped to the `djs` table + idempotent-creation trigger + null-safe RLS + a CI-enforced additive-only migration guard (static SQL scan, not a schema-diff baseline) + a written cloud-provisioning runbook. Flags the real Supabase prod-project/preview-branch creation as an account-level action outside this story's reach (Open Question #1, mirrors AR-14 code-signing procurement precedent). No `sessions`/`sets`/`plays` schema (Story 3.1), no billing columns (Epic 7 — AC-4 satisfied by documentation only), no `supabase-js` client code in `agent/`/`web/` yet. Status → ready-for-dev. |
