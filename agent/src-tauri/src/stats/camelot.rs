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
/// `number` is in `1..=12` for every value [`parse`] produces — it rejects anything
/// outside that range. Both fields are `pub` (a plain value type, no smart-constructor
/// boundary), so this is a convention `parse` upholds, not a type-level guarantee;
/// nothing stops other code in this crate from constructing an out-of-range value
/// directly.
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

/// Parses a *musical-notation* key string (`Am`, `F#`, `Ebm`, `C# minor`) into
/// its [`CamelotKey`], or `None` if it is not well-formed musical notation.
///
/// Why this exists: the legacy `database V2` key column and embedded `TKEY`
/// frames store predominantly musical notation — on real data ~70% of stored
/// keys (the same measurement that motivated Story 3.6's `key_value` fix on
/// the Serato 4+ path, where the free-text column had been silently dropping
/// ~88% of keys). [`parse`] correctly rejects those strings as not-Camelot,
/// so every consumer of the legacy/tag paths currently reads them as "no
/// key". This function is the deterministic conversion for whoever chooses
/// to bridge that gap — the demo-catalog extractor consumes it today;
/// **nothing in the product stat path calls it yet** (wiring it into the
/// joiner/stat engine changes displayed stats for legacy libraries, which is
/// a product decision for its own story, not a side effect to smuggle in).
///
/// Accepted shape, case-insensitive, whitespace-trimmed: note letter `A`–`G`,
/// optional accidental (`#`/`♯`/`b`/`♭`), optional mode (`m`/`min`/`minor` for
/// minor; empty/`maj`/`major` for major, with optional space before the word
/// forms). Total and infallible like [`parse`]: anything else — including
/// Camelot strings themselves — is `None`, never a guess (AD-11).
///
/// The mapping is pure pitch-class arithmetic (matching this module's
/// no-lookup-table idiom): on the Camelot wheel each fifth is +1 step, major
/// C sits at 8B and minor A at 8A, so `number = 8 + 7·Δpc (mod 12)` measured
/// from the respective anchor. Enharmonic spellings (`C#`/`Db`, and even the
/// theoretical `Cb`/`E#`) land on the same pitch class, hence the same key.
pub fn parse_musical(raw: &str) -> Option<CamelotKey> {
    let trimmed = raw.trim();
    let mut chars = trimmed.chars();
    let pitch: i16 = match chars.next()?.to_ascii_uppercase() {
        'C' => 0,
        'D' => 2,
        'E' => 4,
        'F' => 5,
        'G' => 7,
        'A' => 9,
        'B' => 11,
        _ => return None,
    };
    let rest = chars.as_str();
    let (accidental, rest) = if let Some(r) = rest.strip_prefix(['#', '♯']) {
        (1, r)
    } else if let Some(r) = rest.strip_prefix(['b', '♭']) {
        (-1, r)
    } else {
        (0, rest)
    };
    let minor = match rest.trim().to_lowercase().as_str() {
        "" | "maj" | "major" => false,
        "m" | "min" | "minor" => true,
        _ => return None,
    };

    let pc = (pitch + accidental).rem_euclid(12);
    // Anchors: C major = 8B (pc 0), A minor = 8A (pc 9); +7 semitones (a
    // fifth) is +1 Camelot step on either ring.
    let anchor_pc = if minor { 9 } else { 0 };
    let number = (8 + 7 * (pc - anchor_pc)).rem_euclid(12);
    Some(CamelotKey {
        number: if number == 0 { 12 } else { number as u8 },
        letter: if minor { Letter::A } else { Letter::B },
    })
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

    fn key(number: u8, letter: Letter) -> CamelotKey {
        CamelotKey { number, letter }
    }

    /// `parse_musical` maps all 24 keys to their Camelot wheel positions —
    /// the full standard table, so a wrong anchor or step direction in the
    /// arithmetic cannot hide behind a partial sample.
    #[test]
    fn parse_musical_maps_the_full_wheel() {
        let majors = [
            ("B", 1),
            ("F#", 2),
            ("Db", 3),
            ("Ab", 4),
            ("Eb", 5),
            ("Bb", 6),
            ("F", 7),
            ("C", 8),
            ("G", 9),
            ("D", 10),
            ("A", 11),
            ("E", 12),
        ];
        for (name, number) in majors {
            assert_eq!(
                parse_musical(name),
                Some(key(number, Letter::B)),
                "{name} major should be {number}B"
            );
        }
        let minors = [
            ("Abm", 1),
            ("Ebm", 2),
            ("Bbm", 3),
            ("Fm", 4),
            ("Cm", 5),
            ("Gm", 6),
            ("Dm", 7),
            ("Am", 8),
            ("Em", 9),
            ("Bm", 10),
            ("F#m", 11),
            ("C#m", 12),
        ];
        for (name, number) in minors {
            assert_eq!(
                parse_musical(name),
                Some(key(number, Letter::A)),
                "{name} should be {number}A"
            );
        }
    }

    /// Enharmonic spellings are the same pitch class, hence the same key —
    /// including the theoretical spellings a tagger could still emit.
    #[test]
    fn parse_musical_treats_enharmonics_identically() {
        assert_eq!(parse_musical("C#"), parse_musical("Db"));
        assert_eq!(parse_musical("G#m"), parse_musical("Abm"));
        assert_eq!(parse_musical("Gbm"), parse_musical("F#m"));
        assert_eq!(parse_musical("Cb"), Some(key(1, Letter::B)), "Cb is B major");
        assert_eq!(parse_musical("E#m"), Some(key(4, Letter::A)), "E#m is Fm");
    }

    /// Case, whitespace, and the word-form mode suffixes all fold; the strings
    /// are whatever a tagging tool wrote, not a validated vocabulary.
    #[test]
    fn parse_musical_folds_case_whitespace_and_mode_words() {
        assert_eq!(parse_musical("  am  "), Some(key(8, Letter::A)));
        assert_eq!(parse_musical("ebm"), Some(key(2, Letter::A)));
        assert_eq!(parse_musical("F# minor"), Some(key(11, Letter::A)));
        assert_eq!(parse_musical("C MAJ"), Some(key(8, Letter::B)));
        assert_eq!(parse_musical("bm"), Some(key(10, Letter::A)));
    }

    /// Anything that is not musical notation is `None`, never a guess (AD-11) —
    /// including Camelot strings, which belong to [`parse`], and the real-data
    /// garbage that motivated the total-function contract.
    #[test]
    fn parse_musical_rejects_non_musical_strings() {
        assert_eq!(parse_musical("8A"), None, "Camelot is parse()'s job");
        assert_eq!(parse_musical("10m"), None, "real-data garbage key");
        assert_eq!(parse_musical("H"), None, "not a note letter");
        assert_eq!(parse_musical("Amx"), None, "trailing junk is not a mode");
        assert_eq!(parse_musical(""), None);
        assert_eq!(parse_musical("Deep House"), None, "a genre is not a key");
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
                camelot,
                ..EnrichedPlay::default()
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
