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

/// Everything that can go wrong opening a `master.sqlite` catalogue: the path
/// resolved outside the configured Serato root (Story 2.7, AC-1), or SQLite
/// itself refused to open it. Mirrors the `Display`/`std::error::Error` idiom of
/// `JoinError` in [`super::legacy`] — a small enum in application code, no
/// `anyhow`/`thiserror`.
#[derive(Debug)]
pub enum OpenError {
    /// `root` or `path` could not be canonicalized (most commonly: one of them
    /// does not exist), or `path` resolved outside `root` once both did.
    Scope(crate::fs_scope::ScopeError),
    /// The path was in scope, but SQLite refused to open it (e.g. it is not a
    /// valid SQLite database).
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpenError::Scope(e) => write!(f, "refusing to open Serato database: {e}"),
            OpenError::Sqlite(e) => write!(f, "failed to open Serato database: {e}"),
        }
    }
}

impl std::error::Error for OpenError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            OpenError::Scope(e) => Some(e),
            OpenError::Sqlite(e) => Some(e),
        }
    }
}

/// Opens a `master.sqlite` **read-only**, refusing to open anything outside
/// `root` — the DJ's configured Serato root (Story 2.7, AC-1) — even if `path`
/// resolves there via a symlink. A missing `path` or `root` (the common "no
/// Serato 4+ install" case) surfaces as [`OpenError::Scope`] wrapping a
/// `ScopeError::Io` (canonicalization needs both to already exist); a `path`
/// that exists but resolves outside `root`, or is not a valid SQLite database,
/// gets its own distinct variant.
///
/// **`root` may be file-shaped** (`watcher::detect::classify`'s confirm-UI
/// round-trip branch stores the confirmed override as the literal
/// `master.sqlite` path, so the live watch loop's `root` and `path` are often
/// the exact same value — Story 2.7 code review). Checking a path against
/// itself would always trivially pass, defeating the guard entirely, so a
/// file-shaped `root` is scoped against its own parent directory instead —
/// still a real boundary a swapped-in symlink can't cross.
///
/// This is the DJ's live database and Serato may have it open mid-gig, so the write
/// path is closed off at the connection flags rather than by convention.
/// `SQLITE_OPEN_NO_MUTEX` matches the spike: the connection is not shared across
/// threads.
pub fn open_read_only(root: &Path, path: &Path) -> Result<Connection, OpenError> {
    let scope_root = if root.is_file() {
        root.parent().unwrap_or(root)
    } else {
        root
    };
    let checked =
        crate::fs_scope::ensure_within_root(scope_root, path).map_err(OpenError::Scope)?;
    Connection::open_with_flags(
        checked,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(OpenError::Sqlite)
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
        r#"SELECT id, bpm, key_value, "key", genre,
                  end_time, played, length_ms, length_sec, portable_id
           FROM history_entry
           WHERE session_id = ?1
           ORDER BY start_time ASC, id ASC"#,
    )?;

    let rows = stmt.query_map([session_id], |row| {
        // Key source of truth is Serato's canonical `key_value` INTEGER, not the
        // free-text `"key"` column. The free-text column stores *mixed* notation —
        // mostly musical (`Em`, `Ebm`, `G#m`) with only a few already-Camelot — so
        // parsing it dropped ~88% of keys on real data (Story 3.6 incident). The
        // integer is unambiguous (Serato folds enharmonic spellings to one value)
        // and maps deterministically to Camelot, satisfying AD-11 "never guess"
        // better than parsing the text ever could. The free-text column is kept
        // only as a fallback for a source that has no `key_value` at all (a NULL —
        // schema variance; real Serato 4+ uses `-1` for "no key", never NULL).
        let key = match row.get::<_, Option<i64>>(2)? {
            Some(key_value) => camelot_from_key_value(key_value),
            None => row.get::<_, Option<String>>(3)?.and_then(non_empty),
        };
        // Full-song total length: prefer the millisecond column, fall back to
        // seconds ×1000 (both confirmed present on real Serato 4+; either can
        // still be NULL/0 = "unknown" per AD-11). Read as f64 to absorb either
        // an INTEGER or REAL storage class, then rounded.
        let length_ms = row.get::<_, Option<f64>>(7)?.and_then(sane_length_ms);
        let total_length_ms = match length_ms {
            Some(ms) => Some(ms),
            None => row
                .get::<_, Option<f64>>(8)?
                .and_then(|s| sane_length_ms(s * 1000.0)),
        };
        Ok((
            row.get::<_, i64>(0)?,
            JoinedMetadata {
                in_library: true,
                // A NULL column reads as `None` rather than erroring or defaulting —
                // the same "absent, never guessed" contract the legacy path holds to.
                bpm: row.get::<_, Option<f64>>(1)?.and_then(sane_bpm),
                key,
                genre: row.get::<_, Option<String>>(4)?.and_then(non_empty),
                // Serato's `-1` "unset" sentinel (and any other negative) is
                // absent, never a timestamp (Story 3.7 §3d; verified 98%
                // populated on real data).
                ended_at: row.get::<_, Option<i64>>(5)?.filter(|t| *t >= 0),
                // The "Played" flag: 0 = loaded-but-not-played preview. NULL
                // (schema variance) stays `None` — unknown, never guessed.
                played: row.get::<_, Option<i64>>(6)?.map(|p| p != 0),
                total_length_ms,
                // Volume-root-relative path (100% populated on real data) —
                // the `database V2` date-added join key. Empty string = absent.
                portable_path: row.get::<_, Option<String>>(9)?.and_then(non_empty),
                // Resolved by the capture stage via `date_added::DateAddedIndex`
                // (the catalogue is a different file this join never opens).
                library_added_at: None,
            },
        ))
    })?;

    rows.collect()
}

/// Accepts a track-length value in milliseconds only if it is a real
/// measurement — mirrors [`super::sane_bpm`]'s rationale: Serato stores an
/// unanalysed length as `0`/NULL, and zero/negative/non-finite values are
/// missing data wearing a number.
fn sane_length_ms(value: f64) -> Option<u64> {
    (value.is_finite() && value > 0.0).then_some(value.round() as u64)
}

/// Maps Serato's canonical `history_entry.key_value` INTEGER to a Camelot-notation
/// string, or `None` for "no key".
///
/// Verified 24/24 against real data (Story 3.6, cross-tabbed `key_value` ↔ `key_norm`
/// over 20k+ rows): `0..=11` are the minor / Camelot **A** ring, `12..=23` the major /
/// **B** ring, with `number = (v % 12) + 1`. Spot checks: `0 → 1A`, `7 → 8A`,
/// `8 → 9A`, `16 → 5B`, `23 → 12B`.
///
/// `-1` is Serato's "no key" sentinel and returns `None`. Anything outside `0..=23`
/// (including `-1`, other negatives, or an unexpectedly large value) also returns
/// `None` rather than a fabricated position — "never guess" (AD-11): a value the
/// verified mapping does not cover is absent, not invented.
fn camelot_from_key_value(key_value: i64) -> Option<String> {
    (0..=23).contains(&key_value).then(|| {
        let number = (key_value % 12) + 1;
        let letter = if key_value < 12 { 'A' } else { 'B' };
        format!("{number}{letter}")
    })
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
                   id          INTEGER PRIMARY KEY,
                   session_id  INTEGER NOT NULL,
                   bpm         REAL,
                   key_value   INTEGER,
                   "key"       TEXT,
                   genre       TEXT,
                   start_time  INTEGER NOT NULL,
                   end_time    INTEGER,
                   played      INTEGER,
                   length_ms   INTEGER,
                   length_sec  INTEGER,
                   portable_id TEXT
               );"#,
        )
        .expect("fixture schema creates");
        conn
    }

    /// Inserts one row and returns its `id` — the key callers must correlate on.
    ///
    /// Leaves `key_value` `NULL`, so these rows exercise the **free-text fallback**
    /// path (`key_value` absent → the `"key"` column is read). The real-data source of
    /// truth (`key_value` present) is exercised by [`insert_entry_with_key_value`].
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

    /// Inserts a row carrying both a `key_value` INTEGER (Serato's source of truth) and
    /// a `"key"` free-text string, so a test can prove which one the join actually
    /// reads — the whole point of the Story 3.6 fix is that `key_value` wins.
    fn insert_entry_with_key_value(
        conn: &Connection,
        session_id: i64,
        key_value: i64,
        free_text_key: &str,
        start_time: i64,
    ) -> i64 {
        conn.execute(
            r#"INSERT INTO history_entry (session_id, key_value, "key", start_time)
               VALUES (?1, ?2, ?3, ?4)"#,
            rusqlite::params![session_id, key_value, free_text_key, start_time],
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
                    ..JoinedMetadata::default()
                }
            )]
        );
    }

    /// Story 3.7 (§3d capture pass): the play row's own `end_time`, `played`
    /// flag, full-song length, and `portable_id` all resolve — and the `-1`
    /// end_time sentinel reads as absent, never a timestamp.
    #[test]
    fn resolves_end_time_played_length_and_portable_path() {
        let conn = in_memory_history();
        conn.execute(
            r#"INSERT INTO history_entry
                   (session_id, start_time, end_time, played, length_ms, length_sec, portable_id)
               VALUES (7, 1000, 1381, 1, 372000, 372, 'Users/arjun/Music/a.mp3'),
                      (7, 1400, -1, 0, NULL, 372, 'A Indian/b.mp3'),
                      (7, 1800, NULL, NULL, NULL, NULL, '')"#,
            [],
        )
        .expect("fixture rows insert");

        let joined = metadata_of(&join_session(&conn, 7).expect("query succeeds"));

        assert_eq!(joined[0].ended_at, Some(1381));
        assert_eq!(joined[0].played, Some(true));
        assert_eq!(joined[0].total_length_ms, Some(372_000));
        assert_eq!(
            joined[0].portable_path.as_deref(),
            Some("Users/arjun/Music/a.mp3")
        );

        assert_eq!(joined[1].ended_at, None, "-1 is Serato's unset sentinel");
        assert_eq!(
            joined[1].played,
            Some(false),
            "a preview is knowably unplayed"
        );
        assert_eq!(
            joined[1].total_length_ms,
            Some(372_000),
            "length_sec × 1000 fallback when length_ms is NULL"
        );

        assert_eq!(joined[2].ended_at, None);
        assert_eq!(joined[2].played, None, "NULL played is unknown, not false");
        assert_eq!(joined[2].total_length_ms, None);
        assert_eq!(joined[2].portable_path, None, "empty portable_id is absent");
        assert_eq!(joined[2].library_added_at, None);
    }

    /// Story 3.6 (the incident regression): `key_value` is the source of truth, and a
    /// musically-notated free-text `"key"` (`Em`, `Ebm`, `G#m`, `E`) does **not** cost
    /// the row its Camelot key — the integer wins. `-1` is "no key" → `None`. This is
    /// the mapping that, before the fix, silently dropped ~88% of real keys because
    /// `camelot::parse("Em")` is `None`.
    #[test]
    fn key_value_is_the_source_of_truth_over_free_text_key() {
        let conn = in_memory_history();
        // (key_value, free-text musical notation the OLD path would have dropped)
        insert_entry_with_key_value(&conn, 7, 0, "G#m", 1_000); // -> 1A
        insert_entry_with_key_value(&conn, 7, 7, "Am", 1_100); // -> 8A
        insert_entry_with_key_value(&conn, 7, 8, "Em", 1_200); // -> 9A
        insert_entry_with_key_value(&conn, 7, 16, "Ebm", 1_300); // -> 5B (free text intentionally wrong-notation)
        insert_entry_with_key_value(&conn, 7, 23, "E", 1_400); // -> 12B
        insert_entry_with_key_value(&conn, 7, -1, "", 1_500); // -> None (no key)

        let keys: Vec<Option<String>> = join_session(&conn, 7)
            .expect("query succeeds")
            .into_iter()
            .map(|(_, m)| m.key)
            .collect();

        assert_eq!(
            keys,
            vec![
                Some("1A".to_string()),
                Some("8A".to_string()),
                Some("9A".to_string()),
                Some("5B".to_string()),
                Some("12B".to_string()),
                None,
            ],
            "key_value must win over the free-text `key`, and -1 must be no key"
        );
    }

    /// The full 24-value `key_value` → Camelot mapping, plus the sentinels — the
    /// exhaustive form of the "24/24 verified" claim in the Story 3.6 Dev Notes.
    #[test]
    fn camelot_from_key_value_covers_the_whole_ring_and_rejects_sentinels() {
        // A ring (minor): 0..=11 -> 1A..12A
        for v in 0..=11 {
            assert_eq!(
                camelot_from_key_value(v),
                Some(format!("{}A", v + 1)),
                "key_value {v} is the minor/A ring"
            );
        }
        // B ring (major): 12..=23 -> 1B..12B
        for v in 12..=23 {
            assert_eq!(
                camelot_from_key_value(v),
                Some(format!("{}B", v - 11)),
                "key_value {v} is the major/B ring"
            );
        }
        // Sentinels / out of range: never a fabricated position.
        assert_eq!(camelot_from_key_value(-1), None, "-1 is Serato's no-key");
        assert_eq!(camelot_from_key_value(-2), None);
        assert_eq!(camelot_from_key_value(24), None);
        assert_eq!(camelot_from_key_value(999), None);
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
                ..JoinedMetadata::default()
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
                ..JoinedMetadata::default()
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
                       key_value INTEGER, "key" TEXT, genre TEXT, start_time INTEGER,
                       end_time INTEGER, played INTEGER, length_ms INTEGER,
                       length_sec INTEGER, portable_id TEXT
                   );
                   INSERT INTO history_entry (id, session_id, bpm, key_value, "key", genre, start_time)
                   VALUES (1, 7, 128.0, 0, '1A', 'House', 1000);"#,
            )
            .expect("seed data writes");
        }

        let conn = open_read_only(&std::env::temp_dir(), &path).expect("read-only open succeeds");
        let joined = join_session(&conn, 7).expect("reads work");
        let write = conn.execute("DELETE FROM history_entry", []);
        let _ = std::fs::remove_file(&path);

        assert_eq!(joined.len(), 1, "reading the DJ's database still works");
        assert!(write.is_err(), "writing to it must be refused");
    }

    /// Story 2.7 AC-1: a `master.sqlite` symlinked in from outside the
    /// configured root must not be followed — `open_read_only` refuses it as a
    /// scope violation rather than silently opening whatever the symlink
    /// points to.
    #[cfg(unix)]
    #[test]
    fn open_read_only_refuses_a_symlinked_path_outside_root() {
        let root =
            std::env::temp_dir().join(format!("curfew_joiner_scope_root_{}_1", std::process::id()));
        let outside = std::env::temp_dir().join(format!(
            "curfew_joiner_scope_outside_{}_1",
            std::process::id()
        ));
        std::fs::create_dir_all(&root).expect("root dir creates");
        std::fs::create_dir_all(&outside).expect("outside dir creates");

        let real_db = outside.join("master.sqlite");
        Connection::open(&real_db)
            .expect("seed database creates")
            .execute_batch(
                r#"CREATE TABLE history_entry (
                       id INTEGER PRIMARY KEY, session_id INTEGER, bpm REAL,
                       key_value INTEGER, "key" TEXT, genre TEXT, start_time INTEGER
                   );"#,
            )
            .expect("seed schema writes");

        let link = root.join("master.sqlite");
        std::os::unix::fs::symlink(&real_db, &link).expect("symlink creates");

        let result = open_read_only(&root, &link);
        let is_scope_error = matches!(result, Err(OpenError::Scope(_)));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);

        assert!(
            is_scope_error,
            "a symlinked-outside master.sqlite must be refused as a scope violation"
        );
    }

    /// Story 2.7 code review: `root == path` is the live shape `watch_loop` passes
    /// whenever the confirmed override round-trips through `classify()`'s
    /// file-path branch (the common Serato 4+ case — `install_path` renders that
    /// confirmation as the literal `master.sqlite` path). A naive scope check
    /// comparing a path to itself would always trivially pass; this proves a
    /// symlinked-in `master.sqlite` planted at that exact configured path is
    /// still refused, because the guard scopes against the parent directory
    /// instead of the file-shaped root.
    #[cfg(unix)]
    #[test]
    fn open_read_only_refuses_a_symlinked_root_equal_to_path() {
        let root_dir = std::env::temp_dir().join(format!(
            "curfew_joiner_scope_root_eq_path_{}_1",
            std::process::id()
        ));
        let outside = std::env::temp_dir().join(format!(
            "curfew_joiner_scope_outside_eq_path_{}_1",
            std::process::id()
        ));
        std::fs::create_dir_all(&root_dir).expect("root dir creates");
        std::fs::create_dir_all(&outside).expect("outside dir creates");

        let real_db = outside.join("master.sqlite");
        Connection::open(&real_db)
            .expect("seed database creates")
            .execute_batch(
                r#"CREATE TABLE history_entry (
                       id INTEGER PRIMARY KEY, session_id INTEGER, bpm REAL,
                       key_value INTEGER, "key" TEXT, genre TEXT, start_time INTEGER
                   );"#,
            )
            .expect("seed schema writes");

        // The configured override IS the master.sqlite path itself (file-shaped
        // root), and that same path is also what gets opened — exactly what
        // `watch_loop` passes as both `root` and `path`.
        let link = root_dir.join("master.sqlite");
        std::os::unix::fs::symlink(&real_db, &link).expect("symlink creates");

        let result = open_read_only(&link, &link);
        let is_scope_error = matches!(result, Err(OpenError::Scope(_)));
        let _ = std::fs::remove_dir_all(&root_dir);
        let _ = std::fs::remove_dir_all(&outside);

        assert!(
            is_scope_error,
            "a symlinked master.sqlite passed as both root and path must still be refused, got {result:?}"
        );
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

        assert!(open_read_only(&std::env::temp_dir(), &path).is_err());
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

        let result = open_read_only(&std::env::temp_dir(), &path)
            .map_err(|e| e.to_string())
            .and_then(|conn| join_session(&conn, 7).map_err(|e| e.to_string()));
        let _ = std::fs::remove_file(&path);

        assert!(result.is_err());
    }
}
