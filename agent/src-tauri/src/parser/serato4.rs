//! Serato 4+ `master.sqlite` play-log read (AC-1, AC-2, AC-3).
//!
//! Unlike the legacy `.session` binary format, Serato 4+ logs plays directly into a
//! SQL table (`history_entry`), so there is no envelope to decode — just a `SELECT`
//! and a field mapping onto the same [`crate::parser::Play`] contract Story 1.3's
//! legacy parser produces. "Two play-log sources, one `Play` contract" (epics.md,
//! Epic 1 overview) is what AC-1 operationalizes.
//!
//! **Independent of `joiner`.** This module never opens its own connection and never
//! imports from [`crate::joiner`] — the pipeline stage order (`watcher -> parser ->
//! joiner -> stat-engine -> ...`, documented in [`crate`](../lib.rs)) means `parser`
//! must not depend on the stage that comes after it. A caller opens one `Connection`
//! via the already-shipped [`crate::joiner::serato4::open_read_only`] and passes the
//! same `&Connection` to both [`read_session`] and `joiner::serato4::join_session` (for
//! `bpm`, which has no home on [`crate::parser::Play`] — see that function's field
//! mapping below for why).

use rusqlite::Connection;

use super::Play;

/// Reads one Serato 4+ session's plays directly from `master.sqlite`'s `history_entry`
/// table, ordered the same way the legacy parser orders its own output: play order,
/// deterministic even when two plays share a `start_time`.
///
/// **Field mapping is deliberately partial.** Only columns with a confirmed, unambiguous
/// meaning are read:
/// - `path`, `label`, `grouping`, `year`, `duration_sec` stay `None` — `history_entry`
///   has no path column directly on it; a real `master.sqlite`, inspected during this
///   story, confirms `location_id`/`asset_id` FK columns do exist (`location(path)`
///   is the resolvable path), but following them into a join is explicitly out of
///   scope here per Story 1.4's carve-out (AD-11) — see `deferred-work.md` for the
///   real-data numbers left for whoever picks that up. `end_time`'s semantics were
///   never validated by Story 1.2's spike, so no `duration_sec` is derived from it.
/// - `history_entry.bpm` is never read here, even though it sits on the same row.
///   `Play` has no `bpm` field by design (Story 1.3): BPM comes from the library join
///   (Stories 1.4/1.5), never the play-log, for both formats alike. Adding it here would
///   break the one-contract-two-sources guarantee AC-1 requires. A caller that wants
///   BPM for a Serato 4+ play still calls `joiner::serato4::join_session` for it.
/// - No filter on `history_entry.played` — symmetric with the legacy path's unfiltered
///   handling of its own low-confidence "played" flag (Story 1.2 findings §3).
///
/// Every column is read as `Option<T>`, including `start_time`: a `NULL` row becomes
/// `Play { start_time: None, .. }` rather than failing the whole session's read via a
/// type-coercion error, matching `Play`'s own "optional-everywhere" design (Story 1.3).
///
/// **A real `master.sqlite` confirms `name`/`artist`/`genre`/`key`/`start_time`/`deck`
/// are all declared `NOT NULL` (text columns default to `''`)** — inspected directly
/// against a live file during this story, superseding the schema Story 1.2's spike
/// inferred. SQL `NULL` is therefore not how this format represents "absent" for these
/// columns; an empty string is, exactly as [`crate::joiner::non_empty`] already treats
/// it for the same table's `key`/`genre` in `joiner::serato4::join_session` (`bpm` is
/// normalized separately there, via a numeric-range check, not `non_empty`). Text
/// fields are normalized through a local [`non_empty`] for the same reason that
/// function's doc comment gives: `Some("")` would look like a resolved value and block
/// Story 1.5's fallback from ever running for that field. Duplicated rather than
/// imported because `parser` must not depend on `joiner` (see module doc).
///
/// `session_id` matching no rows is `Ok(vec![])` — a quiet session is valid data, not
/// corruption. A missing `history_entry` table is `Err`, never a panic and never a
/// silently empty `Vec` that would look like "the DJ played nothing".
pub fn read_session(conn: &Connection, session_id: i64) -> rusqlite::Result<Vec<Play>> {
    let mut stmt = conn.prepare(
        r#"SELECT name, artist, genre, "key", start_time, deck
           FROM history_entry
           WHERE session_id = ?1
           ORDER BY start_time ASC, id ASC"#,
    )?;

    let rows = stmt.query_map([session_id], |row| {
        Ok(Play {
            path: None,
            title: row.get::<_, Option<String>>(0)?.and_then(non_empty),
            artist: row.get::<_, Option<String>>(1)?.and_then(non_empty),
            label: None,
            genre: row.get::<_, Option<String>>(2)?.and_then(non_empty),
            grouping: None,
            year: None,
            start_time: row
                .get::<_, Option<i64>>(4)?
                .and_then(|t| u32::try_from(t).ok()),
            deck: row
                .get::<_, Option<String>>(5)?
                .and_then(|d| d.parse().ok()),
            duration_sec: None,
            key: row.get::<_, Option<String>>(3)?.and_then(non_empty),
        })
    })?;

    rows.collect()
}

/// Accepts a text value only if it carries something.
///
/// A confirmed-real `master.sqlite` stores a "cleared"/never-set text field as `''`,
/// not SQL `NULL` (see [`read_session`]'s doc comment). Mirrors
/// [`crate::joiner::non_empty`]; kept local so `parser` never imports from `joiner`.
fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The `history_entry` columns this reader needs, created in memory. A superset of
    /// `joiner/serato4.rs`'s `in_memory_history()` fixture (adds `name`/`artist`/`deck`).
    /// Columns declared nullable here on purpose, to exercise both the SQL-`NULL` case
    /// (defensive; not observed in a real file) and the empty-string case (the real
    /// production "absent" signal, confirmed against a live `master.sqlite` during this
    /// story — see [`read_session`]'s doc comment) independently.
    fn in_memory_history() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database opens");
        conn.execute_batch(
            r#"CREATE TABLE history_entry (
                   id         INTEGER PRIMARY KEY,
                   session_id INTEGER NOT NULL,
                   name       TEXT,
                   artist     TEXT,
                   genre      TEXT,
                   "key"      TEXT,
                   start_time INTEGER,
                   deck       TEXT
               );"#,
        )
        .expect("fixture schema creates");
        conn
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_entry(
        conn: &Connection,
        session_id: i64,
        name: Option<&str>,
        artist: Option<&str>,
        genre: Option<&str>,
        key: Option<&str>,
        start_time: Option<i64>,
        deck: Option<&str>,
    ) -> i64 {
        conn.execute(
            r#"INSERT INTO history_entry (session_id, name, artist, genre, "key", start_time, deck)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)"#,
            rusqlite::params![session_id, name, artist, genre, key, start_time, deck],
        )
        .expect("fixture row inserts");
        conn.last_insert_rowid()
    }

    /// AC-1: a fully-populated row maps onto exactly the fields it should — asserting
    /// the whole struct so an accidental future field addition (e.g. wiring in `bpm`)
    /// fails this test immediately.
    #[test]
    fn full_row_maps_to_play_with_untouched_fields_none() {
        let conn = in_memory_history();
        insert_entry(
            &conn,
            7,
            Some("Track A"),
            Some("Artist A"),
            Some("Deep House"),
            Some("1A"),
            Some(1_000),
            Some("1"),
        );

        let plays = read_session(&conn, 7).expect("query succeeds");

        assert_eq!(
            plays,
            vec![Play {
                path: None,
                title: Some("Track A".to_string()),
                artist: Some("Artist A".to_string()),
                label: None,
                genre: Some("Deep House".to_string()),
                grouping: None,
                year: None,
                start_time: Some(1_000),
                deck: Some(1),
                duration_sec: None,
                key: Some("1A".to_string()),
            }]
        );
    }

    /// A real `master.sqlite`'s `name`/`artist`/`genre`/`key` are `NOT NULL DEFAULT
    /// ''`, so an "absent" value in production is an empty string, not SQL `NULL` —
    /// confirmed against a live file during this story. Each is independently
    /// normalized to `None`, mirroring `joiner::non_empty`'s identical treatment of
    /// the same table's columns.
    #[test]
    fn empty_string_columns_are_independently_absent() {
        let conn = in_memory_history();
        insert_entry(
            &conn,
            7,
            Some("Track A"),
            Some(""),
            Some(""),
            Some(""),
            Some(1_000),
            Some(""),
        );

        let plays = read_session(&conn, 7).expect("query succeeds");

        assert_eq!(plays.len(), 1, "row with empty-string fields still returns");
        let play = &plays[0];
        assert_eq!(play.title.as_deref(), Some("Track A"));
        assert_eq!(play.artist, None, "empty artist reads as absent");
        assert_eq!(play.genre, None, "empty genre reads as absent");
        assert_eq!(play.key, None, "empty key reads as absent");
        assert_eq!(
            play.deck, None,
            "empty deck fails to parse as u32, also absent"
        );
    }

    /// Each nullable column is independently `None` on `Play` when `NULL` in the row —
    /// defensive coverage for a schema variant the real file does not itself exhibit
    /// (see `empty_string_columns_are_independently_absent`), and the row still
    /// returns rather than being dropped.
    #[test]
    fn null_columns_are_independently_absent() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some("Track A"), None, None, None, None, None);

        let plays = read_session(&conn, 7).expect("query succeeds");

        assert_eq!(plays.len(), 1, "row with partial NULLs still returns");
        let play = &plays[0];
        assert_eq!(play.title.as_deref(), Some("Track A"));
        assert_eq!(play.artist, None);
        assert_eq!(play.genre, None);
        assert_eq!(play.key, None);
        assert_eq!(play.start_time, None);
        assert_eq!(play.deck, None);
    }

    /// Rows belonging to another session are excluded.
    #[test]
    fn other_sessions_are_excluded() {
        let conn = in_memory_history();
        insert_entry(
            &conn,
            7,
            Some("Track A"),
            Some("Artist A"),
            Some("House"),
            Some("1A"),
            Some(1_000),
            Some("1"),
        );
        insert_entry(
            &conn,
            8,
            Some("Track B"),
            Some("Artist B"),
            Some("Techno"),
            Some("4A"),
            Some(1_100),
            Some("2"),
        );

        let plays = read_session(&conn, 7).expect("query succeeds");

        assert_eq!(plays.len(), 1);
        assert_eq!(plays[0].title.as_deref(), Some("Track A"));
    }

    /// Results come back in play order.
    #[test]
    fn rows_are_ordered_by_start_time() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some("Third"), None, None, None, Some(3_000), None);
        insert_entry(&conn, 7, Some("First"), None, None, None, Some(1_000), None);
        insert_entry(
            &conn,
            7,
            Some("Second"),
            None,
            None,
            None,
            Some(2_000),
            None,
        );

        let plays = read_session(&conn, 7).expect("query succeeds");
        let order: Vec<_> = plays.iter().filter_map(|p| p.title.as_deref()).collect();

        assert_eq!(order, vec!["First", "Second", "Third"]);
    }

    /// `start_time` is second-resolution, so tied rows need a deterministic tiebreaker.
    /// This test pins the contract via the `id ASC` clause; it cannot itself prove the
    /// tiebreaker is load-bearing beyond what mutation testing shows (same caveat as
    /// `joiner/serato4.rs`'s equivalent test).
    #[test]
    fn plays_tied_on_start_time_are_ordered_deterministically_by_id() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some("First"), None, None, None, Some(1_000), None);
        insert_entry(
            &conn,
            7,
            Some("Second"),
            None,
            None,
            None,
            Some(1_000),
            None,
        );
        insert_entry(&conn, 7, Some("Third"), None, None, None, Some(1_000), None);

        let plays = read_session(&conn, 7).expect("query succeeds");
        let order: Vec<_> = plays.iter().filter_map(|p| p.title.as_deref()).collect();

        assert_eq!(
            order,
            vec!["First", "Second", "Third"],
            "tied start_times must still yield one defined order"
        );
    }

    /// AC-2: calling `read_session` twice against the same fixture yields identical
    /// results.
    #[test]
    fn read_session_is_deterministic() {
        let conn = in_memory_history();
        insert_entry(
            &conn,
            7,
            Some("A"),
            Some("Artist A"),
            Some("House"),
            Some("1A"),
            Some(1_000),
            Some("1"),
        );
        insert_entry(
            &conn,
            7,
            Some("B"),
            Some("Artist B"),
            Some("Techno"),
            Some("4A"),
            Some(2_000),
            Some("2"),
        );

        assert_eq!(
            read_session(&conn, 7).expect("first read succeeds"),
            read_session(&conn, 7).expect("second read succeeds")
        );
    }

    /// A `deck` value that fails to parse as `u32` is `None`, not a panic and not a
    /// fabricated value.
    #[test]
    fn unparseable_deck_is_none() {
        let conn = in_memory_history();
        insert_entry(
            &conn,
            7,
            Some("A"),
            None,
            None,
            None,
            Some(1_000),
            Some("unknown"),
        );

        let plays = read_session(&conn, 7).expect("query succeeds");

        assert_eq!(plays[0].deck, None);
    }

    /// AC-3: a missing `history_entry` table is an error, never a panic and never an
    /// empty `Vec` that would look like a quiet session.
    #[test]
    fn missing_table_is_an_error_not_an_empty_set() {
        let conn = Connection::open_in_memory().expect("in-memory database opens");

        assert!(read_session(&conn, 7).is_err());
    }

    /// A valid session with zero matching rows is `Ok(vec![])`, not an error.
    #[test]
    fn zero_rows_is_ok_empty_vec() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some("A"), None, None, None, Some(1_000), None);

        assert_eq!(read_session(&conn, 999).expect("query succeeds"), vec![]);
    }

    /// An empty-string `name` is normalized to `None`, mirroring the same treatment
    /// already covered for `artist`/`genre`/`key` — this story's own real-data pass
    /// measured a 0.6% empty-title rate, so this path is real, not theoretical.
    #[test]
    fn empty_string_title_is_absent() {
        let conn = in_memory_history();
        insert_entry(
            &conn,
            7,
            Some(""),
            Some("Artist A"),
            None,
            None,
            Some(1_000),
            None,
        );

        let plays = read_session(&conn, 7).expect("query succeeds");

        assert_eq!(plays[0].title, None, "empty title reads as absent");
        assert_eq!(plays[0].artist.as_deref(), Some("Artist A"));
    }

    /// `deck` values `"3"` and `"4"` parse cleanly — confirmed real by this story's
    /// real-data pass (a 4-deck controller setup is genuinely in use, not just
    /// theoretical), unlike the `"1"`/`"2"` cases already covered elsewhere.
    #[test]
    fn deck_values_three_and_four_parse() {
        let conn = in_memory_history();
        insert_entry(
            &conn,
            7,
            Some("A"),
            None,
            None,
            None,
            Some(1_000),
            Some("3"),
        );
        insert_entry(
            &conn,
            7,
            Some("B"),
            None,
            None,
            None,
            Some(2_000),
            Some("4"),
        );

        let plays = read_session(&conn, 7).expect("query succeeds");

        assert_eq!(plays[0].deck, Some(3));
        assert_eq!(plays[1].deck, Some(4));
    }

    /// A `start_time` outside `u32`'s range (e.g. negative) fails the `try_from`
    /// conversion and reads as `None`, same as any other unparseable value — but the
    /// row's SQL `ORDER BY` position is still driven by the raw, now-invisible value.
    /// No evidence this occurs in production (real data confirmed `start_time` is
    /// `NOT NULL` and defaults to the current time), so this pins current behavior
    /// rather than asserting a fix; see `deferred-work.md` for the open question.
    #[test]
    fn out_of_range_start_time_is_none_not_a_panic() {
        let conn = in_memory_history();
        insert_entry(&conn, 7, Some("A"), None, None, None, Some(-1), None);

        let plays = read_session(&conn, 7).expect("query succeeds");

        assert_eq!(
            plays[0].start_time, None,
            "negative start_time is not a valid u32"
        );
    }
}
