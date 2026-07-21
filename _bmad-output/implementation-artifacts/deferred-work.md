# Deferred Work

## Deferred from: code review of 1-1-monorepo-scaffold-with-three-workspaces (2026-07-21)

- **`csp: null` in Tauri config** — the webview Content-Security-Policy is disabled in the baseline every later story inherits. The agent will later load/parse local Serato data; a `null` CSP tends never to get tightened. Set a restrictive CSP before the agent loads untrusted/local file content. [agent/src-tauri/tauri.conf.json:20]
- **No OS matrix in CI** — the Rust agent core is only built and tested on `ubuntu-latest`. Cross-platform (macOS/Windows) compile breakage is unguarded. Deferred because signed cross-platform bundling is explicitly Epic 2 (AR-14) scope. [.github/workflows/ci.yml:48]
- **Shallow TS↔schema parity check** — the parity test (Rust + vitest) asserts only the AR-15 enums and `contract_version`, not full property sets / required keys. Structural drift between the TS type and JSON schema can pass both guards. Deferred to contract-freeze work (Story 1.10). [agent/src-tauri/src/lib.rs:49; shared/src/index.test.ts]

## Deferred from: code review round 2 of 1-1-monorepo-scaffold-with-three-workspaces (2026-07-21)

- **`window.is_visible().unwrap_or(false)` swallows errors** — the tray click handler treats a platform visibility-query error as "not visible," which could re-show/refocus an already-visible window with no diagnostic. Low likelihood, low impact. [agent/src-tauri/src/lib.rs]
- **Heavy full Supabase stack in CI for a no-op migration** — the `supabase` CI job boots Postgres, Studio, Auth, Storage, Realtime, Edge Runtime, Analytics, vector, etc. just to prove one no-op migration applies. Mirrors what the story's Dev Notes prescribe, so it's an accepted tradeoff today, not a code defect — worth a lighter-weight CI investigation later. [.github/workflows/ci.yml]
- **`sync_payload_schema_path()` uses a compile-time build-machine path** — resolves the shared schema via `env!("CARGO_MANIFEST_DIR")`, which won't exist on a bundled, installed end-user agent. Fine for `cargo test` today; real pipeline wiring (where this needs a runtime-relative or embedded-resource path) is Stories 1.3+ scope. [agent/src-tauri/src/lib.rs]
