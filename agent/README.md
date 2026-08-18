# agent — Curfew local capture service (Tauri 2 + Rust)

The desktop agent that watches Serato, parses sessions, joins them against the
DJ's library, derives per-set stats, and syncs the derived payload to the cloud.
First-party Tauri 2 app (AR-16); its only UI surface is a menu-bar tray icon and
a minimal settings panel (UX-DR23).

```text
agent/
  ui/index.html         # the committed static tray/settings surface (no bundler)
  scripts/check-ui.mjs  # the workspace "build"/"lint" — asserts ui/ exists
  package.json          # pnpm workspace member (no npm deps — the surface is static)
  spike-1-2-parser-validation/  # throwaway Story 1.2 crate, kept as provenance (below)
  src-tauri/            # the Rust core
    Cargo.toml
    tauri.conf.json     # frontendDist -> ../ui
    capabilities/ icons/
    examples/           # demo-account pipeline (see below) — never shipped
    src/
```

## The pipeline

`src/lib.rs` is the map: every module carries a doc comment naming its story and
the architecture decision behind it. The core is a pipes-and-filters chain
(ARCHITECTURE-SPINE / SOLUTION-DESIGN §2), each filter independently testable
with a typed hand-off:

```text
watcher → parser → joiner → genre → stats → store → sync-queue
```

| Module | What it does |
| --- | --- |
| `watcher` | Serato install auto-detection (OS defaults + removable volumes), manual override, and the live watch loop (new sessions, drive reconnect). |
| `parser` | Legacy `.session` files and Serato 4+'s `master.sqlite` play log → an ordered list of plays. |
| `joiner` | Resolves a played track to the BPM/key/genre in the DJ's library, across both library formats, with an embedded-tag (ID3 / Vorbis) fallback. |
| `genre` | Normalizes a raw genre to the fixed Curfew taxonomy (raw + normalized + `taxonomy_version`, AD-12). |
| `stats` | Assembles enriched plays, then per-set summary stats, Camelot-wheel mixing stats, and the energy arc — arithmetic only (NFR-1, NFR-3). |
| `confidence` | Live-vs-practice heuristic. A *sibling* consumer of the stat-engine's output, not a stage in the chain. |
| `store` | Local SQLite: durable parse, offline cache, raw retention. Authoritative for a set until it syncs. |
| `sync` / `sync_queue` | Deterministic `set_id = hash(dj_id, session_identity)` (AD-4) pushed via an idempotent PostgREST RPC, plus the backoff drain loop for offline backlog. |
| `capture` | Orchestration — wires the above into one captured session. |
| `auth` | Deep-link handoff from `web/`'s `/link-agent`, OS-native secure refresh-token storage (Keychain / Credential Manager), JWT refresh. |
| `tray` | The six-state tray machine: idle, syncing, queued, failed, drive-not-connected, format-drift-paused. |
| `heartbeat` | Posts the current tray state to `set_agent_status` on each drain pass, so the dashboard can tell a live-but-idle agent from a silent one. |
| `backfill` / `error_reporting` | Retries unresolved `parse_failures` after a version bump; reports terminal failures to Sentry tagged with `agent_version` (AR-7 layers 2–3). |
| `fs_scope` / `config` / `settings` | Read confinement to the configured Serato root; build-time Supabase/web URLs; local settings. |

The agent depends on `shared` and never on `web` (AD-3). The seam is
`shared/schema/sync-payload.schema.json`, `include_str!`'d into the binary at
compile time — Rust cannot import the TypeScript type, and a bundled agent has
no `shared/` source tree on disk. Frozen and additive-only since Story 1.10
(AD-15).

## Build & verify

Cargo must be on PATH (if Rust came from Homebrew's keg-only rustup:
`export PATH="/opt/homebrew/opt/rustup/bin:$PATH"`).

```bash
cargo fmt    --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo build  --manifest-path src-tauri/Cargo.toml
cargo test   --manifest-path src-tauri/Cargo.toml
```

Those four are exactly what CI's `agent` job runs
([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) — note `--all-targets`
on clippy, which lints tests and examples too.

## `examples/` — the demo-account pipeline

Four `cargo` examples, never shipped in the binary, that build the June demo
account from Arjun's real Serato library
(`_bmad-output/planning-artifacts/demo-account-spec.md`): `demo_catalog_extractor`
→ `demo_overlay_scrub` → `demo_set_generator` → `demo_account_writer`. Each
file's header doc comment has its own runnable invocation.

## `spike-1-2-parser-validation/` — kept on purpose

A throwaway Story 1.2 crate: not a workspace member, never compiled into
`agent_lib`, not touched by CI. **Do not extend it** — the production parser was
written fresh in Stories 1.3+.

It stays because it is the provenance for decisions the production code still
depends on. `parser/session.rs` cites its ground-truth harness by file and line
for *why* plays are sorted by start time (151/151 and 253/253 positions matched
against `master.sqlite`), and `parser/serato4.rs` names it as the source its
`history_session` queries were ported from. Its written findings live in
`_bmad-output/implementation-artifacts/1-2-parser-validation-spike-findings.md`.

Only 8 files are tracked; its `target/` directory is untracked build output and
is safe to `rm -rf` at any time.

## Release builds

Local development uses the plain `cargo build` loop above — unsigned, and it
does not produce an installable bundle (`tauri-cli` isn't installed locally).
A signed, notarized `.dmg` is produced by
[`.github/workflows/release-macos.yml`](../.github/workflows/release-macos.yml)
when an `agent-v*.*.*` tag is pushed (Story 2.9a, AR-14). The same tag push
also triggers
[`.github/workflows/release-windows.yml`](../.github/workflows/release-windows.yml),
which produces a signed Windows installer (Story 2.9b, AR-14) — both
workflows publish to the same GitHub Release. Local Windows builds stay
unsigned too, same as macOS above: the signing config lives only in
`src-tauri/tauri.windows-release.conf.json`, merged in by the release
workflow, not the base `tauri.conf.json`.

The same tag push also produces a signed `latest.json` update manifest
(Story 2.9c, AR-14), via a separate updater-signing keypair — distinct from
the platform code-signing certs above. See the "Tauri updater signing
keypair" row in
[`_bmad-output/implementation-artifacts/pre-launch-services-checklist.md`](../_bmad-output/implementation-artifacts/pre-launch-services-checklist.md)
for the one-time generation command.

**Version placeholders.** `Cargo.toml`, `tauri.conf.json`, and `package.json`
all read `0.0.0` deliberately. The release workflows substitute the version from
the pushed tag and first assert the anchor reads exactly `0.0.0` — bumping it by
hand breaks every release build.
