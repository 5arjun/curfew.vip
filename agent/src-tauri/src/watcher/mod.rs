//! The `watcher` pipeline stage (Story 2.6): finds the DJ's Serato install, gates
//! it behind a one-time confirm (never silent, UX-DR20), and — once confirmed —
//! watches it for new sessions and for the configured volume disconnecting/
//! reconnecting. See [`crate`](../lib.rs) for the pipeline this stage starts:
//! `watcher -> parser -> joiner -> stat-engine -> local store -> sync-queue`.
//!
//! **Scope boundary.** This stage answers "where do plays come from, and is that
//! source still reachable" — it does not parse plays, run the stat engine, or
//! write to local SQLite (Story 2.8's job, which explicitly consumes this stage's
//! source selection). "New session detected" here is not "session complete"
//! (Story 2.8 AC-4 owns that signal).
//!
//! [`detect`] is the pure, filesystem-only classification layer (Tasks 1-2); this
//! module is the orchestration around it — settings precedence (Task 3), the
//! first-run confirm command (Task 4), and the live watch loop (Tasks 5-6).

pub mod detect;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use rusqlite::Connection;
use tauri::{AppHandle, Manager};

pub use detect::SeratoInstall;

use crate::settings::AgentSettings;

/// How often the watch loop re-checks whether the configured volume is still
/// present (Task 5). Chosen over event-driven volume-mount notifications because
/// `notify` does not reliably emit mount/unmount events cross-platform (per this
/// story's own Task 5 note) — a poll is the simpler, more portable mechanism, and
/// 5 seconds is frequent enough that a DJ plugging a drive back in mid-setup does
/// not perceive a stall, without hammering `sysinfo::Disks` continuously.
const RECONNECT_POLL_INTERVAL: Duration = Duration::from_secs(5);

/// What startup should do about Serato detection, computed once when the agent
/// launches. `String` paths throughout (not [`SeratoInstall`]): a saved override
/// is a plain path the DJ (or a prior detection) confirmed, and re-classifying it
/// happens continuously anyway once watching starts (Task 5's reconnect loop) —
/// carrying a stale [`SeratoInstall`] here would just be a second source of truth.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StartupResolution {
    /// An override is already saved (Task 3: the single source of truth) — begin
    /// watching immediately, no confirm prompt (the first-run gate already
    /// passed). Carries the raw path even if it does not currently resolve (e.g.
    /// its volume is unplugged at launch) — Task 5's reconnect loop is what
    /// recovers that case, not a silent fallback to auto-detection here.
    Confirmed(String),
    /// No override saved yet, but auto-detection found something — awaiting the
    /// DJ's confirm/edit via the settings panel (AC-3, UX-DR20).
    PendingConfirmation(String),
    /// No override, and nothing auto-detected — the DJ must set a manual path via
    /// the tray settings (AC-2).
    NothingFound,
}

/// Renders a [`SeratoInstall`] to the path string that flows through settings and
/// the confirm UI — the `_Serato_` folder for legacy, the `master.sqlite` file for
/// Serato 4+.
fn install_path(install: &SeratoInstall) -> String {
    match install {
        SeratoInstall::Legacy(path) => path.to_string_lossy().into_owned(),
        SeratoInstall::Serato4 { db_path } => db_path.to_string_lossy().into_owned(),
    }
}

/// Decides what startup should do, given already-loaded settings (Task 3): an
/// existing override always wins and skips detection entirely — this is a pure
/// function of `settings` so it is testable without a running Tauri app.
pub fn resolve_startup(
    settings: &AgentSettings,
    home: &Path,
    disks: &dyn detect::DiskSource,
) -> StartupResolution {
    if let Some(path) = &settings.serato_path_override {
        return StartupResolution::Confirmed(path.clone());
    }
    match detect::detect(home, disks) {
        Some(install) => StartupResolution::PendingConfirmation(install_path(&install)),
        None => StartupResolution::NothingFound,
    }
}

/// Shared state backing [`get_pending_detected_path`]: the path (if any) that
/// auto-detection found at startup, awaiting the DJ's confirm/edit + Save.
pub struct PendingDetectionState(pub Mutex<Option<String>>);

/// A pending detection is only ever shown before an override exists — once the DJ
/// saves one (via `set_serato_path_override`, Task 3/4's confirm action), it must
/// stop appearing even though the cached value is still sitting in
/// [`PendingDetectionState`], or a second launch's leftover cache could
/// incorrectly re-open the confirm panel. Split out as its own pure function
/// (Task 7 requires unit coverage for this exact gating behavior) rather than
/// inlined in the command, which needs a live `AppHandle` to test.
fn pending_after_override_check(override_present: bool, cached: Option<String>) -> Option<String> {
    if override_present {
        None
    } else {
        cached
    }
}

/// Returns the pending auto-detected path, if the DJ has not yet confirmed one via
/// Save (AC-3). Called once by the frontend on load, alongside the existing
/// `get_serato_path_override` call (Story 2.5).
#[tauri::command]
pub fn get_pending_detected_path(
    app: AppHandle,
    state: tauri::State<PendingDetectionState>,
) -> Result<Option<String>, String> {
    let settings = crate::settings::load(&app).map_err(|e| e.to_string())?;
    let cached = state
        .0
        .lock()
        .expect("pending detection mutex poisoned")
        .clone();
    Ok(pending_after_override_check(
        settings.serato_path_override.is_some(),
        cached,
    ))
}

/// Starts the background watch loop (Task 5/6): reconnect polling plus live
/// session-log watching. Started unconditionally at app launch, regardless of
/// [`StartupResolution`] — it tracks the *live* override on disk on every poll
/// tick (see [`watch_loop`]'s doc comment for why), so it picks up a path saved
/// via the confirm UI mid-session, not only one that already existed at boot.
/// Runs for the lifetime of the agent process — this tray-only app has no
/// graceful-shutdown path for any background component yet (mirrors the rest of
/// this crate).
pub fn start_watching(app: AppHandle) {
    std::thread::spawn(move || watch_loop(app));
}

/// Resolves the DJ's home directory, with the same non-fatal fallback used
/// everywhere in this crate a missing home dir must not take down the whole
/// tray-only agent: a path that deliberately resolves nothing, so OS-default
/// detection (and, since Story 3.3b, the unconditional internal-Serato4
/// probe in [`detect::resolve_watch_plan`]) just degrades to finding
/// nothing rather than panicking or aborting `.setup()`. Shared by `lib.rs`'s
/// `.setup()` and [`watch_loop`] so the fallback logic exists in one place.
pub fn resolve_home(app: &AppHandle) -> PathBuf {
    app.path().home_dir().unwrap_or_else(|_| {
        #[cfg(debug_assertions)]
        eprintln!(
            "curfew-agent: could not resolve home directory, Serato OS-default \
             auto-detection will find nothing (manual override via tray still works)"
        );
        PathBuf::from("/curfew-agent-home-dir-unresolved")
    })
}

/// AC-5's combined drive-reachability signal: **connected iff any configured
/// history source currently resolves** — decided by Arjun 2026-08-01 (see the
/// story's Dev Notes, "Drive-connected semantics"). A [`WatchPlan`] slot being
/// `Some` already means "resolves right now" ([`detect::resolve_watch_plan`]
/// only fills a slot when the underlying file/folder actually stats), so this
/// is a direct, pure projection with no extra state to track — extracted so
/// it is unit-testable without a running watch loop.
fn drive_connected(plan: &detect::WatchPlan) -> bool {
    plan.serato4.is_some() || plan.legacy.is_some()
}

/// Per-source watch state for the Serato 4+ slot (Story 3.3b). `source.db_path`
/// is this slot's identity — the value [`advance_serato4`] diffs against a
/// freshly resolved [`detect::Serato4Source`] to tell a genuine path change
/// (reset) apart from a mere reconnect of the same file (announce only).
struct Serato4Watch {
    source: detect::Serato4Source,
    // `None` = not yet evaluated against the current `source` (true both at
    // first sight and right after an identity change) — distinct from
    // `Some(false)` (evaluated and found disconnected), so the very first
    // classification for a source always announces instead of only a
    // transition edge (mirrors the old single-source `connected` local).
    connected: Option<bool>,
    watermark: i64,
    _fs_watcher: Option<RecommendedWatcher>,
}

/// Per-source watch state for the legacy slot (Story 3.3b). Mirrors
/// [`Serato4Watch`]; `source.serato_dir` is this slot's identity.
struct LegacyWatch {
    source: detect::LegacySource,
    connected: Option<bool>,
    _fs_watcher: Option<RecommendedWatcher>,
}

/// Advances the Serato4 slot for one loop tick (Story 3.3b, Task 2): detects
/// a genuine identity change (the resolved `db_path` itself differs from what
/// was last tracked — reset, scoped to just this slot, mirroring the old
/// single-source "override changed" branch) versus a mere connect/disconnect
/// of the *same* identity (announce the transition only; the watermark and
/// pending trackers are deliberately left untouched so a reconnect resumes
/// rather than re-backfilling — see the story's Dev Notes, "Watermark reset
/// is a 490-row event"). The completion re-check runs every tick this slot is
/// configured, including the very tick it first connects — mirrors the old
/// loop's unconditional every-iteration recheck.
fn advance_serato4(
    new_source: Option<&detect::Serato4Source>,
    state: &mut Option<Serato4Watch>,
    tx: &mpsc::Sender<notify::Result<notify::Event>>,
    store_conn: Option<&Connection>,
    pending: &mut HashSet<i64>,
    dates: &crate::joiner::date_added::DateAddedIndex,
) {
    if let (Some(new_source), Some(existing)) = (new_source, state.as_ref()) {
        if existing.source.db_path != new_source.db_path {
            if let Some(conn) = store_conn {
                for id in pending.iter() {
                    log_store_err(
                        "mark_incomplete on serato4 path change",
                        crate::store::mark_incomplete(
                            conn,
                            &crate::capture::serato4_session_identity(*id),
                        ),
                    );
                }
            }
            pending.clear();
            *state = None;
        }
    }

    match new_source {
        Some(new_source) => {
            let watch_state = state.get_or_insert_with(|| Serato4Watch {
                source: new_source.clone(),
                connected: None,
                watermark: 0,
                _fs_watcher: None,
            });
            watch_state.source = new_source.clone();
            if watch_state.connected != Some(true) {
                connect_serato4(watch_state, tx, store_conn, pending, dates);
            }
            if let Some(conn) = store_conn {
                recheck_pending_serato4(
                    conn,
                    &watch_state.source.root,
                    &watch_state.source.db_path,
                    pending,
                    dates,
                );
            }
        }
        None => {
            if let Some(existing) = state.as_mut() {
                if existing.connected != Some(false) {
                    disconnect_serato4(existing, pending, store_conn);
                }
            }
        }
    }
}

fn connect_serato4(
    state: &mut Serato4Watch,
    tx: &mpsc::Sender<notify::Result<notify::Event>>,
    store_conn: Option<&Connection>,
    pending: &mut HashSet<i64>,
    dates: &crate::joiner::date_added::DateAddedIndex,
) {
    state.connected = Some(true);
    state._fs_watcher = start_fs_watch(&state.source.db_path, tx.clone());
    // Startup/reconnect catch-up: discovers every session up to the (per-
    // source, preserved-across-reconnect) watermark, exactly as before.
    check_for_new_sessions(
        &state.source.root,
        &state.source.db_path,
        &mut state.watermark,
        store_conn,
        pending,
        dates,
    );
    if let Some(conn) = store_conn {
        // Story 2.8 AC-4 resume: a session marked `incomplete` on a prior
        // disconnect goes back to `watching` the moment this source is
        // reachable again.
        reregister_pending_serato4_as_watching(conn, &state.source.db_path, pending);
    }
}

fn disconnect_serato4(
    state: &mut Serato4Watch,
    pending: &HashSet<i64>,
    store_conn: Option<&Connection>,
) {
    state.connected = Some(false);
    state._fs_watcher = None;
    // Story 2.8 AC-4: a session still `watching` when its source disconnects
    // is neither silently dropped nor left ambiguously `watching` forever —
    // flag it `incomplete`. Still tracked in-memory (not cleared here) so a
    // reconnect can resume it.
    if let Some(conn) = store_conn {
        for id in pending {
            log_store_err(
                "mark_incomplete on disconnect",
                crate::store::mark_incomplete(conn, &crate::capture::serato4_session_identity(*id)),
            );
        }
    }
}

/// Legacy-slot equivalent of [`advance_serato4`].
fn advance_legacy(
    new_source: Option<&detect::LegacySource>,
    state: &mut Option<LegacyWatch>,
    tx: &mpsc::Sender<notify::Result<notify::Event>>,
    store_conn: Option<&Connection>,
    pending: &mut HashMap<PathBuf, LegacyPendingSession>,
    dates: &crate::joiner::date_added::DateAddedIndex,
) {
    if let (Some(new_source), Some(existing)) = (new_source, state.as_ref()) {
        if existing.source.serato_dir != new_source.serato_dir {
            if let Some(conn) = store_conn {
                for entry in pending.values() {
                    log_store_err(
                        "mark_incomplete on legacy path change",
                        crate::store::mark_incomplete(conn, &entry.session_identity),
                    );
                }
            }
            pending.clear();
            *state = None;
        }
    }

    match new_source {
        Some(new_source) => {
            let watch_state = state.get_or_insert_with(|| LegacyWatch {
                source: new_source.clone(),
                connected: None,
                _fs_watcher: None,
            });
            watch_state.source = new_source.clone();
            if watch_state.connected != Some(true) {
                connect_legacy(watch_state, tx, store_conn, pending);
            }
            if let Some(conn) = store_conn {
                recheck_legacy_quiet_periods(
                    conn,
                    &watch_state.source.library_root,
                    pending,
                    dates,
                );
            }
        }
        None => {
            if let Some(existing) = state.as_mut() {
                if existing.connected != Some(false) {
                    disconnect_legacy(existing, pending, store_conn);
                }
            }
        }
    }
}

fn connect_legacy(
    state: &mut LegacyWatch,
    tx: &mpsc::Sender<notify::Result<notify::Event>>,
    store_conn: Option<&Connection>,
    pending: &mut HashMap<PathBuf, LegacyPendingSession>,
) {
    state.connected = Some(true);
    let watch_target = state.source.serato_dir.join("History").join("Sessions");
    state._fs_watcher = start_fs_watch(&watch_target, tx.clone());
    if let Some(conn) = store_conn {
        // Mirrors the Serato4 branch: the live `notify` watcher (started just
        // above) only sees `.session` files written *after* this point, so a
        // session that completed while the agent was closed would otherwise
        // never be discovered. This one-time scan on (re)connect closes that
        // gap — idempotent against files already seen/captured in a prior run
        // (`handle_legacy_session_event`'s in-memory `pending` check and the
        // store's `upsert_watching`, which refuses to regress a `captured`
        // row).
        scan_legacy_session_dir(conn, &watch_target, pending);
        reregister_pending_legacy_as_watching(conn, pending);
    }
}

fn disconnect_legacy(
    state: &mut LegacyWatch,
    pending: &HashMap<PathBuf, LegacyPendingSession>,
    store_conn: Option<&Connection>,
) {
    state.connected = Some(false);
    state._fs_watcher = None;
    if let Some(conn) = store_conn {
        for entry in pending.values() {
            log_store_err(
                "mark_incomplete on disconnect",
                crate::store::mark_incomplete(conn, &entry.session_identity),
            );
        }
    }
}

/// One connected/disconnected cycle plus live session discovery, looped
/// forever, for **both** history sources concurrently (Story 3.3b, AC-1) —
/// the direct fix for the incident where a saved override silently starved
/// out the Serato 4+ internal database from ever being watched at all.
///
/// **Re-reads `settings::load` every cycle rather than taking a fixed path.**
/// The confirm action (`set_serato_path_override`, Task 3/4) only ever writes to
/// disk — it has no reference to a possibly-already-running watch loop to signal,
/// and starting a second loop per Save would race two threads over the same tray
/// state. Polling the live override instead means Save doesn't need to know this
/// loop exists at all: whatever is on disk right now is what gets watched, and a
/// changed override (first Save, or editing an existing one) is picked up on the
/// next [`RECONNECT_POLL_INTERVAL`] tick, same as a reconnect. Each tick
/// re-resolves the full [`detect::WatchPlan`] via [`detect::resolve_watch_plan`]
/// (home is resolved once, up front — it cannot change during a run) and hands
/// each slot to [`advance_serato4`]/[`advance_legacy`], which own that source's
/// own connect/disconnect/path-change bookkeeping independently of the other.
///
/// **Story 2.8** extends this loop with set-capture bookkeeping: a session
/// seen but not yet complete is tracked in [`pending_serato4`]/
/// [`legacy_pending`] (both reloaded from `'watching'` rows on the local store
/// at loop start, so a restart does not lose track of an in-flight session,
/// Task 4) and re-checked for its completion signal every iteration while
/// connected — this loop already ticks at ~[`RECONNECT_POLL_INTERVAL`]
/// cadence via `recv_timeout`'s timeout below, so no new timer is introduced.
/// The store's [`Connection`] is opened once for the loop's lifetime (Task 6),
/// not per capture or per poll tick.
fn watch_loop(app: AppHandle) {
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();

    // Story 2.8 Task 6: opened once for the loop's lifetime. A failure to open
    // (e.g. `app_local_data_dir` unresolved) degrades this run to
    // detection/tray-only, mirroring this crate's home-dir-resolution
    // fallback in `lib.rs`'s `.setup()` — it must not take down the whole
    // tray-only agent.
    let store_conn = crate::store::open(&app).ok();
    if store_conn.is_none() {
        #[cfg(debug_assertions)]
        eprintln!(
            "curfew-agent: could not open local store; set capture is disabled this run \
             (detection/tray still work)"
        );
    }

    // Story 2.8 Task 4: durable-across-restart reload of every session this
    // agent has seen but not yet captured, from `'watching'` rows.
    let mut pending_serato4: HashSet<i64> = HashSet::new();
    let mut legacy_pending: HashMap<PathBuf, LegacyPendingSession> = HashMap::new();
    if let Some(conn) = &store_conn {
        if let Ok(rows) =
            crate::store::rows_with_status(conn, crate::store::SessionStatus::Watching)
        {
            for row in rows {
                match row.source {
                    crate::store::SessionSource::Serato4 => {
                        if let Some(id) = crate::capture::parse_serato4_raw_ref(&row.raw_ref) {
                            pending_serato4.insert(id);
                        }
                    }
                    crate::store::SessionSource::Legacy => {
                        let path = PathBuf::from(&row.raw_ref);
                        let last_modified = std::fs::metadata(&path)
                            .and_then(|m| m.modified())
                            .unwrap_or_else(|_| SystemTime::now());
                        legacy_pending.insert(
                            path,
                            LegacyPendingSession {
                                last_modified,
                                session_identity: row.session_identity,
                            },
                        );
                    }
                }
            }
        }
    }

    let home = resolve_home(&app);
    let mut serato4_state: Option<Serato4Watch> = None;
    let mut legacy_state: Option<LegacyWatch> = None;
    // `None` = not yet evaluated this run — distinct from `Some(false)`, so
    // the very first tick always announces even if nothing resolves.
    let mut overall_connected: Option<bool> = None;

    loop {
        let override_path = crate::settings::load(&app)
            .ok()
            .and_then(|s| s.serato_path_override);
        let plan =
            detect::resolve_watch_plan(override_path.as_deref(), &home, &detect::SystemDisks);

        // Story 3.7 (§3d): a fresh lazy date-added index per tick, so any
        // capture this tick performs sees the volumes mounted *right now* —
        // catalogue loading only happens on the rare tick that captures.
        let dates = crate::joiner::date_added::DateAddedIndex::live(&home);
        advance_serato4(
            plan.serato4.as_ref(),
            &mut serato4_state,
            &tx,
            store_conn.as_ref(),
            &mut pending_serato4,
            &dates,
        );
        advance_legacy(
            plan.legacy.as_ref(),
            &mut legacy_state,
            &tx,
            store_conn.as_ref(),
            &mut legacy_pending,
            &dates,
        );

        // AC-5: the combined drive-reachability signal, written through the
        // single-writer coordinator only on an actual transition.
        let now_connected = drive_connected(&plan);
        if overall_connected != Some(now_connected) {
            overall_connected = Some(now_connected);
            if let Some(coordinator) = app.try_state::<crate::tray::DriveTrayCoordinator>() {
                coordinator.set_drive_connected(&app, now_connected);
            }
        }

        match rx.recv_timeout(RECONNECT_POLL_INTERVAL) {
            Ok(Ok(event)) => {
                // Dispatch on the event's own path(s), not by re-classifying —
                // with two live sources sharing one channel, re-running
                // `classify` against a single `current_path` is ambiguous by
                // construction. A `.session` extension is unambiguously a
                // legacy event; anything else is assumed to be the serato4
                // source's `master.sqlite` (the only other file either
                // watcher targets). `notify` on a SQLite file in WAL mode can
                // fire more than once per logical write (temp-file churn) —
                // harmless here because `check_for_new_sessions` is
                // idempotent against `watermark`.
                let mut session_paths = event
                    .paths
                    .iter()
                    .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("session"));
                if let Some(first) = session_paths.next() {
                    if let Some(conn) = &store_conn {
                        handle_legacy_session_event(conn, first, &mut legacy_pending);
                        for path in session_paths {
                            handle_legacy_session_event(conn, path, &mut legacy_pending);
                        }
                    }
                } else if let Some(state) = &mut serato4_state {
                    check_for_new_sessions(
                        &state.source.root,
                        &state.source.db_path,
                        &mut state.watermark,
                        store_conn.as_ref(),
                        &mut pending_serato4,
                        &dates,
                    );
                }
            }
            Ok(Err(_)) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {} // reconnect poll tick
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }

        // Story 4.2 (D-3, AC-4/AC-5): go-forward library add-detection,
        // piggybacked on the library read a capture just paid for — never a
        // second watcher or a second query path.
        //
        // Sits at the very end of the iteration, after *both* capture routes
        // (the poll-driven `advance_*` calls above and the event-driven
        // `check_for_new_sessions` in the branch above): `dates` is rebuilt
        // fresh each tick, so a check placed earlier would miss every
        // event-driven capture and never see it on the next tick either.
        //
        // `is_loaded` is the whole cost control — on the overwhelming majority
        // of ticks nothing captured, no catalogue was read, and this is one
        // branch. Failures are debug-logged only: the diff is against durable
        // local state, so a missed scan simply re-runs at the next capture,
        // and nothing here may take down the watch loop.
        if dates.is_loaded() {
            if let Some(conn) = &store_conn {
                // Story 4.11 AC-6: `excluded_no_identity` no longer dies here
                // silently — recorded durably so a web-facing disclosure has
                // something real to read. Stored as a GAUGE (this scan's
                // numbers replace the last scan's), never a running total:
                // every scan recounts the whole catalogue, so summing would
                // grow without bound and describe nothing (Story 4.11 review).
                log_store_err(
                    "scan_library_adds",
                    crate::capture::scan_library_adds(conn, &dates, now_unix()).and_then(
                        |outcome| {
                            crate::store::set_scan_identity_coverage(
                                conn,
                                outcome.excluded_no_identity,
                                outcome.catalogue_rows,
                            )
                        },
                    ),
                );
            }
        }
    }
}

/// Agent wall-clock, unix epoch seconds — the `first_seen_locally_at` stamp
/// Story 4.2's library scan records. Mirrors `store.rs`'s own private
/// `now_unix` rather than widening that one's visibility for a single caller.
fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// A legacy `.session` file this agent has seen but not yet captured (Story
/// 2.8 Task 4): when it was last modified (the quiet-period clock) and the
/// dedup key already computed for it, so re-checking it never needs a second
/// parse just to recover its identity.
struct LegacyPendingSession {
    last_modified: SystemTime,
    session_identity: String,
}

/// Logs a local-store write failure in debug builds only, matching this
/// module's other write-failure logging (`capture_and_store_serato4`/
/// `_legacy`). Release builds have no UI surface to report to yet, and a
/// future poll tick or reconnect calling the same write again is the retry —
/// but a silently-discarded error is invisible even to a developer running a
/// debug build without this. `pub(crate)` (Story 3.4 review) so `backfill.rs`
/// can route its own store-write failures through the same convention
/// instead of discarding them via a bare `.ok()`.
#[cfg_attr(not(debug_assertions), allow(unused_variables))]
pub(crate) fn log_store_err(context: &str, result: Result<(), crate::store::StoreError>) {
    if let Err(_e) = result {
        #[cfg(debug_assertions)]
        eprintln!("curfew-agent: local store write failed ({context}): {_e}");
    }
}

/// Story 2.8 AC-4 resume, serato4 half: re-marks every currently-tracked
/// pending session `'watching'` (from whatever it was, including
/// `'incomplete'`) now that this source is reachable again. A no-op for a
/// session already `'captured'` — [`crate::store::upsert_watching`]'s own
/// `WHERE` clause refuses to regress that terminal state.
fn reregister_pending_serato4_as_watching(
    conn: &Connection,
    db_path: &Path,
    pending: &HashSet<i64>,
) {
    for id in pending {
        log_store_err(
            "upsert_watching on reconnect",
            crate::store::upsert_watching(
                conn,
                &crate::capture::serato4_session_identity(*id),
                crate::store::SessionSource::Serato4,
                &crate::capture::serato4_raw_ref(db_path, *id),
                None,
            ),
        );
    }
}

/// Legacy half of [`reregister_pending_serato4_as_watching`].
fn reregister_pending_legacy_as_watching(
    conn: &Connection,
    pending: &HashMap<PathBuf, LegacyPendingSession>,
) {
    for (path, entry) in pending {
        log_store_err(
            "upsert_watching on reconnect",
            crate::store::upsert_watching(
                conn,
                &entry.session_identity,
                crate::store::SessionSource::Legacy,
                &path.to_string_lossy(),
                None,
            ),
        );
    }
}

/// Story 2.8 Task 4/6: re-queries `history_session` for just the still-pending
/// ids, capturing (and dropping from `pending`) whichever have resolved their
/// `end_time` (AC-4).
fn recheck_pending_serato4(
    store_conn: &Connection,
    root: &Path,
    db_path: &Path,
    pending: &mut HashSet<i64>,
    dates: &crate::joiner::date_added::DateAddedIndex,
) {
    let Ok(query_conn) = crate::joiner::serato4::open_read_only(root, db_path) else {
        return;
    };

    let resolved: Vec<i64> = pending
        .iter()
        .copied()
        .filter(|id| {
            matches!(
                crate::parser::session_by_id(&query_conn, *id),
                Ok(Some(session)) if crate::capture::serato4_end_time_resolved(session.end_time)
            )
        })
        .collect();

    for id in resolved {
        if capture_and_store_serato4(
            store_conn,
            root,
            db_path,
            id,
            dates,
            &crate::error_reporting::SentryReporter,
        ) {
            pending.remove(&id);
        }
    }
}

/// Runs the Serato4 capture pipeline for one now-complete session and persists
/// it. Returns `true` for a terminal outcome — captured, or nothing to
/// capture ([`crate::capture::CaptureError::EmptySession`] and
/// [`crate::capture::CaptureError::AllPreviews`], both expected rather than
/// exceptional; see those variants' own doc comments) — meaning the caller
/// should stop tracking this session. Returns `false` for a transient failure
/// (parse/join/correlation/SQLite error, or a failed store write), logged in
/// debug builds: the caller keeps the session pending so the next poll tick
/// retries it, rather than silently losing it for the rest of this run.
///
/// `reporter` is `pub(crate)` DI (Story 3.4, Task 2) — production call sites
/// always pass `&error_reporting::SentryReporter` as a literal; tests pass a
/// fake so they never depend on `config::SENTRY_DSN`'s build-time value.
/// Bumped to `pub(crate)` visibility: `backfill::reprocess_parse_failures`
/// (Task 3) calls this directly from its own module.
pub(crate) fn capture_and_store_serato4(
    store_conn: &Connection,
    root: &Path,
    db_path: &Path,
    session_id: i64,
    dates: &crate::joiner::date_added::DateAddedIndex,
    reporter: &dyn crate::error_reporting::ErrorReporter,
) -> bool {
    let identity = crate::capture::serato4_session_identity(session_id);
    let raw_ref = crate::capture::serato4_raw_ref(db_path, session_id);
    // Story 5.2: this session's detection floors come from the DJ's own earlier
    // sessions (D-23), so the pool is loaded here — at the store edge — and
    // handed to the pure builder. One load per capture is the right cost at this
    // call site (a capture is a once-per-set event); the ~491-row backfill sweep
    // loads it once for the whole pass instead, see `backfill_captured_serato4`.
    let pool = crate::capture::load_calibration_pool(store_conn);
    // Story 7.7: the DJ's zone right now, read at this same effectful edge for
    // the same reason the pool is — the builder below stays pure. This is a
    // fresh capture, so "now" is the correct answer: the DJ is at the gig.
    let timezone = crate::capture::local_timezone();
    match crate::capture::build_serato4(
        root,
        db_path,
        session_id,
        dates,
        &pool,
        timezone.as_deref(),
    ) {
        Ok((plays, derived)) => {
            let (started_at, ended_at) = crate::capture::session_bounds(&plays);
            if let Err(_e) = crate::store::upsert_captured(
                store_conn,
                &identity,
                crate::store::SessionSource::Serato4,
                &raw_ref,
                started_at,
                ended_at,
                &plays,
                &derived,
            ) {
                #[cfg(debug_assertions)]
                eprintln!(
                    "curfew-agent: local store write failed for serato4 session {session_id}: {_e}"
                );
                return false;
            }
            // Story 3.3b AC-2, reverse direction: a legacy capture that beat
            // this serato4 capture to the store (legacy's quiet-period
            // completion can, rarely, resolve before serato4's `end_time`
            // does) is superseded now rather than double-counting the night.
            // Fail-open: unknown bounds, or a query error, leave every
            // candidate row untouched rather than risk a wrong supersede.
            if let (Some(started_at), Some(ended_at)) = (started_at, ended_at) {
                if let Ok(overlap) = crate::store::overlapping_captured(
                    store_conn,
                    crate::store::SessionSource::Legacy,
                    started_at,
                    ended_at,
                ) {
                    for row in overlap {
                        // A legacy row that has *already synced* is left
                        // alone — there is no retraction path in the sync
                        // contract (AD-5), and inventing one is out of
                        // scope for this story. Logged so the gap stays
                        // visible rather than silently accepted.
                        if row.synced_at.is_some() {
                            #[cfg(debug_assertions)]
                            eprintln!(
                                "curfew-agent: legacy session {} already synced, leaving it \
                                 uncontested by serato4 session {session_id} (no retraction path)",
                                row.session_identity
                            );
                            continue;
                        }
                        log_store_err(
                            "mark_superseded (serato4 wins, reverse arrival order)",
                            crate::store::mark_superseded(store_conn, &row.session_identity),
                        );
                    }
                }
            }
            true
        }
        Err(
            crate::capture::CaptureError::EmptySession | crate::capture::CaptureError::AllPreviews,
        ) => {
            // Nothing decoded for a session id `history_session` itself just
            // reported — leave the existing `watching` row as-is rather than
            // fabricate an identity for nothing (Task 4); it simply never
            // resolves to `captured`.
            //
            // `AllPreviews` joins it here (fixed 2026-08-17): a session where
            // every row was a loaded-but-never-played preview is the same
            // "nothing to capture" outcome, not a failure. It used to fall
            // through to the `Err(e)` arm below and be written to
            // `parse_failures`, which is a *permanent* wrong state: re-parsing
            // an all-previews session always returns `AllPreviews` again, so
            // `reprocess_parse_failures` can never clear the row, the tray
            // reads "Format drift detected" forever, and Sentry is fed a
            // non-error on every startup. Arjun hit exactly this on the first
            // real install — 6 rows, one DJ, day one.
            true
        }
        Err(e) => {
            #[cfg(debug_assertions)]
            eprintln!("curfew-agent: serato4 capture failed for session {session_id}: {e}");
            log_store_err(
                "record_parse_failure (serato4)",
                crate::store::record_parse_failure(
                    store_conn,
                    &identity,
                    crate::store::SessionSource::Serato4,
                    &raw_ref,
                    crate::config::AGENT_VERSION,
                    &e.to_string(),
                ),
            );
            reporter.report(
                "serato4 capture",
                crate::config::AGENT_VERSION,
                &e.to_string(),
            );
            false
        }
    }
}

/// Story 2.8 Task 4/6: registers (on first sight) or refreshes the quiet-
/// period clock for (on a repeat event) one legacy `.session` file event.
///
/// A first-ever event whose file does not yet decode to at least one play
/// (e.g. the very first bytes of a new session, still mid-write) is left
/// unregistered — the next modify event tries again; there is no session to
/// identify or capture yet (Task 4: "there is no session to capture at all").
fn handle_legacy_session_event(
    store_conn: &Connection,
    session_path: &Path,
    pending: &mut HashMap<PathBuf, LegacyPendingSession>,
) {
    let now = SystemTime::now();

    if let Some(entry) = pending.get_mut(session_path) {
        entry.last_modified = now;
        return;
    }

    let Ok(outcome) = crate::parser::parse_session_file_partial(session_path) else {
        return;
    };
    let Some(first_play) = outcome.plays.first() else {
        return;
    };

    let identity = crate::capture::legacy_session_identity(first_play);
    let raw_ref = session_path.to_string_lossy().into_owned();
    let started_at = first_play.start_time.map(i64::from);
    log_store_err(
        "upsert_watching on first sight",
        crate::store::upsert_watching(
            store_conn,
            &identity,
            crate::store::SessionSource::Legacy,
            &raw_ref,
            started_at,
        ),
    );

    pending.insert(
        session_path.to_path_buf(),
        LegacyPendingSession {
            last_modified: now,
            session_identity: identity,
        },
    );
}

/// Startup/reconnect catch-up for a legacy install (see call site in
/// `watch_loop`): lists every `.session` file already sitting in
/// `sessions_dir` and hands each to [`handle_legacy_session_event`] as if it
/// had just fired a live filesystem event. A file whose quiet period has
/// already elapsed (the common case — it finished days ago) is picked up and
/// captured on the very next `recheck_legacy_quiet_periods` tick, no
/// different from a session that went quiet while the agent was watching
/// live. A missing/unreadable directory is a no-op, not an error — Serato
/// hasn't necessarily ever written to it yet.
fn scan_legacy_session_dir(
    store_conn: &Connection,
    sessions_dir: &Path,
    pending: &mut HashMap<PathBuf, LegacyPendingSession>,
) {
    let Ok(entries) = std::fs::read_dir(sessions_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("session") {
            handle_legacy_session_event(store_conn, &path, pending);
        }
    }
}

/// Story 2.8 Task 4/6: checks every tracked legacy session's quiet-period
/// clock, capturing (and dropping from `pending`) whichever have gone
/// [`crate::capture::LEGACY_QUIET_PERIOD_SEC`] without a modify event (AC-4).
fn recheck_legacy_quiet_periods(
    store_conn: &Connection,
    library_root: &Path,
    pending: &mut HashMap<PathBuf, LegacyPendingSession>,
    dates: &crate::joiner::date_added::DateAddedIndex,
) {
    let now = SystemTime::now();
    let elapsed: Vec<PathBuf> = pending
        .iter()
        .filter(|(_, entry)| crate::capture::legacy_quiet_period_elapsed(entry.last_modified, now))
        .map(|(path, _)| path.clone())
        .collect();

    for session_path in elapsed {
        let Some(session_identity) = pending
            .get(&session_path)
            .map(|entry| entry.session_identity.clone())
        else {
            continue;
        };
        if capture_and_store_legacy(
            store_conn,
            library_root,
            &session_path,
            &session_identity,
            &crate::error_reporting::SentryReporter,
        ) {
            // Story 4.2 (D-3): the legacy capture path reads `database V2`
            // through its own `LegacyLibrary`, not through `dates`, so without
            // this the add-scan below would never fire for a legacy-only DJ.
            // Forces the same catalogue read the serato4 path already pays for
            // at capture time — never on a tick that captured nothing.
            dates.ensure_loaded();
            pending.remove(&session_path);
        }
    }
}

/// Runs the legacy capture pipeline for one now-quiet session and persists it.
/// Mirrors [`capture_and_store_serato4`]'s error handling, terminal-outcome
/// `bool` return, and `reporter` DI (Story 3.4, Task 2) — see that function's
/// doc comment for both.
pub(crate) fn capture_and_store_legacy(
    store_conn: &Connection,
    library_root: &Path,
    session_path: &Path,
    session_identity: &str,
    reporter: &dyn crate::error_reporting::ErrorReporter,
) -> bool {
    let raw_ref = session_path.to_string_lossy().into_owned();
    // Story 5.2 (D-23) — same per-capture pool load as the serato4 sibling.
    let pool = crate::capture::load_calibration_pool(store_conn);
    // Story 7.7 — same edge read as the serato4 sibling above.
    let timezone = crate::capture::local_timezone();
    match crate::capture::build_legacy(library_root, session_path, &pool, timezone.as_deref()) {
        Ok((plays, derived)) => {
            let (started_at, ended_at) = crate::capture::session_bounds(&plays);
            if let Err(_e) = crate::store::upsert_captured(
                store_conn,
                session_identity,
                crate::store::SessionSource::Legacy,
                &raw_ref,
                started_at,
                ended_at,
                &plays,
                &derived,
            ) {
                #[cfg(debug_assertions)]
                eprintln!(
                    "curfew-agent: local store write failed for legacy session {}: {_e}",
                    session_path.display()
                );
                return false;
            }
            // Story 3.3b AC-2, forward direction (the common case — serato4's
            // `end_time` resolves at set end, legacy needs a 15-minute quiet
            // period, so serato4 almost always lands first): a night already
            // captured by the higher-precedence serato4 source is superseded
            // here rather than reaching the sync queue as a duplicate. The
            // row stays in the local store (content intact) for debugging —
            // never deleted. Fail-open: unknown bounds, or a query error,
            // leave this row `captured`.
            if let (Some(started_at), Some(ended_at)) = (started_at, ended_at) {
                if let Ok(overlap) = crate::store::overlapping_captured(
                    store_conn,
                    crate::store::SessionSource::Serato4,
                    started_at,
                    ended_at,
                ) {
                    if !overlap.is_empty() {
                        log_store_err(
                            "mark_superseded (serato4 wins)",
                            crate::store::mark_superseded(store_conn, session_identity),
                        );
                    }
                }
            }
            true
        }
        Err(
            crate::capture::CaptureError::EmptySession | crate::capture::CaptureError::AllPreviews,
        ) => {
            // The file went quiet with nothing decodable — leave the
            // `watching` row as-is (Task 4), same reasoning as the Serato4
            // sibling above.
            //
            // `AllPreviews` is unreachable from `build_legacy` today: the
            // `played` filter it comes from is Serato4-only (`history_entry`
            // carries the flag; the legacy `.session` format has no
            // equivalent). It is matched here anyway so the two arms make the
            // *same* classification — the day legacy learns to recognize a
            // preview, it inherits "skip quietly" rather than silently
            // regressing into the `parse_failures` path this fix exists to
            // close.
            true
        }
        Err(e) => {
            #[cfg(debug_assertions)]
            eprintln!(
                "curfew-agent: legacy capture failed for {}: {e}",
                session_path.display()
            );
            log_store_err(
                "record_parse_failure (legacy)",
                crate::store::record_parse_failure(
                    store_conn,
                    session_identity,
                    crate::store::SessionSource::Legacy,
                    &raw_ref,
                    crate::config::AGENT_VERSION,
                    &e.to_string(),
                ),
            );
            reporter.report(
                "legacy capture",
                crate::config::AGENT_VERSION,
                &e.to_string(),
            );
            false
        }
    }
}

/// Stands up a live filesystem watcher for one source's watch target: the
/// legacy `History/Sessions` folder (new/modified `.session` files), or the
/// Serato 4+ `master.sqlite` file itself (changes on every play). Returns
/// `None` if the watcher fails to start (e.g. the path just vanished between
/// resolution and this call) — the outer loop's next reconnect poll will retry.
fn start_fs_watch(
    watch_target: &Path,
    tx: mpsc::Sender<notify::Result<notify::Event>>,
) -> Option<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .ok()?;
    watcher
        .watch(watch_target, RecursiveMode::NonRecursive)
        .ok()?;
    Some(watcher)
}

/// Queries for sessions past `watermark`, advances it to the highest `id` seen,
/// and hands each newly-discovered session to [`log_new_session`] — this story's
/// entire responsibility for a "new session" event (Story 2.8 owns capture).
///
/// `root` is the DJ's confirmed configured path (Story 2.7, AC-1) — the same
/// value `db_path` was classified from — passed through to
/// `joiner::serato4::open_read_only` so it can refuse to open a `db_path` that
/// resolves outside it.
///
/// Story 2.8 Task 6: also registers each newly-discovered session with the
/// local store as `'watching'` (Task 4) — or, if it happens to already be
/// complete by the time it's discovered (e.g. a brief practice loop whose
/// `end_time` resolved before this agent ever polled), captures it
/// immediately rather than waiting for the next pending re-check tick.
/// `store_conn`/`pending` are `None`/unused when the local store could not be
/// opened this run (detection still works; capture bookkeeping is skipped).
/// The go-forward baseline for this Serato4 library (Decision A, fixed
/// 2026-08-17): the stored watermark if this store has one, otherwise the
/// library's current `max(history_session.id)`, persisted on the spot.
/// `None` means unresolved — a store read failed, or the library's own max id
/// could not be read — and every caller treats that as "do nothing this pass"
/// rather than falling back to a value that would sweep the DJ's history.
///
/// **Why this exists.** `WatchState`'s watermark starts at 0, and
/// `list_sessions_after(conn, 0)` means "every session Serato has ever
/// recorded", so a freshly linked agent swept the DJ's whole history into the
/// cloud: 485 sets and 17,337 plays going back five years on the first real
/// install, against the 1 set actually played after signing up. Decision A is
/// explicit that launch capture is go-forward only.
///
/// **Why the newest id, not a timestamp.** Ids are monotonic by insertion
/// regardless of clock skew — the same reasoning `list_sessions_after`'s own
/// doc gives for keying on id over `start_time`. The agent cannot know the
/// subscription date directly (AD-8 is outbound-only; there is no cloud→agent
/// channel), but Checkout is the first step of the corridor (PR #42), so a DJ
/// pays before they can link and first-link is a faithful proxy — minutes off
/// at worst.
///
/// Called from two places, deliberately: the watch loop's first tick, and
/// startup before the backfill sweep runs (see `lib.rs`). The sweep can clear
/// `synced_at` on historical rows, and [`crate::store::rows_pending_sync`]
/// refuses to push serato4 rows at or below this baseline — so the baseline
/// has to exist *before* the sweep, not merely soon after. Persisting is
/// monotonic (`MAX()` in SQL), so the two call sites racing is harmless.
pub(crate) fn ensure_serato4_baseline(
    store_conn: &Connection,
    serato4_conn: &Connection,
) -> Option<i64> {
    match crate::store::serato4_watermark(store_conn) {
        Ok(Some(stored)) => Some(stored),
        Ok(None) => {
            let baseline = crate::parser::max_session_id(serato4_conn).ok()?;
            log_store_err(
                "set_serato4_watermark (first-run go-forward baseline)",
                crate::store::set_serato4_watermark(store_conn, baseline),
            );
            Some(baseline)
        }
        Err(_e) => {
            // A store read failure must never be the thing that re-imports a
            // DJ's entire history.
            #[cfg(debug_assertions)]
            eprintln!("curfew-agent: could not read serato4 watermark: {_e}");
            None
        }
    }
}

fn check_for_new_sessions(
    root: &Path,
    db_path: &Path,
    watermark: &mut i64,
    store_conn: Option<&Connection>,
    pending: &mut HashSet<i64>,
    dates: &crate::joiner::date_added::DateAddedIndex,
) {
    let Ok(conn) = crate::joiner::serato4::open_read_only(root, db_path) else {
        return;
    };
    // 0 is the "unresolved" sentinel, which is safe because SQLite AUTOINCREMENT
    // ids start at 1: a real watermark is never 0 except on a library that has
    // never logged a session, where baselining at 0 is also correct.
    if *watermark == 0 {
        if let Some(store_conn) = store_conn {
            match ensure_serato4_baseline(store_conn, &conn) {
                Some(baseline) => *watermark = baseline,
                // Unresolved: skip this tick rather than fall through to a 0
                // watermark, which would list every session Serato ever
                // recorded. The next tick retries.
                None => return,
            }
        }
    }

    if let Ok(sessions) = crate::parser::list_sessions_after(&conn, *watermark) {
        if let Some(max_id) = sessions.iter().map(|s| s.id).max() {
            *watermark = max_id;
            // Persist immediately, before the capture loop below: a crash or
            // quit mid-capture must not leave the next launch re-listing these
            // same sessions. Re-capture is idempotent at the store level, but
            // re-listing years of history is not something to rely on
            // idempotency for.
            if let Some(store_conn) = store_conn {
                log_store_err(
                    "set_serato4_watermark (advance)",
                    crate::store::set_serato4_watermark(store_conn, max_id),
                );
            }
        }
        for session in &sessions {
            log_new_session(session);

            let Some(store_conn) = store_conn else {
                continue;
            };
            let identity = crate::capture::serato4_session_identity(session.id);
            let raw_ref = crate::capture::serato4_raw_ref(db_path, session.id);
            log_store_err(
                "upsert_watching on new session",
                crate::store::upsert_watching(
                    store_conn,
                    &identity,
                    crate::store::SessionSource::Serato4,
                    &raw_ref,
                    Some(session.start_time),
                ),
            );

            if crate::capture::serato4_end_time_resolved(session.end_time) {
                if !capture_and_store_serato4(
                    store_conn,
                    root,
                    db_path,
                    session.id,
                    dates,
                    &crate::error_reporting::SentryReporter,
                ) {
                    pending.insert(session.id);
                }
            } else {
                pending.insert(session.id);
            }
        }
    }
}

/// Debug-only visibility into detection for Task 7's manual walkthrough — mirrors
/// this crate's existing convention of debug-only conveniences with no release
/// build presence (e.g. `lib.rs`'s tray debug-cycle menu item).
#[cfg_attr(not(debug_assertions), allow(unused_variables))]
fn log_new_session(session: &crate::parser::SessionSummary) {
    #[cfg(debug_assertions)]
    eprintln!(
        "curfew-agent: new Serato session detected (id={}, start_time={})",
        session.id, session.start_time
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watcher::detect::DiskSource;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A no-op `ErrorReporter` fake (Story 3.4, Task 2) — these tests never
    /// depend on `config::SENTRY_DSN`'s build-time value.
    struct NoopReporter;
    impl crate::error_reporting::ErrorReporter for NoopReporter {
        fn report(&self, _context: &str, _agent_version: &str, _message: &str) {}
    }

    /// Records every call instead of no-op-ing (Story 3.4, Task 6) — used by
    /// the terminal-failure tests below to assert `report()` is actually
    /// invoked with the right `context`/`agent_version`/message.
    #[derive(Default)]
    struct RecordingReporter {
        calls: Mutex<Vec<(String, String, String)>>,
    }
    impl crate::error_reporting::ErrorReporter for RecordingReporter {
        fn report(&self, context: &str, agent_version: &str, message: &str) {
            self.calls.lock().unwrap().push((
                context.to_string(),
                agent_version.to_string(),
                message.to_string(),
            ));
        }
    }

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "curfew-watcher-mod-test-{tag}-{}-{n}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).expect("temp fixture dir creates");
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    struct NoDisks;
    impl DiskSource for NoDisks {
        fn removable_mount_points(&self) -> Vec<PathBuf> {
            vec![]
        }
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"").unwrap();
    }

    /// Task 3: an override set skips detection entirely, even when a real
    /// installable path also exists at the OS default — the override is the
    /// single source of truth, not merely a fallback.
    #[test]
    fn override_present_skips_detection_entirely() {
        let home = TempDir::new("override-skips");
        touch(
            &home
                .0
                .join("Music")
                .join(crate::joiner::legacy::SERATO_DIR)
                .join(crate::joiner::legacy::DATABASE_FILENAME),
        );
        let settings = AgentSettings {
            serato_path_override: Some("/dj/manual/path".to_string()),
        };

        let resolution = resolve_startup(&settings, &home.0, &NoDisks);

        assert_eq!(
            resolution,
            StartupResolution::Confirmed("/dj/manual/path".to_string())
        );
    }

    #[test]
    fn no_override_and_a_real_default_yields_pending_confirmation() {
        let home = TempDir::new("pending-confirm");
        let serato_dir = home.0.join("Music").join(crate::joiner::legacy::SERATO_DIR);
        touch(&serato_dir.join(crate::joiner::legacy::DATABASE_FILENAME));
        let settings = AgentSettings::default();

        let resolution = resolve_startup(&settings, &home.0, &NoDisks);

        assert_eq!(
            resolution,
            StartupResolution::PendingConfirmation(serato_dir.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn no_override_and_nothing_detected_yields_nothing_found() {
        let home = TempDir::new("nothing-found");
        let settings = AgentSettings::default();

        let resolution = resolve_startup(&settings, &home.0, &NoDisks);

        assert_eq!(resolution, StartupResolution::NothingFound);
    }

    // ---- pending_after_override_check (Task 7's explicit gating requirement) --

    #[test]
    fn pending_path_is_returned_when_no_override_exists() {
        assert_eq!(
            pending_after_override_check(false, Some("/detected/path".to_string())),
            Some("/detected/path".to_string())
        );
    }

    #[test]
    fn pending_path_is_suppressed_once_an_override_exists() {
        assert_eq!(
            pending_after_override_check(true, Some("/detected/path".to_string())),
            None,
            "a confirmed override must stop the pending panel from reappearing"
        );
    }

    #[test]
    fn no_cached_detection_is_none_regardless_of_override_state() {
        assert_eq!(pending_after_override_check(false, None), None);
        assert_eq!(pending_after_override_check(true, None), None);
    }

    // ---- scan_legacy_session_dir (startup/reconnect catch-up) ----

    fn multi_play_fixture() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/session/multi_play.session")
    }

    /// The gap this closes: a `.session` file written entirely while the agent
    /// was closed generates no `notify` event once the agent finally starts, so
    /// without this scan it would never be registered. Proves a pre-existing
    /// file is discovered and registered exactly as a live event would (Task 4
    /// resume semantics), without needing to wait for a quiet-period tick.
    #[test]
    fn scan_legacy_session_dir_registers_a_pre_existing_session_file() {
        let root = TempDir::new("scan-legacy-registers");
        let sessions_dir = root.0.join("History").join("Sessions");
        std::fs::create_dir_all(&sessions_dir).unwrap();
        let dest = sessions_dir.join("gig_from_while_agent_was_closed.session");
        std::fs::copy(multi_play_fixture(), &dest).expect("fixture copies");

        let store_file = TempDir::new("scan-legacy-registers-store");
        let conn = crate::store::open_at(&store_file.0.join("local.sqlite")).expect("store opens");
        let mut pending = HashMap::new();

        scan_legacy_session_dir(&conn, &sessions_dir, &mut pending);

        assert!(
            pending.contains_key(&dest),
            "a pre-existing .session file must be registered as pending on scan"
        );
        let identity = pending.get(&dest).unwrap().session_identity.clone();
        let row = crate::store::get_by_identity(&conn, &identity)
            .expect("store query succeeds")
            .expect("row was upserted by the scan");
        assert_eq!(row.status, crate::store::SessionStatus::Watching);
    }

    /// Calling the scan twice (e.g. two reconnects before the file ever goes
    /// quiet) must not double-register or otherwise disturb the existing
    /// pending entry — same idempotency guarantee `check_for_new_sessions`
    /// documents for its Serato4 sibling.
    #[test]
    fn scan_legacy_session_dir_is_idempotent_across_repeated_scans() {
        let root = TempDir::new("scan-legacy-idempotent");
        let sessions_dir = root.0.join("History").join("Sessions");
        std::fs::create_dir_all(&sessions_dir).unwrap();
        let dest = sessions_dir.join("gig.session");
        std::fs::copy(multi_play_fixture(), &dest).expect("fixture copies");

        let store_file = TempDir::new("scan-legacy-idempotent-store");
        let conn = crate::store::open_at(&store_file.0.join("local.sqlite")).expect("store opens");
        let mut pending = HashMap::new();

        scan_legacy_session_dir(&conn, &sessions_dir, &mut pending);
        scan_legacy_session_dir(&conn, &sessions_dir, &mut pending);

        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn scan_legacy_session_dir_is_a_noop_for_a_missing_directory() {
        let root = TempDir::new("scan-legacy-missing-dir");
        let store_file = TempDir::new("scan-legacy-missing-dir-store");
        let conn = crate::store::open_at(&store_file.0.join("local.sqlite")).expect("store opens");
        let mut pending = HashMap::new();

        scan_legacy_session_dir(&conn, &root.0.join("nonexistent"), &mut pending);

        assert!(pending.is_empty());
    }

    // ---- drive_connected (Story 3.3b AC-5, decided 2026-08-01) ---------------

    fn plan_with(
        serato4: Option<detect::Serato4Source>,
        legacy: Option<detect::LegacySource>,
    ) -> detect::WatchPlan {
        detect::WatchPlan { serato4, legacy }
    }

    fn fake_serato4() -> detect::Serato4Source {
        detect::Serato4Source {
            root: PathBuf::from("/home/master.sqlite"),
            db_path: PathBuf::from("/home/master.sqlite"),
        }
    }

    fn fake_legacy() -> detect::LegacySource {
        detect::LegacySource {
            serato_dir: PathBuf::from("/usb/_Serato_"),
            library_root: PathBuf::from("/usb"),
        }
    }

    #[test]
    fn drive_connected_true_when_only_serato4_resolves() {
        assert!(drive_connected(&plan_with(Some(fake_serato4()), None)));
    }

    #[test]
    fn drive_connected_true_when_only_legacy_resolves() {
        assert!(drive_connected(&plan_with(None, Some(fake_legacy()))));
    }

    #[test]
    fn drive_connected_true_when_both_resolve() {
        assert!(drive_connected(&plan_with(
            Some(fake_serato4()),
            Some(fake_legacy())
        )));
    }

    #[test]
    fn drive_connected_false_only_when_neither_resolves() {
        assert!(!drive_connected(&plan_with(None, None)));
    }

    // ---- Capture-time "Serato 4 wins" dedup (Story 3.3b, AC-2) --------------
    //
    // Fixture generators mirror `capture.rs`'s own test helpers, duplicated
    // locally per this crate's established "no shared test-support crate"
    // convention (Task 5). `open_read_only` needs a real, canonicalizable
    // file, unlike `capture.rs`'s own in-memory-db tests, so the serato4
    // fixture is written to a real temp file.

    fn utf16be_nul(s: &str) -> Vec<u8> {
        let mut out = Vec::new();
        for unit in s.encode_utf16() {
            out.extend_from_slice(&unit.to_be_bytes());
        }
        out.extend_from_slice(&[0, 0]);
        out
    }

    fn text_field(id: u32, s: &str) -> Vec<u8> {
        let payload = utf16be_nul(s);
        let mut f = Vec::new();
        f.extend_from_slice(&id.to_be_bytes());
        f.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        f.extend_from_slice(&payload);
        f
    }

    fn u32_field(id: u32, value: u32) -> Vec<u8> {
        let mut f = Vec::new();
        f.extend_from_slice(&id.to_be_bytes());
        f.extend_from_slice(&4u32.to_be_bytes());
        f.extend_from_slice(&value.to_be_bytes());
        f
    }

    fn tagged(tag: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut r = Vec::new();
        r.extend_from_slice(tag);
        r.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        r.extend_from_slice(payload);
        r
    }

    fn oent(fields: &[Vec<u8>]) -> Vec<u8> {
        let adat = tagged(b"adat", &fields.concat());
        tagged(b"oent", &adat)
    }

    fn legacy_play_record(path: &str, start: u32) -> Vec<u8> {
        oent(&[
            text_field(2, path),
            text_field(6, "Track"),
            text_field(7, "Artist"),
            u32_field(28, start),
            u32_field(31, 1),
        ])
    }

    /// No start_time field at all — proves the dedup guard's fail-open
    /// behavior when a session's bounds are unknown.
    fn legacy_play_record_without_start_time(path: &str) -> Vec<u8> {
        oent(&[
            text_field(2, path),
            text_field(6, "Track"),
            text_field(7, "Artist"),
            u32_field(31, 1),
        ])
    }

    /// A filesystem-free, empty date-added index — watcher tests are never
    /// about the `database V2` lookup.
    fn no_dates() -> crate::joiner::date_added::DateAddedIndex {
        crate::joiner::date_added::DateAddedIndex::fixed(std::collections::HashMap::new())
    }

    fn write_legacy_session_file(dir: &Path, name: &str, data: &[u8]) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, data).unwrap();
        path
    }

    /// An empty-but-real legacy catalogue at `root` — mirrors `capture.rs`'s
    /// own `empty_legacy_library_root` fixture.
    fn empty_legacy_library_root(root: &Path) {
        let serato_dir = root.join(crate::joiner::legacy::SERATO_DIR);
        std::fs::create_dir_all(&serato_dir).unwrap();
        let content: Vec<u8> = utf16be_nul("2.0/Serato Scratch LIVE Database");
        let mut header = Vec::from(*b"vrsn");
        header.extend_from_slice(&(content.len() as u32).to_be_bytes());
        header.extend_from_slice(&content);
        std::fs::write(
            serato_dir.join(crate::joiner::legacy::DATABASE_FILENAME),
            header,
        )
        .unwrap();
    }

    /// A real on-disk `master.sqlite` fixture carrying one `history_entry`
    /// row with the given `start_time` — enough for `capture::build_serato4`.
    fn write_serato4_fixture(dir: &Path, session_id: i64, start: i64) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let db_path = dir.join("master.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            r#"CREATE TABLE history_entry (
                   id INTEGER PRIMARY KEY, session_id INTEGER, name TEXT, artist TEXT,
                   genre TEXT, key_value INTEGER, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT,
                   end_time INTEGER, played INTEGER, length_ms INTEGER, length_sec INTEGER,
                   portable_id TEXT
               );
               CREATE TABLE history_session (
                   id INTEGER PRIMARY KEY, name TEXT, start_time INTEGER, end_time INTEGER
               );"#,
        )
        .unwrap();
        conn.execute(
            r#"INSERT INTO history_entry (session_id, name, artist, genre, "key", bpm, start_time, deck)
               VALUES (?1, 'Track', 'Artist', 'House', '1A', 120.0, ?2, '1')"#,
            rusqlite::params![session_id, start],
        )
        .unwrap();
        db_path
    }

    /// The same fixture, but every row carries Serato's own `played = 0` —
    /// tracks loaded to a deck and never played. `build_serato4`'s Story 3.7
    /// filter drops all of them, so the capture resolves to
    /// `CaptureError::AllPreviews`.
    fn write_serato4_all_previews_fixture(dir: &Path, session_id: i64, start: i64) -> PathBuf {
        let db_path = write_serato4_fixture(dir, session_id, start);
        let conn = Connection::open(&db_path).unwrap();
        conn.execute("DELETE FROM history_entry", []).unwrap();
        conn.execute(
            r#"INSERT INTO history_entry (session_id, name, artist, genre, "key", bpm, start_time, deck, played)
               VALUES (?1, 'Loaded only', 'Artist', 'House', '1A', 120.0, ?2, '1', 0),
                      (?1, 'Also loaded only', 'Artist', 'House', '1A', 120.0, ?3, '2', 0)"#,
            rusqlite::params![session_id, start, start + 100],
        )
        .unwrap();
        db_path
    }

    /// AC-2, forward direction (the common case): serato4 captures first, a
    /// same-night legacy capture arriving after it is superseded rather than
    /// reaching the sync queue as a duplicate.
    #[test]
    fn dedup_forward_direction_serato4_first_supersedes_the_legacy_row() {
        let store_file = TempDir::new("dedup-forward-store");
        let store_conn =
            crate::store::open_at(&store_file.0.join("local.sqlite")).expect("store opens");

        let serato4_dir = TempDir::new("dedup-forward-serato4");
        let db_path = write_serato4_fixture(&serato4_dir.0, 7, 1_000);
        assert!(capture_and_store_serato4(
            &store_conn,
            &serato4_dir.0,
            &db_path,
            7,
            &no_dates(),
            &NoopReporter
        ));

        let legacy_lib_dir = TempDir::new("dedup-forward-legacy-lib");
        empty_legacy_library_root(&legacy_lib_dir.0);
        let session_dir = TempDir::new("dedup-forward-legacy-session");
        let session_path = write_legacy_session_file(
            &session_dir.0,
            "gig.session",
            &legacy_play_record("/music/a.mp3", 1_010),
        );
        let identity = "legacy:test-forward";
        assert!(capture_and_store_legacy(
            &store_conn,
            &legacy_lib_dir.0,
            &session_path,
            identity,
            &NoopReporter,
        ));

        assert_eq!(
            crate::store::status_of(&store_conn, identity).unwrap(),
            Some(crate::store::SessionStatus::Superseded)
        );
        let serato4_identity = crate::capture::serato4_session_identity(7);
        assert_eq!(
            crate::store::status_of(&store_conn, &serato4_identity).unwrap(),
            Some(crate::store::SessionStatus::Captured)
        );
        let pending = crate::store::rows_pending_sync(&store_conn).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].session_identity, serato4_identity);
    }

    /// AC-2, reverse direction: a legacy capture that beats a same-night
    /// serato4 capture to the store is superseded once serato4 arrives.
    #[test]
    fn dedup_reverse_direction_legacy_first_gets_superseded_when_serato4_arrives() {
        let store_file = TempDir::new("dedup-reverse-store");
        let store_conn =
            crate::store::open_at(&store_file.0.join("local.sqlite")).expect("store opens");

        let legacy_lib_dir = TempDir::new("dedup-reverse-legacy-lib");
        empty_legacy_library_root(&legacy_lib_dir.0);
        let session_dir = TempDir::new("dedup-reverse-legacy-session");
        let session_path = write_legacy_session_file(
            &session_dir.0,
            "gig.session",
            &legacy_play_record("/music/a.mp3", 2_000),
        );
        let identity = "legacy:test-reverse";
        assert!(capture_and_store_legacy(
            &store_conn,
            &legacy_lib_dir.0,
            &session_path,
            identity,
            &NoopReporter,
        ));
        assert_eq!(
            crate::store::status_of(&store_conn, identity).unwrap(),
            Some(crate::store::SessionStatus::Captured)
        );

        let serato4_dir = TempDir::new("dedup-reverse-serato4");
        let db_path = write_serato4_fixture(&serato4_dir.0, 9, 2_010);
        assert!(capture_and_store_serato4(
            &store_conn,
            &serato4_dir.0,
            &db_path,
            9,
            &no_dates(),
            &NoopReporter
        ));

        assert_eq!(
            crate::store::status_of(&store_conn, identity).unwrap(),
            Some(crate::store::SessionStatus::Superseded)
        );
        assert_eq!(
            crate::store::status_of(&store_conn, &crate::capture::serato4_session_identity(9))
                .unwrap(),
            Some(crate::store::SessionStatus::Captured)
        );
    }

    /// AC-2's documented accepted edge: a legacy row that has already synced
    /// is left uncontested — there is no retraction path in the sync
    /// contract.
    #[test]
    fn dedup_reverse_direction_leaves_an_already_synced_legacy_row_uncontested() {
        let store_file = TempDir::new("dedup-reverse-synced-store");
        let store_conn =
            crate::store::open_at(&store_file.0.join("local.sqlite")).expect("store opens");

        let legacy_lib_dir = TempDir::new("dedup-reverse-synced-legacy-lib");
        empty_legacy_library_root(&legacy_lib_dir.0);
        let session_dir = TempDir::new("dedup-reverse-synced-legacy-session");
        let session_path = write_legacy_session_file(
            &session_dir.0,
            "gig.session",
            &legacy_play_record("/music/a.mp3", 3_000),
        );
        let identity = "legacy:test-already-synced";
        assert!(capture_and_store_legacy(
            &store_conn,
            &legacy_lib_dir.0,
            &session_path,
            identity,
            &NoopReporter,
        ));
        crate::store::mark_synced(&store_conn, identity, 999_999).unwrap();

        let serato4_dir = TempDir::new("dedup-reverse-synced-serato4");
        let db_path = write_serato4_fixture(&serato4_dir.0, 11, 3_010);
        assert!(capture_and_store_serato4(
            &store_conn,
            &serato4_dir.0,
            &db_path,
            11,
            &no_dates(),
            &NoopReporter
        ));

        assert_eq!(
            crate::store::status_of(&store_conn, identity).unwrap(),
            Some(crate::store::SessionStatus::Captured),
            "an already-synced legacy row must never be superseded -- no retraction path"
        );
    }

    /// Fail-open: a legacy session with unknown bounds is never suppressed,
    /// even when a same-source-window serato4 capture already exists.
    #[test]
    fn dedup_fail_open_when_legacy_bounds_are_unknown_both_stay_captured() {
        let store_file = TempDir::new("dedup-fail-open-store");
        let store_conn =
            crate::store::open_at(&store_file.0.join("local.sqlite")).expect("store opens");

        let serato4_dir = TempDir::new("dedup-fail-open-serato4");
        let db_path = write_serato4_fixture(&serato4_dir.0, 13, 4_000);
        assert!(capture_and_store_serato4(
            &store_conn,
            &serato4_dir.0,
            &db_path,
            13,
            &no_dates(),
            &NoopReporter
        ));

        let legacy_lib_dir = TempDir::new("dedup-fail-open-legacy-lib");
        empty_legacy_library_root(&legacy_lib_dir.0);
        let session_dir = TempDir::new("dedup-fail-open-legacy-session");
        let session_path = write_legacy_session_file(
            &session_dir.0,
            "gig.session",
            &legacy_play_record_without_start_time("/music/a.mp3"),
        );
        let identity = "legacy:test-fail-open";
        assert!(capture_and_store_legacy(
            &store_conn,
            &legacy_lib_dir.0,
            &session_path,
            identity,
            &NoopReporter,
        ));

        assert_eq!(
            crate::store::status_of(&store_conn, identity).unwrap(),
            Some(crate::store::SessionStatus::Captured),
            "unknown bounds must never suppress a capture -- fail open"
        );
    }

    // ---- Terminal-failure -> parse_failures + ErrorReporter (Story 3.4, Task 2/6) ---

    /// A session where every row was a loaded-but-never-played preview is
    /// **not** a failure: nothing was played, so there is nothing to capture.
    /// It must not reach `parse_failures` (where it would be permanent — a
    /// re-parse returns `AllPreviews` again, so `reprocess_parse_failures` can
    /// never clear it, and the tray would read "Format drift detected"
    /// forever) and must not be reported to Sentry.
    #[test]
    fn an_all_previews_serato4_session_is_skipped_not_recorded_as_a_failure() {
        let store_dir = TempDir::new("all-previews-serato4-store");
        let store_conn =
            crate::store::open_at(&store_dir.0.join("local.sqlite")).expect("store opens");

        let serato4_dir = TempDir::new("all-previews-serato4");
        let db_path = write_serato4_all_previews_fixture(&serato4_dir.0, 7, 1_000);
        let reporter = RecordingReporter::default();

        let terminal = capture_and_store_serato4(
            &store_conn,
            &serato4_dir.0,
            &db_path,
            7,
            &no_dates(),
            &reporter,
        );

        assert!(
            terminal,
            "an all-previews session is a terminal outcome -- the caller must stop \
             retrying it, exactly as it does for an empty session"
        );
        assert!(
            crate::store::unresolved_parse_failures(&store_conn)
                .unwrap()
                .is_empty(),
            "nothing played is not a parse failure"
        );
        assert!(
            reporter.calls.lock().unwrap().is_empty(),
            "Sentry must not be fed a non-error on every startup"
        );
        assert_eq!(
            crate::store::status_of(&store_conn, &crate::capture::serato4_session_identity(7))
                .unwrap(),
            None,
            "no identity is fabricated for a session with nothing in it"
        );
    }

    /// A genuine `build_serato4` error (not `CaptureError::EmptySession` or
    /// `AllPreviews`, both of which are ordinary "nothing to capture"
    /// outcomes) — `db_path` names a file that was never created, so
    /// `open_read_only` fails outright — records a `parse_failures` row and
    /// reports it, tagged with the running build's `agent_version`.
    #[test]
    fn a_terminal_serato4_capture_failure_records_and_reports() {
        let store_dir = TempDir::new("terminal-failure-serato4-store");
        let store_conn =
            crate::store::open_at(&store_dir.0.join("local.sqlite")).expect("store opens");

        let serato4_dir = TempDir::new("terminal-failure-serato4-missing");
        let db_path = serato4_dir.0.join("master.sqlite");
        let reporter = RecordingReporter::default();

        let succeeded =
            capture_and_store_serato4(&store_conn, &db_path, &db_path, 77, &no_dates(), &reporter);

        assert!(
            !succeeded,
            "a genuine build_serato4 error is not terminal-success"
        );

        let identity = crate::capture::serato4_session_identity(77);
        let rows = crate::store::unresolved_parse_failures(&store_conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].session_identity, identity);
        assert_eq!(rows[0].source, crate::store::SessionSource::Serato4);
        assert_eq!(rows[0].failed_agent_version, crate::config::AGENT_VERSION);

        let calls = reporter.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "serato4 capture");
        assert_eq!(calls[0].1, crate::config::AGENT_VERSION);
    }

    /// A genuine `build_legacy` error (not `CaptureError::EmptySession`, nor
    /// the `AllPreviews` its Serato4 sibling now skips alongside it) —
    /// `session_path` names a file that was never created, so
    /// `parse_session_file_partial`'s `std::fs::read` fails outright.
    #[test]
    fn a_terminal_legacy_capture_failure_records_and_reports() {
        let store_dir = TempDir::new("terminal-failure-legacy-store");
        let store_conn =
            crate::store::open_at(&store_dir.0.join("local.sqlite")).expect("store opens");

        let legacy_lib_dir = TempDir::new("terminal-failure-legacy-lib");
        empty_legacy_library_root(&legacy_lib_dir.0);
        let missing_session_path = legacy_lib_dir.0.join("nonexistent.session");
        let identity = "legacy:terminal-failure";
        let reporter = RecordingReporter::default();

        let succeeded = capture_and_store_legacy(
            &store_conn,
            &legacy_lib_dir.0,
            &missing_session_path,
            identity,
            &reporter,
        );

        assert!(
            !succeeded,
            "a genuine build_legacy error is not terminal-success"
        );

        let rows = crate::store::unresolved_parse_failures(&store_conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].session_identity, identity);
        assert_eq!(rows[0].source, crate::store::SessionSource::Legacy);
        assert_eq!(rows[0].failed_agent_version, crate::config::AGENT_VERSION);

        let calls = reporter.calls.lock().unwrap();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "legacy capture");
        assert_eq!(calls[0].1, crate::config::AGENT_VERSION);
    }
}
