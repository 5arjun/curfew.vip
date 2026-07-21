# supabase — schema & migrations

Local-first Supabase project for Curfew. **No cloud account is needed to work in
this repo.** Cloud projects + preview branches (dedicated prod project, per-PR
branches) are an Epic-2 / ops concern — not configured here.

```text
supabase/
  config.toml                       # local project config
  migrations/                       # additive-only, CLI-generated, committed
    20260721180917_init.sql         # no-op seed (Story 1.1)
```

## The one rule: migrations are ADDITIVE-ONLY (AD-15 / AR-12)

This is the **enforcement arm** of the frozen sync contract. Because the agent's
derived payload and the cloud schema must never silently diverge:

- ✅ **Allowed:** add new tables, add new columns (nullable or with a default),
  add indexes, add RLS policies, add functions.
- ❌ **Forbidden:** dropping or renaming a **live** column, changing a column type
  destructively, or any change that breaks the sync contract in `shared/`.

Every schema change ships as a **Supabase-CLI migration file committed in this
folder**. Never hand-edit the database out of band.

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

CI applies these migrations against an ephemeral Postgres to assert a clean apply
(see `.github/workflows/ci.yml`).
