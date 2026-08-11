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
use crate::stats::segments::{self, CalibrationPool, DetectionPlay, Floors, PooledSession};
use crate::stats::{self, EnrichedPlay, TrackIdentity};
use crate::store::{
    CapturedArtistCount, CapturedBpmDistribution, CapturedCamelotMixingStats, CapturedConfidence,
    CapturedDerived, CapturedEnergyPoint, CapturedGenre, CapturedGenreBreakdown,
    CapturedGenreBucket, CapturedIdleGap, CapturedPlay, CapturedSubgenreBreakdown,
    CapturedSubgenreBucket, CapturedSuggestedSegment, CapturedTrackCount,
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

/// Story 4.3 (Decision E-2): a track's opaque identity — `fnv1a_hex` over its
/// normalized title and artist. **Supersedes** the Story 4.2 (D-2) path-based
/// `track_id` this replaced: hashing the volume-root-relative path meant the
/// same song split across two unrelated identities whenever it lived on more
/// than one drive (a laptop copy and a gig USB), which on Arjun's own real
/// data deflated whole cohorts' worth of conversion-rate months to 0%
/// (`deferred-work.md:262`). Title+artist does not care which drive the file
/// is on.
///
/// The raw title/artist are never sent — this hash *is* the "purpose-built
/// (possibly hashed/opaque) per-track identity field" Story 1.10's Open
/// Question #1 anticipated.
///
/// **Normalization: trim + case-fold only, no Unicode canonicalization.**
/// Mirrors `genre::normalize`'s existing fold (`raw.trim().to_lowercase()`)
/// rather than inventing a second convention. Deliberately does **not** run
/// NFC/NFKC normalization (would need a new `unicode-normalization` crate
/// dependency) — two byte-distinct-but-visually-identical strings
/// (precomposed vs. combining-character accents) still hash to two different
/// identities. Accepted as a known gap, not fixed here: `genre::normalize` has
/// the identical limitation today, and this story's scope is the path/drive
/// split (Decision E-2), not every possible metadata-encoding split.
///
/// **Both title and artist must resolve, or there is no identity at all**
/// (`None`, never a fabricated partial hash, AD-11) — one field alone is too
/// little signal to trust: an untitled track from one artist and an untitled
/// track from a different artist would otherwise collide under a title-only
/// hash, and two different songs by an unindexed/blank artist would collide
/// under an artist-only hash.
pub fn track_id_from_title_artist(title: Option<&str>, artist: Option<&str>) -> Option<String> {
    let title = normalize_identity_text(title?)?;
    let artist = normalize_identity_text(artist?)?;

    // A `\u{1e}` (ASCII record separator) delimiter: vanishingly unlikely to
    // appear in real metadata (unlike `|`/`-`/`:`), so `("A", "B|C")` and
    // `("A|B", "C")` cannot collide into the same hash input — EXCEPT if the
    // literal byte somehow appeared in the source text itself, which the
    // guard below rules out rather than merely relying on unlikeliness
    // (Story 4.3 review).
    let mut bytes = Vec::with_capacity(title.len() + artist.len() + 1);
    bytes.extend_from_slice(title.as_bytes());
    bytes.push(0x1e);
    bytes.extend_from_slice(artist.as_bytes());
    Some(fnv1a_hex(&bytes))
}

/// The lookup-key fold [`track_id_from_title_artist`] matches on — trim,
/// collapse internal whitespace runs, then lowercase. Case/edge-whitespace
/// folding mirrors `genre::normalize`'s existing fold; the internal-whitespace
/// collapse is this function's own addition (Story 4.3 review) — a title or
/// artist re-typed with a doubled space between words (a real cross-source
/// drift, e.g. a catalog tag vs. an embedded ID3 tag) must still resolve to
/// the same identity. A whitespace-only input is "no meaningful value," not a
/// real one (identical reasoning to `genre::normalize`), so it resolves to
/// absent rather than an empty-string identity input. A value containing the
/// literal `\u{1e}` delimiter byte [`track_id_from_title_artist`] joins on is
/// also rejected outright — vanishingly unlikely in real metadata, but
/// resolving to absent rather than let it shift the delimiter boundary and
/// collide two different (title, artist) pairs.
fn normalize_identity_text(value: &str) -> Option<String> {
    if value.contains('\u{1e}') {
        return None;
    }
    let folded = value.trim().to_lowercase();
    if folded.is_empty() {
        return None;
    }
    Some(folded.split_whitespace().collect::<Vec<_>>().join(" "))
}

/// The volume-root-relative form of an absolute play-log path — the legacy
/// format's bridge to `database V2`'s own path convention, which the
/// `tadd`/`uadd` date-added lookup ([`DateAddedIndex::date_added_for`]) keys
/// on. `database V2` stores `Users/arjun/Music/x.mp3` where a `.session` log
/// records `/Users/arjun/Music/x.mp3` (Story 1.2 findings §5/D4), so that
/// lookup would miss every legacy play without this. An already-relative path
/// is returned unchanged.
///
/// No longer feeds track identity as of Story 4.3 (Decision E-2, see
/// [`track_id_from_title_artist`]) — this is now purely the date-added join key.
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
    /// Catalogued rows this scan saw but could not identify at all — no
    /// resolvable title *or* no resolvable artist, since the identity hash
    /// requires **both** (AD-11) — and therefore excluded. Same category of gap
    /// AC-4 disclosed for missing `tadd`/`uadd`, applied at the whole-track
    /// level (Story 4.3 review). As of Story 4.11 AC-6 this is no longer
    /// silently dropped: `watcher::mod`'s scan tick records it via
    /// `store::set_scan_identity_coverage`, readable through
    /// `store::scan_identity_coverage`, and the conversion-rate meter renders
    /// it. No synced/cloud field exists yet — the web value is fixture-sourced
    /// pending a designed carrier (see this story's Completion Notes).
    pub excluded_no_identity: usize,
    /// Audio rows this scan considered, i.e. the denominator
    /// `excluded_no_identity` is a subset of. Non-audio rows (video files) are
    /// excluded from both — see [`is_audio_path`].
    pub catalogue_rows: usize,
}

/// Whether a catalogued row is a track at all, rather than a video file Serato
/// happens to index alongside them.
///
/// Story 4.11 code review: measured against Arjun's real `database V2`, 20 of
/// 930 rows are `.mp4`/`.mov` (video loops — e.g. `LOOP LAD (1).mov`), and all
/// 20 carry no artist tag. Counting them inflated both the unidentifiable-track
/// disclosure and the conversion-rate denominator with things that are not
/// tracks and could never convert. Extension-based because the catalogue offers
/// nothing better, and deliberately a small deny-list rather than an audio
/// allow-list: an unrecognised audio extension must keep counting as a track
/// (AD-11's never-silently-drop discipline), so only formats known to be video
/// are removed.
fn is_audio_path(path: &str) -> bool {
    const VIDEO_EXTENSIONS: [&str; 6] = ["mp4", "mov", "avi", "m4v", "mkv", "webm"];
    match path.rsplit_once('.') {
        Some((_, ext)) => !VIDEO_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()),
        None => true,
    }
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
///
/// **Story 4.3 (Decision E-2):** identity is now [`track_id_from_title_artist`],
/// not the catalogue path. A catalogued track missing a resolvable title or
/// artist has no identity to record under (`library_tracks.track_id` is a
/// `NOT NULL` primary key) and is excluded from this scan — the same "absent,
/// never guessed" discipline as every other gap in this pipeline, just applied
/// at the whole-track level instead of one field. **No longer silent as of
/// Story 4.11 AC-6:** the count reaches `LibraryScanOutcome.excluded_no_identity`,
/// is persisted by the watcher via `store::set_scan_identity_coverage`, and is
/// disclosed on the conversion-rate meter. Identity needs BOTH a title and an
/// artist, so missing *either* excludes — measured at 271 of 930 rows on a real
/// library, almost all of them missing only the artist.
///
/// **Cross-drive collision (Story 4.3 review):** the same track catalogued on
/// two drives (exactly what Decision E-2 exists to unify) now yields two
/// `(portable_path, added_at, title, artist)` rows that hash to one
/// `track_id`. [`dedupe_by_identity`] resolves that deterministically
/// (earliest known `added_at` wins) before anything is recorded, rather than
/// leaving the winner to whatever order `DateAddedIndex::all_tracks` happens
/// to iterate in.
///
/// **Already-deployed-agent upgrade (Story 4.3 review):** an agent with
/// pre-4.3 `library_tracks` rows (keyed by the retired path hash) has
/// `library_track_count != 0`, so without special handling every currently
/// catalogued track — including ones added well after the *original*
/// baseline and already synced under the old identity — would miss
/// `known_track_ids` (nothing there uses the new hash) and get re-emitted as
/// a fresh add-event. On first encounter with a pre-existing, not-yet-migrated
/// store, this function instead does what a true first run does: record
/// everything currently identifiable as baseline (never synced) and mark the
/// cutover done, so only genuinely new tracks from here on are real adds.
pub fn scan_library_adds(
    conn: &rusqlite::Connection,
    dates: &DateAddedIndex,
    now: i64,
) -> Result<LibraryScanOutcome, crate::store::StoreError> {
    let catalogued = dates.all_tracks();
    if catalogued.is_empty() {
        return Ok(LibraryScanOutcome::default());
    }

    // Video rows are dropped before anything counts them, so they land in
    // neither the roster nor either disclosure denominator (Story 4.11 review).
    let audio: Vec<_> = catalogued
        .into_iter()
        .filter(|(portable_path, ..)| is_audio_path(portable_path))
        .collect();
    let catalogue_rows = audio.len();

    let mut excluded_no_identity = 0usize;
    let identified: Vec<crate::store::IdentifiedLibraryTrack> =
        dedupe_by_identity(audio.into_iter().filter_map(
            |(_portable_path, added_at, title, artist)| match track_id_from_title_artist(
                title.as_deref(),
                artist.as_deref(),
            ) {
                Some(id) => Some((id, added_at, title, artist)),
                None => {
                    excluded_no_identity += 1;
                    None
                }
            },
        ));

    // Recorded BEFORE the two re-baselining early-returns below, not at the
    // absence site: those returns are the very scans most likely to see the
    // whole library (a first run, an identity cutover), and if their reach went
    // unrecorded the high-water mark would start from whatever narrower view
    // happened to come next — and a later partial scan would then read as
    // complete. The returned flag is only *consumed* further down.
    let complete_reach = crate::store::observe_catalogue_reach(conn, &dates.loaded_roots())?;

    if crate::store::library_track_count(conn)? == 0 {
        let baselined = crate::store::record_library_tracks(conn, &identified, true, now)?;
        crate::store::mark_identity_migration_done(conn)?;
        return Ok(LibraryScanOutcome {
            baselined,
            added: 0,
            excluded_no_identity,
            catalogue_rows,
        });
    }

    if !crate::store::identity_migration_done(conn)? {
        let baselined = crate::store::record_library_tracks(conn, &identified, true, now)?;
        crate::store::mark_identity_migration_done(conn)?;
        return Ok(LibraryScanOutcome {
            baselined,
            added: 0,
            excluded_no_identity,
            catalogue_rows,
        });
    }

    let known = crate::store::known_track_ids(conn)?;
    let baseline_at = crate::store::library_baseline_at(conn)?;

    // Story 4.11 AC-5: any previously-known track missing from THIS scan's
    // identified set is soft-deleted. Computed from `identified` (post-dedup,
    // pre-partition) so a track's own presence is judged once, from the same
    // set the rest of this function reads from.
    //
    // TWO GATES, both added by this story's code review, because "missing from
    // the scan" is NOT the same claim as "removed from the library":
    //
    //   1. `complete_reach` — `DateAddedIndex::all_tracks` omits tracks on
    //      unmounted volumes by design, so a boot-drive-only scan on a machine
    //      that normally sees a USB drive would mark that whole drive deleted.
    //      `date_added`'s own doc comment forbids exactly that ("a library that
    //      shrinks because a drive was unplugged must never look like tracks
    //      were *removed*"). Absence is only concluded when this scan reached
    //      every root any earlier scan reached.
    //   2. `identified.is_empty()` — the guard at the top of this function
    //      catches an empty *catalogue*, but a catalogue that parses yet
    //      resolves no identities at all (a tagging regression, a format
    //      change) would otherwise mark 100% of the library absent in one pass.
    //
    // Neither gate helps a track whose tags were individually *cleared*: its
    // identity is a hash of title+artist, so an untagged file cannot be matched
    // back to the row it used to occupy and does read as removed. Known and
    // accepted limitation — see this story's Review Findings.
    if complete_reach && !identified.is_empty() {
        let current_ids: std::collections::HashSet<String> =
            identified.iter().map(|(id, ..)| id.clone()).collect();
        crate::store::mark_absent_tracks(conn, &current_ids, now)?;
    }

    let (unseen, seen): (Vec<_>, Vec<_>) = identified
        .into_iter()
        .partition(|(id, ..)| !known.contains(id));

    // Story 4.11 AC-4: a track already known gets its title/artist refreshed
    // in place (current-state, mutable) rather than being skipped outright —
    // `seen` here is exactly the set `scan_library_adds` discarded entirely
    // before this story.
    let refresh: Vec<(String, Option<String>, Option<String>)> = seen
        .into_iter()
        .map(|(id, _added_at, title, artist)| (id, title, artist))
        .collect();
    crate::store::refresh_library_track_tags(conn, &refresh)?;

    let (pre_baseline, fresh): (Vec<_>, Vec<_>) =
        unseen
            .into_iter()
            .partition(|(_, added_at, ..)| match (added_at, baseline_at) {
                (Some(added), Some(baseline)) => *added < baseline,
                _ => false,
            });

    let baselined = crate::store::record_library_tracks(conn, &pre_baseline, true, now)?;
    let added = crate::store::record_library_tracks(conn, &fresh, false, now)?;
    Ok(LibraryScanOutcome {
        baselined,
        added,
        excluded_no_identity,
        catalogue_rows,
    })
}

/// Collapses duplicate `track_id`s from [`scan_library_adds`]'s identified
/// list — the shape a cross-drive duplicate takes now that identity is
/// title+artist rather than path (Story 4.3 review) — to one row each,
/// deterministically: the earliest known `added_at` wins (a `None` never
/// displaces a real date, and only displaces another `None` to keep the
/// choice total). Order-independent, so re-scans agree with themselves
/// regardless of `HashMap` iteration order upstream. Title/artist (Story
/// 4.11) travel with whichever `added_at` wins — normalization guarantees
/// any two entries sharing a `track_id` fold to the same identity text, so
/// only cosmetic raw-casing/whitespace differences are possible between
/// them, never a substantively different title/artist.
fn dedupe_by_identity(
    entries: impl Iterator<Item = crate::store::IdentifiedLibraryTrack>,
) -> Vec<crate::store::IdentifiedLibraryTrack> {
    type PartialEntry = (Option<i64>, Option<String>, Option<String>);
    let mut by_id: std::collections::HashMap<String, PartialEntry> =
        std::collections::HashMap::new();
    for (id, added_at, title, artist) in entries {
        by_id
            .entry(id)
            .and_modify(|existing| {
                let should_replace = match (added_at, existing.0) {
                    (Some(new), Some(current)) => new < current,
                    (Some(_), None) => true,
                    _ => false,
                };
                if should_replace {
                    *existing = (added_at, title.clone(), artist.clone());
                }
            })
            .or_insert((added_at, title, artist));
    }
    by_id
        .into_iter()
        .map(|(id, (added_at, title, artist))| (id, added_at, title, artist))
        .collect()
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
    pool: &CalibrationPool,
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

    // Story 5.2 (D-23): the floors this session is scored against come from the
    // sessions that *precede* it, keyed on its own identity so a re-derivation
    // of an old session reproduces byte-identical output rather than being
    // recalibrated by everything captured since.
    let floors = pool.floors_before(session_start_of(&pairs), &legacy_identity_of(&pairs));

    // Legacy has no session-level end-time record; a final play with no
    // field-45 duration honestly has no resolvable played length (AD-11).
    Ok(assemble(&pairs, None, &floors))
}

/// This session's own start, from the same first-play `start_time`
/// [`session_bounds`] reports — read off `pairs` because the floors have to be
/// chosen before [`assemble`] builds the captured plays.
fn session_start_of(pairs: &[(Play, JoinedMetadata)]) -> Option<i64> {
    pairs.first().and_then(|(p, _)| p.start_time).map(i64::from)
}

/// The legacy dedup key for an already-parsed session — the identity
/// [`crate::watcher`] will store this capture under, needed here so the
/// calibration prefix is cut at exactly this session. An empty `pairs` is
/// unreachable (both callers reject an empty session first) but must not panic.
fn legacy_identity_of(pairs: &[(Play, JoinedMetadata)]) -> String {
    pairs
        .first()
        .map(|(play, _)| legacy_session_identity(play))
        .unwrap_or_default()
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
    pool: &CalibrationPool,
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

    // Story 5.2 (D-23), same chronological-prefix rule as `build_legacy`.
    let floors = pool.floors_before(
        session_start_of(&pairs),
        &serato4_session_identity(session_id),
    );

    Ok(assemble(&pairs, set_end, &floors))
}

/// Loads every captured session's window stats into one ordered
/// [`CalibrationPool`] (Story 5.2, D-23) — the single effectful step of the whole
/// calibration story, kept here at the edge so `stats::segments` stays pure.
///
/// Computed **live** from the `plays_json` the store already holds, never from a
/// persisted per-DJ profile (D-16). A session whose `plays_json` is absent or
/// unparseable contributes nothing rather than failing the capture: a broken
/// historical row must not be able to stop tonight's set from being captured.
///
/// **Call this ONCE per sweep, not once per session.** `backfill_captured_serato4`
/// re-derives ~491 rows on a cold upgrade, and re-reading the pool per row would
/// make that pass O(n²) over the whole store.
pub fn load_calibration_pool(conn: &rusqlite::Connection) -> CalibrationPool {
    let Ok(rows) = crate::store::calibration_pool_rows(conn) else {
        // No pool means every session calibrates against the prior — the same
        // cold-start behavior a brand-new install has, which is a safe degrade
        // rather than a reason to fail a capture.
        return CalibrationPool::default();
    };

    let sessions = rows
        .into_iter()
        .filter_map(|row| {
            let plays: Vec<CapturedPlay> = serde_json::from_str(row.plays_json.as_deref()?).ok()?;
            Some(PooledSession {
                started_at: row.started_at,
                session_identity: row.session_identity,
                windows: segments::window_stats(&detection_plays_from_captured(&plays)),
            })
        })
        .collect();

    CalibrationPool::new(sessions)
}

/// Replays stored plays into the shape `stats::segments` reads. Positions come
/// from the stored `position` field rather than being renumbered, so a pooled
/// session is windowed exactly as it was when it was captured.
fn detection_plays_from_captured(plays: &[CapturedPlay]) -> Vec<DetectionPlay> {
    plays
        .iter()
        .map(|p| DetectionPlay {
            position: p.position,
            start_time: p.started_at.map(i64::from),
            bpm: p.bpm,
        })
        .collect()
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
    floors: &Floors,
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
            // Story 4.2 (AC-5), identity per Story 4.3 (Decision E-2): the
            // opaque identity that lets this play join back to its library
            // add-event. Absent when the source carried no resolvable title
            // or artist to hash — never a fabricated key.
            track_id: track_id_from_title_artist(
                enriched_play.title.as_deref(),
                enriched_play.artist.as_deref(),
            ),
        })
        .collect();

    let genre_breakdown = stats::genre_breakdown(&enriched);
    let subgenre_breakdown = stats::subgenre_breakdown(&enriched);
    let bpm_distribution = stats::bpm_distribution(&enriched);
    let camelot_mixing_stats = stats::camelot::mixing_stats(&enriched);
    let confidence = crate::confidence::classify(&enriched);
    // Story 5.2: detection runs against floors the CALLER computed from the
    // store (see `load_calibration_pool`) — `assemble` stays a pure function of
    // its arguments, the same layering every other stat here holds to.
    let detection = segments::detect(&segments::detection_plays(&enriched), floors);

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
        suggested_segments: detection
            .segments
            .into_iter()
            .map(|s| CapturedSuggestedSegment {
                segment_type: segments::SEGMENT_TYPE_DANCEFLOOR.to_string(),
                first_position: s.first_position,
                last_position: s.last_position,
            })
            .collect(),
        idle_gaps: detection
            .idle_gaps
            .into_iter()
            .map(|g| CapturedIdleGap {
                start: g.start_epoch_s,
                end: g.end_epoch_s,
            })
            .collect(),
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

    /// An empty Story 5.2 calibration pool — a DJ's very first-ever session, so
    /// detection runs on the pure cold-start prior (D-9). The default for capture
    /// tests that are not about calibration.
    fn cold_start_pool() -> CalibrationPool {
        CalibrationPool::default()
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

    /// `entries` is `(path, epoch, title, artist)` — path stays purely a
    /// human-readable label in these tests (Story 4.3: identity is hashed from
    /// title+artist, not the path), kept so failures still read like "which
    /// track".
    fn library(entries: &[(&str, i64, &str, &str)]) -> DateAddedIndex {
        DateAddedIndex::fixed_with_identity(
            entries
                .iter()
                .map(|(path, epoch, title, artist)| {
                    (
                        (*path).to_string(),
                        (
                            *epoch,
                            Some((*title).to_string()),
                            Some((*artist).to_string()),
                        ),
                    )
                })
                .collect(),
        )
    }

    /// Shorthand for the id a `library()` entry's title+artist resolves to —
    /// used to assert against `scan_library_adds`' recorded rows without
    /// repeating `.expect(...)` at every call site.
    fn id_for(title: &str, artist: &str) -> String {
        track_id_from_title_artist(Some(title), Some(artist)).expect("both fields present")
    }

    const BASELINE_NOW: i64 = 1_700_000_000;

    #[test]
    fn track_id_from_title_artist_is_deterministic_and_never_the_raw_input() {
        let id = track_id_from_title_artist(Some("Song X"), Some("Arjun"));
        assert_eq!(
            id,
            track_id_from_title_artist(Some("Song X"), Some("Arjun")),
            "deterministic"
        );
        assert_ne!(
            id,
            track_id_from_title_artist(Some("Song Y"), Some("Arjun"))
        );
        let id = id.expect("both fields present resolves");
        assert_ne!(id, "Song X", "the raw title must never survive the hash");
        assert!(
            !id.contains("arjun"),
            "the raw artist must never survive the hash"
        );
        assert_eq!(id.len(), 16, "fnv1a_hex's fixed 16-hex-char form");
    }

    /// AD-11: one field alone is too little signal to trust as an identity —
    /// absent, never a fabricated partial hash.
    #[test]
    fn track_id_from_title_artist_requires_both_fields() {
        assert_eq!(track_id_from_title_artist(None, Some("Arjun")), None);
        assert_eq!(track_id_from_title_artist(Some("Song"), None), None);
        assert_eq!(track_id_from_title_artist(None, None), None);
        assert!(track_id_from_title_artist(Some("Song"), Some("Arjun")).is_some());
    }

    /// The fold matches `genre::normalize`'s own precedent exactly: case and
    /// surrounding whitespace must not split one track into two identities.
    #[test]
    fn track_id_from_title_artist_folds_case_and_whitespace() {
        let a = track_id_from_title_artist(Some("Deep House Jam"), Some("DJ Arjun"));
        let b = track_id_from_title_artist(Some("  deep house jam  "), Some("dj arjun"));
        assert_eq!(a, b, "case/whitespace fold must match");
    }

    /// A whitespace-only field is "no meaningful value," same as
    /// `genre::normalize`'s identical rule — not a real title/artist to hash.
    #[test]
    fn track_id_from_title_artist_whitespace_only_field_is_absent() {
        assert_eq!(track_id_from_title_artist(Some("   "), Some("Arjun")), None);
        assert_eq!(track_id_from_title_artist(Some("Song"), Some("   ")), None);
    }

    /// Story 4.3 review: an internal (not just leading/trailing) whitespace
    /// run must not split one track into two identities — a real drift
    /// between a catalog tag and an embedded ID3 tag for the same track.
    #[test]
    fn track_id_from_title_artist_collapses_internal_whitespace() {
        let a = track_id_from_title_artist(Some("Deep House Jam"), Some("DJ Arjun"));
        let b = track_id_from_title_artist(Some("Deep  House   Jam"), Some("DJ  Arjun"));
        assert_eq!(a, b, "internal whitespace runs must fold to one space");
    }

    /// Story 4.3 review: a literal `\u{1e}` byte in either field must not be
    /// able to shift the delimiter boundary and collide two different
    /// (title, artist) pairs into one hash.
    #[test]
    fn track_id_from_title_artist_rejects_the_delimiter_byte() {
        assert_eq!(
            track_id_from_title_artist(Some("A\u{1e}B"), Some("C")),
            None,
            "a delimiter byte in title resolves to absent, not a shifted-boundary hash"
        );
        assert_eq!(
            track_id_from_title_artist(Some("A"), Some("B\u{1e}C")),
            None,
            "a delimiter byte in artist resolves to absent, not a shifted-boundary hash"
        );
    }

    /// Restored after Story 4.3's identity switch dropped the only test
    /// covering `portable_form` (review finding): it no longer feeds track
    /// identity, but it is still the date-added join key — a `.session`
    /// log's absolute path and `database V2`'s stored relative path for the
    /// SAME track must still land on one `portable_form` output, or every
    /// legacy play's date-added lookup would silently miss.
    #[test]
    fn portable_form_normalizes_absolute_and_relative_to_the_same_join_key() {
        assert_eq!(
            portable_form("/Users/arjun/Music/x.mp3"),
            portable_form("Users/arjun/Music/x.mp3")
        );
        assert_eq!(
            portable_form("Users/arjun/Music/x.mp3"),
            "Users/arjun/Music/x.mp3"
        );
    }

    /// D-1 / AC-4, the single easiest way to get this story catastrophically
    /// wrong: a DJ who has dug for years must not see their whole
    /// back-catalogue appear as "added this month" the first time Curfew runs.
    #[test]
    fn first_run_seeds_the_whole_library_silently_and_emits_zero_add_events() {
        let (_file, conn) = TempStore::open("first-run");
        let dates = library(&[
            (
                "Users/arjun/Music/a.mp3",
                1_600_000_000,
                "Track A",
                "Artist A",
            ),
            (
                "Users/arjun/Music/b.mp3",
                1_600_000_001,
                "Track B",
                "Artist B",
            ),
            ("A Indian/c.mp3", 1_600_000_002, "Track C", "Artist C"),
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

    /// A catalogued track with no resolvable title or artist has no identity
    /// to record under and is silently excluded — never crashes the scan, and
    /// never fabricates a partial-input identity for it.
    #[test]
    fn a_track_with_no_title_or_artist_is_excluded_from_the_scan_entirely() {
        let (_file, conn) = TempStore::open("untitled");
        let dates = DateAddedIndex::fixed_with_identity(std::collections::HashMap::from([
            (
                "Users/arjun/Music/a.mp3".to_string(),
                (
                    1_600_000_000,
                    Some("Track A".to_string()),
                    Some("Artist A".to_string()),
                ),
            ),
            (
                "Users/arjun/Music/untitled.mp3".to_string(),
                (1_600_000_001, None, None),
            ),
        ]));

        let outcome = scan_library_adds(&conn, &dates, BASELINE_NOW).expect("scan");

        assert_eq!(
            outcome.baselined, 1,
            "only the identifiable track is recorded"
        );
    }

    #[test]
    fn a_genuinely_new_track_on_a_later_scan_emits_exactly_one_event() {
        let (_file, conn) = TempStore::open("new-track");
        let dates = library(&[(
            "Users/arjun/Music/a.mp3",
            1_600_000_000,
            "Track A",
            "Artist A",
        )]);
        scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline");

        // A track added AFTER the baseline was taken — a real go-forward add.
        let grown = library(&[
            (
                "Users/arjun/Music/a.mp3",
                1_600_000_000,
                "Track A",
                "Artist A",
            ),
            (
                "Users/arjun/Music/new.mp3",
                BASELINE_NOW + 86_400,
                "New Track",
                "New Artist",
            ),
        ]);
        let outcome = scan_library_adds(&conn, &grown, BASELINE_NOW + 90_000).expect("scan");

        assert_eq!(outcome.added, 1);
        assert_eq!(outcome.baselined, 0);
        let pending = crate::store::library_add_events_pending_sync(&conn).expect("pending");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].track_id, id_for("New Track", "New Artist"));
        assert_eq!(pending[0].added_at, Some(BASELINE_NOW + 86_400));
    }

    #[test]
    fn rescanning_an_unchanged_library_emits_nothing() {
        let (_file, conn) = TempStore::open("unchanged");
        let dates = library(&[
            (
                "Users/arjun/Music/a.mp3",
                1_600_000_000,
                "Track A",
                "Artist A",
            ),
            (
                "Users/arjun/Music/b.mp3",
                1_600_000_001,
                "Track B",
                "Artist B",
            ),
        ]);
        scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline");

        for tick in 1..=3 {
            let outcome = scan_library_adds(&conn, &dates, BASELINE_NOW + tick).expect("rescan");
            assert_eq!(
                outcome,
                LibraryScanOutcome {
                    catalogue_rows: 2,
                    ..Default::default()
                },
                "rescan {tick} is a no-op"
            );
        }
    }

    #[test]
    fn a_new_track_is_emitted_once_and_never_re_emitted() {
        let (_file, conn) = TempStore::open("emit-once");
        let dates = library(&[(
            "Users/arjun/Music/a.mp3",
            1_600_000_000,
            "Track A",
            "Artist A",
        )]);
        scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline");

        let grown = library(&[
            (
                "Users/arjun/Music/a.mp3",
                1_600_000_000,
                "Track A",
                "Artist A",
            ),
            (
                "Users/arjun/Music/new.mp3",
                BASELINE_NOW + 10,
                "New Track",
                "New Artist",
            ),
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

    /// Test-only accessor: title/artist/added_at/is_baseline for one row —
    /// used by Story 4.11's tag-mutability tests to assert directly against
    /// the persisted columns rather than only the derived event counts.
    fn library_track_row(
        conn: &Connection,
        track_id: &str,
    ) -> (Option<String>, Option<String>, Option<i64>, bool) {
        conn.query_row(
            "SELECT title, artist, added_at, is_baseline FROM library_tracks WHERE track_id = ?1",
            [track_id],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, i64>(3)? != 0,
                ))
            },
        )
        .expect("row exists")
    }

    /// Story 4.11 AC-1: title/artist reach `library_tracks` on a genuine
    /// go-forward add, not just the identity hash.
    #[test]
    fn a_fresh_add_persists_title_and_artist() {
        let (_file, conn) = TempStore::open("fresh-add-tags");
        let baseline = library(&[(
            "Users/arjun/Music/a.mp3",
            1_600_000_000,
            "Track A",
            "Artist A",
        )]);
        scan_library_adds(&conn, &baseline, BASELINE_NOW).expect("real baseline");

        let grown = library(&[
            (
                "Users/arjun/Music/a.mp3",
                1_600_000_000,
                "Track A",
                "Artist A",
            ),
            (
                "Users/arjun/Music/new.mp3",
                BASELINE_NOW + 10,
                "New Track",
                "New Artist",
            ),
        ]);
        let outcome = scan_library_adds(&conn, &grown, BASELINE_NOW + 20).expect("scan");
        assert_eq!(outcome.added, 1);

        let id = id_for("New Track", "New Artist");
        let (title, artist, added_at, is_baseline) = library_track_row(&conn, &id);
        assert_eq!(title.as_deref(), Some("New Track"));
        assert_eq!(artist.as_deref(), Some("New Artist"));
        assert_eq!(added_at, Some(BASELINE_NOW + 10));
        assert!(!is_baseline);
    }

    /// Story 4.11 AC-3: a baseline track (D-1's silent first-run snapshot)
    /// gets its title/artist recorded too — the roster's whole point is that
    /// baseline tracks DO reach it, unlike `library_track_events`.
    #[test]
    fn a_baseline_track_persists_title_and_artist() {
        let (_file, conn) = TempStore::open("baseline-tags");
        let dates = library(&[(
            "Users/arjun/Music/a.mp3",
            1_600_000_000,
            "Track A",
            "Artist A",
        )]);
        let outcome = scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline scan");
        assert_eq!(outcome.baselined, 1);

        let id = id_for("Track A", "Artist A");
        let (title, artist, _, is_baseline) = library_track_row(&conn, &id);
        assert_eq!(title.as_deref(), Some("Track A"));
        assert_eq!(artist.as_deref(), Some("Artist A"));
        assert!(is_baseline);
    }

    /// Story 4.11 AC-4: a re-tagged track (raw title/artist string changed in
    /// Serato, same normalized identity is impossible here since identity
    /// itself derives from title+artist — so this simulates the DJ fixing
    /// capitalization/whitespace, a real-world "same song, cleaned-up tag"
    /// edit that folds to the same `track_id` but a different raw string)
    /// updates in place on a later scan, without moving `added_at` or
    /// `is_baseline`.
    #[test]
    fn a_retagged_track_updates_title_artist_without_touching_added_at_or_baseline_flag() {
        let (_file, conn) = TempStore::open("retag");
        let dates = library(&[(
            "Users/arjun/Music/a.mp3",
            1_600_000_000,
            "track a",
            "artist a",
        )]);
        scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline scan");

        let id = id_for("track a", "artist a");
        let (title_before, ..) = library_track_row(&conn, &id);
        assert_eq!(title_before.as_deref(), Some("track a"));

        // Same identity (normalized fold is unchanged), cleaned-up raw tag.
        let retagged = library(&[(
            "Users/arjun/Music/a.mp3",
            1_600_000_000,
            "Track A",
            "Artist A",
        )]);
        let outcome = scan_library_adds(&conn, &retagged, BASELINE_NOW + 100).expect("retag scan");
        assert_eq!(
            outcome,
            LibraryScanOutcome {
                catalogue_rows: 1,
                ..Default::default()
            },
            "a retag is not an add/baseline event"
        );

        let (title_after, artist_after, added_at_after, is_baseline_after) =
            library_track_row(&conn, &id);
        assert_eq!(title_after.as_deref(), Some("Track A"), "tag refreshed");
        assert_eq!(artist_after.as_deref(), Some("Artist A"), "tag refreshed");
        assert_eq!(
            added_at_after,
            Some(1_600_000_000),
            "added_at must not move on a re-tag"
        );
        assert!(is_baseline_after, "is_baseline must not move on a re-tag");
    }

    /// Test-only accessor: `absent_at` for one row.
    fn library_track_absent_at(conn: &Connection, track_id: &str) -> Option<i64> {
        conn.query_row(
            "SELECT absent_at FROM library_tracks WHERE track_id = ?1",
            [track_id],
            |row| row.get::<_, Option<i64>>(0),
        )
        .expect("row exists")
    }

    /// Story 4.11 AC-5: a track present in one scan and missing from the next
    /// is marked absent, not hard-deleted — the row (and its history) stays.
    #[test]
    fn a_track_missing_from_a_later_scan_is_marked_absent_not_deleted() {
        let (_file, conn) = TempStore::open("absence");
        let dates = library(&[
            (
                "Users/arjun/Music/a.mp3",
                1_600_000_000,
                "Track A",
                "Artist A",
            ),
            (
                "Users/arjun/Music/b.mp3",
                1_600_000_001,
                "Track B",
                "Artist B",
            ),
        ]);
        scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline scan");

        let id_a = id_for("Track A", "Artist A");
        let id_b = id_for("Track B", "Artist B");
        assert_eq!(library_track_absent_at(&conn, &id_a), None);

        // Track B deleted from the library on the next scan.
        let shrunk = library(&[(
            "Users/arjun/Music/a.mp3",
            1_600_000_000,
            "Track A",
            "Artist A",
        )]);
        scan_library_adds(&conn, &shrunk, BASELINE_NOW + 100).expect("shrunk scan");

        assert_eq!(
            library_track_absent_at(&conn, &id_a),
            None,
            "still-present track stays not-absent"
        );
        assert_eq!(
            library_track_absent_at(&conn, &id_b),
            Some(BASELINE_NOW + 100),
            "removed track is marked absent, timestamped"
        );
        assert_eq!(
            crate::store::known_track_ids(&conn)
                .expect("known ids")
                .len(),
            2,
            "the absent track's row must still exist -- never a hard delete"
        );
    }

    /// Story 4.11 AC-5: a track that reappears after being marked absent has
    /// `absent_at` cleared, keeping its original identity/history rather than
    /// being re-baselined as a brand-new track.
    #[test]
    fn a_reappearing_track_clears_absent_at() {
        let (_file, conn) = TempStore::open("reappear");
        // A second, unrelated track keeps every scan's catalogue non-empty —
        // an EMPTY catalogue is "unreachable" and a no-op (see
        // `an_unreachable_library_is_a_no_op_not_an_empty_baseline`), not the
        // same thing as "the library now genuinely has zero tracks."
        let anchor = (
            "Users/arjun/Music/anchor.mp3",
            1_600_000_002,
            "Anchor Track",
            "Anchor Artist",
        );
        let full = library(&[
            (
                "Users/arjun/Music/a.mp3",
                1_600_000_000,
                "Track A",
                "Artist A",
            ),
            anchor,
        ]);
        scan_library_adds(&conn, &full, BASELINE_NOW).expect("baseline scan");
        let without_a = library(&[anchor]);
        scan_library_adds(&conn, &without_a, BASELINE_NOW + 100).expect("removed scan");

        let id = id_for("Track A", "Artist A");
        assert_eq!(
            library_track_absent_at(&conn, &id),
            Some(BASELINE_NOW + 100)
        );

        scan_library_adds(&conn, &full, BASELINE_NOW + 200).expect("reappear scan");
        assert_eq!(
            library_track_absent_at(&conn, &id),
            None,
            "a reappeared track is no longer absent"
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
        let dates = library(&[(
            "Users/arjun/Music/a.mp3",
            1_600_000_000,
            "Track A",
            "Artist A",
        )]);
        scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline");

        let undated = id_for("Undated Track", "Undated Artist");
        crate::store::record_library_tracks(
            &conn,
            &[(undated.clone(), None, None, None)],
            false,
            BASELINE_NOW + 10,
        )
        .expect("record");

        let pending = crate::store::library_add_events_pending_sync(&conn).expect("pending");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].track_id, undated);
        assert_eq!(pending[0].added_at, None, "absent, never a fabricated date");
    }

    /// Story 4.3 review: a track catalogued on two drives now hashes to one
    /// `track_id` under two different `added_at`s (the drive-split scenario
    /// Decision E-2 exists to unify). The winner must be deterministic
    /// (earliest `added_at`) regardless of which drive's row the caller sees
    /// first, and only one `library_tracks` row must ever be recorded for it.
    #[test]
    fn a_track_on_two_drives_records_one_row_with_the_earliest_added_at() {
        let (_file, conn) = TempStore::open("cross-drive");
        let dates = DateAddedIndex::fixed_with_identity(std::collections::HashMap::from([
            (
                "Users/arjun/Music/a.mp3".to_string(),
                (
                    1_600_000_100,
                    Some("Deep House Jam".to_string()),
                    Some("DJ Arjun".to_string()),
                ),
            ),
            (
                "A Indian/a.mp3".to_string(),
                (
                    1_600_000_000, // the earlier of the two — must win
                    Some("Deep House Jam".to_string()),
                    Some("DJ Arjun".to_string()),
                ),
            ),
        ]));

        let outcome = scan_library_adds(&conn, &dates, BASELINE_NOW).expect("scan");
        assert_eq!(outcome.baselined, 1, "one identity, one recorded row");

        assert_eq!(
            crate::store::library_track_count(&conn).expect("count"),
            1,
            "no duplicate/conflicting row for the shared track_id"
        );
    }

    /// Story 4.3 review: an agent with pre-existing `library_tracks` rows
    /// (from before this story's identity switch) must not re-emit its whole
    /// already-synced library as fresh add-events on the first post-upgrade
    /// scan — the one-time `identity_migration_done` guard re-baselines
    /// everything currently identifiable instead.
    #[test]
    fn an_already_deployed_agent_re_baselines_once_on_the_identity_cutover() {
        let (_file, conn) = TempStore::open("upgrade");
        // Simulate pre-4.3 state: a row recorded under the retired path-hash
        // scheme, with no `identity_migration_done` flag set.
        crate::store::record_library_tracks(
            &conn,
            &[(
                "old-path-hash-deadbeef".to_string(),
                Some(1_500_000_000),
                None,
                None,
            )],
            false,
            1_500_000_000,
        )
        .expect("seed pre-4.3 row");
        assert!(!crate::store::identity_migration_done(&conn).expect("flag read"));

        // A track added well after any plausible original baseline — exactly
        // the case that would otherwise flood as a spurious fresh add-event.
        let dates = library(&[(
            "Users/arjun/Music/new.mp3",
            BASELINE_NOW - 1_000,
            "New Track",
            "New Artist",
        )]);

        let outcome = scan_library_adds(&conn, &dates, BASELINE_NOW).expect("cutover scan");
        assert_eq!(
            outcome.added, 0,
            "the cutover scan re-baselines silently, never emits a fresh add-event"
        );
        assert_eq!(outcome.baselined, 1);
        assert!(crate::store::identity_migration_done(&conn).expect("flag read"));

        // A genuinely new track on the NEXT scan behaves normally again.
        let grown = library(&[
            (
                "Users/arjun/Music/new.mp3",
                BASELINE_NOW - 1_000,
                "New Track",
                "New Artist",
            ),
            (
                "Users/arjun/Music/newer.mp3",
                BASELINE_NOW + 10,
                "Newer Track",
                "Newer Artist",
            ),
        ]);
        let outcome =
            scan_library_adds(&conn, &grown, BASELINE_NOW + 20).expect("post-cutover scan");
        assert_eq!(
            outcome.added, 1,
            "back to normal add-detection after the cutover"
        );
    }

    /// The second shape of D-1's trap: a USB volume unmounted when the
    /// baseline was taken, mounted later. Its tracks are new to the local
    /// store but demonstrably predate the baseline, so they seed silently
    /// rather than flooding a cohort with a decade of digging.
    #[test]
    fn a_late_mounting_volume_seeds_silently_rather_than_flooding_a_cohort() {
        let (_file, conn) = TempStore::open("late-mount");
        let boot_only = library(&[(
            "Users/arjun/Music/a.mp3",
            1_600_000_000,
            "Track A",
            "Artist A",
        )]);
        scan_library_adds(&conn, &boot_only, BASELINE_NOW).expect("baseline");

        let usb_mounted = library(&[
            (
                "Users/arjun/Music/a.mp3",
                1_600_000_000,
                "Track A",
                "Artist A",
            ),
            (
                "A Indian/old-1.mp3",
                BASELINE_NOW - 86_400, // pre-dates the baseline
                "Old Track 1",
                "Old Artist 1",
            ),
            (
                "A Indian/old-2.mp3",
                1_500_000_000,
                "Old Track 2",
                "Old Artist 2",
            ),
            (
                "A Indian/genuinely-new.mp3",
                BASELINE_NOW + 86_400,
                "Genuinely New",
                "New Artist",
            ),
        ]);
        let outcome = scan_library_adds(&conn, &usb_mounted, BASELINE_NOW + 90_000).expect("scan");

        assert_eq!(outcome.baselined, 2, "pre-baseline tracks seed silently");
        assert_eq!(outcome.added, 1, "only the genuinely-new track converts");
        let pending = crate::store::library_add_events_pending_sync(&conn).expect("pending");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].track_id, id_for("Genuinely New", "New Artist"));
    }

    /// An unplugged drive shrinks the library. That is not a deletion, and
    /// re-plugging it is not a thousand new adds.
    ///
    /// **This test now inspects `absent_at`, which it did not before (Story
    /// 4.11 code review).** It previously asserted only on `LibraryScanOutcome`,
    /// so when this story added soft-delete marking it kept passing while the
    /// invariant it is named for — `joiner::date_added`'s "a library that
    /// shrinks because a drive was unplugged must never look like tracks were
    /// *removed*" — was actually broken. Declaring roots is what makes the
    /// completeness gate observable at all.
    #[test]
    fn an_unmounted_volume_neither_deletes_nor_re_adds_on_return() {
        let (_file, conn) = TempStore::open("unmount");
        let entries = |with_usb: bool| {
            let mut m = std::collections::HashMap::from([(
                "Users/arjun/Music/a.mp3".to_string(),
                (
                    1_600_000_000,
                    Some("Track A".to_string()),
                    Some("Artist A".to_string()),
                ),
            )]);
            if with_usb {
                m.insert(
                    "A Indian/usb.mp3".to_string(),
                    (
                        1_600_000_001,
                        Some("USB Track".to_string()),
                        Some("USB Artist".to_string()),
                    ),
                );
            }
            m
        };
        let both = DateAddedIndex::fixed_with_identity_and_roots(
            entries(true),
            &["/Users/arjun/Music", "/Volumes/A Indian"],
        );
        scan_library_adds(&conn, &both, BASELINE_NOW).expect("baseline");
        let usb_id = id_for("USB Track", "USB Artist");

        // The USB drive is unplugged: its catalogue root is no longer reached.
        let boot_only =
            DateAddedIndex::fixed_with_identity_and_roots(entries(false), &["/Users/arjun/Music"]);
        assert_eq!(
            scan_library_adds(&conn, &boot_only, BASELINE_NOW + 10).expect("unplugged"),
            LibraryScanOutcome {
                catalogue_rows: 1,
                ..Default::default()
            }
        );
        assert_eq!(
            library_track_absent_at(&conn, &usb_id),
            None,
            "an unplugged drive's tracks must NEVER be marked absent — they are \
             unreachable, not removed"
        );

        assert_eq!(
            scan_library_adds(&conn, &both, BASELINE_NOW + 20).expect("replugged"),
            LibraryScanOutcome {
                catalogue_rows: 2,
                ..Default::default()
            },
            "a returning volume's tracks are already on file"
        );
        assert_eq!(
            library_track_absent_at(&conn, &usb_id),
            None,
            "and are still not absent after the drive returns"
        );
    }

    /// The other half of the same gate: a scan that reaches everything it has
    /// ever reached IS allowed to conclude a track was genuinely removed.
    #[test]
    fn a_complete_scan_still_marks_a_genuinely_removed_track_absent() {
        let (_file, conn) = TempStore::open("complete-scan-absence");
        let roots = ["/Users/arjun/Music"];
        let mut with_both = std::collections::HashMap::from([
            (
                "Users/arjun/Music/a.mp3".to_string(),
                (
                    1_600_000_000,
                    Some("Track A".to_string()),
                    Some("Artist A".to_string()),
                ),
            ),
            (
                "Users/arjun/Music/b.mp3".to_string(),
                (
                    1_600_000_001,
                    Some("Track B".to_string()),
                    Some("Artist B".to_string()),
                ),
            ),
        ]);
        scan_library_adds(
            &conn,
            &DateAddedIndex::fixed_with_identity_and_roots(with_both.clone(), &roots),
            BASELINE_NOW,
        )
        .expect("baseline");

        // Same root still reached, but one track really is gone from it.
        with_both.remove("Users/arjun/Music/b.mp3");
        scan_library_adds(
            &conn,
            &DateAddedIndex::fixed_with_identity_and_roots(with_both, &roots),
            BASELINE_NOW + 10,
        )
        .expect("removal scan");

        assert_eq!(
            library_track_absent_at(&conn, &id_for("Track B", "Artist B")),
            Some(BASELINE_NOW + 10),
            "a track missing from a COMPLETE scan is a real removal"
        );
        assert_eq!(
            library_track_absent_at(&conn, &id_for("Track A", "Artist A")),
            None,
            "the track that is still there stays present"
        );
    }

    /// A scan that resolves no identities at all must never conclude the whole
    /// library was deleted (Story 4.11 code review).
    #[test]
    fn a_scan_that_identifies_nothing_marks_no_track_absent() {
        let (_file, conn) = TempStore::open("identifies-nothing");
        let roots = ["/Users/arjun/Music"];
        let tagged = std::collections::HashMap::from([(
            "Users/arjun/Music/a.mp3".to_string(),
            (
                1_600_000_000,
                Some("Track A".to_string()),
                Some("Artist A".to_string()),
            ),
        )]);
        scan_library_adds(
            &conn,
            &DateAddedIndex::fixed_with_identity_and_roots(tagged, &roots),
            BASELINE_NOW,
        )
        .expect("baseline");

        // Catalogue still parses and still has rows, but nothing resolves an
        // identity any more — a tagging regression, not a mass deletion.
        let untagged = std::collections::HashMap::from([(
            "Users/arjun/Music/a.mp3".to_string(),
            (1_600_000_000, None, None),
        )]);
        let outcome = scan_library_adds(
            &conn,
            &DateAddedIndex::fixed_with_identity_and_roots(untagged, &roots),
            BASELINE_NOW + 10,
        )
        .expect("untagged scan");
        assert_eq!(outcome.excluded_no_identity, 1);
        assert_eq!(
            library_track_absent_at(&conn, &id_for("Track A", "Artist A")),
            None,
            "a scan that identifies nothing must not mark the library absent"
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

        let reachable = library(&[(
            "A Indian/a.mp3",
            1_600_000_000,
            "Reachable Track",
            "Reachable Artist",
        )]);
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

        let (plays, derived) =
            build_legacy(&root, &file.0, &cold_start_pool()).expect("synthetic session captures");
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

        let result = build_legacy(&root, &file.0, &cold_start_pool());
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

        let (plays, _derived) = build_serato4(&dir, &db_path, 7, &no_dates(), &cold_start_pool())
            .expect("build_serato4 succeeds");
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

        let result = build_serato4(&dir, &db_path, 999, &no_dates(), &cold_start_pool());
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

        let (_plays, derived) = build_serato4(&dir, &db_path, 7, &no_dates(), &cold_start_pool())
            .expect("build_serato4 succeeds");
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

        let (plays, derived) = build_serato4(&dir, &db_path, 7, &no_dates(), &cold_start_pool())
            .expect("build_serato4 succeeds");
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

        let (plays, derived) = build_serato4(&dir, &db_path, 7, &dates, &cold_start_pool())
            .expect("build_serato4 succeeds");
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

        let result = build_serato4(&dir, &db_path, 7, &no_dates(), &cold_start_pool());
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

    /// Story 4.11 Task 9 (NFR-1): this story adds real write volume to every
    /// scan — title/artist persistence (Task 1), absence marking (Task 2),
    /// and the exclusion counter (Task 3) all ride `scan_library_adds`, which
    /// previously wrote nothing but two scalars per row. Mirrors `stats::mod`'s
    /// own `per_set_stat_computation_stays_within_regression_guard_bound`
    /// pattern: synthetic data at NFR-1's own stated scale (~5,000 tracks),
    /// a real on-disk SQLite store (not an in-memory shortcut — the actual
    /// write path this story changed), a generous bound with real margin
    /// under NFR-1's 10s full-library budget (which also has to cover the
    /// actual Serato parse this test doesn't exercise at all).
    #[test]
    fn full_library_scan_with_tag_persistence_stays_within_regression_guard_bound() {
        use std::time::Instant;

        let (_file, conn) = TempStore::open("nfr1-perf");
        let synthetic: Vec<(String, i64, String, String)> = (0..5_000)
            .map(|i| {
                (
                    format!("Users/arjun/Music/track_{i}.mp3"),
                    1_600_000_000 + i as i64,
                    format!("Track {i}"),
                    format!("Artist {}", i % 200),
                )
            })
            .collect();
        let dates = library(
            &synthetic
                .iter()
                .map(|(p, e, t, a)| (p.as_str(), *e, t.as_str(), a.as_str()))
                .collect::<Vec<_>>(),
        );

        // First scan: the baseline write (record_library_tracks, 5,000 inserts).
        let start = Instant::now();
        let baseline_outcome = scan_library_adds(&conn, &dates, BASELINE_NOW).expect("baseline");
        let baseline_elapsed = start.elapsed();
        assert_eq!(baseline_outcome.baselined, 5_000);

        // Second scan, identical library: every row is now "known" and goes
        // through refresh_library_track_tags (Task 1's update path) instead
        // of being skipped — this is the actual new write volume, since a
        // pre-4.11 rescan of an unchanged library touched the DB zero times.
        let start = Instant::now();
        let rescan_outcome = scan_library_adds(&conn, &dates, BASELINE_NOW + 100).expect("rescan");
        let rescan_elapsed = start.elapsed();
        assert_eq!(
            rescan_outcome,
            LibraryScanOutcome {
                catalogue_rows: 5_000,
                ..Default::default()
            }
        );

        assert!(
            baseline_elapsed.as_millis() < 2_000,
            "baseline scan of 5,000 tracks took {baseline_elapsed:?}, expected well under \
             NFR-1's 10s full-library budget. The bound tracks the observed cost (~775ms \
             for this phase under full parallel test load, ~2.5x headroom) rather than \
             sitting just inside the 10s budget: at the old 5s bound a 6x regression would \
             still have passed silently, which is not a guard (Story 4.11 code review). \
             Margin for the real Serato parse this synthetic test doesn't exercise lives \
             in the 10s budget, not in this assertion."
        );
        assert!(
            rescan_elapsed.as_millis() < 2_000,
            "unchanged-library rescan of 5,000 tracks took {rescan_elapsed:?} -- this is the \
             write volume Story 4.11 actually added (refresh_library_track_tags now runs on \
             every known row instead of being skipped), expected well under NFR-1's budget"
        );
    }

    // ---- Story 5.2: calibration pool wiring (Task 2, D-23) -----------------

    /// A synthetic `master.sqlite` holding `sessions` dense nights, each one
    /// hour apart, `plays` tracks 150 s apart at 128 BPM — the shape detection
    /// confirms as a dancefloor at cold start.
    fn seed_serato4_nights(dir: &Path, sessions: &[(i64, i64, usize)]) -> PathBuf {
        let db_path = dir.join("master.sqlite");
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
        for &(session_id, start, plays) in sessions {
            for i in 0..plays {
                insert_entry(
                    &seed,
                    session_id,
                    &format!("S{session_id}T{i}"),
                    "Artist",
                    "House",
                    "1A",
                    128.0,
                    start + i as i64 * 150,
                    "1",
                );
            }
        }
        db_path
    }

    /// Captures one synthetic night into `store_conn` exactly the way
    /// `watcher::capture_and_store_serato4` does — pool loaded at the edge,
    /// handed to the pure builder — and returns its serialized `derived_json`.
    fn capture_night(
        store_conn: &Connection,
        dir: &Path,
        db_path: &Path,
        session_id: i64,
    ) -> String {
        let pool = load_calibration_pool(store_conn);
        let (plays, derived) =
            build_serato4(dir, db_path, session_id, &no_dates(), &pool).expect("night captures");
        let (started_at, ended_at) = session_bounds(&plays);
        crate::store::upsert_captured(
            store_conn,
            &serato4_session_identity(session_id),
            crate::store::SessionSource::Serato4,
            &serato4_raw_ref(db_path, session_id),
            started_at,
            ended_at,
            &plays,
            &derived,
        )
        .expect("store write");
        serde_json::to_string(&derived).expect("derived serializes")
    }

    /// (Task 2.4, D-23 — the no-churn property, asserted rather than assumed.)
    ///
    /// Re-deriving an older session AFTER newer nights have been captured must
    /// produce byte-identical `derived_json`. If it did not, every launch's
    /// `backfill_captured_serato4` sweep would rewrite and re-queue the whole
    /// local history forever, and suggestions the DJ has already seen would
    /// silently move under them.
    #[test]
    fn re_deriving_an_old_session_after_new_captures_is_byte_identical() {
        let dir = std::env::temp_dir().join(format!(
            "curfew_capture_calibration_churn_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir creates");
        let db_path = seed_serato4_nights(
            &dir,
            &[(1, 100_000, 20), (2, 200_000, 20), (3, 300_000, 60)],
        );
        let (_file, store) = TempStore::open("calibration-churn");

        capture_night(&store, &dir, &db_path, 1);
        let night_two_first_pass = capture_night(&store, &dir, &db_path, 2);

        // A much bigger night lands afterwards — it WOULD move an "all history
        // now" pool's percentiles, which is exactly what the chronological rule
        // exists to prevent.
        capture_night(&store, &dir, &db_path, 3);

        let pool = load_calibration_pool(&store);
        let (_, rederived) =
            build_serato4(&dir, &db_path, 2, &no_dates(), &pool).expect("re-derivation succeeds");
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(
            serde_json::to_string(&rederived).expect("serializes"),
            night_two_first_pass,
            "a re-derivation after later captures must be byte-identical (D-23)"
        );
    }

    /// (Task 2.4) A session below `MIN_PLAYS_FOR_DETECTION` — a two-track cue-up
    /// — contributes no windows and is dropped from the pool entirely, so it can
    /// neither drag the floors down nor count toward the blend weight.
    #[test]
    fn a_sub_min_plays_session_is_excluded_from_the_loaded_pool() {
        let dir = std::env::temp_dir().join(format!(
            "curfew_capture_calibration_cueup_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir creates");
        let db_path = seed_serato4_nights(&dir, &[(1, 100_000, 20), (2, 200_000, 2)]);
        let (_file, store) = TempStore::open("calibration-cueup");

        capture_night(&store, &dir, &db_path, 1);
        capture_night(&store, &dir, &db_path, 2);
        let pool = load_calibration_pool(&store);
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(
            pool.len(),
            1,
            "the 2-play cue-up must not be in the calibration pool"
        );
    }

    /// (Task 2.4, D-9) A DJ's very first-ever session has no history to
    /// calibrate against, so it runs on the pure prior — no cliff, no empty
    /// state, and a real dancefloor suggestion on night one.
    #[test]
    fn the_first_ever_session_calibrates_against_the_pure_prior() {
        let dir = std::env::temp_dir().join(format!(
            "curfew_capture_calibration_cold_{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("temp dir creates");
        let db_path = seed_serato4_nights(&dir, &[(1, 100_000, 20)]);
        let (_file, store) = TempStore::open("calibration-cold");

        let pool = load_calibration_pool(&store);
        assert!(pool.is_empty(), "a fresh install has no history");
        assert_eq!(
            pool.floors_before(Some(100_000), &serato4_session_identity(1)),
            segments::Floors::prior()
        );

        let (_, derived) =
            build_serato4(&dir, &db_path, 1, &no_dates(), &pool).expect("first night captures");
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(derived.suggested_segments.len(), 1);
        assert_eq!(derived.suggested_segments[0].segment_type, "dancefloor");
        assert_eq!(derived.suggested_segments[0].first_position, 1);
    }
}
