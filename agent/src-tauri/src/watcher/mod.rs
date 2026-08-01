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
use tauri::AppHandle;

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

/// Story 3.3: the current "is the configured Serato source reachable" signal,
/// published by [`watch_loop`] on every connect/disconnect transition —
/// shared Tauri state so the independent sync-queue drain loop
/// (`sync_queue.rs`) can read it before writing its own tray state. Two
/// independent problems ("drive not connected" vs. "sync backlog queued")
/// must never fight over the tray: this story's Dev Notes rule that
/// `DriveNotConnected` is the more specific, more actionable state and must
/// win whenever both are true at once. Defaults to `true` (assume connected,
/// matching the tray's own `Idle` default at boot) until the first
/// classification tick says otherwise.
pub struct DriveConnectionState(pub std::sync::atomic::AtomicBool);

impl Default for DriveConnectionState {
    fn default() -> Self {
        Self(std::sync::atomic::AtomicBool::new(true))
    }
}

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

/// One connected/disconnected cycle plus live session discovery, looped forever.
///
/// **Re-reads `settings::load` every cycle rather than taking a fixed path.**
/// The confirm action (`set_serato_path_override`, Task 3/4) only ever writes to
/// disk — it has no reference to a possibly-already-running watch loop to signal,
/// and starting a second loop per Save would race two threads over the same tray
/// state. Polling the live override instead means Save doesn't need to know this
/// loop exists at all: whatever is on disk right now is what gets watched, and a
/// changed override (first Save, or editing an existing one) is picked up on the
/// next [`RECONNECT_POLL_INTERVAL`] tick, same as a reconnect.
///
/// Two other concerns share this one loop rather than running as two: a
/// disconnect must tear down the live fs-watcher (it is watching a path that
/// just vanished), and a reconnect must stand a fresh one back up against the
/// same, possibly-relaunched, volume.
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
#[allow(unused_assignments)] // `_fs_watcher` is a lifetime guard: dropping it stops the watch.
fn watch_loop(app: AppHandle) {
    let mut current_path: Option<PathBuf> = None;
    // `None` = not yet evaluated against the current `current_path` (true both
    // at boot and right after a path change) — distinct from `Some(false)`
    // (evaluated and found disconnected), so the very first classification for
    // a path always announces its result instead of only a transition edge.
    let mut connected: Option<bool> = None;
    let mut watermark: i64 = 0;
    let mut _fs_watcher: Option<RecommendedWatcher> = None;
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

    loop {
        let override_path = crate::settings::load(&app)
            .ok()
            .and_then(|s| s.serato_path_override)
            .map(PathBuf::from);

        // The override changed (first ever Save, or a DJ pointing it somewhere
        // new) — drop whatever was being watched and re-evaluate from scratch
        // against the new path. A genuine path change resets the high-water
        // mark (a different database has no meaningful prior watermark); a
        // mere disconnect/reconnect of the *same* path does not (see below) —
        // otherwise every USB unplug/replug would re-report all previously-seen
        // sessions as new. Story 2.8: a path change also invalidates any
        // in-flight pending-capture bookkeeping for the old path, same reasoning.
        if override_path != current_path {
            // Story 2.8 AC-4: a path change abandons whatever was pending for
            // the old path — flag those store rows `incomplete` (same as a
            // disconnect) before dropping the in-memory trackers, so they are
            // not silently left at `watching` forever with nothing left to
            // ever resume or flag them.
            if let Some(conn) = &store_conn {
                for id in &pending_serato4 {
                    log_store_err(
                        "mark_incomplete on path change",
                        crate::store::mark_incomplete(
                            conn,
                            &crate::capture::serato4_session_identity(*id),
                        ),
                    );
                }
                for entry in legacy_pending.values() {
                    log_store_err(
                        "mark_incomplete on path change",
                        crate::store::mark_incomplete(conn, &entry.session_identity),
                    );
                }
            }
            current_path = override_path.clone();
            connected = None;
            watermark = 0;
            _fs_watcher = None;
            pending_serato4.clear();
            legacy_pending.clear();
        }

        if let Some(path) = &current_path {
            match detect::classify(path) {
                Some(install) => {
                    // Covers both the first-ever classification for this path
                    // (`None`, including at boot) and a genuine reconnect
                    // (`Some(false)`) — either way the tray/watcher need to
                    // (re)announce, but the watermark is deliberately left
                    // untouched here (only a path change resets it, above).
                    if connected != Some(true) {
                        connected = Some(true);
                        publish_drive_connection_state(&app, true);
                        let _ = crate::tray::set_tray_state(&app, crate::tray::TrayState::Idle);
                        _fs_watcher = start_fs_watch(&install, tx.clone());
                        if let SeratoInstall::Serato4 { db_path } = &install {
                            check_for_new_sessions(
                                path,
                                db_path,
                                &mut watermark,
                                store_conn.as_ref(),
                                &mut pending_serato4,
                            );
                        }
                        // Mirrors the Serato4 branch above: the live `notify`
                        // watcher (started just above) only sees `.session`
                        // files written *after* this point, so a session that
                        // completed while the agent was closed would
                        // otherwise never be discovered (no watermark-style
                        // cursor exists for a directory of files the way it
                        // does for `master.sqlite` rows). This one-time scan
                        // on (re)connect closes that gap by registering every
                        // existing `.session` file the same way a live event
                        // would — `handle_legacy_session_event`'s in-memory
                        // `pending` check and the store's `upsert_watching`
                        // (refuses to regress a `captured` row) make this
                        // idempotent against files already seen/captured in a
                        // prior run.
                        if let SeratoInstall::Legacy(serato_dir) = &install {
                            if let Some(conn) = &store_conn {
                                scan_legacy_session_dir(
                                    conn,
                                    &serato_dir.join("History").join("Sessions"),
                                    &mut legacy_pending,
                                );
                            }
                        }
                        // Story 2.8 AC-4 resume: a session marked `incomplete`
                        // on a prior disconnect goes back to `watching` the
                        // moment its source is reachable again — the next
                        // completion re-check below promotes it to `captured`
                        // if the signal has resolved, or it simply continues
                        // as a normal pending session otherwise.
                        if let Some(conn) = &store_conn {
                            reregister_pending_as_watching(
                                conn,
                                db_path_for(&install),
                                &pending_serato4,
                                &legacy_pending,
                            );
                        }
                    }
                    // Story 2.8 Task 4/6: completion re-check, every iteration
                    // while connected.
                    if let Some(conn) = &store_conn {
                        match &install {
                            SeratoInstall::Serato4 { db_path } => {
                                recheck_pending_serato4(conn, path, db_path, &mut pending_serato4);
                            }
                            SeratoInstall::Legacy(serato_dir) => {
                                let library_root =
                                    crate::capture::library_root_from_serato_dir(serato_dir);
                                recheck_legacy_quiet_periods(
                                    conn,
                                    &library_root,
                                    &mut legacy_pending,
                                );
                            }
                        }
                    }
                }
                None => {
                    if connected != Some(false) {
                        connected = Some(false);
                        _fs_watcher = None;
                        publish_drive_connection_state(&app, false);
                        let _ = crate::tray::set_tray_state(
                            &app,
                            crate::tray::TrayState::DriveNotConnected,
                        );
                        // Story 2.8 AC-4: a session still `watching` when its
                        // source disconnects is neither silently dropped nor
                        // left ambiguously `watching` forever — flag it
                        // `incomplete`. Still tracked in-memory (not cleared
                        // here, unlike a genuine path change above) so a
                        // reconnect can resume it.
                        if let Some(conn) = &store_conn {
                            for id in &pending_serato4 {
                                log_store_err(
                                    "mark_incomplete on disconnect",
                                    crate::store::mark_incomplete(
                                        conn,
                                        &crate::capture::serato4_session_identity(*id),
                                    ),
                                );
                            }
                            for entry in legacy_pending.values() {
                                log_store_err(
                                    "mark_incomplete on disconnect",
                                    crate::store::mark_incomplete(conn, &entry.session_identity),
                                );
                            }
                        }
                    }
                }
            }
        }
        // No override at all yet: nothing to watch. Tray/window state for that
        // case belongs to the first-run confirm flow (`resolve_startup`), not
        // this loop.

        match rx.recv_timeout(RECONNECT_POLL_INTERVAL) {
            Ok(Ok(event)) => {
                // `notify` on a SQLite file in WAL mode can fire more than once per
                // logical write (temp-file churn) — harmless here because
                // `check_for_new_sessions` is idempotent against `watermark`, so a
                // spurious extra event just re-runs a query that finds nothing new.
                if let Some(path) = &current_path {
                    match detect::classify(path) {
                        Some(SeratoInstall::Serato4 { db_path }) => {
                            check_for_new_sessions(
                                path,
                                &db_path,
                                &mut watermark,
                                store_conn.as_ref(),
                                &mut pending_serato4,
                            );
                        }
                        Some(SeratoInstall::Legacy(_)) => {
                            // Story 2.8: register/refresh whichever `.session`
                            // file(s) this event touched — completion itself
                            // is decided by the quiet-period re-check above,
                            // not here.
                            if let Some(conn) = &store_conn {
                                for event_path in &event.paths {
                                    if event_path.extension().and_then(|e| e.to_str())
                                        == Some("session")
                                    {
                                        handle_legacy_session_event(
                                            conn,
                                            event_path,
                                            &mut legacy_pending,
                                        );
                                    }
                                }
                            }
                        }
                        None => {}
                    }
                }
            }
            Ok(Err(_)) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {} // reconnect poll tick
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

/// A legacy `.session` file this agent has seen but not yet captured (Story
/// 2.8 Task 4): when it was last modified (the quiet-period clock) and the
/// dedup key already computed for it, so re-checking it never needs a second
/// parse just to recover its identity.
struct LegacyPendingSession {
    last_modified: SystemTime,
    session_identity: String,
}

/// Story 3.3: publishes the drive-reachability signal for
/// [`DriveConnectionState`]'s consumers (the sync-queue drain loop) — a
/// no-op if the state isn't managed yet (should not happen once `.setup()`
/// completes, but this loop must never panic over a missing `try_state`).
fn publish_drive_connection_state(app: &AppHandle, connected: bool) {
    use tauri::Manager;
    if let Some(state) = app.try_state::<DriveConnectionState>() {
        state
            .0
            .store(connected, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Logs a local-store write failure in debug builds only, matching this
/// module's other write-failure logging (`capture_and_store_serato4`/
/// `_legacy`). Release builds have no UI surface to report to yet, and a
/// future poll tick or reconnect calling the same write again is the retry —
/// but a silently-discarded error is invisible even to a developer running a
/// debug build without this.
fn log_store_err(context: &str, result: Result<(), crate::store::StoreError>) {
    if let Err(_e) = result {
        #[cfg(debug_assertions)]
        eprintln!("curfew-agent: local store write failed ({context}): {_e}");
    }
}

/// The `db_path` a Serato4 install carries, for callers that already matched
/// on [`SeratoInstall`] generically. `None` for a legacy install — Task 4's
/// resume step only applies to Serato4's `pending_serato4` set via this path;
/// the legacy half is handled directly against `legacy_pending`, which does
/// not need a `db_path` at all.
fn db_path_for(install: &SeratoInstall) -> Option<&Path> {
    match install {
        SeratoInstall::Serato4 { db_path } => Some(db_path),
        SeratoInstall::Legacy(_) => None,
    }
}

/// Story 2.8 AC-4 resume: re-marks every currently-tracked pending session
/// `'watching'` (from whatever it was, including `'incomplete'`) now that its
/// source is reachable again. A no-op for a session already `'captured'` —
/// [`crate::store::upsert_watching`]'s own `WHERE` clause refuses to regress
/// that terminal state.
fn reregister_pending_as_watching(
    conn: &Connection,
    serato4_db_path: Option<&Path>,
    pending_serato4: &HashSet<i64>,
    legacy_pending: &HashMap<PathBuf, LegacyPendingSession>,
) {
    if let Some(db_path) = serato4_db_path {
        for id in pending_serato4 {
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
    for (path, entry) in legacy_pending {
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
        if capture_and_store_serato4(store_conn, root, db_path, id) {
            pending.remove(&id);
        }
    }
}

/// Runs the Serato4 capture pipeline for one now-complete session and persists
/// it. Returns `true` for a terminal outcome — captured, or
/// [`crate::capture::CaptureError::EmptySession`] (expected rather than
/// exceptional, see that variant's own doc comment) — meaning the caller
/// should stop tracking this session. Returns `false` for a transient failure
/// (parse/join/correlation/SQLite error, or a failed store write), logged in
/// debug builds: the caller keeps the session pending so the next poll tick
/// retries it, rather than silently losing it for the rest of this run.
fn capture_and_store_serato4(
    store_conn: &Connection,
    root: &Path,
    db_path: &Path,
    session_id: i64,
) -> bool {
    match crate::capture::build_serato4(root, db_path, session_id) {
        Ok((plays, derived)) => {
            let identity = crate::capture::serato4_session_identity(session_id);
            let raw_ref = crate::capture::serato4_raw_ref(db_path, session_id);
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
            true
        }
        Err(crate::capture::CaptureError::EmptySession) => {
            // Nothing decoded for a session id `history_session` itself just
            // reported — leave the existing `watching` row as-is rather than
            // fabricate an identity for nothing (Task 4); it simply never
            // resolves to `captured`.
            true
        }
        Err(_e) => {
            #[cfg(debug_assertions)]
            eprintln!("curfew-agent: serato4 capture failed for session {session_id}: {_e}");
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
        if capture_and_store_legacy(store_conn, library_root, &session_path, &session_identity) {
            pending.remove(&session_path);
        }
    }
}

/// Runs the legacy capture pipeline for one now-quiet session and persists it.
/// Mirrors [`capture_and_store_serato4`]'s error handling and terminal-outcome
/// `bool` return.
fn capture_and_store_legacy(
    store_conn: &Connection,
    library_root: &Path,
    session_path: &Path,
    session_identity: &str,
) -> bool {
    match crate::capture::build_legacy(library_root, session_path) {
        Ok((plays, derived)) => {
            let raw_ref = session_path.to_string_lossy().into_owned();
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
            true
        }
        Err(crate::capture::CaptureError::EmptySession) => {
            // The file went quiet with nothing decodable — leave the
            // `watching` row as-is (Task 4), same reasoning as the Serato4
            // sibling above.
            true
        }
        Err(_e) => {
            #[cfg(debug_assertions)]
            eprintln!(
                "curfew-agent: legacy capture failed for {}: {_e}",
                session_path.display()
            );
            false
        }
    }
}

/// Stands up a live filesystem watcher for one install: the legacy
/// `History/Sessions` folder (new/modified `.session` files), or the Serato 4+
/// `master.sqlite` file itself (changes on every play). Returns `None` if the
/// watcher fails to start (e.g. the path just vanished between `classify`
/// succeeding and this call) — the outer loop's next reconnect poll will retry.
fn start_fs_watch(
    install: &SeratoInstall,
    tx: mpsc::Sender<notify::Result<notify::Event>>,
) -> Option<RecommendedWatcher> {
    let watch_target = match install {
        SeratoInstall::Legacy(serato_dir) => serato_dir.join("History").join("Sessions"),
        SeratoInstall::Serato4 { db_path } => db_path.clone(),
    };

    let mut watcher = notify::recommended_watcher(move |res| {
        let _ = tx.send(res);
    })
    .ok()?;
    watcher
        .watch(&watch_target, RecursiveMode::NonRecursive)
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
fn check_for_new_sessions(
    root: &Path,
    db_path: &Path,
    watermark: &mut i64,
    store_conn: Option<&Connection>,
    pending: &mut HashSet<i64>,
) {
    let Ok(conn) = crate::joiner::serato4::open_read_only(root, db_path) else {
        return;
    };
    if let Ok(sessions) = crate::parser::list_sessions_after(&conn, *watermark) {
        if let Some(max_id) = sessions.iter().map(|s| s.id).max() {
            *watermark = max_id;
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
                if !capture_and_store_serato4(store_conn, root, db_path, session.id) {
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
}
