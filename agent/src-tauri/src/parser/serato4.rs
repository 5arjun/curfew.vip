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

use rusqlite::{Connection, OptionalExtension};

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
/// - `key` stays `None` here for the same reason (Story 3.6). The free-text `"key"`
///   column stores mixed, mostly-*musical* notation (`Em`, `G#m`) that
///   `stats::camelot::parse` rejects; the authoritative source is Serato's canonical
///   `key_value` INTEGER, mapped to Camelot by `joiner::serato4::join_session`. Reading
///   the free-text column here would only shadow that joined key (`stats::enrich`
///   prefers `Play.key` when present), which is exactly the ~88%-key-loss bug the fix
///   retired — so, like BPM, key comes from the join, not the play-log.
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
/// One row of `history_session` — a play session's own record, distinct from its
/// [`Play`]s (`history_entry`). Used only to discover *which* sessions exist and
/// when; per-play data still comes from [`read_session`].
#[derive(Debug, Clone, PartialEq)]
pub struct SessionSummary {
    pub id: i64,
    pub name: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
}

/// Lists every `history_session` row with `id` greater than `after_id`, ordered by
/// `id` ascending — the "new since I last looked" query Story 2.6's watcher stage
/// needs to discover freshly-logged sessions (AC-5).
///
/// **Ported from `agent/spike-1-2-parser-validation/src/serato4.rs`'s
/// `list_sessions`/`get_session`** (that file is reference-only, never compiled
/// into this crate) — this is the first production code to query `history_session`
/// itself; every existing caller of this module only ever reads `history_entry`
/// given an already-known `session_id` ([`read_session`]).
///
/// `id` is the high-water mark, not `start_time`: an auto-increment primary key is
/// monotonic by insertion order regardless of any clock skew a `start_time` column
/// could carry, so "new since the last-seen id" can never re-report or skip a
/// session because of a clock issue. Callers persist the returned rows' `id`s and
/// pass the maximum back in as `after_id` on the next call — this function is
/// stateless and holds no watermark itself.
///
/// **This is discovery only, not completeness.** A session's `end_time` may still
/// be unset (`-1`, Story 1.3b's confirmed sentinel) if the DJ's Serato is mid-gig
/// on it — inferring "completed" from that is explicitly Story 2.8 AC-4's job, not
/// this function's; a caller must not assume every returned row represents a
/// finished set.
///
/// A missing `history_session` table is `Err`, never a panic and never a silently
/// empty `Vec` that would look like "nothing has ever been played" — mirrors
/// [`read_session`]'s and `joiner::serato4::join_session`'s identical contract for
/// the sibling table.
pub fn list_sessions_after(
    conn: &Connection,
    after_id: i64,
) -> rusqlite::Result<Vec<SessionSummary>> {
    let mut stmt = conn.prepare(
        r#"SELECT id, name, start_time, end_time
           FROM history_session
           WHERE id > ?1
           ORDER BY id ASC"#,
    )?;

    let rows = stmt.query_map([after_id], |row| {
        Ok(SessionSummary {
            id: row.get(0)?,
            name: row.get::<_, Option<String>>(1)?.and_then(non_empty),
            start_time: row.get(2)?,
            end_time: row.get(3)?,
        })
    })?;

    rows.collect()
}

/// The highest `history_session.id` currently on file, or `0` for a library
/// that has never logged a session.
///
/// This is the go-forward baseline (Decision A, 2026-08-17): a freshly linked
/// agent starts its watermark HERE rather than at 0, so it captures only what
/// the DJ plays from now on and never bulk-imports the history that predates
/// them subscribing. `list_sessions_after(conn, 0)` — the previous behaviour —
/// returns every session Serato has ever recorded, which on a real library is
/// years of sets.
///
/// `0` for an empty table rather than `None`: zero is exactly the right
/// starting watermark for "nothing has ever been played", and it keeps the
/// caller from having to translate an absence into the same value anyway.
pub fn max_session_id(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM history_session",
        [],
        |row| row.get(0),
    )
}

/// Re-reads one `history_session` row by its `id` — the "has this specific
/// pending session's `end_time` resolved yet" query Story 2.8's
/// completion-signal polling needs (Task 4), scoped to one known id rather
/// than [`list_sessions_after`]'s "everything past a watermark" contract.
///
/// `Ok(None)` if no row has this `id` — distinct from an `Err`, which is
/// reserved for a missing `history_session` table entirely, mirroring
/// [`read_session`]'s/`joiner::serato4::join_session`'s identical contract for
/// the sibling table.
pub fn session_by_id(conn: &Connection, id: i64) -> rusqlite::Result<Option<SessionSummary>> {
    conn.query_row(
        r#"SELECT id, name, start_time, end_time
           FROM history_session
           WHERE id = ?1"#,
        [id],
        |row| {
            Ok(SessionSummary {
                id: row.get(0)?,
                name: row.get::<_, Option<String>>(1)?.and_then(non_empty),
                start_time: row.get(2)?,
                end_time: row.get(3)?,
            })
        },
    )
    .optional()
}

pub fn read_session(conn: &Connection, session_id: i64) -> rusqlite::Result<Vec<Play>> {
    let mut stmt = conn.prepare(
        r#"SELECT name, artist, genre, start_time, deck
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
                .get::<_, Option<i64>>(3)?
                .and_then(|t| u32::try_from(t).ok()),
            deck: row
                .get::<_, Option<String>>(4)?
                .and_then(|d| d.parse().ok()),
            duration_sec: None,
            // Key is deliberately NOT read from `history_entry` here — for the same
            // reason `bpm` isn't (see the field-mapping doc above): for Serato 4+ the
            // musical key comes from the library join, not the play-log. The free-text
            // `"key"` column stores mixed, mostly-musical notation (`Em`, `G#m`) that
            // `stats::camelot::parse` rejects, silently dropping ~88% of keys (Story
            // 3.6 incident); the authoritative source is `key_value`, read by
            // `joiner::serato4::join_session`. Leaving this `None` lets `stats::enrich`
            // fall through to that joined key rather than shadowing it with the broken
            // free-text one (`enrich` prefers `Play.key` when present).
            key: None,
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

    /// The `history_session` table [`list_sessions_after`] queries, created in
    /// memory (Story 2.6).
    fn in_memory_sessions() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database opens");
        conn.execute_batch(
            r#"CREATE TABLE history_session (
                   id         INTEGER PRIMARY KEY,
                   name       TEXT,
                   start_time INTEGER NOT NULL,
                   end_time   INTEGER
               );"#,
        )
        .expect("fixture schema creates");
        conn
    }

    fn insert_session(
        conn: &Connection,
        name: Option<&str>,
        start_time: i64,
        end_time: Option<i64>,
    ) -> i64 {
        conn.execute(
            "INSERT INTO history_session (name, start_time, end_time) VALUES (?1, ?2, ?3)",
            rusqlite::params![name, start_time, end_time],
        )
        .expect("fixture row inserts");
        conn.last_insert_rowid()
    }

    /// The go-forward baseline's whole job: a library with existing history
    /// must report its newest id, so a fresh install starts AFTER it rather
    /// than sweeping all of it (Decision A, 2026-08-17).
    #[test]
    fn max_session_id_reports_the_newest_existing_session() {
        let conn = in_memory_sessions();
        insert_session(&conn, Some("2021 gig"), 1_625_000_000, Some(1_625_003_600));
        insert_session(&conn, Some("2024 gig"), 1_700_000_000, Some(1_700_003_600));
        let newest = insert_session(&conn, Some("last night"), 1_786_000_000, None);

        assert_eq!(
            max_session_id(&conn).expect("query runs"),
            newest,
            "the baseline must be the newest session on file"
        );
    }

    /// A never-played library baselines at 0, which is also the correct
    /// watermark for it — every future session is genuinely new.
    #[test]
    fn max_session_id_is_zero_for_a_library_with_no_history() {
        let conn = in_memory_sessions();
        assert_eq!(max_session_id(&conn).expect("query runs"), 0);
    }

    /// The regression this pairs with: baselining at the newest id must leave
    /// `list_sessions_after` returning NOTHING for a library that has only
    /// pre-existing history. This is the exact assertion that would have
    /// caught the 485-set import.
    #[test]
    fn baselining_at_the_newest_id_imports_no_history() {
        let conn = in_memory_sessions();
        insert_session(&conn, Some("old"), 1_625_000_000, Some(1_625_003_600));
        insert_session(&conn, Some("older"), 1_700_000_000, Some(1_700_003_600));

        let baseline = max_session_id(&conn).expect("query runs");
        assert!(
            list_sessions_after(&conn, baseline)
                .expect("query runs")
                .is_empty(),
            "a freshly baselined agent must import none of the existing history"
        );
        assert_eq!(
            list_sessions_after(&conn, 0).expect("query runs").len(),
            2,
            "...while a 0 watermark still sees all of it — the old behaviour"
        );

        // And a set played AFTER linking is still picked up.
        let after_linking = insert_session(&conn, Some("tonight"), 1_786_100_000, None);
        let found = list_sessions_after(&conn, baseline).expect("query runs");
        assert_eq!(found.len(), 1, "go-forward must not mean go-nowhere");
        assert_eq!(found[0].id, after_linking);
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
    /// the whole struct so an accidental future field addition (e.g. wiring in `bpm`,
    /// or re-wiring the free-text `key`) fails this test immediately. `key` is `None`
    /// even though the row carries a free-text `"key"`: Story 3.6 moved key to the
    /// library join (`key_value`), so the play-log parser deliberately no longer reads
    /// it — the free-text column here is present but intentionally ignored.
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
                // Story 3.6: key comes from the joiner (`key_value`), not the play-log.
                key: None,
            }]
        );
    }

    /// Story 3.6: even a row whose free-text `"key"` is a perfectly valid Camelot
    /// string (`8A`) is ignored by the play-log reader — key now comes exclusively
    /// from the library join. This pins the deliberate omission so a well-meaning
    /// future edit re-adding the `"key"` read (and re-introducing the ~88%-loss bug for
    /// musically-notated rows) fails here.
    #[test]
    fn free_text_key_is_ignored_even_when_it_is_valid_camelot() {
        let conn = in_memory_history();
        insert_entry(
            &conn,
            7,
            Some("Track A"),
            None,
            None,
            Some("8A"),
            Some(1_000),
            None,
        );

        let plays = read_session(&conn, 7).expect("query succeeds");

        assert_eq!(
            plays[0].key, None,
            "the play-log parser must not read `key`"
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

    // ---- list_sessions_after (Story 2.6 Task 6) --------------------------------

    /// AC-5: sessions with `id` past the high-water mark are "new"; everything at
    /// or below it is not returned again.
    #[test]
    fn returns_only_sessions_after_the_high_water_mark() {
        let conn = in_memory_sessions();
        let first = insert_session(&conn, Some("Warmup"), 1_000, Some(2_000));
        let second = insert_session(&conn, Some("Peak"), 2_000, Some(3_000));

        let sessions = list_sessions_after(&conn, first).expect("query succeeds");

        assert_eq!(
            sessions,
            vec![SessionSummary {
                id: second,
                name: Some("Peak".to_string()),
                start_time: 2_000,
                end_time: Some(3_000),
            }]
        );
    }

    #[test]
    fn no_sessions_past_the_mark_is_an_empty_vec_not_an_error() {
        let conn = in_memory_sessions();
        let only = insert_session(&conn, Some("Solo"), 1_000, Some(2_000));

        assert_eq!(
            list_sessions_after(&conn, only).expect("query succeeds"),
            vec![]
        );
    }

    /// `after_id = 0` (a caller's first-ever call, no prior watermark) returns
    /// every session that exists.
    #[test]
    fn zero_watermark_returns_every_session() {
        let conn = in_memory_sessions();
        insert_session(&conn, Some("A"), 1_000, Some(2_000));
        insert_session(&conn, Some("B"), 2_000, Some(3_000));

        assert_eq!(
            list_sessions_after(&conn, 0).expect("query succeeds").len(),
            2
        );
    }

    /// Results come back in `id` order, ascending — the watermark advances
    /// monotonically regardless of `start_time`, so callers never need to
    /// re-sort before taking the max `id`.
    #[test]
    fn results_are_ordered_by_id_ascending() {
        let conn = in_memory_sessions();
        let a = insert_session(&conn, Some("A"), 5_000, None);
        let b = insert_session(&conn, Some("B"), 1_000, None);

        let ids: Vec<i64> = list_sessions_after(&conn, 0)
            .expect("query succeeds")
            .iter()
            .map(|s| s.id)
            .collect();

        assert_eq!(ids, vec![a, b], "id order, not start_time order");
    }

    /// An in-progress session (`end_time` unset, Story 1.3b's `-1` sentinel) is
    /// still discovered — completeness is explicitly Story 2.8's concern, not this
    /// function's.
    #[test]
    fn an_in_progress_session_with_no_end_time_is_still_discovered() {
        let conn = in_memory_sessions();
        let live = insert_session(&conn, Some("Still playing"), 1_000, Some(-1));

        let sessions = list_sessions_after(&conn, 0).expect("query succeeds");

        assert_eq!(
            sessions,
            vec![SessionSummary {
                id: live,
                name: Some("Still playing".to_string()),
                start_time: 1_000,
                end_time: Some(-1),
            }]
        );
    }

    /// An empty-string session name is absent, matching the same-table treatment
    /// `non_empty` already gives `history_entry`'s text columns.
    #[test]
    fn empty_string_name_is_absent() {
        let conn = in_memory_sessions();
        insert_session(&conn, Some(""), 1_000, None);

        let sessions = list_sessions_after(&conn, 0).expect("query succeeds");

        assert_eq!(sessions[0].name, None);
    }

    /// A missing `history_session` table is an error, never a panic and never a
    /// silently empty `Vec` that would look like "nothing has ever been played".
    #[test]
    fn missing_table_is_an_error_not_an_empty_vec() {
        let conn = Connection::open_in_memory().expect("in-memory database opens");

        assert!(list_sessions_after(&conn, 0).is_err());
    }

    // ---- session_by_id (Story 2.8 Task 4) --------------------------------------

    /// Story 2.8 AC-4: re-reading a specific pending session by id sees a
    /// resolved `end_time` once Serato has set one.
    #[test]
    fn session_by_id_returns_the_matching_row() {
        let conn = in_memory_sessions();
        let id = insert_session(&conn, Some("Warmup"), 1_000, Some(-1));

        let session = session_by_id(&conn, id)
            .expect("query succeeds")
            .expect("row exists");

        assert_eq!(session.id, id);
        assert_eq!(session.name, Some("Warmup".to_string()));
        assert_eq!(session.start_time, 1_000);
        assert_eq!(session.end_time, Some(-1), "still in progress");
    }

    #[test]
    fn session_by_id_reflects_a_resolved_end_time() {
        let conn = in_memory_sessions();
        let id = insert_session(&conn, Some("Peak"), 1_000, Some(-1));
        conn.execute(
            "UPDATE history_session SET end_time = ?1 WHERE id = ?2",
            rusqlite::params![2_000, id],
        )
        .unwrap();

        let session = session_by_id(&conn, id).unwrap().unwrap();

        assert_eq!(session.end_time, Some(2_000));
    }

    #[test]
    fn session_by_id_unknown_id_is_none_not_an_error() {
        let conn = in_memory_sessions();
        insert_session(&conn, Some("Solo"), 1_000, Some(-1));

        assert_eq!(session_by_id(&conn, 999).expect("query succeeds"), None);
    }

    #[test]
    fn session_by_id_missing_table_is_an_error_not_none() {
        let conn = Connection::open_in_memory().expect("in-memory database opens");

        assert!(session_by_id(&conn, 1).is_err());
    }
}
