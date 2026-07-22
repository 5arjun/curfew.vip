//! Serato 4+ `master.sqlite` metadata read (AC-2).
//!
//! Unlike the legacy path, this format needs no catalogue lookup: Story 1.2 confirmed
//! (findings §3/§9) that `master.sqlite`'s `history_entry` table already carries
//! `bpm`/`key`/`genre` **denormalized onto the play row itself**. The "join" AC-2 asks
//! for is therefore a read of columns that are already sitting next to the play —
//! richer than the legacy join, which genuinely has to resolve a separate file.
//!
//! **Scope boundary.** `history_entry` has no path column; a path-based library
//! catalogue join for this format would mean following `location_id`/`asset_id` foreign
//! keys into tables Story 1.2's spike never explored (findings §8). AC-2 does not need
//! that — it asks only that a *played* track's BPM/key/genre resolve, and they already
//! do. That exploration becomes a real task only if a later story needs a **path** for
//! a Serato 4+ play (e.g. Story 1.5, to read embedded tags off disk).
//!
//! **Not yet wired into the pipeline.** Nothing produces a real `session_id` for this
//! format until Story 1.3b (the `master.sqlite` play-log reader) lands; this function is
//! written and tested standalone now so 1.3b is not blocked on it later, exactly as
//! Story 1.3 pinned `triseratops`/`id3` ahead of the stories that call them.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};

use super::{non_empty, sane_bpm, JoinedMetadata};

/// Opens a `master.sqlite` **read-only**.
///
/// This is the DJ's live database and Serato may have it open mid-gig, so the write
/// path is closed off at the connection flags rather than by convention.
/// `SQLITE_OPEN_NO_MUTEX` matches the spike: the connection is not shared across
/// threads.
pub fn open_read_only(path: &Path) -> rusqlite::Result<Connection> {
    Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
}

/// Reads the library metadata for every play in one Serato 4+ session, in play order.
///
/// Returns `(history_entry.id, metadata)` per row for `session_id`, ordered by
/// `start_time` ascending with `id` as the tiebreaker — the same ordering convention the
/// parser applies to the legacy format, so both paths hand the stat engine a set in the
/// order it was played.
///
/// **The `id` is the join key, and callers must correlate on it, not on position.**
/// `start_time` is second-resolution (matching [`crate::parser::Play::start_time`]), so
/// two plays cut quickly into each other can share one value, and SQL leaves the order
/// of tied rows undefined. A caller that zipped this `Vec` positionally against its own
/// separately-sorted query of the same table would silently attach one track's BPM/key
/// to another — a wrong answer that never errors and never fails a test, which is the
/// exact failure class AD-11 exists to prevent. The `id ASC` tiebreaker makes this
/// function's own order deterministic; returning the id makes the correlation checkable
/// rather than assumed.
///
/// Note for Story 1.3b (the `master.sqlite` play-log reader): the play log and this
/// metadata live on **the same `history_entry` row**. If 1.3b selects these three columns
/// in its own query, it never needs to correlate anything and this function becomes
/// redundant — that is the preferred outcome. It exists standalone so 1.3b is not blocked
/// on it, not to mandate a second round-trip.
///
/// `in_library` is `true` for every row returned. This is an **assumption, not a
/// measurement**: no column in the explored schema distinguishes "played from an
/// indexed library track" from "played straight off disk", and unlike the legacy format
/// there is no lookup here that could miss. It is defensible because the metadata is
/// already present on the row at high measured coverage (findings §3/§9), where a
/// genuinely off-library legacy play has no catalogue row at all. It does not endanger
/// AC-4: a `NULL` column still reports `None` regardless of this flag, so Story 1.5's
/// fallback routing is unaffected — only the flag's own display semantics (the
/// in-library/off-library distinction in the glossary, PRD §3) would be wrong if the
/// assumption is. It is a documented deviation from the Consistency Conventions' "never
/// guessed" rule, tracked in `deferred-work.md`; confirm against a real file, ideally
/// during Story 1.3b, which will hold a live connection to the fuller schema.
pub fn join_session(
    conn: &Connection,
    session_id: i64,
) -> rusqlite::Result<Vec<(i64, JoinedMetadata)>> {
    let mut stmt = conn.prepare(
        r#"SELECT id, bpm, "key", genre
           FROM history_entry
           WHERE session_id = ?1
           ORDER BY start_time ASC, id ASC"#,
    )?;

    let rows = stmt.query_map([session_id], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            JoinedMetadata {
                in_library: true,
                // A NULL column reads as `None` rather than erroring or defaulting —
                // the same "absent, never guessed" contract the legacy path holds to.
                bpm: row.get::<_, Option<f64>>(1)?.and_then(sane_bpm),
                key: row.get::<_, Option<String>>(2)?.and_then(non_empty),
                genre: row.get::<_, Option<String>>(3)?.and_then(non_empty),
            },
        ))
    })?;

    rows.collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `history_entry` columns this story reads, created in memory.
    ///
    /// The schema is **inferred** from Story 1.2's spike query, not re-confirmed
    /// against a real `master.sqlite` during this story — the same real-data
    /// validation gap Story 1.3 carried by design until Story 1.9's golden fixtures.
    /// Real Serato data is never committed as a fixture.
    fn in_memory_history() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database opens");
        conn.execute_batch(
            r#"CREATE TABLE history_entry (
                   id         INTEGER PRIMARY KEY,
                   session_id INTEGER NOT NULL,
                   bpm        REAL,
                   "key"      TEXT,
                   genre      TEXT,
                   start_time INTEGER NOT NULL
               );"#,
        )
        .expect("fixture schema creates");
        conn
    }

    /// Inserts one row and returns its `id` — the key callers must correlate on.
    fn insert_entry(
        conn: &Connection,
        session_id: i64,
        bpm: Option<f64>,
        key: Option<&str>,
        genre: Option<&str>,
        start_time: i64,
    ) -> i64 {
        conn.execute(
            r#"INSERT INTO history_entry (session_id, bpm, "key", genre, start_time)
               VALUES (?1, ?2, ?3, ?4, ?5)"#,
            rusqlite::params![session_id, bpm, key, genre, start_time],
        )
        .expect("fixture row inserts");
        conn.last_insert_rowid()
    }

    /// Drops the ids, for assertions that are only about metadata or ordering.
    fn metadata_of(joined: &[(i64, JoinedMetadata)]) -> Vec<JoinedMetadata> {
        joined.iter().map(|(_, m)| m.clone()).collect()
    }

    /// AC-2: a played track's BPM, key, and genre resolve from the Serato 4+ library,
    /// carrying the `history_entry.id` that identifies which play they belong to.
    #[test]
    fn resolves_bpm_key_and_genre_from_the_play_row() {
        let conn = in_memory_history();
        let id = insert_entry(&conn, 7, Some(128.0), Some("1A"), Some("Deep House"), 1_000);

        let joined = join_session(&conn, 7).expect("query succeeds");

        assert_eq!(
            joined,
            vec![(
                id,
                JoinedMetadata {
                    in_library: true,
                    bpm: Some(128.0),
                    key: Some("1A".to_string()),
                    genre: Some("Deep House".to_string()),
                }
            )]
        );
    }

    /// AC-4: a `NULL` column reports that field absent — routed to Story 1.5's fallback
    /// exactly like a legacy gap — while the row's other fields still resolve.
    #[test]
    fn null_column_reports_the_field_absent() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some(124.0), Some("8B"), None, 1_000);

        let joined = join_session(&conn, 7).expect("query succeeds");

        assert_eq!(
            metadata_of(&joined),
            vec![JoinedMetadata {
                in_library: true,
                bpm: Some(124.0),
                key: Some("8B".to_string()),
                genre: None,
            }],
            "a NULL genre must not cost the row its other fields"
        );
    }

    /// A row with nothing analysed still reports membership — the flag describes the
    /// track, not the completeness of its metadata.
    #[test]
    fn fully_null_row_is_in_library_with_no_fields() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, None, None, None, 1_000);

        let joined = join_session(&conn, 7).expect("query succeeds");

        assert_eq!(
            metadata_of(&joined),
            vec![JoinedMetadata {
                in_library: true,
                bpm: None,
                key: None,
                genre: None,
            }]
        );
    }

    /// A zero BPM and an empty-string tag are "not analysed"/"cleared", not values —
    /// normalized to absent identically to the legacy path, so both formats hand the
    /// same shape downstream.
    #[test]
    fn zero_bpm_and_empty_strings_are_absent() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some(0.0), Some(""), Some(""), 1_000);

        let joined = join_session(&conn, 7).expect("query succeeds");

        assert_eq!(joined[0].1.bpm, None);
        assert_eq!(joined[0].1.key, None);
        assert_eq!(joined[0].1.genre, None);
        assert!(joined[0].1.in_library);
    }

    /// Rows belonging to another session are not this session's plays.
    #[test]
    fn other_sessions_are_excluded() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some(128.0), Some("1A"), Some("House"), 1_000);
        insert_entry(&conn, 8, Some(150.0), Some("4A"), Some("Techno"), 1_100);

        let joined = join_session(&conn, 7).expect("query succeeds");

        assert_eq!(joined.len(), 1);
        assert_eq!(joined[0].1.genre.as_deref(), Some("House"));
    }

    /// Results come back in play order, not insertion order — the stat engine reads a
    /// set as it was played (AR-5), and the energy arc depends on it (Story 3.8).
    #[test]
    fn rows_are_ordered_by_start_time() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some(130.0), Some("2A"), Some("Third"), 3_000);
        insert_entry(&conn, 7, Some(120.0), Some("1A"), Some("First"), 1_000);
        insert_entry(&conn, 7, Some(125.0), Some("3A"), Some("Second"), 2_000);

        let joined = join_session(&conn, 7).expect("query succeeds");
        let order: Vec<_> = joined
            .iter()
            .filter_map(|(_, m)| m.genre.as_deref())
            .collect();

        assert_eq!(order, vec!["First", "Second", "Third"]);
    }

    /// `start_time` is second-resolution, so a quick cut puts two plays in the same
    /// second, and SQL leaves the order of tied rows undefined.
    ///
    /// **This test pins the contract; it cannot enforce it.** Verified by mutation:
    /// deleting `, id ASC` from the query leaves this test passing, because SQLite's
    /// current planner happens to emit tied rows in rowid order anyway. That is an
    /// implementation coincidence of one engine version, not a guarantee, and no test
    /// written against SQLite can make it one. The tiebreaker stays because the
    /// guarantee has to come from the query rather than from the planner's mood — and
    /// the load-bearing protection for callers is the returned `id`, which
    /// [`returned_ids_identify_their_own_rows`] *does* enforce (mutating the id away
    /// fails three tests).
    #[test]
    fn plays_tied_on_start_time_are_ordered_deterministically_by_id() {
        let conn = in_memory_history();
        let first = insert_entry(&conn, 7, Some(120.0), Some("1A"), Some("First"), 1_000);
        let second = insert_entry(&conn, 7, Some(125.0), Some("3A"), Some("Second"), 1_000);
        let third = insert_entry(&conn, 7, Some(130.0), Some("2A"), Some("Third"), 1_000);

        let ids: Vec<i64> = join_session(&conn, 7)
            .expect("query succeeds")
            .iter()
            .map(|(id, _)| *id)
            .collect();

        assert_eq!(
            ids,
            vec![first, second, third],
            "tied start_times must still yield one defined order"
        );
    }

    /// The returned id is the join key: it identifies which `history_entry` row each
    /// metadata record came from, so a caller never has to trust positional alignment
    /// with a separately-sorted query of the same table.
    #[test]
    fn returned_ids_identify_their_own_rows() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some(120.0), Some("1A"), Some("First"), 1_000);
        let tagged = insert_entry(&conn, 7, Some(174.0), Some("11A"), Some("Jungle"), 2_000);

        let joined = join_session(&conn, 7).expect("query succeeds");
        let found = joined
            .iter()
            .find(|(id, _)| *id == tagged)
            .expect("the tagged row is returned");

        assert_eq!(found.1.genre.as_deref(), Some("Jungle"));
        assert_eq!(found.1.bpm, Some(174.0));
    }

    /// A session with no plays is an empty set, not an error.
    #[test]
    fn unknown_session_returns_no_rows() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some(128.0), Some("1A"), Some("House"), 1_000);

        assert_eq!(join_session(&conn, 999).expect("query succeeds"), vec![]);
    }

    /// The connection helper opens read-only: a write against it is refused by SQLite
    /// rather than reaching the DJ's live database.
    #[test]
    fn open_read_only_refuses_writes() {
        let path = std::env::temp_dir().join(format!(
            "curfew_joiner_master_{}_{}.sqlite",
            std::process::id(),
            1
        ));
        let _ = std::fs::remove_file(&path);
        {
            let seed = Connection::open(&path).expect("seed database creates");
            seed.execute_batch(
                r#"CREATE TABLE history_entry (
                       id INTEGER PRIMARY KEY, session_id INTEGER, bpm REAL,
                       "key" TEXT, genre TEXT, start_time INTEGER
                   );
                   INSERT INTO history_entry VALUES (1, 7, 128.0, '1A', 'House', 1000);"#,
            )
            .expect("seed data writes");
        }

        let conn = open_read_only(&path).expect("read-only open succeeds");
        let joined = join_session(&conn, 7).expect("reads work");
        let write = conn.execute("DELETE FROM history_entry", []);
        let _ = std::fs::remove_file(&path);

        assert_eq!(joined.len(), 1, "reading the DJ's database still works");
        assert!(write.is_err(), "writing to it must be refused");
    }

    /// A `master.sqlite` that is missing (or is not this schema) surfaces as an error,
    /// never a panic and never a silently empty set that would look like a quiet gig.
    #[test]
    fn missing_table_is_an_error_not_an_empty_set() {
        let conn = Connection::open_in_memory().expect("in-memory database opens");

        assert!(join_session(&conn, 7).is_err());
    }

    /// A `master.sqlite` path that does not exist is refused by the open call itself —
    /// SQLite cannot open a nonexistent file read-only — never a panic. The common case
    /// is a DJ who has no Serato 4+ install at all (they may be a legacy-only user — see
    /// [`super::legacy`]).
    #[test]
    fn open_read_only_on_a_missing_path_errors() {
        let path = std::env::temp_dir().join("curfew_joiner_master_definitely_missing_9f2c.sqlite");
        let _ = std::fs::remove_file(&path);

        assert!(open_read_only(&path).is_err());
    }

    /// A file that exists but is not a SQLite database at all. SQLite's own open is
    /// lazy — the header is validated on first query, not at open time — so the open
    /// call itself can succeed here; the failure must still surface as an `Err` from
    /// the first query, never a panic and never a query result that looks like an
    /// empty gig.
    #[test]
    fn a_non_sqlite_file_errors_on_first_query_not_a_panic() {
        let path = std::env::temp_dir().join(format!(
            "curfew_joiner_master_garbage_{}_{}.sqlite",
            std::process::id(),
            2
        ));
        std::fs::write(&path, b"not a sqlite database").expect("garbage file writes");

        let result = open_read_only(&path).and_then(|conn| join_session(&conn, 7));
        let _ = std::fs::remove_file(&path);

        assert!(result.is_err());
    }
}
