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

use crate::joiner::date_added::DateAddedIndex;
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
    /// Every row `build_serato4` read resolved to a loaded-but-never-played
    /// preview (Story 3.7's `played` filter) — nothing was actually played,
    /// so there is no session to capture. Kept distinct from [`EmptySession`]
    /// (a source with zero rows to begin with) so a caller like
    /// `backfill::backfill_captured_serato4` can tell "genuinely nothing
    /// here" apart from "source unreachable/corrupt" instead of silently
    /// merging the two (Story 3.7 code review).
    ///
    /// [`EmptySession`]: CaptureError::EmptySession
    AllPreviews,
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
            CaptureError::AllPreviews => write!(
                f,
                "capture: every row was a loaded-but-never-played preview, nothing to capture"
            ),
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
            CaptureError::EmptySession
            | CaptureError::AllPreviews
            | CaptureError::Correlation { .. } => None,
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

/// Story 4.2 (D-2): a track's opaque, portable identity — `fnv1a_hex` of its
/// volume-root-relative path, the same hash [`legacy_session_identity`] already
/// uses for session identity. Reused rather than reinvented: "deterministic and
/// cross-build-stable" is the only property either use needs.
///
/// The raw path is never sent — this hash *is* the "purpose-built (possibly
/// hashed/opaque) per-track identity field" Story 1.10's Open Question #1
/// anticipated, and it keeps the same privacy posture that already excludes
/// `EnrichedPlay.path` from `SyncPlay`.
///
/// The input must be the **portable** (no-leading-`/`, volume-root-relative)
/// path, which is what both `database V2` stores as `pfil` and Serato 4+
/// records as `portable_id` — so the same track hashes identically whether it
/// was seen through a library scan or a play log, on any machine that mounts
/// the same drive.
pub fn track_id(portable_path: &str) -> String {
    fnv1a_hex(portable_path.as_bytes())
}

/// The volume-root-relative form of an absolute play-log path — the legacy
/// format's bridge to [`track_id`]'s portable-path contract. `database V2`
/// stores `Users/arjun/Music/x.mp3` where a `.session` log records
/// `/Users/arjun/Music/x.mp3` (Story 1.2 findings §5/D4), so identity would
/// split across the two sources without this. An already-relative path is
/// returned unchanged.
fn portable_form(path: &str) -> &str {
    path.strip_prefix('/').unwrap_or(path)
}

/// What one library scan actually did (Story 4.2, Task 1) — returned rather
/// than logged so the caller and the tests can both assert on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct LibraryScanOutcome {
    /// Tracks recorded as the silent first-run baseline (D-1). Never synced.
    pub baselined: usize,
    /// Genuine go-forward adds queued as `SyncLibraryAddEvent`s (Task 4).
    pub added: usize,
}

/// Diffs the DJ's current library against everything this agent has already
/// seen, recording genuine go-forward adds (D-1/D-2/D-3, AC-4/AC-5).
///
/// **Piggybacks on the existing library read** (D-3): `dates` is the very
/// [`DateAddedIndex`] the capture path already builds for the `tadd`/`uadd`
/// join (Story 3.7 §3d), so this opens no second connection and no dedicated
/// watcher — it just asks the already-loaded catalogues for all their tracks
/// instead of one.
///
/// **First run seeds silently** (D-1, AC-4). With nothing on file, every track
/// currently in the library is recorded as baseline and **zero** add-events are
/// emitted: a DJ who has dug for a decade before installing Curfew must never
/// see their back-catalogue appear as "added this month". The go-forward frame
/// Decision B set for plays applies identically to adds.
///
/// **A late-mounting volume is the same trap in a second shape**, so it gets
/// the same answer: on a later scan, a track whose own `tadd`/`uadd` predates
/// the baseline timestamp is recorded silently too, because it demonstrably
/// existed before Curfew first looked. That guard uses the library's own
/// recorded date — never a guess — and a track with *no* resolvable date is
/// still emitted (it carries no cohort weight downstream by D-10; suppressing
/// it would hide the very count D-10 exists to disclose).
///
/// An empty/unreachable catalogue set is a no-op, never an empty baseline: an
/// agent that first runs with the DJ's USB unplugged must still take a real
/// baseline the first time it can actually see the library.
pub fn scan_library_adds(
    conn: &rusqlite::Connection,
    dates: &DateAddedIndex,
    now: i64,
) -> Result<LibraryScanOutcome, crate::store::StoreError> {
    let catalogued = dates.all_tracks();
    if catalogued.is_empty() {
        return Ok(LibraryScanOutcome::default());
    }

    let identified: Vec<(String, Option<i64>)> = catalogued
        .into_iter()
        .map(|(portable_path, added_at)| (track_id(&portable_path), added_at))
        .collect();

    if crate::store::library_track_count(conn)? == 0 {
        let baselined = crate::store::record_library_tracks(conn, &identified, true, now)?;
        return Ok(LibraryScanOutcome {
            baselined,
            added: 0,
        });
    }

    let known = crate::store::known_track_ids(conn)?;
    let baseline_at = crate::store::library_baseline_at(conn)?;
    let (pre_baseline, fresh): (Vec<_>, Vec<_>) = identified
        .into_iter()
        .filter(|(id, _)| !known.contains(id))
        .partition(|(_, added_at)| match (added_at, baseline_at) {
            (Some(added), Some(baseline)) => *added < baseline,
            _ => false,
        });

    let baselined = crate::store::record_library_tracks(conn, &pre_baseline, true, now)?;
    let added = crate::store::record_library_tracks(conn, &fresh, false, now)?;
    Ok(LibraryScanOutcome { baselined, added })
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

// ---- Capture-time dedup (Story 3.3b, AC-2) ---------------------------------

/// Whether two captured sessions' time bounds describe "the same night"
/// within a small tolerance — the capture-time "Serato 4 wins" dedup guard's
/// core predicate. `a`/`b` are each `(started_at, ended_at)` in unix epoch
/// seconds, both derived from Serato's own play `start_time`s
/// ([`session_bounds`]) regardless of which format produced them, so they are
/// directly comparable with no clock conversion.
///
/// `TOLERANCE_SEC = 60` covers a single-play session where
/// `started_at == ended_at`, and any second-resolution skew between the two
/// source formats' records of the same play.
///
/// **Fail open, by construction of the caller, not this function**: this
/// predicate only ever runs against two *known* interval pairs — a caller
/// holding an unknown (`None`) bound must skip calling this rather than
/// invent a value, since a spurious duplicate set is recoverable-ish but a
/// silently suppressed real set is the exact failure class this story exists
/// to eliminate (see the call sites in `watcher::mod`).
pub fn same_night(a: (i64, i64), b: (i64, i64)) -> bool {
    const TOLERANCE_SEC: i64 = 60;
    a.0 <= b.1 + TOLERANCE_SEC && b.0 <= a.1 + TOLERANCE_SEC
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
            let mut joined = crate::joiner::legacy::join(&play, &library);
            // Story 4.2 (D-2): legacy's join key is the play's *absolute* path,
            // so the portable form is derived here — serato4 gets the same
            // value straight off `history_entry.portable_id`. Set for every
            // play with a path, in-library or not: a track that later enters
            // the library must hash to the same identity it always had.
            joined.portable_path = play.path.as_deref().map(|p| portable_form(p).to_string());
            let joined = fill_gaps(joined, play.path.as_deref());
            (play, joined)
        })
        .collect();

    // Legacy has no session-level end-time record; a final play with no
    // field-45 duration honestly has no resolvable played length (AD-11).
    Ok(assemble(&pairs, None))
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
    dates: &DateAddedIndex,
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

    // The session's own resolved end time (>= 0 once the completion signal has
    // fired — the state every captured session is in) — the set-end fallback
    // for a final play whose per-play `end_time` is unset. `history_session`
    // being absent/unreadable degrades to no fallback, never an error: the
    // duration simply stays honestly absent for that tail play.
    let set_end = crate::parser::session_by_id(&conn, session_id)
        .ok()
        .flatten()
        .and_then(|s| s.end_time.filter(|t| *t >= 0));

    let pairs: Vec<(Play, JoinedMetadata)> = plays
        .into_iter()
        .zip(joined.into_iter().map(|(_, metadata)| metadata))
        // Story 3.7 (§3d): honor Serato's own "Played" flag — a loaded-but-
        // never-played preview (25% of real rows) is not a play and must not
        // count in any stat, position, or duration bound. `None` (no flag —
        // schema variance) is kept: unknown is never guessed to be a preview.
        .filter(|(_, joined)| joined.played != Some(false))
        .map(|(play, mut joined)| {
            // Library date-added (§3d): `database V2` `tadd` by portable path —
            // NOT the serato4 `asset` join (4.6% on real data). Absent when no
            // reachable catalogue covers the track; disclosed, never guessed.
            joined.library_added_at = joined
                .portable_path
                .as_deref()
                .and_then(|p| dates.date_added_for(p));
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

    if pairs.is_empty() {
        // Every row was a loaded-but-never-played preview — nothing was
        // actually played, so there is no session to capture (same skip-not-
        // invent rationale as the zero-row case above). A distinct variant
        // from the zero-row `EmptySession` above so a caller can tell "really
        // nothing here" apart from "source unreachable/corrupt" (Story 3.7
        // code review).
        return Err(CaptureError::AllPreviews);
    }

    Ok(assemble(&pairs, set_end))
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
/// `enrich_session` -> `resolve_played_ms` -> every stat function ->
/// `confidence::classify` -> the local DTOs, written once rather than
/// duplicated per source. `set_end` is the session's own resolved end time
/// (serato4 `history_session.end_time`), the last-resort played-duration bound
/// for a final play with no per-play end; `None` where the source has no such
/// record (legacy).
fn assemble(
    pairs: &[(Play, JoinedMetadata)],
    set_end: Option<i64>,
) -> (Vec<CapturedPlay>, CapturedDerived) {
    let mut enriched = stats::enrich_session(pairs);
    stats::resolve_played_ms(&mut enriched, set_end);

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
            played_ms: enriched_play.played_ms,
            library_added_at: enriched_play.library_added_at,
            // Story 4.2 (D-2/AC-5): the opaque identity that lets this play
            // join back to its library add-event. Absent when the source
            // carried no portable path to hash — never a fabricated key.
            track_id: joined.portable_path.as_deref().map(track_id),
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

    /// A filesystem-free, empty date-added index — the default for capture
    /// tests that are not about the `database V2` lookup.
    fn no_dates() -> DateAddedIndex {
        DateAddedIndex::fixed(std::collections::HashMap::new())
    }

    // ---- Story 4.2: track identity + library add-detection -----------------

    /// A throwaway on-disk store — `store::open_at` runs the real schema, so
    /// these tests exercise the actual `library_tracks` table, not a mock.
    /// Mirrors `sync_queue.rs`'s own `TempStoreFile` helper.
    struct TempStore(std::path::PathBuf);
    impl TempStore {
        fn open(tag: &str) -> (Self, Connection) {
            use std::sync::atomic::{AtomicUsize, Ordering};
            static COUNTER: AtomicUsize = AtomicUsize::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir().join(format!(
                "curfew_library_scan_{tag}_{}_{n}.sqlite",
                std::process::id()
            ));
            let conn = crate::store::open_at(&path).expect("store opens");
            (Self(path), conn)
        }
    }
    impl Drop for TempStore {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn library(entries: &[(&str, i64)]) -> DateAddedIndex {
        DateAddedIndex::fixed(
            entries
                .iter()
                .map(|(path, epoch)| ((*path).to_string(), *epoch))
                .collect(),
        )
    }

    const BASELINE_NOW: i64 = 1_700_000_000;

    #[test]
    fn track_id_is_deterministic_and_never_the_raw_path() {
        let id = track_id("Users/arjun/Music/x.mp3");
        assert_eq!(id, track_id("Users/arjun/Music/x.mp3"), "deterministic");
        assert_ne!(id, track_id("Users/arjun/Music/y.mp3"));
        assert!(
            !id.contains("arjun"),
            "the raw path must never survive the hash"
        );
        assert_eq!(id.len(), 16, "fnv1a_hex's fixed 16-hex-char form");
    }

    #[test]
    fn legacy_absolute_and_serato4_portable_paths_hash_to_one_identity() {
        // The same track seen through a `.session` log (absolute) and through
        // `history_entry.portable_id` (relative) must be ONE track, or every
        // legacy play would fail to join its own add-event.
        assert_eq!(
            track_id(portable_form("/Users/arjun/Music/x.mp3")),
            track_id("Users/arjun/Music/x.mp3")
        );
    }

    /// D-1 / AC-4, the single easiest way to get this story catastrophically
    /// wrong: a DJ who has dug for years must not see their whole
    /// back-catalogue appear as "added this month" the first time Curfew runs.
    #[test]
    fn first_run_seeds_the_whole_library_silently_and_emits_zero_add_events() {
        let (_file, conn) = TempStore::open("first-run");
        let dates = library(&[
            ("Users/arjun/Music/a.mp3", 1_600_000_000),
            ("Users/arjun/Music/b.mp3", 1_600_000_001),
            ("A Indian/c.mp3", 1_600_000_002),
        ]);

        let outcome = scan_library_adds(&conn, &dates, BASELINE_NOW).expect("scan");

        assert_eq!(
            outcome.baselined, 3,
            "the entire existing library is baseline"
        );
        assert_eq!(
            outcome.added, 0,
            "AC-4: zero add-events on a first-ever run"
        );
        assert!(
            crate::store::library_add_events_pending_sync(&conn)
                .expect("pending")
                .is_empty(),
            "not one baseline track may reach the sync queue"
        );
    }

    #[test]
    fn a_genuinely_new_track_on_a_later_scan_emits_exactly_one_event() {
        let (_file, conn) = TempStore::open("new-track");
        let dates = library(&[("Users/arjun/Music/a.mp3", 1_600_000_000)]);
        scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline");

        // A track added AFTER the baseline was taken — a real go-forward add.
        let grown = library(&[
            ("Users/arjun/Music/a.mp3", 1_600_000_000),
            ("Users/arjun/Music/new.mp3", BASELINE_NOW + 86_400),
        ]);
        let outcome = scan_library_adds(&conn, &grown, BASELINE_NOW + 90_000).expect("scan");

        assert_eq!(outcome.added, 1);
        assert_eq!(outcome.baselined, 0);
        let pending = crate::store::library_add_events_pending_sync(&conn).expect("pending");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].track_id, track_id("Users/arjun/Music/new.mp3"));
        assert_eq!(pending[0].added_at, Some(BASELINE_NOW + 86_400));
    }

    #[test]
    fn rescanning_an_unchanged_library_emits_nothing() {
        let (_file, conn) = TempStore::open("unchanged");
        let dates = library(&[
            ("Users/arjun/Music/a.mp3", 1_600_000_000),
            ("Users/arjun/Music/b.mp3", 1_600_000_001),
        ]);
        scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline");

        for tick in 1..=3 {
            let outcome = scan_library_adds(&conn, &dates, BASELINE_NOW + tick).expect("rescan");
            assert_eq!(
                outcome,
                LibraryScanOutcome::default(),
                "rescan {tick} is a no-op"
            );
        }
    }

    #[test]
    fn a_new_track_is_emitted_once_and_never_re_emitted() {
        let (_file, conn) = TempStore::open("emit-once");
        let dates = library(&[("Users/arjun/Music/a.mp3", 1_600_000_000)]);
        scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline");

        let grown = library(&[
            ("Users/arjun/Music/a.mp3", 1_600_000_000),
            ("Users/arjun/Music/new.mp3", BASELINE_NOW + 10),
        ]);
        scan_library_adds(&conn, &grown, BASELINE_NOW + 20).expect("first sight");
        let second = scan_library_adds(&conn, &grown, BASELINE_NOW + 30).expect("second sight");

        assert_eq!(second.added, 0, "already on file — never queued twice");
        assert_eq!(
            crate::store::library_add_events_pending_sync(&conn)
                .expect("pending")
                .len(),
            1
        );
    }

    /// D-4/AC-5: an unreachable `tadd`/`uadd` is carried as absent, never
    /// guessed — and absence must not suppress the event itself, because D-10
    /// exists precisely to disclose how many such tracks there are.
    #[test]
    fn a_track_with_no_resolvable_add_date_still_emits_with_added_at_none() {
        let (_file, conn) = TempStore::open("no-date");
        // Seed a baseline through the same code path, then hand-insert an
        // undated track the way a catalogue with no `tadd`/`uadd` would.
        let dates = library(&[("Users/arjun/Music/a.mp3", 1_600_000_000)]);
        scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline");

        let undated = track_id("A Indian/undated.mp3");
        crate::store::record_library_tracks(
            &conn,
            &[(undated.clone(), None)],
            false,
            BASELINE_NOW + 10,
        )
        .expect("record");

        let pending = crate::store::library_add_events_pending_sync(&conn).expect("pending");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].track_id, undated);
        assert_eq!(pending[0].added_at, None, "absent, never a fabricated date");
    }

    /// The second shape of D-1's trap: a USB volume unmounted when the
    /// baseline was taken, mounted later. Its tracks are new to the local
    /// store but demonstrably predate the baseline, so they seed silently
    /// rather than flooding a cohort with a decade of digging.
    #[test]
    fn a_late_mounting_volume_seeds_silently_rather_than_flooding_a_cohort() {
        let (_file, conn) = TempStore::open("late-mount");
        let boot_only = library(&[("Users/arjun/Music/a.mp3", 1_600_000_000)]);
        scan_library_adds(&conn, &boot_only, BASELINE_NOW).expect("baseline");

        let usb_mounted = library(&[
            ("Users/arjun/Music/a.mp3", 1_600_000_000),
            ("A Indian/old-1.mp3", BASELINE_NOW - 86_400), // pre-dates the baseline
            ("A Indian/old-2.mp3", 1_500_000_000),
            ("A Indian/genuinely-new.mp3", BASELINE_NOW + 86_400),
        ]);
        let outcome = scan_library_adds(&conn, &usb_mounted, BASELINE_NOW + 90_000).expect("scan");

        assert_eq!(outcome.baselined, 2, "pre-baseline tracks seed silently");
        assert_eq!(outcome.added, 1, "only the genuinely-new track converts");
        let pending = crate::store::library_add_events_pending_sync(&conn).expect("pending");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].track_id, track_id("A Indian/genuinely-new.mp3"));
    }

    /// An unplugged drive shrinks the library. That is not a deletion, and
    /// re-plugging it is not a thousand new adds.
    #[test]
    fn an_unmounted_volume_neither_deletes_nor_re_adds_on_return() {
        let (_file, conn) = TempStore::open("unmount");
        let both = library(&[
            ("Users/arjun/Music/a.mp3", 1_600_000_000),
            ("A Indian/usb.mp3", 1_600_000_001),
        ]);
        scan_library_adds(&conn, &both, BASELINE_NOW).expect("baseline");

        let boot_only = library(&[("Users/arjun/Music/a.mp3", 1_600_000_000)]);
        assert_eq!(
            scan_library_adds(&conn, &boot_only, BASELINE_NOW + 10).expect("unplugged"),
            LibraryScanOutcome::default()
        );
        assert_eq!(
            scan_library_adds(&conn, &both, BASELINE_NOW + 20).expect("replugged"),
            LibraryScanOutcome::default(),
            "a returning volume's tracks are already on file"
        );
    }

    /// An agent whose very first run happens with the DJ's drive unplugged
    /// must still take a real baseline the first time it can actually see the
    /// library — not lock in an empty one and then call everything an add.
    #[test]
    fn an_unreachable_library_is_a_no_op_not_an_empty_baseline() {
        let (_file, conn) = TempStore::open("unreachable");
        assert_eq!(
            scan_library_adds(&conn, &no_dates(), BASELINE_NOW).expect("scan"),
            LibraryScanOutcome::default()
        );
        assert_eq!(crate::store::library_track_count(&conn).expect("count"), 0);

        let reachable = library(&[("A Indian/a.mp3", 1_600_000_000)]);
        let outcome = scan_library_adds(&conn, &reachable, BASELINE_NOW + 10).expect("scan");
        assert_eq!(outcome.baselined, 1, "the real first sight is the baseline");
        assert_eq!(outcome.added, 0);
    }

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

    // ---- same_night (Story 3.3b, AC-2 dedup guard) --------------------------

    #[test]
    fn same_night_identical_bounds_match() {
        assert!(same_night((1_000, 5_000), (1_000, 5_000)));
    }

    #[test]
    fn same_night_overlapping_ranges_match() {
        assert!(same_night((1_000, 5_000), (4_000, 8_000)));
    }

    #[test]
    fn same_night_single_play_sessions_within_tolerance_match() {
        // started_at == ended_at for a single-play session on both sides;
        // the two formats' records of "the same play" can skew by a couple
        // seconds without being a genuinely different night.
        assert!(same_night((1_000, 1_000), (1_030, 1_030)));
    }

    #[test]
    fn same_night_exactly_at_the_tolerance_boundary_matches() {
        // a.0 <= b.1 + 60 and b.0 <= a.1 + 60, both exactly at the edge.
        assert!(same_night((1_000, 1_000), (1_060, 1_060)));
    }

    #[test]
    fn same_night_just_past_the_tolerance_boundary_does_not_match() {
        assert!(!same_night((1_000, 1_000), (1_061, 1_061)));
    }

    #[test]
    fn same_night_clearly_disjoint_ranges_do_not_match() {
        assert!(!same_night((1_000, 2_000), (10_000, 12_000)));
    }

    #[test]
    fn same_night_is_symmetric() {
        let a = (1_000, 5_000);
        let b = (4_500, 9_000);
        assert_eq!(same_night(a, b), same_night(b, a));
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
                   id          INTEGER PRIMARY KEY,
                   session_id  INTEGER NOT NULL,
                   name        TEXT,
                   artist      TEXT,
                   genre       TEXT,
                   key_value   INTEGER,
                   "key"       TEXT,
                   bpm         REAL,
                   start_time  INTEGER,
                   deck        TEXT,
                   end_time    INTEGER,
                   played      INTEGER,
                   length_ms   INTEGER,
                   length_sec  INTEGER,
                   portable_id TEXT
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
                       genre TEXT, key_value INTEGER, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT,
                       end_time INTEGER, played INTEGER, length_ms INTEGER, length_sec INTEGER,
                       portable_id TEXT
                   );"#,
            )
            .unwrap();
            insert_entry(&seed, 7, "First", "A", "House", "1A", 120.0, 1_000, "1");
            insert_entry(&seed, 7, "Second", "A", "Techno", "4A", 140.0, 1_000, "2");
        }

        let (plays, _derived) =
            build_serato4(&dir, &db_path, 7, &no_dates()).expect("build_serato4 succeeds");
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
                       genre TEXT, key_value INTEGER, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT,
                       end_time INTEGER, played INTEGER, length_ms INTEGER, length_sec INTEGER,
                       portable_id TEXT
                   );"#,
            )
            .unwrap();
        }

        let result = build_serato4(&dir, &db_path, 999, &no_dates());
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
                       genre TEXT, key_value INTEGER, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT,
                       end_time INTEGER, played INTEGER, length_ms INTEGER, length_sec INTEGER,
                       portable_id TEXT
                   );"#,
            )
            .unwrap();
            insert_entry(&seed, 7, "Repeat", "DJ A", "House", "1A", 120.0, 1_000, "1");
            insert_entry(&seed, 7, "Repeat", "DJ A", "House", "1A", 120.0, 1_100, "1");
            insert_entry(&seed, 7, "Once", "DJ B", "Techno", "2A", 128.0, 1_200, "1");
        }

        let (_plays, derived) =
            build_serato4(&dir, &db_path, 7, &no_dates()).expect("build_serato4 succeeds");
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

    /// Story 3.6 capture-path regression (layer 1) — the reference incident. A
    /// musically-notated Serato library (`G#m`, `Am`, `Em`, `Ebm`, plus a `-1` no-key
    /// row) yields **populated, correct Camelot keys** through the full `build_serato4`
    /// path (parser → joiner → enrich → assemble), not the `None`s the old
    /// `camelot::parse("Em")` produced. `key_value` is the source of truth; the
    /// free-text `"key"` here is the exact mixed/musical notation that silently dropped
    /// ~88% of real keys before the fix. This is the test that would have caught it.
    #[test]
    fn build_serato4_recovers_camelot_keys_from_key_value_not_free_text() {
        let dir = std::env::temp_dir().join(format!(
            "curfew_capture_serato4_camelot_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir creates");
        let db_path = dir.join("master.sqlite");
        {
            let seed = Connection::open(&db_path).expect("seed db creates");
            seed.execute_batch(
                r#"CREATE TABLE history_entry (
                       id INTEGER PRIMARY KEY, session_id INTEGER, name TEXT, artist TEXT,
                       genre TEXT, key_value INTEGER, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT,
                       end_time INTEGER, played INTEGER, length_ms INTEGER, length_sec INTEGER,
                       portable_id TEXT
                   );"#,
            )
            .unwrap();
            // (key_value, free-text musical notation the OLD path dropped, start_time)
            let rows: &[(i64, &str, i64)] = &[
                (0, "G#m", 1_000),  // -> 1A
                (7, "Am", 1_100),   // -> 8A
                (8, "Em", 1_200),   // -> 9A
                (16, "Ebm", 1_300), // -> 5B
                (-1, "", 1_400),    // -> None (no key)
            ];
            for (i, (key_value, free_text, start)) in rows.iter().enumerate() {
                seed.execute(
                    r#"INSERT INTO history_entry
                           (session_id, name, artist, genre, key_value, "key", bpm, start_time, deck)
                       VALUES (7, ?1, 'Artist', 'House', ?2, ?3, 128.0, ?4, '1')"#,
                    rusqlite::params![format!("Track {i}"), key_value, free_text, start],
                )
                .unwrap();
            }
        }

        let (plays, derived) =
            build_serato4(&dir, &db_path, 7, &no_dates()).expect("build_serato4 succeeds");
        let _ = std::fs::remove_dir_all(&dir);

        let keys: Vec<Option<String>> = plays.iter().map(|p| p.camelot_key.clone()).collect();
        assert_eq!(
            keys,
            vec![
                Some("1A".to_string()),
                Some("8A".to_string()),
                Some("9A".to_string()),
                Some("5B".to_string()),
                None,
            ],
            "musically-notated rows must recover Camelot keys via key_value, not drop to None"
        );
        // 4 of 5 plays carry a key, so the mixing stats see real transitions rather
        // than excluding every pair as "no key" — the downstream proof the keys landed.
        assert_eq!(
            derived.camelot_mixing_stats.excluded_no_key, 1,
            "only the single -1 no-key transition should be excluded"
        );
    }

    /// Story 3.7 capture-path regression (§3d, the full `build_serato4` path):
    /// the played-flag filter drops loaded-but-never-played previews from
    /// plays, positions, and every derived stat; `played_ms` comes from the
    /// per-play `end_time` where present, the next play's start where unset,
    /// and the session's own end time for the final play; `library_added_at`
    /// resolves through the `database V2` date index by portable path.
    #[test]
    fn build_serato4_captures_durations_dates_and_honors_the_played_flag() {
        let dir = std::env::temp_dir().join(format!(
            "curfew_capture_serato4_durations_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir creates");
        let db_path = dir.join("master.sqlite");
        {
            let seed = Connection::open(&db_path).expect("seed db creates");
            seed.execute_batch(
                r#"CREATE TABLE history_entry (
                       id INTEGER PRIMARY KEY, session_id INTEGER, name TEXT, artist TEXT,
                       genre TEXT, key_value INTEGER, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT,
                       end_time INTEGER, played INTEGER, length_ms INTEGER, length_sec INTEGER,
                       portable_id TEXT
                   );
                   CREATE TABLE history_session (
                       id INTEGER PRIMARY KEY, name TEXT, start_time INTEGER, end_time INTEGER
                   );
                   INSERT INTO history_session (id, name, start_time, end_time)
                   VALUES (7, 'Gig', 1000, 2000);
                   INSERT INTO history_entry
                       (session_id, name, start_time, end_time, played, portable_id, bpm)
                   VALUES
                       -- Measured duration: end_time present -> 200s.
                       (7, 'Measured', 1000, 1200, 1, 'Users/arjun/Music/a.mp3', 120.0),
                       -- A loaded-but-never-played preview between two real
                       -- plays: must vanish entirely, and must NOT bound the
                       -- previous play's fallback duration.
                       (7, 'Preview', 1210, -1, 0, 'Users/arjun/Music/preview.mp3', 121.0),
                       -- end_time unset -> falls back to the next PLAYED
                       -- play's start (1600 - 1250 = 350s).
                       (7, 'Fallback', 1250, -1, 1, 'A Indian/b.mp3', 122.0),
                       -- Final play, end_time unset -> session end (2000 -
                       -- 1600 = 400s). Not in any date catalogue -> date absent.
                       (7, 'Tail', 1600, -1, 1, 'A Indian/uncatalogued.mp3', 123.0);"#,
            )
            .unwrap();
        }

        let dates = DateAddedIndex::fixed(std::collections::HashMap::from([
            ("Users/arjun/Music/a.mp3".to_string(), 1_644_628_114),
            ("A Indian/b.mp3".to_string(), 1_700_000_000),
            // The preview's path is deliberately covered too — proving the
            // filter, not a lookup miss, is what excludes it.
            ("Users/arjun/Music/preview.mp3".to_string(), 1_650_000_000),
        ]));

        let (plays, derived) =
            build_serato4(&dir, &db_path, 7, &dates).expect("build_serato4 succeeds");
        let _ = std::fs::remove_dir_all(&dir);

        let titles: Vec<Option<&str>> = plays.iter().map(|p| p.title.as_deref()).collect();
        assert_eq!(
            titles,
            vec![Some("Measured"), Some("Fallback"), Some("Tail")],
            "the played=0 preview must not count as a play"
        );
        assert_eq!(
            plays.iter().map(|p| p.position).collect::<Vec<_>>(),
            vec![1, 2, 3],
            "positions renumber over played rows only"
        );
        assert_eq!(derived.track_count, 3);

        assert_eq!(plays[0].played_ms, Some(200_000), "measured end_time wins");
        assert_eq!(
            plays[1].played_ms,
            Some(350_000),
            "unset end_time falls back to the next played play's start, skipping the preview"
        );
        assert_eq!(
            plays[2].played_ms,
            Some(400_000),
            "the final play falls back to the session's own end time"
        );

        assert_eq!(plays[0].library_added_at, Some(1_644_628_114));
        assert_eq!(plays[1].library_added_at, Some(1_700_000_000));
        assert_eq!(
            plays[2].library_added_at, None,
            "an uncatalogued track's date is absent, never guessed"
        );
    }

    /// Story 3.7: a session whose every row is a loaded-but-never-played
    /// preview has nothing actually played — skipped as an empty session, not
    /// captured with a fabricated identity.
    #[test]
    fn build_serato4_all_previews_is_empty_session() {
        let dir = std::env::temp_dir().join(format!(
            "curfew_capture_serato4_all_previews_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir creates");
        let db_path = dir.join("master.sqlite");
        {
            let seed = Connection::open(&db_path).expect("seed db creates");
            seed.execute_batch(
                r#"CREATE TABLE history_entry (
                       id INTEGER PRIMARY KEY, session_id INTEGER, name TEXT, artist TEXT,
                       genre TEXT, key_value INTEGER, "key" TEXT, bpm REAL, start_time INTEGER, deck TEXT,
                       end_time INTEGER, played INTEGER, length_ms INTEGER, length_sec INTEGER,
                       portable_id TEXT
                   );
                   INSERT INTO history_entry (session_id, name, start_time, played)
                   VALUES (7, 'Loaded only', 1000, 0), (7, 'Also loaded only', 1100, 0);"#,
            )
            .unwrap();
        }

        let result = build_serato4(&dir, &db_path, 7, &no_dates());
        let _ = std::fs::remove_dir_all(&dir);

        assert!(matches!(result, Err(CaptureError::AllPreviews)));
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
