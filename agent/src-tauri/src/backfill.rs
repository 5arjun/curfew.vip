//! Startup backfill/reprocess sweep (Story 3.4, Task 3, AR-7 layer 3): the
//! third of format-drift's three defense layers — golden-file CI (layer 1)
//! catches drift before release, tagged error reporting (layer 2,
//! [`crate::error_reporting`]) makes drift visible after release, and this
//! layer is what actually recovers a session once a fix ships, from the raw
//! data retained in local SQLite (never deleted on a capture failure — see
//! [`crate::store::record_parse_failure`]'s doc comment).
//!
//! Two entry points share this file's retained-raw philosophy:
//! - [`reprocess_parse_failures`] recovers sessions that *failed* to parse, once
//!   a newer build ships (keyed on `agent_version`, see below).
//! - [`backfill_captured_serato4`] re-derives sessions that captured
//!   *successfully but with now-known-wrong stats* (Story 3.6's Camelot fix),
//!   overwriting their derived stats from the same retained raw and re-queuing
//!   the corrected rows for cloud sync. Self-terminating (only changed rows are
//!   touched); skips a source that is currently unreachable.
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
use crate::store::{SessionSource, SessionStatus};
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
    dates: &crate::joiner::date_added::DateAddedIndex,
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
                    // A malformed `raw_ref` (external DB corruption -- this
                    // agent only ever writes well-formed ones) never reaches
                    // `capture_and_store_serato4`, so unlike every other
                    // continued-failure path it would otherwise never
                    // restamp `failed_agent_version` or report to Sentry --
                    // silently retrying on *every* startup forever instead
                    // of just after a version bump (Story 3.4 review).
                    let message =
                        format!("backfill: unparseable serato4 raw_ref {:?}", row.raw_ref);
                    crate::watcher::log_store_err(
                        "record_parse_failure (backfill, unparseable raw_ref)",
                        crate::store::record_parse_failure(
                            store_conn,
                            &row.session_identity,
                            SessionSource::Serato4,
                            &row.raw_ref,
                            crate::config::AGENT_VERSION,
                            &message,
                        ),
                    );
                    reporter.report(
                        "backfill serato4 raw_ref",
                        crate::config::AGENT_VERSION,
                        &message,
                    );
                    continue;
                };
                crate::watcher::capture_and_store_serato4(
                    store_conn,
                    &source.root,
                    &source.db_path,
                    session_id,
                    dates,
                    reporter,
                )
            }
            SessionSource::Legacy => {
                let Some(source) = &plan.legacy else {
                    continue;
                };
                // Re-resolve against the *current* `serato_dir`, not the
                // absolute path recorded at original-failure time -- mirrors
                // the Serato4 arm re-deriving from the current `WatchPlan`
                // rather than trusting a possibly-stale stored location. A
                // drive remount/relabel changes `serato_dir`'s parent but
                // not a session file's name or its `History/Sessions`
                // position underneath it (Story 3.4 review, decision 3).
                let Some(file_name) = Path::new(&row.raw_ref).file_name() else {
                    continue;
                };
                let session_path = source
                    .serato_dir
                    .join("History")
                    .join("Sessions")
                    .join(file_name);
                crate::watcher::capture_and_store_legacy(
                    store_conn,
                    &source.library_root,
                    &session_path,
                    &row.session_identity,
                    reporter,
                )
            }
        };

        if succeeded {
            crate::watcher::log_store_err(
                "clear_parse_failure (backfill)",
                crate::store::clear_parse_failure(store_conn, &row.session_identity),
            );
        }
    }
}

/// Re-derives every already-`captured` **Serato 4+** session from its retained
/// raw (the live `master.sqlite#<session_id>`) through the *current* joiner +
/// stat engine, and — for any row whose derived data actually **changed** —
/// overwrites `plays_json`/`derived_json` in place AND re-queues it for cloud
/// sync. This is how a shipped stat-correctness fix reaches sessions captured
/// *before* the fix, on every device: the same retained-raw recovery mechanism
/// as [`reprocess_parse_failures`] (AR-7 layer 3), applied to `captured` rows.
///
/// Story 3.6 is the first caller: the Camelot `key_value` recovery corrected
/// ~88% of dropped keys, so the ~491 historical local sets must be re-derived
/// (verified against set 975: 21/178 → ~177/178 keys). It reuses Story 3.4's
/// retained-raw re-derivation core ([`crate::capture::build_serato4`] +
/// [`crate::store::upsert_captured`]), never a parallel pipeline.
///
/// **Corrects the cloud too, not just local (Arjun 2026-08-02).** The Story 3.6
/// premise that "`synced_at` is NULL for all rows" turned out false — every
/// captured row already carries a `synced_at` from Stories 3.2/3.3, so the cloud
/// held the *old* keys. Arjun's ruling: all data lives in the cloud so the
/// dashboard reads the same on every device. So a re-derivation that changes a
/// row clears its `synced_at` ([`crate::store::mark_for_resync`]); the existing
/// sync-queue drain loop then re-pushes it, and Story 3.2's `external_id`
/// idempotency updates the existing cloud row rather than duplicating it.
///
/// **Self-terminating.** This runs on every startup, so it MUST NOT re-sync
/// unchanged rows forever. It compares the freshly-derived `plays_json`/
/// `derived_json` against what is stored and only writes + re-queues on a real
/// difference. After the first corrective pass, subsequent runs derive identical
/// data, change nothing, and re-queue nothing.
///
/// **Safe when the source is gone.** Runs only when a Serato 4+ source is
/// currently configured (`plan.serato4`); with the drive unplugged there is
/// nothing to re-derive against, so every row is left untouched (mirrors
/// [`reprocess_parse_failures`]). A `session_id` that no longer exists in the
/// live `master.sqlite`, or any other re-derivation error, leaves that row
/// as-is rather than corrupting it. **Legacy** captured rows are not this fix's
/// concern (the incident is serato4-only) and are left untouched.
///
/// Returns the number of rows whose data actually changed (written + re-queued).
pub fn backfill_captured_serato4(
    store_conn: &Connection,
    plan: &WatchPlan,
    dates: &crate::joiner::date_added::DateAddedIndex,
    reporter: &dyn ErrorReporter,
) -> usize {
    let Some(source) = &plan.serato4 else {
        // No serato4 source configured (e.g. the library drive is unplugged) —
        // nothing to re-derive against; leave every row untouched.
        return 0;
    };
    let rows = match crate::store::rows_with_status(store_conn, SessionStatus::Captured) {
        Ok(rows) => rows,
        Err(e) => {
            reporter.report(
                "serato4 backfill: rows_with_status query failed",
                crate::config::AGENT_VERSION,
                &e.to_string(),
            );
            return 0;
        }
    };

    // Story 5.2 (D-23/D-25): the calibration pool, computed ONCE for the whole
    // sweep and sliced per session into a chronological prefix. Re-reading it per
    // row would make a 491-session cold upgrade O(n²) over the entire store, for
    // an answer that cannot change during the pass — every row here re-derives
    // from the same retained raw, and the pool is built from `plays_json`, which
    // this loop only ever rewrites to an equal or corrected value.
    //
    // This story's new derived fields also change `derived_json` for every
    // captured row, so the changed-row comparison below re-queues the whole local
    // history for sync on the next launch. That IS the rollout mechanism (D-25) —
    // there is deliberately no second one.
    let pool = crate::capture::load_calibration_pool(store_conn);

    let mut changed = 0;
    for row in rows {
        if row.source != SessionSource::Serato4 {
            continue;
        }
        let Some(session_id) = crate::capture::parse_serato4_raw_ref(&row.raw_ref) else {
            continue;
        };

        // Re-derive against the *currently configured* live master.sqlite (the
        // session id is Serato's own stable key), rather than the raw_ref's
        // possibly-stale db_path — the scope check in `open_read_only` needs the
        // db_path to sit under the configured root, which the live source
        // guarantees. Any error (source gone, session pruned, corrupt row) leaves
        // the existing row untouched.
        let (mut plays, derived) = match crate::capture::build_serato4(
            &source.root,
            &source.db_path,
            session_id,
            dates,
            &pool,
        ) {
            Ok(built) => built,
            // Distinct from every other re-derivation error (Story 3.7 code
            // review): this session re-derived successfully but the played-flag
            // filter dropped every row, so it is genuinely different from
            // "source gone / corrupt row" — worth a signal if it ever fires,
            // even though the row is left untouched the same way either way.
            Err(crate::capture::CaptureError::AllPreviews) => {
                reporter.report(
                    "serato4 backfill: session re-derived to zero real plays",
                    crate::config::AGENT_VERSION,
                    &format!(
                        "session_identity={} re-derived with every row now a preview \
                         (Story 3.7 played-flag filter) — left as-is",
                        row.session_identity
                    ),
                );
                continue;
            }
            Err(_) => continue,
        };

        // Story 3.7 carry-forward guard: `library_added_at` coverage depends on
        // which volumes are mounted right now (`date_added`'s module doc), so a
        // sweep run with the USB unplugged would re-derive dates an earlier run
        // resolved down to `None` — rewriting and re-syncing 491 sets on every
        // plug/unplug cycle, and losing real data both ways. A date this store
        // already holds for the same play (matched on start_time + title, which
        // are stable across re-derivations of the same raw) is therefore kept
        // whenever the fresh derivation has none. Fresh `Some` values still win.
        carry_forward_library_dates(row.plays_json.as_deref(), &mut plays);

        let (Ok(plays_json), Ok(derived_json)) = (
            serde_json::to_string(&plays),
            serde_json::to_string(&derived),
        ) else {
            continue;
        };

        // Only touch a row whose derived data actually changed — keeps this
        // startup sweep from re-syncing every set on every launch.
        let unchanged = row.plays_json.as_deref() == Some(plays_json.as_str())
            && row.derived_json.as_deref() == Some(derived_json.as_str());
        if unchanged {
            continue;
        }

        let (started_at, ended_at) = crate::capture::session_bounds(&plays);
        if let Err(e) = crate::store::upsert_captured(
            store_conn,
            &row.session_identity,
            SessionSource::Serato4,
            &row.raw_ref,
            started_at,
            ended_at,
            &plays,
            &derived,
        ) {
            #[cfg(debug_assertions)]
            eprintln!("curfew-agent: backfill store write failed for {session_id}: {e}");
            reporter.report(
                "serato4 backfill store write",
                crate::config::AGENT_VERSION,
                &e.to_string(),
            );
            continue;
        }
        // The local copy is corrected; clear synced_at so the drain loop pushes
        // the correction to the cloud (idempotent by external_id, Story 3.2).
        if let Err(e) = crate::store::mark_for_resync(store_conn, &row.session_identity) {
            reporter.report(
                "serato4 backfill: mark_for_resync failed after a successful write",
                crate::config::AGENT_VERSION,
                &e.to_string(),
            );
        }
        changed += 1;
    }
    changed
}

/// Merges stored `library_added_at` values into a fresh re-derivation wherever
/// the fresh pass resolved none — the no-data-loss half of the Story 3.7
/// backfill (see the call site's comment for the plug/unplug churn this
/// prevents). Matching is by `(started_at, title)`: both come verbatim from the
/// same retained raw on every derivation, so they are stable where `position`
/// is not (the Story 3.7 played-flag filter renumbers positions relative to
/// pre-3.7 stored rows). Unparseable/absent stored JSON is a no-op — there is
/// nothing to carry.
///
/// **Collision guard (Story 3.7 code review):** two stored plays can share the
/// same `(started_at, title)` key (most commonly both `None`/`None` — a play
/// missing both fields — but any genuine duplicate qualifies too). If they
/// disagree on `library_added_at`, picking either one risks silently carrying
/// the wrong date onto an unrelated fresh play, so a colliding key with
/// disagreeing dates is treated as unknown (never guessed, AD-11) rather than
/// resolved to whichever value happened to be seen last.
fn carry_forward_library_dates(
    stored_plays_json: Option<&str>,
    fresh: &mut [crate::store::CapturedPlay],
) {
    let Some(json) = stored_plays_json else {
        return;
    };
    let Ok(stored) = serde_json::from_str::<Vec<crate::store::CapturedPlay>>(json) else {
        return;
    };

    let mut known: std::collections::HashMap<(Option<u32>, Option<&str>), Option<i64>> =
        std::collections::HashMap::new();
    for p in &stored {
        let Some(date) = p.library_added_at else {
            continue;
        };
        let key = (p.started_at, p.title.as_deref());
        known
            .entry(key)
            .and_modify(|existing| {
                if *existing != Some(date) {
                    *existing = None;
                }
            })
            .or_insert(Some(date));
    }
    if known.values().all(Option::is_none) {
        return;
    }

    for play in fresh.iter_mut() {
        if play.library_added_at.is_none() {
            play.library_added_at = known
                .get(&(play.started_at, play.title.as_deref()))
                .copied()
                .flatten();
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

    /// A filesystem-free, empty date-added index — the "no catalogue
    /// reachable" case every backfill test runs under unless it says otherwise.
    fn no_dates() -> crate::joiner::date_added::DateAddedIndex {
        crate::joiner::date_added::DateAddedIndex::fixed(std::collections::HashMap::new())
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
        reprocess_parse_failures(&store_conn, &empty_plan, &no_dates(), &NoopReporter);

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

        reprocess_parse_failures(&store_conn, &plan, &no_dates(), &NoopReporter);

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

        reprocess_parse_failures(&store_conn, &plan, &no_dates(), &NoopReporter);

        let rows = crate::store::unresolved_parse_failures(&store_conn).unwrap();
        assert_eq!(rows.len(), 1, "a still-failing row must stay in the ledger");
        assert_eq!(rows[0].failed_agent_version, crate::config::AGENT_VERSION);
        assert_ne!(
            rows[0].last_error, "previously failed to parse",
            "a still-failing row must be restamped with a fresh last_error from THIS attempt, \
             not left carrying the original failure's message"
        );
    }

    /// A serato4 fixture whose one play carries a `key_value` INTEGER (Serato's
    /// source of truth) alongside a *musical* free-text `"key"` the old parser
    /// would have dropped — so a re-derivation must recover the Camelot key from
    /// `key_value`, proving the Story 3.6 fix actually reaches historical rows.
    fn write_serato4_fixture_with_key_value(
        dir: &Path,
        session_id: i64,
        key_value: i64,
        free_text_key: &str,
        start: i64,
    ) -> std::path::PathBuf {
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
            r#"INSERT INTO history_entry
                   (session_id, name, artist, genre, key_value, "key", bpm, start_time, deck)
               VALUES (?1, 'Track', 'Artist', 'House', ?2, ?3, 120.0, ?4, '1')"#,
            rusqlite::params![session_id, key_value, free_text_key, start],
        )
        .unwrap();
        db_path
    }

    /// Story 3.6 (the whole point of the captured-backfill): a captured serato4
    /// row that predates the Camelot fix — carrying stale `derived_json` and
    /// already flagged `synced_at` — is re-derived in place from its retained raw
    /// so it now carries the correct `key_value`-recovered Camelot key, AND its
    /// `synced_at` is cleared so the correction re-syncs to the cloud (Arjun
    /// 2026-08-02: all data lives in the cloud, device-independent).
    #[test]
    fn backfill_re_derives_a_changed_row_and_queues_it_for_resync() {
        let store_dir = TempDir::new("backfill-captured-store");
        let store_conn = crate::store::open_at(&store_dir.0.join("local.sqlite")).unwrap();

        let serato4_dir = TempDir::new("backfill-captured-serato4");
        // key_value 0 -> Camelot "1A"; the free-text "G#m" is the musical notation
        // the pre-fix path dropped to None.
        let db_path = write_serato4_fixture_with_key_value(&serato4_dir.0, 42, 0, "G#m", 1_000);

        let identity = crate::capture::serato4_session_identity(42);
        let raw_ref = crate::capture::serato4_raw_ref(&db_path, 42);
        // A pre-fix captured row: stale derived, already synced.
        store_conn
            .execute(
                r#"INSERT INTO captured_sessions
                       (session_identity, source, status, raw_ref, started_at, ended_at,
                        captured_at, plays_json, derived_json, synced_at)
                   VALUES (?1, 'serato4', 'captured', ?2, 1000, 1000, 1000, '[]',
                           '{"stale":true}', 555)"#,
                rusqlite::params![identity, raw_ref],
            )
            .unwrap();

        let plan = WatchPlan {
            serato4: Some(Serato4Source {
                root: serato4_dir.0.clone(),
                db_path,
            }),
            legacy: None,
        };

        let changed = backfill_captured_serato4(&store_conn, &plan, &no_dates(), &NoopReporter);
        assert_eq!(
            changed, 1,
            "the one captured serato4 row changed and was re-derived"
        );

        let row = crate::store::get_by_identity(&store_conn, &identity)
            .unwrap()
            .expect("row still exists");
        // The stale derived is gone, replaced by a real re-derivation.
        assert!(
            !row.derived_json.as_deref().unwrap().contains("stale"),
            "stale derived_json must be overwritten"
        );
        // The recovered Camelot key ("1A", from key_value 0) is on the play — the
        // musical free-text "G#m" did NOT win.
        assert!(
            row.plays_json
                .as_deref()
                .unwrap()
                .contains("\"camelot_key\":\"1A\""),
            "re-derived play must carry the key_value-recovered Camelot key, got: {:?}",
            row.plays_json
        );
        // synced_at cleared → the corrected row re-syncs to the cloud.
        assert_eq!(
            row.synced_at, None,
            "a changed row must have synced_at cleared so the correction re-syncs"
        );
    }

    /// Self-terminating guard: a row already carrying the correct re-derived data
    /// (identical `plays_json`/`derived_json`) is NOT rewritten and NOT re-queued
    /// — its `synced_at` stays put — so this startup sweep does not re-sync every
    /// set on every launch once the corrective pass has run.
    #[test]
    fn backfill_leaves_an_already_correct_row_alone_no_needless_resync() {
        let store_dir = TempDir::new("backfill-unchanged-store");
        let store_conn = crate::store::open_at(&store_dir.0.join("local.sqlite")).unwrap();

        let serato4_dir = TempDir::new("backfill-unchanged-serato4");
        let db_path = write_serato4_fixture_with_key_value(&serato4_dir.0, 42, 0, "G#m", 1_000);

        let identity = crate::capture::serato4_session_identity(42);
        // Store the row with the EXACT data the backfill would derive, then flag it synced.
        let (plays, derived) = crate::capture::build_serato4(
            &serato4_dir.0,
            &db_path,
            42,
            &no_dates(),
            &crate::stats::segments::CalibrationPool::default(),
        )
        .expect("derive");
        let (started_at, ended_at) = crate::capture::session_bounds(&plays);
        crate::store::upsert_captured(
            &store_conn,
            &identity,
            SessionSource::Serato4,
            &crate::capture::serato4_raw_ref(&db_path, 42),
            started_at,
            ended_at,
            &plays,
            &derived,
        )
        .unwrap();
        store_conn
            .execute(
                "UPDATE captured_sessions SET synced_at = 777 WHERE session_identity = ?1",
                rusqlite::params![identity],
            )
            .unwrap();

        let plan = WatchPlan {
            serato4: Some(Serato4Source {
                root: serato4_dir.0.clone(),
                db_path,
            }),
            legacy: None,
        };

        let changed = backfill_captured_serato4(&store_conn, &plan, &no_dates(), &NoopReporter);
        assert_eq!(changed, 0, "an already-correct row must not be rewritten");

        let row = crate::store::get_by_identity(&store_conn, &identity)
            .unwrap()
            .unwrap();
        assert_eq!(
            row.synced_at,
            Some(777),
            "an unchanged row must keep its synced_at (no needless re-sync)"
        );
    }

    /// A serato4 fixture whose one play carries a `portable_id` — the join key
    /// for the Story 3.7 date-added lookup.
    fn write_serato4_fixture_with_portable_id(
        dir: &Path,
        session_id: i64,
        portable_id: &str,
        start: i64,
    ) -> std::path::PathBuf {
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
            r#"INSERT INTO history_entry (session_id, name, artist, bpm, start_time, portable_id)
               VALUES (?1, 'Track', 'Artist', 120.0, ?2, ?3)"#,
            rusqlite::params![session_id, start, portable_id],
        )
        .unwrap();
        db_path
    }

    /// Story 3.7 carry-forward guard, the churn half: a row whose stored plays
    /// already carry a `library_added_at` is re-derived under an EMPTY date
    /// index (the USB-unplugged case) — the stored date must be carried
    /// forward, making the re-derivation identical, so the row is neither
    /// rewritten nor re-queued. Without the guard, every plug/unplug cycle
    /// would flip 491 rows between dated and dateless and re-sync them all.
    #[test]
    fn backfill_carries_stored_dates_forward_when_no_catalogue_is_reachable() {
        let store_dir = TempDir::new("backfill-carry-store");
        let store_conn = crate::store::open_at(&store_dir.0.join("local.sqlite")).unwrap();

        let serato4_dir = TempDir::new("backfill-carry-serato4");
        let db_path = write_serato4_fixture_with_portable_id(
            &serato4_dir.0,
            42,
            "Users/arjun/Music/dated.mp3",
            1_000,
        );

        // First derivation under a reachable "catalogue" (fixed index) — the
        // stored row carries the date.
        let with_dates =
            crate::joiner::date_added::DateAddedIndex::fixed(std::collections::HashMap::from([(
                "Users/arjun/Music/dated.mp3".to_string(),
                1_644_628_114,
            )]));
        let identity = crate::capture::serato4_session_identity(42);
        let (plays, derived) = crate::capture::build_serato4(
            &serato4_dir.0,
            &db_path,
            42,
            &with_dates,
            &crate::stats::segments::CalibrationPool::default(),
        )
        .expect("derive with dates");
        assert_eq!(plays[0].library_added_at, Some(1_644_628_114));
        let (started_at, ended_at) = crate::capture::session_bounds(&plays);
        crate::store::upsert_captured(
            &store_conn,
            &identity,
            SessionSource::Serato4,
            &crate::capture::serato4_raw_ref(&db_path, 42),
            started_at,
            ended_at,
            &plays,
            &derived,
        )
        .unwrap();
        store_conn
            .execute(
                "UPDATE captured_sessions SET synced_at = 777 WHERE session_identity = ?1",
                rusqlite::params![identity],
            )
            .unwrap();

        // Second sweep: the catalogue is gone (empty index). The stored date
        // must survive and the row must be left untouched — no rewrite, no
        // re-sync.
        let plan = WatchPlan {
            serato4: Some(Serato4Source {
                root: serato4_dir.0.clone(),
                db_path,
            }),
            legacy: None,
        };
        let changed = backfill_captured_serato4(&store_conn, &plan, &no_dates(), &NoopReporter);

        assert_eq!(
            changed, 0,
            "losing catalogue reachability must not count as a data change"
        );
        let row = crate::store::get_by_identity(&store_conn, &identity)
            .unwrap()
            .unwrap();
        assert!(
            row.plays_json
                .as_deref()
                .unwrap()
                .contains("\"library_added_at\":1644628114"),
            "the stored date must survive an unreachable-catalogue sweep"
        );
        assert_eq!(row.synced_at, Some(777), "no needless re-sync");
    }

    /// Story 3.7 carry-forward guard, the gain half: a stored row with NO date
    /// (captured while the volume was unmounted) gains one when a later sweep
    /// runs with the catalogue reachable — rewritten and re-queued exactly once.
    #[test]
    fn backfill_gains_dates_when_a_catalogue_becomes_reachable() {
        let store_dir = TempDir::new("backfill-gain-store");
        let store_conn = crate::store::open_at(&store_dir.0.join("local.sqlite")).unwrap();

        let serato4_dir = TempDir::new("backfill-gain-serato4");
        let db_path = write_serato4_fixture_with_portable_id(
            &serato4_dir.0,
            42,
            "A Indian/usb-track.mp3",
            1_000,
        );

        // First derivation with nothing reachable — no date stored.
        let identity = crate::capture::serato4_session_identity(42);
        let (plays, derived) = crate::capture::build_serato4(
            &serato4_dir.0,
            &db_path,
            42,
            &no_dates(),
            &crate::stats::segments::CalibrationPool::default(),
        )
        .expect("derive without dates");
        assert_eq!(plays[0].library_added_at, None);
        let (started_at, ended_at) = crate::capture::session_bounds(&plays);
        crate::store::upsert_captured(
            &store_conn,
            &identity,
            SessionSource::Serato4,
            &crate::capture::serato4_raw_ref(&db_path, 42),
            started_at,
            ended_at,
            &plays,
            &derived,
        )
        .unwrap();
        store_conn
            .execute(
                "UPDATE captured_sessions SET synced_at = 777 WHERE session_identity = ?1",
                rusqlite::params![identity],
            )
            .unwrap();

        // The USB comes back: the sweep re-derives with the catalogue
        // reachable, gains the date, and re-queues the correction.
        let usb_dates =
            crate::joiner::date_added::DateAddedIndex::fixed(std::collections::HashMap::from([(
                "A Indian/usb-track.mp3".to_string(),
                1_700_000_000,
            )]));
        let plan = WatchPlan {
            serato4: Some(Serato4Source {
                root: serato4_dir.0.clone(),
                db_path,
            }),
            legacy: None,
        };
        let changed = backfill_captured_serato4(&store_conn, &plan, &usb_dates, &NoopReporter);

        assert_eq!(changed, 1, "gaining a date is a real correction");
        let row = crate::store::get_by_identity(&store_conn, &identity)
            .unwrap()
            .unwrap();
        assert!(
            row.plays_json
                .as_deref()
                .unwrap()
                .contains("\"library_added_at\":1700000000"),
            "the gained date must be stored"
        );
        assert_eq!(row.synced_at, None, "the correction must re-sync");
    }

    fn play_with(
        started_at: Option<u32>,
        title: Option<&str>,
        library_added_at: Option<i64>,
    ) -> crate::store::CapturedPlay {
        crate::store::CapturedPlay {
            position: 1,
            title: title.map(str::to_string),
            artist: None,
            started_at,
            bpm: None,
            genre: None,
            camelot_key: None,
            in_library: false,
            played_ms: None,
            library_added_at,
            track_id: None,
        }
    }

    /// Story 3.7 code review: two stored plays sharing a `(started_at, title)`
    /// key (here, both missing both fields) that disagree on their stored date
    /// must never resolve to either one — guessing risks attaching the wrong
    /// play's date to an unrelated fresh play.
    #[test]
    fn carry_forward_skips_a_colliding_key_with_disagreeing_dates() {
        let stored = vec![
            play_with(None, None, Some(1_644_628_114)),
            play_with(None, None, Some(1_700_000_000)),
        ];
        let stored_json = serde_json::to_string(&stored).unwrap();

        let mut fresh = vec![play_with(None, None, None)];
        carry_forward_library_dates(Some(&stored_json), &mut fresh);

        assert_eq!(
            fresh[0].library_added_at, None,
            "a colliding key with two different stored dates must never guess which one applies"
        );
    }

    /// The non-colliding case still works exactly as before the collision guard.
    #[test]
    fn carry_forward_applies_an_unambiguous_key() {
        let stored = vec![play_with(Some(1_000), Some("Track A"), Some(1_644_628_114))];
        let stored_json = serde_json::to_string(&stored).unwrap();

        let mut fresh = vec![play_with(Some(1_000), Some("Track A"), None)];
        carry_forward_library_dates(Some(&stored_json), &mut fresh);

        assert_eq!(fresh[0].library_added_at, Some(1_644_628_114));
    }

    /// With no serato4 source currently configured (drive unplugged), a captured
    /// row is left exactly as-is rather than corrupted or wiped — the reachability
    /// guard that keeps a backfill from destroying data it cannot re-derive.
    #[test]
    fn backfill_leaves_rows_untouched_when_no_serato4_source_is_configured() {
        let store_dir = TempDir::new("backfill-captured-no-source-store");
        let store_conn = crate::store::open_at(&store_dir.0.join("local.sqlite")).unwrap();

        let identity = crate::capture::serato4_session_identity(42);
        store_conn
            .execute(
                r#"INSERT INTO captured_sessions
                       (session_identity, source, status, raw_ref, started_at, ended_at,
                        captured_at, plays_json, derived_json, synced_at)
                   VALUES (?1, 'serato4', 'captured', '/gone/master.sqlite#42', 1000, 1000,
                           1000, '[]', '{"stale":true}', 555)"#,
                rusqlite::params![identity],
            )
            .unwrap();

        let plan = WatchPlan {
            serato4: None,
            legacy: None,
        };

        let processed = backfill_captured_serato4(&store_conn, &plan, &no_dates(), &NoopReporter);
        assert_eq!(processed, 0, "nothing to re-derive with no source");

        let row = crate::store::get_by_identity(&store_conn, &identity)
            .unwrap()
            .unwrap();
        assert_eq!(
            row.derived_json.as_deref(),
            Some("{\"stale\":true}"),
            "an unreachable source must leave the row byte-for-byte untouched"
        );
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

        reprocess_parse_failures(&store_conn, &plan, &no_dates(), &NoopReporter);

        assert_eq!(
            crate::store::unresolved_parse_failures(&store_conn)
                .unwrap()
                .len(),
            1,
            "a row whose source vanished from the watch plan must not be treated as resolved"
        );
    }
}
