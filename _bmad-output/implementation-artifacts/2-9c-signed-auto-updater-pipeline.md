---
baseline_commit: 909b152921d4788e57bbea11890b0072d6c83275
---

# Story 2.9c: Signed auto-updater pipeline

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a signed auto-updater with its own keypair,
so that we can push format-drift fixes DJs' agents will trust and apply.

## Acceptance Criteria

1. **Given** a release, **Then** `tauri-action` auto-generates the updater JSON + `.sig`. *(AR-14)*
2. **Given** the updater, **Then** it uses a **separate mandatory update-signing keypair**, distinct from the platform code-signing certs; the updater key lives as an encrypted CI secret. *(AR-14)*

## Tasks / Subtasks

- [ ] **Task 1: Wire the Tauri updater plugin (Rust only — no frontend consumer yet)** (AC: #1, #2)
  - [ ] Add `tauri-plugin-updater = "2"` to `agent/src-tauri/Cargo.toml`'s `[dependencies]` (unconditional, not target-gated — official docs show a `cfg(any(target_os = "macos", windows, target_os = "linux"))` target gate to exclude mobile, but this repo has zero mobile-target stories anywhere in epics.md; matches how `tauri-plugin-dialog` is already added unconditionally).
  - [ ] Register it in `agent/src-tauri/src/lib.rs`'s `run()`, alongside the existing `.plugin(tauri_plugin_dialog::init())` call (same `tauri::Builder` chain, same pattern — see `lib.rs:112-113`): `.plugin(tauri_plugin_updater::Builder::new().build())`.
  - [ ] Add `"updater:default"` to `agent/src-tauri/capabilities/default.json`'s `permissions` array (alongside `core:default`, `dialog:allow-open`) — grants the JS-side check/download/install permission set so the plugin is functional end-to-end, even though nothing calls it yet (see scope note below).
  - [ ] **Explicitly out of scope, do not add**: any JS/frontend call to `check()`/`downloadAndInstall()` (no `@tauri-apps/plugin-updater` npm package needed either — `agent/ui/index.html` is plain HTML/CSS/JS with `withGlobalTauri: true`, no bundler; a future "check for updates" affordance would use `window.__TAURI__` directly). No AC in this story asks for update-checking *behavior* — only that CI *produces* valid signed update artifacts and the plugin is wired to consume them once something calls it. Actually triggering checks/installs is Story 3.4's territory (format-drift resilience) or a not-yet-written story — don't guess at *when* checks should fire (on launch? on an interval? UX has no spec for this).

- [ ] **Task 2: Configure `tauri.conf.json` for signed updater-artifact generation** (AC: #1, #2)
  - [ ] Add `"createUpdaterArtifacts": true` to the existing `bundle` block in `agent/src-tauri/tauri.conf.json` (sibling to `active`/`targets`/`icon` — do **not** touch `agent/src-tauri/tauri.windows-release.conf.json`, that partial-config file is Story 2.9b's Windows-signing-only concern, unrelated to this).
  - [ ] Add a new top-level `"plugins"` block:
    ```json
    "plugins": {
      "updater": {
        "pubkey": "<TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER>",
        "endpoints": [
          "https://github.com/5arjun/curfew.vip/releases/latest/download/latest.json"
        ]
      }
    }
    ```
  - [ ] The endpoint is the **static-JSON-on-GitHub-Releases** pattern the architecture spine's Stack table already names (`ARCHITECTURE-SPINE.md` line 214: "Update feed | static-JSON on GitHub Releases / S3") — `tauri-action` uploads `latest.json` to the release by default (`uploadUpdaterJson: true`, confirmed via `tauri-action`'s own README, fetched live this session) whenever `plugins.updater` is configured. No `{{target}}/{{arch}}/{{current_version}}` templating needed — that pattern is for a dynamic update *server*, not this static-file approach. Confirmed repo slug via `git remote -v`: `5arjun/curfew.vip`.
  - [ ] `<TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER>` is a **deliberate placeholder**, same pattern as 2.9b's `<AZURE_ARTIFACT_SIGNING_ENDPOINT>` — the real public key doesn't exist until Task 4's keypair is generated (Arjun's manual step, see below). Do not fabricate a key.

- [ ] **Task 3: Wire the signing secrets into both release workflows** (AC: #2)
  - [ ] Add to the `env:` block of the `tauri-apps/tauri-action` step in **both** `.github/workflows/release-macos.yml` and `.github/workflows/release-windows.yml`:
    ```yaml
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
    ```
  - [ ] **This keypair is intentionally the same two secrets in both workflows** — AC2 says "a separate mandatory update-signing keypair, distinct from the platform code-signing certs," meaning distinct from `APPLE_*`/`AZURE_*`, not a separate updater key per OS. One updater keypair signs update artifacts for both platforms; each workflow's `tauri-action` step signs its own OS's bundle output with it.
  - [ ] Update both workflows' header comments (mirroring the existing style — see `release-macos.yml:1-27`, `release-windows.yml:1-39`) to note the updater-signing secrets and that `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional (empty/unset if the keypair was generated without a password).
  - [ ] Confirm via `tauri-action`'s README (`uploadUpdaterSignatures`, default `true`) that `.sig` files upload automatically alongside `latest.json` — no additional `with:` flags needed on either workflow's existing `tauri-action` step.

- [ ] **Task 4: Fix hardcoded `0.0.0` app version — required for the updater to mean anything** (AC: #1)
  - [ ] This closes the item deferred from Story 2.9a's code review (`deferred-work.md`, "App version stays hardcoded `0.0.0`... will matter once Story 2.9c's auto-updater needs a real version to compare against") — **do not skip this**, an updater that always sees version `0.0.0` can never detect "is a newer version available."
  - [ ] Add a step to **both** `release-macos.yml` and `release-windows.yml`, before the `tauri-action` step, that derives the version from the pushed tag (`agent-v1.2.3` → `1.2.3`) and writes it into `tauri.conf.json`, `Cargo.toml`, and `package.json` — a small Node one-liner is the right tool (Node/pnpm is already set up in both workflows; no new dependency):
    ```yaml
    - name: Sync app version from git tag
      run: |
        VERSION="${GITHUB_REF_NAME#agent-v}"
        node -e "
          const fs = require('fs');
          const confPath = 'agent/src-tauri/tauri.conf.json';
          const conf = JSON.parse(fs.readFileSync(confPath, 'utf8'));
          conf.version = process.argv[1];
          fs.writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');
          const pkgPath = 'agent/package.json';
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          pkg.version = process.argv[1];
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        " "$VERSION"
        sed -i.bak "s/^version = \"0.0.0\"/version = \"$VERSION\"/" agent/src-tauri/Cargo.toml && rm agent/src-tauri/Cargo.toml.bak
      shell: bash
    ```
  - [ ] **Windows caveat**: `windows-latest` runners default to PowerShell — the step above needs `shell: bash` explicitly (Git Bash ships on `windows-latest`) so `${GITHUB_REF_NAME#agent-v}` bash-substitution and the `sed`/sed-with-`.bak` idiom work identically on both OSes; verify this actually runs green on the Windows runner, don't assume parity.
  - [ ] `tauri.conf.json`'s `version` is the one that's load-bearing for the updater/bundler (what `tauri-action` embeds in `latest.json` and what the plugin compares against `current_version`) — `Cargo.toml`/`package.json` are synced too for consistency (avoids a shipped agent whose `--version` flag or `package.json` disagree with its own update manifest) but are not independently consumed by the updater.
  - [ ] This step mutates committed files (`tauri.conf.json`, `Cargo.toml`, `package.json`) **only in the ephemeral CI runner's checkout** — never commit the version bump back to the repo. Confirm neither workflow has a `git commit`/`git push` step (it shouldn't, and adding one is out of scope here).
  - [ ] `agent/src-tauri/Cargo.lock` **is committed** to the repo and will show its `agent` package entry as stale relative to the patched `Cargo.toml` — confirmed harmless: neither `release-macos.yml` nor `release-windows.yml` invokes `cargo`/`tauri build` with `--locked` or `--frozen` anywhere (checked both files; the only `--locked` in either release pipeline is `cargo install artifact-signing-cli --locked` in `release-windows.yml`, unrelated to this package), so `cargo build`'s internal Cargo.lock rewrite for the local package proceeds without error. Confirm this holds if either workflow's flags ever change.

- [ ] **Task 5: Document the keypair-generation step + update the tracking docs** (AC: #2)
  - [ ] Extend `agent/README.md`'s "Release builds" section (added 2.9a, extended 2.9b) with a short paragraph: both release workflows now also produce a signed `latest.json` update manifest via the same tag push, using a separate updater keypair (not the platform code-signing certs) — link to the checklist row below for the provisioning command, don't restate it.
  - [ ] Update `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md`:
    - Add a **new row** in section 3 ("Tied to a specific story/epic"), after the existing Windows code-signing row (row 30), titled **"Tauri updater signing keypair"**. Content: the exact one-time generation command —
      ```
      pnpm dlx @tauri-apps/cli@latest signer generate -w ~/.tauri/curfew-agent-updater.key
      ```
      — produces `curfew-agent-updater.key` (private) and `curfew-agent-updater.key.pub` (public); explain the public-key content replaces `<TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER>` in `agent/src-tauri/tauri.conf.json` (committed, safe to share), while the private key content becomes the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret (and, if a password was set when prompted, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) — **never commit the `.key` file itself**. This is a pure local crypto operation with no external account/eligibility/cost gate (unlike the Apple/Azure rows) — Arjun can run it any time, no waiting period.
    - Extend row 32 ("GitHub Actions CI secrets") with a **Story 2.9c** paragraph (same pattern as the existing 2.9a/2.9b paragraphs in that cell): `TAURI_SIGNING_PRIVATE_KEY` (required), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional, only if the keypair was generated with a password) — not yet added, blocks a real signed release the same way the Apple/Azure secrets do, but unlike those this one isn't gated on an external provisioning step, only on Arjun running the one command above.
  - [ ] Update `_bmad-output/implementation-artifacts/deferred-work.md`: mark the "App version stays hardcoded `0.0.0`..." entry (under "Deferred from: code review of 2-9a...") as **resolved by this story** (Task 4) — don't delete the entry, annotate it `[RESOLVED <date>, Story 2.9c]` per this file's own existing convention (see the two `[RESOLVED ...]` entries already in the file for the exact format to match).

- [ ] **Task 6: Gate green**
  - [ ] Run the four-command Rust gate (`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo build`, `cargo test`, all `--manifest-path agent/src-tauri/Cargo.toml`) — expect a green baseline matching 2.9b's (215 unit + 9 integration tests); the only new Rust surface is the one-line plugin registration in `lib.rs`, so watch for `clippy -D warnings` on the new `.plugin(...)` call specifically, but no new application logic needs new tests.
  - [ ] Run `pnpm lint && pnpm typecheck && pnpm build` (repo root) to confirm the `tauri.conf.json`/`Cargo.toml`/`package.json` edits and new workflow YAML didn't break anything workspace-wide.
  - [ ] Manually validate: `tauri.conf.json` and `agent/package.json` are well-formed JSON (`JSON.parse` via `node -e`, same technique 2.9a/2.9b used); both modified workflow YAML files are well-formed (repo's vendored `js-yaml` via `node -e`); `Cargo.toml` still parses (`cargo metadata --manifest-path agent/src-tauri/Cargo.toml --no-deps` is a cheap parse-only check).
  - [ ] A real end-to-end signed release with real updater artifacts **cannot** be triggered in this dev session — no `TAURI_SIGNING_PRIVATE_KEY` secret exists yet (Task 5). That verification is Arjun's job once he's run the keygen command and added the secrets.
  - [ ] Confirm zero changes to `.github/workflows/ci.yml`, `agent/src-tauri/tauri.windows-release.conf.json`, and `agent/src-tauri/capabilities/default.json`'s `windows`/`identifier`/`description` fields (only its `permissions` array gets the one new entry) — same "confirm the untouched surface stayed untouched" discipline 2.9a/2.9b's own Task 5/6 applied.

## Dev Notes

- **What this story is and isn't**: primarily a CI/build-pipeline story like 2.9a/2.9b, but with one small, deliberate exception — Task 1 touches `agent/src-tauri/src/lib.rs` (one line, plugin registration) and `capabilities/default.json` (one line, permission grant), because unlike the platform code-signing certs, the updater keypair/config is meaningless without the Rust plugin actually being present to consume it. This is *not* a scope-creep precedent for 2.9a/2.9b-style stories generally — it's specific to the updater's plugin-based architecture in Tauri v2 (code-signing has no equivalent "plugin," it's pure bundler config).
- **Why no runtime "check for updates" call**: neither AC asks for it, and no UX doc specifies *when* a check should fire (app launch? background interval? a tray menu item?). Story 3.4 ("Format-drift resilience + backfill") is the epic's dedicated home for what happens *after* an update ships — "affected sets backfill from raw data retained in local SQLite" (AR-7 layer 3) presupposes the update mechanism already works, which is exactly what this story delivers, but 3.4 doesn't specify a trigger either. Flag this as a real, not-yet-owned gap for Arjun rather than guessing: **something, somewhere, eventually needs to call `check()`/`downloadAndInstall()` — no current story owns writing that call.**
- **The version-sync fix (Task 4) is not optional scope creep** — it's explicitly named in `deferred-work.md` as blocking this exact story ("will matter once Story 2.9c's auto-updater needs a real version to compare against"). Skipping it would ship a technically-complete signed-artifact pipeline that can never actually detect an available update, since every release would claim to be `0.0.0`.
- **Updater keypair vs. platform code-signing certs — why they're different secrets**: AC2 is explicit that the updater key is "distinct from the platform code-signing certs" (`APPLE_*`/`AZURE_*` from 2.9a/2.9b). Platform certs prove *the binary came from a verified publisher* (OS-level Gatekeeper/SmartScreen trust); the updater keypair proves *this specific update artifact wasn't tampered with in transit* (the Tauri updater plugin's own trust chain, independent of the OS). One updater keypair is shared across both OS release workflows — there's no "macOS updater key" vs. "Windows updater key," only "macOS code-signing cert" vs. "Windows code-signing cert" vs. one shared "updater signing key."
- **Why the updater keypair doesn't belong in Task 5's "Arjun's manual provisioning" framing the same way Apple/Azure do**: those require an external account, identity verification, and (for Azure) a paid subscription with a geographic eligibility gate — genuine multi-day/week external dependencies this story's code cannot resolve. The updater keypair is a local `tauri signer generate` command with zero external dependency — technically the dev agent *could* run it, but per this repo's own established discipline (2.9a/2.9b never touch real secret material, only wire the pipeline to expect it), and because a private signing key is exactly the kind of material that shouldn't pass through an LLM agent's context/transcript if avoidable, this story documents the exact command and leaves execution to Arjun. This is a judgment call, not a hard constraint — flagged in Dev Agent Record if reconsidered.
- **`ci.yml` is untouched by design**, same reasoning as every prior 2.9x story — release workflows are per-OS, tag-triggered, independent of the PR/push-to-main Linux-only gate.
- **Testing shape**: almost entirely procedural/manual, same as 2.9a/2.9b — the only new Rust surface is a one-line plugin registration, not new application logic, so no new unit tests are expected. Task 6's gate-green + manual JSON/YAML validation is the right bar.

### Project Structure Notes

- New: nothing (no new files this story — contrast with 2.9a/2.9b, which each added a new workflow + new partial-config file; this story only extends existing files).
- Modified: `agent/src-tauri/Cargo.toml` (new dependency), `agent/src-tauri/src/lib.rs` (plugin registration, +1 line), `agent/src-tauri/capabilities/default.json` (+1 permission), `agent/src-tauri/tauri.conf.json` (`bundle.createUpdaterArtifacts` + new `plugins.updater` block), `.github/workflows/release-macos.yml` and `.github/workflows/release-windows.yml` (version-sync step + `TAURI_SIGNING_*` env vars + header comment updates), `agent/README.md`, `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md`, `_bmad-output/implementation-artifacts/deferred-work.md`.
- Not modified: `.github/workflows/ci.yml`, `agent/src-tauri/tauri.windows-release.conf.json` (Story 2.9b's Windows-signing-only partial config — this story's version-sync step touches the *base* `tauri.conf.json`, never this file), anything under `agent/ui/` (no frontend consumer added, see Task 1).
- Dependency direction (AD-3) unaffected: this story touches `agent/` and repo-root `.github/` only, never `shared/` or `web/`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.9c, lines 537-546] — story ACs, canonical text.
- [Source: _bmad-output/planning-artifacts/epics.md#Sizing note, line 513] — 2.9a/2.9b/2.9c split rationale.
- [Source: _bmad-output/planning-artifacts/epics.md#AR-7, line 81] — three format-drift layers, this story owns layer 3's delivery mechanism (not the backfill logic, that's Story 3.4).
- [Source: _bmad-output/planning-artifacts/epics.md#AR-14, line 88] — "Signed Tauri auto-updater uses a separate mandatory update-signing keypair."
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md, lines 213-214, 268, 272] — `tauri-action` as CI/release tool; "Update feed: static-JSON on GitHub Releases / S3"; deployment-table confirmation of the separate updater keypair.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md, "Deferred from: code review of 2-9a..."] — the hardcoded `0.0.0` version item this story's Task 4 closes.
- [Source: _bmad-output/implementation-artifacts/2-9b-windows-signed-build.md] — full prior story: exact-commit `tauri-action` pin to reuse, header-comment style, "don't touch the base config, let CI supply the difference" principle (extended here to a version-sync step instead of a merged partial-config file, since version needs to land in the *base* config for the updater to read it).
- [Source: .github/workflows/release-macos.yml] — exact `tauri-action` pin (`1deb371b0cd8bd54025b384f1cd735e725c4060f` # v1), header-comment style, `env:`-block secret-wiring pattern to extend.
- [Source: .github/workflows/release-windows.yml] — same pin (confirmed identical, per 2.9b's own "reused, not re-resolved" note), `shell:`-agnostic step pattern (no explicit `shell:` set anywhere yet in this workflow — Task 4's new step is the first to need one).
- [Source: agent/src-tauri/tauri.conf.json] — current state: `version: "0.0.0"`, no `plugins` block, `bundle` has no `createUpdaterArtifacts`.
- [Source: agent/src-tauri/src/lib.rs, lines 110-118] — existing `tauri::Builder` plugin-registration pattern (`tauri_plugin_dialog::init()`) to mirror exactly.
- [Source: agent/src-tauri/capabilities/default.json] — existing `permissions` array (`core:default`, `dialog:allow-open`) to extend.
- [Tauri v2 Updater Plugin docs](https://v2.tauri.app/plugin/updater/) — fetched live this session: `cargo add tauri-plugin-updater`, `bundle.createUpdaterArtifacts`, `plugins.updater.pubkey`/`endpoints`, keypair generation via `tauri signer generate`, `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` env vars (must be literal env vars at build time — `.env` files don't work), `updater:default` capability permission set.
- [`tauri-apps/tauri-action` README](https://github.com/tauri-apps/tauri-action) — fetched live this session via `gh api`: `uploadUpdaterJson` (default `true`, produces `latest.json`, "only relevant if the updater is configured"), `uploadUpdaterSignatures` (default `true`, uploads `.sig` files) — confirms Task 3 needs no new `with:` flags on either workflow, only the signing env vars.
- Repo remote confirmed via `git remote -v`: `5arjun/curfew.vip` — used for the static `latest.json` endpoint URL in Task 2.

## Previous Story Intelligence

- **Story 2.9b** (review, most recent, same sub-split sibling): established the exact-commit `tauri-action` pin to reuse verbatim, the header-comment documentation style both workflows now follow, and the "base config stays clean, CI/a merge supplies the signing difference" principle — this story's Task 4 version-sync step is a variant of that same principle (mutate only the CI runner's ephemeral checkout, never the committed base file for real). 2.9b's own review-round precedent (not yet run, story still in `review`) is worth checking once available, but wasn't required to draft this story — its *first-draft* Dev Notes/Tasks were sufficient context.
- **Story 2.9a** (done): the origin of the exact-commit pin and the `permissions: contents: write` / `concurrency:` / `timeout-minutes:` pattern both workflows now share — nothing new to add here beyond what 2.9b already inherited and this story inherits transitively.
- **Story 2.8** (done): no CI/build-pipeline overlap, confirms the four-command cargo gate convention Task 6 reuses.

## Git Intelligence Summary

- Commit convention to match: `Story 2.9c: <what changed>` for implementation, `Story 2.9c: Code review round — N patches applied, M deferred` for the review-closing commit — same pattern as `909b152` (2.9a) and the uncommitted 2.9b session.
- Working tree at story creation time: HEAD `909b152` (2.9a's review-closing commit), with Story 2.9b's dev-story session **uncommitted** in the working tree (`release-windows.yml`, `tauri.windows-release.conf.json` untracked; `agent/README.md`, `pre-launch-services-checklist.md`, `sprint-status.yaml` modified) — per Arjun's instruction, these are committed together with this story file once this story is created, not separately.
- No `plugins.updater` block, `createUpdaterArtifacts`, or `tauri-plugin-updater` dependency exists anywhere in the repo yet — confirmed via direct file reads this session, this is genuinely new.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created.
