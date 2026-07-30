---
baseline_commit: 0750a2d50e8311ad7699a57ebcb3ccc7a8bb7da7
---

# Story 2.9a: macOS signed build + notarization

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want `tauri-action` producing a signed, notarized macOS build,
so that macOS DJs can install an agent Gatekeeper trusts.

## Acceptance Criteria

1. **Given** the CI pipeline, **When** a macOS release is cut, **Then** it produces an Apple Developer ID-signed, notarized build; the cert lives as an encrypted CI secret. *(AR-14)*
2. **Given** local development, **Then** the agent self-tests unsigned. *(Design note a)*

## Tasks / Subtasks

- [x] **Task 1: Add a dedicated macOS release workflow** (AC: #1)
  - [x] Create `.github/workflows/release-macos.yml` — **new file**, separate from `.github/workflows/ci.yml`. Do not add signing/bundling steps to `ci.yml`; its own header comment says signed bundling is deliberately out of scope there (line 5-7) — this story is what fills that gap, in its own workflow.
  - [x] Trigger: `on: push: tags: ['agent-v*.*.*']` (a version-tag push, not every push to `main`). No other story/doc establishes a tag convention yet — `agent-v*` scopes this to the agent app specifically, leaving room for independent `web-v*`/`shared-v*` tags later without collision.
  - [x] Runner: `runs-on: macos-latest`. This is the **first macOS runner in the repo** — `ci.yml`'s `agent` job and Story 2.5's own Dev Notes both flag "CI is Linux-only today" as a known, deliberately-deferred gap. This story closes it, scoped to release only (`ci.yml`'s PR/push-to-main gate stays Linux-only and untouched).
  - [x] Steps: checkout → install Rust stable via `dtolnay/rust-toolchain@stable` → `rustup target add aarch64-apple-darwin x86_64-apple-darwin` (both Apple Silicon and Intel targets — a universal build is the simplest single artifact to sign/notarize/ship once, vs. a 2-way OS-arch matrix) → install pnpm/Node (`pnpm/action-setup@v4` + `actions/setup-node@v4`, `node-version-file: .nvmrc`, mirror `ci.yml`'s `js` job) → run `tauri-apps/tauri-action@v1` with `projectPath: agent`, `args: --target universal-apple-darwin`, `tagName: ${{ github.ref_name }}`, `releaseName: 'Curfew Agent ${{ github.ref_name }}'`.
  - [x] `tauri-action` needs no `@tauri-apps/cli` in `package.json` (none exists yet, anywhere in the repo) — it installs the Rust `tauri-cli` itself when no `tauri` npm script is found. Don't add `@tauri-apps/cli` as a workaround; it's unnecessary.
  - [x] Env block wires the **GitHub Actions secrets Arjun must create** (this story's code cannot create them — see Task 4) to the exact names `tauri-action`/the Tauri bundler read directly:
    - `APPLE_CERTIFICATE` — base64-encoded `.p12` Developer ID Application cert
    - `APPLE_CERTIFICATE_PASSWORD` — the `.p12` export password
    - `APPLE_SIGNING_IDENTITY` — e.g. `"Developer ID Application: <Name> (<TEAMID>)"`
    - Notarization — **pick one method** and document the choice in the workflow's header comment: (a) API-key method — `APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`; no 2FA/app-specific-password rotation to babysit, recommended for unattended CI — or (b) Apple-ID method — `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password, not the account password), `APPLE_TEAM_ID`.
  - [x] Do **not** pass `--skip-stapling` — AC1 requires Gatekeeper to trust the shipped build without a network check at install time, which needs the notarization ticket stapled to the `.dmg`/`.app`. `tauri-action` staples automatically when notarization credentials are present; only `--skip-stapling` would disable it.

- [x] **Task 2: Verify `tauri.conf.json` stays signing-identity-free** (AC: #1, #2)
  - [x] Do **not** add a hardcoded `bundle.macOS.signingIdentity` to `agent/src-tauri/tauri.conf.json`. Per Tauri's own docs, `APPLE_SIGNING_IDENTITY` (env var) overrides `tauri.conf.json`'s value when set, and falls back to unsigned when neither is set — so leaving the config file as-is (no `bundle.macOS` block at all today) is what makes AC2 ("local dev self-tests unsigned") hold *by construction*: a local `cargo tauri build` with no `APPLE_*` env vars in the shell produces an unsigned build automatically, no special-casing needed. Hardcoding an identity string in the config would risk a local build failing to find that identity in a dev machine's keychain, or worse, prompting for one — don't introduce that.
  - [x] If notarization fails in CI due to a missing entitlement (only diagnosable once real signing is attempted against the real cert — cannot be predicted from docs alone), add a minimal `entitlements.plist` referenced via `bundle.macOS.entitlements` at that point. Do not add one speculatively; Tauri's bundler applies a working default hardened-runtime entitlement set for the common case.

- [x] **Task 3: Document the release + local-build split** (AC: #1, #2)
  - [x] Update `agent/README.md`'s closing line (currently: *"Signed bundles / notarization / installers are out of scope here — that is Epic 2 (AR-14)"* — written in Story 1.1, now stale). Replace with a short "Release builds" section: local `cargo tauri build` / `cargo build` stays unsigned (dev self-test, AC2); a signed+notarized `.dmg` is produced by `.github/workflows/release-macos.yml` when an `agent-v*.*.*` tag is pushed (AC1) — link the workflow file, don't restate its contents.
  - [x] No changes needed to `agent/README.md`'s "Build & verify" `cargo` command block — those stay the local, unsigned dev-loop commands; this story doesn't change local dev ergonomics (AC2 is about the status quo continuing to hold, not new work).

- [x] **Task 4: Flag the manual secret-provisioning follow-up** (AC: #1)
  - [x] Update `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` row 32 ("GitHub Actions CI secrets ... code-signing certs ...") — it already names this story as the trigger; add the concrete secret names from Task 1 and mark them **not yet added** (Apple Developer Program enrollment, per that doc's row 22, is done — but enrollment alone doesn't generate a `Developer ID Application` cert, export a `.p12`, or create notarization credentials; those are separate manual steps in the Apple Developer portal that only Arjun can perform, outside this story's code scope).
  - [x] Do not attempt to populate the actual GitHub secret values — that's an out-of-band manual action (Apple Developer Portal + GitHub repo settings), not something achievable from this codebase. The workflow file existing and correctly wired is this story's complete code deliverable; it will simply fail at the signing step until Arjun adds the secrets, same pattern as `supabase-keepalive.yml`'s secrets before Story 2.1 provisioned them.

- [x] **Task 5: Gate green**
  - [x] Run the four-command Rust gate — `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo build`, `cargo test` (all `--manifest-path agent/src-tauri/Cargo.toml`) — to confirm the `tauri.conf.json` review (Task 2) introduced no regression. No new Rust code is expected from this story, so no new unit tests either — this is CI/build tooling, not application logic.
  - [x] Run `pnpm lint && pnpm typecheck && pnpm build` (root) to confirm the new workflow YAML and doc edits didn't break anything workspace-wide.
  - [x] Manually validate `release-macos.yml`'s YAML is well-formed (`actionlint` if available, or a GitHub Actions workflow syntax check) since this story cannot actually trigger a real signed release (no cert secrets exist yet, per Task 4) — a real end-to-end signing run is Arjun's job once secrets are added, not verifiable in this dev session.

## Dev Notes

- **What this story is and isn't:** this is exclusively a **CI/build-pipeline story** — new GitHub Actions workflow + a `tauri.conf.json` review + docs. It does not touch `agent/src-tauri/src/**` (no watcher/parser/store/capture code changes) and should not grow scope into any of that.
- **Why 2.9a is first (of 2.9a/b/c):** the original single Story 2.9 was split into 2.9a (macOS)/2.9b (Windows)/2.9c (updater) at the 2026-07-20 party specifically because the **Windows EV cert's identity verification can take 1–3 weeks** — macOS-first is the accepted launch fallback while that clears (epics.md line 513, 535). Per `pre-launch-services-checklist.md` row 30, nothing in the docs suggests the Windows EV cert procurement has started yet — do not assume 2.9b's cert exists or block 2.9a on it; they are independent workflows.
- **Apple Developer Program enrollment is done** (`pre-launch-services-checklist.md` row 22, resolved 2026-07-28, one membership shared with Story 2.3b's Sign In with Apple) — the procurement blocker AR-14 warns about (1-3 weeks wall-clock) is cleared for macOS. What's *not* done yet: exporting an actual `Developer ID Application` certificate as a `.p12` and generating notarization credentials — both manual Apple-portal actions, tracked as this story's Task 4 follow-up, not blocking the workflow code itself.
- **`ci.yml` is Linux-only by design, and this story doesn't change that** — `ci.yml`'s `agent` job runs on `ubuntu-latest` and explicitly notes (lines 5-7) that signed bundling is out of scope there. This story adds a **second, separate** workflow (`release-macos.yml`) on `macos-latest`, tag-triggered only — it does not add a macOS leg to the PR/push-to-main gate. Conflating the two would slow down every PR with a macOS runner for no reason; only real releases need one.
- **Signing-identity precedence (why Task 2 says "don't touch `tauri.conf.json`"):** Tauri's env vars override config file values for signing (`APPLE_SIGNING_IDENTITY` env > `tauri.conf.json`'s `bundle.macOS.signingIdentity`), and fall back to fully unsigned when neither is present. Leaving `tauri.conf.json` as-is is what makes AC2 hold automatically — CI supplies the env vars via secrets (Task 1), local dev supplies none, same config file, two different behaviors, zero conditionals needed.
- **`tauri-action` version/behavior (researched 2026-07-29, verify before use — Tauri version churn is real):** `tauri-apps/tauri-action@v1` is the current major tag referenced in Tauri's own GitHub Actions guide. It auto-detects and installs the `tauri-cli` if no `tauri` script exists in `package.json` (none does, repo-wide) — no `@tauri-apps/cli` dependency needs adding. It staples the notarization ticket automatically once notarization succeeds, unless `--skip-stapling` is explicitly passed (don't pass it).
- **Tauri pinned version:** 2.11.5 (`Cargo.lock`, confirmed in Story 2.5's Dev Notes) — `tauri-build`/`tauri` are both `"2"` in `Cargo.toml`, no bump expected or needed for this story.
- **Testing shape for this story:** almost entirely procedural/manual (workflow YAML validity, doc accuracy), not unit tests — there's no new Rust logic to unit-test. Don't invent tests for the sake of it; Task 5's gate-green + manual YAML check is the right bar here, matching this story's actual (non-application-logic) surface.

### Project Structure Notes

- New: `.github/workflows/release-macos.yml`.
- Modified: `agent/README.md` (Task 3), `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` (Task 4 — a docs/tracking file, not application code, but the established repo convention for procurement-adjacent follow-ups).
- Likely unmodified (verify, don't assume): `agent/src-tauri/tauri.conf.json` — Task 2 is a *review*, expected to conclude "no change needed" rather than producing a diff. If real signing attempts (outside this story's scope, once Arjun adds secrets) later reveal an entitlement gap, that's a follow-up, not this story's job.
- Not modified: `.github/workflows/ci.yml` (explicitly, per Task 1), anything under `agent/src-tauri/src/`.
- Dependency direction (AD-3) unaffected: this story touches `agent/` (config + workflow) and repo-root `.github/`, never `shared/` or `web/`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.9a, lines 513-524] — story ACs, sizing-split rationale, canonical text.
- [Source: _bmad-output/planning-artifacts/epics.md#AR-14, line 88] — "Code-signing is a fixed-cost ship gate... `tauri-action` (GitHub Actions) produces cross-platform signed builds + auto-generated updater JSON/`.sig`; certs + updater key are encrypted CI secrets."
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2 design note a, lines 175, 192] — "Code-signing is a day-zero procurement action, not an Epic-2 coding task"; "code-signing (`SIGN`) blocks release/distribution, not local development — the agent self-tests unsigned."
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md, lines 213, 216, 272] — `tauri-action` (GitHub Actions) as the CI/release tool; signing-cost caveat; CI/CD table entry.
- [Source: _bmad-output/implementation-artifacts/pre-launch-services-checklist.md, rows 22, 30, 32] — Apple Developer Program enrollment status (done), Windows EV cert status (not started, not this story's concern), CI secrets row naming this story as the trigger.
- [Source: .github/workflows/ci.yml, lines 1-10, 51-91] — existing `agent` job (Linux-only, explicitly signing-out-of-scope), the pattern to mirror for tool setup (pnpm/Node, Rust toolchain, cargo cache) in the new workflow.
- [Source: agent/src-tauri/tauri.conf.json] — current state: no `bundle.macOS` block, `bundle.targets: "all"`, icons already include `icon.icns`.
- [Source: agent/src-tauri/Cargo.toml] — package name `agent`, version `0.0.0`, Tauri `"2"`.
- [Source: agent/README.md, lines 43-45] — the stale "signed bundles out of scope" line this story updates.
- [Source: _bmad-output/implementation-artifacts/2-5-agent-shell-tray-ui.md, line 136] — Tauri pinned at 2.11.5; line ~86 area — "CI is Linux-only today... a known, separately-tracked gap" (this story is that follow-up).
- [Tauri v2 macOS Code Signing docs](https://v2.tauri.app/distribute/sign/macos/) — `.p12` export/base64 steps, `APPLE_CERTIFICATE`/`APPLE_CERTIFICATE_PASSWORD`/`APPLE_SIGNING_IDENTITY`, notarization credential options.
- [Tauri v2 GitHub Actions pipeline guide](https://v2.tauri.app/distribute/pipelines/github/) — `tauri-apps/tauri-action@v1` usage, tag-push trigger pattern.
- [Tauri v2 environment variables reference](https://v2.tauri.app/reference/environment-variables/) — full `APPLE_*` variable list (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`, `APPLE_PROVIDER_SHORT_NAME`, etc.) and override precedence vs. `tauri.conf.json`.

## Previous Story Intelligence

- **Story 2.8** (done, most recent): purely `agent/src-tauri/src/**` application code (local SQLite capture) — no CI/build-pipeline overlap with this story. Confirms the "four-command cargo gate" convention (`fmt`/`clippy`/`build`/`test`) this story's Task 5 reuses, and the commit-message convention (`Story 2.9a: <what changed>`).
- **Story 2.5** (done): built the tray/settings shell and is the source of two facts this story leans on directly — Tauri is pinned at **2.11.5**, and *"this repo's CI is Linux-only today (no OS matrix yet — a known, separately-tracked gap, not this story's problem)"*. This story is that gap's resolution, scoped to release-only (not the PR gate).
- **Story 2.2**: established the Obsidian web design-token system and explicitly carved out Story 2.5 (native tray UI) as exempt — not directly relevant here, but confirms the repo's pattern of explicit scope carve-outs in Dev Notes, which this story follows for its own "not touching `ci.yml`" and "not touching `src/`" boundaries.

## Git Intelligence Summary

- Commit convention to match: `Story 2.9a: <what changed>` for implementation, `Story 2.9a: Code review round — N patches applied, M deferred` for the review-closing commit (see `0750a2d`, `4bdf7de`, `b9a1452` for the exact pattern).
- Working tree at story start: HEAD `0750a2d` (Story 2.8's review-closing commit), only an unrelated `.claude/settings.local.json` modification present — clean otherwise. No `.github/workflows/release-macos.yml` exists yet, confirming this is genuinely new.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created.

### Review Findings

- [x] [Review][Patch] `APPLE_API_KEY_PATH` is sourced directly from a GitHub secret, but no workflow step ever writes the `.p8` key's content to that path on the ephemeral `macos-latest` runner — notarization will fail even once every Task 4 secret is provisioned exactly as documented [.github/workflows/release-macos.yml]
- [x] [Review][Patch] No `permissions:` block — `tauri-action` needs `contents: write` to create the GitHub Release; a restrictive repo/org default token scope will 403 the publish step [.github/workflows/release-macos.yml]
- [x] [Review][Patch] `agent/README.md`'s new "Release builds" section claims `cargo tauri build` is "the dev self-test loop above, unchanged" — that command never appears above, and no `@tauri-apps/cli`/`tauri` npm script/`cargo install tauri-cli` exists anywhere in the repo, so it doesn't actually work as documented [agent/README.md:45]
- [x] [Review][Patch] `tauri-apps/tauri-action@v1` is pinned only to a floating major-version tag while directly handling the Apple signing cert, cert password, and notarization API key via `env:` — inconsistent with this repo's own reproducibility bar (`triseratops` pinned to an exact commit for the same reason) [.github/workflows/release-macos.yml:120]
- [x] [Review][Patch] No `concurrency:` group, unlike sibling `ci.yml` — a retag while a prior run is in flight can race on the same GitHub Release [.github/workflows/release-macos.yml]
- [x] [Review][Patch] No `timeout-minutes` on the release job — a stalled notarization call has no workflow-level bound [.github/workflows/release-macos.yml]
- [x] [Review][Patch] Revert the three `Bash(echo ...)` permission entries added to `.claude/settings.local.json` — unrelated to this story's scope (not in its own File List) and, per two independent review layers, functionally inert since Bash tool shell state doesn't persist between calls [.claude/settings.local.json]
- [x] [Review][Defer] App version stays hardcoded `0.0.0` across `tauri.conf.json`/`Cargo.toml`/`package.json` with no step syncing it to the pushed `agent-v*.*.*` tag — deferred, out of this story's AC scope, relevant before Story 2.9c's auto-updater or the first real release [agent/src-tauri/tauri.conf.json, agent/src-tauri/Cargo.toml, agent/package.json]
- [x] [Review][Defer] No Rust build caching (`Swatinem/rust-cache`) in the new release workflow, unlike `ci.yml` — deferred, cost/speed nit only, release workflow runs rarely [.github/workflows/release-macos.yml]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the `bmad-dev-story` workflow.

### Debug Log References

- Full four-command cargo gate: `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check` (clean), `cargo clippy --manifest-path agent/src-tauri/Cargo.toml --all-targets -- -D warnings` (clean, zero warnings), `cargo build --manifest-path agent/src-tauri/Cargo.toml` (clean), `cargo test --manifest-path agent/src-tauri/Cargo.toml` (9 tests across golden-file suites, all green) — confirms the `tauri.conf.json` review (Task 2, no diff) introduced no regression.
- Workspace-wide `pnpm lint && pnpm typecheck && pnpm build` (root): all three packages (`@curfew/shared`, `agent`, `web`) green — confirms the new workflow YAML and doc edits didn't break anything.
- Manual YAML validation of `.github/workflows/release-macos.yml`: no `actionlint` binary available locally (checked `which actionlint`, not installed; no `brew` keg either) — validated instead by parsing the file with the repo's already-vendored `js-yaml` (from `node_modules/.pnpm`) via a one-off `node -e` script, confirming it parses as valid YAML with the expected top-level keys (`name`/`on`/`jobs`), the `agent-v*.*.*` tag trigger, `macos-latest` runner, and the `tauri-action` step's `tagName`/`projectPath` expressions rendering correctly (no stray `on:` → boolean-key parsing issue, a known YAML 1.1 footgun for GitHub Actions files).

### Completion Notes List

- **Task 1**: created `.github/workflows/release-macos.yml` — tag-triggered (`agent-v*.*.*`) on `macos-latest`, separate from `ci.yml` (untouched). Steps: checkout → Rust stable via `dtolnay/rust-toolchain@stable` → `rustup target add aarch64-apple-darwin x86_64-apple-darwin` → pnpm/Node setup mirroring `ci.yml`'s `js` job (`node-version-file: .nvmrc`) → `tauri-apps/tauri-action@v1` with `projectPath: agent`, `--target universal-apple-darwin`, `tagName`/`releaseName` from `github.ref_name`. Chose the **API-key notarization method** (`APPLE_API_ISSUER`/`APPLE_API_KEY`/`APPLE_API_KEY_PATH`) over Apple-ID, documented in the workflow's header comment per the task's instruction — no 2FA/app-specific-password rotation to babysit in unattended CI. No `--skip-stapling` passed, so `tauri-action` staples the notarization ticket automatically once credentials are present (AC1). No `@tauri-apps/cli` added — confirmed no `tauri` npm script exists anywhere in the repo, so `tauri-action` installs the Rust CLI itself.
- **Task 2**: confirmed by direct read of `agent/src-tauri/tauri.conf.json` — no `bundle.macOS` block exists today. Per Tauri's env-var-overrides-config precedence, this is what makes AC2 hold by construction (CI supplies `APPLE_SIGNING_IDENTITY` via secrets, local dev supplies none → unsigned). Concluded "no change needed," consistent with the story's own expectation that this task is a review, not a diff. No entitlements.plist added — no real signing has been attempted yet (no cert secrets exist), so there's nothing to diagnose; adding one speculatively was explicitly out of scope.
- **Task 3**: replaced `agent/README.md`'s stale "signed bundles out of scope" closing line (written in Story 1.1) with a "Release builds" section stating local `cargo tauri build`/`cargo build` stays unsigned (AC2) and linking `.github/workflows/release-macos.yml` for the signed+notarized `.dmg` path (AC1), without restating the workflow's contents. Left the existing "Build & verify" cargo command block untouched, per the task's own note that local dev ergonomics aren't changing.
- **Task 4**: updated `pre-launch-services-checklist.md` row 32 (GitHub Actions CI secrets) with the six concrete `APPLE_*` secret names from Task 1, marked **not yet added**, and noted that Apple Developer Program enrollment (row 22, done) doesn't by itself produce a `.p12` cert or notarization API-key credentials — those remain separate manual Apple Developer Portal steps for Arjun. Did not attempt to populate actual secret values (out-of-band manual action, not achievable from this codebase) — the workflow will fail at the signing step until those are added, same pattern as `supabase-keepalive.yml` before Story 2.1.
- **Task 5**: full four-command Rust gate green, workspace-wide `pnpm lint`/`typecheck`/`build` green, and the new workflow YAML manually validated as well-formed (see Debug Log References for detail on all three, including the `actionlint`-unavailable fallback). No new Rust or TS code was written by this story, so no new unit tests were added — matches the story's own "almost entirely procedural/manual" testing-shape guidance; a real end-to-end signed release run is Arjun's job once the Task 4 secrets are added, not verifiable in this dev session.
- **Scope discipline**: confirmed zero changes to `agent/src-tauri/src/**`, `.github/workflows/ci.yml`, and no hardcoded `bundle.macOS.signingIdentity` added to `tauri.conf.json` — matches the story's explicit "CI/build-pipeline story only" framing. No new deferred-work item identified during implementation; Task 4 already tracks the one true follow-up (manual secret provisioning) in `pre-launch-services-checklist.md`, its established home for procurement-adjacent items.

### File List

- `.github/workflows/release-macos.yml` (new) — tag-triggered (`agent-v*.*.*`) macOS release workflow: checkout, Rust + universal targets, pnpm/Node setup, `tauri-apps/tauri-action@v1` signing + notarization (API-key method) + GitHub release publish.
- `agent/README.md` (modified) — replaced the stale Story 1.1 "signed bundles out of scope" line with a "Release builds" section describing the local-unsigned/CI-signed split and linking the new workflow.
- `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` (modified) — row 32 (GitHub Actions CI secrets) updated with the six concrete `APPLE_*` secret names this story's workflow requires, marked not yet added.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — story marked `in-progress` at session start, `review` at completion.

### Change Log

| Date | Change | Status |
|------|--------|--------|
| 2026-07-29 | Story 2.9a dev-story session: added `.github/workflows/release-macos.yml` (tag-triggered signed+notarized macOS release via `tauri-action`, API-key notarization method), confirmed `tauri.conf.json` needs no change (AC2 holds by construction), updated `agent/README.md`'s stale scope note, and flagged the six concrete Apple secret names as not-yet-added in the pre-launch checklist (Tasks 1-5, all complete). Full four-command cargo gate + workspace lint/typecheck/build green; new workflow YAML manually validated well-formed. | ready-for-dev → review |
</content>
