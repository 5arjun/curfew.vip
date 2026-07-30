# agent — Curfew local capture service (Tauri 2 + Rust)

The desktop agent that watches Serato, parses sessions, derives per-set stats, and
syncs the derived payload to the cloud. First-party Tauri 2 scaffold (AR-16).

```text
agent/
  ui/                 # committed static tray/settings surface (UX-DR23: native + minimal)
  scripts/check-ui.mjs# the workspace "build"/"lint" — asserts ui/ exists
  package.json        # pnpm workspace member (no npm deps — the surface is static)
  src-tauri/          # the Rust core
    Cargo.toml
    tauri.conf.json   # frontendDist -> ../ui
    capabilities/
    icons/
    src/
      main.rs         # thin bin: calls agent_lib::run()
      lib.rs          # the core: run() + shared-contract consumption (AC-2)
```

## What exists today (Story 1.1)

Only the **shell**: it compiles, `fmt`/`clippy` are clean, and it proves it can
consume the shared sync contract by loading + parsing
`shared/schema/sync-payload.schema.json` (Rust cannot import the TS type). The
real pipeline — `watcher → parser → joiner → stat-engine → local store →
sync-queue` — lands as clean modules in Stories 1.3–1.7. Parser crates
(`triseratops` at a pinned git commit, `id3`) are **deliberately not added yet**
(Story 1.3, AR-5).

## Build & verify

Cargo must be on PATH (if Rust came from Homebrew's keg-only rustup:
`export PATH="/opt/homebrew/opt/rustup/bin:$PATH"`).

```bash
cargo build   --manifest-path src-tauri/Cargo.toml
cargo fmt     --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy  --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo test    --manifest-path src-tauri/Cargo.toml   # incl. the shared-schema test
```

## Release builds

Local development uses the plain `cargo build` loop above — unsigned, and it
does not produce an installable bundle (`tauri-cli` isn't installed locally).
A signed, notarized `.dmg` is produced by
[`.github/workflows/release-macos.yml`](../.github/workflows/release-macos.yml)
when an `agent-v*.*.*` tag is pushed (Story 2.9a, AR-14). The same tag push
also triggers
[`.github/workflows/release-windows.yml`](../.github/workflows/release-windows.yml),
which produces a signed Windows installer (Story 2.9b, AR-14) — both
workflows publish to the same GitHub Release. On Windows, `cargo tauri build`
locally stays unsigned too: the signing config lives only in
`src-tauri/tauri.windows-release.conf.json`, merged in by the release
workflow, not the base `tauri.conf.json`.
