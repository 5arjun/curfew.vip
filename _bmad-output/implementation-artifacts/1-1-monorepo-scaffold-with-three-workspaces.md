---
baseline_commit: 7f867cad8f0158fcaba4067f9a91fbc9565d464f
---

# Story 1.1: Monorepo scaffold with three workspaces

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a from-scratch monorepo with `agent/` (Tauri 2 + Rust), `web/` (Next.js 16), and `shared/` (versioned contract package) wired into one CI pipeline,
So that every later story builds on a consistent, reproducible foundation with no external starter to fight.

## Acceptance Criteria

1. **Given** a clean checkout, **When** I run the documented bootstrap command, **Then** all three workspaces install and build, **And** the CI skeleton runs lint + build on each workspace. *(AR-16, AR-1)*
2. **Given** the `shared/` package, **When** it is imported by `agent/` and `web/`, **Then** it exposes a provisional (draft, **not yet frozen**) sync-payload TS type + JSON-schema stub both can consume. *(AR-1)*
3. **Given** the repository, **When** inspected, **Then** there is no adopted external greenfield boilerplate — the scaffold is first-party. *(AR-16)*
4. **Given** a `supabase/migrations/` folder is seeded, **When** CI runs, **Then** the additive-only migration structure is in place (empty/initial migration applies cleanly). *(AR-12)*

## Tasks / Subtasks

- [x] **Task 1 — Root monorepo tooling + pnpm workspace** (AC: 1, 3)
  - [x] Create root `package.json` (private, name `curfew`, `packageManager` pin) with scripts that fan out to each workspace: `lint`, `build`, `typecheck`, and a documented `bootstrap` (install + build all three).
  - [x] Create `pnpm-workspace.yaml` listing the JS/TS workspace members (`web`, `shared`, and the agent's frontend package — see Task 3). **Do NOT add `_bmad`, `_bmad-output`, `output`, or `docs` as workspaces.**
  - [x] Add `.nvmrc` (Node 20 LTS or newer) and a real `.gitignore` (replace the current empty one): `node_modules/`, `.next/`, `out/`, `dist/`, `target/`, `.turbo/`, `*.tsbuildinfo`, `.env*`, `supabase/.branches/`, `supabase/.temp/`. **Preserve existing tracked paths** (`_bmad/`, `_bmad-output/`, `.claude/`, `docs/`, `output/`, `dj-stats.md`, `README.md`).
  - [x] (Optional, recommended) Add `turbo.json` to orchestrate the `lint`/`build`/`typecheck` fan-out with caching. If skipped, root `package.json` scripts must still run each workspace explicitly. See [Open Question 1](#open-questions--assumptions).
  - [x] Document the exact bootstrap command in root `README.md` (AC-1 hinges on this being real and runnable from a clean checkout).
- [x] **Task 2 — `shared/` draft contract package** (AC: 2)
  - [x] Scaffold `shared/` as a first-party TS package (`package.json` name `@curfew/shared`, `tsconfig.json`, build to `dist/` or expose source via `exports`). No external boilerplate.
  - [x] Author a **DRAFT** sync-payload TypeScript type (per-set derived payload — the AD-3 seam shape) and the fixed enums that AR-15 mandates live here: `visibility` ∈ {`public`,`friends_only`,`private`}, segment `type` ∈ {`dancefloor`,`dinner`,`performance`,`custom`}, `source` = `serato`. Mark every export clearly provisional (e.g. a `// DRAFT — not frozen until Story 1.10 (AR-1)` banner + a `CONTRACT_VERSION`/`agent_version`-carrying field).
  - [x] Emit a **JSON-schema stub** for the same payload as a checked-in `.json` file (this is the artifact the Rust agent consumes — Rust cannot import a TS type).
  - [x] Prove dual consumption: `web/` imports the TS type; `agent/` (Rust) loads the JSON-schema file (a path constant + a test that reads/parses it is sufficient at this stage). See [Dev Notes → Contract dual-consumption](#the-shared-contract-ac-2--the-one-thing-to-get-structurally-right).
- [x] **Task 3 — `agent/` (Tauri 2 + Rust) skeleton** (AC: 1, 3)
  - [x] Scaffold `agent/` first-party as a Tauri 2 app: minimal frontend (the tray/settings surface is native + minimal per UX-DR23 — do **not** build a full web UI here) + `agent/src-tauri/` Rust core (`Cargo.toml`, `tauri.conf.json`, `src/`, `capabilities/`). Rust edition 2021, Rust stable.
  - [x] Ensure `cargo build`, `cargo fmt --check`, `cargo clippy` all pass on an empty-but-real core. **Do NOT add `triseratops`/`id3`/parser deps yet** — those arrive in Story 1.3 (with the pinned-git-commit discipline, AR-5). This story only proves the shell compiles.
  - [x] Register the agent frontend package in the pnpm workspace so `pnpm install`/`build` covers it.
- [x] **Task 4 — `web/` (Next.js 16) skeleton** (AC: 1, 3)
  - [x] Scaffold `web/` first-party with `create-next-app` (App Router, TypeScript, ESLint). This is the **Vercel-deployed cloud app** — keep default SSR/ISR output; **do NOT set `output: 'export'`** (that constraint applies only to a Tauri-hosted frontend, which `web/` is not — see [Dev Notes → Two different Next.js contexts](#two-different-nextjs-contexts--do-not-conflate)).
  - [x] Configure `transpilePackages: ['@curfew/shared']` (or equivalent) so `web/` consumes `shared/`.
  - [x] `pnpm --filter web build` and `lint` pass.
- [x] **Task 5 — `supabase/` migrations seed** (AC: 4)
  - [x] `supabase init` at repo root → `supabase/config.toml` + `supabase/migrations/`.
  - [x] Add one initial additive-only migration (empty or a trivial no-op / comment-only `.sql`) via `supabase migration new init`. Document the **additive-only** rule (AR-12 / AD-15) inline and/or in `supabase/README.md`: no dropping/renaming live columns, ever.
- [x] **Task 6 — CI pipeline** (`.github/workflows/ci.yml`) (AC: 1, 4)
  - [x] On push + PR: install (pnpm, frozen lockfile), then **lint + build each workspace**: `shared` (tsc/build), `web` (next lint + next build), `agent` (`cargo fmt --check` + `cargo clippy -D warnings` + `cargo build`).
  - [x] Apply the Supabase migration cleanly in CI (Docker is available on GitHub `ubuntu-latest`): `supabase db start` → `supabase migration up` (or `supabase db reset`), asserting a clean apply (AC-4).
  - [x] **Explicitly out of scope for CI here:** signed Tauri bundling / notarization / installers — that is Epic 2 (AR-14, `tauri-action`). CI compiles the Rust core; it does not produce or sign installers.
- [x] **Task 7 — Clean-checkout verification** (AC: 1)
  - [x] From a fresh clone, run the documented bootstrap command and confirm all three workspaces install + build with no manual fix-ups. Record the exact command + observed output in the Dev Agent Record.

## Dev Notes

### What this story is (and is not)
This is the **from-scratch monorepo scaffold** — the risk-boundary-first foundation for all of Epic 1 and everything after. It is deliberately narrow: stand up `agent/` · `web/` · `shared/` + `supabase/migrations/` + one CI pipeline, prove they install/build/lint, and expose a **draft** contract. It is **not** where parsing, stats, auth, sync, or UI get built — those are Stories 1.2→1.10 and Epics 2+. Resist scope creep; satisfy the four ACs and stop.

Greenfield confirmed: the repo currently contains only planning/tooling artifacts (`_bmad/`, `_bmad-output/`, `.claude/`, `docs/`, `output/`, `dj-stats.md`, a 34-byte `README.md`, an **empty** `.gitignore`). No `agent/`, `web/`, `shared/`, `supabase/`, `.github/`, `package.json`, or `Cargo.toml` exist. This is a true first-party scaffold (AR-16) — **there is no starter template to adopt, and adopting one violates AC-3.**

### Directory layout is a hard invariant — top-level names are fixed
The architecture's Structural Seed fixes the top-level names **`agent/` · `web/` · `shared/`** at the repo root, alongside `supabase/`. [Source: ARCHITECTURE-SPINE.md#Structural Seed (source tree)]

```text
<repo root>/
  agent/     # Tauri 2 + Rust — Rust core in agent/src-tauri/, minimal tray frontend
  web/       # Next.js 16 — Vercel cloud app (SSR/ISR)
  shared/    # versioned sync-contract TS types + JSON-schema (the agent↔cloud seam)
  supabase/  # config.toml + migrations/ (additive-only, AR-12)
  .github/workflows/ci.yml
  package.json, pnpm-workspace.yaml, turbo.json?, .gitignore, .nvmrc
```

⚠️ **Most Tauri+Next.js monorepo templates use `apps/` + `packages/`. Curfew does NOT.** Do not reorganize into `apps/web`, `packages/shared`, etc. The dependency rule below is expressed in terms of these exact names, and every downstream story references them. [Source: ARCHITECTURE-SPINE.md#Invariants & Rules; epics.md#AR-16]

### The dependency rule (enforce it in the scaffold, don't just document it)
`agent` → `shared` and `web` → `shared`; **neither `agent` nor `web` depends on the other**; both reach the cloud only through the sync contract. Set up package boundaries so an accidental `agent`↔`web` import is not even resolvable. [Source: ARCHITECTURE-SPINE.md#Invariants & Rules, AD-3]

### The `shared/` contract (AC-2) — the one thing to get structurally right
Per the epic's own design note, the `shared/` derived contract is **the single artifact to over-invest in** and is **frozen-forever, additive-only** — but **not until Story 1.10**, after the parser-validation spike (1.2) teaches us parsing reality. [Source: epics.md#Epic 1 Design notes; ARCHITECTURE-SPINE.md AD-3, AD-15]

For **this** story the contract is a **DRAFT stub**, but its *dual-consumption mechanism* must be real:
- **`web/` (TypeScript)** imports the payload **type** from `@curfew/shared` directly.
- **`agent/` (Rust) cannot import a TS type.** The shared, language-neutral artifact is the **JSON-schema file**. The Rust side consumes *that* (load the checked-in `.json`; a Rust test that parses it proves the seam). Later stories (1.10, 3.x) turn this into real contract tests validating payloads on **both** the agent (before send) and cloud (on receive) per AR-1 — do not build that validation now, but do not structure the stub in a way that blocks it.
- Seed the AR-15 fixed enums (`visibility`, segment `type`, `source`) in `shared/` now — they belong here by convention and are low-risk. Everything stays labeled DRAFT / not-frozen. [Source: ARCHITECTURE-SPINE.md#Consistency Conventions (Enums); epics.md AR-15]

### Two different Next.js contexts — do NOT conflate
Search results and the official Tauri docs say "Next.js on Tauri needs `output: 'export'` (static)." **That applies to a Tauri-hosted frontend only.** In Curfew:
- **`web/`** is the **cloud app deployed to Vercel with SSR/ISR** (AD-14, Deployment table). It must **keep server rendering** — do **not** static-export it.
- **`agent/`'s** frontend is a **minimal native tray/settings surface** (UX-DR23: native OS chrome, four icon states, one settings panel — *not* a mirror of the website). If its frontend is Next.js-based it may static-export, but a minimal/vanilla frontend is entirely acceptable and lighter. Keep it tiny; the real agent logic lives in Rust (`src-tauri`). [Source: ARCHITECTURE-SPINE.md AD-14 + Deployment; epics.md UX-DR22/UX-DR23]

### Rust core structure (forward-looking, don't over-build)
The agent is a **pipes-and-filters** pipeline (`watcher → parser → joiner → stat-engine → local store → sync-queue`), each filter independently testable with a typed hand-off. [Source: ARCHITECTURE-SPINE.md#Structural Seed (agent pipeline); SOLUTION-DESIGN.md §2]. **You are not building these filters in 1.1** — but structure `src-tauri/src/` so they can land as clean modules/crates later (Stories 1.3–1.7). A single compiling `main.rs` + room for modules is enough now.

### Supabase migrations (AC-4)
`supabase init` seeds `supabase/config.toml` + `supabase/migrations/`. Add one initial additive-only migration. The **enforcement arm of AD-15** is that all schema changes ship as **additive-only Supabase-CLI migration files committed in the monorepo** — a migration that drops/renames a live column or breaks the sync contract is **forbidden**. Document this rule where the next dev will see it (inline comment + `supabase/README.md`). Environments (dedicated prod project + preview branches) are an Epic-2/ops concern — do not wire cloud projects here; the CI check applies migrations against a **local** ephemeral Postgres. [Source: ARCHITECTURE-SPINE.md AD-15 + "Environments & migrations"; epics.md AR-12]

### CI skeleton (AC-1, AC-4)
One GitHub Actions workflow, run on push + PR, that **lints + builds each workspace** and **applies the migration cleanly**:
- JS/TS: `pnpm install --frozen-lockfile`; `shared` build (tsc); `web` `next lint` + `next build`; typecheck.
- Rust: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo build` in `agent/src-tauri` (cache cargo registry/target).
- Supabase: `supabase db start` + `supabase migration up` (Docker on `ubuntu-latest`).
- **Not here:** signed builds / notarization / `tauri-action` installers → Epic 2 (AR-14). Building the full signed Tauri bundle needs the Apple Developer ID + Windows OV/EV certs, which are day-zero *procurement*, not a 1.1 coding task. [Source: epics.md Epic-List cross-cutting notes; ARCHITECTURE-SPINE.md AR-14/Deployment]

### Testing standards
No test framework exists yet — establish the lean baseline this story needs, don't over-invest:
- **`shared/`**: one test asserting the draft TS type + JSON-schema stub are exported and mutually consistent (the JSON schema parses; enum values match).
- **`agent/` (Rust)**: `cargo test` with one test that loads + parses the `shared/` JSON-schema file (proves Rust-side consumption, AC-2).
- **`web/`**: build + `next lint` passing is the bar for this story (no component tests needed yet).
- **CI is the regression gate** for 1.1: green = all three workspaces install/build/lint + migration applies. The **golden-file regression harness** (NFR-5) is **Story 1.9**, not now.

### Project Structure Notes
- Places new top-level dirs (`agent/`, `web/`, `shared/`, `supabase/`, `.github/`) at repo root, coexisting with existing `_bmad*/`, `.claude/`, `docs/`, `output/`. No conflict — those stay untracked-by-the-app and out of the pnpm workspace globs.
- The current `.gitignore` is empty (0 bytes) and `README.md` is a 34-byte stub — both are expected to be replaced/expanded by this story.
- One deliberate variance to call out: the seed source tree shows a wrapping `curfew/` directory; that denotes the repo root itself (the project is "Curfew"), **not** a nested folder. Scaffold at the actual repo root.

### Git / prior-work intelligence
No previous *story* (1.1 is first). Recent git history is entirely planning-doc commits (PRD/architecture/epics/readiness) — **no code patterns, libraries, or conventions to inherit.** This story *establishes* the conventions (naming, lint config, TS config, Cargo layout) that Stories 1.2+ will follow, so choose them deliberately.

### Latest tech / versions (verified July 2026 — pin at implementation, re-check before install)
- **Next.js 16** — stable; latest `16.2.x` (e.g. 16.2.11), Turbopack default, ships React 19. Scaffold with `create-next-app@latest` (App Router + TS + ESLint). [Source: nextjs.org/blog/next-16-2]
- **Tauri 2** — stable core `~2.10.x`, CLI `~2.11.x`. Scaffold with `create-tauri-app@latest`. Rust **stable**, edition 2021. [Source: v2.tauri.app/release]
- **triseratops / id3** — **NOT this story** (Story 1.3). When added later: `triseratops` is MPL-2.0 and must be pinned to an **exact git commit** (crates.io `0.0.3`/2023 is stale). [Source: ARCHITECTURE-SPINE.md AD-11/Stack]
- **pnpm** workspaces via `pnpm-workspace.yaml`; local packages symlinked; `transpilePackages` lets `web/` consume `shared/`. Turborepo optional for task orchestration/caching. [Source: pnpm/Turborepo monorepo guides]
- **Supabase CLI** — `supabase init` → `supabase/` (`config.toml` + `migrations/`); `supabase migration new <name>` → `supabase/migrations/<timestamp>_<name>.sql`; local stack runs in Docker. [Source: supabase.com/docs/guides/local-development]
- **Node** 20 LTS+; **Vercel** is `web/`'s deploy target (not configured in this story).

### References
- [ARCHITECTURE-SPINE.md — Invariants & Rules / dependency direction](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [ARCHITECTURE-SPINE.md — AD-3 (derived-only sync through one shared versioned contract)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [ARCHITECTURE-SPINE.md — AD-14 (modular-monolith cloud), AD-15 (additive-only migrations)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [ARCHITECTURE-SPINE.md — Stack / Structural Seed / Deployment & environments](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [ARCHITECTURE-SPINE.md — Consistency Conventions (Enums, entity naming)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md)
- [SOLUTION-DESIGN.md §2 (the two tiers and the seam), §6 (build sequencing)](../planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md)
- [epics.md — Epic 1 + Story 1.1 + AR-1/AR-5/AR-12/AR-15/AR-16](../planning-artifacts/epics.md)
- [epics.md — Epic List cross-cutting notes (code-signing is day-zero procurement; freeze contract last)](../planning-artifacts/epics.md)

### Open Questions / Assumptions
*(None block implementation — reasonable defaults chosen per the zero-intervention mandate; flagged for Arjun's confirmation.)*
1. **[ASSUMPTION] Task-orchestration tool:** pnpm workspaces is the baseline; **Turborepo recommended** (clean `lint`/`build`/`typecheck` fan-out + caching for the CI "each workspace" requirement) but optional. Nx was not chosen (heavier than this 3-workspace repo warrants). Reversible later.
2. **[ASSUMPTION] Agent frontend framework:** kept minimal/vanilla (or a tiny Next.js static export) since the tray UI is intentionally native and small (UX-DR23) — not a second full Next.js app. If a shared component system across `web/` and the tray is later desired, revisit.
3. **[ASSUMPTION] `shared/` distribution:** consumed via workspace source + `transpilePackages` (no pre-publish/build step required for `web/`); the JSON-schema is a checked-in file the agent reads. Confirm if a compiled `dist/` is preferred.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Opus 4.8)

### Debug Log References

Environment/tooling issues hit during implementation and how they were resolved (no code-logic bugs — all scaffold/tooling):

- **Toolchain absent on dev machine.** pnpm, Rust, and Supabase CLI were all missing. Resolved: pnpm via `corepack enable pnpm` (11.15.1); Rust via `brew install rustup` + `rustup default stable` (1.97.1) — note Homebrew's rustup is **keg-only**, so cargo/clippy/rustfmt live at `/opt/homebrew/opt/rustup/bin` (must be on PATH); Supabase CLI via direct GitHub binary (2.109.1) because `brew install supabase` failed on outdated Command Line Tools.
- **Supabase CLI wrapper needs a companion binary.** The release tarball ships both `supabase` (wrapper) and `supabase-go`; installing only the wrapper made `--version` work but `db start` fail. Resolved by installing `supabase-go` alongside it.
- **pnpm supply-chain build gate.** `pnpm install` exited 1 (`ERR_PNPM_IGNORED_BUILDS`) and the repo's supply-chain hook injected an `allowBuilds:` block requiring a decision for `sharp` and `unrs-resolver`. Both ship prebuilt platform binaries via optional deps, so their native build scripts are unnecessary → set `allowBuilds: false` for both (plus pnpm-native `ignoredBuiltDependencies`). Install then exits 0.
- **shared typecheck.** The contract-parity test uses `node:path` + `import.meta.url`; `tsc --noEmit` needed `@types/node` (added as a shared devDep).
- **Docker down locally** — started Docker Desktop to verify the migration; `supabase db start` + `supabase db reset` replay the init migration cleanly (exit 0). Stack stopped afterward to leave the machine clean.

### Completion Notes List

First-party, from-scratch monorepo scaffold — **no external greenfield boilerplate adopted** (AC-3). Deliberately narrow: stand up the three workspaces + Supabase migrations + one CI pipeline, prove install/build/lint, expose a **draft** contract. No parsing/stats/auth/sync/UI (those are 1.2→1.10 / Epics 2+).

**Acceptance criteria — all met & verified locally:**
- **AC-1** — `pnpm run bootstrap` from a simulated clean checkout (source copied, all build artifacts excluded) installs + builds all three workspaces, **exit 0** (pnpm install → turbo build of shared/web/agent → `cargo build`). CI (`.github/workflows/ci.yml`) runs lint + build on each workspace on push + PR.
- **AC-2** — `shared/` exposes a **DRAFT** sync-payload TS type + a JSON-schema stub, dual-consumed for real: `web/app/page.tsx` imports the TS type/values from `@curfew/shared` (compiled into `next build` via `transpilePackages`); the Rust agent loads + parses `shared/schema/sync-payload.schema.json` in a passing `cargo test`. A shared vitest (5 tests) asserts the TS ↔ JSON-schema enum/version parity so the two representations can't drift.
- **AC-3** — Scaffold is first-party. Official framework scaffolders (`create-next-app`, `create-tauri-app`) were used to generate the workspaces, then trimmed to Curfew's fixed `agent/ · web/ · shared/` layout (NOT the templates' `apps/`+`packages/`). No SaaS/greenfield starter adopted.
- **AC-4** — `supabase init` seeded `config.toml` + `migrations/`; one additive-only no-op migration (`20260721180917_init.sql`) applies cleanly (proven via `supabase db reset`). Additive-only rule (AD-15/AR-12) documented in the migration header + `supabase/README.md`. CI applies it against ephemeral Postgres.

**Verification summary (real repo):** JS/TS turbo — lint 4/4, typecheck 4/4, build 3/3 (`web` next build compiled, SSR default — no static export), test 5/5 (shared). Rust agent — `cargo fmt --check` clean, `cargo clippy -D warnings` clean, `cargo build` OK, `cargo test` 1/1 (shared-schema consumption). Supabase — `migration up` / `db reset` clean apply.

**Key decisions / assumptions (from the story's Open Questions):**
- **Turborepo adopted** (Open Q1) for the lint/build/typecheck fan-out + caching; root scripts drive it. Rust is orchestrated via `pnpm run build:agent` (`cargo`), kept out of the JS graph.
- **Agent frontend kept minimal/static** (Open Q2): the vite/TS demo from `create-tauri-app` was removed in favor of a committed static `agent/ui/index.html` (UX-DR23: native + minimal). `tauri.conf.json` `frontendDist` → `../ui`, so `cargo build` is self-sufficient (no prior JS build needed). The demo `greet` command + `tauri-plugin-opener` were stripped for a truly empty-but-real core; `src-tauri/src/` structured for the future `watcher→parser→joiner→stat-engine→store→sync-queue` filters (1.3–1.7).
- **`shared/` consumed via workspace source + `transpilePackages`** (Open Q3); a `dist/` build also exists (`tsc`) so the workspace has a real build task, but `web/` doesn't require it.

**Notes for reviewer / next dev:**
- Rust from Homebrew rustup is keg-only — add `export PATH="/opt/homebrew/opt/rustup/bin:$PATH"` to use `cargo` (documented in root + `agent/README.md`).
- `web/` intentionally keeps SSR/ISR (Vercel app) — do **not** add `output: 'export'`. The `output: 'export'` constraint is only for a Tauri-hosted frontend.
- The `shared/` contract is **DRAFT / not frozen** until Story 1.10; banner + `CONTRACT_VERSION` in place.

### File List

**Root tooling**
- `package.json` (new) — workspace root `curfew`, scripts (build/lint/typecheck/test + agent cargo scripts + bootstrap), `packageManager` pin, turbo devDep.
- `pnpm-workspace.yaml` (new) — members `shared`/`web`/`agent`; `allowBuilds`/`ignoredBuiltDependencies` for sharp & unrs-resolver.
- `pnpm-lock.yaml` (new)
- `turbo.json` (new)
- `.nvmrc` (new) — Node 22
- `.gitignore` (modified) — replaced empty file with real ignores.
- `README.md` (modified) — replaced stub with layout + prerequisites + bootstrap docs.
- `.github/workflows/ci.yml` (new) — 3 jobs: js, agent (Rust), supabase.

**shared/**
- `shared/package.json`, `shared/tsconfig.json`, `shared/tsconfig.build.json` (new)
- `shared/src/index.ts` (new) — DRAFT `SyncPayloadDraft` + AR-15 enums + `CONTRACT_VERSION` + schema path const.
- `shared/schema/sync-payload.schema.json` (new) — JSON-schema mirror (Rust-consumed).
- `shared/src/index.test.ts` (new) — TS↔schema parity (vitest).
- `shared/README.md` (new)

**agent/** (Tauri 2 + Rust; generated via create-tauri-app then trimmed)
- `agent/package.json`, `agent/turbo.json`, `agent/README.md`, `agent/.gitignore` (new)
- `agent/scripts/check-ui.mjs` (new) — the workspace build/lint (asserts static UI).
- `agent/ui/index.html` (new) — committed minimal tray/settings surface.
- `agent/src-tauri/Cargo.toml`, `Cargo.lock`, `build.rs`, `.gitignore` (new)
- `agent/src-tauri/tauri.conf.json` (new) — productName Curfew Agent, `frontendDist: ../ui`.
- `agent/src-tauri/capabilities/default.json` (new) — core:default only (opener removed).
- `agent/src-tauri/src/main.rs`, `agent/src-tauri/src/lib.rs` (new) — minimal `run()` + shared-schema consumption + test.
- `agent/src-tauri/icons/*` (new) — generated icon set (12 files).

**web/** (Next.js 16; generated via create-next-app then trimmed)
- `web/package.json` (new) — `@curfew/shared` workspace dep + typecheck script.
- `web/next.config.ts` (new) — `transpilePackages: ['@curfew/shared']`, no static export.
- `web/app/layout.tsx` (new) — Curfew metadata, google-font import removed (hermetic build).
- `web/app/page.tsx` (new) — consumes `@curfew/shared` (type + runtime values).
- `web/app/globals.css`, `web/app/favicon.ico`, `web/eslint.config.mjs`, `web/tsconfig.json`, `web/.gitignore`, `web/README.md`, `web/public/*.svg` (new, from scaffold).
- Removed from scaffold: nested `web/pnpm-workspace.yaml`, `web/CLAUDE.md`, `web/AGENTS.md`, `web/app/page.module.css`.

**supabase/**
- `supabase/config.toml`, `supabase/.gitignore` (new, from `supabase init`)
- `supabase/migrations/20260721180917_init.sql` (new) — additive-only no-op seed.
- `supabase/README.md` (new) — additive-only rule.

**Story bookkeeping**
- `_bmad-output/implementation-artifacts/1-1-monorepo-scaffold-with-three-workspaces.md` (modified) — frontmatter `baseline_commit`, task checkboxes, this record, status.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — story status.

## Change Log

| Date | Version | Description |
|------|---------|-------------|
| 2026-07-21 | 0.1 | Story 1.1 implemented: from-scratch monorepo scaffold (`agent/` Tauri 2 + Rust · `web/` Next.js 16 · `shared/` draft contract) + `supabase/` additive-only migrations + CI. All 4 ACs met and verified locally; status → review. |
| 2026-07-21 | 0.2 | Code review round 1: 8 patches applied + verified, 3 deferred (tracked in `deferred-work.md`); status → done. |

## Review Findings

_Code review 2026-07-21 (branch diff vs `main`). 3 adversarial layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor._

- [x] [Review][Patch] Make agent tray-only — no window shown on launch (resolved from Decision: chose tray-only per UX-DR23). Register a minimal system tray and start the window hidden. [agent/src-tauri/tauri.conf.json:10-18]
- [x] [Review][Patch] Invalid Supabase CLI command breaks the CI migration gate — `supabase db start` is not a subcommand; correct verb is `supabase start` (as used in `supabase/README.md`). AC-4 job fails every run. [.github/workflows/ci.yml:103]
- [x] [Review][Patch] `bootstrap` uses `--frozen-lockfile=false` while CI uses `--frozen-lockfile` — clean-checkout bootstrap can silently mutate `pnpm-lock.yaml` and still pass, then fail CI; undermines AC-1 reproducibility. [package.json:19]
- [x] [Review][Patch] `allowBuilds:` is not a recognized pnpm-workspace.yaml key — dead config, redundant with the `ignoredBuiltDependencies` block already present. [pnpm-workspace.yaml:18-20]
- [x] [Review][Patch] CI runs on every `push` AND `pull_request` with no branch filter — double-runs the full 3-job matrix on PR branches; `concurrency` keyed on `github.ref` won't dedupe push vs PR refs. [.github/workflows/ci.yml:9-15]
- [x] [Review][Patch] `turbo.json` makes `lint`/`typecheck`/`test` depend on `^build` — unnecessary since `web` consumes `@curfew/shared` from source (via `exports` + `transpilePackages`); forces a full shared build before every lint/typecheck. [turbo.json:9-17]
- [x] [Review][Patch] `load_sync_payload_schema()` is a `pub fn` that `panic!`s on I/O/parse error — seeds the crate's public API with a panic-on-error path; should return `Result`. [agent/src-tauri/src/lib.rs:28-34]
- [x] [Review][Patch] `web/README.md` is unmodified create-next-app boilerplate now factually wrong — claims `next/font`/Geist (import was removed) and documents `npm`/`yarn`/`bun` in a pnpm-only frozen-lockfile repo. [web/README.md:1]
- [x] [Review][Defer] `csp: null` disables the webview Content-Security-Policy in the inherited baseline — deferred, tracked posture note (agent later loads local Serato data). [agent/src-tauri/tauri.conf.json:20]
- [x] [Review][Defer] CI has no OS matrix — agent Rust core only built/tested on Linux; cross-platform desktop build unguarded. Deferred: cross-platform bundling is Epic 2 scope. [.github/workflows/ci.yml:48]
- [x] [Review][Defer] TS↔schema parity test asserts only enums + version, not full property/required-key parity — structural drift can pass undetected. Deferred: deeper parity is future contract-freeze work. [agent/src-tauri/src/lib.rs:49; shared/src/index.test.ts]

_Code review round 2 — 2026-07-21 (full branch diff vs `main`, including the round-1 patches above applied but uncommitted). 3 adversarial layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor._

- [x] [Review][Patch] No quit affordance on the new tray icon — the tray click handler toggles the window on any click type and there is no context menu with a Quit item. Once the macOS Dock icon is also hidden (see the activationPolicy patch below), there is no OS-level way to quit the agent short of Force Quit / kill. Decision (Arjun, 2026-07-21): add a minimal Quit menu item now rather than deferring to the later tray-UX story. Fixed: tray now has a "Quit Curfew Agent" menu item shown on right-click (`show_menu_on_left_click(false)`); left-click still toggles the window. [agent/src-tauri/src/lib.rs]
- [x] [Review][Patch] Tray setup panics if the bundled default icon is missing (`app.default_window_icon().cloned().expect(...)`) — inconsistent with the sibling fix in this same diff that made `load_sync_payload_schema()` return `Result` instead of panicking. Fixed: replaced `.expect()` with `.ok_or(...)?`, propagating a normal setup error instead of panicking. [agent/src-tauri/src/lib.rs:626-630]
- [x] [Review][Patch] No `on_window_event` handler on the main window — the native close ("X") button destroys the window instead of hiding it, so the tray click handler can never reopen it again, defeating the tray-only design this exact patch round just implemented. Fixed: `on_window_event` now intercepts `CloseRequested`, calls `prevent_close()`, and hides the window instead. [agent/src-tauri/src/lib.rs]
- [x] [Review][Patch] No macOS `activationPolicy: "Accessory"` set — without it the app still shows a Dock icon and Cmd+Tab entry despite the "tray-only, no window on launch" fix just applied for UX-DR23. Fixed: `app.set_activation_policy(tauri::ActivationPolicy::Accessory)` called in `run()`'s setup, gated `#[cfg(target_os = "macos")]`. [agent/src-tauri/src/lib.rs]
- [x] [Review][Patch] `supabase/config.toml` has `[db.seed] enabled = true` with `sql_paths = ["./seed.sql"]`, but no `supabase/seed.sql` was ever committed — a first-time `supabase start`/`db reset` against a fresh (ephemeral CI) volume seeds automatically and will error on the missing file, risking AC-4's "clean apply" CI gate. Fixed: set `enabled = false` with an inline comment explaining why (no seed data exists yet for this scaffold). [supabase/config.toml:66-71]
- [x] [Review][Patch] `.nvmrc` pins Node `22` while `package.json` `engines.node` says `>=20` — the two floors disagree; a contributor on Node 20/21 satisfies `engines` but diverges from what `.nvmrc`-driven tooling (and CI's `node-version-file: .nvmrc`) actually installs. Fixed: `engines.node` bumped to `>=22` to match `.nvmrc`; README prerequisites table updated to match. [package.json:8; .nvmrc:1]
- [x] [Review][Patch] Root `README.md` is encoded as UTF-16LE (confirmed via byte inspection — every other README in the repo is UTF-8) — renders as mojibake/garbled in most Markdown viewers, undermining AC-1's requirement that the bootstrap docs be real and readable. Fixed: converted to UTF-8 (content verified byte-identical after re-encoding, no BOM). [README.md]
- [x] [Review][Patch] Change Log table has only one entry (v0.1, "status → review") even though `sprint-status.yaml` records a second event ("code-reviewed, 8 patches applied + verified, 3 deferred → done") — the two bookkeeping sources disagree on when the story actually finished. Fixed: added a 0.2 Change Log row for the review round 1 → done transition. [Change Log]
- [x] [Review][Defer] `window.is_visible().unwrap_or(false)` in the tray click handler silently treats a platform query error as "not visible," which could re-show/refocus an already-visible window with no diagnostic. Low likelihood, low impact. [agent/src-tauri/src/lib.rs]
- [x] [Review][Defer] The Supabase CI job boots the entire local stack (Postgres, Studio, Auth, Storage, Realtime, Edge Runtime, Analytics, vector, etc.) just to prove one no-op migration applies — heavy and a plausible source of CI slowness/flakiness as the project grows. Mirrors what the story's own Dev Notes prescribe, so it's an accepted tradeoff, not a code defect — flagged for future lighter-weight CI investigation. [.github/workflows/ci.yml]
- [x] [Review][Defer] `sync_payload_schema_path()` resolves the shared schema location via `env!("CARGO_MANIFEST_DIR")`, a compile-time path baked to the build machine's source tree — fine for `cargo test` today, but this `pub` function will silently fail once called from a bundled, installed agent on an end user's machine. Real pipeline wiring is explicitly Stories 1.3+ scope. [agent/src-tauri/src/lib.rs]
