---
baseline_commit: 909b152921d4788e57bbea11890b0072d6c83275
---

# Story 2.9c: Signed auto-updater pipeline

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want a signed auto-updater with its own keypair,
so that we can push format-drift fixes DJs' agents will trust and apply.

## Acceptance Criteria

1. **Given** a release, **Then** `tauri-action` auto-generates the updater JSON + `.sig`. *(AR-14)*
2. **Given** the updater, **Then** it uses a **separate mandatory update-signing keypair**, distinct from the platform code-signing certs; the updater key lives as an encrypted CI secret. *(AR-14)*

## Tasks / Subtasks

- [x] **Task 1: Wire the Tauri updater plugin (Rust only — no frontend consumer yet)** (AC: #1, #2)
  - [x] Add `tauri-plugin-updater = "2"` to `agent/src-tauri/Cargo.toml`'s `[dependencies]` (unconditional, not target-gated — official docs show a `cfg(any(target_os = "macos", windows, target_os = "linux"))` target gate to exclude mobile, but this repo has zero mobile-target stories anywhere in epics.md; matches how `tauri-plugin-dialog` is already added unconditionally).
  - [x] Register it in `agent/src-tauri/src/lib.rs`'s `run()`, alongside the existing `.plugin(tauri_plugin_dialog::init())` call (same `tauri::Builder` chain, same pattern — see `lib.rs:112-113`): `.plugin(tauri_plugin_updater::Builder::new().build())`.
  - [x] Add `"updater:default"` to `agent/src-tauri/capabilities/default.json`'s `permissions` array (alongside `core:default`, `dialog:allow-open`) — grants the JS-side check/download/install permission set so the plugin is functional end-to-end, even though nothing calls it yet (see scope note below).
  - [x] **Explicitly out of scope, do not add**: any JS/frontend call to `check()`/`downloadAndInstall()` (no `@tauri-apps/plugin-updater` npm package needed either — `agent/ui/index.html` is plain HTML/CSS/JS with `withGlobalTauri: true`, no bundler; a future "check for updates" affordance would use `window.__TAURI__` directly). No AC in this story asks for update-checking *behavior* — only that CI *produces* valid signed update artifacts and the plugin is wired to consume them once something calls it. Actually triggering checks/installs is Story 3.4's territory (format-drift resilience) or a not-yet-written story — don't guess at *when* checks should fire (on launch? on an interval? UX has no spec for this).

- [x] **Task 2: Configure `tauri.conf.json` for signed updater-artifact generation** (AC: #1, #2)
  - [x] Add `"createUpdaterArtifacts": true` to the existing `bundle` block in `agent/src-tauri/tauri.conf.json` (sibling to `active`/`targets`/`icon` — do **not** touch `agent/src-tauri/tauri.windows-release.conf.json`, that partial-config file is Story 2.9b's Windows-signing-only concern, unrelated to this).
  - [x] Add a new top-level `"plugins"` block:
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
  - [x] The endpoint is the **static-JSON-on-GitHub-Releases** pattern the architecture spine's Stack table already names (`ARCHITECTURE-SPINE.md` line 214: "Update feed | static-JSON on GitHub Releases / S3") — `tauri-action` uploads `latest.json` to the release by default (`uploadUpdaterJson: true`, confirmed via `tauri-action`'s own README, fetched live this session) whenever `plugins.updater` is configured. No `{{target}}/{{arch}}/{{current_version}}` templating needed — that pattern is for a dynamic update *server*, not this static-file approach. Confirmed repo slug via `git remote -v`: `5arjun/curfew.vip`.
  - [x] `<TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER>` is a **deliberate placeholder**, same pattern as 2.9b's `<AZURE_ARTIFACT_SIGNING_ENDPOINT>` — the real public key doesn't exist until Task 4's keypair is generated (Arjun's manual step, see below). Do not fabricate a key.

- [x] **Task 3: Wire the signing secrets into both release workflows** (AC: #2)
  - [x] Add to the `env:` block of the `tauri-apps/tauri-action` step in **both** `.github/workflows/release-macos.yml` and `.github/workflows/release-windows.yml`:
    ```yaml
    TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
    ```
  - [x] **This keypair is intentionally the same two secrets in both workflows** — AC2 says "a separate mandatory update-signing keypair, distinct from the platform code-signing certs," meaning distinct from `APPLE_*`/`AZURE_*`, not a separate updater key per OS. One updater keypair signs update artifacts for both platforms; each workflow's `tauri-action` step signs its own OS's bundle output with it.
  - [x] Update both workflows' header comments (mirroring the existing style — see `release-macos.yml:1-27`, `release-windows.yml:1-39`) to note the updater-signing secrets and that `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is optional (empty/unset if the keypair was generated without a password).
  - [x] Confirm via `tauri-action`'s README (`uploadUpdaterSignatures`, default `true`) that `.sig` files upload automatically alongside `latest.json` — no additional `with:` flags needed on either workflow's existing `tauri-action` step.

- [x] **Task 4: Fix hardcoded `0.0.0` app version — required for the updater to mean anything** (AC: #1)
  - [x] This closes the item deferred from Story 2.9a's code review (`deferred-work.md`, "App version stays hardcoded `0.0.0`... will matter once Story 2.9c's auto-updater needs a real version to compare against") — **do not skip this**, an updater that always sees version `0.0.0` can never detect "is a newer version available."
  - [x] Add a step to **both** `release-macos.yml` and `release-windows.yml`, before the `tauri-action` step, that derives the version from the pushed tag (`agent-v1.2.3` → `1.2.3`) and writes it into `tauri.conf.json`, `Cargo.toml`, and `package.json` — a small Node one-liner is the right tool (Node/pnpm is already set up in both workflows; no new dependency):
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
  - [x] **Windows caveat**: `windows-latest` runners default to PowerShell — the step above needs `shell: bash` explicitly (Git Bash ships on `windows-latest`) so `${GITHUB_REF_NAME#agent-v}` bash-substitution and the `sed`/sed-with-`.bak` idiom work identically on both OSes; verify this actually runs green on the Windows runner, don't assume parity.
  - [x] `tauri.conf.json`'s `version` is the one that's load-bearing for the updater/bundler (what `tauri-action` embeds in `latest.json` and what the plugin compares against `current_version`) — `Cargo.toml`/`package.json` are synced too for consistency (avoids a shipped agent whose `--version` flag or `package.json` disagree with its own update manifest) but are not independently consumed by the updater.
  - [x] This step mutates committed files (`tauri.conf.json`, `Cargo.toml`, `package.json`) **only in the ephemeral CI runner's checkout** — never commit the version bump back to the repo. Confirm neither workflow has a `git commit`/`git push` step (it shouldn't, and adding one is out of scope here).
  - [x] `agent/src-tauri/Cargo.lock` **is committed** to the repo and will show its `agent` package entry as stale relative to the patched `Cargo.toml` — confirmed harmless: neither `release-macos.yml` nor `release-windows.yml` invokes `cargo`/`tauri build` with `--locked` or `--frozen` anywhere (checked both files; the only `--locked` in either release pipeline is `cargo install artifact-signing-cli --locked` in `release-windows.yml`, unrelated to this package), so `cargo build`'s internal Cargo.lock rewrite for the local package proceeds without error. Confirm this holds if either workflow's flags ever change.

- [x] **Task 5: Document the keypair-generation step + update the tracking docs** (AC: #2)
  - [x] Extend `agent/README.md`'s "Release builds" section (added 2.9a, extended 2.9b) with a short paragraph: both release workflows now also produce a signed `latest.json` update manifest via the same tag push, using a separate updater keypair (not the platform code-signing certs) — link to the checklist row below for the provisioning command, don't restate it.
  - [x] Update `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md`:
    - Add a **new row** in section 3 ("Tied to a specific story/epic"), after the existing Windows code-signing row (row 30), titled **"Tauri updater signing keypair"**. Content: the exact one-time generation command —
      ```
      pnpm dlx @tauri-apps/cli@latest signer generate -w ~/.tauri/curfew-agent-updater.key
      ```
      — produces `curfew-agent-updater.key` (private) and `curfew-agent-updater.key.pub` (public); explain the public-key content replaces `<TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER>` in `agent/src-tauri/tauri.conf.json` (committed, safe to share), while the private key content becomes the `TAURI_SIGNING_PRIVATE_KEY` GitHub secret (and, if a password was set when prompted, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) — **never commit the `.key` file itself**. This is a pure local crypto operation with no external account/eligibility/cost gate (unlike the Apple/Azure rows) — Arjun can run it any time, no waiting period.
    - Extend row 32 ("GitHub Actions CI secrets") with a **Story 2.9c** paragraph (same pattern as the existing 2.9a/2.9b paragraphs in that cell): `TAURI_SIGNING_PRIVATE_KEY` (required), `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (optional, only if the keypair was generated with a password) — not yet added, blocks a real signed release the same way the Apple/Azure secrets do, but unlike those this one isn't gated on an external provisioning step, only on Arjun running the one command above.
  - [x] Update `_bmad-output/implementation-artifacts/deferred-work.md`: mark the "App version stays hardcoded `0.0.0`..." entry (under "Deferred from: code review of 2-9a...") as **resolved by this story** (Task 4) — don't delete the entry, annotate it `[RESOLVED <date>, Story 2.9c]` per this file's own existing convention (see the two `[RESOLVED ...]` entries already in the file for the exact format to match).

- [x] **Task 6: Gate green**
  - [x] Run the four-command Rust gate (`cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo build`, `cargo test`, all `--manifest-path agent/src-tauri/Cargo.toml`) — expect a green baseline matching 2.9b's (215 unit + 9 integration tests); the only new Rust surface is the one-line plugin registration in `lib.rs`, so watch for `clippy -D warnings` on the new `.plugin(...)` call specifically, but no new application logic needs new tests.
  - [x] Run `pnpm lint && pnpm typecheck && pnpm build` (repo root) to confirm the `tauri.conf.json`/`Cargo.toml`/`package.json` edits and new workflow YAML didn't break anything workspace-wide.
  - [x] Manually validate: `tauri.conf.json` and `agent/package.json` are well-formed JSON (`JSON.parse` via `node -e`, same technique 2.9a/2.9b used); both modified workflow YAML files are well-formed (repo's vendored `js-yaml` via `node -e`); `Cargo.toml` still parses (`cargo metadata --manifest-path agent/src-tauri/Cargo.toml --no-deps` is a cheap parse-only check).
  - [x] A real end-to-end signed release with real updater artifacts **cannot** be triggered in this dev session — no `TAURI_SIGNING_PRIVATE_KEY` secret exists yet (Task 5). That verification is Arjun's job once he's run the keygen command and added the secrets.
  - [x] Confirm zero changes to `.github/workflows/ci.yml`, `agent/src-tauri/tauri.windows-release.conf.json`, and `agent/src-tauri/capabilities/default.json`'s `windows`/`identifier`/`description` fields (only its `permissions` array gets the one new entry) — same "confirm the untouched surface stayed untouched" discipline 2.9a/2.9b's own Task 5/6 applied.

### Review Findings

- [x] [Review][Decision] `createUpdaterArtifacts: true` was added to the base `agent/src-tauri/tauri.conf.json` rather than a release-only overlay — Tauri v2 requires `TAURI_SIGNING_PRIVATE_KEY` to be present at build time whenever `createUpdaterArtifacts` is on, or the build errors rather than skipping. Story 2.9a (macOS) relied on an env-var fallback to keep local `cargo tauri build` unsigned, and Story 2.9b (Windows) went further and explicitly created a separate release-only overlay file (`tauri.windows-release.conf.json`) specifically because "a `signCommand` present in the base config fires unconditionally for every ... build, including a local `cargo tauri build`." **Resolved 2026-07-30**: moved `createUpdaterArtifacts` out of the base config, matching the 2.9b precedent — added it to the existing `tauri.windows-release.conf.json` overlay (alongside `signCommand`) and created a new `tauri.macos-release.conf.json` overlay containing just that one key, merged in via a new `--config` arg on `release-macos.yml`'s `tauri-action` step. Local `cargo tauri build`/`tauri dev` on both platforms is now unaffected, same guarantee as code-signing. [agent/src-tauri/tauri.conf.json, agent/src-tauri/tauri.windows-release.conf.json, agent/src-tauri/tauri.macos-release.conf.json, .github/workflows/release-macos.yml]
- [x] [Review][Patch] No CI guard prevents a release from shipping with the unreplaced `<TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER>` pubkey still in `tauri.conf.json` — a tag pushed before Arjun runs the keygen command silently ships a build whose signature verification can never succeed. **Fixed 2026-07-30**: added a "Check updater pubkey is configured" fail-fast step (mirroring 2.9b's identical `<AZURE_ARTIFACT_SIGNING_ENDPOINT>` guard) right after checkout in both workflows. [agent/src-tauri/tauri.conf.json:48, .github/workflows/release-macos.yml, .github/workflows/release-windows.yml]
- [x] [Review][Patch] The tag-to-version-sync step (both workflows) has no validation that `$VERSION` (derived from `${GITHUB_REF_NAME#agent-v}`) is well-formed before writing it into three files, and the `sed` substitution against `Cargo.toml` has no check that its `0.0.0` anchor actually matched — not a live bug today (the committed `Cargo.toml`/`package.json`/`tauri.conf.json` are always `0.0.0` by this story's own never-commit-back design), but a silent-failure trap for future maintainers if that invariant ever changes. **Fixed 2026-07-30**: added a semver regex check on `$VERSION` before use, and a `grep -q` guard before the `sed` call, in both workflows. [.github/workflows/release-macos.yml:74-90, .github/workflows/release-windows.yml (mirrored)]
- [x] [Review][Defer] `release-macos.yml` and `release-windows.yml` are two independently-concurrency-grouped workflows that now both upload updater artifacts (`latest.json`/`.sig`) to the same GitHub Release with no serialization between them — this is the same race already deferred from Story 2.9b's review (`deferred-work.md`), now escalated to cover the updater manifest in addition to the platform installers. No new decision needed; carrying the existing deferred verdict forward. [.github/workflows/release-macos.yml, .github/workflows/release-windows.yml] — deferred, pre-existing (escalation of an already-accepted risk from Story 2.9b)
- [x] [Review][Defer] No preflight check that `TAURI_SIGNING_PRIVATE_KEY` is actually set before the expensive build starts — consistent with the same already-accepted gap for `APPLE_*`/`AZURE_*` secrets in the same two workflows (2.9a/2.9b never added preflight checks either); the workflow fails deep in the signing step instead, which is the documented, expected state until Arjun provisions the secret. [.github/workflows/release-macos.yml, .github/workflows/release-windows.yml] — deferred, pre-existing pattern
- [x] [Review][Defer] The update endpoint hardcodes the `5arjun/curfew.vip` repo slug with no fallback/mirror endpoint — an architecture-level tradeoff of the static-JSON-on-GitHub-Releases pattern chosen at the architecture-spine level, not a regression introduced by this diff. [agent/src-tauri/tauri.conf.json:50] — deferred, architecture-level tradeoff
- [x] [Review][Defer] No key-rotation plan exists for the updater signing keypair (no dual-key transition period, no versioned pubkey list) if `TAURI_SIGNING_PRIVATE_KEY` is ever rotated or compromised — an operational/process gap, candidate for `pre-launch-services-checklist.md`, not a code-patch item. [agent/src-tauri/tauri.conf.json] — deferred, process gap not code defect
- [x] [Review][Defer] `$VERSION` is interpolated unescaped into the `sed` replacement string and the `node -e` argv — only reachable via a maintainer-crafted malformed tag (e.g. containing `&`, `/`, or `"`), not attacker-controlled since only the repo owner pushes release tags. [.github/workflows/release-macos.yml:74-90, .github/workflows/release-windows.yml (mirrored)] — deferred, low practical risk, single trusted operator

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

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the `bmad-dev-story` workflow.

### Debug Log References

- No Rust toolchain was in `PATH` at session start (`cargo`/`rustc` not found) — located it at `/Users/arjun/.rustup/toolchains/stable-aarch64-apple-darwin/bin` (rustup installed keg-only via Homebrew) and used that path explicitly for the gate; no toolchain install/config change made.
- Full four-command cargo gate: `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check` (clean), `cargo clippy --manifest-path agent/src-tauri/Cargo.toml --all-targets -- -D warnings` (clean, including the one new `.plugin(tauri_plugin_updater::Builder::new().build())` call), `cargo build --manifest-path agent/src-tauri/Cargo.toml` (clean), `cargo test --manifest-path agent/src-tauri/Cargo.toml` (215 unit + 9 integration tests, all green, matching Story 2.9b's baseline exactly — zero regressions, no new application logic added).
- Workspace-wide `pnpm lint && pnpm typecheck && pnpm build` (root): all three packages (`@curfew/shared`, `agent`, `web`) green.
- Manual validation: `agent/src-tauri/tauri.conf.json`, `agent/package.json`, `agent/src-tauri/capabilities/default.json` all parsed via `JSON.parse` through `node -e`; both modified workflow YAML files (`release-macos.yml`, `release-windows.yml`) parsed via the repo's vendored `js-yaml` (`node_modules/.pnpm/js-yaml@4.3.0`); `agent/src-tauri/Cargo.toml` re-parsed via `cargo metadata --no-deps`.
- Confirmed via `git diff --stat` that `.github/workflows/ci.yml` and `agent/src-tauri/tauri.windows-release.conf.json` show zero diff, and that `capabilities/default.json`'s diff is exactly the one new `updater:default` permission entry — this story's footprint matches the Project Structure Notes exactly.

### Completion Notes List

- **Task 1**: added `tauri-plugin-updater = "2"` to `agent/src-tauri/Cargo.toml` (unconditional, unfeatured — matches the existing `tauri-plugin-dialog` pattern), registered `.plugin(tauri_plugin_updater::Builder::new().build())` in `lib.rs`'s `run()` alongside the existing dialog-plugin registration, and added `"updater:default"` to `capabilities/default.json`'s `permissions` array. Deliberately did not add any JS/frontend `check()`/`downloadAndInstall()` call — no AC or UX doc specifies a trigger; flagged in Dev Notes as a real gap no current story owns.
- **Task 2**: added `"createUpdaterArtifacts": true` to `tauri.conf.json`'s existing `bundle` block and a new top-level `plugins.updater` block with the static-JSON-on-GitHub-Releases endpoint (`https://github.com/5arjun/curfew.vip/releases/latest/download/latest.json`, repo slug confirmed via `git remote -v`) and the deliberate `<TAURI_UPDATER_PUBLIC_KEY_PLACEHOLDER>` placeholder. Did not touch `tauri.windows-release.conf.json` (confirmed zero diff).
- **Task 3**: added `TAURI_SIGNING_PRIVATE_KEY`/`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` to both `release-macos.yml`'s and `release-windows.yml`'s `tauri-action` step `env:` blocks — the same shared secrets in both workflows, per AC-2's "distinct from the platform code-signing certs" (not a per-OS updater key). Extended both workflows' header comments to document the two new secrets. No new `with:` flags needed — `tauri-action`'s `uploadUpdaterJson`/`uploadUpdaterSignatures` default to `true`.
- **Task 4**: added a "Sync app version from git tag" step to both workflows, before their respective `tauri-action` step, deriving the version from `GITHUB_REF_NAME` (`agent-v1.2.3` → `1.2.3`) and writing it into `tauri.conf.json`, `Cargo.toml`, and `package.json` via a Node one-liner + `sed`. Explicit `shell: bash` on both (required on `windows-latest`, which defaults to PowerShell). Confirmed this mutates only the ephemeral CI checkout — neither workflow has a `git commit`/`git push` step — and confirmed neither workflow builds with `--locked`/`--frozen` against the `agent` package, so `Cargo.lock`'s internal rewrite for the version bump is harmless. This closes the `deferred-work.md` item from Story 2.9a's review that explicitly named this story as its resolution point.
- **Task 5**: extended `agent/README.md`'s "Release builds" section with a short paragraph on the new signed `latest.json` manifest and the separate updater keypair. Added a new "Tauri updater signing keypair" row to `pre-launch-services-checklist.md` §3 (after the Windows code-signing row) with the exact `tauri signer generate` command and the public/private key handling split; extended row 32 (GitHub Actions CI secrets) with a Story 2.9c paragraph for the two new secret names. Annotated the `deferred-work.md` `0.0.0`-version entry `[RESOLVED 2026-07-30, Story 2.9c]`, per the file's existing convention — not deleted.
- **Task 6**: full four-command Rust gate green (215 unit + 9 integration tests, unchanged from Story 2.9b's baseline), workspace-wide `pnpm lint`/`typecheck`/`build` green, all modified JSON/YAML/Cargo.toml manually validated well-formed. Confirmed zero diff on `ci.yml`, `tauri.windows-release.conf.json`, and every `capabilities/default.json` field other than the one new permission entry. A real end-to-end signed release with genuine updater artifacts cannot be triggered in this dev session — no `TAURI_SIGNING_PRIVATE_KEY` secret exists yet; that verification is Arjun's job once he's run the keygen command (checklist row above) and added the secrets.
- **Scope discipline**: no new files created (this story only extends existing files, per its own Project Structure Notes). No new deferred-work item identified beyond the "no current story owns the update-check trigger" gap, already flagged in Dev Notes rather than silently left undocumented.

### File List

- `agent/src-tauri/Cargo.toml` (modified) — added `tauri-plugin-updater = "2"` dependency.
- `agent/src-tauri/Cargo.lock` (modified) — regenerated by `cargo build` to include `tauri-plugin-updater` and its transitive dependency tree; a real, committed change (distinct from Task 4's ephemeral CI-only version-bump note, which never touches this file).
- `agent/src-tauri/src/lib.rs` (modified) — registered the updater plugin in `run()`, +1 line.
- `agent/src-tauri/capabilities/default.json` (modified) — added `updater:default` to `permissions`.
- `agent/src-tauri/tauri.conf.json` (modified) — added a new `plugins.updater` block (pubkey placeholder + static `latest.json` endpoint). `bundle.createUpdaterArtifacts` was **not** added here — see review-round correction below.
- `agent/package.json` (unmodified this session — only mutated at CI runtime by the new version-sync step, never committed).
- `.github/workflows/release-macos.yml` (modified) — added `TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD` env vars to the `tauri-action` step, a new "Sync app version from git tag" step, header-comment updates, and (review-round) a `--config agent/src-tauri/tauri.macos-release.conf.json` arg.
- `.github/workflows/release-windows.yml` (modified) — same changes as `release-macos.yml`, mirrored; `--config` arg already pointed at `tauri.windows-release.conf.json`, unchanged.
- `agent/src-tauri/tauri.windows-release.conf.json` (modified, review-round) — added `bundle.createUpdaterArtifacts: true` alongside the existing `signCommand`, so it only applies at release-build time, not local `cargo tauri build`.
- `agent/src-tauri/tauri.macos-release.conf.json` (new, review-round) — release-only overlay containing just `bundle.createUpdaterArtifacts: true`, merged in via `release-macos.yml`'s `--config` arg, mirroring the Windows overlay pattern from Story 2.9b.
- `agent/README.md` (modified) — extended "Release builds" section with the updater-signing paragraph.
- `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` (modified) — new "Tauri updater signing keypair" row in §3; row 32 extended with the Story 2.9c secrets paragraph.
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified) — annotated the hardcoded-`0.0.0`-version entry as `[RESOLVED 2026-07-30, Story 2.9c]`.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — story marked `in-progress` at session start, `review` at completion.

### Change Log

| Date | Change | Status |
|------|--------|--------|
| 2026-07-30 | Story 2.9c dev-story session: wired `tauri-plugin-updater` (Rust registration + `updater:default` capability), configured `tauri.conf.json`'s `bundle.createUpdaterArtifacts` + new `plugins.updater` block (pubkey placeholder, static `latest.json` GitHub Releases endpoint), added `TAURI_SIGNING_PRIVATE_KEY`/`_PASSWORD` to both release workflows' `tauri-action` step, and added a tag-to-version-sync step to both workflows closing the `deferred-work.md` item from Story 2.9a's review. Updated `agent/README.md`, `pre-launch-services-checklist.md` (new keypair-generation row + row 32 extension), and `deferred-work.md` (marked the `0.0.0`-version item resolved). Full four-command cargo gate green (215 unit + 9 integration tests, unchanged from 2.9b's baseline, zero regressions) + workspace-wide `pnpm lint`/`typecheck`/`build` green; all modified JSON/YAML/Cargo.toml manually validated well-formed; confirmed zero diff on `ci.yml`/`tauri.windows-release.conf.json` and that `capabilities/default.json`'s only change is the one new permission. All 6 tasks complete. | ready-for-dev → review |

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created.
