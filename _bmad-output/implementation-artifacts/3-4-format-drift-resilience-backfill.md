---
baseline_commit: 2b531fa6fa4c62bfc49864e23f93d47530655715
---

# Story 3.4: Format-drift resilience + backfill

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the system,
I want agent-side error reporting tagged by `agent_version` and the ability to backfill affected sets from retained raw data,
so that a Serato format change is detected and recoverable without data loss.

## Acceptance Criteria

1. **Given** a parse/enrich error, **When** it occurs, **Then** it is reported tagged with `agent_version`. *(AR-7 layer 2, NFR-4)*
2. **Given** a fix shipped via the signed auto-updater, **When** affected sets are reprocessed, **Then** they backfill from raw data retained in local SQLite. *(AR-7 layer 3 + backfill)*
3. **Given** format-drift is detected, **Then** the tray shows the calm "format-drift paused" state and copy. *(UX-DR18, UX-DR19)*
4. **Given** the three drift layers (CI golden files, tagged error reporting, signed updater + backfill), **Then** all three are present. *(AR-7)*

## Tasks / Subtasks

- [x] **Task 1: `agent_version` constant + Sentry-based tagged error reporting** (AC: 1)
  - [x] Add `pub const AGENT_VERSION: &str = env!("CARGO_PKG_VERSION");` to `agent/src-tauri/src/config.rs` — this is a compiler-provided env var (from `Cargo.toml`'s `[package] version`), no `build.rs` plumbing needed, unlike the other three constants in that file.
  - [x] Add `pub const SENTRY_DSN: &str = env!("SENTRY_DSN");` to `config.rs`, following the exact existing convention: `build.rs`'s `emit_build_time_env()` add `"SENTRY_DSN"` to its `for key in [...]` array (currently `["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "CURFEW_WEB_URL"]`, `build.rs:16`) so an unset `.env.local`/CI secret compiles to an empty string rather than failing the build — same "never fail the build over a missing value" rule the doc comment at `config.rs:1-7` already states.
  - [x] Add `sentry` to `agent/src-tauri/Cargo.toml` `[dependencies]`. **Architect call, flagged for Arjun** — see Dev Notes "New dependency decision: Sentry" below for why this is the right shape and what it costs. Pin `default-features = false` and select the `rustls` TLS feature explicitly (not `native-tls`), mirroring the exact rationale already written next to the `reqwest` dependency (`Cargo.toml:~130`, "avoids a second, OS-native TLS stack") — verify the crate's current feature names at implementation time (`backtrace`, `contexts`, `panic` are the typical always-wanted defaults; confirm the TLS/transport feature name against the version you pin, since Sentry's Rust SDK has renamed transport features across majors).
  - [x] New module `agent/src-tauri/src/error_reporting.rs`, registered in `lib.rs`'s module list. Structure it as a small trait + real/fake pair, mirroring `auth::client::AuthClient` / `sync::SyncClient`'s existing DI pattern (this crate's established way to keep a network-calling side effect unit-testable without a mocking framework):
    ```rust
    pub trait ErrorReporter: Send + Sync {
        fn report(&self, context: &str, agent_version: &str, message: &str);
    }
    pub struct SentryReporter;
    impl ErrorReporter for SentryReporter {
        fn report(&self, context: &str, agent_version: &str, message: &str) {
            if config::SENTRY_DSN.is_empty() { return; } // no-op until Arjun provisions a DSN
            sentry::configure_scope(|scope| {
                scope.set_tag("agent_version", agent_version);
                scope.set_tag("context", context);
            });
            sentry::capture_message(message, sentry::Level::Error);
        }
    }
    pub fn init() -> Option<sentry::ClientInitGuard> {
        if config::SENTRY_DSN.is_empty() { return None; }
        Some(sentry::init((config::SENTRY_DSN, sentry::ClientOptions {
            release: Some(config::AGENT_VERSION.into()),
            ..Default::default()
        })))
    }
    ```
    Confirm the exact `sentry::init`/`ClientOptions`/`configure_scope` API shape against the pinned crate version's own docs — the sketch above is illustrative, not verbatim-guaranteed API.
  - [x] Call `let _sentry_guard = error_reporting::init();` as the **first line** of `lib.rs`'s `pub fn run()` (`lib.rs:220`), before `tauri::Builder::default()`. `run()` blocks for the app's whole lifetime (`.run(tauri::generate_context!())` at `lib.rs:541` never returns until exit), so binding the guard to a local here is sufficient to keep it alive for the whole process — no managed state or static needed. Returns `None` (no-op, nothing to hold) when `SENTRY_DSN` is empty.
  - [x] **Do not** wire a fake/no-network `ErrorReporter` implementation into production code paths — only into tests (Task 6). Production call sites always construct `error_reporting::SentryReporter` (or thread a `&dyn ErrorReporter` through, real impl by default).

- [x] **Task 2: Local parse-failure ledger, wired into terminal capture failures** (AC: 1, 2)
  - [x] Add a new table to `store.rs`'s `SCHEMA_SQL` (`store.rs:33-46`) — an **additive new table**, not an `ALTER TABLE` on `captured_sessions` (this codebase has no precedent for adding a column to an existing local SQLite file across DJ machines already running an older schema; `CREATE TABLE IF NOT EXISTS` sidesteps that entirely, same reasoning Story 3.3b used when it added `SessionStatus::Superseded` as a free string rather than a schema change):
    ```sql
    CREATE TABLE IF NOT EXISTS parse_failures (
      session_identity     TEXT PRIMARY KEY,
      source                TEXT NOT NULL,        -- 'legacy' | 'serato4'
      raw_ref               TEXT NOT NULL,
      failed_agent_version  TEXT NOT NULL,
      failed_at             INTEGER NOT NULL,      -- unix epoch seconds, agent wall-clock
      last_error            TEXT NOT NULL
    );
    ```
  - [x] Add `ParseFailureRow` struct + functions to `store.rs`, following the exact `CapturedSessionRow`/`upsert_captured` conventions already in the file (`store.rs:172-213`, `303-347`):
    - `record_parse_failure(conn, session_identity: &str, source: SessionSource, raw_ref: &str, agent_version: &str, error_message: &str) -> Result<(), StoreError>` — `INSERT ... ON CONFLICT(session_identity) DO UPDATE SET failed_agent_version = excluded.failed_agent_version, failed_at = excluded.failed_at, last_error = excluded.last_error` (a session can fail more than once across restarts; each failure overwrites the row with the latest attempt's info, it does not accumulate history).
    - `unresolved_parse_failures(conn) -> Result<Vec<ParseFailureRow>, StoreError>` — every row, no filter (there is no "resolved" status; a resolved failure is deleted, see `clear_parse_failure`).
    - `has_unresolved_parse_failures(conn) -> Result<bool, StoreError>` — `SELECT EXISTS(SELECT 1 FROM parse_failures LIMIT 1)`. This is the tray-precedence signal Task 4 needs.
    - `clear_parse_failure(conn, session_identity: &str) -> Result<(), StoreError>` — `DELETE FROM parse_failures WHERE session_identity = ?`. Called only after a reprocess attempt (Task 3) succeeds.
  - [x] Wire `record_parse_failure` + an `ErrorReporter::report` call into the **terminal** failure branches — `watcher/mod.rs`'s `capture_and_store_serato4`'s `Err(_e) => { ... false }` arm (`mod.rs:724-728`) and `capture_and_store_legacy`'s equivalent (`mod.rs:895-902`). These are the right (and only) call sites: they fire once the quiet period has already elapsed / `history_session` already confirmed the session is real, i.e. after the mid-write transient-parse noise has already been filtered out upstream (`handle_legacy_session_event`'s own `let Ok(outcome) = ... else { return; }` at `mod.rs:751-753` silently ignores a still-being-written file — that path must **not** report to Sentry on every modify event, or every session ever recorded would spam an event). Do **not** add reporting anywhere else.
    - Both functions need an `&dyn error_reporting::ErrorReporter` parameter added to their own signature (DI, same reasoning as Task 1) — but **do not thread it any further up the call chain**. `SentryReporter` is a stateless unit struct (it reads `config::SENTRY_DSN` internally inside `report()`, takes no constructor args), so every *caller* of `capture_and_store_serato4`/`_legacy` simply passes `&error_reporting::SentryReporter` as a literal at the call site — no new parameter needed on `recheck_pending_serato4`, `check_for_new_sessions`, `recheck_legacy_quiet_periods`, `advance_serato4`/`advance_legacy`, or `watch_loop` itself. **All call sites must still be updated to add that literal argument, or the crate will not compile** — `capture_and_store_serato4` has three production call sites (`recheck_pending_serato4` at `mod.rs:639`, `check_for_new_sessions` at `mod.rs:975`) and `capture_and_store_legacy` has one (`recheck_legacy_quiet_periods` at `mod.rs:828`), plus **eight existing test call sites** from Story 3.3b's dedup integration tests (`mod.rs:1351,1367,1405,1418,1454,1464,1488,1504`) that need a fake (e.g. a `struct NoopReporter;` local to the test module implementing `ErrorReporter` as a no-op), not `SentryReporter`, so those tests never depend on `config::SENTRY_DSN`'s build-time value. Grep for both function names before considering this task done.
    - `capture_and_store_serato4`'s error branch needs `identity = capture::serato4_session_identity(session_id)` and `raw_ref = capture::serato4_raw_ref(db_path, session_id)` computed before the `match` (today only computed inside the `Ok` arm, `mod.rs:661-662`) so the `Err` arm can call `record_parse_failure` too.
    - `capture_and_store_legacy`'s error branch needs `raw_ref = session_path.to_string_lossy().into_owned()` computed before the `match` (today only inside `Ok`, `mod.rs:845`) for the same reason; `session_identity` is already a parameter.
    - Bump both functions' visibility to `pub(crate)` — Task 3's backfill sweep calls them directly from a new module.

- [x] **Task 3: Startup backfill/reprocess sweep from retained raw data** (AC: 2)
  - [x] New module `agent/src-tauri/src/backfill.rs`. One function: `pub fn reprocess_parse_failures(store_conn: &Connection, plan: &watcher::detect::WatchPlan, reporter: &dyn error_reporting::ErrorReporter)`.
    - Read `store::unresolved_parse_failures(store_conn)`; for each row, **skip** (leave untouched) if `row.failed_agent_version == config::AGENT_VERSION` — retrying under the identical build that already failed it would just fail again identically and re-spam Sentry for no new information. This is the mechanism that makes "backfill happens after a fix ships" true: the row only gets retried once the agent has actually restarted on a *newer* build (which only happens via Task 5's updater flow, or a manual reinstall).
    - For a `SessionSource::Serato4` row: skip if `plan.serato4` is `None` (no serato4 source currently configured — nothing to reprocess against); otherwise parse the session id back out via `capture::parse_serato4_raw_ref(&row.raw_ref)` (already exists, `capture.rs:103-106`) and call `watcher::capture_and_store_serato4(store_conn, &plan.serato4.root, &plan.serato4.db_path, session_id, reporter)`.
    - For a `SessionSource::Legacy` row: skip if `plan.legacy` is `None`; otherwise call `watcher::capture_and_store_legacy(store_conn, &plan.legacy.library_root, Path::new(&row.raw_ref), &row.session_identity, reporter)`.
    - **Reuse `capture_and_store_serato4`/`_legacy` as-is rather than re-implementing capture logic here** — on success they already call `store::upsert_captured` (which feeds Story 3.2's sync queue automatically, since `rows_pending_sync` filters on `status = 'captured'`); on continued failure they already re-call `record_parse_failure` (Task 2) with the *new* `agent_version`, so a genuinely-still-broken parser correctly re-reports rather than going silent. This function's only job is to call `store::clear_parse_failure(store_conn, &row.session_identity)` when the call returns `true` (success).
  - [x] Call `backfill::reprocess_parse_failures` once at startup, on a spawned thread, from `lib.rs`'s `.setup()` — mirror the existing "startup eager-refresh" pattern (`lib.rs:506-537`: spawned thread, not inline, so `.setup()` never blocks on I/O). Resolve the `WatchPlan` the same way `watch_loop`'s first tick does (`watcher::resolve_home` + `watcher::detect::resolve_watch_plan`, both already exist from Story 3.3b) before calling.
  - [x] `Serato4Source`/`LegacySource` (Story 3.3b, `detect.rs`) already expose `root`/`db_path` and `library_root` respectively — no new fields needed on those structs.

- [x] **Task 4: `TrayState::FormatDriftPaused` + precedence wiring** (AC: 3)
  - [x] Add a sixth `TrayState` variant to `tray.rs` following the exact mechanical pattern Story 3.3 used to add `Queued` (`tray.rs:19-105`): add to the enum, add to the `ALL` const array (becomes `[TrayState; 6]`), add a `tooltip()` arm, add light/dark `icon()` arms.
    - Tooltip: `"Curfew Agent — Format drift detected"` — matches the existing terse `"Curfew Agent — X"` tooltip convention (`Failed`/`DriveNotConnected`/`Queued`); the fuller Failure Register sentence ("Format change detected — sync paused until verified.", `EXPERIENCE.md:52`) is written for a future dashboard-status surface (Story 3.6+), not the tray tooltip — this story's tray-only scope doesn't need the longer copy verbatim, just a distinct, calm, non-alarmed label consistent with UX-DR18.
    - New icon assets: `agent/src-tauri/icons/tray/{light,dark}/format-drift-paused.png`. **Flag to Arjun**, exact wording from Story 3.3's own precedent (`3-3-offline-sync-queue.md` Dev Notes): generate a placeholder programmatically (same base glyph as the other five, a distinct badge color/mark that reads as "paused," not "error") rather than blocking on designed artwork — call this out explicitly, do not silently ship a stand-in without flagging it.
  - [x] Add `store::has_unresolved_parse_failures` (Task 2) as a new input to `sync_queue.rs`'s `desired_tray_state` (`sync_queue.rs:227-242`) — add a `has_format_drift: bool` parameter, checked **after** the existing `drive_connected != Some(true)` short-circuit (a disconnected drive is still the more urgent, more actionable problem) but **before** `has_transient_backlog`/`has_permanent_backlog`:
    ```rust
    fn desired_tray_state(
        drive_connected: Option<bool>,
        has_format_drift: bool,
        has_transient_backlog: bool,
        has_permanent_backlog: bool,
    ) -> Option<TrayState> {
        if drive_connected != Some(true) { return None; }
        Some(if has_format_drift {
            TrayState::FormatDriftPaused
        } else if has_transient_backlog {
            TrayState::Queued
        } else if has_permanent_backlog {
            TrayState::Failed
        } else {
            TrayState::Idle
        })
    }
    ```
    Update the call site (`sync_queue.rs:202-212`) to compute `has_format_drift = store::has_unresolved_parse_failures(conn).unwrap_or(false)` (fail-open to `false` on a store read error — do not let a store hiccup paint every DJ's tray red) once per pass, alongside the existing `has_transient_backlog`/`has_permanent_backlog` computation.
  - [x] **Recovery is automatic, no new code needed for it**: once Task 3's reprocess sweep clears every row, `has_unresolved_parse_failures` returns `false` on `sync_queue.rs`'s very next periodic pass (it already runs on a backoff-governed interval), and the tray reverts to `Idle`/`Queued`/`Failed` per the existing precedence — exactly the same "no explicit clear transition" pattern `drive_connected`'s boolean projection already uses (Story 3.3b Dev Notes).

- [x] **Task 5: Wire the dormant auto-updater plugin's check/download/install flow** (AC: 2, 4)
  - [x] **Read this before starting — a real, load-bearing gap, not a nice-to-have.** `tauri-plugin-updater` is registered (`lib.rs:231`, `.plugin(tauri_plugin_updater::Builder::new().build())`) and `tauri.conf.json` already has a real signing pubkey + a real GitHub-releases `latest.json` endpoint configured (Story 2.9c). But **nothing in this codebase calls `check()` or `download_and_install()` anywhere** — confirmed by grepping the whole crate and the native UI. Story 2.9c's own scope note says as much: "No JS/frontend consumer calls check()/downloadAndInstall() yet... this wires the plugin so it's functional once something does." **This story is that "something."** Without this task, AC-2 and AC-4 are false regardless of how well Tasks 1-4 are built: a shipped fix never reaches an installed agent, so "reprocessed after a fix ships" never happens on its own, and "signed updater" (layer 3) stays a registered-but-inert plugin, not a present layer.
  - [x] Add a private `updater_loop(app: AppHandle)` function (new code, `lib.rs` or a new small module — follow whichever keeps `lib.rs` from growing past its current size) mirroring `watch_loop`/`sync_loop`'s existing `std::thread::spawn(move || loop { ... })` shape exactly (`watcher/mod.rs:137`, `sync_queue.rs:84`) — **do not** introduce a `tokio` dependency or an async top-level loop; this codebase has zero existing `tokio::*`/`async_runtime::spawn` usage, and the updater plugin's `check()`/`download_and_install()` calls are the *only* async APIs this loop needs, so drop into async only for those two calls via `tauri::async_runtime::block_on(async { ... })` inside an otherwise-synchronous `loop { ...; std::thread::sleep(interval) }`:
    ```rust
    fn updater_loop(app: AppHandle) {
        loop {
            tauri::async_runtime::block_on(async {
                let Ok(updater) = app.updater() else { return; };
                match updater.check().await {
                    Ok(Some(update)) => {
                        if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                            app.restart(); // does not return
                        }
                    }
                    _ => {}
                }
            });
            std::thread::sleep(UPDATE_CHECK_INTERVAL);
        }
    }
    ```
    Verify the exact `UpdaterExt`/`app.updater()`/`Update::download_and_install` method names and signature against the pinned `tauri-plugin-updater` version's own docs (confirmed shape as of the v2 plugin docs at authoring time: `use tauri_plugin_updater::UpdaterExt;`, `app.updater()?.check().await?` returns `Option<Update>`, `update.download_and_install(on_chunk, on_finish).await?`, then `app.restart()`) — do not assume the sketch above is verbatim-correct for whatever version actually resolves.
  - [x] **Gate the whole loop behind `#[cfg(not(debug_assertions))]`** — an unsigned debug build has no valid updater signature to verify against anyway, and a dev loop silently polling GitHub every few hours during local development is pure noise. Spawn it from `.setup()` (`lib.rs`) alongside the other startup threads, release builds only.
  - [x] `UPDATE_CHECK_INTERVAL`: propose `Duration::from_secs(6 * 60 * 60)` (6 hours) as a starting default — **flag to Arjun as a tunable, not a load-bearing number**, same treatment Story 1.7 gave its unconfirmed performance targets. Check once immediately on startup (the loop's first iteration), then on that cadence thereafter.
  - [x] No UI change — this is silent background behavior with no user-facing prompt, consistent with FR-5 ("the agent's only UI is a menu-bar icon plus a minimal settings panel") and the product's existing "invisible until something needs attention" posture for the agent.

- [x] **Task 6: Automated coverage** (AC: all)
  - [x] `config::AGENT_VERSION` is non-empty and matches `Cargo.toml`'s `[package] version` (a trivial compile-time-constant sanity test).
  - [x] `error_reporting`: a fake `ErrorReporter` (e.g. `struct RecordingReporter(Mutex<Vec<(String,String,String)>>)`, mirroring `FakeAuthClient`/`FakeSyncClient`'s existing test-double pattern in `auth/client.rs`/`sync.rs`) asserts `report()` is called with the right `context`/`agent_version`/message on a terminal capture failure. `SentryReporter::report` itself only needs a structural test that it no-ops (does not panic, does not attempt a real network call) when `config::SENTRY_DSN` is empty — do not attempt to test real Sentry delivery; there is no network access in this crate's test suite and none should be added for this story.
  - [x] `store.rs`: `record_parse_failure` → `unresolved_parse_failures` round-trip; a second `record_parse_failure` for the same `session_identity` overwrites rather than duplicates (`ON CONFLICT` correctness); `has_unresolved_parse_failures` true/false; `clear_parse_failure` removes the row and `has_unresolved_parse_failures` flips back to `false`.
  - [x] `backfill::reprocess_parse_failures`: (a) a row whose `failed_agent_version` equals the current build's is left untouched (not retried, not cleared); (b) a row on an older `failed_agent_version`, reprocessed against a fixture where the underlying raw source now parses successfully, is cleared from `parse_failures` and lands as a `captured` row in `captured_sessions` (verify both, an end-to-end integration test against real on-disk fixtures, same style as Story 3.3b's `dedup_*` tests in `watcher::mod`); (c) a row that still fails on reprocess stays in `parse_failures`, now stamped with the new `agent_version` and a fresh `last_error`; (d) a row whose source is no longer present in the current `WatchPlan` (e.g. legacy source removed) is left untouched, not treated as resolved.
  - [x] `sync_queue.rs`'s `desired_tray_state`: extend the existing test suite (`sync_queue.rs:295-`) with cases proving `has_format_drift` outranks both backlog flags but is still suppressed when `drive_connected != Some(true)`, mirroring the existing `drive_not_connected_always_wins_regardless_of_backlog` test shape.
  - [x] `tray.rs`: extend the existing `TrayState::ALL` / tooltip / calm-copy-set tests (`tray.rs:316-357`) to cover the sixth variant, same mechanical pattern Story 3.3 followed for `Queued`.
  - [x] Follow established conventions exactly: inline `#[cfg(test)] mod tests` per file, small hand-rolled `enum ...Error` with `Display`/`std::error::Error` (no `thiserror`/`anyhow`), local `TempDir` RAII fixtures (already duplicated per-file per this crate's own stated convention — do not extract a shared test-support crate), no mocking framework.

- [x] **Task 7: Verification** (AC: all)
  - [x] Full local gate: `cargo build` / `cargo fmt --check` / `cargo clippy -- -D warnings` / `cargo test`, all `--manifest-path agent/src-tauri/Cargo.toml` (`agent/README.md`). Baseline is **309 passing** as of `2b531fa`.
  - [x] Repo-root `pnpm lint` / `pnpm typecheck` / `pnpm test` — expected untouched (no `web/`, `shared/`, or `supabase/` changes in this story; confirm via `git status` rather than assuming, per the standing process rule from the Epic 2 retrospective, ai-11).
  - [x] No `supabase test db` run needed — no schema, RPC, or wire-format change (the `agent_version` gap in the cloud sync payload/`sets` table, discovered during this story's research, is real but **out of scope** — see Dev Notes "A related gap this story does NOT close").
  - [x] Manual walkthrough is **Arjun's** — needs a real bundled `.app`, a way to force a parse failure, and (once provisioned) a real Sentry DSN. Write exact steps into Dev Notes rather than attempting them; see "Manual verification hand-off" below.

## Dev Notes

### New dependency decision: Sentry (architect call, flag to Arjun)

AD-13/AR-7 layer 2 requires "agent-side error reporting tagged with `agent_version`" so drift that only appears on a real DJ's machine post-release is ever seen at all — golden-file CI (layer 1) only catches what's caught *before* release. The PRD addendum names this illustratively as "Sentry-style error reporting" (`addendum.md:28`) but **no provider was ever actually chosen** — grepping the whole repo (`agent/`, `web/`, all planning docs) turns up zero existing error-tracking infrastructure anywhere, agent or web. This story is the first to need it, so the choice is made here:

**Decision: the official `sentry` Rust crate**, not a bespoke solution. Reasoning: AD-8 forbids a bespoke write path into Supabase except the billing webhook (a Stripe-signed exception) — inventing a second exception ("agent posts error JSON to a custom Supabase table") would be exactly the kind of ad-hoc write path AD-8 exists to prevent. A genuinely external third-party service sidesteps that entirely (it was never a "cloud mutation" in AD-8's sense to begin with) and matches the same "buy the undifferentiated part" posture the architecture already applied to Stripe (SOLUTION-DESIGN.md §3.7's own stated philosophy) and to `triseratops`/`id3`/`rusqlite` for parsing. Sentry's free tier is more than sufficient at this project's current scale (one real DJ, pre-launch), keeping NFR-3's near-zero-marginal-cost posture intact.

**What Arjun still needs to do, not blocking this story's implementation**: create a Sentry project and set `SENTRY_DSN` in `.env.local` (local/dev) and the release CI secrets (`tauri-action`'s workflow, alongside the existing signing secrets) before any real event is ever sent — until then `config::SENTRY_DSN` compiles to an empty string and `error_reporting` no-ops everywhere, exactly like `CURFEW_WEB_URL`'s existing "no confirmed production value yet — deferred to Arjun" treatment (`config.rs:17-20`). The dev-agent should build and test this story entirely against the empty-DSN no-op path; it does not need a real Sentry account to complete the four-command gate.

### A related gap this story does NOT close

While tracing "every payload carries `agent_version`" (AD-3), research for this story found that **the cloud sync payload never actually carries it** — `sync.rs`'s `SyncSetRequest` (`sync.rs:57-64`) has no `agent_version` field, and no migration ever added the column to `public.sets`/`public.sessions`. AD-3 states this as a hard requirement of the sync contract itself (a Story 3.1/3.2-era gap, not something this story introduced). It is **explicitly out of scope here**: this story's `agent_version` tagging is for the *local* error-reporting/backfill mechanism only (Sentry tags + the `parse_failures.failed_agent_version` column), which does not require the wire contract to change. Flagging this now rather than silently deferring it again (per the standing "close flagged gaps on a quick ruling" expectation) — **Arjun's call**: fix it in a follow-up story that touches `shared/`+`sync.rs`+a new migration together (real scope, not a one-line fix, since `shared/`'s contract is meant to be frozen-additive and touching it needs the same care Story 1.10 gave it), or confirm it's acceptable to leave until a heterogeneous agent fleet actually exists (AD-3's own stated reason for the requirement — "the cloud must accept the last N `agent_version`s" is meaningless with exactly one agent version ever having shipped). Recommend logging this to `deferred-work.md` regardless of which way the ruling goes.

### Why no consecutive-failure threshold

AC-1/AC-3 are read literally here: **any** terminal capture failure is reported and immediately shown as drift — there is no "wait for N failures before treating it as real" streak-counting. Reasoning: by the time `capture_and_store_serato4`/`_legacy` is called, the quiet period has already elapsed (legacy) or Serato's own `history_session` table already confirmed the session exists (serato4) — a terminal failure at this point is not "maybe transient," it's "we tried for real and it didn't work." A single corrupt file and genuine format drift are operationally indistinguishable at this layer regardless of how many times you retry an unparseable file; inventing a threshold parameter here would be guessing at a number with no data to justify it (the kind of unconfirmed-constant Story 1.7 explicitly flagged rather than silently picked). If this turns out to be too noisy in practice (a corrupt one-off file painting the tray red for no real reason), that is real signal to gather post-launch, not something to pre-guess.

### Backfill is keyed on `agent_version` change, not an explicit "retry now" trigger

The clean way to express "reprocess after a fix ships" (AC-2) without inventing new coordination state: `backfill::reprocess_parse_failures` (Task 3) only retries a row when the **current build's `agent_version`** differs from the version recorded at failure time. Combined with Task 5 (the agent actually restarting itself on a new version via the updater), this makes the whole loop self-driving: ship a parser fix → version bump → agent auto-updates → restarts → Task 3's sweep runs on that restart → anything that recorded a failure under the old version gets one retry under the new one. No cross-run signaling, no "an update just happened" flag needed — the version number itself *is* the signal.

### Read this before touching `watcher/mod.rs`: current failure behavior has a live retry-storm gap

Today, a terminal `capture_and_store_serato4`/`_legacy` failure returns `false` and the caller (`recheck_pending_serato4`/`recheck_legacy_quiet_periods`) simply leaves the session in its in-memory pending tracker — which means it is retried on **every subsequent poll tick**, forever, for a session that can never succeed until a real fix ships. This story's `record_parse_failure` call does not, by itself, stop that hot-retry loop (Task 2 only adds persistence + reporting alongside the existing behavior). Confirm this is acceptable before implementing: the working assumption for this story is that the retry storm is a pre-existing, out-of-scope issue (bounded in practice by the poll interval, and Sentry's own event volume from a repeatedly-firing identical error is a separate concern from whether the *first* report happens) — if you judge it needs throttling (e.g. only report once per session per `agent_version`, which `record_parse_failure`'s `ON CONFLICT` overwrite semantics already naturally rate-limits down to "one row, updated repeatedly" rather than unbounded rows), that is fine to build, but do not silently change the hot-retry cadence itself — that is Story 3.3/3.3b's territory and out of scope here.

### Scope boundaries — what this story is not

- **Agent-only** (same as 3.3b). No `web/` change, no `shared/` wire-format change (see "A related gap this story does NOT close" above for why not, despite AD-3's letter). One new Supabase-adjacent surface only in the sense that Sentry is a new third-party account to provision — no Supabase schema change.
- **No dashboard-side "format-drift paused" surface.** `EXPERIENCE.md:96` lists this state's surface as "Dashboard status + tray icon," but the dashboard (Story 3.6+) doesn't exist yet — this story is tray-only, matching epics.md's own AC-3 wording ("the tray shows...").
- **No consecutive-failure threshold, no configurable sensitivity** — see "Why no consecutive-failure threshold" above.
- **Does not fix the AD-3 sync-payload `agent_version` gap** — see "A related gap this story does NOT close" above.
- **Does not add a user-facing "update available" prompt or changelog UI** — the updater flow (Task 5) is silent, matching FR-5's minimal-UI mandate.

### Manual verification hand-off

Story 3.3b established the pattern (write exact steps for Arjun, do not attempt a live-hardware walkthrough in this session). Suggested steps, once the code lands and Arjun has provisioned a real `SENTRY_DSN`:

1. Build a real bundle: `cargo tauri build --debug --manifest-path agent/src-tauri/Cargo.toml`, launch the `.app`'s binary directly (not via `open`).
2. Force a terminal capture failure — the simplest lever is a deliberately corrupted `.session` fixture or a `master.sqlite` row `capture::build_serato4`/`build_legacy` cannot parse (a golden-file fixture from Story 1.9's suite, lightly mutated, is a good source rather than hand-crafting bytes from scratch). Confirm: (a) the event lands in the real Sentry project, tagged with the running build's `agent_version`; (b) a row appears in `local.sqlite`'s `parse_failures` table (`sqlite3 <app_local_data_dir>/local.sqlite "select * from parse_failures"`); (c) the tray shows the new format-drift tooltip/icon.
3. Bump `Cargo.toml`'s `[package] version`, rebuild, relaunch. Confirm the startup backfill sweep runs (check `#[cfg(debug_assertions)]` output or the local store) and, if the underlying fixture now parses (revert the corruption first), the `parse_failures` row clears and a `captured` row appears in `captured_sessions`, and the tray reverts to `Idle`.
4. Confirm the updater loop's `check()` call actually reaches `https://github.com/5arjun/curfew.vip/releases/latest/download/latest.json` (`tauri.conf.json:49`) without erroring — a real install/restart cycle needs an actual signed release published, which is a separate release-engineering action, not something to force in this walkthrough.

### Testing conventions (unchanged, follow exactly)

Established by Stories 2.6/2.8/2.10/3.2/3.3/3.3b, no deviation expected: inline `#[cfg(test)] mod tests` per file; small hand-written `enum FooError` with `Display`/`std::error::Error` (no `thiserror`/`anyhow`); local test-double structs over a shared test-support crate or mocking framework; `#[cfg(debug_assertions)] eprintln!` for swallowed non-fatal diagnostics. The one deliberate, flagged exception this story introduces is the `sentry` crate itself (Task 1) and, if it becomes necessary, `tauri::async_runtime::block_on` (Task 5, already part of `tauri` — not a new crate).

### Project Structure Notes

Files expected to change (all under `agent/`):
- `agent/src-tauri/src/config.rs` — **UPDATE**: `AGENT_VERSION`, `SENTRY_DSN` constants.
- `agent/src-tauri/build.rs` — **UPDATE**: add `"SENTRY_DSN"` to the env-passthrough list.
- `agent/src-tauri/Cargo.toml` — **UPDATE**: add `sentry` dependency.
- `agent/src-tauri/src/error_reporting.rs` — **NEW**: `ErrorReporter` trait, `SentryReporter`, `init()`.
- `agent/src-tauri/src/backfill.rs` — **NEW**: `reprocess_parse_failures`.
- `agent/src-tauri/src/store.rs` — **UPDATE**: `parse_failures` table, `ParseFailureRow`, `record_parse_failure`/`unresolved_parse_failures`/`has_unresolved_parse_failures`/`clear_parse_failure`.
- `agent/src-tauri/src/watcher/mod.rs` — **UPDATE**: `capture_and_store_serato4`/`_legacy` gain an `ErrorReporter` param + call `record_parse_failure` on terminal failure; visibility bumped to `pub(crate)`.
- `agent/src-tauri/src/tray.rs` — **UPDATE**: sixth `TrayState::FormatDriftPaused` variant + tooltip/icon/`ALL`.
- `agent/src-tauri/src/sync_queue.rs` — **UPDATE**: `desired_tray_state` gains `has_format_drift` param + precedence slot; call site computes it from `store::has_unresolved_parse_failures`.
- `agent/src-tauri/src/lib.rs` — **UPDATE**: `error_reporting::init()` call in `run()`; startup backfill-sweep spawn; `updater_loop` spawn (release builds only); module declarations for `error_reporting`/`backfill`.
- `agent/src-tauri/icons/tray/light/format-drift-paused.png`, `agent/src-tauri/icons/tray/dark/format-drift-paused.png` — **NEW**: placeholder assets (flag to Arjun).

Not expected: `web/`, `shared/`, `supabase/`, `agent/ui/index.html` (no settings-panel change).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.4] — acceptance criteria verbatim; lines 641-652.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md#AD-13] — the three-layer format-drift rule this story implements layers 2+3 of.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/ARCHITECTURE-SPINE.md#AD-3] — "every payload carries `agent_version`," the related gap this story flags but does not close.
- [Source: _bmad-output/planning-artifacts/architecture/architecture-name-pending-2026-07-20/SOLUTION-DESIGN.md#3.3] — the backfill-after-format-break sequence diagram this story's Task 3 implements.
- [Source: _bmad-output/planning-artifacts/prds/prd-name-pending-2026-07-19/addendum.md:28] — "Sentry-style error reporting" illustrative naming; no provider was actually chosen before this story.
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-name-pending-2026-07-19/EXPERIENCE.md:52,96] — Failure Register copy and the format-drift State Pattern row (tray + dashboard surfaces; this story covers tray only).
- [Source: _bmad-output/implementation-artifacts/3-3b-version-agnostic-history-capture.md] — previous story: `WatchPlan`/`Serato4Source`/`LegacySource`, `resolve_watch_plan`, `watcher::resolve_home`, the per-source `capture_and_store_*` functions this story extends, and its own "flag placeholder art to Arjun" precedent for `queued.png`.
- [Source: _bmad-output/implementation-artifacts/3-3-offline-sync-queue.md] — `desired_tray_state`'s precedence design and the `DriveTrayCoordinator` single-writer pattern this story extends.
- [Source: agent/src-tauri/src/config.rs] — existing build-time-constant convention (`SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`/`CURFEW_WEB_URL`), extended by this story's `AGENT_VERSION`/`SENTRY_DSN`.
- [Source: agent/src-tauri/build.rs] — `emit_build_time_env`'s env-passthrough list, extended by this story.
- [Source: agent/src-tauri/src/store.rs:33-46,122-213,303-347] — `SCHEMA_SQL`, `SessionStatus`, `CapturedSessionRow`, `upsert_captured` — the conventions `parse_failures`/`ParseFailureRow` mirror.
- [Source: agent/src-tauri/src/watcher/mod.rs:653-730,837-904] — `capture_and_store_serato4`/`_legacy`, the exact call sites this story's Task 2 instruments.
- [Source: agent/src-tauri/src/tray.rs:19-105,231-276] — `TrayState` enum + `DriveTrayCoordinator`, extended by Task 4.
- [Source: agent/src-tauri/src/sync_queue.rs:190-242] — `desired_tray_state`'s existing precedence logic, extended by Task 4.
- [Source: agent/src-tauri/src/lib.rs:220-231,506-537] — `run()`'s entry point and the existing spawned-startup-thread pattern Tasks 1/3/5 follow.
- [Source: agent/src-tauri/src/auth/client.rs, agent/src-tauri/src/sync.rs] — `AuthClient`/`SyncClient` trait-injection pattern, mirrored by `ErrorReporter` (Task 1).
- [Source: agent/src-tauri/tauri.conf.json:45-51] — the already-configured, currently-unused updater pubkey + GitHub-releases endpoint Task 5 wires up.
- [Source: agent/README.md] — the four-command cargo gate.
- [Source: https://v2.tauri.app/plugin/updater/] — `UpdaterExt`/`check()`/`download_and_install()` Rust API shape (fetched during this story's creation; verify against the pinned crate version at implementation time — plugin APIs move between majors).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via Claude Code.

### Debug Log References

None — no debugger/trace tooling invoked. All verification was the four-command cargo gate (`build`/`fmt --check`/`clippy -D warnings`/`test`) plus repo-root `pnpm lint`/`typecheck`/`test`, all run to completion.

### Completion Notes List

- **Pre-implementation decisions (Arjun, this session)**: (1) proceed with the `sentry` crate as scoped in Dev Notes; (2) the AD-3 cloud-sync-payload `agent_version` gap flagged in Dev Notes is deferred, not fixed in this story — logged to `deferred-work.md`.
- **Task 1** (`config.rs`/`build.rs`/`Cargo.toml`/`error_reporting.rs`/`lib.rs`): `AGENT_VERSION`/`SENTRY_DSN` constants added; `build.rs`'s env-passthrough list extended. `sentry = "0.49"` added, `default-features = false` + explicit `["backtrace", "contexts", "panic", "reqwest", "rustls"]` (0.49's own default transport pairs `reqwest` with `native-tls`; verified the crate's real feature set live via crates.io/docs.rs before pinning, since the story flagged the transport feature name as version-sensitive). `error_reporting.rs`: `ErrorReporter` trait, `SentryReporter`, `init()`. One deviation from the story's illustrative sketch, confirmed against `sentry-core` 0.49.0's actual source: `ClientOptions` is `#[non_exhaustive]`, so `sentry::ClientOptions { release: ..., ..Default::default() }` does not compile — used the crate's own builder instead, `sentry::ClientOptions::new().release(AGENT_VERSION)`. `_sentry_guard` bound as the first line of `run()`. 4 tests.
- **Task 2** (`store.rs`/`watcher/mod.rs`): additive `parse_failures` table (no migration) + `ParseFailureRow`/`record_parse_failure`/`unresolved_parse_failures`/`has_unresolved_parse_failures`/`clear_parse_failure`, mirroring `CapturedSessionRow`'s conventions. `capture_and_store_serato4`/`_legacy` bumped to `pub(crate)`, gained an `&dyn ErrorReporter` parameter, and now compute `identity`/`raw_ref` before the match (not just inside the `Ok` arm) so the terminal `Err` arm can call `record_parse_failure` + `reporter.report`. All 3 production call sites (`recheck_pending_serato4`, `check_for_new_sessions`, `recheck_legacy_quiet_periods`) pass `&error_reporting::SentryReporter` as a literal, unthreaded further up the call chain per the story's instruction; all 8 existing Story 3.3b dedup-test call sites updated to pass a new local `NoopReporter` fake. 4 new store tests.
- **Task 3** (`backfill.rs`, new module): `reprocess_parse_failures(store_conn, plan, reporter)` — skips a row whose `failed_agent_version` equals the current build's; otherwise reprocesses via `watcher::capture_and_store_serato4`/`_legacy` directly (no capture-logic duplication) and clears the ledger row on success. Spawned once at startup on its own thread from `lib.rs`'s `.setup()`, resolving the `WatchPlan` via the existing `watcher::resolve_home` + `watcher::detect::resolve_watch_plan`. 4 tests covering all four story-specified cases (same-version skip, older-version success, older-version still-fails re-stamps, source-removed-from-plan skip) — case (c)'s fixture needed a genuine `build_serato4` error (a `db_path` naming a file that was never created) rather than an empty/nonexistent session id, since the latter resolves to `CaptureError::EmptySession`, which `capture_and_store_serato4` treats as terminal-success (`true`), not a failure — an initial version of this test using the wrong fixture caught this and was corrected.
- **Task 4** (`tray.rs`/`sync_queue.rs`): sixth `TrayState::FormatDriftPaused` variant added mechanically (enum/`ALL`/tooltip/icon arms), tooltip `"Curfew Agent — Format drift detected"`. New placeholder icon assets generated programmatically via ImageMagick (same base disc-mark glyph as the other five, sampled the existing `queued.png`/`failed.png` badge geometry via pixel-bounding-box analysis to match position/size) — an amber filled circle with a white two-bar pause glyph, deliberately distinct from `queued`'s blue ring and `failed`'s solid red dot so it reads as "paused," not "error." **Flagging to Arjun per the story's own instruction**: these are placeholder art, not designed assets. `desired_tray_state` gained a `has_format_drift: bool` parameter, checked after the drive-connected short-circuit but before both backlog flags; both call sites (`sync_loop`'s pass-level `Err` branch and `handle_pass_outcome`, which now also takes `conn: &rusqlite::Connection`) compute it via `store::has_unresolved_parse_failures(conn).unwrap_or(false)`. 2 new precedence tests; existing tray/sync_queue tests updated for the new arg counts.
- **Task 5** (`lib.rs`): `updater_loop(app: AppHandle)` added, gated `#[cfg(not(debug_assertions))]` end-to-end (function, constant, and the spawn call in `.setup()`), mirroring `watch_loop`/`sync_loop`'s spawn shape exactly — `tauri::async_runtime::block_on` used only for the two async plugin calls, no `tokio` dependency added. `UPDATE_CHECK_INTERVAL = 6h`, flagged as a tunable default per the story. Verified the real `tauri-plugin-updater` 2.10.1 API (`UpdaterExt::updater()`, `Updater::check()`, `Update::download_and_install()`, `AppHandle::restart()`) against the resolved crate's own source — matched the story's sketch exactly, no deviation needed. Compiled successfully in both debug (`cargo build`) and release (`cargo build --release`, to actually exercise the `#[cfg(not(debug_assertions))]` branch) — release build surfaced one pre-existing, unrelated `unused variable: context` warning in `log_store_err` (present verbatim at this story's own baseline commit `2b531fa`, only visible in release profile since its usage is itself inside a `#[cfg(debug_assertions)]` block); not introduced by this story, out of scope to fix, and not caught by the mandated debug-profile `clippy -D warnings` gate.
- **Task 6** (automated coverage): all story-specified cases covered — see Tasks 1-5 above for the per-module breakdown (16 net new tests total). Two tests added directly in `watcher::mod` beyond what Task 2's own bullet asked for, to close the loop the story's Task 6 bullet actually requires ("asserts `report()` is called with the right context/agent_version/message on a terminal capture failure"): `a_terminal_serato4_capture_failure_records_and_reports`/`a_terminal_legacy_capture_failure_records_and_reports`, each driving a real terminal `build_serato4`/`build_legacy` error end-to-end through `capture_and_store_*` and asserting both the `parse_failures` row and the `RecordingReporter`'s captured call.
- **Task 7** (verification): full four-command cargo gate green — **325 unit tests** (up from the 309 baseline at `2b531fa`, +16 net new) + 9 golden/integration tests; `fmt --check`/`clippy -D warnings` clean. Repo-root `pnpm lint`/`typecheck`/`test` green and confirmed unaffected (`web` 23/23, `shared` 20/20, cache hits — no `web/`/`shared/`/`supabase/` file touched, confirmed via `git status` rather than assumed). No `supabase test db` run — no schema/RPC/wire-format change. The AD-3 cloud-sync-payload gap and the pre-existing hot-retry-storm-on-terminal-failure behavior (both flagged in Dev Notes as explicitly out of scope) logged to `deferred-work.md` per Arjun's pre-implementation ruling.
- **Post-review-handoff, same session**: Arjun provisioned a real Sentry project and pasted its onboarding snippet. Sentry's own docs snippet (`ClientOptions { release: ..., send_default_pii: true, ..Default::default() }`) does **not** compile against the pinned `sentry` 0.49.0 (`ClientOptions` is `#[non_exhaustive]`; confirmed by the E0639 already hit during Task 1) — the builder form already implemented (`ClientOptions::new().release(...)`) is correct and unchanged. `send_default_pii` deliberately left at its default `false` per Arjun's ruling (consistent with this project's existing local-only/no-raw-PII posture). Real DSN added to `agent/src-tauri/.env.local` (gitignored, not committed) and as a `SENTRY_DSN` GitHub Actions repo secret (`gh secret set`), then wired into both `release-macos.yml`/`release-windows.yml`'s `tauri-action` `env:` block alongside the existing signing secrets, matching Dev Notes' explicit instruction. Both workflow YAML files re-validated well-formed via the repo's vendored `js-yaml`. **Fixed a real test fragility this surfaced**: `error_reporting.rs`'s two DSN-sensitive tests originally hard-asserted `config::SENTRY_DSN.is_empty()`, which broke the moment a real DSN landed in `.env.local` (baked in at every `cargo test` rebuild) — rewritten so `sentry_reporter_report_never_panics` no longer depends on the DSN's actual value (safe either way: no live Sentry client is ever initialized during `cargo test`, only from `lib.rs::run()`) and `init_returns_none_when_dsn_is_empty` only exercises its assertion when the build's DSN is actually empty, rather than ever calling `init()` for real inside a test binary. Re-ran the full four-command gate with the real DSN present locally — still 325/325 green. **Live end-to-end verification**: built a throwaway, uncommitted `examples/sentry_live_check.rs` (mirrors this crate's own "throwaway, uncommitted example" precedent from Story 2.8) exercising the real production path (`error_reporting::init()` + `SentryReporter::report()`) with a uniquely-tagged message; ran it via `cargo run --example`, confirmed no errors, deleted the file afterward. **Not independently confirmed**: whether the event actually landed in Sentry's dashboard — no API/dashboard access from this session; Arjun should check for the pid-tagged marker message logged to stdout by the live-check run.
- Manual verification (real bundled `.app`, a forced parse failure) is still Arjun's — exact steps already written into this story's own Dev Notes "Manual verification hand-off" section; not attempted here.

### File List

- `agent/src-tauri/src/config.rs` — `AGENT_VERSION`, `SENTRY_DSN` constants; 1 new test.
- `agent/src-tauri/build.rs` — `SENTRY_DSN` added to the env-passthrough list.
- `agent/src-tauri/Cargo.toml` / `Cargo.lock` — new `sentry` dependency.
- `agent/src-tauri/src/error_reporting.rs` — **NEW**: `ErrorReporter` trait, `SentryReporter`, `init()`; 3 tests.
- `agent/src-tauri/src/backfill.rs` — **NEW**: `reprocess_parse_failures`; 4 tests.
- `agent/src-tauri/src/store.rs` — `parse_failures` table (additive), `ParseFailureRow`, `record_parse_failure`/`unresolved_parse_failures`/`has_unresolved_parse_failures`/`clear_parse_failure`; 4 new tests.
- `agent/src-tauri/src/watcher/mod.rs` — `capture_and_store_serato4`/`_legacy` gain an `ErrorReporter` param + `record_parse_failure` call on terminal failure, bumped to `pub(crate)`; all call sites (3 production, 8 existing tests) updated; new `NoopReporter`/`RecordingReporter` test fakes; 2 new tests.
- `agent/src-tauri/src/tray.rs` — sixth `TrayState::FormatDriftPaused` variant + tooltip/icon/`ALL`; existing tests extended for the sixth state.
- `agent/src-tauri/src/sync_queue.rs` — `desired_tray_state` gains `has_format_drift` param; `handle_pass_outcome` gains a `conn` param; both call sites updated; 2 new tests.
- `agent/src-tauri/src/lib.rs` — `error_reporting::init()` call in `run()`; startup backfill-sweep spawn; `updater_loop` + `UPDATE_CHECK_INTERVAL` (release builds only) + its spawn; module declarations for `error_reporting`/`backfill`.
- `agent/src-tauri/.env.local` — **not committed (gitignored)**: real `SENTRY_DSN` added for local dev.
- `.github/workflows/release-macos.yml`, `.github/workflows/release-windows.yml` — `SENTRY_DSN: ${{ secrets.SENTRY_DSN }}` added to the `tauri-action` step's `env:` block, alongside the existing signing secrets.
- `agent/src-tauri/icons/tray/light/format-drift-paused.png`, `agent/src-tauri/icons/tray/dark/format-drift-paused.png` — **NEW**: placeholder assets (flagged to Arjun).
- `_bmad-output/implementation-artifacts/deferred-work.md` — new "Surfaced by: 3-4-format-drift-resilience-backfill dev-story session" section (AD-3 sync-payload gap, pre-existing hot-retry-storm behavior).

### Change Log

- 2026-08-01 — Story 3.4 implemented: `agent_version`-tagged Sentry error reporting, a local `parse_failures` ledger wired into terminal capture failures, a startup backfill/reprocess sweep, a sixth `TrayState::FormatDriftPaused` tray state with tray-precedence wiring, and the previously-dormant auto-updater check/download/install loop — all three format-drift defense layers (AR-7) now present. All 7 tasks complete, full local gate green (325/325 unit tests, up from 309), repo-root `pnpm lint`/`typecheck`/`test` green and unaffected. AD-3 sync-payload gap and pre-existing hot-retry-storm behavior logged to `deferred-work.md` per Arjun's ruling. Manual verification hand-off written for Arjun; not yet run.
