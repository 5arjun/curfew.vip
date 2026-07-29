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

use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
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
#[allow(unused_assignments)] // `_fs_watcher` is a lifetime guard: dropping it stops the watch.
fn watch_loop(app: AppHandle) {
    let mut current_path: Option<PathBuf> = None;
    let mut connected = false;
    let mut watermark: i64 = 0;
    let mut _fs_watcher: Option<RecommendedWatcher> = None;
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();

    loop {
        let override_path = crate::settings::load(&app)
            .ok()
            .and_then(|s| s.serato_path_override)
            .map(PathBuf::from);

        // The override changed (first ever Save, or a DJ pointing it somewhere
        // new) — drop whatever was being watched and re-evaluate from scratch
        // against the new path, exactly like a disconnect/reconnect cycle.
        if override_path != current_path {
            current_path = override_path.clone();
            connected = false;
            _fs_watcher = None;
        }

        if let Some(path) = &current_path {
            match detect::classify(path) {
                Some(install) => {
                    if !connected {
                        connected = true;
                        watermark = 0;
                        let _ = crate::tray::set_tray_state(&app, crate::tray::TrayState::Idle);
                        _fs_watcher = start_fs_watch(&install, tx.clone());
                        if let SeratoInstall::Serato4 { db_path } = &install {
                            check_for_new_sessions(db_path, &mut watermark);
                        }
                    }
                }
                None => {
                    if connected {
                        connected = false;
                        _fs_watcher = None;
                        let _ = crate::tray::set_tray_state(
                            &app,
                            crate::tray::TrayState::DriveNotConnected,
                        );
                    }
                }
            }
        }
        // No override at all yet: nothing to watch. Tray/window state for that
        // case belongs to the first-run confirm flow (`resolve_startup`), not
        // this loop.

        match rx.recv_timeout(RECONNECT_POLL_INTERVAL) {
            Ok(Ok(_event)) => {
                // `notify` on a SQLite file in WAL mode can fire more than once per
                // logical write (temp-file churn) — harmless here because
                // `check_for_new_sessions` is idempotent against `watermark`, so a
                // spurious extra event just re-runs a query that finds nothing new.
                if let Some(path) = &current_path {
                    if let Some(SeratoInstall::Serato4 { db_path }) = detect::classify(path) {
                        check_for_new_sessions(&db_path, &mut watermark);
                    }
                }
                // Legacy `.session` file events: detection only (this story does
                // not parse them — Story 2.8's job). Nothing to do here beyond
                // having proven the watcher fires, which Task 7's manual
                // walkthrough covers.
            }
            Ok(Err(_)) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {} // reconnect poll tick
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
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
fn check_for_new_sessions(db_path: &Path, watermark: &mut i64) {
    let Ok(conn) = crate::joiner::serato4::open_read_only(db_path) else {
        return;
    };
    if let Ok(sessions) = crate::parser::list_sessions_after(&conn, *watermark) {
        if let Some(max_id) = sessions.iter().map(|s| s.id).max() {
            *watermark = max_id;
        }
        for session in &sessions {
            log_new_session(session);
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
}
