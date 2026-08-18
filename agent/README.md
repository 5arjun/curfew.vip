# agent — Curfew local capture service (Tauri 2 + Rust)

The desktop agent that watches Serato, parses sessions, joins them against the
DJ's library, derives per-set stats, and syncs the derived payload to the cloud.
First-party Tauri 2 app (AR-16); its only UI surface is a menu-bar tray icon and
a small settings popover — an account row with a Link button, and the Serato
library-folder picker.

That popover **supersedes** UX-DR23 / Story 2.5 AC-2's "native OS chrome only,
no design tokens" rule (Arjun, 2026-08-17): the panel was a developer
affordance when that AC was written, and it is now the first screen a paying DJ
meets after install. It is on-brand and dark-only. `ui/index.html`'s header
comment carries the reasoning and the one trap — its five brand tokens are
**copied literal values**, not imports, because a standalone Tauri webview has
no build step and no access to `web/app/tokens.css`. Nothing will notice if the
brand moves.

Some references below point into `_bmad-output/`, which is **gitignored** — it
exists on Arjun's machine and in no clone. They are named rather than linked
for that reason.

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
account from Arjun's real Serato library (spec: `demo-account-spec.md`,
local-only): `demo_catalog_extractor`
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
`1-2-parser-validation-spike-findings.md` (local-only) — but the load-bearing
citations are in the production source, not there.

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
which produces an **unsigned** Windows installer (Story 2.9b, AR-14) — both
workflows publish to the same GitHub Release. Windows code signing was
declined on purpose (2026-08-16); that file's header carries the reasoning and
the SmartScreen warning it costs the user. Local Windows builds differ from
macOS only in the bundle config applied:
`src-tauri/tauri.windows-release.conf.json` is merged in by the release
workflow, not the base `tauri.conf.json`.

The same tag push also produces a signed `latest.json` update manifest
(Story 2.9c, AR-14), via a separate updater-signing keypair — distinct from
the platform code-signing certs above. One shared keypair signs both platforms'
artifacts. It already exists; the one-time generation command was:

```bash
pnpm dlx @tauri-apps/cli@latest signer generate --ci -p "" \
  -w ~/.tauri/curfew-agent-updater.key
```

Two properties of it fail **silently at update time rather than at build
time**, which is why they are stated here rather than in a doc no clone has.
The public key in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) must
stay byte-identical to `~/.tauri/curfew-agent-updater.key.pub`, or every
auto-update fails signature verification on the DJ's machine. And
**`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` must not exist as a repo secret** — the
keypair was generated with an empty password (`-p ""`) and both workflows pass
that optional var through empty; creating it with any value breaks signing.

**Version placeholders.** `Cargo.toml`, `tauri.conf.json`, and `package.json`
all read `0.0.0` deliberately. The release workflows substitute the version from
the pushed tag and first assert the anchor reads exactly `0.0.0` — bumping it by
hand breaks every release build.

### Cutting a release

Bump [`VERSION`](VERSION) to the next plain `X.Y.Z` and merge to main.
[`.github/workflows/tag-agent.yml`](../.github/workflows/tag-agent.yml) pushes
the matching `agent-v` tag, and the two release workflows above take it from
there. Merging agent changes *without* bumping `VERSION` releases nothing —
that is the point, so the file is the release decision and it shows up in
review. Never hand-push an `agent-v` tag; that leaves `VERSION` claiming a
version that was never built.

`VERSION` is the input to the release. The `0.0.0` anchors above are what the
workflow rewrites during the build. They are not redundant — nothing reads
`VERSION` at compile time.

Anything the agent *embeds* is also on this release path, not just Rust
changes. `shared/schema/sync-payload.schema.json` is compiled into the binary
via `include_str!` (`src-tauri/src/lib.rs`), so editing it and shipping only the
web app leaves every installed agent on the old contract. Bump `VERSION` in the
same PR.

Once released, installed agents update themselves within about six hours —
silently, with no prompt, skipping any agent mid-capture until the next tick
(`updater_loop`, `src-tauri/src/lib.rs`). There is no staged rollout and no way
to recall a build: the fix for a bad release is a higher `VERSION`.
