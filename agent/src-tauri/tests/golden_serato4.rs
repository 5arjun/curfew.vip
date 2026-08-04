//! Golden-file regression tests for the Serato 4+ `master.sqlite` play-log read and
//! library join (Story 1.9, AC-1/2/3).
//!
//! The fixture is a checked-in `.sql` script rather than a binary `.sqlite` file:
//! git-diffable/human-reviewable, matches the existing in-memory-schema pattern both
//! `parser::serato4::in_memory_history()` and `joiner::serato4::in_memory_history()`
//! already use, and avoids a SQLite page-format/version mismatch risk a hand-crafted
//! binary file would carry (`rusqlite`'s bundled SQLite version is pinned by the crate).
//!
//! This is also the one live exercise of the connection-sharing contract deferred-work.md
//! flags as untested: one `Connection` opened here is passed to **both**
//! `parser::read_session` and `joiner::serato4::join_session` against the same session ID.
//!
//! **Story 3.7 refresh.** Story 3.6 moved key off the play-log read (`Play.key` is
//! deliberately `None` for serato4; the joiner derives Camelot from `key_value`) but
//! never updated this golden suite, which had been failing since — caught and fixed
//! forward here. The fixture now matches the live-verified real schema (Story 3.7 §3d:
//! `key_value`, `end_time`, `played`, `length_ms`/`length_sec`, `portable_id`), and the
//! expectations pin both the 3.6 key-source rule and the 3.7 capture-pass fields at
//! golden level.

use agent_lib::joiner::serato4::join_session;
use agent_lib::joiner::JoinedMetadata;
use agent_lib::parser::{read_session, Play};
use rusqlite::Connection;

const SESSION_ID: i64 = 42;

fn load_fixture() -> Connection {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/serato4/history_session_and_entries.sql");
    let sql = std::fs::read_to_string(&path).expect("read golden_serato4 fixture");
    let conn = Connection::open_in_memory().expect("in-memory database opens");
    conn.execute_batch(&sql)
        .expect("golden fixture SQL applies");
    conn
}

/// AC-1/AC-2/AC-3: one connection shared between `parser::read_session` and
/// `joiner::serato4::join_session` against the same fixture and session ID — both
/// functions' exact output asserted, including the confirmed-real `end_time = -1`
/// sentinel + empty-string "absent" convention (row 2, also the `played = 0` preview)
/// and the multi-deck range "1"-"4" real data confirms occurs.
#[test]
fn golden_session_reads_and_joins_match_expected_output() {
    let conn = load_fixture();

    let plays = read_session(&conn, SESSION_ID).expect("read_session succeeds");
    assert_eq!(
        plays,
        vec![
            Play {
                path: None,
                title: Some("Track A".to_string()),
                artist: Some("Artist A".to_string()),
                label: None,
                genre: Some("House".to_string()),
                grouping: None,
                year: None,
                start_time: Some(1_000),
                deck: Some(1),
                duration_sec: None,
                // Story 3.6: the play-log read never yields a key for serato4 —
                // the fixture's musical free-text `"key"` must stay unread; the
                // Camelot key arrives via join_session's key_value mapping below.
                key: None,
            },
            Play {
                path: None,
                title: Some("Track B".to_string()),
                artist: Some("Artist B".to_string()),
                label: None,
                genre: None,
                grouping: None,
                year: None,
                start_time: Some(2_000),
                deck: Some(2),
                duration_sec: None,
                key: None,
            },
            Play {
                path: None,
                title: Some("Track C".to_string()),
                artist: Some("Artist C".to_string()),
                label: None,
                genre: Some("Techno".to_string()),
                grouping: None,
                year: None,
                start_time: Some(3_000),
                deck: Some(3),
                duration_sec: None,
                key: None,
            },
            Play {
                path: None,
                title: Some("Track D".to_string()),
                artist: Some("Artist D".to_string()),
                label: None,
                genre: Some("Disco".to_string()),
                grouping: None,
                year: None,
                start_time: Some(4_000),
                deck: Some(4),
                duration_sec: None,
                key: None,
            },
        ],
        "row 2's empty-string genre resolves to None, not Some(\"\"); serato4 Play.key is always None (Story 3.6)"
    );

    let joined = join_session(&conn, SESSION_ID).expect("join_session succeeds");
    assert_eq!(
        joined,
        vec![
            (
                1,
                JoinedMetadata {
                    in_library: true,
                    bpm: Some(128.0),
                    // key_value 0 → 1A; the musical free-text "G#m" must not win.
                    key: Some("1A".to_string()),
                    genre: Some("House".to_string()),
                    ended_at: Some(1_180),
                    played: Some(true),
                    total_length_ms: Some(372_000),
                    portable_path: Some("Users/arjun/Music/a.mp3".to_string()),
                    library_added_at: None,
                }
            ),
            (
                2,
                JoinedMetadata {
                    in_library: true,
                    bpm: Some(126.5),
                    // key_value -1 = Serato's no-key sentinel.
                    key: None,
                    genre: None,
                    // end_time -1 = unset; played 0 = loaded-but-never-played
                    // preview; empty portable_id = absent.
                    ended_at: None,
                    played: Some(false),
                    total_length_ms: None,
                    portable_path: None,
                    library_added_at: None,
                }
            ),
            (
                3,
                JoinedMetadata {
                    in_library: true,
                    bpm: Some(140.0),
                    // key_value 3 → 4A.
                    key: Some("4A".to_string()),
                    genre: Some("Techno".to_string()),
                    ended_at: Some(3_300),
                    played: Some(true),
                    // length_ms NULL → length_sec × 1000 fallback.
                    total_length_ms: Some(301_000),
                    portable_path: Some("A Indian/c.mp3".to_string()),
                    library_added_at: None,
                }
            ),
            (
                4,
                JoinedMetadata {
                    in_library: true,
                    bpm: Some(118.0),
                    // key_value 1 → 2A.
                    key: Some("2A".to_string()),
                    genre: Some("Disco".to_string()),
                    ended_at: Some(4_290),
                    played: Some(true),
                    total_length_ms: Some(245_000),
                    portable_path: Some("Users/arjun/Music/d.mp3".to_string()),
                    library_added_at: None,
                }
            ),
        ],
        "join_session's ids correlate 1:1 with read_session's row order for this fixture"
    );

    // The connection-sharing contract: both functions ran against the one Connection
    // opened above, exactly as production code is expected to share it (see
    // parser::serato4's module doc).
    assert_eq!(plays.len(), joined.len());
}
