//! Camelot-wheel key parsing and harmonic-mixing compatibility (Story 1.7, Task 3, AC-1).
//!
//! An independently-testable sub-concern of [`super`] (the `stats` module), mirroring
//! why [`crate::joiner`] splits into `legacy`/`serato4`/`embedded_tags`: parsing a raw
//! key string into a validated [`CamelotKey`] and judging harmonic compatibility
//! between two keys are both pure, total functions with nothing else in common with
//! the rest of the stat engine.
//!
//! **Total and infallible**, same idiom as [`crate::genre::normalize`]: [`parse`]
//! returns `None` for anything that is not a well-formed Camelot string rather than an
//! error, because there is no UI-actionable failure mode — just "not a Camelot key."
//! [`compatible`] is pure mod-12 arithmetic plus an equality check, deliberately not a
//! lookup table (AC-3: arithmetic-only, no heuristic scoring).

/// The two Camelot "wheel" halves: `A` (minor) and `B` (major).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Letter {
    A,
    B,
}

/// A validated Camelot-notation key, e.g. `8A` or `12B`.
///
/// `number` is always in `1..=12` — [`parse`] is the only constructor, and it rejects
/// anything outside that range, so a `CamelotKey` value can never be "invalid" once
/// constructed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CamelotKey {
    pub number: u8,
    pub letter: Letter,
}

/// Parses a raw key string into a [`CamelotKey`], or `None` if it is not a
/// well-formed Camelot key.
///
/// Valid format: `1`-`12` followed by `A` or `B`, case-insensitive, optionally
/// surrounded by whitespace. Validated structurally (a trailing letter char plus a
/// numeric prefix in range) rather than by string-matching a table, since Camelot
/// letters are conventionally upper and numbers are numeric — unlike
/// [`crate::genre::normalize`]'s alias-table lookup, there is no fixed vocabulary to
/// fold against. Iterates by `char`, not by byte, so a non-ASCII trailing character
/// (which would not be a valid Camelot letter anyway) can never panic on a byte
/// boundary.
pub fn parse(raw: &str) -> Option<CamelotKey> {
    let trimmed = raw.trim();
    let mut chars = trimmed.chars();
    let letter_char = chars.next_back()?;
    let letter = match letter_char {
        'A' | 'a' => Letter::A,
        'B' | 'b' => Letter::B,
        _ => return None,
    };

    let number: u8 = chars.as_str().parse().ok()?;
    (1..=12)
        .contains(&number)
        .then_some(CamelotKey { number, letter })
}

/// Standard harmonic-mixing adjacency between two Camelot keys.
///
/// Three compatible shapes, all arithmetic/equality — no lookup table:
/// - **identical key** (`a == b`);
/// - **relative major/minor** — same number, opposite letter (e.g. `8A` <-> `8B`);
/// - **energy-boost/drop** — same letter, number +/-1 with wraparound (`12` and `1`
///   are adjacent), e.g. `8A` <-> `7A`/`9A`.
///
/// Anything else is not compatible.
pub fn compatible(a: CamelotKey, b: CamelotKey) -> bool {
    if a == b {
        return true;
    }
    if a.number == b.number && a.letter != b.letter {
        return true;
    }
    if a.letter == b.letter {
        let diff = (a.number as i16 - b.number as i16).rem_euclid(12);
        return diff == 1 || diff == 11;
    }
    false
}

/// Consecutive-pair harmonic-mixing counts over a chronologically-ordered set (AC-1).
///
/// `compatible_transitions` / `incompatible_transitions` count consecutive-pair
/// transitions where **both** plays have a parsed [`CamelotKey`]; `excluded_no_key`
/// counts transitions where either side's key is `None` or unparseable — never
/// guessed, never silently dropped from the total. A compatibility *rate* is a
/// one-line division the caller can do from these three counts; this type
/// deliberately does not bake in a lossy pre-divided percentage.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CamelotMixingStats {
    pub compatible_transitions: usize,
    pub incompatible_transitions: usize,
    pub excluded_no_key: usize,
}

/// Computes [`CamelotMixingStats`] by walking consecutive pairs of `plays` in the
/// order given. `plays` is expected to already be in chronological order (Task 1's
/// [`super::enrich_session`] guarantees this) — this function does not re-sort.
pub fn mixing_stats(plays: &[super::EnrichedPlay]) -> CamelotMixingStats {
    let mut stats = CamelotMixingStats::default();
    for pair in plays.windows(2) {
        match (pair[0].camelot, pair[1].camelot) {
            (Some(a), Some(b)) => {
                if compatible(a, b) {
                    stats.compatible_transitions += 1;
                } else {
                    stats.incompatible_transitions += 1;
                }
            }
            _ => stats.excluded_no_key += 1,
        }
    }
    stats
}

#[cfg(test)]
mod tests {
    use super::*;

    /// (Task 3, AC-1) Accepts well-formed Camelot keys, including whitespace/case
    /// variance, and rejects everything else.
    #[test]
    fn parse_accepts_valid_camelot_keys_rejects_the_rest() {
        assert_eq!(
            parse("8A"),
            Some(CamelotKey {
                number: 8,
                letter: Letter::A
            })
        );
        assert_eq!(
            parse("12B"),
            Some(CamelotKey {
                number: 12,
                letter: Letter::B
            })
        );
        assert_eq!(
            parse("  8a  "),
            Some(CamelotKey {
                number: 8,
                letter: Letter::A
            })
        );

        assert_eq!(parse("Cmaj"), None, "not Camelot notation at all");
        assert_eq!(parse("13A"), None, "number out of 1..=12 range");
        assert_eq!(parse("0B"), None, "number out of 1..=12 range");
        assert_eq!(parse(""), None, "empty string");
    }

    /// (Task 3, AC-1) The three compatible shapes hold true; a non-adjacent,
    /// non-relative pair is false.
    #[test]
    fn compatible_covers_the_three_harmonic_shapes() {
        let eight_a = CamelotKey {
            number: 8,
            letter: Letter::A,
        };
        let eight_b = CamelotKey {
            number: 8,
            letter: Letter::B,
        };
        let seven_a = CamelotKey {
            number: 7,
            letter: Letter::A,
        };
        let twelve_a = CamelotKey {
            number: 12,
            letter: Letter::A,
        };
        let one_a = CamelotKey {
            number: 1,
            letter: Letter::A,
        };
        let three_a = CamelotKey {
            number: 3,
            letter: Letter::A,
        };

        assert!(compatible(eight_a, eight_a), "identical key");
        assert!(compatible(eight_a, eight_b), "relative major/minor");
        assert!(compatible(eight_a, seven_a), "adjacent, same letter");
        assert!(
            compatible(twelve_a, one_a),
            "adjacent with 12<->1 wraparound"
        );
        assert!(
            !compatible(eight_a, three_a),
            "same letter, not adjacent, not identical"
        );
    }

    /// (Task 3) `mixing_stats` buckets a compatible pair, an incompatible pair, and a
    /// pair with one missing key into their three separate counts, all visible in one
    /// fixture.
    #[test]
    fn mixing_stats_buckets_all_three_transition_kinds() {
        use crate::stats::EnrichedPlay;

        fn play_with_camelot(camelot: Option<CamelotKey>) -> EnrichedPlay {
            EnrichedPlay {
                title: None,
                artist: None,
                path: None,
                start_time: None,
                bpm: None,
                genre: None,
                camelot,
            }
        }

        let eight_a = CamelotKey {
            number: 8,
            letter: Letter::A,
        };
        let seven_a = CamelotKey {
            number: 7,
            letter: Letter::A,
        };
        let three_a = CamelotKey {
            number: 3,
            letter: Letter::A,
        };

        // Transitions: (8A -> 7A) compatible, (7A -> 3A) incompatible, (3A -> None)
        // excluded.
        let plays = vec![
            play_with_camelot(Some(eight_a)),
            play_with_camelot(Some(seven_a)),
            play_with_camelot(Some(three_a)),
            play_with_camelot(None),
        ];

        let stats = mixing_stats(&plays);
        assert_eq!(
            stats,
            CamelotMixingStats {
                compatible_transitions: 1,
                incompatible_transitions: 1,
                excluded_no_key: 1,
            }
        );
    }
}
