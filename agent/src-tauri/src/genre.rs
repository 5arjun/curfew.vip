//! Edge genre normalization (Story 1.6, AC-1/AC-2/AC-3).
//!
//! This is the `genre` filter of the agent pipeline documented in
//! [`crate`](../lib.rs) (`watcher -> parser -> joiner -> stat-engine -> local store
//! -> sync-queue`). It sits logically *after* enrichment (the parser and joiner
//! produce a **raw** genre string and deliberately refuse to interpret it — see
//! [`crate::joiner::JoinedMetadata::genre`]) and *before* the stat engine (Story 1.7),
//! which will consume the **normalized** value while the **raw** value +
//! [`TAXONOMY_VERSION`] are retained for later cloud re-normalization.
//!
//! [`normalize`] maps a raw genre string to a fixed, Curfew-maintained taxonomy
//! ([`TAXONOMY`]) and stamps the result with the version of the table it was
//! normalized against, producing the [`NormalizedGenre`] triple AD-12 requires
//! (FR-8 / AR-6). Nothing consumes its output yet — it is built in isolation, exactly
//! as the joiner was built before any stat engine existed to read [`JoinedMetadata`].
//!
//! Design invariants:
//! - **Total and infallible.** Every possible input has one correct defined output, so
//!   [`normalize`] returns its type directly — no `Result`, no error enum. A known raw
//!   maps to its bucket; a present-but-unrecognized raw maps to the [`DEFAULT_BUCKET`]
//!   (AC-2, never dropped); an absent (or blank) raw stays `None`. This mirrors
//!   [`crate::joiner::embedded_tags::fill_gaps`] exactly: table lookup has no
//!   UI-actionable hard-failure mode, unlike reading the DJ's *one* Serato file, so
//!   there is nothing for a `Result` to carry.
//! - **Missing is not the default bucket** (AD-11, "never guess"). `None` in means
//!   `None` out — a play that never carried a genre must stay absent and route to the
//!   display-layer "Unknown," never be forced into the default bucket. That would
//!   silently manufacture a normalized value for a track that never had a genre. The
//!   default bucket is only for a genre that is *present but unrecognized*.
//! - **Deterministic** (AC-2). The same raw string always maps to the same bucket, run
//!   to run: the table is a compile-time constant and the lookup is a pure case-fold/trim
//!   of the key with no ordering ambiguity (each alias belongs to exactly one bucket). The
//!   fold allocates one lowercased key per call; the table scan itself
//!   ([`bucket_for`]) is allocation-free.
//! - **Raw preserved verbatim.** The stored [`NormalizedGenre::raw`] is byte-identical
//!   to the input — never trimmed, lowercased, or rewritten (same discipline as
//!   [`crate::joiner::non_empty`], which normalizes only the emptiness test). Case- and
//!   whitespace-folding happens only on the internal *lookup key*, never on the value
//!   we keep.
//! - **Not DJ-editable** (AC-3). The taxonomy is baked into the agent binary as a
//!   `const`; there is no edit UI, no config file, no runtime mutation, no custom-
//!   mapping hook. AC-3 is satisfied by construction — by the *absence* of an editor.
//!
//! What this filter deliberately does *not* do: persist the triple or put it on the
//! sync wire (there is no store, no assembled per-play record, and no `shared/` genre
//! field yet — all later stories); decide *which* raw genre normalizes when a play has
//! both an inline [`crate::parser::Play::genre`] and a joined
//! [`crate::joiner::JoinedMetadata::genre`] (source selection belongs to whichever
//! stage assembles the final per-play record — Story 1.7 territory —
//! [`normalize`] takes a single raw string so it composes with either); or run any
//! audio analysis / ML / fuzzy classification (NFR-3 — deterministic table lookup only).

/// The version of the fixed taxonomy table below.
///
/// Every [`NormalizedGenre`] the agent produces is stamped with the version of the
/// table it was normalized against (AD-12). A heterogeneous, already-deployed agent
/// fleet may carry different table versions, so each play must self-describe which
/// version produced its normalized value — that is what lets the cloud re-run the
/// lookup over the retained raw string and recompute trends (FR-9) consistently after
/// the table evolves. **Bump this whenever [`TAXONOMY`] or [`DEFAULT_BUCKET`] changes.**
pub const TAXONOMY_VERSION: u32 = 1;

/// The bucket a *present but unrecognized* raw genre maps to (AC-2). A genre that the
/// table has no alias for is never dropped — it lands here deterministically. This is
/// distinct from an *absent* genre (`None`), which stays `None` (see [`normalize`]).
pub const DEFAULT_BUCKET: &str = "Other";

/// The fixed Curfew genre taxonomy: `(canonical bucket name, its aliases)`.
///
/// **Content, not mechanism.** The exact bucket set and alias lists are a
/// Curfew-maintained *product* decision (Story 1.6 Open Question #2), drafted here for
/// electronic/DJ libraries and cheap to refine later — bump [`TAXONOMY_VERSION`] when
/// you do. The *mechanism* (fixed, versioned, deterministic, defaulting) is what this
/// story freezes.
///
/// **Maintenance contract:** every alias string MUST be lowercase and whitespace-
/// trimmed, because [`normalize`] matches against a lowercased/trimmed lookup key by
/// direct equality (it does not re-fold the aliases). Include the bucket's own
/// lowercased spelling among its aliases so the canonical name maps to itself. Each
/// alias must belong to exactly one bucket — a duplicate across buckets would make the
/// first-match scan order-dependent, breaking determinism; a test guards this.
const TAXONOMY: &[(&str, &[&str])] = &[
    (
        "House",
        &[
            "house",
            "deep house",
            "tech house",
            "progressive house",
            "future house",
            "bass house",
            "electro house",
            "tropical house",
            "afro house",
            "soulful house",
            "funky house",
            "jackin house",
            "jackin' house",
        ],
    ),
    (
        "Techno",
        &[
            "techno",
            "melodic techno",
            "minimal techno",
            "hard techno",
            "dub techno",
            "detroit techno",
            "peak time techno",
        ],
    ),
    (
        "Trance",
        &[
            "trance",
            "progressive trance",
            "psytrance",
            "psychedelic trance",
            "uplifting trance",
            "tech trance",
            "goa trance",
            "hard trance",
        ],
    ),
    (
        "Drum & Bass",
        &[
            "drum & bass",
            "drum and bass",
            "dnb",
            "d&b",
            "liquid dnb",
            "liquid funk",
            "neurofunk",
            "jungle",
            "jump up",
        ],
    ),
    (
        "Dubstep",
        &["dubstep", "brostep", "riddim", "melodic dubstep"],
    ),
    (
        "Bass",
        &["bass", "bass music", "uk bass", "future bass", "wave"],
    ),
    ("Trap", &["trap", "festival trap", "hybrid trap"]),
    (
        "Garage",
        &[
            "garage",
            "uk garage",
            "ukg",
            "2-step",
            "2 step",
            "speed garage",
            "future garage",
        ],
    ),
    (
        "Breakbeat",
        &["breakbeat", "breaks", "big beat", "nu skool breaks"],
    ),
    (
        "Hard Dance",
        &["hard dance", "hardstyle", "hardcore", "gabber", "rawstyle"],
    ),
    (
        "Disco",
        &[
            "disco",
            "nu-disco",
            "nu disco",
            "italo disco",
            "disco house",
        ],
    ),
    (
        "Funk / Soul",
        &["funk", "soul", "funk & soul", "funk and soul"],
    ),
    (
        "Hip-Hop",
        &["hip-hop", "hip hop", "hiphop", "rap", "boom bap"],
    ),
    ("R&B", &["r&b", "rnb", "r and b", "contemporary r&b"]),
    (
        "Pop",
        &["pop", "dance pop", "electropop", "synthpop", "synth-pop"],
    ),
    (
        "Rock",
        &["rock", "indie rock", "alternative rock", "classic rock"],
    ),
    (
        "Ambient",
        &[
            "ambient",
            "downtempo",
            "chillout",
            "chill out",
            "chill",
            "lofi",
            "lo-fi",
        ],
    ),
    (
        "Electronica",
        &["electronica", "electronic", "edm", "idm", "dance"],
    ),
    (
        "Reggae / Dancehall",
        &["reggae", "dancehall", "ragga", "dub"],
    ),
    ("Latin", &["latin", "reggaeton", "salsa", "cumbia"]),
    ("Afrobeats", &["afrobeats", "afrobeat", "amapiano"]),
];

/// A raw genre string normalized against the fixed Curfew taxonomy, stamped with the
/// table version that produced it. The three fields together are what AD-12 / AR-6
/// require be stored per play (raw + normalized + version) so trends can be recomputed
/// consistently after the table evolves.
///
/// No `Default` impl: there is no sensible default *normalized* bucket (a bare
/// `NormalizedGenre` would either fabricate a genre or lie about its version), unlike
/// the meaningfully-all-`None` [`crate::parser::Play`] / [`crate::joiner::JoinedMetadata`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedGenre {
    /// The raw genre string exactly as the source stored it — preserved verbatim,
    /// never trimmed or rewritten (AD-12: the raw string is the input to cloud
    /// re-normalization when the table later evolves).
    pub raw: String,
    /// The normalized bucket from the fixed Curfew taxonomy. Always present: a
    /// present-but-unrecognized raw maps to [`DEFAULT_BUCKET`] (AC-2), never dropped.
    pub normalized: String,
    /// The version of the taxonomy table this value was normalized against
    /// ([`TAXONOMY_VERSION`]). Stamped per play so a heterogeneous fleet's plays can be
    /// recomputed consistently after the table changes (AD-12).
    pub taxonomy_version: u32,
}

/// Normalizes a single raw genre string against the fixed Curfew taxonomy.
///
/// Total and infallible (see the module docs). The three defined outcomes:
/// - `None` in → `None` out. An absent genre stays absent (the AD-11 "Unknown" path);
///   a present-but-blank/whitespace-only string is treated as absent-equivalent and
///   also returns `None`. This follows the spirit of [`crate::joiner::non_empty`]'s "an
///   empty string is not a real value," extended one step: `non_empty` rejects only the
///   exact empty string (it returns `Some("   ")` for whitespace), whereas `normalize`
///   trims first, so a whitespace-only genre is `None` here too.
/// - a *known* raw (any case, surrounding whitespace ignored) → `Some` with its
///   taxonomy bucket.
/// - a *present-but-unrecognized* raw → `Some` with [`DEFAULT_BUCKET`] (AC-2).
///
/// In every `Some` case the returned [`NormalizedGenre::raw`] is byte-identical to the
/// (unwrapped) input and [`NormalizedGenre::taxonomy_version`] is [`TAXONOMY_VERSION`].
/// The case/whitespace folding used to match against the table never touches the stored
/// raw value.
pub fn normalize(raw: Option<&str>) -> Option<NormalizedGenre> {
    let raw = raw?;

    // Fold only the *lookup key*: trim surrounding whitespace and lowercase so
    // "Deep House", "deep house", and "  DEEP HOUSE " all match the same alias. The
    // stored `raw` below is the untouched original.
    let key = raw.trim().to_lowercase();

    // A present-but-blank / whitespace-only genre is "no meaningful genre," not a real
    // value — treat it as absent (Open Question #4), reserving the default bucket for
    // genuinely-present-but-unrecognized strings.
    if key.is_empty() {
        return None;
    }

    let normalized = bucket_for(&key).unwrap_or(DEFAULT_BUCKET);

    Some(NormalizedGenre {
        raw: raw.to_string(),
        normalized: normalized.to_string(),
        taxonomy_version: TAXONOMY_VERSION,
    })
}

/// Finds the taxonomy bucket for an already-folded (lowercased, trimmed) lookup `key`,
/// or `None` if the key is present-but-unrecognized (the caller maps that to
/// [`DEFAULT_BUCKET`]). Pure and allocation-free over the const [`TAXONOMY`]; the table
/// is small enough that a linear scan is trivially fast and needs no `HashMap`/lazy
/// init (and therefore no new dependency).
fn bucket_for(key: &str) -> Option<&'static str> {
    TAXONOMY
        .iter()
        .find(|(_, aliases)| aliases.contains(&key))
        .map(|(bucket, _)| *bucket)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AC-1: a known raw genre resolves to its bucket, is stamped with the current
    /// taxonomy version, and keeps its raw string byte-identical to the input.
    #[test]
    fn known_genre_resolves_to_its_bucket_with_version_and_verbatim_raw() {
        let out = normalize(Some("Deep House")).expect("a present genre normalizes to Some");

        assert_eq!(out.normalized, "House");
        assert_eq!(out.taxonomy_version, TAXONOMY_VERSION);
        assert_eq!(out.raw, "Deep House", "raw must be preserved verbatim");
    }

    /// AC-1 (matching): case and surrounding-whitespace variants of a known genre all
    /// hit the same bucket, but each preserves its *own* raw string verbatim (the fold
    /// is on the lookup key only, never the stored value).
    #[test]
    fn case_and_whitespace_variants_hit_same_bucket_but_keep_own_raw() {
        for input in ["deep house", "  Deep House ", "DEEP HOUSE"] {
            let out = normalize(Some(input)).expect("present genre normalizes");
            assert_eq!(out.normalized, "House", "{input:?} should map to House");
            assert_eq!(out.raw, input, "{input:?} raw must be untouched");
        }
    }

    /// The canonical bucket name itself maps to that bucket (each bucket lists its own
    /// lowercased spelling among its aliases).
    #[test]
    fn canonical_bucket_name_maps_to_itself() {
        assert_eq!(normalize(Some("Techno")).unwrap().normalized, "Techno");
        assert_eq!(normalize(Some("Trance")).unwrap().normalized, "Trance");
    }

    /// AC-2: a present-but-unrecognized raw maps to the default bucket, is never
    /// dropped, and is still version-stamped.
    #[test]
    fn present_but_unrecognized_maps_to_default_bucket() {
        let out =
            normalize(Some("totally-made-up-genre-xyz")).expect("a present genre is never dropped");

        assert_eq!(out.normalized, DEFAULT_BUCKET);
        assert_eq!(out.normalized, "Other");
        assert_eq!(out.raw, "totally-made-up-genre-xyz");
        assert_eq!(out.taxonomy_version, TAXONOMY_VERSION);
    }

    /// Scope boundary (AD-11): an absent genre stays absent — `None` in, `None` out. It
    /// must NOT be forced into the default bucket; missing and unrecognized are two
    /// different states, and conflating them would manufacture a genre for a track that
    /// never had one.
    #[test]
    fn absent_genre_stays_none_not_default_bucket() {
        assert_eq!(normalize(None), None);
    }

    /// Open Question #4: a present-but-blank / whitespace-only string is treated as
    /// absent-equivalent (→ `None`), consistent with `joiner::non_empty`'s "empty
    /// string is not a real value" — the default bucket is reserved for genuinely
    /// present, unrecognized genres.
    #[test]
    fn blank_and_whitespace_only_are_none() {
        assert_eq!(normalize(Some("")), None);
        assert_eq!(normalize(Some("   ")), None);
        assert_eq!(normalize(Some("\t \n")), None);
    }

    /// Task 3 (the Story 1.5 hand-off): Story 1.5 stores a legacy ID3v1 numeric `TCON`
    /// raw and uninterpreted (e.g. the literal `"(17)"`), explicitly deferring it here.
    /// V1 policy (Open Question #3, option b): treat `"(17)"`-form strings as ordinary
    /// unrecognized raw → default bucket. This keeps the table purely string-keyed and
    /// avoids importing the 192-entry ID3v1 table for a case a Serato electronic library
    /// rarely carries. Deterministic and explicitly tested, per the cross-story contract.
    #[test]
    fn legacy_numeric_tcon_forms_map_to_default_bucket() {
        for input in ["(17)", "17", "(17)Rock"] {
            let out = normalize(Some(input)).expect("present raw is never dropped");
            assert_eq!(
                out.normalized, DEFAULT_BUCKET,
                "{input:?} is unrecognized-raw under V1 policy (b)"
            );
            assert_eq!(out.raw, input, "{input:?} raw preserved verbatim");
        }
    }

    /// Determinism (AC-2), mirroring `parser::parse_is_deterministic`: normalizing the
    /// same raw string twice yields identical results, across known / unrecognized /
    /// absent inputs.
    #[test]
    fn normalize_is_deterministic() {
        for input in [Some("Tech House"), Some("weird-unknown"), Some(""), None] {
            assert_eq!(normalize(input), normalize(input));
        }
    }

    /// AC-1 (version stamp guard): every produced `NormalizedGenre` — known or
    /// defaulted — carries `taxonomy_version == TAXONOMY_VERSION`, so a future table
    /// bump can't silently ship un-stamped values.
    #[test]
    fn every_produced_value_is_version_stamped() {
        for input in ["Trance", "Techno", "some-obscure-tag", "(17)"] {
            let out = normalize(Some(input)).expect("present genre normalizes");
            assert_eq!(
                out.taxonomy_version, TAXONOMY_VERSION,
                "{input:?} unstamped"
            );
        }
    }

    /// Determinism guard on the table itself: no alias string may belong to two
    /// buckets, otherwise the first-match scan in `bucket_for` would be order-dependent
    /// and the maintenance contract in [`TAXONOMY`]'s doc silently violated.
    #[test]
    fn no_alias_is_shared_across_buckets() {
        use std::collections::HashMap;

        // `bucket`/`alias` bind as `&&str` via match ergonomics over `TAXONOMY`;
        // dereference once to the `&str` the map stores.
        let mut owner: HashMap<&str, &str> = HashMap::new();
        for (bucket, aliases) in TAXONOMY {
            for alias in *aliases {
                if let Some(prev) = owner.insert(*alias, *bucket) {
                    panic!("alias {alias:?} is claimed by both {prev:?} and {bucket:?}");
                }
            }
        }
    }

    /// Maintenance contract on the table: every alias is already lowercase and trimmed,
    /// because `normalize` matches a folded key by direct equality and never re-folds
    /// the aliases. An un-folded alias would be silently unreachable.
    #[test]
    fn every_alias_is_lowercased_and_trimmed() {
        for (bucket, aliases) in TAXONOMY {
            for alias in *aliases {
                assert_eq!(
                    *alias,
                    alias.trim().to_lowercase(),
                    "alias {alias:?} in {bucket:?} must be lowercase + trimmed to be reachable"
                );
            }
        }
    }

    /// Version-bump tripwire (AD-12). The whole re-normalization story depends on
    /// [`TAXONOMY_VERSION`] being bumped whenever [`TAXONOMY`] or [`DEFAULT_BUCKET`]
    /// changes — otherwise two fleet agents can produce different normalized values
    /// under the *same* version and the cloud can't tell them apart. The "bump this"
    /// comment on [`TAXONOMY_VERSION`] is prose that nothing enforces, so this test
    /// pins a content fingerprint against the current version: any add, removal, or
    /// in-place spelling edit changes the fingerprint and trips the assert, whose
    /// message tells the editor to re-pin it **and** bump the version in the same
    /// commit — making the bump a conscious step, not a thing to forget.
    ///
    /// The fingerprint is a deterministic, dependency-free FNV-1a hash over the
    /// default-bucket string and every canonical bucket name + alias. A hand-verifiable
    /// `(buckets, aliases)` count is pinned alongside it as a cross-check. `EXPECTED_FNV`
    /// is computed by the *same* function this test runs, so it is reproducible on every
    /// platform — unlike `std::hash::DefaultHasher`, whose output isn't stable across
    /// toolchains. If this fails because you changed the table on purpose: copy the
    /// `actual` value from the panic into `EXPECTED_FNV`, update the counts, and bump
    /// [`TAXONOMY_VERSION`], all in the same commit.
    #[test]
    fn table_content_is_version_pinned() {
        const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
        const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
        fn fold(mut h: u64, s: &str) -> u64 {
            for b in s.bytes() {
                h ^= b as u64;
                h = h.wrapping_mul(FNV_PRIME);
            }
            // A separator no alias contains, so ("ab","c") can't hash like ("a","bc").
            h ^= 0x1f;
            h.wrapping_mul(FNV_PRIME)
        }

        let mut buckets = 0usize;
        let mut aliases = 0usize;
        let mut actual = fold(FNV_OFFSET, DEFAULT_BUCKET);
        for (bucket, alias_list) in TAXONOMY {
            buckets += 1;
            actual = fold(actual, bucket);
            for alias in *alias_list {
                aliases += 1;
                actual = fold(actual, alias);
            }
        }

        // Hand-verifiable cross-check (counted directly off the table), so this half of
        // the guard holds regardless of the hash pin.
        assert_eq!(
            (buckets, aliases),
            (21, 115),
            "taxonomy structure changed — re-pin the counts + EXPECTED_FNV and bump \
             TAXONOMY_VERSION in the same commit; fingerprint is now {actual:#018x}"
        );

        // Content fingerprint pin. See the doc comment for how to re-pin on a real
        // taxonomy change. `EXPECTED_FNV` was computed by an independent reference
        // implementation of this exact `fold`/order over the v1 table; a mismatch here
        // means either the table changed or the two implementations diverged.
        const EXPECTED_FNV: u64 = 0xb3fd_bf5c_96db_e8a0;
        assert_eq!(
            actual, EXPECTED_FNV,
            "taxonomy content changed — re-pin EXPECTED_FNV to {actual:#018x} and bump \
             TAXONOMY_VERSION in the same commit"
        );
        assert_eq!(
            TAXONOMY_VERSION, 1,
            "content is pinned to version 1; bump it (and re-pin above) on any table edit"
        );
    }
}
