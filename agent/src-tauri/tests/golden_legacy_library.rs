//! Golden-file regression tests for the legacy `database V2` library join (Story 1.9,
//! AC-1/2/3).
//!
//! `normal_catalogue.database` is a direct copy of `triseratops`' own MPL-2.0 test
//! fixture (`tests/data/library/usb_drive/_Serato_/database V2` at the pinned commit
//! `8e92aae1794c4f02a2405eb88ea72f251b077f0c`) — small, already-synthetic, non-personal,
//! and license-compatible (AD-11 already adopted MPL-2.0 for this dependency). Using it
//! avoids reverse-engineering `database V2`'s byte shape from zero; see this story's
//! Task 3 notes. The other two fixtures are hand-built with the same tag/length/value
//! envelope `joiner::legacy`'s own inline tests already use.
//!
//! Tests call [`LegacyLibrary::from_database_bytes`] directly on fixture bytes read via
//! `std::fs::read` — the same decode path [`LegacyLibrary::load`] uses, without needing
//! a full `<library_root>/_Serato_/database V2` directory shape on disk.

use agent_lib::joiner::legacy::LegacyLibrary;
use agent_lib::joiner::{self, JoinedMetadata};
use agent_lib::parser::Play;

fn read_fixture(name: &str) -> Vec<u8> {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/legacy_library")
        .join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("read fixture {name}: {e}"))
}

fn play_at(path: &str) -> Play {
    Play {
        path: Some(path.to_string()),
        ..Play::default()
    }
}

/// AC-1/AC-3: `triseratops`' own upstream catalogue fixture (4 tracks, collectively
/// covering BPM/key/genre) decodes to the exact expected `LegacyLibrary`, verified via
/// its public surface (`len()`, and joining a synthetic play against each track).
#[test]
fn golden_normal_catalogue_resolves_bpm_key_and_genre() {
    let bytes = read_fixture("normal_catalogue.database");
    let library = LegacyLibrary::from_database_bytes(&bytes)
        .expect("golden normal_catalogue.database decodes");

    assert_eq!(library.len(), 4, "four distinct-path tracks");

    let track1 = joiner::legacy::join(
        &play_at("/CASSIUS_-_99_Keller 2016 RE-EDIT -.mp3"),
        &library,
    );
    assert_eq!(
        track1,
        JoinedMetadata {
            in_library: true,
            bpm: Some(126.0),
            key: Some("Bb".to_string()),
            genre: None,
        }
    );

    let track2 = joiner::legacy::join(
        &play_at(
            "/Lipps, Inc-Funky Town meets Joris Voorn-Spank The Maid - Mood Funk - Mash_Up.mp3",
        ),
        &library,
    );
    assert_eq!(
        track2,
        JoinedMetadata {
            in_library: true,
            bpm: Some(126.0),
            key: Some("C#m".to_string()),
            genre: Some("Funky Tech".to_string()),
        }
    );

    let track3 = joiner::legacy::join(
        &play_at("/Pete Heller - Big Love (Vaudafunk 2019 Reinterpretation).mp3"),
        &library,
    );
    assert_eq!(
        track3,
        JoinedMetadata {
            in_library: true,
            bpm: Some(123.0),
            key: Some("Am".to_string()),
            genre: None,
        }
    );

    let track4 = joiner::legacy::join(
        &play_at("/ALAN BRAXE - INTRO ( Max Padovani Remix).mp3"),
        &library,
    );
    assert_eq!(
        track4,
        JoinedMetadata {
            in_library: true,
            bpm: Some(124.0),
            key: Some("Fm".to_string()),
            genre: None,
        }
    );
}

/// AC-1/AC-2: a track record with no file path has no join key and must not be
/// indexed — permanent golden coverage for the same discipline
/// `track_record_without_a_path_is_not_indexed` proves inline.
#[test]
fn golden_no_file_path_track_is_not_indexed() {
    let bytes = read_fixture("no_file_path.database");
    let library =
        LegacyLibrary::from_database_bytes(&bytes).expect("golden no_file_path.database decodes");

    assert_eq!(library.len(), 1, "only the path-bearing track is indexed");

    let joined = joiner::legacy::join(&play_at("/Users/arjun/Music/a.mp3"), &library);
    assert_eq!(
        joined,
        JoinedMetadata {
            in_library: true,
            bpm: Some(128.0),
            key: Some("1A".to_string()),
            genre: Some("House".to_string()),
        }
    );
}

/// AC-1/AC-2: two catalogue records sharing the same path — a re-analysed track —
/// resolve to the last-processed record's fields, documenting today's implementation.
///
/// **Not real-data-confirmed.** This story's Task 1 (real-data reconnaissance, check 3)
/// scanned this DJ's local `database V2` (930 track records) and found zero duplicate
/// paths; the larger USB catalogue that might hold a genuine re-analysed duplicate was
/// unavailable (SSD not mounted). Per deferred-work.md, this fixture documents the
/// current last-wins assumption rather than a confirmed real shape — see the
/// "Duplicate-path last-wins tiebreak" entry.
#[test]
fn golden_duplicate_path_resolves_to_the_last_record() {
    let bytes = read_fixture("duplicate_path.database");
    let library =
        LegacyLibrary::from_database_bytes(&bytes).expect("golden duplicate_path.database decodes");

    assert_eq!(library.len(), 1, "one path is one entry, not two");

    let joined = joiner::legacy::join(&play_at("/Users/arjun/Music/dupe.mp3"), &library);
    assert_eq!(joined.bpm, Some(128.0), "the later record's BPM wins");
    assert_eq!(joined.genre.as_deref(), Some("Fresh"));
    assert_eq!(joined.key.as_deref(), Some("8B"));
}
