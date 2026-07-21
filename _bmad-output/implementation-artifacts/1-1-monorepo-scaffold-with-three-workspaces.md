# Story 1.1: Monorepo scaffold with three workspaces

Status: ready-for-dev

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

- [ ] **Task 1 — Root monorepo tooling + pnpm workspace** (AC: 1, 3)
  - [ ] Create root `package.json` (private, name `curfew`, `packageManager` pin) with scripts that fan out to each workspace: `lint`, `build`, `typecheck`, and a documented `bootstrap` (install + build all three).
  - [ ] Create `pnpm-workspace.yaml` listing the JS/TS workspace members (`web`, `shared`, and the agent's frontend package — see Task 3). **Do NOT add `_bmad`, `_bmad-output`, `output`, or `docs` as workspaces.**
  - [ ] Add `.nvmrc` (Node 20 LTS or newer) and a real `.gitignore` (replace the current empty one): `node_modules/`, `.next/`, `out/`, `dist/`, `target/`, `.turbo/`, `*.tsbuildinfo`, `.env*`, `supabase/.branches/`, `supabase/.temp/`. **Preserve existing tracked paths** (`_bmad/`, `_bmad-output/`, `.claude/`, `docs/`, `output/`, `dj-stats.md`, `README.md`).
  - [ ] (Optional, recommended) Add `turbo.json` to orchestrate the `lint`/`build`/`typecheck` fan-out with caching. If skipped, root `package.json` scripts must still run each workspace explicitly. See [Open Question 1](#open-questions--assumptions).
  - [ ] Document the exact bootstrap command in root `README.md` (AC-1 hinges on this being real and runnable from a clean checkout).
- [ ] **Task 2 — `shared/` draft contract package** (AC: 2)
  - [ ] Scaffold `shared/` as a first-party TS package (`package.json` name `@curfew/shared`, `tsconfig.json`, build to `dist/` or expose source via `exports`). No external boilerplate.
  - [ ] Author a **DRAFT** sync-payload TypeScript type (per-set derived payload — the AD-3 seam shape) and the fixed enums that AR-15 mandates live here: `visibility` ∈ {`public`,`friends_only`,`private`}, segment `type` ∈ {`dancefloor`,`dinner`,`performance`,`custom`}, `source` = `serato`. Mark every export clearly provisional (e.g. a `// DRAFT — not frozen until Story 1.10 (AR-1)` banner + a `CONTRACT_VERSION`/`agent_version`-carrying field).
  - [ ] Emit a **JSON-schema stub** for the same payload as a checked-in `.json` file (this is the artifact the Rust agent consumes — Rust cannot import a TS type).
  - [ ] Prove dual consumption: `web/` imports the TS type; `agent/` (Rust) loads the JSON-schema file (a path constant + a test that reads/parses it is sufficient at this stage). See [Dev Notes → Contract dual-consumption](#the-shared-contract-ac-2--the-one-thing-to-get-structurally-right).
- [ ] **Task 3 — `agent/` (Tauri 2 + Rust) skeleton** (AC: 1, 3)
  - [ ] Scaffold `agent/` first-party as a Tauri 2 app: minimal frontend (the tray/settings surface is native + minimal per UX-DR23 — do **not** build a full web UI here) + `agent/src-tauri/` Rust core (`Cargo.toml`, `tauri.conf.json`, `src/`, `capabilities/`). Rust edition 2021, Rust stable.
  - [ ] Ensure `cargo build`, `cargo fmt --check`, `cargo clippy` all pass on an empty-but-real core. **Do NOT add `triseratops`/`id3`/parser deps yet** — those arrive in Story 1.3 (with the pinned-git-commit discipline, AR-5). This story only proves the shell compiles.
  - [ ] Register the agent frontend package in the pnpm workspace so `pnpm install`/`build` covers it.
- [ ] **Task 4 — `web/` (Next.js 16) skeleton** (AC: 1, 3)
  - [ ] Scaffold `web/` first-party with `create-next-app` (App Router, TypeScript, ESLint). This is the **Vercel-deployed cloud app** — keep default SSR/ISR output; **do NOT set `output: 'export'`** (that constraint applies only to a Tauri-hosted frontend, which `web/` is not — see [Dev Notes → Two different Next.js contexts](#two-different-nextjs-contexts--do-not-conflate)).
  - [ ] Configure `transpilePackages: ['@curfew/shared']` (or equivalent) so `web/` consumes `shared/`.
  - [ ] `pnpm --filter web build` and `lint` pass.
- [ ] **Task 5 — `supabase/` migrations seed** (AC: 4)
  - [ ] `supabase init` at repo root → `supabase/config.toml` + `supabase/migrations/`.
  - [ ] Add one initial additive-only migration (empty or a trivial no-op / comment-only `.sql`) via `supabase migration new init`. Document the **additive-only** rule (AR-12 / AD-15) inline and/or in `supabase/README.md`: no dropping/renaming live columns, ever.
- [ ] **Task 6 — CI pipeline** (`.github/workflows/ci.yml`) (AC: 1, 4)
  - [ ] On push + PR: install (pnpm, frozen lockfile), then **lint + build each workspace**: `shared` (tsc/build), `web` (next lint + next build), `agent` (`cargo fmt --check` + `cargo clippy -D warnings` + `cargo build`).
  - [ ] Apply the Supabase migration cleanly in CI (Docker is available on GitHub `ubuntu-latest`): `supabase db start` → `supabase migration up` (or `supabase db reset`), asserting a clean apply (AC-4).
  - [ ] **Explicitly out of scope for CI here:** signed Tauri bundling / notarization / installers — that is Epic 2 (AR-14, `tauri-action`). CI compiles the Rust core; it does not produce or sign installers.
- [ ] **Task 7 — Clean-checkout verification** (AC: 1)
  - [ ] From a fresh clone, run the documented bootstrap command and confirm all three workspaces install + build with no manual fix-ups. Record the exact command + observed output in the Dev Agent Record.

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

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
