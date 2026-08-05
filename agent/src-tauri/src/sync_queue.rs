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

use crate::sync::{RetryClass, SyncSummary};
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
/// `tray::DriveTrayCoordinator` are already `app.manage()`d (both read via
/// `AppHandle::state`/`try_state` on the very first loop iteration).
pub fn start_syncing(app: AppHandle) {
    std::thread::spawn(move || sync_loop(app));
}

/// Opens the local store, retrying on [`BASE_INTERVAL`] until it succeeds
/// rather than giving up — unlike `watch_loop`, this loop has nothing useful
/// to do without a store connection (there's no drive-detection/tray duty to
/// keep running in the meantime), so silently exiting the thread forever on
/// a transient open failure (e.g. a momentary permissions/disk hiccup at
/// boot) would disable sync-queue drain for the rest of the app session with
/// no recovery. Logged (debug builds only — this can legitimately retry a
/// few times during a slow boot) on every failed attempt.
fn open_store_with_retry(app: &AppHandle) -> rusqlite::Connection {
    loop {
        match crate::store::open(app) {
            Ok(conn) => return conn,
            Err(_e) => {
                #[cfg(debug_assertions)]
                eprintln!(
                    "curfew-agent: could not open local store for sync-queue drain, retrying: {_e}"
                );
                std::thread::sleep(BASE_INTERVAL);
            }
        }
    }
}

/// One drain attempt, backed off and looped forever. Opens its own SQLite
/// connection (distinct from `watch_loop`'s long-lived one — `store::open_at`
/// now sets `busy_timeout`/WAL pragmas precisely because this is a second,
/// concurrent connection to the same file) once for the loop's lifetime.
fn sync_loop(app: AppHandle) {
    let conn = open_store_with_retry(&app);

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
                handle_pass_outcome(&app, &conn, &mut backoff, &mut permanently_skipped, summary)
            }
            Err(e) => {
                // A pass-level failure never got as far as attempting a
                // single row (token refresh, or the DJ-id claim itself is
                // broken — e.g. `SyncError::MalformedDjId`, which Task 1's
                // circuit breaker names explicitly but can only ever occur
                // here, before any row is reachable to skip-list). Classify
                // it the same way a per-row failure is classified: `Http`
                // (can't reach the host) is transient and retried normally;
                // anything else is a logic/data problem retrying will never
                // fix, and is logged loudly (not just debug builds) instead
                // of silently backing off forever indistinguishable from
                // being offline.
                let permanent = e.retry_class() == RetryClass::Permanent;
                if permanent {
                    eprintln!("curfew-agent: sync-queue drain pass failed permanently: {e}");
                } else {
                    #[cfg(debug_assertions)]
                    eprintln!("curfew-agent: sync-queue drain pass failed: {e}");
                }
                backoff.increase();
                if let Some(coordinator) = app.try_state::<crate::tray::DriveTrayCoordinator>() {
                    // Fail-open to `false` on a store read error -- a store
                    // hiccup must not paint every DJ's tray with a
                    // format-drift signal that was never actually detected.
                    let has_format_drift =
                        crate::store::has_unresolved_parse_failures(&conn).unwrap_or(false);
                    let has_transient_backlog = has_retryable_backlog(&conn, &permanently_skipped);
                    let has_permanent_backlog = permanent || !permanently_skipped.is_empty();
                    coordinator.write_if_drive_state(&app, |drive_connected| {
                        desired_tray_state(
                            drive_connected,
                            has_format_drift,
                            has_transient_backlog,
                            has_permanent_backlog,
                        )
                    });
                }
            }
        }

        // Story 3.9 / AD-20 — beat-on-idle, "ride the loop" (Arjun,
        // 2026-08-05). Sits here, once, AFTER both branches above have settled
        // the tray through the coordinator, rather than duplicated inside each
        // of them: one call site cannot drift out of sync with the other or
        // double-beat, and "every drain pass beats exactly once" is then true
        // by construction instead of by inspection.
        //
        // Deliberately NOT deduped against a last-sent state — that is the
        // whole ruling. A fresh `updated_at` is what lets the dashboard tell a
        // live-but-idle agent from a dead one; a fire-on-change beat would
        // freeze the timestamp on exactly the agent that is healthiest.
        //
        // Fire-and-forget: the result is discarded, so nothing about a failed
        // beat can block, fail, or delay set sync. It cannot hot-loop either —
        // it is bounded by this loop's own backoff cadence.
        beat_status(&app);

        std::thread::sleep(backoff.wait());
    }
}

/// Sends one agent-status heartbeat carrying whatever state the tray is
/// showing right now (Story 3.9, AC-1).
///
/// Reads [`crate::tray::current_tray_state`] rather than re-deriving from
/// [`desired_tray_state`] on purpose: the dashboard's promise is "what your
/// agent is doing", the tray *is* that, and only the tray carries
/// `DriveNotConnected` — `desired_tray_state` returns `None` there rather than
/// overwrite `watch_loop`'s more specific state, so re-deriving would report
/// a disconnected drive as whatever the backlog happened to look like.
///
/// Every failure is swallowed (debug-logged only). An unlinked agent has no
/// token and simply cannot beat, which is correct: there is no DJ to report
/// to. Nothing here reads `subscription_status`, and nothing may be added that
/// does (AD-19/AD-20).
fn beat_status(app: &AppHandle) {
    let Some(state) = crate::tray::current_tray_state(app) else {
        return;
    };
    let Some(auth_state) = app.try_state::<crate::auth::AuthState>() else {
        return;
    };

    let _result = crate::heartbeat::beat(
        &auth_state.tokens,
        &crate::auth::store::KeyringTokenStore,
        &crate::auth::client::SupabaseAuthClient::new(),
        &crate::heartbeat::SupabaseStatusClient::new(),
        state,
    );

    #[cfg(debug_assertions)]
    if let Err(_e) = _result {
        // Debug-only: an offline agent beats-and-fails every pass by design,
        // so this must never be a loud log the way a permanent sync failure is.
        eprintln!("curfew-agent: agent-status heartbeat failed (ignored): {_e}");
    }
}

/// Applies one successful pass's [`SyncSummary`] to the backoff state, the
/// permanent-failure skip-list, and the tray — split out from [`sync_loop`]
/// so the decision logic is unit-testable without a real `AppHandle`/SQLite
/// connection driving the whole loop. `conn` is read-only here (Story 3.4,
/// Task 4): only to check `store::has_unresolved_parse_failures` for the
/// tray-precedence decision.
fn handle_pass_outcome(
    app: &AppHandle,
    conn: &rusqlite::Connection,
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

    if let Some(coordinator) = app.try_state::<crate::tray::DriveTrayCoordinator>() {
        // Fail-open to `false` on a store read error, same reasoning as
        // `sync_loop`'s pass-level-`Err` branch above.
        let has_format_drift = crate::store::has_unresolved_parse_failures(conn).unwrap_or(false);
        let has_transient_backlog = summary.failed_transient > 0;
        let has_permanent_backlog = !permanently_skipped.is_empty();
        coordinator.write_if_drive_state(app, |drive_connected| {
            desired_tray_state(
                drive_connected,
                has_format_drift,
                has_transient_backlog,
                has_permanent_backlog,
            )
        });
    }
}

/// Decides what tray state (if any) this loop should write, given the
/// current drive-connectivity signal, whether format drift is suspected
/// (Story 3.4, Task 4), and whether this pass left a backlog outstanding.
/// `drive_connected` is a tri-state: `None` (not yet classified by
/// `watch_loop`'s first tick) is treated the same as `Some(false)` — skip
/// writing rather than assume connectivity. Returns `None` whenever the
/// drive isn't known-connected: `TrayState::DriveNotConnected` is the more
/// specific, more actionable problem for the DJ and must not be overwritten
/// by this independent loop (Dev Notes precedence rule) — `watch_loop` owns
/// that transition exclusively.
///
/// `has_format_drift` is checked next, ahead of both backlog flags — a
/// disconnected drive still wins over it (the more urgent, more actionable
/// problem), but once the drive is known-connected, a suspected format
/// change is surfaced before an ordinary sync backlog, since it's the
/// signal a DJ is most likely to want to act on (or simply wait out until a
/// fix ships and the backfill sweep clears it). A backlog that will never
/// clear on its own (`has_permanent_backlog`, e.g. a `SetIdMismatch`) shows
/// `Failed` rather than `Idle` once nothing transient remains, so a
/// permanently-stuck set stays visible to the DJ instead of looking
/// identical to "fully synced."
fn desired_tray_state(
    drive_connected: Option<bool>,
    has_format_drift: bool,
    has_transient_backlog: bool,
    has_permanent_backlog: bool,
) -> Option<TrayState> {
    if drive_connected != Some(true) {
        return None;
    }
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

    // ---- desired_tray_state (Task 2/4's precedence rule) --------------------

    #[test]
    fn drive_not_connected_always_wins_regardless_of_backlog() {
        assert_eq!(desired_tray_state(Some(false), false, true, false), None);
        assert_eq!(desired_tray_state(Some(false), false, false, true), None);
    }

    #[test]
    fn drive_not_yet_classified_is_treated_like_disconnected() {
        assert_eq!(
            desired_tray_state(None, false, true, false),
            None,
            "must not assume connectivity before watch_loop's first classification tick"
        );
    }

    #[test]
    fn drive_connected_with_a_transient_backlog_shows_queued() {
        assert_eq!(
            desired_tray_state(Some(true), false, true, false),
            Some(TrayState::Queued)
        );
    }

    #[test]
    fn drive_connected_with_no_backlog_shows_idle() {
        assert_eq!(
            desired_tray_state(Some(true), false, false, false),
            Some(TrayState::Idle)
        );
    }

    #[test]
    fn drive_connected_with_only_permanent_backlog_shows_failed() {
        assert_eq!(
            desired_tray_state(Some(true), false, false, true),
            Some(TrayState::Failed),
            "a permanently-stuck set must stay visible, not look identical to fully synced"
        );
    }

    #[test]
    fn transient_backlog_takes_precedence_over_permanent() {
        assert_eq!(
            desired_tray_state(Some(true), false, true, true),
            Some(TrayState::Queued)
        );
    }

    #[test]
    fn drive_not_connected_wins_over_format_drift_too() {
        assert_eq!(
            desired_tray_state(Some(false), true, false, false),
            None,
            "a disconnected drive is still the more urgent, more actionable problem"
        );
    }

    #[test]
    fn format_drift_outranks_both_backlog_flags() {
        assert_eq!(
            desired_tray_state(Some(true), true, true, true),
            Some(TrayState::FormatDriftPaused),
            "format drift must be surfaced ahead of an ordinary sync backlog"
        );
        assert_eq!(
            desired_tray_state(Some(true), true, false, false),
            Some(TrayState::FormatDriftPaused)
        );
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
            played_ms: None,
            library_added_at: None,
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
