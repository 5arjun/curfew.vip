//! Offline sync-queue drain loop (Story 3.3, AR-2/AD-4): periodically retries
//! [`crate::sync::sync_pending_sessions`] (Story 3.2 — built, tested, and
//! deliberately never wired to anything live) with a backoff that keeps a
//! genuinely offline agent from hammering a dead connection, and drives
//! [`crate::tray::TrayState::Queued`] while a transient backlog exists.
//!
//! **The queue is `captured_sessions.synced_at IS NULL`, not a new table**
//! (AD-5) — see [`crate::store::rows_pending_sync`]. This module only adds
//! *when/how often* Story 3.2's sync mechanism gets called and *what the
//! tray shows* while it hasn't succeeded yet; it never touches wire format or
//! write-path logic (Story 3.2's job), and it never rewrites
//! `sync_pending_sessions`'s own core logic (auth-token fetch, row
//! iteration, `sync_one`) — only wraps/extends it.
//!
//! Runs as its own background thread ([`start_syncing`], mirroring
//! [`crate::watcher::start_watching`]'s exact spawn pattern) on its own
//! interval, deliberately decoupled from `watcher`'s 5s drive-poll tick — a
//! *retry* cadence that aggressive would spin a genuinely offline connection
//! needlessly, and would couple two unrelated concerns onto one tick.

use std::collections::HashSet;
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::sync::SyncSummary;
use crate::tray::TrayState;

/// Base retry interval — deliberately much coarser than
/// `watcher::RECONNECT_POLL_INTERVAL` (5s, drive-poll only). Every failed
/// sync attempt currently opens a fresh blocking HTTP call up to its own 15s
/// timeout (`sync.rs`), so retrying every 5s would be wasteful against a
/// genuinely dead connection.
const BASE_INTERVAL: Duration = Duration::from_secs(30);

/// Cap on the backoff — this is a single-DJ desktop agent retrying a REST
/// call, not a distributed system (Dev Notes); a few minutes is plenty.
const MAX_INTERVAL: Duration = Duration::from_secs(300);

/// A small, hand-rolled doubling backoff: increases on a pass that made no
/// sync progress, resets to [`BASE_INTERVAL`] the moment a pass does. No new
/// crate — this codebase's established pattern (Story 3.2's precedent) is
/// small hand-written state machines with unit tests, not a library for a
/// problem this bounded.
struct Backoff {
    current: Duration,
}

impl Backoff {
    fn new() -> Self {
        Self {
            current: BASE_INTERVAL,
        }
    }

    /// The interval to wait before the next attempt.
    fn wait(&self) -> Duration {
        self.current
    }

    /// Call after a pass makes measurable sync progress (or finds nothing
    /// pending at all) — the connection is evidently fine, so the next
    /// attempt goes back to the base cadence rather than staying inflated
    /// from an earlier rough patch.
    fn reset(&mut self) {
        self.current = BASE_INTERVAL;
    }

    /// Call after a pass fails to make any sync progress (a transient
    /// per-row failure, or the pass itself erroring before ever reaching a
    /// row) — doubles the wait, capped at [`MAX_INTERVAL`].
    fn increase(&mut self) {
        self.current = (self.current * 2).min(MAX_INTERVAL);
    }
}

/// Starts the background sync-queue drain loop. Started unconditionally at
/// app launch (mirrors [`crate::watcher::start_watching`]) — a linked-but-
/// idle agent with nothing pending just finds zero rows every pass and stays
/// quiet. Must be called only after `auth::AuthState` and
/// `watcher::DriveConnectionState` are already `app.manage()`d (both read via
/// `AppHandle::state`/`try_state` on the very first loop iteration).
pub fn start_syncing(app: AppHandle) {
    std::thread::spawn(move || sync_loop(app));
}

/// One drain attempt, backed off and looped forever. Opens its own SQLite
/// connection (distinct from `watch_loop`'s long-lived one — `store::open_at`
/// now sets `busy_timeout`/WAL pragmas precisely because this is a second,
/// concurrent connection to the same file) once for the loop's lifetime.
fn sync_loop(app: AppHandle) {
    let Ok(conn) = crate::store::open(&app) else {
        #[cfg(debug_assertions)]
        eprintln!(
            "curfew-agent: could not open local store; sync-queue drain disabled this run \
             (capture/tray still work)"
        );
        return;
    };

    let mut backoff = Backoff::new();
    // Story 3.3's circuit breaker (Task 1): a row that fails
    // `RetryClass::Permanent` once is never attempted again this run — an
    // in-memory set is sufficient (Dev Notes: "a simple per-row skip-list...
    // is sufficient, do not over-engineer"), resetting on a restart is
    // acceptable for a "should never happen" class of error.
    let mut permanently_skipped: HashSet<String> = HashSet::new();

    loop {
        let auth_state = app.state::<crate::auth::AuthState>();
        let token_store = crate::auth::store::KeyringTokenStore;
        let auth_client = crate::auth::client::SupabaseAuthClient::new();
        let sync_client = crate::sync::SupabaseSyncClient::new();

        match crate::sync::sync_pending_sessions(
            &conn,
            &auth_state.tokens,
            &token_store,
            &auth_client,
            &sync_client,
            &permanently_skipped,
        ) {
            Ok(summary) => {
                handle_pass_outcome(&app, &mut backoff, &mut permanently_skipped, summary)
            }
            Err(_e) => {
                // A pass-level failure (most likely `SyncError::Auth`'s
                // network leg failing to reach Supabase to refresh a token —
                // the same "can't reach the host" signal as a per-row `Http`
                // failure) never got as far as attempting a single row.
                // Treated as transient: back off, and show Queued only if
                // there's something a later pass could actually retry.
                #[cfg(debug_assertions)]
                eprintln!("curfew-agent: sync-queue drain pass failed: {_e}");
                backoff.increase();
                if let Some(state) = desired_tray_state(
                    drive_connected(&app),
                    has_retryable_backlog(&conn, &permanently_skipped),
                ) {
                    let _ = crate::tray::set_tray_state(&app, state);
                }
            }
        }

        std::thread::sleep(backoff.wait());
    }
}

/// Applies one successful pass's [`SyncSummary`] to the backoff state, the
/// permanent-failure skip-list, and the tray — split out from [`sync_loop`]
/// so the decision logic is unit-testable without a real `AppHandle`/SQLite
/// connection driving the whole loop.
fn handle_pass_outcome(
    app: &AppHandle,
    backoff: &mut Backoff,
    permanently_skipped: &mut HashSet<String>,
    summary: SyncSummary,
) {
    permanently_skipped.extend(summary.permanent_failure_identities.iter().cloned());

    if summary.failed_transient > 0 {
        backoff.increase();
    } else {
        // Either fully drained, or only permanent-class rows remain (now
        // skip-listed — retrying them at any cadence would never resolve
        // them, Task 1's circuit breaker) — either way there's nothing this
        // loop can still make progress on right now.
        backoff.reset();
    }

    if let Some(state) = desired_tray_state(drive_connected(app), summary.failed_transient > 0) {
        let _ = crate::tray::set_tray_state(app, state);
    }
}

/// Reads the live drive-reachability signal `watch_loop` publishes
/// (`watcher::DriveConnectionState`). Defaults to `true` (assume connected)
/// if the state isn't managed yet — should not happen once `.setup()`
/// completes, but this loop must never panic over a missing `try_state`.
fn drive_connected(app: &AppHandle) -> bool {
    app.try_state::<crate::watcher::DriveConnectionState>()
        .map(|s| s.0.load(std::sync::atomic::Ordering::Relaxed))
        .unwrap_or(true)
}

/// Decides what tray state (if any) this loop should write, given whether
/// the drive is currently reachable and whether this pass left a transient
/// backlog outstanding. Returns `None` when the drive is disconnected:
/// `TrayState::DriveNotConnected` is the more specific, more actionable
/// problem for the DJ and must not be overwritten by this independent loop
/// (Dev Notes precedence rule) — `watch_loop` owns that transition
/// exclusively.
fn desired_tray_state(drive_connected: bool, has_transient_backlog: bool) -> Option<TrayState> {
    if !drive_connected {
        return None;
    }
    Some(if has_transient_backlog {
        TrayState::Queued
    } else {
        TrayState::Idle
    })
}

/// Whether any row eligible for sync is *not* already permanently
/// skip-listed — i.e. something a later pass could still plausibly make
/// progress on. Used only for the pass-level-`Err` branch (no `SyncSummary`
/// to read `failed_transient` off of in that case).
fn has_retryable_backlog(conn: &rusqlite::Connection, skip: &HashSet<String>) -> bool {
    crate::store::rows_pending_sync(conn)
        .map(|rows| rows.iter().any(|row| !skip.contains(&row.session_identity)))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- Backoff -----------------------------------------------------------

    #[test]
    fn backoff_starts_at_the_base_interval() {
        assert_eq!(Backoff::new().wait(), BASE_INTERVAL);
    }

    #[test]
    fn repeated_failures_double_the_wait_up_to_the_cap() {
        let mut backoff = Backoff::new();
        backoff.increase();
        assert_eq!(backoff.wait(), Duration::from_secs(60));
        backoff.increase();
        assert_eq!(backoff.wait(), Duration::from_secs(120));
        backoff.increase();
        assert_eq!(backoff.wait(), Duration::from_secs(240));
        backoff.increase();
        assert_eq!(
            backoff.wait(),
            MAX_INTERVAL,
            "must cap rather than grow unbounded"
        );
        backoff.increase();
        assert_eq!(backoff.wait(), MAX_INTERVAL, "stays capped");
    }

    #[test]
    fn a_success_resets_the_backoff_to_base() {
        let mut backoff = Backoff::new();
        backoff.increase();
        backoff.increase();
        assert_ne!(backoff.wait(), BASE_INTERVAL);

        backoff.reset();
        assert_eq!(backoff.wait(), BASE_INTERVAL);
    }

    // ---- desired_tray_state (Task 2's precedence rule) ----------------------

    #[test]
    fn drive_not_connected_always_wins_regardless_of_backlog() {
        assert_eq!(desired_tray_state(false, true), None);
        assert_eq!(desired_tray_state(false, false), None);
    }

    #[test]
    fn drive_connected_with_a_backlog_shows_queued() {
        assert_eq!(desired_tray_state(true, true), Some(TrayState::Queued));
    }

    #[test]
    fn drive_connected_with_no_backlog_shows_idle() {
        assert_eq!(desired_tray_state(true, false), Some(TrayState::Idle));
    }

    // ---- handle_pass_outcome / has_retryable_backlog ------------------------

    use crate::store::{open_at, upsert_captured, CapturedDerived, CapturedPlay, SessionSource};
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TempStoreFile(std::path::PathBuf);
    impl TempStoreFile {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "curfew_sync_queue_test_{tag}_{}_{n}.sqlite",
                std::process::id()
            ));
            Self(path)
        }
    }
    impl Drop for TempStoreFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn sample_plays() -> Vec<CapturedPlay> {
        vec![CapturedPlay {
            position: 1,
            title: Some("Track A".into()),
            artist: Some("Artist A".into()),
            started_at: Some(1_000),
            bpm: Some(120.0),
            genre: None,
            camelot_key: None,
            in_library: true,
        }]
    }

    fn sample_derived() -> CapturedDerived {
        CapturedDerived {
            most_played_tracks: vec![],
            most_played_artists: vec![],
            genre_breakdown: Default::default(),
            subgenre_breakdown: Default::default(),
            bpm_distribution: Default::default(),
            camelot_mixing_stats: Default::default(),
            set_length_sec: Some(600),
            track_count: 1,
            energy_arc: vec![],
            confidence: crate::store::CapturedConfidence {
                value: 1.0,
                track_count: 1,
                long_gap_count: 0,
            },
        }
    }

    #[test]
    fn has_retryable_backlog_excludes_skip_listed_rows() {
        let file = TempStoreFile::new("backlog");
        let conn = open_at(&file.0).expect("store opens");

        upsert_captured(
            &conn,
            "legacy:only-row",
            SessionSource::Legacy,
            "/sessions/one.session",
            Some(1_000),
            Some(1_600),
            &sample_plays(),
            &sample_derived(),
        )
        .unwrap();

        assert!(has_retryable_backlog(&conn, &HashSet::new()));

        let mut skip = HashSet::new();
        skip.insert("legacy:only-row".to_string());
        assert!(
            !has_retryable_backlog(&conn, &skip),
            "a fully skip-listed backlog has nothing left to retry"
        );
    }

    #[test]
    fn has_retryable_backlog_is_false_with_nothing_pending() {
        let file = TempStoreFile::new("backlog-empty");
        let conn = open_at(&file.0).expect("store opens");
        assert!(!has_retryable_backlog(&conn, &HashSet::new()));
    }
}
