//! Startup backfill/reprocess sweep (Story 3.4, Task 3, AR-7 layer 3): the
//! third of format-drift's three defense layers — golden-file CI (layer 1)
//! catches drift before release, tagged error reporting (layer 2,
//! [`crate::error_reporting`]) makes drift visible after release, and this
//! layer is what actually recovers a session once a fix ships, from the raw
//! data retained in local SQLite (never deleted on a capture failure — see
//! [`crate::store::record_parse_failure`]'s doc comment).
//!
//! **Keyed on `agent_version` change, not an explicit "retry now" trigger**
//! (see the story's own Dev Notes for the full reasoning): a row only gets
//! retried once the agent has actually restarted on a build newer than the
//! one that recorded the failure — retrying under the identical build that
//! already failed it would just fail again identically and re-spam Sentry
//! for no new information. Combined with the auto-updater loop
//! ([`crate::lib`]'s `updater_loop`, Task 5) restarting the agent on a new
//! version, this makes the whole recovery loop self-driving with no
//! cross-run signaling needed.

use std::path::Path;

use rusqlite::Connection;

use crate::error_reporting::ErrorReporter;
use crate::store::SessionSource;
use crate::watcher::detect::WatchPlan;

/// Retries every unresolved `parse_failures` row against the current build.
/// Reuses [`crate::watcher::capture_and_store_serato4`]/`_legacy` as-is
/// rather than re-implementing capture logic: on success they already call
/// `store::upsert_captured` (feeding Story 3.2's sync queue automatically)
/// and, on continued failure, already re-call `record_parse_failure` with
/// the *new* `agent_version` — this function's only remaining job is
/// clearing the ledger row once a reprocess attempt actually succeeds.
pub fn reprocess_parse_failures(
    store_conn: &Connection,
    plan: &WatchPlan,
    reporter: &dyn ErrorReporter,
) {
    let Ok(rows) = crate::store::unresolved_parse_failures(store_conn) else {
        return;
    };

    for row in rows {
        if row.failed_agent_version == crate::config::AGENT_VERSION {
            // Same build that already failed it -- retrying now would just
            // fail again identically. Only a version bump makes a retry
            // worth attempting (see module doc comment).
            continue;
        }

        let succeeded = match row.source {
            SessionSource::Serato4 => {
                let Some(source) = &plan.serato4 else {
                    // No serato4 source currently configured -- nothing to
                    // reprocess against. Left untouched, not treated as
                    // resolved.
                    continue;
                };
                let Some(session_id) = crate::capture::parse_serato4_raw_ref(&row.raw_ref) else {
                    continue;
                };
                crate::watcher::capture_and_store_serato4(
                    store_conn,
                    &source.root,
                    &source.db_path,
                    session_id,
                    reporter,
                )
            }
            SessionSource::Legacy => {
                let Some(source) = &plan.legacy else {
                    continue;
                };
                crate::watcher::capture_and_store_legacy(
                    store_conn,
                    &source.library_root,
                    Path::new(&row.raw_ref),
                    &row.session_identity,
                    reporter,
                )
            }
        };

        if succeeded {
            crate::store::clear_parse_failure(store_conn, &row.session_identity).ok();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watcher::detect::Serato4Source;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "curfew-backfill-test-{tag}-{}-{n}",
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

    struct NoopReporter;
    impl ErrorReporter for NoopReporter {
        fn report(&self, _context: &str, _agent_version: &str, _message: &str) {}
    }

    /// A real on-disk `master.sqlite` fixture carrying one `history_entry`
    /// row -- mirrors `watcher::mod`'s own test fixture builder.
    fn write_serato4_fixture(dir: &Path, session_id: i64, start: i64) -> std::path::PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let db_path = dir.join("master.sqlite");
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            r#"CREATE TABLE history_entry (
                   id INTEGER PRIMARY KEY, session_id INTEGER, name TEXT, artist TEXT,
                   genre TEXT, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT
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

    /// (a) A row whose `failed_agent_version` equals the current build's is
    /// left untouched -- not retried, not cleared.
    #[test]
    fn a_row_on_the_current_version_is_left_untouched() {
        let store_dir = TempDir::new("same-version-store");
        let store_conn = crate::store::open_at(&store_dir.0.join("local.sqlite")).unwrap();

        crate::store::record_parse_failure(
            &store_conn,
            "serato4:404",
            SessionSource::Serato4,
            "/nonexistent/master.sqlite#404",
            crate::config::AGENT_VERSION,
            "some past failure",
        )
        .unwrap();

        let empty_plan = WatchPlan {
            serato4: None,
            legacy: None,
        };
        reprocess_parse_failures(&store_conn, &empty_plan, &NoopReporter);

        assert_eq!(
            crate::store::unresolved_parse_failures(&store_conn)
                .unwrap()
                .len(),
            1,
            "a row on the current build's version must not be retried"
        );
    }

    /// (b) A row on an older version, reprocessed against a fixture that now
    /// parses successfully, is cleared from `parse_failures` and lands as a
    /// `captured` row in `captured_sessions`.
    #[test]
    fn a_row_on_an_older_version_that_now_succeeds_is_cleared_and_captured() {
        let store_dir = TempDir::new("older-version-succeeds-store");
        let store_conn = crate::store::open_at(&store_dir.0.join("local.sqlite")).unwrap();

        let serato4_dir = TempDir::new("older-version-succeeds-serato4");
        let db_path = write_serato4_fixture(&serato4_dir.0, 42, 1_000);

        let identity = crate::capture::serato4_session_identity(42);
        let raw_ref = crate::capture::serato4_raw_ref(&db_path, 42);
        crate::store::record_parse_failure(
            &store_conn,
            &identity,
            SessionSource::Serato4,
            &raw_ref,
            "0.0.0-older",
            "previously failed to parse",
        )
        .unwrap();

        let plan = WatchPlan {
            serato4: Some(Serato4Source {
                root: serato4_dir.0.clone(),
                db_path,
            }),
            legacy: None,
        };

        reprocess_parse_failures(&store_conn, &plan, &NoopReporter);

        assert!(
            crate::store::unresolved_parse_failures(&store_conn)
                .unwrap()
                .is_empty(),
            "a now-successful reprocess must clear the ledger row"
        );
        assert_eq!(
            crate::store::status_of(&store_conn, &identity).unwrap(),
            Some(crate::store::SessionStatus::Captured)
        );
    }

    /// (c) A row that still fails on reprocess stays in `parse_failures`,
    /// now stamped with the new `agent_version` and a fresh `last_error`.
    #[test]
    fn a_row_that_still_fails_stays_in_the_ledger_restamped_with_the_new_version() {
        let store_dir = TempDir::new("still-fails-store");
        let store_conn = crate::store::open_at(&store_dir.0.join("local.sqlite")).unwrap();

        // A serato4 source configured, but `db_path` names a file that was
        // never created -- `open_read_only` genuinely fails (a real error,
        // not `CaptureError::EmptySession`), so `build_serato4` fails again
        // on reprocess exactly as it did the first time.
        let serato4_dir = TempDir::new("still-fails-serato4");
        let db_path = serato4_dir.0.join("master.sqlite");

        let identity = crate::capture::serato4_session_identity(999);
        let raw_ref = crate::capture::serato4_raw_ref(&db_path, 999);
        crate::store::record_parse_failure(
            &store_conn,
            &identity,
            SessionSource::Serato4,
            &raw_ref,
            "0.0.0-older",
            "previously failed to parse",
        )
        .unwrap();

        let plan = WatchPlan {
            serato4: Some(Serato4Source {
                root: db_path.clone(),
                db_path,
            }),
            legacy: None,
        };

        reprocess_parse_failures(&store_conn, &plan, &NoopReporter);

        let rows = crate::store::unresolved_parse_failures(&store_conn).unwrap();
        assert_eq!(rows.len(), 1, "a still-failing row must stay in the ledger");
        assert_eq!(rows[0].failed_agent_version, crate::config::AGENT_VERSION);
    }

    /// (d) A row whose source is no longer present in the current
    /// `WatchPlan` (e.g. legacy source removed) is left untouched, not
    /// treated as resolved.
    #[test]
    fn a_row_whose_source_is_no_longer_in_the_watch_plan_is_left_untouched() {
        let store_dir = TempDir::new("source-removed-store");
        let store_conn = crate::store::open_at(&store_dir.0.join("local.sqlite")).unwrap();

        crate::store::record_parse_failure(
            &store_conn,
            "legacy:gone",
            SessionSource::Legacy,
            "/sessions/gone.session",
            "0.0.0-older",
            "previously failed to parse",
        )
        .unwrap();

        let plan = WatchPlan {
            serato4: None,
            legacy: None, // the legacy source this row belonged to is gone
        };

        reprocess_parse_failures(&store_conn, &plan, &NoopReporter);

        assert_eq!(
            crate::store::unresolved_parse_failures(&store_conn)
                .unwrap()
                .len(),
            1,
            "a row whose source vanished from the watch plan must not be treated as resolved"
        );
    }
}
