---
baseline_commit: 81ff66f3de1c1173809ac52f6e878b51e397d648
---

# Story 2.5: Agent shell + tray UI

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a DJ,
I want the local agent to live as a menu-bar/tray icon with a minimal settings panel,
so that it stays out of my way while showing sync state.

## Acceptance Criteria

1. **Given** the agent runs, **Then** its only UI is a tray icon with four states — idle / syncing / failed / drive-not-connected — each carrying a text label/tooltip (not color/glyph alone). *(FR-5, UX-DR23, UX-DR21)*
2. **Given** I open settings, **Then** the panel exposes only the Serato folder path override, in native OS chrome (not skinned to website tokens). *(FR-5, UX-DR23)*
3. **Given** the agent, **Then** it is never a full window and never mirrors the website UI. *(UX-DR22)*

## Tasks / Subtasks

- [x] Task 1: Build the 4-state tray icon + tooltip (AC: #1)
  - [x] Add an icon asset per state (idle / syncing / failed / drive-not-connected) under `agent/src-tauri/icons/` (or a `tray/` subfolder) — reuse the existing bundled icon as the `idle` visual base if no distinct design asset exists yet; do not block on new art, a simple color/badge variant is acceptable.
  - [x] Introduce an explicit Rust state enum (e.g. `TrayState { Idle, Syncing, Failed, DriveNotConnected }`) — there is no existing state type to extend; this is 100% new code, not a refactor.
  - [x] Add a function to update the running tray (`TrayIcon::set_icon` + `TrayIcon::set_tooltip`, see Dev Notes → Tauri Tray API) so any later story (2.6, 2.8, 3.x) can call `set_tray_state(&app, TrayState::Syncing)` etc. without touching this story's plumbing again.
  - [x] Tooltip text must carry the state as a real label (e.g. `"Curfew Agent — Syncing"`, `"Curfew Agent — Drive not connected"`), never an icon/color alone (UX-DR21). Draw wording from the Console Voice / Failure Register microcopy pattern (UX-DR18) for "failed" and "drive-not-connected" — calm, technical, no exclamations — rather than inventing new copy.
  - [x] Wire the enum to the actual tray at startup, defaulting to `Idle` (there is no sync/watcher logic yet to drive real state transitions — that lands in 2.6/2.8/3.x; this story only needs the state machine + a way to trigger it, a debug/manual trigger or test is enough to prove the four states render).

- [x] Task 2: Replace the placeholder window with the native settings panel (AC: #2, #3)
  - [x] Decide and document the window model: the current `main` window in `agent/src-tauri/tauri.conf.json` is `420×320`, resizable, and is shown/hidden (not destroyed) on tray click — this reads as "a full window" today. Make it **non-resizable**, sized tightly to the one-field content, and confirm in Dev Agent Record that it satisfies AC-3 ("never a full window") — don't silently inherit the 1.1 scaffold's placeholder sizing/resizability.
  - [x] Replace `agent/ui/index.html`'s placeholder content with the real settings panel: exactly one field, the Serato folder path override (text input + a way to browse/set it — a native file/folder picker via Tauri's dialog plugin is acceptable, but do not add a `web/`-style styled dropzone or custom widget). No other settings, toggles, or content belong on this panel.
  - [x] The panel is plain HTML/CSS reflecting native OS chrome (system font stack, default form controls) — it must **not** import or reference `web/app/tokens.css`, `globals.css`, or any Obsidian/Ember token/utility class. This exemption is explicit and pre-approved (see Dev Notes → Previous Story Intelligence).
  - [x] Persist the path override somewhere the agent can read on next launch (a small local JSON/config file via plain `std::fs`, or `tauri-plugin-store` if already trivial to add — avoid introducing a new heavyweight dependency for one string). Do **not** wire this path into actual Serato folder detection/watching logic — that consumption is Story 2.6's job; this story only needs to accept, validate-as-a-path-string, and persist the override.

- [x] Task 3: Close CSP hardening action item ai-3 (AC: #1, #2, #3 — hardening baseline for all of them)
  - [x] Change `agent/src-tauri/tauri.conf.json`'s `app.security.csp` from `null` to a restrictive, local-only policy (see Dev Notes → CSP research for the exact directive object and Tauri-specific quirks). This closes retro action item **ai-3**, explicitly assigned to this story.
  - [x] Verify the settings panel still loads and the path-picker/persist round-trip still works under the new CSP (no silent asset/IPC breakage) — this is a functional regression check, not just "config changed."

- [x] Task 4: Capability review (AC: #2)
  - [x] Confirm `agent/src-tauri/capabilities/default.json` only grants what this story's dialog/file-picker and settings-window actually need (e.g. `core:dialog:default` if using the dialog plugin) — do **not** add filesystem-scope capabilities beyond that; broad fs capability scoping to the configured Serato path is Story 2.7's job, not this one.

- [x] Task 5: Tests + gate
  - [x] `cargo test` covering the state enum → icon/tooltip mapping (pure logic, no real tray needed) and the path-persist round-trip (write override, read it back).
  - [x] Manually verify on the actual dev machine (macOS, per this repo's current CI/dev environment): all four tray tooltip states render correct text, settings panel opens as a small native (non-resizable) window, path override persists across an agent restart. Document this manual walkthrough in Dev Agent Record — per the standing Epic 2 rule (retro decision D2 / ai-8), "gate green" requires the four-command gate (`cargo fmt --check`, `cargo clippy -D warnings`, `cargo build`, `cargo test`) to have **actually been run** on this machine, not assumed.

### Review Findings

- [x] [Review][Patch] Settings save is not crash-safe and self-locks on corruption — `save_to` writes via plain `fs::write` (no atomic temp+rename), and `set_serato_path_override` calls `load()` before writing, so a corrupted `settings.json` permanently blocks Save from ever overwriting it via the UI [settings.rs:50-56,87-95] — fixed: `save_to` now writes to a sibling temp file and renames it into place; `set_serato_path_override` falls back to defaults on a load error instead of propagating it. Two new tests added.
- [x] [Review][Patch] CSP hardening incomplete — `style-src` keeps `'unsafe-inline'` though Tauri auto-injects a nonce into inline `<style>` at build time (verified in `tauri-utils`'s `inject_nonce_token`); `base-uri`/`form-action` are also omitted and don't fall back to `default-src` [tauri.conf.json:21-29] — fixed: dropped `'unsafe-inline'` from `style-src`, added `base-uri: 'self'` and `form-action: 'none'`.
- [x] [Review][Patch] Settings window can be minimized and stranded — `minimizable` defaults `true` (not overridden), and the tray-click toggle only checks `is_visible()`; with no Dock icon (`ActivationPolicy::Accessory`), a minimized panel can become unreachable [tauri.conf.json:11-19, lib.rs:168-184] — fixed: added `"minimizable": false` to the window config.
- [x] [Review][Patch] Browse button has no error handling, unlike Save — a dialog-plugin rejection fails silently with no status message [index.html:87-92] — fixed: wrapped in try/catch matching Save's pattern.
- [x] [Review][Patch] `set_tray_state` sets icon then tooltip as two separate fallible steps with no rollback — a mid-sequence failure leaves icon/tooltip mismatched [tray.rs:72-79] — fixed: tooltip (the authoritative UX-DR21 signal) is now set first, so a failure leaves both icon and tooltip in the prior consistent state instead of showing a stale tooltip against a new icon.
- [x] [Review][Patch] Remove unused `@2x` tray icon assets — added to the repo but never referenced by `TrayState::icon()` (no HiDPI lookup exists); resolved via user decision to strip now and defer proper HiDPI support [tray.rs:58-67, agent/src-tauri/icons/tray/*@2x.png] — fixed: the four unused `@2x` PNGs were deleted; HiDPI lookup logged in deferred-work.md.
- [x] [Review][Defer] `is_visible().unwrap_or(false)` foot-gun left untouched despite this diff heavily editing the surrounding code [lib.rs:176] — deferred, pre-existing (carried over from Story 1.1, explicitly out of this story's scope)
- [x] [Review][Defer] Concurrent Save-click race — unsynchronized read-modify-write on the settings file, no in-flight guard [settings.rs:87-95] — deferred, low priority (residual risk after the atomic-write patch is just benign last-write-wins)
- [x] [Review][Defer] HiDPI-aware tray icon lookup — `@2x` assets removed this round; proper scale-factor-aware icon selection needs its own investigation [tray.rs] — deferred, follow-up story per user decision

## Dev Notes

- **Scope boundaries — do not build these here (they belong to later stories):**
  - Serato folder auto-detection / USB scanning / first-run confirm dialog → **Story 2.6**. This story's field is a manual override only; 2.6 is what actually searches and confirms.
  - Filesystem capability scoping to the configured path, raw-data-never-leaves-machine enforcement → **Story 2.7** (NFR-2).
  - Any Supabase client, JWT/refresh-token handling, `tauri-plugin-*` secure storage → **Story 2.10** (AR-10). This story has zero cloud/auth surface.
  - Real sync/watcher logic that would actually drive tray states in production → **Stories 2.6/2.8/3.x**. This story builds the state machine and proves it renders; it does not need a real watcher wired to it yet.
  - Cross-platform signed bundling / `tauri-action` CI → **Stories 2.9a/b/c** (AR-14). Not this story's concern.

- **Current repo state this story modifies (not a greenfield build):**
  - `agent/src-tauri/tauri.conf.json` — `app.security.csp` is literally `null` today; `main` window is `420×320`, `resizable: true`, starts `visible: false`.
  - `agent/src-tauri/src/lib.rs`'s `run()` — currently builds one static tray icon, hardcoded tooltip `"Curfew Agent"`, one "Quit" menu item, left-click toggles the `main` window's visibility (show/hide, not destroy). None of the four required states exist yet — this is new work, not an extension of existing state logic.
  - `agent/ui/index.html` — a static placeholder page whose own copy says it's a stand-in for "the real work" (cites UX-DR23). This is the file to replace with the actual settings panel.
  - `agent/src-tauri/capabilities/default.json` — currently grants only `"core:default"` on the `"main"` window.
  - `agent/src-tauri/Cargo.toml` — `tauri = { version = "2", features = ["tray-icon"] }` (tray-icon feature already enabled). Actual pinned version per `Cargo.lock`: **Tauri 2.11.5**.
  - The `agent/` workspace has had **zero commits since Story 1.1's original scaffold** (`5cb3b83` + review round `8b5447c`) — all of Epic 1's work touched only the Rust parser/joiner/stats modules, never the tray/window/CSP/capabilities surface. So this story is the first change to the shell since it was scaffolded; nothing has drifted underneath it.

- **UX rules governing this story (quoted in full — the canonical numbered text lives in `_bmad-output/planning-artifacts/epics.md` lines ~98-129, not in the UX-designs directory, which doesn't contain `DR` numbering):**
  - **UX-DR21 (Accessibility floor, tray-relevant clause):** "tray icon states carry text label/tooltip (not color/glyph alone)."
  - **UX-DR22 (Responsive & platform, tray-relevant clause):** "native agent tray is icon + one settings panel only, never a full window, never mirrors website UI."
  - **UX-DR23 (Agent tray UI):** "Four icon states (idle / syncing / failed / drive-not-connected, FR-5); click opens the single settings panel (Serato path override only); native OS chrome, not skinned to the website token system."
  - **UX-DR18 (Console voice / Failure Register):** calm, technical failure copy, no exclamations — source for "failed" / "drive-not-connected" tooltip wording.

- **"Website design tokens" — what AC-2 says to avoid, precisely:** the CSS custom properties in `web/app/tokens.css` (the Obsidian/Ember palette, `--btn-gradient-*`, `--color-spark`, motion tokens established in Story 2.2) plus shared utility classes in `web/app/globals.css` (`.text-label-sm`, `.text-mono-data`, etc.) and the `no-hardcoded-colors.test.ts` CI guard enforcing token-only colors in `web/app/**`. Story 2.2's own Dev Notes already carve this story out by name: *"The one exemption: Story 2.5 (agent tray UI) is deliberately native OS chrome and does NOT consume these tokens (UX-DR22/UX-DR23)."* None of that CSS/tooling applies to `agent/ui/` — use plain system-native styling only.

- **Tauri Tray API (Rust, v2.11.5):** build with `tauri::tray::TrayIconBuilder::new().icon(...).tooltip(...).menu(&menu).on_tray_icon_event(...).build(app)?`. To update state after construction, hold the built `TrayIcon` (or fetch it via `TrayIcon::get_by_id`) and call `.set_icon(Some(image))` / `.set_tooltip(Some("..."))` — both documented on `tauri::tray::TrayIcon` ([docs.rs](https://docs.rs/tauri/latest/tauri/tray/struct.TrayIcon.html)). On Linux the icon is written to `$XDG_RUNTIME_DIR/tray-icon` or `$TEMP/tray-icon` under the hood — no action needed, just don't assume in-memory-only icon swaps. This repo's CI is Linux-only today (no OS matrix yet — a known, separately-tracked gap, not this story's problem) but the dev machine is macOS, so manually verify there.

- **CSP research — no policy is pre-specified anywhere in the docs; ai-3 leaves the exact directives to this story.** A minimal restrictive policy for a fully local/static webview (per [Tauri v2 CSP docs](https://v2.tauri.app/security/csp/)):
  ```json
  "csp": {
    "default-src": "'self' asset: http://asset.localhost",
    "script-src": "'self'",
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' asset: http://asset.localhost data:",
    "connect-src": "ipc: http://ipc.localhost"
  }
  ```
  Include `connect-src: ipc: http://ipc.localhost` because the settings panel will call back into Rust (path picker / persist) via Tauri's IPC — omitting it will silently break `invoke()` calls under the new CSP. Verify AC-2's path round-trip still works after the CSP change (Task 3). Tauri auto-injects nonces/hashes for its own bundled code at compile time — don't hand-add those.

## Project Structure Notes

- No new workspace/top-level folders. Stays entirely inside `agent/` (`src-tauri/src/lib.rs` or a new `src-tauri/src/tray.rs` module if you want to split the growing tray logic out of `run()` — optional, existing modules are flat, not mandatory to match a pattern), `agent/src-tauri/tauri.conf.json`, `agent/src-tauri/capabilities/default.json`, `agent/src-tauri/icons/`, `agent/ui/index.html`.
- Dependency direction rule (AD-3) still applies: `agent` depends on `shared`, never on `web` — this story has no reason to touch `shared` or `web` at all.
- No new npm dependency in `agent/package.json` expected (frontend stays static/vanilla per Story 1.1's decision); only `agent/src-tauri/Cargo.toml` may gain a dependency if you use the dialog plugin for the folder picker (`tauri-plugin-dialog`) — keep additions minimal.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5] — story ACs, FR-5, UX-DR19–23 canonical text.
- [Source: _bmad-output/planning-artifacts/epics.md#AR-14, #NFR-2] — adjacent architecture rules, not this story's scope.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md#AD-10, #AD-11] — agent = Tauri/Rust; secure token storage posture (Story 2.10, not 2.5).
- [Source: agent/src-tauri/tauri.conf.json] — current CSP-null baseline, window config.
- [Source: agent/src-tauri/src/lib.rs] — current single-state tray implementation to extend.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — ai-3 CSP item, verbatim.
- [Source: _bmad-output/implementation-artifacts/epic-1-retro-2026-07-25.md] / [epic-1-review-decisions-2026-07-25.md] — ai-3 assigned to Story 2.5; Epic 2 verdict "CLEAR TO START."
- [Source: _bmad-output/implementation-artifacts/sprint-status.yaml#action_items.ai-3] — machine-readable ledger entry.
- [Source: _bmad-output/implementation-artifacts/2-2-obsidian-design-token-system-web-shell.md] — explicit Story 2.5 token exemption.
- [Source: _bmad-output/implementation-artifacts/2-4-auth-ui-components.md] — testing conventions (no DOM testing lib in web/; manual keyboard walkthroughs documented in Dev Agent Record), `forced-colors` focus-ring gotcha (if any focus styling appears in the settings panel).
- [Source: _bmad-output/implementation-artifacts/1-1-monorepo-scaffold-with-three-workspaces.md] — original agent/ scaffold, tray/window review-round patches (macOS `ActivationPolicy::Accessory`, hide-not-close), still-open low-severity `is_visible().unwrap_or(false)` note.
- [Tauri v2 System Tray docs](https://v2.tauri.app/learn/system-tray/), [TrayIcon Rust API](https://docs.rs/tauri/latest/tauri/tray/struct.TrayIcon.html) — `TrayIconBuilder`, `set_icon`/`set_tooltip`.
- [Tauri v2 CSP docs](https://v2.tauri.app/security/csp/) — directive object syntax, `ipc:`/`asset:` quirks.

## Previous Story Intelligence

- **Story 2.4** (done): established `web/app/tokens.css` (Story 2.2) as the CSS source of truth for all `web/` UI and confirmed the CSP-adjacent pattern of "build against the current file, not stale prose." Testing convention repo-wide: `vitest` unit tests only (no component/DOM testing library exists), manual browser walkthroughs documented in Dev Agent Record for anything not unit-testable — mirror this for the settings-panel manual verification in Task 5. A recurring review-round pattern worth avoiding pre-emptively: keep any collapsible/disclosure UI always-mounted (toggle via `hidden`, not conditional unmount) if the settings panel ever grows a second section; and if any focus ring relies on `box-shadow`/`outline: none`, pair it with a `@media (forced-colors: active)` fallback.
- **Story 2.2**: explicitly pre-approved this story's exemption from the design-token system (quoted above) — cite it, don't re-litigate it.
- **Story 1.1**: scaffolded the exact `agent/` layout this story builds on, including two prior review rounds' patches to the tray/window code (hide-not-close, macOS `ActivationPolicy::Accessory` only — no Windows equivalent yet, worth a one-line Dev Agent Record note since this story's AC-1 requires all four states cross-platform but Windows dock/taskbar-hiding parity was never implemented and is out of this story's stated scope — flag, don't silently fix unless trivial).
- **2.3a–2.3d**: 100% `web/`-side auth (Supabase JS clients, cookie session middleware) — confirms zero overlap with this story; nothing to reuse or avoid here.

## Git Intelligence Summary

- Commit convention to match: `Story 2.5: <what changed>` for implementation, `Story 2.5: Code review round — N patches applied, M deferred` for the review-closing commit (see `81ff66f`, `b86392d`, `f58aebe` for the exact pattern from 2.4).
- `agent/` has been untouched (no commits) since `5cb3b83` (1.1 scaffold) / `8b5447c` (1.1 review) — Epic 1's 9 stories all landed in `agent/src-tauri/src/{parser,joiner,genre,stats,confidence}` only.

## Latest Tech Information

- Tauri pinned at **2.11.5** (Cargo.lock) — `tray-icon` feature already enabled in `Cargo.toml`, no Cargo.toml version bump needed for this story.
- `TrayIconBuilder` (build-time) vs `TrayIcon::set_icon`/`set_tooltip` (runtime updates) is the correct split — build once at `run()` startup, then call the setters whenever real state should change later (2.6/2.8/3.x will call into whatever function this story exposes).
- CSP in `tauri.conf.json` v2 takes either a single string or a directive object (per-directive strings/arrays) — this story should use the object form for readability, see Dev Notes example. Tauri auto-injects nonces/hashes for bundled assets at compile time; don't hand-roll those.

## Story Completion Status

Ultimate context engine analysis completed - comprehensive developer guide created.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via Claude Code

### Debug Log References

- rustup toolchain found at `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin`, not on default PATH (same recurring gap as prior stories 1.7–1.9).
- Full four-command cargo gate run and green on this machine: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo build`, `cargo test` (134 unit + 9 integration tests passed, including the 7 new tray/settings tests; zero regressions in the pre-existing parser/joiner/genre/stats/confidence suites).
- Manual walkthrough performed by running the real debug binary (`cargo run`) on this machine (macOS) and having Arjun (the DJ/user) confirm on-screen, since this is a native tray app with no browser or installed `.app` bundle for automated screenshot tooling to attach to:
  - Tray icon visible with correct tooltip text; the debug "Cycle tray state" menu item cycled the tooltip through all four states in order (Idle → Syncing → Sync failed → Drive not connected → back to Idle) — confirmed by Arjun.
  - Left-click opened the settings window as a small native (non-resizable) panel, not a full window — confirmed by Arjun.
  - Persistence round-trip: typed `/tmp/test-serato` into the field, clicked Save, quit via the tray menu, relaunched (`cargo run`) — verified on disk that `~/Library/Application Support/app.curfew.agent/settings.json` held `{"serato_path_override":"/tmp/test-serato"}`, and Arjun confirmed the reopened settings panel pre-filled the field with that value. Test settings file removed afterward to leave no residue on the dev machine.

### Completion Notes List

- All four tasks were already implemented in the working tree at the start of this session (tray state machine in `tray.rs`, settings persistence + Tauri commands in `settings.rs`, CSP hardened to the object-form restrictive policy, capabilities scoped to `core:default` + `dialog:allow-open`, native settings panel in `agent/ui/index.html`). This session's work was running and verifying the gate (all four cargo commands) and the manual walkthrough (Task 5), then closing out story bookkeeping.
- ai-3 (CSP hardening action item) is closed: `app.security.csp` in `tauri.conf.json` is no longer `null`.
- No Windows dock/taskbar-hiding parity exists (only macOS `ActivationPolicy::Accessory` is set) — flagged per Story 1.1's carried note, not fixed here; out of this story's stated scope (no Windows dev/CI environment available to verify against).
- No new deferred-work.md entries identified during this pass.

### File List

- `agent/src-tauri/src/tray.rs` (new)
- `agent/src-tauri/src/settings.rs` (new)
- `agent/src-tauri/src/lib.rs` (modified — tray/settings wiring, module registration, invoke handlers)
- `agent/src-tauri/tauri.conf.json` (modified — CSP hardened, window resized/non-resizable)
- `agent/src-tauri/capabilities/default.json` (modified — added `dialog:allow-open`)
- `agent/src-tauri/Cargo.toml` / `Cargo.lock` (modified — added `tauri-plugin-dialog`)
- `agent/ui/index.html` (modified — replaced placeholder with the real settings panel)
- `agent/src-tauri/icons/tray/*.png` (new — idle/syncing/failed/drive-not-connected, @1x and @2x)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — story status)
