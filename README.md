# Curfew

**A Serato-first reflection dashboard for DJs.** Curfew reads a DJ's local Serato
library and session history after a set is over — no in-the-moment tagging, no
manual entry — and turns it into a personal dashboard (energy arc, style evolution,
library utilization) plus a privacy-first feed for sharing sets with their scene.

Production app: **[curfew.vip](https://curfew.vip)**

[![CI](https://github.com/5arjun/curfew.vip/actions/workflows/ci.yml/badge.svg)](https://github.com/5arjun/curfew.vip/actions/workflows/ci.yml)

---

## Repository layout

First-party monorepo (no external starter) with three workspaces plus a Supabase
migrations tree:

```text
agent/     # Tauri 2 + Rust — local capture/parse/stat engine. Rust core in agent/src-tauri/, minimal tray frontend.
web/       # Next.js 16 — Vercel-deployed cloud app (SSR/ISR), served at curfew.vip.
shared/    # @curfew/shared — versioned sync-contract TS types + JSON-schema (the agent <-> cloud seam).
supabase/  # config.toml + migrations/ (additive-only).
```

**Dependency rule (invariant):** `agent → shared` and `web → shared`. `agent` and
`web` never depend on each other; both reach the cloud only through the versioned
sync contract in `shared/`.

```text
              ┌───────────┐
              │  shared/  │   sync contract (TS types + JSON-schema)
              └─────┬─────┘
             ┌───────┴───────┐
             ▼               ▼
        ┌────────┐      ┌────────┐
        │ agent/ │      │  web/  │
        │ Tauri  │      │ Next.js│──▶ curfew.vip (Vercel)
        │ + Rust │      └───┬────┘
        └───┬────┘          │
            │                ▼
            └──────────▶ Supabase (Postgres + Auth)
```

## Stack

| Layer | Technology |
|---|---|
| Desktop agent | Tauri 2, Rust (edition 2021) |
| Web app | Next.js 16, TypeScript, Vercel (SSR/ISR) |
| Database & auth | Supabase (Postgres, RLS, GoTrue) |
| Billing | Stripe (restricted API keys, webhook-driven) |
| Monorepo tooling | pnpm workspaces + Turborepo |
| Error monitoring | Sentry (`web/`) |
| CI | GitHub Actions — lint/typecheck/build/test across all workspaces, Rust fmt/clippy/test, and a full local Supabase migration replay + pgTAP suite on every push and PR |

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node | ≥ 22 (pinned via `.nvmrc`) | `nvm use` |
| pnpm | 10+ (pinned via `packageManager`) | `corepack enable pnpm` |
| Rust | stable, edition 2021 | `rustup default stable` (needed for `agent/`) |
| Supabase CLI | 2.x | `brew install supabase/tap/supabase` or [direct binary](https://github.com/supabase/cli/releases) |
| Docker | any recent | required only for the local Supabase Postgres |

> If Rust was installed via Homebrew's keg-only `rustup`, add its proxies to your PATH:
> `export PATH="/opt/homebrew/opt/rustup/bin:$PATH"` (or run `rustup default stable` which also populates `~/.cargo/bin`).

## Bootstrap (from a clean checkout)

```bash
pnpm run bootstrap
```

This runs `pnpm install`, builds all JS/TS workspaces (`shared`, `web`, and the agent
tray frontend) via Turborepo, then builds the Rust core (`cargo build` in
`agent/src-tauri`). A clean checkout should complete with no manual fix-ups.

## Common tasks

```bash
pnpm run build         # build all JS/TS workspaces (turbo)
pnpm run lint          # lint all JS/TS workspaces
pnpm run typecheck     # typecheck all JS/TS workspaces
pnpm run test          # run JS/TS workspace tests

pnpm run build:agent   # cargo build the Rust core
pnpm run fmt:agent     # cargo fmt --check
pnpm run clippy:agent  # cargo clippy -D warnings
pnpm run test:agent    # cargo test (incl. the shared-schema consumption test)
```

## Supabase (local only)

No cloud account is required to work in this repo. The additive-only migrations live
in `supabase/migrations/`. To apply them against a local ephemeral Postgres (Docker):

```bash
supabase start
supabase migration up
```

Schema changes are one-way: columns and tables are only ever added, never dropped or
renamed, so the agent's synced payloads and the cloud schema can never silently
diverge. See [`supabase/README.md`](supabase/README.md) for the full rule.

## Deploying

**Push to `main` is the deploy.** The Vercel GitHub integration builds and promotes
`web/` to production at [curfew.vip](https://curfew.vip) automatically on every push —
there is no separate promote step, and `vercel --prod` / `vercel deploy --prod` must
never be run on top of it (denied in `.claude/settings.json`; running it anyway
uploads the working tree rather than the merged commit and races the real deploy for
production). For changes that deserve a look first, branch and open a PR — the
integration builds a preview URL per branch. Roll back from the Vercel dashboard, not
by force-pushing.

Signed, notarized desktop agent builds (macOS `.dmg`, Windows installer) are produced
by [`release-macos.yml`](.github/workflows/release-macos.yml) and
[`release-windows.yml`](.github/workflows/release-windows.yml) on `agent-v*.*.*` tag
pushes — see [`agent/README.md`](agent/README.md).

## CI

Every push to `main` and every PR runs three gates in parallel:

- **JS/TS** — lint, typecheck, build, and test across `shared`, `web`, and the agent
  tray UI, plus a static check that the tag-triggered release workflows still satisfy
  their own invariants (they don't run on PRs, so this is what catches drift before
  release day).
- **Agent (Rust core)** — `cargo fmt --check`, `cargo clippy -D warnings`, build, and
  test, including a test that parses the shared JSON-schema to prove the agent ↔ cloud
  contract holds from the Rust side.
- **Supabase migration** — a static additive-only guard over every migration file,
  then a full local Postgres replay (`supabase start && supabase migration up`) and
  the pgTAP isolation-test suite, so a migration that doesn't apply cleanly or weakens
  RLS never reaches `main`.

## Per-workspace docs

- [`web/README.md`](web/README.md) — Next.js app, local dev, environment variables.
- [`shared/README.md`](shared/README.md) — the frozen agent ↔ cloud sync contract.
- [`agent/README.md`](agent/README.md) — Tauri + Rust core layout, release builds.
- [`supabase/README.md`](supabase/README.md) — schema, migration discipline, RLS.

## Status

Curfew is in active development ahead of public launch. Core capture, dashboard,
social, and billing functionality are built and under continuous CI; see each
workspace's README for what's shipped versus in flight.

## License

Proprietary — all rights reserved. Not licensed for reuse or redistribution.
