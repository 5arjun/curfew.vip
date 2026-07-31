//! Pipeline orchestration (Story 2.8, AC-1): the first real caller of Stories
//! 1.3/1.3b/1.4/1.5/1.6/1.7/1.8's engine, wiring parse -> join ->
//! embedded-tag-fallback -> enrich -> stat -> confidence into one
//! `(Vec<store::CapturedPlay>, store::CapturedDerived)` per completed session,
//! plus the session-identity (AC-3) and completion-signal (AC-4) pure
//! functions [`crate::watcher`] drives from the live watch loop.
//!
//! **Not a pipeline stage of its own.** This module is the glue Story 1.10
//! left for "whoever wires `stats -> local store -> sync-queue`" (the local
//! store half; Story 3.2 is the sync-queue half) — it does not reimplement
//! parsing, joining, genre normalization, stat computation, or confidence
//! classification, only calls the existing functions in order.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::joiner::embedded_tags::fill_gaps;
use crate::joiner::legacy::LegacyLibrary;
use crate::joiner::serato4::open_read_only;
use crate::joiner::JoinedMetadata;
use crate::parser::Play;
use crate::stats::camelot::{CamelotKey, Letter};
use crate::stats::{self, EnrichedPlay, TrackIdentity};
use crate::store::{
    CapturedArtistCount, CapturedBpmDistribution, CapturedCamelotMixingStats, CapturedConfidence,
    CapturedDerived, CapturedEnergyPoint, CapturedGenre, CapturedGenreBreakdown,
    CapturedGenreBucket, CapturedPlay, CapturedSubgenreBreakdown, CapturedSubgenreBucket,
    CapturedTrackCount,
};

/// Everything that can go wrong building a captured session from raw sources.
/// Mirrors this crate's small-enum `Display`/`std::error::Error` idiom.
#[derive(Debug)]
pub enum CaptureError {
    Parse(crate::parser::ParseError),
    Join(crate::joiner::legacy::JoinError),
    Open(crate::joiner::serato4::OpenError),
    Sqlite(rusqlite::Error),
    /// A session with zero plays has nothing to capture. This *is* the
    /// reachable outcome of `build_serato4`/`build_legacy`'s own empty checks
    /// by design (Task 4: "there is no session to capture at all; skip it
    /// rather than inventing an identity for nothing") — kept as a named
    /// variant rather than folded into `Ok((vec![], ..))`, so a caller cannot
    /// mistake "found nothing to persist" for "persisted an empty set".
    EmptySession,
    /// `read_session`/`join_session` returned different row counts for the
    /// same `session_id` — the connection-sharing contract's `ORDER BY`
    /// clauses no longer agree, or the underlying table changed between the
    /// two queries. A positional zip under this condition would silently
    /// misattribute one play's metadata to another (the exact AD-11 failure
    /// class this check exists to prevent) — fail loud instead.
    Correlation {
        plays: usize,
        joined: usize,
    },
}

impl std::fmt::Display for CaptureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CaptureError::Parse(e) => write!(f, "capture: session parse failed: {e}"),
            CaptureError::Join(e) => write!(f, "capture: library join failed: {e}"),
            CaptureError::Open(e) => write!(f, "capture: database open failed: {e}"),
            CaptureError::Sqlite(e) => write!(f, "capture: query failed: {e}"),
            CaptureError::EmptySession => write!(f, "capture: session has no plays, nothing to capture"),
            CaptureError::Correlation { plays, joined } => write!(
                f,
                "capture: play/metadata row count mismatch ({plays} plays, {joined} joined) — refusing to zip positionally"
            ),
        }
    }
}

impl std::error::Error for CaptureError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            CaptureError::Parse(e) => Some(e),
            CaptureError::Join(e) => Some(e),
            CaptureError::Open(e) => Some(e),
            CaptureError::Sqlite(e) => Some(e),
            CaptureError::EmptySession | CaptureError::Correlation { .. } => None,
        }
    }
}

// ---- Session identity (Task 4, AC-3) ---------------------------------------

/// Serato4's local dedup key: `history_session.id` is Serato's own
/// auto-increment primary key, immutable once assigned and never derived from
/// a file mtime/name/path — satisfies AD-16's "immutable start-anchor" rule
/// directly, no computation needed.
pub fn serato4_session_identity(session_id: i64) -> String {
    format!("serato4:{session_id}")
}

/// The `raw_ref` this story records for a Serato4 capture (Task 5: "no
/// separate 'raw file' to retain — the live `master.sqlite` already is the
/// durable source").
pub fn serato4_raw_ref(db_path: &Path, session_id: i64) -> String {
    format!("{}#{session_id}", db_path.display())
}

/// The inverse of [`serato4_raw_ref`]'s id half — recovers the session id from
/// a stored `raw_ref`, used to reload the pending-serato4-id tracker from
/// `'watching'` rows on a restart (Task 4).
pub fn parse_serato4_raw_ref(raw_ref: &str) -> Option<i64> {
    raw_ref.rsplit_once('#')?.1.parse().ok()
}

/// FNV-1a over `first_play`'s path + start_time — deliberately *not*
/// `std::collections::hash_map::DefaultHasher`, whose own documentation
/// disclaims any stability guarantee across Rust versions/compilations. This
/// result is persisted as a `UNIQUE`-constrained dedup key in SQLite (Task 4),
/// so it must hash the same way for the same input on every future run of
/// this binary, however it was built — FNV-1a's algorithm is fixed by
/// definition, not an implementation detail of any one Rust release.
fn fnv1a_hex(bytes: &[u8]) -> String {
    const FNV_OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;

    let mut hash = FNV_OFFSET_BASIS;
    for byte in bytes {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    format!("{hash:016x}")
}

/// Legacy's local dedup key: no `history_session`-equivalent table exists for
/// this format, so identity is derived from the session's own first-play
/// identity (AD-16's literal phrase) — `first_play`'s path + start_time,
/// hashed. Not a security boundary, just a stable local dedup key, so any
/// deterministic *and cross-build-stable* hash suffices (see [`fnv1a_hex`]).
///
/// Callers must not invoke this on an empty play list — a session with zero
/// plays has no first-play identity to derive from and should be skipped
/// before ever reaching here (see [`build_legacy`]).
pub fn legacy_session_identity(first_play: &Play) -> String {
    let mut bytes = Vec::new();
    if let Some(path) = &first_play.path {
        bytes.extend_from_slice(path.as_bytes());
    }
    bytes.push(0); // separator, so path="1" + start_time=23 can't collide with path="12" + start_time=3
    if let Some(start_time) = first_play.start_time {
        bytes.extend_from_slice(&start_time.to_be_bytes());
    }
    format!("legacy:{}", fnv1a_hex(&bytes))
}

// ---- Completion signal (Task 4, AC-4) --------------------------------------

/// Serato4's completion signal: `history_session.end_time` transitioning from
/// unset (`-1`, Story 1.3b's confirmed real-data sentinel — not SQL `NULL`) to
/// a real (non-negative) value.
pub fn serato4_end_time_resolved(end_time: Option<i64>) -> bool {
    matches!(end_time, Some(t) if t >= 0)
}

/// How long a legacy `.session` file must go without a modify event before it
/// is considered complete (Task 4).
///
/// `[ASSUMPTION]` — no prior story or research doc pins this number. 15
/// minutes is long enough that a DJ's between-tracks silence or a bathroom
/// break never falsely completes a set, short enough that a session completes
/// within the same session as the gig for a same-morning dashboard view.
/// Flagged in Completion Notes for Arjun, same as `confidence.rs`'s
/// `LONG_GAP_THRESHOLD_SEC` was flagged.
pub const LEGACY_QUIET_PERIOD_SEC: u64 = 15 * 60;

/// Legacy's completion signal: no modify event observed for
/// [`LEGACY_QUIET_PERIOD_SEC`]. Takes explicit `last_modified`/`now` values
/// (rather than reading the clock itself) so tests can inject a fake "now"
/// instead of sleeping the test thread for real minutes.
pub fn legacy_quiet_period_elapsed(last_modified: SystemTime, now: SystemTime) -> bool {
    now.duration_since(last_modified)
        .map(|elapsed| elapsed.as_secs() >= legacy_quiet_period_sec())
        .unwrap_or(false)
}

/// The quiet-period threshold in seconds — normally [`LEGACY_QUIET_PERIOD_SEC`]
/// (15 min), but in **debug builds only** overridable via
/// `CURFEW_DEBUG_QUIET_PERIOD_SEC` so a legacy set can be captured seconds after
/// the last write instead of forcing a real 15-minute wait during a manual
/// end-to-end walkthrough. Compiled out entirely in release: release builds
/// always return [`LEGACY_QUIET_PERIOD_SEC`].
fn legacy_quiet_period_sec() -> u64 {
    #[cfg(debug_assertions)]
    {
        if let Ok(raw) = std::env::var("CURFEW_DEBUG_QUIET_PERIOD_SEC") {
            if let Ok(secs) = raw.parse::<u64>() {
                return secs;
            }
        }
    }
    LEGACY_QUIET_PERIOD_SEC
}

// ---- Pipeline wiring (Task 5, AC-1) -----------------------------------------

/// Builds one completed legacy session's captured plays + derived stats.
///
/// `parser::parse_session_file_partial` (the tolerant entry point) is used
/// even though a session captured at quiet-period completion is, by
/// construction, no longer being appended to — using the `_partial` variant
/// costs nothing and is consistent with this crate's "never let a single
/// malformed trailing record void an otherwise-good capture" tolerance
/// philosophy. `library_root` is the DJ's confirmed Serato root — the folder
/// *containing* `_Serato_` (`LegacyLibrary::load` joins `_Serato_/database V2`
/// onto it itself).
pub fn build_legacy(
    library_root: &Path,
    session_path: &Path,
) -> Result<(Vec<CapturedPlay>, CapturedDerived), CaptureError> {
    let outcome =
        crate::parser::parse_session_file_partial(session_path).map_err(CaptureError::Parse)?;
    if outcome.plays.is_empty() {
        return Err(CaptureError::EmptySession);
    }

    let library = LegacyLibrary::load(library_root).map_err(CaptureError::Join)?;
    let pairs: Vec<(Play, JoinedMetadata)> = outcome
        .plays
        .into_iter()
        .map(|play| {
            let joined = crate::joiner::legacy::join(&play, &library);
            let joined = fill_gaps(joined, play.path.as_deref());
            (play, joined)
        })
        .collect();

    Ok(assemble(&pairs))
}

/// Builds one completed Serato4 session's captured plays + derived stats.
///
/// Opens a single `Connection` shared by both `parser::read_session` (ordered
/// plays) and `joiner::serato4::join_session` (ordered metadata) — per
/// `parser::serato4`'s own module doc, this is the intended connection-sharing
/// contract, previously unexercised by any real caller. Both queries carry the
/// identical `ORDER BY start_time ASC, id ASC` clause over the same
/// `session_id`, so a positional zip is provably correlated as long as the row
/// counts agree (checked below) — see this module's tests for the tied-
/// `start_time` case this closes.
pub fn build_serato4(
    root: &Path,
    db_path: &Path,
    session_id: i64,
) -> Result<(Vec<CapturedPlay>, CapturedDerived), CaptureError> {
    let conn = open_read_only(root, db_path).map_err(CaptureError::Open)?;
    let plays = crate::parser::read_session(&conn, session_id).map_err(CaptureError::Sqlite)?;
    let joined =
        crate::joiner::serato4::join_session(&conn, session_id).map_err(CaptureError::Sqlite)?;

    if plays.is_empty() {
        return Err(CaptureError::EmptySession);
    }
    if plays.len() != joined.len() {
        return Err(CaptureError::Correlation {
            plays: plays.len(),
            joined: joined.len(),
        });
    }

    let pairs: Vec<(Play, JoinedMetadata)> = plays
        .into_iter()
        .zip(joined.into_iter().map(|(_, metadata)| metadata))
        .map(|(play, joined)| {
            // Mirrors `build_legacy`'s fallback step for pipeline symmetry.
            // Currently a guaranteed no-op: `read_session` never populates
            // `Play.path` for Serato4 (no path column on `history_entry`),
            // and `fill_gaps` requires `Some(path)` to do anything — but this
            // keeps both source paths running the identical stage list `assemble`'s
            // doc comment describes, and costs nothing if that ever changes.
            let joined = fill_gaps(joined, play.path.as_deref());
            (play, joined)
        })
        .collect();

    Ok(assemble(&pairs))
}

/// The session's time bounds, from its captured plays' `started_at` — the
/// first and last play's start time, matching the schema's own
/// `started_at`/`ended_at` doc comments ("first/last known play start_time").
pub fn session_bounds(plays: &[CapturedPlay]) -> (Option<i64>, Option<i64>) {
    let started = plays.first().and_then(|p| p.started_at).map(i64::from);
    let ended = plays.last().and_then(|p| p.started_at).map(i64::from);
    (started, ended)
}

/// The shared per-play assembly logic both source paths converge on: embedded-
/// tag fallback has already run by the time this is called, so from here it is
/// `enrich_session` -> every stat function -> `confidence::classify` -> the
/// local DTOs, written once rather than duplicated per source.
fn assemble(pairs: &[(Play, JoinedMetadata)]) -> (Vec<CapturedPlay>, CapturedDerived) {
    let enriched = stats::enrich_session(pairs);

    let captured_plays: Vec<CapturedPlay> = enriched
        .iter()
        .zip(pairs.iter())
        .enumerate()
        .map(|(i, (enriched_play, (_, joined)))| CapturedPlay {
            position: i + 1,
            title: enriched_play.title.clone(),
            artist: enriched_play.artist.clone(),
            started_at: enriched_play.start_time,
            bpm: enriched_play.bpm,
            genre: enriched_play.genre.as_ref().map(|g| CapturedGenre {
                raw: g.raw.clone(),
                subgenre: g.subgenre.clone(),
                normalized: g.normalized.clone(),
                taxonomy_version: g.taxonomy_version,
            }),
            camelot_key: enriched_play.camelot.map(render_camelot_key),
            in_library: joined.in_library,
        })
        .collect();

    let genre_breakdown = stats::genre_breakdown(&enriched);
    let subgenre_breakdown = stats::subgenre_breakdown(&enriched);
    let bpm_distribution = stats::bpm_distribution(&enriched);
    let camelot_mixing_stats = stats::camelot::mixing_stats(&enriched);
    let confidence = crate::confidence::classify(&enriched);

    let derived = CapturedDerived {
        most_played_tracks: captured_most_played_tracks(&enriched),
        most_played_artists: stats::most_played_artists(&enriched)
            .into_iter()
            .map(|(artist, play_count)| CapturedArtistCount { artist, play_count })
            .collect(),
        genre_breakdown: CapturedGenreBreakdown {
            buckets: genre_breakdown
                .buckets
                .into_iter()
                .map(|(genre, play_count)| CapturedGenreBucket { genre, play_count })
                .collect(),
            no_genre_count: genre_breakdown.no_genre_count,
        },
        subgenre_breakdown: CapturedSubgenreBreakdown {
            buckets: subgenre_breakdown
                .buckets
                .into_iter()
                .map(|(subgenre, genre, play_count)| CapturedSubgenreBucket {
                    subgenre,
                    genre,
                    play_count,
                })
                .collect(),
            no_genre_count: subgenre_breakdown.no_genre_count,
        },
        bpm_distribution: CapturedBpmDistribution {
            count: bpm_distribution.count,
            min: bpm_distribution.min,
            max: bpm_distribution.max,
            mean: bpm_distribution.mean,
            median: bpm_distribution.median,
        },
        camelot_mixing_stats: CapturedCamelotMixingStats {
            compatible_transitions: camelot_mixing_stats.compatible_transitions,
            incompatible_transitions: camelot_mixing_stats.incompatible_transitions,
            excluded_no_key: camelot_mixing_stats.excluded_no_key,
        },
        set_length_sec: stats::set_length_sec(&enriched),
        track_count: stats::track_count(&enriched),
        energy_arc: stats::energy_arc(&enriched)
            .into_iter()
            .map(|p| CapturedEnergyPoint {
                started_at: p.start_time,
                bpm: p.bpm,
            })
            .collect(),
        confidence: CapturedConfidence {
            value: confidence.confidence,
            track_count: confidence.track_count,
            long_gap_count: confidence.long_gap_count,
        },
    };

    (captured_plays, derived)
}

/// The same `TrackIdentity` computation `stats::most_played_tracks` uses
/// internally (`TrackIdentity::for_play`, not `pub`) — duplicated here as a
/// four-line match over `TrackIdentity`'s own public variants rather than
/// widening that function's visibility, since this is a pure re-derivation of
/// public data, not new logic.
fn identity_of(play: &EnrichedPlay) -> TrackIdentity {
    match &play.path {
        Some(path) => TrackIdentity::Path(path.clone()),
        None => TrackIdentity::TitleArtist(play.title.clone(), play.artist.clone()),
    }
}

/// Projects `stats::most_played_tracks`'s ranked `TrackIdentity` list down to
/// `{title, artist, play_count}` for the local store — mirrors
/// `SyncSetDerived.most_played_tracks`'s own doc comment ("ranked edge-side
/// using the full `TrackIdentity` ... then projected down ... for the wire").
/// Title/artist come from the first play seen carrying that identity.
fn captured_most_played_tracks(enriched: &[EnrichedPlay]) -> Vec<CapturedTrackCount> {
    let mut first_seen: std::collections::HashMap<TrackIdentity, &EnrichedPlay> =
        std::collections::HashMap::new();
    for play in enriched {
        first_seen.entry(identity_of(play)).or_insert(play);
    }

    stats::most_played_tracks(enriched)
        .into_iter()
        .map(|(identity, play_count)| {
            let representative = first_seen.get(&identity);
            CapturedTrackCount {
                title: representative.and_then(|p| p.title.clone()),
                artist: representative.and_then(|p| p.artist.clone()),
                play_count,
            }
        })
        .collect()
}

/// Renders a `CamelotKey` to its notation string (e.g. `"8A"`) for the
/// store/wire boundary — a string on `CapturedPlay`, not the two-field Rust
/// struct.
fn render_camelot_key(key: CamelotKey) -> String {
    let letter = match key.letter {
        Letter::A => 'A',
        Letter::B => 'B',
    };
    format!("{}{}", key.number, letter)
}

/// Legacy library root resolution: `watcher::detect::classify` returns the
/// `_Serato_` folder itself as `SeratoInstall::Legacy(path)` — `join`'s
/// library root is that folder's *parent* (`LegacyLibrary::load` joins
/// `_Serato_/database V2` onto whatever root it is given).
pub fn library_root_from_serato_dir(serato_dir: &Path) -> PathBuf {
    serato_dir.parent().unwrap_or(serato_dir).to_path_buf()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    // ---- Session identity -------------------------------------------------

    #[test]
    fn serato4_identity_is_format_prefixed() {
        assert_eq!(serato4_session_identity(42), "serato4:42");
    }

    #[test]
    fn serato4_raw_ref_round_trips_the_session_id() {
        let db_path = Path::new("/Users/dj/Music/master.sqlite");
        let raw_ref = serato4_raw_ref(db_path, 42);
        assert_eq!(raw_ref, "/Users/dj/Music/master.sqlite#42");
        assert_eq!(parse_serato4_raw_ref(&raw_ref), Some(42));
    }

    #[test]
    fn parse_serato4_raw_ref_rejects_malformed_input() {
        assert_eq!(parse_serato4_raw_ref("no-hash-here"), None);
        assert_eq!(parse_serato4_raw_ref("path#not-a-number"), None);
    }

    /// Legacy and Serato4 identities can never collide, even given identical
    /// input, because of the format prefix.
    #[test]
    fn legacy_and_serato4_identities_never_collide() {
        let play = Play {
            path: Some("/music/a.mp3".to_string()),
            start_time: Some(1_000),
            ..Play::default()
        };
        let legacy_id = legacy_session_identity(&play);
        let serato4_id = serato4_session_identity(1_000);
        assert_ne!(legacy_id, serato4_id);
        assert!(legacy_id.starts_with("legacy:"));
        assert!(serato4_id.starts_with("serato4:"));
    }

    #[test]
    fn legacy_identity_is_deterministic_for_the_same_first_play() {
        let play = Play {
            path: Some("/music/a.mp3".to_string()),
            start_time: Some(1_000),
            ..Play::default()
        };
        assert_eq!(
            legacy_session_identity(&play),
            legacy_session_identity(&play)
        );
    }

    /// Story 3.2 AC-6 contract test: `session_identity` never depends on
    /// `raw_ref` (the watched `.session` file's own path — a filesystem
    /// artifact of the *log file*, not the session's content). Two guards,
    /// together closing the AD-16 boundary:
    ///
    /// 1. `legacy_session_identity`'s signature takes only `&Play` — a
    ///    `raw_ref`/mtime/watched-file-path can never be threaded in at all,
    ///    since the type system gives the function no parameter to receive
    ///    it through (see the call site in `watcher/mod.rs`, where `identity`
    ///    and `raw_ref` are computed as two independent locals from
    ///    unrelated inputs).
    /// 2. Within `first_play` itself, only `path`/`start_time` affect the
    ///    hash — every other field is free to vary and must not. This is
    ///    the falsifiable half: if a future edit folded some other
    ///    filesystem-adjacent `Play` field (or a new field entirely) into
    ///    the hash, this test would catch it.
    #[test]
    fn ac6_session_identity_depends_only_on_first_play_path_and_start_time() {
        let base = Play {
            path: Some("/music/first-track.mp3".to_string()),
            start_time: Some(1_000),
            title: Some("Original Title".to_string()),
            artist: Some("Original Artist".to_string()),
            duration_sec: Some(180),
            ..Play::default()
        };
        // Simulates a re-save/rename of the watched log file re-parsing the
        // identical first play but with every non-hashed field perturbed —
        // a real re-save can change duration/genre-detection metadata even
        // when the underlying track/start_time are unchanged.
        let re_parsed = Play {
            path: base.path.clone(),
            start_time: base.start_time,
            title: Some("Retagged Title".to_string()),
            artist: Some("Retagged Artist".to_string()),
            duration_sec: Some(200),
            ..Play::default()
        };

        assert_eq!(
            legacy_session_identity(&base),
            legacy_session_identity(&re_parsed),
            "session_identity must be stable across a watched-file rename/re-save: \
             it is derived only from the played track's own path/start_time, \
             never from raw_ref/mtime/the log file's own path, nor from any other \
             Play field"
        );
    }

    /// AC-6, the two same-night-sessions half: two distinct sessions
    /// detected the same night (different first plays) never collide, even
    /// though both are watched through the same-shaped `raw_ref` naming.
    #[test]
    fn ac6_two_distinct_same_night_sessions_never_collide() {
        let session_one_first_play = Play {
            path: Some("/music/opening-track.mp3".to_string()),
            start_time: Some(20_000),
            ..Play::default()
        };
        let session_two_first_play = Play {
            path: Some("/music/opening-track.mp3".to_string()),
            start_time: Some(30_000), // same track played again later that night, different session
            ..Play::default()
        };

        assert_ne!(
            legacy_session_identity(&session_one_first_play),
            legacy_session_identity(&session_two_first_play),
            "two distinct same-night sessions must never collide, even when \
             opened with the identical first track"
        );
    }

    #[test]
    fn legacy_identity_differs_for_a_different_first_play() {
        let a = Play {
            path: Some("/music/a.mp3".to_string()),
            start_time: Some(1_000),
            ..Play::default()
        };
        let b = Play {
            path: Some("/music/b.mp3".to_string()),
            start_time: Some(1_000),
            ..Play::default()
        };
        assert_ne!(legacy_session_identity(&a), legacy_session_identity(&b));
    }

    // ---- Completion signal --------------------------------------------------

    /// AC-4: Serato4 `end_time` transitioning from `-1` to a real value
    /// triggers capture.
    #[test]
    fn serato4_end_time_minus_one_is_not_resolved() {
        assert!(!serato4_end_time_resolved(Some(-1)));
    }

    #[test]
    fn serato4_end_time_real_value_is_resolved() {
        assert!(serato4_end_time_resolved(Some(1_700_000_000)));
    }

    #[test]
    fn serato4_end_time_zero_is_resolved() {
        assert!(serato4_end_time_resolved(Some(0)));
    }

    /// A session still at `-1` after N poll ticks stays `watching` — modeled
    /// here as "resolved stays false across repeated checks of the same
    /// unresolved value".
    #[test]
    fn serato4_end_time_unset_stays_unresolved_across_repeated_checks() {
        for _ in 0..5 {
            assert!(!serato4_end_time_resolved(Some(-1)));
        }
    }

    #[test]
    fn serato4_end_time_none_is_not_resolved() {
        assert!(!serato4_end_time_resolved(None));
    }

    /// Legacy quiet-period elapsing (fake clock, no real sleeping) triggers
    /// capture.
    #[test]
    fn legacy_quiet_period_elapsed_after_threshold() {
        let last_modified = SystemTime::UNIX_EPOCH;
        let now = last_modified + std::time::Duration::from_secs(LEGACY_QUIET_PERIOD_SEC);
        assert!(legacy_quiet_period_elapsed(last_modified, now));
    }

    #[test]
    fn legacy_quiet_period_not_yet_elapsed_before_threshold() {
        let last_modified = SystemTime::UNIX_EPOCH;
        let now = last_modified + std::time::Duration::from_secs(LEGACY_QUIET_PERIOD_SEC - 1);
        assert!(!legacy_quiet_period_elapsed(last_modified, now));
    }

    #[test]
    fn legacy_quiet_period_a_clock_that_moved_backward_is_not_elapsed() {
        let last_modified = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1_000);
        let now = SystemTime::UNIX_EPOCH;
        assert!(!legacy_quiet_period_elapsed(last_modified, now));
    }

    // ---- Pipeline wiring: legacy --------------------------------------------

    fn utf16be_nul(s: &str) -> Vec<u8> {
        let mut out = Vec::new();
        for unit in s.encode_utf16() {
            out.extend_from_slice(&unit.to_be_bytes());
        }
        out.extend_from_slice(&[0, 0]);
        out
    }

    fn text_field(id: u32, s: &str) -> Vec<u8> {
        let payload = utf16be_nul(s);
        let mut f = Vec::new();
        f.extend_from_slice(&id.to_be_bytes());
        f.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        f.extend_from_slice(&payload);
        f
    }

    fn u32_field(id: u32, value: u32) -> Vec<u8> {
        let mut f = Vec::new();
        f.extend_from_slice(&id.to_be_bytes());
        f.extend_from_slice(&4u32.to_be_bytes());
        f.extend_from_slice(&value.to_be_bytes());
        f
    }

    fn tagged(tag: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut r = Vec::new();
        r.extend_from_slice(tag);
        r.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        r.extend_from_slice(payload);
        r
    }

    fn oent(fields: &[Vec<u8>]) -> Vec<u8> {
        let adat = tagged(b"adat", &fields.concat());
        tagged(b"oent", &adat)
    }

    fn play_record(row_id: u32, path: &str, title: &str, artist: &str, start: u32) -> Vec<u8> {
        oent(&[
            u32_field(1, row_id),
            text_field(2, path),
            text_field(6, title),
            text_field(7, artist),
            u32_field(28, start),
            u32_field(31, 1),
        ])
    }

    struct TempSessionFile(PathBuf);

    impl TempSessionFile {
        fn write(bytes: &[u8], tag: &str) -> Self {
            static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "curfew_capture_test_{tag}_{}_{n}.session",
                std::process::id()
            ));
            std::fs::write(&path, bytes).expect("temp session fixture writes");
            Self(path)
        }
    }

    impl Drop for TempSessionFile {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    /// An empty-but-real legacy catalogue (just the version header, matching
    /// `joiner/legacy.rs`'s own fixture convention) at a temp root — in
    /// production `build_legacy` is only ever invoked once
    /// `watcher::detect::classify` has confirmed a legacy install exists at
    /// this root, so the catalogue file is always present.
    fn empty_legacy_library_root(tag: &str) -> PathBuf {
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "curfew_capture_legacy_root_{tag}_{}_{n}",
            std::process::id()
        ));
        let serato_dir = root.join(crate::joiner::legacy::SERATO_DIR);
        std::fs::create_dir_all(&serato_dir).expect("temp legacy dir creates");
        // A minimal valid `database V2`: just the version header, no tracks —
        // mirrors `joiner/legacy.rs`'s own `version_header()` fixture.
        let content: Vec<u8> = utf16be_nul("2.0/Serato Scratch LIVE Database");
        let mut header = Vec::from(*b"vrsn");
        header.extend_from_slice(&(content.len() as u32).to_be_bytes());
        header.extend_from_slice(&content);
        std::fs::write(
            serato_dir.join(crate::joiner::legacy::DATABASE_FILENAME),
            header,
        )
        .expect("empty catalogue writes");
        root
    }

    /// Task 5/7: the legacy pipeline over a synthetic `.session` fixture, with
    /// a real (empty) library, produces sane `CapturedDerived` values — every
    /// play resolves off-library, which is still a valid, fully-populated
    /// capture (`in_library: false`).
    #[test]
    fn build_legacy_over_synthetic_session_produces_sane_derived() {
        let data = [
            play_record(1, "/music/a.mp3", "Track A", "Artist A", 1_000),
            play_record(2, "/music/b.mp3", "Track B", "Artist A", 1_300),
        ]
        .concat();
        let file = TempSessionFile::write(&data, "legacy-ok");
        let root = empty_legacy_library_root("ok");

        let (plays, derived) = build_legacy(&root, &file.0).expect("synthetic session captures");
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(plays.len(), 2);
        assert_eq!(plays[0].position, 1);
        assert_eq!(plays[1].position, 2);
        assert!(!plays[0].in_library);
        assert_eq!(derived.track_count, 2);
        assert_eq!(derived.set_length_sec, Some(300));
    }

    /// Task 4: a zero-play session is skipped, not captured with a fabricated
    /// identity.
    #[test]
    fn build_legacy_over_empty_session_is_empty_session_error() {
        let file = TempSessionFile::write(&[], "legacy-empty");
        let root = empty_legacy_library_root("empty");

        let result = build_legacy(&root, &file.0);
        let _ = std::fs::remove_dir_all(&root);

        assert!(matches!(result, Err(CaptureError::EmptySession)));
    }

    // ---- Pipeline wiring: serato4, incl. the tied-start_time correlation test --

    fn in_memory_master_sqlite() -> Connection {
        let conn = Connection::open_in_memory().expect("in-memory database opens");
        conn.execute_batch(
            r#"CREATE TABLE history_entry (
                   id         INTEGER PRIMARY KEY,
                   session_id INTEGER NOT NULL,
                   name       TEXT,
                   artist     TEXT,
                   genre      TEXT,
                   "key"      TEXT,
                   bpm        REAL,
                   start_time INTEGER,
                   deck       TEXT
               );
               CREATE TABLE history_session (
                   id         INTEGER PRIMARY KEY,
                   name       TEXT,
                   start_time INTEGER NOT NULL,
                   end_time   INTEGER
               );"#,
        )
        .expect("fixture schema creates");
        conn
    }

    #[allow(clippy::too_many_arguments)]
    fn insert_entry(
        conn: &Connection,
        session_id: i64,
        name: &str,
        artist: &str,
        genre: &str,
        key: &str,
        bpm: f64,
        start_time: i64,
        deck: &str,
    ) -> i64 {
        conn.execute(
            r#"INSERT INTO history_entry (session_id, name, artist, genre, "key", bpm, start_time, deck)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"#,
            rusqlite::params![session_id, name, artist, genre, key, bpm, start_time, deck],
        )
        .expect("fixture row inserts");
        conn.last_insert_rowid()
    }

    /// Closes the deferred correlation-risk gap directly: two plays sharing
    /// the same `start_time` (the exact case the module docs warn about) must
    /// still zip into the correct, distinguishing `(Play, JoinedMetadata)`
    /// pair — proven here by giving each row a distinguishing `genre`/`bpm`
    /// and asserting the enriched output pairs them correctly, not just that
    /// both vecs have the same length.
    #[test]
    fn tied_start_time_rows_correlate_correctly_by_id_not_start_time() {
        let conn = in_memory_master_sqlite();
        insert_entry(
            &conn, 7, "First", "Artist", "House", "1A", 120.0, 1_000, "1",
        );
        insert_entry(
            &conn, 7, "Second", "Artist", "Techno", "4A", 140.0, 1_000, "2",
        );
        insert_entry(
            &conn, 7, "Third", "Artist", "Trance", "8A", 132.0, 1_000, "1",
        );

        let plays = crate::parser::read_session(&conn, 7).expect("read_session succeeds");
        let joined = crate::joiner::serato4::join_session(&conn, 7).expect("join_session succeeds");
        assert_eq!(plays.len(), 3);
        assert_eq!(joined.len(), 3);

        let pairs: Vec<(Play, JoinedMetadata)> = plays
            .into_iter()
            .zip(joined.into_iter().map(|(_, m)| m))
            .collect();
        let enriched = stats::enrich_session(&pairs);

        // Each title's genre must match what was inserted for that exact
        // title — a misaligned zip would show e.g. "First" paired with
        // "Techno" instead of "House".
        let by_title = |title: &str| -> String {
            enriched
                .iter()
                .find(|p| p.title.as_deref() == Some(title))
                .and_then(|p| p.genre.as_ref())
                .map(|g| g.raw.clone())
                .expect("title present with a genre")
        };
        assert_eq!(by_title("First"), "House");
        assert_eq!(by_title("Second"), "Techno");
        assert_eq!(by_title("Third"), "Trance");
    }

    /// The same tied-`start_time` guarantee, exercised through
    /// `build_serato4`'s own public entry point rather than the raw
    /// `parser`/`joiner` calls above.
    #[test]
    fn build_serato4_correlates_tied_start_time_rows_correctly() {
        let dir = std::env::temp_dir().join(format!(
            "curfew_capture_serato4_tied_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir creates");
        let db_path = dir.join("master.sqlite");
        {
            let seed = Connection::open(&db_path).expect("seed db creates");
            seed.execute_batch(
                r#"CREATE TABLE history_entry (
                       id INTEGER PRIMARY KEY, session_id INTEGER, name TEXT, artist TEXT,
                       genre TEXT, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT
                   );"#,
            )
            .unwrap();
            insert_entry(&seed, 7, "First", "A", "House", "1A", 120.0, 1_000, "1");
            insert_entry(&seed, 7, "Second", "A", "Techno", "4A", 140.0, 1_000, "2");
        }

        let (plays, _derived) = build_serato4(&dir, &db_path, 7).expect("build_serato4 succeeds");
        let _ = std::fs::remove_dir_all(&dir);

        let first = plays
            .iter()
            .find(|p| p.title.as_deref() == Some("First"))
            .expect("First present");
        assert_eq!(first.genre.as_ref().map(|g| g.raw.as_str()), Some("House"));
        let second = plays
            .iter()
            .find(|p| p.title.as_deref() == Some("Second"))
            .expect("Second present");
        assert_eq!(
            second.genre.as_ref().map(|g| g.raw.as_str()),
            Some("Techno")
        );
    }

    /// Task 4: a zero-play Serato4 session is skipped, not captured with a
    /// fabricated identity.
    #[test]
    fn build_serato4_over_empty_session_is_empty_session_error() {
        let dir = std::env::temp_dir().join(format!(
            "curfew_capture_serato4_empty_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir creates");
        let db_path = dir.join("master.sqlite");
        {
            let seed = Connection::open(&db_path).expect("seed db creates");
            seed.execute_batch(
                r#"CREATE TABLE history_entry (
                       id INTEGER PRIMARY KEY, session_id INTEGER, name TEXT, artist TEXT,
                       genre TEXT, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT
                   );"#,
            )
            .unwrap();
        }

        let result = build_serato4(&dir, &db_path, 999);
        let _ = std::fs::remove_dir_all(&dir);

        assert!(matches!(result, Err(CaptureError::EmptySession)));
    }

    /// Track identity ranking correctly resolves title/artist for a
    /// pathless (Serato4-shaped) play, using the first-seen occurrence.
    #[test]
    fn captured_most_played_tracks_resolves_title_artist_for_pathless_plays() {
        let dir = std::env::temp_dir().join(format!(
            "curfew_capture_serato4_ranking_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir creates");
        let db_path = dir.join("master.sqlite");
        {
            let seed = Connection::open(&db_path).expect("seed db creates");
            seed.execute_batch(
                r#"CREATE TABLE history_entry (
                       id INTEGER PRIMARY KEY, session_id INTEGER, name TEXT, artist TEXT,
                       genre TEXT, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT
                   );"#,
            )
            .unwrap();
            insert_entry(&seed, 7, "Repeat", "DJ A", "House", "1A", 120.0, 1_000, "1");
            insert_entry(&seed, 7, "Repeat", "DJ A", "House", "1A", 120.0, 1_100, "1");
            insert_entry(&seed, 7, "Once", "DJ B", "Techno", "2A", 128.0, 1_200, "1");
        }

        let (_plays, derived) = build_serato4(&dir, &db_path, 7).expect("build_serato4 succeeds");
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(
            derived.most_played_tracks[0].title.as_deref(),
            Some("Repeat")
        );
        assert_eq!(
            derived.most_played_tracks[0].artist.as_deref(),
            Some("DJ A")
        );
        assert_eq!(derived.most_played_tracks[0].play_count, 2);
    }

    #[test]
    fn render_camelot_key_formats_number_and_letter() {
        assert_eq!(
            render_camelot_key(CamelotKey {
                number: 8,
                letter: Letter::A
            }),
            "8A"
        );
        assert_eq!(
            render_camelot_key(CamelotKey {
                number: 12,
                letter: Letter::B
            }),
            "12B"
        );
    }

    #[test]
    fn library_root_from_serato_dir_is_the_parent() {
        let serato_dir = Path::new("/Users/dj/Music/_Serato_");
        assert_eq!(
            library_root_from_serato_dir(serato_dir),
            PathBuf::from("/Users/dj/Music")
        );
    }
}
