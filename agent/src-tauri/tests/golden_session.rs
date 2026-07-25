//! Golden-file regression tests for the legacy `.session` parser (Story 1.9, AC-1/2/3).
//!
//! Each fixture under `tests/fixtures/session/` is a checked-in, hand-built synthetic
//! `.session` file (never real DJ data — see `parser/mod.rs`'s fixture-ownership
//! comment). These tests exercise the file-reading entry points
//! (`parse_session_file`/`parse_session_file_partial`), not just `parse`/`parse_partial`
//! on in-memory bytes, so a future format-decode regression is caught the same way a
//! real caller would hit it.
//!
//! Real-data reconnaissance for this story (Task 1) ran the strict `parse_session_file`
//! path over all 474 real `.session` files in this DJ's `~/Music/_Serato_/History/Sessions/`
//! and found zero `Desync`/`Truncated` occurrences — see `deferred-work.md`'s "RF-2's
//! trailing-fragment hard failure" entry. There is no real trailing-padding shape to
//! model a fixture on, so `desync_bad_header.session` below is synthetic worst-case
//! coverage (proving the guard still fires correctly), not a reproduction of an
//! observed real file.

use agent_lib::parser::{self, ParseError, Play};

fn fixture_path(name: &str) -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/session")
        .join(name)
}

/// AC-1/AC-3: a normal multi-play session — full field coverage on one play, minimal
/// fields on another, no-artist on a third — parses to the exact expected `Vec<Play>`,
/// in start-time order, with the leading `vrsn` header skipped.
#[test]
fn golden_multi_play_session_parses_expected_plays() {
    let path = fixture_path("multi_play.session");
    let plays = parser::parse_session_file(&path).expect("golden multi_play.session parses");

    let expected = vec![
        Play {
            path: Some("/music/a.mp3".to_string()),
            title: Some("Title A".to_string()),
            artist: Some("Artist A".to_string()),
            label: Some("Label A".to_string()),
            genre: Some("House".to_string()),
            grouping: Some("Warmup".to_string()),
            year: Some("2021".to_string()),
            start_time: Some(1_000),
            deck: Some(1),
            duration_sec: Some(180),
            key: Some("8A".to_string()),
        },
        Play {
            path: Some("/music/c.mp3".to_string()),
            title: Some("Title C".to_string()),
            artist: None,
            label: None,
            genre: None,
            grouping: None,
            year: None,
            start_time: Some(2_000),
            deck: Some(1),
            duration_sec: None,
            key: None,
        },
        Play {
            path: Some("/music/b.mp3".to_string()),
            title: Some("Title B".to_string()),
            artist: Some("Artist B".to_string()),
            label: None,
            genre: None,
            grouping: None,
            year: None,
            start_time: Some(3_000),
            deck: Some(2),
            duration_sec: None,
            key: None,
        },
    ];

    assert_eq!(
        plays, expected,
        "start-time order: a (1000), c (2000), b (3000)"
    );
}

/// AC-1/AC-2: a checked-in fixture exercising the duplicate-row-by-row-ID dedup path —
/// the same case `dedups_duplicate_rows_by_row_id_preserving_order` proves inline,
/// permanently guarded here as a golden file per this story's own charter.
#[test]
fn golden_duplicate_row_id_session_dedups_by_row_id() {
    let path = fixture_path("duplicate_row_id.session");
    let plays = parser::parse_session_file(&path).expect("golden duplicate_row_id.session parses");

    let expected = vec![
        Play {
            path: Some("/music/dup.mp3".to_string()),
            title: Some("Dup".to_string()),
            artist: Some("Artist".to_string()),
            label: None,
            genre: None,
            grouping: None,
            year: None,
            start_time: Some(5_000),
            deck: Some(1),
            duration_sec: None,
            key: None,
        },
        Play {
            path: Some("/music/other.mp3".to_string()),
            title: Some("Other".to_string()),
            artist: Some("Artist2".to_string()),
            label: None,
            genre: None,
            grouping: None,
            year: None,
            start_time: Some(6_000),
            deck: Some(2),
            duration_sec: None,
            key: None,
        },
    ];

    assert_eq!(
        plays, expected,
        "duplicate row_id counted once, first occurrence wins, remaining order preserved"
    );
}

/// AC-1/AC-2: a top-level header record whose declared length understates its own
/// payload leaves the walk mid-stream at a non-record boundary — a hard `Desync`, never
/// a silently wrong `Ok`. Uses the header-understatement technique (not a short `oent`,
/// which the inner `adat` bound catches first as `Truncated` instead — see
/// deferred-work.md's fixture-construction gotcha from Story 1.3's review).
#[test]
fn golden_desync_bad_header_session_fails_loud() {
    let path = fixture_path("desync_bad_header.session");
    let result = parser::parse_session_file(&path);

    assert!(
        matches!(result, Err(ParseError::Desync { offset: 10 })),
        "expected Desync at offset 10, got {result:?}"
    );
}

/// AC-1/AC-2: a field whose declared length overruns its enclosing `adat` bound is a
/// hard `Truncated`, never a panic or a silently clamped read.
#[test]
fn golden_truncated_field_session_fails_loud() {
    let path = fixture_path("truncated_field.session");
    let result = parser::parse_session_file(&path);

    assert!(
        matches!(result, Err(ParseError::Truncated { .. })),
        "expected Truncated, got {result:?}"
    );
}

/// AC-1: `parse_session_file_partial` on the same desync fixture still returns the
/// plays decoded before the failure — the tolerant entry point's whole reason to exist
/// (RF-5) — while the strict entry point above voids the file.
#[test]
fn golden_desync_bad_header_session_partial_returns_no_plays_before_the_desync() {
    let path = fixture_path("desync_bad_header.session");
    let outcome = parser::parse_session_file_partial(&path)
        .expect("a readable file is never Err from the partial entry point");

    assert_eq!(
        outcome.plays.len(),
        0,
        "the desync is in the leading header, before any oent record"
    );
    assert!(matches!(
        outcome.error,
        Some(ParseError::Desync { offset: 10 })
    ));
}
