# supabase — schema & migrations

Local-first Supabase project for Curfew. **No cloud account is needed to work in
this repo.** A real prod project + per-PR preview branches are an account-level
step documented in [`PROVISIONING.md`](./PROVISIONING.md) — not configured here.

```text
supabase/
  config.toml                       # local project config
  migrations/                       # additive-only, CLI-generated, committed
    20260721180917_init.sql                        # no-op seed (Story 1.1)
    20260726012050_create_djs_table.sql            # djs table + trigger + RLS (Story 2.1)
    20260730204057_create_sessions_sets_plays.sql  # sessions/sets/plays + visibility + RLS (Story 3.1)
    20260810153813_create_segments.sql             # segments overlay table, select-only RLS (Story 5.1)
  tests/                             # pgTAP suites (`supabase test db`)
    djs_isolation_test.sql
    sessions_sets_plays_isolation_test.sql
    segments_isolation_test.sql
  scripts/
    check-additive-only-migrations.sh    # CI guard, see below
  PROVISIONING.md                    # runbook for the real cloud project
  ACCOUNT-DELETION-EXPORT-RUNBOOK.md # manual deletion/export runbook (Story 2.11)
```

## `djs` — the per-DJ identity table (Story 2.1)

`public.djs` is 1:1 with `auth.users`: a `SECURITY DEFINER` trigger
(`handle_new_dj`) creates a row idempotently on every `auth.users` insert, and
RLS enforces `auth.uid() IS NOT NULL AND auth.uid() = id` — select-only, no
write policy (the trigger is the only writer). Every future DJ-owned table's
`dj_id` foreign key references `djs.id` (starting with `sessions`/`sets`/`plays`
in Story 3.1). See the migration file's comments and Story 2.1's Dev Notes for
the full rationale.

## The one rule: migrations are ADDITIVE-ONLY (AD-15 / AR-12)

This is the **enforcement arm** of the frozen sync contract. Because the agent's
derived payload and the cloud schema must never silently diverge:

- ✅ **Allowed:** add new tables, add new columns (nullable or with a default),
  add indexes, add RLS policies, add functions.
- ❌ **Forbidden:** dropping or renaming a **live** column, changing a column type
  destructively, or any change that breaks the sync contract in `shared/`.

Every schema change ships as a **Supabase-CLI migration file committed in this
folder**. Never hand-edit the database out of band.

This rule is CI-enforced: `scripts/check-additive-only-migrations.sh` statically
scans every file in `migrations/*.sql` for forbidden DDL (`DROP COLUMN`,
`DROP TABLE`, `RENAME COLUMN`, `RENAME TO`, `ALTER COLUMN ... TYPE`) and fails
the build if found. A rare, deliberate exception can be marked with an inline
`-- additive-only: allow` comment on the offending line.

## Creating a migration

```bash
supabase migration new <name>     # -> migrations/<timestamp>_<name>.sql
```

## Applying / verifying locally (Docker required)

```bash
supabase start                    # boots the local Postgres stack
supabase migration up             # applies pending migrations
# or a clean rebuild:
supabase db reset                 # drops local DB and replays every migration
```

## Running the pgTAP tests locally (Docker required)

```bash
supabase test db supabase/tests
```

CI applies these migrations against an ephemeral Postgres, runs the pgTAP
suite, and runs the additive-only guard (see `.github/workflows/ci.yml`).

## Standing up the real cloud project

See [`PROVISIONING.md`](./PROVISIONING.md) for the runbook to create the prod
Supabase project, connect GitHub preview branching, and push these migrations
to it for the first time.
