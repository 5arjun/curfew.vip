---
baseline_commit: 909b152921d4788e57bbea11890b0072d6c83275
---

# Story 2.9b: Windows signed build

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want `tauri-action` producing a Windows OV/EV-signed installer,
so that Windows DJs can install without a SmartScreen block.

## Acceptance Criteria

1. **Given** the CI pipeline, **When** a Windows release is cut, **Then** it produces an OV/EV-signed installer; the cert lives as an encrypted CI secret. *(AR-14)*
2. **Given** the Windows EV cert's identity verification can take 1–3 weeks, **Then** a macOS-first launch (Story 2.9a) is an accepted fallback while it clears. *(Design note a)*

## Tasks / Subtasks

- [x] **Task 1: Add a dedicated Windows release workflow** (AC: #1)
  - [x] Create `.github/workflows/release-windows.yml` — **new file**, sibling to `release-macos.yml`, not an addition to `ci.yml` (same separation-of-concerns reasoning 2.9a's Task 1 already established: `ci.yml`'s gate stays Linux-only, release workflows are per-OS and tag-triggered only).
  - [x] Trigger: `on: push: tags: ['agent-v*.*.*']` — **the same tag pattern** `release-macos.yml` uses. Do not invent a Windows-specific tag; one `agent-v*.*.*` push should fan out to both the macOS and Windows release workflows in parallel, both publishing assets to the **same** GitHub Release (same `tagName`/`releaseName` expressions as macOS — `tauri-action` appends to an existing release by tag rather than erroring if one already exists from the sibling workflow's run).
  - [x] Runner: `runs-on: windows-latest`. Unlike macOS's universal 2-arch build, do **not** pass a `--target` — `windows-latest` defaults to `x86_64-pc-windows-msvc`, which is the correct single target (no Windows-on-ARM story exists yet; don't add one speculatively).
  - [x] Steps: checkout → install Rust stable via `dtolnay/rust-toolchain@stable` (no extra `rustup target add` needed, see above) → install pnpm/Node (`pnpm/action-setup@v4` + `actions/setup-node@v4`, `node-version-file: .nvmrc`, `cache: pnpm` — identical block to `release-macos.yml` and `ci.yml`'s `js` job) → `pnpm install --frozen-lockfile` → install the signing CLI (Task 2) → run `tauri-apps/tauri-action` **pinned to the exact same commit `release-macos.yml` already pins** (`1deb371b0cd8bd54025b384f1cd735e725c4060f` # v1) — reuse the pin, don't re-resolve a possibly-different commit for the same tag; that would silently split the two release workflows onto different `tauri-action` versions for no reason.
  - [x] `permissions: contents: write` (same reason as macOS: `tauri-action` needs this to publish/append to the GitHub Release — this was a 2.9a review-round Patch finding, don't reintroduce the gap here).
  - [x] `concurrency: group: release-windows-${{ github.ref }}, cancel-in-progress: true` (own group, distinct from macOS's `release-macos-${{ github.ref }}` — they must run concurrently as siblings, not block each other; only same-OS retags should cancel in-progress runs).
  - [x] `timeout-minutes: 30` (macOS uses 45 to cover notarization's network round-trip; Windows signing via Task 2's CLI is a single synchronous API call with no comparable wait, so a shorter bound is appropriate — still a real bound, per 2.9a's review-round Patch finding that the macOS workflow originally shipped without one).

- [x] **Task 2: Wire Windows code-signing without touching the base `tauri.conf.json`** (AC: #1)
  - [x] **Critical constraint the epic text doesn't fully anticipate**: since June 1, 2023, the CA/Browser Forum's Baseline Requirements mandate that the private key for *any* publicly-trusted code-signing certificate (OV **or** EV) live on certified hardware (FIPS 140-2 Level 2 / Common Criteria EAL 4+) and be non-exportable. There is no `.p12`-equivalent flat file to base64 into a GitHub secret the way `release-macos.yml` does with `APPLE_CERTIFICATE` — that macOS pattern **cannot** be mirrored for Windows. AC1's "the cert lives as an encrypted CI secret" is satisfied in spirit, not literally: what becomes the CI secret is a *service principal's credentials* that are authorized to request signatures from an HSM-backed cloud signing service — the private key itself never leaves that service.
  - [x] **Recommended service: Azure Artifact Signing** (Microsoft's own service; renamed from "Trusted Signing" in January 2026 — the same product, same pricing, new name only). Rationale for choosing it over a traditional CA-issued OV/EV cert + physical HSM token: (a) individual/sole-proprietor developers are eligible for its **Public Trust** certificate profile as of the current program (no incorporated-business requirement, no 3-year-history requirement) — but **eligibility is gated to the United States and Canada**; confirm Arjun's eligibility before provisioning (flagged as a question below, this story's code cannot resolve it). (b) Basic tier is $9.99/mo for up to 5,000 signatures — materially cheaper than a traditional EV cert + hardware token. (c) It requires a **paid** Azure subscription (free/trial/sponsored subscriptions are explicitly not supported). (d) It still grants EV-equivalent immediate SmartScreen reputation once issued (no "building reputation over time" period, unlike a bare OV cert). *(Researched 2026-07-29 — verify current pricing/eligibility before provisioning; this is a fast-moving program, same "verify before use" caveat 2.9a raised for `tauri-action`.)*
  - [x] **Signing tool: `artifact-signing-cli`** (crates.io / GitHub `Levminer/trusted-signing-cli`, itself renamed to track Microsoft's Jan 2026 rebrand — a signal it's actively maintained against the current product). Install via `cargo install artifact-signing-cli --locked` in the workflow (after the Rust-stable step, before the `tauri-action` step) — no official GitHub Action exists for it, unlike `supabase/setup-cli@v1`'s pattern in `ci.yml`; `cargo install` is the right fallback here. It authenticates via env vars `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_ARTIFACT_SIGNING_ACCOUNT`, `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE` (all settable as GitHub secrets, passed as `env:` on the `tauri-action` step so the signing subprocess it spawns inherits them) and takes the target file as a trailing positional argument — a clean fit for Tauri's `signCommand` `%1` file-path templating. **Unconfirmed, verify at implementation time**: whether the signing endpoint (its `-e`/`--endpoint` flag, a regional URL like `https://eus.codesigning.azure.net`) has an env-var equivalent — the docs fetched during story creation didn't list one alongside the five vars above. If it doesn't, the endpoint must be a literal (non-secret, but region-specific — depends on where Arjun provisions the Azure resource) value baked into Task 2's config file below, not left as a placeholder.
  - [x] **Do not add a `signCommand` to `agent/src-tauri/tauri.conf.json` directly.** A `signCommand` present in the base config fires unconditionally for *every* Windows build, including a local `cargo tauri build` on a dev machine — unlike macOS, where an unset `APPLE_SIGNING_IDENTITY` env var makes Tauri fall back to unsigned automatically, Windows has no such graceful no-op; a local build without `artifact-signing-cli` installed and Azure creds present would hard-fail. Instead, create a **new, separate partial-config file** — `agent/src-tauri/tauri.windows-release.conf.json` — containing only the `bundle.windows.signCommand` key, and merge it in at release-build time only via `tauri-action`'s `args: --config agent/src-tauri/tauri.windows-release.conf.json` (Tauri CLI's `-c/--config` flag deep-merges a JSON file into `tauri.conf.json` for that invocation). This is the same principle 2.9a's Task 2 used for macOS (base config stays signing-free; CI supplies the difference) applied via config-merge instead of env-var precedence, since Windows' bundler has no equivalent env-var override. No secrets belong in this new file — it's just the command template; credentials stay in the workflow's `env:` block.
  - [x] Content of `agent/src-tauri/tauri.windows-release.conf.json` (adjust once the endpoint-env-var question above is resolved):
    ```json
    {
      "bundle": {
        "windows": {
          "signCommand": "artifact-signing-cli -e <REGIONAL_ENDPOINT> %1"
        }
      }
    }
    ```
  - [x] `agent/src-tauri/icons/icon.ico` already exists (confirmed present in `tauri.conf.json`'s `bundle.icon` list) — no new icon asset work needed for this story.

- [x] **Task 3: Document the release + procurement path** (AC: #1, #2)
  - [x] Extend `agent/README.md`'s "Release builds" section (added by Story 2.9a) to cover Windows: local `cargo tauri build` on Windows stays unsigned (no `signCommand` in the base config, per Task 2); a signed `.msi`/`.exe` installer is produced by `.github/workflows/release-windows.yml` on the same `agent-v*.*.*` tag push that triggers the macOS release — link the workflow file, don't restate its contents. Note both workflows publish to the same GitHub Release.
  - [x] Add a header comment to `release-windows.yml` itself (mirroring `release-macos.yml`'s header) explaining: the signing method chosen (Azure Artifact Signing via `artifact-signing-cli`) and why (HSM custody is now mandatory for OV/EV certs, ruling out a `.p12`-style exportable-cert flow); the required GitHub secrets and what each is for; that local dev is unaffected because the signing config is merged in only at release time (Task 2).
  - [x] No changes needed to `agent/README.md`'s "Build & verify" cargo command block — same reasoning as 2.9a Task 3: this story doesn't change local dev ergonomics.

- [x] **Task 4: Correct the procurement framing and flag the manual provisioning follow-up** (AC: #1, #2)
  - [x] Update `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` row 30 ("Windows OV/EV code-signing certificate"). Its current text assumes a traditional CA-purchased cert with a 1–3 week identity-verification wait (matching epics.md's own AC2 framing) — replace/extend it to name **Azure Artifact Signing** as the recommended concrete path (Task 2's rationale), with: (a) the open eligibility question — confirm Arjun is provisioning from the United States or Canada, since Public Trust individual eligibility is geographically gated; (b) the cost ($9.99/mo Basic tier, requires a paid, non-trial Azure subscription); (c) that identity verification still applies (timeline not independently confirmed during story creation — don't assert it's faster than the epic's 1–3 week estimate, just that the mechanism differs from a physical HSM token purchase).
  - [x] Update row 32 ("GitHub Actions CI secrets") with this story's concrete secret names — `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TENANT_ID`, `AZURE_ARTIFACT_SIGNING_ACCOUNT`, `AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE` — marked **not yet added**, same pattern as 2.9a's Apple secret rows. Do not attempt to populate real values — provisioning the Azure App Registration + Artifact Signing account + certificate profile is Arjun's out-of-band manual action (Azure Portal), not achievable from this codebase, same reasoning 2.9a Task 4 applied to the Apple Developer Portal.
  - [x] Do not mark AC2 as requiring code changes — it is a design-level acceptance already locked in at the 2026-07-20 party (epics.md line 513) and reaffirmed by 2.9a shipping first; this task's only job is to keep the tracking doc's language accurate, not to build a fallback mechanism.

- [x] **Task 5: Gate green**
  - [x] Run the four-command Rust gate — `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo build`, `cargo test` (all `--manifest-path agent/src-tauri/Cargo.toml`) — to confirm no regression. No new Rust application code is expected (CI/build-pipeline story only, same framing as 2.9a).
  - [x] Run `pnpm lint && pnpm typecheck && pnpm build` (root) to confirm the new workflow YAML, the new partial-config JSON, and doc edits didn't break anything workspace-wide.
  - [x] Manually validate both new files are well-formed: `release-windows.yml` as valid YAML (same `js-yaml`-via-`node -e` fallback 2.9a used if `actionlint` isn't available locally) and `tauri.windows-release.conf.json` as valid JSON. A real end-to-end signed Windows release cannot be triggered in this dev session (no Azure secrets exist yet, per Task 4) — that verification is Arjun's job once secrets are provisioned.
  - [x] Confirm zero changes to `.github/workflows/ci.yml`, `.github/workflows/release-macos.yml`, and `agent/src-tauri/tauri.conf.json` (the base config) — this story's entire footprint is new files plus the two doc updates in Tasks 3–4.

## Dev Notes

- **What this story is and isn't:** exclusively a CI/build-pipeline story, same framing as 2.9a — new GitHub Actions workflow, a new small Tauri partial-config file, and doc updates. It does not touch `agent/src-tauri/src/**`.
- **Why this story exists now:** 2.9a (macOS) is done; per the 2026-07-20 party split (epics.md line 513) and 2.9a's own Dev Notes, 2.9b was always next, independent of whether the Windows cert/account is actually provisioned yet — the workflow code ships regardless, same as `release-macos.yml` shipped before Apple's `.p12`/notarization credentials existed. Per `pre-launch-services-checklist.md` row 30 (pre-this-story text), nothing suggests Windows procurement has started — do not block this story's code on it.
- **The one genuinely new technical wrinkle vs. 2.9a**: macOS code-signing still allows an exportable `.p12` certificate (Apple's own model, unaffected by the 2023 CA/Browser Forum HSM rule, which applies to *publicly-trusted TLS/code-signing CAs under the CA/B Forum*, not Apple's own developer-certificate program). Windows OV/EV certs from CA/B Forum-member CAs are squarely covered by that rule, which is why this story's signing mechanism (Task 2) looks structurally different from 2.9a's — not a stylistic choice, a hard constraint. Don't try to force a `.p12`-shaped solution here; it doesn't exist for new Windows certs anymore.
- **Azure Artifact Signing vs. a traditional CA-purchased OV/EV cert**: both remain technically viable (a traditional cert would still need cloud-HSM custody from its issuing CA, e.g. DigiCert KeyLocker or SSL.com eSigner, which exposes the key similarly to how `artifact-signing-cli` talks to Azure) — this story recommends Azure specifically because it's the cheapest, has the simplest CI story (one small Rust-ecosystem CLI, no vendor client software to install on the runner), and its individual-developer eligibility was confirmed current as of 2026-07-29 research. If Arjun already has a relationship with a different CA, that's a valid substitution — the `signCommand` mechanism (Task 2) stays the same shape regardless of which HSM-backed signing service sits behind it; only the CLI/flags change.
- **`ci.yml` and `release-macos.yml` are both untouched by design** — same separation-of-concerns reasoning 2.9a established: release workflows are per-OS, tag-triggered, and independent of each other and of the PR/push-to-main gate.
- **Testing shape for this story:** almost entirely procedural/manual, same as 2.9a — no new Rust logic to unit-test. Task 5's gate-green + manual YAML/JSON validation is the right bar.
- **Open questions this story's code cannot resolve** (surface to Arjun, don't guess):
  1. Is Arjun (or however Curfew's Azure billing will be registered) eligible under Azure Artifact Signing's US/Canada individual-eligibility requirement? If not, fall back to a traditional CA-issued OV cert (individual-eligible, per Tauri's own docs, at the cost of no immediate SmartScreen reputation) or find an Azure Artifact Signing reseller/region workaround — out of this story's scope to resolve.
  2. Does `artifact-signing-cli` expose an env var for its `-e/--endpoint` flag? Verify via `artifact-signing-cli --help` at implementation time (live web access wasn't sufficient to confirm this during story creation) — affects whether Task 2's config file needs a literal, provisioning-dependent endpoint value or can stay fully generic.

### Project Structure Notes

- New: `.github/workflows/release-windows.yml`, `agent/src-tauri/tauri.windows-release.conf.json`.
- Modified: `agent/README.md` (Task 3), `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` (Task 4).
- Not modified: `.github/workflows/ci.yml`, `.github/workflows/release-macos.yml`, `agent/src-tauri/tauri.conf.json` (base config — Task 2 explicitly avoids it), anything under `agent/src-tauri/src/`.
- Dependency direction (AD-3) unaffected: this story touches `agent/` (new config + workflow) and repo-root `.github/`, never `shared/` or `web/`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.9b, lines 526-535] — story ACs, canonical text, macOS-first fallback framing.
- [Source: _bmad-output/planning-artifacts/epics.md#Sizing note, line 513] — 2.9a/2.9b/2.9c split rationale, ship order.
- [Source: _bmad-output/planning-artifacts/epics.md#AR-14, line 88] — "Code-signing is a fixed-cost ship gate... Windows OV/EV cert."
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md, lines 213, 216, 268, 272] — `tauri-action` as CI/release tool; signing-cost caveat; Windows OV/EV named alongside Apple Developer ID.
- [Source: _bmad-output/implementation-artifacts/pre-launch-services-checklist.md, row 30] — Windows OV/EV cert not yet started, 1-3 week identity-verification caveat (pre-this-story text, to be corrected per Task 4).
- [Source: _bmad-output/implementation-artifacts/pre-launch-services-checklist.md, row 32] — GitHub Actions CI secrets tracking row, pattern to extend.
- [Source: _bmad-output/implementation-artifacts/2-9a-macos-signed-build-notarization.md] — full prior story: workflow shape to mirror (concurrency, permissions, timeout-minutes, exact-commit pin), the "don't touch tauri.conf.json, let CI supply the difference" principle, review findings already fixed once (permissions block, concurrency group, timeout-minutes, exact-commit pin) — don't reintroduce any of those gaps here.
- [Source: .github/workflows/release-macos.yml] — the exact `tauri-action` pin (`1deb371b0cd8bd54025b384f1cd735e725c4060f` # v1) to reuse; header-comment style to mirror; job shape (checkout → toolchain → pnpm/Node → tauri-action).
- [Source: .github/workflows/ci.yml, lines 1-18] — pnpm/Node setup block pattern, concurrency-group convention.
- [Source: agent/src-tauri/tauri.conf.json] — current state: no `bundle.windows` block, `bundle.targets: "all"`, `icons/icon.ico` already present.
- [Source: agent/package.json] — no `tauri` npm script anywhere in the repo (confirmed again for this story) — `tauri-action` installs the Rust CLI itself, same as 2.9a found.
- [Tauri v2 Windows Code Signing docs](https://v2.tauri.app/distribute/sign/windows/) — OV cert env vars (`certificateThumbprint`/`digestAlgorithm`/`timestampUrl`), custom `signCommand` mechanism for Azure-based signing, OV-vs-EV SmartScreen-reputation distinction.
- CA/Browser Forum Baseline Requirements — private-key HSM-custody mandate for publicly-trusted code-signing certs, effective June 1, 2023 (researched 2026-07-29 via web search; verify against the current Baseline Requirements document if precision matters at implementation time).
- [Azure Artifact Signing product page](https://azure.microsoft.com/en-us/products/artifact-signing) — pricing ($9.99/mo Basic / $99.99/mo Premium), Jan 2026 rename from "Trusted Signing," Public/Private Trust profile types.
- [`Levminer/trusted-signing-cli` (now `artifact-signing-cli`) on GitHub](https://github.com/Levminer/trusted-signing-cli) — install (`cargo install`), CLI syntax, env-var auth (`AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/`AZURE_TENANT_ID`/`AZURE_ARTIFACT_SIGNING_ACCOUNT`/`AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE`).
- Individual-developer eligibility (US/Canada, no incorporated-entity or 3-year-history requirement, paid-subscription requirement) — researched 2026-07-29 via web search against Microsoft Learn/Q&A sources; verify current terms before provisioning, this program has changed eligibility rules before.

## Previous Story Intelligence

- **Story 2.9a** (done, most recent, same sub-split): the direct sibling of this story — same epic sizing split, same "CI/build-pipeline only" scope discipline, same commit-message convention (`Story 2.9a: <what changed>` / `Story 2.9a: Code review round — N patches applied, M deferred`, seen in `909b152`). Its review round caught and fixed: missing `permissions: contents: write`, missing `concurrency:` group, missing `timeout-minutes`, a floating-tag `tauri-action` pin tightened to an exact commit, and a broken notarization-key-to-disk step (secret sourced but never written to the path the signing tool expected — the exact class of bug this story's Task 2 must avoid for `artifact-signing-cli`: confirm the CLI actually receives every credential it needs, don't just wire secret names and assume). All of this is now baked into `release-macos.yml` as the pattern to mirror, not rediscover.
- **Story 2.8** (done): purely `agent/src-tauri/src/**` application code — no CI/build-pipeline overlap, confirms the four-command cargo gate convention this story's Task 5 reuses.
- **Story 2.5**: Tauri pinned at 2.11.5; confirmed CI was Linux-only before 2.9a — both facts inherited, not re-derived here.

## Git Intelligence Summary

- Commit convention to match: `Story 2.9b: <what changed>` for implementation, `Story 2.9b: Code review round — N patches applied, M deferred` for the review-closing commit — same pattern as `909b152`, `0750a2d`, `4bdf7de`.
- Working tree at story start: HEAD `909b152` (Story 2.9a's review-closing commit), clean. No `.github/workflows/release-windows.yml` or `agent/src-tauri/tauri.windows-release.conf.json` exists yet, confirming this is genuinely new.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via the `bmad-dev-story` workflow.

### Debug Log References

- Verified `artifact-signing-cli`'s real usage contract by fetching `Levminer/trusted-signing-cli`'s README via `gh api repos/Levminer/trusted-signing-cli/contents/README.md`: confirmed it exposes no environment-variable equivalent for its `-e/--endpoint` flag (only `AZURE_CLIENT_ID`/`AZURE_CLIENT_SECRET`/`AZURE_TENANT_ID`/`AZURE_ARTIFACT_SIGNING_ACCOUNT`/`AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE` have env-var forms) — resolves the story's Open Question #2. The endpoint is therefore a literal, region-specific value in `tauri.windows-release.conf.json`'s `signCommand`, left as an explicit `<AZURE_ARTIFACT_SIGNING_ENDPOINT>` placeholder since the Azure Artifact Signing account (and thus its region) does not exist yet — cannot be filled in until Arjun provisions it.
- Full four-command cargo gate: `cargo fmt --manifest-path agent/src-tauri/Cargo.toml -- --check` (clean), `cargo clippy --manifest-path agent/src-tauri/Cargo.toml --all-targets -- -D warnings` (clean), `cargo build --manifest-path agent/src-tauri/Cargo.toml` (clean), `cargo test --manifest-path agent/src-tauri/Cargo.toml` (215 unit + 9 integration tests, all green, matching Story 2.9a's baseline exactly — zero regressions, no new Rust code touched).
- Workspace-wide `pnpm lint && pnpm typecheck && pnpm build` (root): all three packages (`@curfew/shared`, `agent`, `web`) green.
- Manual validation of both new files: `release-windows.yml` parsed with the repo's vendored `js-yaml` (`node_modules/.pnpm/js-yaml@4.3.0`) via a one-off `node -e` script — confirmed valid YAML with expected top-level keys and step sequence; `tauri.windows-release.conf.json` parsed with `JSON.parse` via `node -e` — confirmed valid JSON with the expected `bundle.windows.signCommand` shape.
- Confirmed via `git status`/`git diff --stat` that `.github/workflows/ci.yml`, `.github/workflows/release-macos.yml`, and `agent/src-tauri/tauri.conf.json` show zero diff — this story's footprint is exactly the two new files plus the three documented doc/tracking edits.

### Completion Notes List

- **Task 1**: created `.github/workflows/release-windows.yml` — tag-triggered (`agent-v*.*.*`, same tag as `release-macos.yml`, so one push fans out to both) on `windows-latest`, no `--target` override (single default `x86_64-pc-windows-msvc` target, no Windows-on-ARM story exists). Mirrors `release-macos.yml`'s checkout → Rust stable → pnpm/Node setup shape, adds an `artifact-signing-cli` install step (`cargo install --locked`, no official Action exists for it), then runs `tauri-apps/tauri-action` pinned to the exact same commit `release-macos.yml` already pins (`1deb371b0cd8bd54025b384f1cd735e725c4060f` # v1) — reused, not re-resolved. `permissions: contents: write`, own `concurrency` group (`release-windows-${{ github.ref }}`, distinct from macOS's group so the two run as siblings), `timeout-minutes: 30` (shorter than macOS's 45 — no notarization-style async wait here).
- **Task 2**: did not touch the base `agent/src-tauri/tauri.conf.json` — confirmed the 2023 CA/Browser Forum HSM-custody mandate rules out a `.p12`-style exportable cert for new Windows OV/EV certs, so Azure Artifact Signing (`artifact-signing-cli`) is the signing mechanism, wired via a new partial-config file (`agent/src-tauri/tauri.windows-release.conf.json`, only a `bundle.windows.signCommand` key) merged in at release time via `tauri-action`'s `args: --config agent/src-tauri/tauri.windows-release.conf.json` — a local `cargo tauri build` never sees it, so it can't hard-fail a dev machine without `artifact-signing-cli`/Azure creds present (Windows has no env-var signing fallback the way macOS does). Resolved the story's Open Question #2 (see Debug Log References): no env var exists for the CLI's `-e/--endpoint` flag, so it's a literal placeholder in the config, explicitly flagged as needing replacement once the Azure account's region is known.
- **Task 3**: extended `agent/README.md`'s "Release builds" section (added by Story 2.9a) to cover Windows — same tag triggers both release workflows into the same GitHub Release, and local `cargo tauri build` on Windows stays unsigned by construction. Added a header comment to `release-windows.yml` itself (mirroring `release-macos.yml`'s) covering the signing method chosen and why, the required secrets, and the local-dev-unaffected guarantee.
- **Task 4**: updated `pre-launch-services-checklist.md` row 30 (renamed from "Windows OV/EV code-signing certificate" to "Windows code-signing (Azure Artifact Signing)") with the concrete recommended path, the US/Canada eligibility gate (open, needs Arjun's confirmation), the $9.99/mo paid-subscription cost, and the still-unconfirmed identity-verification timeline; row 32 (GitHub Actions CI secrets) with the five concrete `AZURE_*` secret names, marked not yet added. Did not populate real values or assert AC2 needs a code fallback — both out of this story's scope per its own Task 4 guidance.
- **Task 5**: full four-command Rust gate green (215 unit + 9 integration tests, unchanged from Story 2.9a's baseline — no new Rust code), workspace-wide `pnpm lint`/`typecheck`/`build` green, both new files manually validated as well-formed (YAML via vendored `js-yaml`, JSON via `JSON.parse`). Confirmed zero diff on `ci.yml`, `release-macos.yml`, and the base `tauri.conf.json`. A real end-to-end signed Windows release cannot be triggered in this dev session (no Azure secrets exist yet, and the signing endpoint placeholder is unresolved) — that verification is Arjun's job once the Azure Artifact Signing account is provisioned.
- **Scope discipline**: confirmed zero changes to `agent/src-tauri/src/**`. No new deferred-work item identified during implementation — the two genuinely open items (Azure region/US-Canada eligibility, the endpoint placeholder) are both already tracked as open questions in this story's own Dev Notes and in the checklist rows updated by Task 4, not silently left undocumented.

### File List

- `.github/workflows/release-windows.yml` (new) — tag-triggered (`agent-v*.*.*`) Windows release workflow: checkout, Rust stable, pnpm/Node setup, `artifact-signing-cli` install, `tauri-apps/tauri-action@v1` signed build via `--config` merge + GitHub release publish (same release as `release-macos.yml`).
- `agent/src-tauri/tauri.windows-release.conf.json` (new) — partial Tauri config, `bundle.windows.signCommand` only, merged in at release time via `tauri-action`'s `--config` arg; base `tauri.conf.json` untouched.
- `agent/README.md` (modified) — extended the "Release builds" section (added by Story 2.9a) to cover the Windows release workflow and the local-unsigned/CI-signed split on Windows.
- `_bmad-output/implementation-artifacts/pre-launch-services-checklist.md` (modified) — row 30 (Windows code-signing) rewritten around the concrete Azure Artifact Signing path with its eligibility/cost/timeline caveats and the unresolved endpoint placeholder; row 32 (GitHub Actions CI secrets) extended with the five concrete `AZURE_*` secret names, marked not yet added.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified) — story marked `in-progress` at session start, `review` at completion.

### Change Log

| Date | Change | Status |
|------|--------|--------|
| 2026-07-30 | Story 2.9b dev-story session: added `.github/workflows/release-windows.yml` (tag-triggered Windows release, sibling to `release-macos.yml`, same tag/release/tauri-action pin) and `agent/src-tauri/tauri.windows-release.conf.json` (Azure Artifact Signing via `artifact-signing-cli`, merged in only at release time — base `tauri.conf.json` untouched); resolved the story's env-var open question by fetching the CLI's real README (no endpoint env var exists, left as an explicit placeholder); extended `agent/README.md`'s Release builds section; corrected `pre-launch-services-checklist.md` rows 30 and 32 around the concrete Azure procurement path (Tasks 1-5, all complete). Full four-command cargo gate (215+9 tests, zero regressions) + workspace lint/typecheck/build green; both new files manually validated well-formed; confirmed zero diff on `ci.yml`/`release-macos.yml`/base `tauri.conf.json`. | ready-for-dev → review |
</content>
