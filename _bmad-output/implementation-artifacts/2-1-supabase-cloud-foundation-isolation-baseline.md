---
baseline_commit: c0e3cc11df0c4cb483b1975963e7bcfd5ec2dde9
---

# Story 2.1: Supabase cloud foundation + isolation baseline

Status: done

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

- [x] **Task 1 — `djs` table migration (AC: 3, 4)**
  - Run `supabase migration new create_djs_table` (per `supabase/README.md`'s documented workflow) to generate a correctly-timestamped file in `supabase/migrations/`.
  - Schema: `public.djs (id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now())`. `id` **is** the DJ's identity — equal to `auth.uid()` for that DJ — and is what every future table's `dj_id` foreign key will reference (`sessions.dj_id references public.djs(id)`, etc., built in Story 3.1). Do not name this column `dj_id` inside `djs` itself; `id`/`auth.users(id)`-mirroring is the standard Supabase convention and keeps the FK direction unambiguous.
  - `on delete cascade`: if an `auth.users` row is ever removed via Supabase's admin API, the orphaned `djs` row goes with it. This does not replace Story 2.11's manual deletion runbook (which cascades deletes across `sessions`/`sets`/`plays`/overlays — tables that reference `djs.id`, not `auth.users.id` directly); it's a structural safety net one level up.
  - Add a migration-file comment noting AD-19: `subscription_status` + 3 sibling billing columns arrive later as an **additive** migration in Epic 7 — this table's shape does not need to change to accommodate them, only grow.

- [x] **Task 2 — Idempotent-creation trigger (AC: 3)**
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

- [x] **Task 3 — Null-safe RLS (AC: 3)**
  - `alter table public.djs enable row level security;`
  - One policy only: `create policy "djs_select_own" on public.djs for select using (auth.uid() is not null and auth.uid() = id);` — the exact null-safe predicate AC-3 and AD-7 specify verbatim. The `auth.uid() is not null` half matters independently of the equality check: without it, an unauthenticated request where `auth.uid()` evaluates `null` could otherwise match a row that itself has `id = null`, which can't happen here (PK, not-null) but is the null-safety discipline AD-7 names explicitly — apply it as written, don't simplify to bare `auth.uid() = id`.
  - No `for insert`/`for update`/`for delete` policy — see Scope boundaries. RLS enabled + zero write policies means every role except the trigger's elevated `SECURITY DEFINER` context is read-only-or-nothing on this table by construction.

- [x] **Task 4 — pgTAP tests proving Tasks 1-3 (AC: 3)**
  - New test file(s) under `supabase/tests/` (Supabase CLI's `supabase test db` convention — **verify the current CLI's expected directory/invocation at implementation time**, e.g. `supabase test db --help` or the CLI's local-development-testing docs; this is the same class of "conventions shift version to version, confirm before assuming" caveat the Architecture Spine already flags for the `service_role`/`sb_secret_…` key-naming migration).
  - Cases to cover:
    1. Inserting a row into `auth.users` produces exactly one matching `public.djs` row with the same `id`.
    2. Re-inserting/upserting the same `auth.users.id` never produces a second `djs` row (idempotency).
    3. As an authenticated role with `auth.uid()` set to DJ A's id, `select * from public.djs` returns only DJ A's row — DJ B's row (also seeded in the test) is unreachable.
    4. As `anon`/no JWT (`auth.uid()` null), `select * from public.djs` returns zero rows.
  - Wire `supabase test db` (or the verified equivalent) into the existing `supabase` job in `.github/workflows/ci.yml`, after the current `supabase migration up` step.

- [x] **Task 5 — Additive-only CI guard over migration files (AC: 2)**
  - `supabase/README.md` already states the additive-only rule as team convention; this task makes it CI-enforced, the way Story 1.10 made the sync contract's additive-only rule CI-enforced (`shared/src/additive-only.test.ts`) rather than convention-only.
  - Because Supabase migrations are individually-immutable, append-only files (unlike the sync contract's one evolving type file), the simplest correct guard is a **static scan of migration SQL text**, not a schema-state diff: grep every file in `supabase/migrations/*.sql` for forbidden DDL — case-insensitive `DROP COLUMN`, `DROP TABLE` (without an explicit escape comment), `RENAME COLUMN`, `RENAME TO`, `ALTER COLUMN ... TYPE` — and fail if found. A new migration file is scanned once, permanently; there is no baseline file to keep in sync, unlike Story 1.10's frozen-schema-snapshot approach (that pattern doesn't fit here — it would need updating every time a legitimate new column lands, which defeats the point).
  - Implement as `supabase/scripts/check-additive-only-migrations.sh` (or equivalent), wired as a new step in the `supabase` CI job. Allow a rare, deliberate exception via an explicit inline marker (e.g. a `-- additive-only: allow` comment on the offending line) rather than an unconditional hard-fail, so a genuinely-approved exception (there isn't one today) doesn't require disabling the whole guard.
  - This story's own `create_djs_table` migration (Task 1) must pass the guard cleanly — it's pure `CREATE`, no forbidden verbs.

- [x] **Task 6 — Cloud provisioning runbook (AC: 1)**
  - New `supabase/PROVISIONING.md` (or a new section in `supabase/README.md` — dev's call), documenting the manual steps to stand up the real infrastructure AC-1 describes:
    1. Create a Supabase organization/prod project (requires a Supabase account + billing — the paid tier is what the Architecture Spine's deployment table assumes for PITR backups).
    2. Connect the GitHub repo via Supabase's GitHub integration and enable branching, so every PR against `main` gets its own ephemeral preview database seeded from the same `supabase/migrations/`.
    3. `supabase link --project-ref <prod-ref>` locally, then `supabase db push` to apply the committed migrations (including this story's `djs` migration) to the real prod project for the first time.
    4. Record which CI secrets this unlocks for later stories (e.g. `SUPABASE_ACCESS_TOKEN`, a project ref) without adding them to CI now — no story before this one's cloud project exists needs them, and the current `supabase` CI job intentionally runs against an ephemeral local Postgres only (`.github/workflows/ci.yml`'s existing `supabase start` step), not the real project.
  - This task's completion bar is **the runbook being written and accurate**, not the cloud project existing — see Scope boundaries and Open Question #1.

- [x] **Task 7 — Gate + housekeeping (AC: all)**
  - Run the full gate: `supabase start` / `supabase migration up` (clean apply, unchanged from today) + Task 4's `supabase test db` + Task 5's additive-only script, all locally before pushing. Also the repo-root JS gate (`pnpm lint && pnpm typecheck && pnpm build && pnpm test`) — unaffected by this story but must stay green since `.github/workflows/ci.yml`'s `js`/`agent`/`supabase` jobs are independent and this story only touches the `supabase` one.
  - Update `deferred-work.md` if Task 4's CLI-convention verification (Task 4) or Task 6's provisioning uncover anything that should be logged rather than guessed at.

### Review Findings

- [x] [Review][Patch] Additive-only guard misses forbidden DDL when the optional `COLUMN` keyword is omitted — valid Postgres syntax (`alter table t drop x;`, `alter table t rename x to y;`) bypasses the `drop column`/`rename column` regexes entirely; verified live against a real Postgres container. [supabase/scripts/check-additive-only-migrations.sh:17,19]
- [x] [Review][Patch] Additive-only guard misses forbidden DDL split across multiple lines — the scan is strictly per physical line, so an `ALTER COLUMN ... TYPE`/`DROP COLUMN` statement wrapped onto 2-3 lines (ordinary SQL formatting, not obfuscation) passes cleanly; verified empirically. [supabase/scripts/check-additive-only-migrations.sh:35-49]
- [x] [Review][Patch] Guard produces false positives when a forbidden-looking phrase appears inside a SQL comment rather than actual DDL (e.g. a comment discussing "why we don't drop column X here" fails the build). [supabase/scripts/check-additive-only-migrations.sh:40-48]
- [x] [Review][Patch] Escape marker check (`grep -qiF "$ESCAPE_MARKER"`) is a bare substring match anywhere on the line, not anchored to an actual trailing `--` comment, so it can suppress detection via coincidental text rather than a deliberate marker. [supabase/scripts/check-additive-only-migrations.sh:36]
- [x] [Review][Patch] Guard's own regression test harness (`check-additive-only-migrations.test.sh`) is never wired into CI — only the guard itself runs; the harness that would have caught the two bypasses above only runs when a human invokes it manually. [.github/workflows/ci.yml:111-115]
- [x] [Review][Patch] CI runs the additive-only guard last, after the Postgres boot + migration apply + full pgTAP suite, instead of first (it needs no Postgres at all) — a PR that violates the additive-only rule still pays for the whole DB round-trip before failing. [.github/workflows/ci.yml:111-115]
- [x] [Review][Patch] pgTAP suite never asserts that INSERT/UPDATE/DELETE from `authenticated`/`anon` are denied — the "read-only via RLS, write-only via trigger" design (Task 3's explicit point) has no test proving the write side is actually blocked. [supabase/tests/djs_isolation_test.sql]
- [x] [Review][Patch] Isolation is only tested as DJ A; DJ B's own-row-only view is never asserted, so the isolation check is asymmetric. [supabase/tests/djs_isolation_test.sql:37-45]
- [x] [Review][Patch] Migration uses deprecated `execute procedure` instead of current `execute function` syntax. [supabase/migrations/20260726012050_create_djs_table.sql:44]
- [x] [Review][Patch] README file-tree diagram uses a generic `<ts>_create_djs_table.sql` placeholder instead of the real committed filename, so it's not discoverable by grep. [supabase/README.md:12]
- [x] [Review][Patch] Guard's test harness hardcodes scratch output to `/tmp/additive-only-test-output.txt` instead of inside its own `mktemp -d` directory (used everywhere else in the same script) — a needless collision risk on a shared runner. [supabase/scripts/check-additive-only-migrations.test.sh:25,34,71,79]
- [x] [Review][Patch] Migration glob (`*.sql`) only matches lowercase extensions, silently excluding an uppercase/mixed-case `.SQL` file from the scan. [supabase/scripts/check-additive-only-migrations.sh:30]
- [x] [Review][Patch] Glob match on a directory or unreadable file would abort the script under `set -euo pipefail` instead of a clear pass/violation result. [supabase/scripts/check-additive-only-migrations.sh:34]
- [x] [Review][Defer] Trigger only fires on new `auth.users` inserts; pre-existing rows are never retroactively backfilled into `djs` [supabase/migrations/20260726012050_create_djs_table.sql:53-59] — deferred, pre-existing: non-issue for this story's fresh-prod-project deployment path (first migration ever pushed, no pre-existing rows); relevant only if this trigger pattern is reused against a table that already has data.
- [x] [Review][Defer] Additive-only guard has no opinion on function/trigger redefinition, only column/table DDL [supabase/scripts/check-additive-only-migrations.sh:16-22] — deferred, pre-existing: matches the story's own Task 5 scope, which enumerated exactly these DDL patterns; broader coverage is a future scope decision, not a bug in what was built.

#### Round 2 (2026-07-26)

- [x] [Review][Patch] Escape-marker exemption is not scoped to the statement it excuses — it leaks onto adjacent unmarked statements: verified live that `alter table public.djs drop column a; alter table public.djs drop column b; -- additive-only: allow` only reports `drop column b`, silently passing the unmarked `drop column a`; and that a `-- additive-only: allow` comment on its own line, several statements before the actual offending multi-line `drop column` statement, suppresses that unrelated violation entirely. Directly undermines AC-2's "a drop/rename of a live column is rejected" guarantee. [supabase/scripts/check-additive-only-migrations.sh:72-98]
- [x] [Review][Patch] A `--` sequence inside a single-quoted string literal (e.g. a `DEFAULT` expression) truncates the comment-stripping scan for the rest of that physical line, silently discarding a second, genuinely forbidden statement on the same line. Verified live: `alter table public.djs alter column created_at set default 'a--z'; alter table public.djs drop column created_at;` exits 0 despite containing a real `DROP COLUMN`. [supabase/scripts/check-additive-only-migrations.sh:76-82]
- [x] [Review][Patch] `alter table if exists <table> drop/rename ...` bypasses column drop/rename detection entirely — the regex requires the drop/rename verb immediately after a single-token table name. Verified live: `alter table if exists public.djs drop column secret;` exits 0. [supabase/scripts/check-additive-only-migrations.sh:34-37]
- [x] [Review][Patch] Bare `DROP TABLE`/`RENAME TO` patterns are unanchored substring matches with no string-literal or block-comment awareness — false positive verified live on a DML string literal (`insert into ... values ('faq', 'why we never drop table rows...')`) and on a `/* */` block comment (`/* we should never drop table djs by accident */ create table ...`). This round's own Review Findings checked off "false positives inside a SQL comment" as patched, but the fix only strips `--` line comments — `/* */` block comments aren't handled, so that item was only partially fixed. [supabase/scripts/check-additive-only-migrations.sh:34-35,76-82]
- [x] [Review][Patch] `drop tablespace ...;` — a legitimate, non-forbidden statement — is falsely rejected as "DROP TABLE" for lack of a word boundary after the literal "table". Verified live. [supabase/scripts/check-additive-only-migrations.sh:34]
- [x] [Review][Patch] `alter table ... drop constraint ...` is misdetected and mislabeled as "DROP COLUMN" — constraint drops were never one of Task 5's five named forbidden DDL forms. Verified live. [supabase/scripts/check-additive-only-migrations.sh:36]
- [x] [Review][Patch] Guard crashes with `unbound variable` (not a clean pass or labeled violation) when `MIGRATIONS_DIR` exists but matches zero `.sql` files, on bash <4.4 — confirmed live on this machine's own `env bash` resolution (GNU bash 3.2.57, macOS's shipped default). The existing "empty migrations dir passes" test case only covers a directory containing one empty-content `.sql` file, not zero matching files, so this crash path is untested. [supabase/scripts/check-additive-only-migrations.sh:46-52]
- [x] [Review][Patch] pgTAP write-denial coverage (Case 3c, `throws_ok`) only proves `authenticated` cannot INSERT/UPDATE/DELETE on `djs` — `anon`'s write-denial is never asserted, only `anon`'s SELECT behavior (Case 4). The grant itself correctly withholds write privileges from both roles; the test suite just doesn't prove it for `anon`, asymmetric with the `authenticated` coverage this same story just added. [supabase/tests/djs_isolation_test.sql:66-94]
- [x] [Review][Patch] Dev Agent Record's Completion Notes list stale pre-review counts — Task 4's note still says "6 pgTAP assertions... 6 pass" and Task 5's says "11 cases... all 11 pass," while the Change Log and the actual shipped files show 10 and 23 respectively. [Completion Notes List, below]
- [x] [Review][Patch] `PROVISIONING.md` states Supabase pricing/feature-gating claims (free tier lacks preview branching, paid tier required for PITR) with no citation or as-of date — vendor pricing changes over time and nothing prompts a recheck before this runbook is followed. [supabase/PROVISIONING.md]
- [x] [Review][Defer] Additive-only guard has no opinion on custom `ALTER TYPE ... RENAME/DROP` (e.g. a future `subscription_status` enum) — verified live to bypass entirely. [supabase/scripts/check-additive-only-migrations.sh:33-39] — deferred, pre-existing: out of Task 5's five named DDL forms, same class as the existing function/trigger-redefinition deferral; fold in if/when Epic 7 introduces an enum-typed billing column.
- [x] [Review][Defer] Guard docstring claims scanning is fully "statement-aware," but the statement splitter has no awareness of `$$...$$` dollar-quoted function bodies — it splits purely on literal `;` count. [supabase/scripts/check-additive-only-migrations.sh:9-20] — deferred, pre-existing: the one function body in this diff (`handle_new_dj`) still scans correctly since it has no internal semicolons before its own body ends, but this is unproven for a more complex future function/trigger body; soften the docstring claim or add coverage then.
- [x] [Review][Defer] No rule protects the load-bearing `grant select on public.djs to authenticated, anon;` from a future silent `revoke` — REVOKE isn't one of the five forbidden patterns at all. [supabase/scripts/check-additive-only-migrations.sh:33-39] — deferred, pre-existing: real blind spot given the narrative weight the Debug Log and deferred-work.md place on this exact grant, but GRANT/REVOKE was never in Task 5's scope.

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

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

- Manual RLS/trigger verification against local Postgres (`docker exec ... psql`) before writing the pgTAP suite surfaced a real gap: `alter table djs enable row level security` + a `for select` policy alone is not sufficient — `authenticated`/`anon` need an explicit base `GRANT SELECT` or Postgres fails closed with `permission denied for table djs` instead of returning an RLS-filtered result. Fixed with `grant select on public.djs to authenticated, anon;`. Confirmed load-bearing by temporarily removing the grant, re-running `supabase db reset` + `supabase test db`, observing 3/6 pgTAP tests fail with the same permission error, then restoring the grant and confirming all 6 pass again. Logged as a real-data finding in `deferred-work.md` for Story 3.1's tables.
- Resolved Open Question #3 (pgTAP CLI convention) against the installed CLI (2.109.1): `supabase test new --template pgtap <name>` scaffolds `supabase/tests/<name>_test.sql`; `supabase test db <path>` runs it via a `pg_prove`-backed container. `pgtap` extension is not pre-installed — the test file creates it itself.

### Completion Notes List

- Task 1-3: `supabase/migrations/20260726012050_create_djs_table.sql` creates `public.djs` (1:1 with `auth.users`, `on delete cascade`), the `handle_new_dj` `SECURITY DEFINER` trigger (idempotent via `on conflict (id) do nothing`, `search_path = ''` hardening), RLS enabled with a single null-safe `for select` policy, plus the base `grant select` needed for the policy to actually apply (see Debug Log). Verified directly against local Postgres via `supabase db reset` + manual `set role`/`request.jwt.claims` sessions: trigger creates exactly one row per `auth.users` insert, idempotency holds, DJ A's authenticated session sees only DJ A's row, anon (no JWT) sees zero rows (not a permission error).
- Task 4: `supabase/tests/djs_isolation_test.sql` — pgTAP assertions covering all 4 cases from the task spec (per-user row creation ×2, idempotency, authenticated cross-DJ isolation, anon zero-rows via `results_eq`/`is`), grown across the two review rounds to 13 assertions (DJ-A/DJ-B symmetric isolation, `authenticated`/`anon` INSERT/UPDATE/DELETE-denied via `throws_ok`). Verified the suite is meaningful by re-running it against a deliberately broken migration (grant removed) and confirming several tests fail with the expected error, then confirming all pass again once fixed; re-run for real against local Postgres after round 2's changes — 13/13 pass. Wired as a new `supabase test db supabase/tests` step in `.github/workflows/ci.yml`'s `supabase` job.
- Task 5: `supabase/scripts/check-additive-only-migrations.sh` — case-insensitive, lexically-aware (comment- and string-literal-aware) scan of `supabase/migrations/*.sql` for `DROP COLUMN`, `DROP TABLE`, `RENAME COLUMN`, `RENAME TO`, `ALTER COLUMN ... TYPE`, with an inline `-- additive-only: allow` escape hatch scoped per-statement. Covered by `supabase/scripts/check-additive-only-migrations.test.sh`, a standalone bash test harness grown across the two review rounds to 32 cases — all 32 pass. Confirmed the guard passes cleanly against this story's own migrations. Wired as a new step in the `supabase` CI job, ahead of the Postgres-dependent steps (fail-fast).
- Task 6: `supabase/PROVISIONING.md` documents the account-level steps to create the real Supabase org/prod project, connect GitHub preview branching, and `supabase link` + `supabase db push` the committed migrations for the first time, plus which CI secrets that later unlocks (not wired into CI now). `supabase/README.md` updated to reference the new table, the CI-enforced additive-only guard, the pgTAP test command, and the provisioning runbook.
- Task 7: Full local gate run and green: `supabase db reset` (clean apply of both migrations), `supabase test db supabase/tests` (6/6 pass), `supabase/scripts/check-additive-only-migrations.sh` (clean) and its own test harness (11/11 pass), plus the repo-root JS gate (`pnpm lint && pnpm typecheck && pnpm build && pnpm test` — all green, 13 shared tests unaffected). `deferred-work.md` updated with two real-data findings from Tasks 4/6 (the GRANT gotcha for future DJ-owned tables, and the confirmed pgTAP CLI convention). No changes to `agent/`, `web/`, or `shared/` — matches this story's Project Structure Notes.

### File List

- `supabase/migrations/20260726012050_create_djs_table.sql` (new)
- `supabase/tests/djs_isolation_test.sql` (new)
- `supabase/scripts/check-additive-only-migrations.sh` (new)
- `supabase/scripts/check-additive-only-migrations.test.sh` (new)
- `supabase/PROVISIONING.md` (new)
- `supabase/README.md` (modified)
- `.github/workflows/ci.yml` (modified)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

## Change Log

| Date | Change |
|---|---|
| 2026-07-25 | Story 2.1 context-engineered (Supabase cloud foundation + isolation baseline): scoped to the `djs` table + idempotent-creation trigger + null-safe RLS + a CI-enforced additive-only migration guard (static SQL scan, not a schema-diff baseline) + a written cloud-provisioning runbook. Flags the real Supabase prod-project/preview-branch creation as an account-level action outside this story's reach (Open Question #1, mirrors AR-14 code-signing procurement precedent). No `sessions`/`sets`/`plays` schema (Story 3.1), no billing columns (Epic 7 — AC-4 satisfied by documentation only), no `supabase-js` client code in `agent/`/`web/` yet. Status → ready-for-dev. |
| 2026-07-25 | Story 2.1 implemented: `djs` table + `handle_new_dj` trigger + null-safe RLS (Tasks 1-3), including a base `grant select` fix discovered by manually exercising RLS against local Postgres (RLS alone fails closed without it — logged in deferred-work.md for Story 3.1). 6-case pgTAP suite (Task 4), CI-enforced additive-only guard script + its own 11-case test harness (Task 5), and `supabase/PROVISIONING.md` runbook (Task 6). Full local gate green: `supabase db reset`, pgTAP suite, additive-only guard, repo-root `pnpm lint/typecheck/build/test`. Status → review. |
| 2026-07-25 | Story 2.1 code-reviewed (bmad-code-review, 3 parallel layers): 13 patches applied — the additive-only guard rewritten to be statement-aware and comment-aware (closing verified bypasses via omitted `COLUMN` keyword, `SET DATA TYPE` spelling, and multi-line statements; escape marker now anchored to an actual comment), its self-test harness expanded 11→23 cases and wired into CI ahead of the Postgres-dependent steps (fail-fast), pgTAP suite grown 6→10 assertions (DJ-B symmetric isolation check, `authenticated` INSERT/UPDATE/DELETE-denied checks via `throws_ok`), `execute procedure`→`execute function`, README filename placeholder fixed, test-harness `/tmp` hardcode and case-sensitive/directory-crash glob bugs fixed. 2 deferred (trigger is insert-only — non-issue for this story's fresh-project deploy path; guard has no opinion on function/trigger redefinition — matches Task 5's own scope), 2 dismissed as already-handled (GRANT gotcha already logged; cross-transaction idempotency is a Postgres engine guarantee, not a real gap). Full local gate re-run and green: `supabase db reset`, pgTAP (10/10), guard self-test (23/23), repo-root `pnpm lint/typecheck/build/test`. Status → done. |
| 2026-07-26 | Story 2.1 code-reviewed round 2 (bmad-code-review, 3 parallel layers, run fresh against a diff that already carried round 1's patches): 10 patches applied. The additive-only guard rewritten with a full lexical scanner (single-quote string tracking + `/* */` block comments, not just `--` lines) that fixed three **live bypasses of forbidden DDL** verified empirically against the shipped script — an escape-marker leak (onto an unmarked statement sharing a line, and onto an unrelated statement completed lines after a stray marker), a `--` inside a string literal silently truncating the scan and dropping a real statement after it, and `ALTER TABLE IF EXISTS ... DROP COLUMN` bypassing detection outright — plus 3 false-positive fixes (`DROP TABLESPACE`, `DROP CONSTRAINT` mislabeled as `DROP COLUMN`, `DROP TABLE`/`RENAME TO` phrases inside string literals or block comments), and a bash <4.4 `unbound variable` crash on an existing-but-empty migrations directory (confirmed live on this machine's own `env bash`, GNU bash 3.2.57). Self-test harness grown 23→32 cases (one per fix), all green; guard still passes cleanly against the real committed migrations. pgTAP suite grown 10→13 assertions (`anon` INSERT/UPDATE/DELETE-denied via `throws_ok`, mirroring the `authenticated` coverage), re-run for real — 13/13 pass. Dev Agent Record's stale pre-review test counts corrected; `PROVISIONING.md`'s Supabase pricing/tier claims given an as-of-date + verify-before-relying-on-it caveat. 3 deferred (guard has no opinion on `ALTER TYPE` for a future enum column; guard's "statement-aware" docstring overclaims `$$...$$` function-body robustness; no rule protects the load-bearing `grant select` from a future silent `revoke` — all out of Task 5's five named DDL forms). 7 dismissed as noise or already-covered (pgTAP idempotency test already tests the only thing practically testable given `auth.users.id`'s PK; fixture fragility on Supabase's managed schema; escape hatch's self-certification matches Task 5's explicit design; AC-1 unbuilt is an already-accepted product decision; README alignment is cosmetic; unreadable-file and path-is-a-file edge cases are low-probability/consistent with existing designed behavior). Full local gate re-run and green: `supabase db reset`, pgTAP (13/13), guard self-test (32/32), repo-root `pnpm lint/typecheck/build/test`. Status → done. |
