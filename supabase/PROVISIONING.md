# Cloud provisioning runbook

Story 2.1 (AC-1) requires a real Supabase prod project and per-PR preview
branches. That is a live Supabase organization with billing and a GitHub App
connection — an account-level action outside a coding agent's reach, no
different in kind from AR-14's code-signing certificate procurement (Epic 2's
own design notes already treat that as parallel procurement, not a coding
task). This document is the exact sequence Arjun follows to stand it up.

Nothing in this repo depends on the live project existing yet: `supabase/`
today only targets the ephemeral local Postgres CI boots via `supabase start`
(see `.github/workflows/ci.yml`'s `supabase` job). No `supabase-js` client
exists in `agent/` or `web/` — the first consumer of a real connection
arrives around Story 2.10 (agent token storage) or Story 3.2 (sync). Running
this runbook before then is optional; it does not block any code in this
story.

## 1. Create the Supabase organization + prod project

1. Sign in at [supabase.com](https://supabase.com) (or create an account).
2. Create an organization if one doesn't already exist, and attach a billing
   plan. The **paid tier is required**: it's what the Architecture Spine's
   deployment table assumes for point-in-time-recovery (PITR) backups, and
   the free tier does not support preview branching (step 2). **Pricing and
   plan features change over time — verify current tier gating at
   [supabase.com/pricing](https://supabase.com/pricing) before relying on
   this claim; it reflects what was true as of 2026-07-25.**
3. Create a new project inside that organization. This is the **prod**
   project — a single dedicated project, not shared with any preview branch.
4. Record the project's reference id (visible in the project's Settings →
   General, and in its dashboard URL) — this is `<prod-ref>` below.

## 2. Connect GitHub + enable preview branching

1. In the project's dashboard, go to **Project Settings → Integrations →
   GitHub** and connect this repository through Supabase's GitHub App.
2. Enable **branching** for the project. Once enabled, every pull request
   against `main` gets its own ephemeral preview database, automatically
   seeded by replaying every migration under `supabase/migrations/` — the
   same additive-only tree this repo already commits to.
3. Confirm the integration is scoped to this repo only, and that the branch
   database's connection details surface as PR-scoped values (Supabase
   posts these as a PR comment/check) — no secret handling needed on our
   side for preview branches.

## 3. Push the committed migrations to prod for the first time

Run locally, from the repo root:

```bash
supabase link --project-ref <prod-ref>
supabase db push
```

`supabase link` associates this local checkout with the prod project (it
will prompt for the project's database password, set in step 1.3).
`supabase db push` applies every migration under `supabase/migrations/` —
including this story's `create_djs_table` migration — to the real prod
database for the first time. This is the same additive-only migration set
CI already verifies applies cleanly against an ephemeral Postgres; pushing
to prod does not run anything CI hasn't already exercised.

## 4. CI secrets this unlocks (do not wire up yet)

Once the prod project exists, later stories will need these as GitHub Actions
secrets:

- `SUPABASE_ACCESS_TOKEN` — a personal or CI-scoped access token for
  authenticating `supabase` CLI commands against the real project.
- `SUPABASE_PROJECT_REF` — the `<prod-ref>` from step 1.4.

**Do not add these to CI now.** The current `supabase` CI job intentionally
runs `supabase start` against an ephemeral local Postgres only — it has no
reason to touch the real project, and no story before the one that actually
needs a live cloud connection (Story 2.10 or 3.2, whichever lands first)
should introduce that dependency. Add these secrets and any deploy step in
that later story, not here.

## Completion bar for this runbook

Task 6 of Story 2.1 is done when this document is accurate, not when the
live project exists. Whether Arjun has already run steps 1-3, wants to run
them now, or defers them is his call — tracked as Story 2.1's Open Question
#1. Whoever builds the first thing that actually needs the live connection
is the natural forcing function if this hasn't been run by then.
