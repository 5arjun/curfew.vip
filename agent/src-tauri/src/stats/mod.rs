//! Per-set stat engine (Story 1.7): the `stat-engine` filter of the agent pipeline
//! documented in [`crate`](../lib.rs) (`watcher -> parser -> joiner -> stat-engine ->
//! local store -> sync-queue`) — the fourth stage, and the first one that reads from
//! *two* upstream filters at once ([`crate::parser::Play`] and
//! [`crate::joiner::JoinedMetadata`]) rather than one.
//!
//! Two sub-concerns:
//! - **Assembly** ([`enrich`]/[`enrich_session`], Task 1): combines a `Play`, its
//!   `JoinedMetadata`, and [`crate::genre::normalize`]'s output into one
//!   [`EnrichedPlay`] record per play — the first-ever per-play assembly step in this
//!   codebase, closing Story 1.6's deferred genre-source-selection question (and a
//!   newly-identified key-source-selection question) explicitly, as its own named
//!   step, rather than letting it dissolve into inline logic scattered across the
//!   stat functions below.
//! - **Stats** (Tasks 2/4, plus [`camelot`] for Task 3): a family of pure functions
//!   over `&[EnrichedPlay]` producing per-set summary stats (most-played
//!   tracks/artists, genre breakdown, BPM distribution, set length, track count),
//!   Camelot-wheel mixing stats, and the energy-arc series (FR-7 foundation).
//!
//! Design invariants (AC-3, NFR-1, NFR-3):
//! - **Arithmetic-only.** Every stat here is counting, ranking, mean/median, or mod-12
//!   equality/adjacency (see [`camelot::compatible`]) — no ML crate, no heuristic
//!   scoring, no audio DSP. A future contributor "helpfully" adding a similarity score
//!   here would violate this standing invariant (mirrors [`crate::genre`]'s own
//!   "no audio analysis / ML / fuzzy classification" line) — don't.
//! - **Deterministic.** The same `&[EnrichedPlay]` always produces the same stat
//!   output — no randomness, no hash-iteration-order-dependent tiebreaks (ranking
//!   ties break on first-seen order in the input, never on `HashMap` iteration order).
//! - **Never guessed** (AD-11). A field absent on the input stays absent in the
//!   output; nothing here fabricates a track identity, a genre, or a key.
//!
//! What this filter deliberately does *not* do: segment detection (AD-17/FR-28 —
//! Epic 5's job against this module later, even though AD-17 already names this
//! module as where it will eventually live); the FR-27 live/practice confidence
//! signal (Story 1.8, the very next story — a session-level classification, not a
//! per-set stat, so no confidence field is added to any type here); persistence (no
//! local store yet — Epic 2 Story 2.8; no `shared/` sync-contract field yet — Story
//! 1.10). This module's job ends at producing typed in-memory stat values from a
//! `Vec<EnrichedPlay>`.

/// Camelot-wheel key parsing and harmonic-mixing compatibility (Task 3).
pub mod camelot;

use crate::genre::{self, NormalizedGenre};
use crate::joiner::JoinedMetadata;
use crate::parser::Play;
use camelot::CamelotKey;
use std::collections::HashMap;

/// One play, assembled from its [`Play`] and [`JoinedMetadata`] halves plus a
/// normalized genre and a parsed Camelot key (Task 1).
///
/// Every field is independently optional, nothing silently defaulted — the same
/// discipline [`Play`] and [`JoinedMetadata`] themselves hold to. Produced only by
/// [`enrich`]/[`enrich_session`]; never constructed by adding fields to `Play` or
/// `JoinedMetadata` directly (both are frozen by their owning stories).
#[derive(Debug, Clone, PartialEq)]
pub struct EnrichedPlay {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub path: Option<String>,
    pub start_time: Option<u32>,
    pub bpm: Option<f64>,
    pub genre: Option<NormalizedGenre>,
    pub camelot: Option<CamelotKey>,
}

/// Assembles one [`EnrichedPlay`] from a play and its joined metadata (Task 1).
///
/// Total and infallible — same idiom as [`crate::genre::normalize`] and
/// [`crate::joiner::embedded_tags::fill_gaps`]: every input has a defined output, so
/// no `Result`. Implements the two source-selection policies the story's Scope
/// Boundaries section fixes:
/// - **genre**: prefer `joined.genre` (already resolved through the full
///   library/embedded-tag fallback chain, Stories 1.4/1.5) and fall back to
///   `play.genre` (the play-log's own inline tag) only when `joined.genre` is `None`.
///   Whichever raw string wins is fed into [`genre::normalize`]; the two are never
///   merged or concatenated.
/// - **key**: prefer `play.key` (confirmed Camelot notation at the source for both
///   formats) and fall back to `joined.key` (not guaranteed Camelot notation when it
///   came from an embedded-tag fallback) only when `play.key` is `None`. Whichever raw
///   string wins is validated by [`camelot::parse`]; an unparseable key becomes
///   `camelot: None`, never a fabricated position.
///
/// `bpm` is `joined.bpm` directly (`Play` has no `bpm` field by design — BPM is
/// scoped to the library join for both formats). `title`/`artist`/`path`/`start_time`
/// come from `play`'s own fields; no other source carries them.
pub fn enrich(play: &Play, joined: &JoinedMetadata) -> EnrichedPlay {
    let genre_raw = joined.genre.as_deref().or(play.genre.as_deref());
    let genre = genre::normalize(genre_raw);

    let key_raw = play.key.as_deref().or(joined.key.as_deref());
    let camelot = key_raw.and_then(camelot::parse);

    EnrichedPlay {
        title: play.title.clone(),
        artist: play.artist.clone(),
        path: play.path.clone(),
        start_time: play.start_time,
        bpm: joined.bpm,
        genre,
        camelot,
    }
}

/// Assembles a whole session's plays into [`EnrichedPlay`]s (Task 1).
///
/// Takes already-paired `(Play, JoinedMetadata)` values rather than forcing one
/// calling convention onto both join paths — `joiner::serato4::join_session` returns
/// rows keyed by id, `joiner::legacy::join` takes one `Play` at a time, and each
/// caller already knows how to zip its own play/metadata pair. This function's only
/// job is the 1:1 [`enrich`] map, preserving order.
///
/// **Preserves the order of `pairs`.** Every stat downstream (energy arc, Camelot
/// transitions) depends on chronological order, and `parser`/`joiner` already
/// guarantee start-time ordering — this function does not re-sort, so it can never
/// silently change a tiebreak an upstream stage already decided.
pub fn enrich_session(pairs: &[(Play, JoinedMetadata)]) -> Vec<EnrichedPlay> {
    pairs
        .iter()
        .map(|(play, joined)| enrich(play, joined))
        .collect()
}

/// A track's identity for ranking purposes (Task 2): `path` when available, else a
/// `(title, artist)` tuple.
///
/// **Known, accepted collision risk**: every Serato 4+ play has `path: None`
/// (`parser::serato4::read_session` never populates it), so every Serato-4+-sourced
/// play falls back to `(title, artist)` identity — two different untagged remixes
/// sharing a title+artist would count as one track. This is deliberately not fixed
/// here (would require the library-join expansion Story 1.4 already deferred); logged
/// to `deferred-work.md` per this project's standing discipline for known-but-unfixed
/// gaps.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum TrackIdentity {
    Path(String),
    TitleArtist(Option<String>, Option<String>),
}

impl TrackIdentity {
    fn for_play(play: &EnrichedPlay) -> Self {
        match &play.path {
            Some(path) => TrackIdentity::Path(path.clone()),
            None => TrackIdentity::TitleArtist(play.title.clone(), play.artist.clone()),
        }
    }
}

/// Ranks tracks by play count, descending (Task 2, AC-1).
///
/// Ties break on first-seen order in `plays` — deterministic, not dependent on
/// `HashMap` iteration order. A play with neither a path nor a title/artist still
/// counts as its own (likely singleton) identity bucket rather than being excluded.
pub fn most_played_tracks(plays: &[EnrichedPlay]) -> Vec<(TrackIdentity, usize)> {
    rank_by_first_seen(plays.iter().map(TrackIdentity::for_play))
}

/// Ranks artists by play count, descending, over artist-tagged plays only (Task 2,
/// AC-1, CAP-5 binding).
///
/// Filters to `artist.is_some()` **before** ranking — there is no "Unknown" bucket and
/// no "N untagged" footnote in this stat's output (ARCHITECTURE-SPINE.md Open
/// Question #4, resolved 2026-07-20 by Arjun). The excluded untagged plays still count
/// in every *other* stat (`track_count`, `genre_breakdown`, `bpm_distribution`) — this
/// carve-out is scoped to the artist ranking alone.
pub fn most_played_artists(plays: &[EnrichedPlay]) -> Vec<(String, usize)> {
    rank_by_first_seen(plays.iter().filter_map(|p| p.artist.clone()))
}

/// Shared ranking helper: counts occurrences of `items` (in iteration order) and
/// returns them ranked by count descending, with ties broken by first-seen order.
fn rank_by_first_seen<T: std::hash::Hash + Eq + Clone>(
    items: impl Iterator<Item = T>,
) -> Vec<(T, usize)> {
    let mut first_seen_order: Vec<T> = Vec::new();
    let mut counts: HashMap<T, usize> = HashMap::new();
    for item in items {
        if !counts.contains_key(&item) {
            first_seen_order.push(item.clone());
        }
        *counts.entry(item).or_insert(0) += 1;
    }

    let mut ranked: Vec<(T, usize)> = first_seen_order
        .into_iter()
        .map(|item| {
            let count = counts[&item];
            (item, count)
        })
        .collect();
    // `sort_by_key` is stable, so equal-count entries keep their first-seen relative
    // order rather than falling back to `HashMap` iteration order.
    ranked.sort_by_key(|(_, count)| std::cmp::Reverse(*count));
    ranked
}

/// Per-normalized-bucket genre tallies, plus an explicit no-genre count (Task 2, AC-1).
///
/// Unlike [`most_played_artists`]'s CAP-5 carve-out, nothing in FR-6/AD-11 exempts
/// genre breakdown from the "never omitted" rule — `no_genre_count` is always visible
/// here, even though a later UI story may choose to fold it into a display-layer
/// "Unknown" slice.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct GenreBreakdown {
    pub buckets: Vec<(String, usize)>,
    pub no_genre_count: usize,
}

/// Tallies play count per normalized genre bucket (Task 2, AC-1).
///
/// Buckets are ordered by first-seen order in `plays` (deterministic, see
/// [`rank_by_first_seen`]'s doc comment) rather than sorted by count — genre chips are
/// not inherently a "top N" ranking the way tracks/artists are, so no ordering claim
/// beyond determinism is made here.
pub fn genre_breakdown(plays: &[EnrichedPlay]) -> GenreBreakdown {
    let mut order: Vec<String> = Vec::new();
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut no_genre_count = 0usize;

    for play in plays {
        match &play.genre {
            Some(g) => {
                if !counts.contains_key(&g.normalized) {
                    order.push(g.normalized.clone());
                }
                *counts.entry(g.normalized.clone()).or_insert(0) += 1;
            }
            None => no_genre_count += 1,
        }
    }

    let buckets = order
        .into_iter()
        .map(|bucket| {
            let count = counts[&bucket];
            (bucket, count)
        })
        .collect();

    GenreBreakdown {
        buckets,
        no_genre_count,
    }
}

/// BPM summary statistics over plays with a known BPM (Task 2, AC-1).
///
/// An empty distribution (zero plays with a BPM) is `count: 0` with all other fields
/// `0.0` — a defined value, never a divide-by-zero panic or a `NaN`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BpmDistribution {
    pub count: usize,
    pub min: f64,
    pub max: f64,
    pub mean: f64,
    pub median: f64,
}

/// Computes [`BpmDistribution`] over `plays` (Task 2, AC-1).
///
/// Sorts the BPM values once (ascending); min/max/median all fall out of that one
/// sorted copy rather than three separate passes. `joined.bpm` is already
/// `sane_bpm`-filtered (finite, positive) by the joiner, so every value here is a real
/// measurement, never `NaN`/infinite/non-positive.
pub fn bpm_distribution(plays: &[EnrichedPlay]) -> BpmDistribution {
    let mut values: Vec<f64> = plays.iter().filter_map(|p| p.bpm).collect();
    if values.is_empty() {
        return BpmDistribution::default();
    }

    values.sort_by(|a, b| {
        a.partial_cmp(b)
            .expect("bpm values are finite per the joiner's sane_bpm filter")
    });

    let count = values.len();
    let min = values[0];
    let max = values[count - 1];
    let mean = values.iter().sum::<f64>() / count as f64;
    let median = if count % 2 == 1 {
        values[count / 2]
    } else {
        (values[count / 2 - 1] + values[count / 2]) / 2.0
    };

    BpmDistribution {
        count,
        min,
        max,
        mean,
        median,
    }
}

/// The set's length in seconds: first-play-start to last-play-start (Task 2, AC-1).
///
/// `None` if either endpoint's `start_time` is absent. Uses `saturating_sub` so an
/// out-of-order timestamp (however unlikely given the ordering guarantee) can never
/// panic. Deliberately does not add the last track's `duration_sec` (unreliable for
/// Serato 4+, which never populates it) — first-to-last-start-time delta is the one
/// definition that works identically for both formats.
pub fn set_length_sec(plays: &[EnrichedPlay]) -> Option<u32> {
    let first = plays.first()?.start_time?;
    let last = plays.last()?.start_time?;
    Some(last.saturating_sub(first))
}

/// Total plays in the set — not unique tracks (Task 2, AC-1). `most_played_tracks`
/// carries that distinction in its own per-identity counts.
pub fn track_count(plays: &[EnrichedPlay]) -> usize {
    plays.len()
}

/// One point on the energy-arc series: a play's start time and BPM (Task 4, AC-2).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EnergyArcPoint {
    pub start_time: u32,
    pub bpm: f64,
}

/// Produces the BPM-vs-timestamp series for the energy arc (Task 4, AC-2, FR-7
/// foundation).
///
/// Includes only plays with **both** `start_time` and `bpm` present; skips (never
/// fabricates or interpolates) a play missing either. Output stays in the
/// chronological order `plays` already carries. This is deliberately the only thing
/// this story does for FR-7 — the `energy-arc-chart` rendering itself is a `web/`
/// concern for a later Epic-3 story; this function's contract is exactly the ordered
/// `(time, bpm)` series that later story's UI will need to plot.
pub fn energy_arc(plays: &[EnrichedPlay]) -> Vec<EnergyArcPoint> {
    plays
        .iter()
        .filter_map(|p| {
            let start_time = p.start_time?;
            let bpm = p.bpm?;
            Some(EnergyArcPoint { start_time, bpm })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genre::normalize;
    use std::time::Instant;

    fn play(
        path: Option<&str>,
        title: Option<&str>,
        artist: Option<&str>,
        key: Option<&str>,
        genre: Option<&str>,
    ) -> Play {
        Play {
            path: path.map(String::from),
            title: title.map(String::from),
            artist: artist.map(String::from),
            key: key.map(String::from),
            genre: genre.map(String::from),
            ..Play::default()
        }
    }

    fn joined(bpm: Option<f64>, key: Option<&str>, genre: Option<&str>) -> JoinedMetadata {
        JoinedMetadata {
            in_library: true,
            bpm,
            key: key.map(String::from),
            genre: genre.map(String::from),
        }
    }

    fn enriched(
        title: Option<&str>,
        artist: Option<&str>,
        path: Option<&str>,
        start_time: Option<u32>,
        bpm: Option<f64>,
        genre: Option<&str>,
        camelot: Option<CamelotKey>,
    ) -> EnrichedPlay {
        EnrichedPlay {
            title: title.map(String::from),
            artist: artist.map(String::from),
            path: path.map(String::from),
            start_time,
            bpm,
            genre: normalize(genre),
            camelot,
        }
    }

    /// (Task 1) `JoinedMetadata.genre` wins over `Play.genre` when both are present.
    #[test]
    fn enrich_prefers_joined_genre_over_play_genre() {
        let p = play(None, None, None, None, Some("Techno"));
        let j = joined(None, None, Some("House"));
        assert_eq!(enrich(&p, &j).genre, normalize(Some("House")));
    }

    /// (Task 1) `Play.genre` is used when `JoinedMetadata.genre` is `None`.
    #[test]
    fn enrich_falls_back_to_play_genre_when_joined_genre_absent() {
        let p = play(None, None, None, None, Some("Techno"));
        let j = joined(None, None, None);
        assert_eq!(enrich(&p, &j).genre, normalize(Some("Techno")));
    }

    /// (Task 1) Both sources absent -> `EnrichedPlay.genre` is `None`, never defaulted.
    #[test]
    fn enrich_genre_is_none_when_both_sources_absent() {
        let p = play(None, None, None, None, None);
        let j = joined(None, None, None);
        assert_eq!(enrich(&p, &j).genre, None);
    }

    /// (Task 1) `Play.key` wins over `JoinedMetadata.key` when both are present.
    #[test]
    fn enrich_prefers_play_key_over_joined_key() {
        let p = play(None, None, None, Some("8A"), None);
        let j = joined(None, Some("7A"), None);
        assert_eq!(
            enrich(&p, &j).camelot,
            Some(CamelotKey {
                number: 8,
                letter: camelot::Letter::A
            })
        );
    }

    /// (Task 1) `JoinedMetadata.key` is used when `Play.key` is `None`.
    #[test]
    fn enrich_falls_back_to_joined_key_when_play_key_absent() {
        let p = play(None, None, None, None, None);
        let j = joined(None, Some("7A"), None);
        assert_eq!(
            enrich(&p, &j).camelot,
            Some(CamelotKey {
                number: 7,
                letter: camelot::Letter::A
            })
        );
    }

    /// (Task 1) Both sources absent -> `camelot: None`, never fabricated.
    #[test]
    fn enrich_camelot_is_none_when_both_key_sources_absent() {
        let p = play(None, None, None, None, None);
        let j = joined(None, None, None);
        assert_eq!(enrich(&p, &j).camelot, None);
    }

    /// (Task 1) An unparseable `JoinedMetadata.key` (embedded-tag fallback with no
    /// notation guarantee) falls through to `camelot: None`, not a panic.
    #[test]
    fn enrich_unparseable_joined_key_becomes_none_not_a_panic() {
        let p = play(None, None, None, None, None);
        let j = joined(None, Some("Cmaj"), None);
        assert_eq!(enrich(&p, &j).camelot, None);
    }

    /// (Task 1) A play with a path and a play without one both produce a usable
    /// `TrackIdentity` — the no-path case is the *normal* Serato-4+ case, not an edge
    /// case, and must never panic.
    #[test]
    fn track_identity_handles_both_path_and_pathless_plays() {
        let with_path = enriched(None, None, Some("/music/a.mp3"), None, None, None, None);
        let without_path = enriched(Some("Title"), Some("Artist"), None, None, None, None, None);

        assert_eq!(
            TrackIdentity::for_play(&with_path),
            TrackIdentity::Path("/music/a.mp3".to_string())
        );
        assert_eq!(
            TrackIdentity::for_play(&without_path),
            TrackIdentity::TitleArtist(Some("Title".to_string()), Some("Artist".to_string()))
        );
    }

    /// (Task 2) `most_played_tracks` ranks by count descending with a deterministic
    /// first-seen tiebreak for equal counts.
    #[test]
    fn most_played_tracks_ranks_by_count_with_first_seen_tiebreak() {
        let plays = vec![
            enriched(None, None, Some("/a.mp3"), None, None, None, None),
            enriched(None, None, Some("/b.mp3"), None, None, None, None),
            enriched(None, None, Some("/a.mp3"), None, None, None, None),
            enriched(None, None, Some("/c.mp3"), None, None, None, None),
        ];

        let ranked = most_played_tracks(&plays);
        assert_eq!(
            ranked,
            vec![
                (TrackIdentity::Path("/a.mp3".to_string()), 2),
                (TrackIdentity::Path("/b.mp3".to_string()), 1),
                (TrackIdentity::Path("/c.mp3".to_string()), 1),
            ]
        );
    }

    /// (AC-1, CAP-5) `most_played_artists` excludes a no-artist play entirely — no
    /// "Unknown" entry with a count, just absence.
    #[test]
    fn most_played_artists_excludes_untagged_plays_entirely() {
        let plays = vec![
            enriched(None, Some("DJ A"), None, None, None, None, None),
            enriched(None, None, None, None, None, None, None),
        ];

        let ranked = most_played_artists(&plays);
        assert_eq!(ranked, vec![("DJ A".to_string(), 1)]);
    }

    /// (AC-1) `genre_breakdown`'s no-genre count is non-zero and reported separately
    /// from real buckets — contrast with CAP-5's exclusion above.
    #[test]
    fn genre_breakdown_reports_no_genre_count_separately() {
        let plays = vec![
            enriched(None, None, None, None, None, Some("Deep House"), None),
            enriched(None, None, None, None, None, None, None),
            enriched(None, None, None, None, None, None, None),
        ];

        let breakdown = genre_breakdown(&plays);
        assert_eq!(breakdown.no_genre_count, 2);
        // "Deep House" normalizes to the "House" bucket per the fixed taxonomy
        // (genre.rs's TAXONOMY) — asserting the normalized bucket, not the raw input.
        assert_eq!(breakdown.buckets, vec![("House".to_string(), 1)]);
    }

    /// (AC-1) `bpm_distribution` on an empty-BPM set doesn't panic: count 0, no NaN.
    #[test]
    fn bpm_distribution_empty_is_zero_not_nan() {
        let plays = vec![enriched(None, None, None, None, None, None, None)];
        let dist = bpm_distribution(&plays);
        assert_eq!(dist.count, 0);
        assert_eq!(dist.min, 0.0);
        assert_eq!(dist.max, 0.0);
        assert_eq!(dist.mean, 0.0);
        assert_eq!(dist.median, 0.0);
    }

    /// (AC-1) `bpm_distribution` computes correct min/max/mean/median over a real set.
    #[test]
    fn bpm_distribution_computes_summary_stats() {
        let plays = vec![
            enriched(None, None, None, None, Some(120.0), None, None),
            enriched(None, None, None, None, Some(128.0), None, None),
            enriched(None, None, None, None, Some(124.0), None, None),
        ];
        let dist = bpm_distribution(&plays);
        assert_eq!(dist.count, 3);
        assert_eq!(dist.min, 120.0);
        assert_eq!(dist.max, 128.0);
        assert_eq!(dist.mean, 124.0);
        assert_eq!(dist.median, 124.0);
    }

    /// (AC-1) `set_length_sec` returns `None` when either endpoint's `start_time` is
    /// missing, and the correct delta otherwise.
    #[test]
    fn set_length_sec_none_when_endpoint_missing_else_delta() {
        let missing_end = vec![
            enriched(None, None, None, Some(1_000), None, None, None),
            enriched(None, None, None, None, None, None, None),
        ];
        assert_eq!(set_length_sec(&missing_end), None);

        let both_present = vec![
            enriched(None, None, None, Some(1_000), None, None, None),
            enriched(None, None, None, Some(1_500), None, None, None),
            enriched(None, None, None, Some(2_300), None, None, None),
        ];
        assert_eq!(set_length_sec(&both_present), Some(1_300));
    }

    /// (AC-1) `track_count` counts total plays, not unique tracks.
    #[test]
    fn track_count_counts_total_plays() {
        let plays = vec![
            enriched(None, None, Some("/a.mp3"), None, None, None, None),
            enriched(None, None, Some("/a.mp3"), None, None, None, None),
        ];
        assert_eq!(track_count(&plays), 2);
    }

    /// (AC-2) `energy_arc` skips a play missing `bpm` and a play missing
    /// `start_time`, keeping only fully-populated points, in order.
    #[test]
    fn energy_arc_skips_incomplete_points_keeps_order() {
        let plays = vec![
            enriched(None, None, None, Some(1_000), Some(120.0), None, None),
            enriched(None, None, None, Some(1_100), None, None, None), // missing bpm
            enriched(None, None, None, None, Some(126.0), None, None), // missing start_time
            enriched(None, None, None, Some(1_200), Some(128.0), None, None),
        ];

        assert_eq!(
            energy_arc(&plays),
            vec![
                EnergyArcPoint {
                    start_time: 1_000,
                    bpm: 120.0
                },
                EnergyArcPoint {
                    start_time: 1_200,
                    bpm: 128.0
                },
            ]
        );
    }

    /// (AC-3) No function in this module's dependency graph pulls in a scoring/ML
    /// crate — enforced by `Cargo.toml` having no such dependency (Task 5's audit),
    /// not a runtime assertion; this test exists for discoverability of that claim.
    #[test]
    fn arithmetic_only_is_a_cargo_toml_property_not_a_runtime_one() {
        // See agent/src-tauri/Cargo.toml: no ML/DSP/scoring crate is a dependency of
        // this crate. Nothing to assert at runtime — documented here so a reader
        // searching this module's tests for the AC-3 guarantee finds this pointer.
    }

    /// (determinism) Running the full per-set computation twice over the same
    /// `Vec<EnrichedPlay>` yields identical output, mirroring
    /// `genre::normalize_is_deterministic` / `parser::parse_is_deterministic`.
    #[test]
    fn full_per_set_computation_is_deterministic() {
        let plays = synthetic_plays(200);

        let run = |plays: &[EnrichedPlay]| {
            (
                most_played_tracks(plays),
                most_played_artists(plays),
                genre_breakdown(plays),
                bpm_distribution(plays),
                set_length_sec(plays),
                track_count(plays),
                camelot::mixing_stats(plays),
                energy_arc(plays),
            )
        };

        assert_eq!(run(&plays), run(&plays));
    }

    /// Builds `n` synthetic, varied `EnrichedPlay`s for the determinism and
    /// performance tests — deterministic given `n` (no randomness), varying enough
    /// (path/pathless, genre/no-genre, key/no-key, bpm/no-bpm) to exercise every
    /// stat's real code path rather than a degenerate all-`None` fixture.
    fn synthetic_plays(n: usize) -> Vec<EnrichedPlay> {
        let genres = ["Deep House", "Techno", "Drum & Bass", "Unrecognized Genre"];
        let camelot_keys = ["1A", "8A", "8B", "12B"];

        (0..n)
            .map(|i| {
                let has_path = i % 3 != 0;
                let path = has_path.then(|| format!("/music/track-{}.mp3", i % 50));
                let title = (!has_path).then(|| format!("Track {}", i % 50));
                let artist = (i % 5 != 0).then(|| format!("Artist {}", i % 20));
                let start_time = Some(1_700_000_000u32 + (i as u32) * 180);
                let bpm = (i % 7 != 0).then_some(120.0 + (i % 20) as f64);
                let genre = (i % 6 != 0).then(|| genres[i % genres.len()]);
                let camelot = (i % 4 != 0)
                    .then(|| camelot::parse(camelot_keys[i % camelot_keys.len()]))
                    .flatten();

                enriched(
                    title.as_deref(),
                    artist.as_deref(),
                    path.as_deref(),
                    start_time,
                    bpm,
                    genre,
                    camelot,
                )
            })
            .collect()
    }

    /// (AC-4, Task 5) Single-set performance regression guard: the full per-set stat
    /// computation over a generously-large synthetic set completes well under a
    /// conservative bound.
    ///
    /// The exact `[ASSUMPTION]`-status product target (PRD §5.1/§12) is 500ms; this
    /// test asserts a deliberately tighter 100ms sanity floor as a regression guard
    /// against an accidental O(n^2) bug, not as confirmation that 500ms is the
    /// correct product number — that confirmation is Open Question #6, tracked in the
    /// story file and `deferred-work.md`, not this test's job.
    #[test]
    fn per_set_stat_computation_stays_within_regression_guard_bound() {
        let plays = synthetic_plays(1_000);

        let start = Instant::now();
        let _ = most_played_tracks(&plays);
        let _ = most_played_artists(&plays);
        let _ = genre_breakdown(&plays);
        let _ = bpm_distribution(&plays);
        let _ = set_length_sec(&plays);
        let _ = track_count(&plays);
        let _ = camelot::mixing_stats(&plays);
        let _ = energy_arc(&plays);
        let elapsed = start.elapsed();

        assert!(
            elapsed.as_millis() < 100,
            "per-set stat computation took {elapsed:?} for 1000 synthetic plays, \
             expected well under the 100ms regression-guard bound"
        );
    }
}
