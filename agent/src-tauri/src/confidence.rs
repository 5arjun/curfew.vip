//! Live/practice confidence signal (Story 1.8, FR-27).
//!
//! This is **not** a sequential stage in the pipeline documented in
//! [`crate`](../lib.rs) (`watcher -> parser -> joiner -> stat-engine -> local store
//! -> sync-queue`). It is a sibling consumer of the same [`crate::stats::EnrichedPlay`]
//! output the stat-engine (Story 1.7) produces: [`classify`] looks at a whole
//! session's plays and classifies *the session those plays came from*, in parallel
//! with — not instead of — Story 1.7's per-set stats. Nothing downstream wires this
//! module's output anywhere yet (no local store, no sync-queue, no UI); it produces a
//! typed in-memory value and stops there, exactly like `stats::enrich_session` shipped
//! with no live caller.
//!
//! **What this is not.** [`classify`] is a session-level classification, not a
//! per-set stat (Story 1.7's territory) and not [Epic 5/AD-17's segment-detection]
//! algorithm (a different granularity — *where inside a set* the dancefloor segment
//! is, calibrated from a DJ's own historical plays, which don't exist in a local
//! store yet). This story has no history to calibrate from, so it uses only what
//! [`crate::stats::EnrichedPlay`] already carries: play count and start-time gaps —
//! nothing from AD-17's windowed-density/BPM-floor/transition-smoothness machinery is
//! imported or depended on here.
//!
//! **Heuristic, not ground truth (AC-4).** PRD FR-27's own research note: reliably
//! distinguishing a realistic home rehearsal from a real live gig by data alone is an
//! unsolved problem — no comparable tool has solved it, and Serato's own "Played"
//! flag fires identically in Practice Mode. [`SessionConfidence::confidence`] is a
//! heuristic proxy for *how classifiable* a session's play pattern is (dense and
//! continuous vs. naturally punctuated or too sparse to matter), never a live/practice
//! probability. Nothing in this module is named `is_live`/`is_practice`.
//!
//! Design invariants (mirroring [`crate::genre::normalize`] /
//! [`crate::stats::bpm_distribution`]):
//! - **Total and infallible.** Every input, including an empty slice, has a defined
//!   output — no `Result`, no panic path, no `.unwrap()`/`.expect()` outside tests.
//! - **Deterministic.** No randomness, no hash-iteration-order dependence — a plain
//!   ordered scan over `plays`.
//! - **Arithmetic-only** (NFR-1, NFR-3). No ML, no audio DSP — gap sizes and a play
//!   count compared against fixed constants.
//! - **Does not re-sort.** [`crate::stats::enrich_session`] already guarantees
//!   chronological order; this module trusts that guarantee rather than re-deriving it.
//!
//! What this module deliberately does *not* do (AC-2, satisfied by omission — see the
//! story's Scope Boundaries): no confirmation prompt, no dialog, no gating branch (there
//! is no watcher, no local store, and no web surface yet for a prompt to attach to); no
//! persistence (no `shared/` sync-contract field, no SQLite write — this story's job
//! ends at producing a typed in-memory value from a `&[EnrichedPlay]`); no per-DJ
//! historical calibration (Story 2.8's local store doesn't exist yet).

use crate::stats::{self, EnrichedPlay};

/// Fewer real plays than this is confidently "not a set" (PRD FR-27's own worked
/// example: "a single track briefly cued"). `[ASSUMPTION]` — no prior doc locks this
/// number; first proposed by this story (Open Questions #1).
const MIN_PLAYS_FOR_AMBIGUITY: usize = 4;

/// A consecutive-play gap at or above this is a "long gap" — PRD FR-27's own framing:
/// "dense, continuous play with no long gaps" is the ambiguous case. `[ASSUMPTION]`
/// — first proposed by this story (Open Questions #1).
const LONG_GAP_THRESHOLD_SEC: u32 = 300; // 5 minutes

/// The confidence value for the dense/continuous ambiguous case. Not `0.0` — this is
/// a heuristic proxy, never a claim of certainty in either direction (AC-4).
/// `[ASSUMPTION]` — first proposed by this story (Open Questions #1).
const LOW_CONFIDENCE_VALUE: f64 = 0.2;

/// A session's live/practice classification confidence (FR-27, Task 1).
///
/// **Symmetric, not directional** (Open Questions #2): `confidence` measures *how
/// classifiable* the session is, not *which way* it was classified. A session that's
/// obviously "not a set" (too few plays) and a session that's obviously a real set
/// (long, naturally punctuated) both score `1.0` — a caller wanting to distinguish the
/// two cases can, via `track_count`/`long_gap_count`, without a second field.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SessionConfidence {
    /// [`LOW_CONFIDENCE_VALUE`] = most ambiguous (dense, continuous, no natural break
    /// — could be a real set or a realistic home rehearsal, per PRD FR-27), `1.0` =
    /// most confidently classifiable (either "obviously a real set" or "obviously not
    /// a set"). A heuristic proxy, never a ground-truth live/practice label (AC-4).
    pub confidence: f64,
    /// Total plays considered (transparency for callers/tests — mirrors why
    /// [`crate::stats::camelot::CamelotMixingStats`] exposes its three counts instead
    /// of a pre-divided rate).
    pub track_count: usize,
    /// How many gaps between consecutive *known-`start_time`* plays met or exceeded
    /// [`LONG_GAP_THRESHOLD_SEC`]. Plays with `start_time: None` are filtered out
    /// before pairing (see [`classify`]'s docs), so two plays far apart in the real
    /// play order but adjacent after filtering are counted as one gap.
    pub long_gap_count: usize,
}

/// Classifies a whole session's plays into a [`SessionConfidence`] (Task 1, AC-1,
/// AC-4).
///
/// Total and infallible: every input, including an empty slice, has a defined output.
/// Never re-sorts `plays` — [`crate::stats::enrich_session`] already guarantees
/// chronological order (see the module docs).
///
/// Tiering (mirrors PRD FR-27's own worked examples):
/// 1. Fewer than [`MIN_PLAYS_FOR_AMBIGUITY`] plays → `1.0` (obviously not a set —
///    confidently classifiable, high confidence).
/// 2. Fewer than 2 plays with a known `start_time` (gaps unknowable) → `1.0` — never
///    manufacture an "ambiguous" reading from data that can't support it.
/// 3. At least [`MIN_PLAYS_FOR_AMBIGUITY`] plays and zero gaps at/above
///    [`LONG_GAP_THRESHOLD_SEC`] → [`LOW_CONFIDENCE_VALUE`] (dense, continuous, no
///    natural break — the PRD's explicitly-named ambiguous case).
/// 4. Otherwise (at least one long gap present) → `1.0` (naturally punctuated —
///    confidently classifiable as a real set).
pub fn classify(plays: &[EnrichedPlay]) -> SessionConfidence {
    let track_count = stats::track_count(plays);

    // Preserves the existing chronological order (`enrich_session` guarantees it) —
    // plays with `start_time: None` are simply absent from the gap walk, not treated
    // as zero-length gaps (a documented approximation: a play's *position* in the
    // session is still known even when its exact timestamp isn't).
    let start_times: Vec<u32> = plays.iter().filter_map(|p| p.start_time).collect();

    let long_gap_count = count_long_gaps(&start_times);

    // The only low-confidence tier (3): enough plays, at least 2 known start times,
    // and zero long gaps among them. Every other case — too few plays (1), gaps
    // unknowable (2), or a long gap present (4) — is confidently classifiable.
    let confidence = if track_count >= MIN_PLAYS_FOR_AMBIGUITY
        && start_times.len() >= 2
        && long_gap_count == 0
    {
        LOW_CONFIDENCE_VALUE
    } else {
        1.0
    };

    SessionConfidence {
        confidence,
        track_count,
        long_gap_count,
    }
}

/// Counts consecutive-pair gaps at/above [`LONG_GAP_THRESHOLD_SEC`] in an ordered list
/// of known start times. `saturating_sub` never panics on an out-of-order value
/// (mirrors [`crate::stats::set_length_sec`]'s same discipline); fewer than 2 known
/// start times has no pairs to walk and returns `0`.
fn count_long_gaps(start_times: &[u32]) -> usize {
    start_times
        .windows(2)
        .filter(|w| w[1].saturating_sub(w[0]) >= LONG_GAP_THRESHOLD_SEC)
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::genre::normalize;

    /// Minimal local `EnrichedPlay` constructor for this module's tests — only
    /// `start_time` varies across cases, so every other field is a fixed placeholder.
    fn enriched(start_time: Option<u32>) -> EnrichedPlay {
        EnrichedPlay {
            title: Some("Track".to_string()),
            artist: Some("Artist".to_string()),
            path: None,
            start_time,
            bpm: None,
            genre: normalize(None),
            camelot: None,
        }
    }

    /// (AC-1) Fewer than `MIN_PLAYS_FOR_AMBIGUITY` plays → confidently "not a set."
    #[test]
    fn too_few_plays_is_high_confidence() {
        let plays = vec![enriched(Some(0)), enriched(Some(60))];
        let out = classify(&plays);

        assert_eq!(out.confidence, 1.0);
        assert_eq!(out.track_count, 2);
    }

    /// (AC-1) Exactly `MIN_PLAYS_FOR_AMBIGUITY - 1` plays, closely spaced — still
    /// below the ambiguity floor, so this must stay high-confidence even though the
    /// gaps alone would otherwise qualify for the low-confidence tier at one more play.
    #[test]
    fn one_below_min_plays_threshold_is_high_confidence() {
        let plays = vec![enriched(Some(0)), enriched(Some(180)), enriched(Some(360))];
        let out = classify(&plays);

        assert_eq!(out.confidence, 1.0);
        assert_eq!(out.track_count, MIN_PLAYS_FOR_AMBIGUITY - 1);
    }

    /// (AC-1, AC-4) Enough plays, all closely spaced (no long gap) → the dense,
    /// continuous, ambiguous case — the heuristic's one low-confidence tier.
    #[test]
    fn dense_continuous_session_is_low_confidence() {
        let plays = vec![
            enriched(Some(0)),
            enriched(Some(180)),
            enriched(Some(360)),
            enriched(Some(540)),
        ];
        let out = classify(&plays);

        assert_eq!(out.confidence, LOW_CONFIDENCE_VALUE);
        assert_eq!(out.long_gap_count, 0);
        assert_eq!(out.track_count, 4);
    }

    /// (AC-1) Same play count as the dense case, but one gap at/above the long-gap
    /// threshold → naturally punctuated, confidently classifiable.
    #[test]
    fn one_long_gap_is_high_confidence() {
        let plays = vec![
            enriched(Some(0)),
            enriched(Some(180)),
            enriched(Some(180 + LONG_GAP_THRESHOLD_SEC)),
            enriched(Some(180 + LONG_GAP_THRESHOLD_SEC + 120)),
        ];
        let out = classify(&plays);

        assert_eq!(out.confidence, 1.0);
        assert!(out.long_gap_count >= 1);
    }

    /// (Task 2) Fewer than 2 plays with a known `start_time`, including all-`None` —
    /// gaps are unknowable, so this degrades to the safe high-confidence default
    /// rather than dividing by zero or indexing out of bounds.
    #[test]
    fn fewer_than_two_known_start_times_is_high_confidence_no_panic() {
        let all_none = vec![
            enriched(None),
            enriched(None),
            enriched(None),
            enriched(None),
        ];
        let out = classify(&all_none);
        assert_eq!(out.confidence, 1.0);
        assert_eq!(out.long_gap_count, 0);

        let one_known = vec![
            enriched(Some(0)),
            enriched(None),
            enriched(None),
            enriched(None),
        ];
        let out = classify(&one_known);
        assert_eq!(out.confidence, 1.0);
        assert_eq!(out.long_gap_count, 0);
    }

    /// (Task 1) An empty `plays` slice has a defined output, never a panic.
    #[test]
    fn empty_slice_is_defined_no_panic() {
        let out = classify(&[]);
        assert_eq!(out.confidence, 1.0);
        assert_eq!(out.track_count, 0);
        assert_eq!(out.long_gap_count, 0);
    }

    /// (determinism) Running `classify` twice over the same input yields identical
    /// output — mirrors `genre::normalize_is_deterministic`/`stats`'s own determinism
    /// tests.
    #[test]
    fn classify_is_deterministic() {
        let plays = vec![
            enriched(Some(0)),
            enriched(Some(180)),
            enriched(Some(360)),
            enriched(Some(540)),
        ];
        assert_eq!(classify(&plays), classify(&plays));

        let empty: Vec<EnrichedPlay> = vec![];
        assert_eq!(classify(&empty), classify(&empty));
    }
}
