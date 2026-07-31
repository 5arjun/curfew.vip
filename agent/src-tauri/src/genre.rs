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
//! [`normalize`] maps a raw genre string to a fixed, Curfew-maintained **two-level**
//! taxonomy ([`TAXONOMY`]): every raw genre resolves to both a specific *subgenre*
//! (e.g. "Deep House") and the *parent genre* it rolls up to (e.g. "House"),
//! producing the [`NormalizedGenre`] quad AD-12 requires (FR-8 / AR-6). Nothing
//! consumes its output yet — it is built in isolation, exactly as the joiner was
//! built before any stat engine existed to read [`JoinedMetadata`].
//!
//! Design invariants:
//! - **Total and infallible.** Every possible input has one correct defined output, so
//!   [`normalize`] returns its type directly — no `Result`, no error enum. A known raw
//!   maps to its subgenre + parent; a present-but-unrecognized raw maps to
//!   [`DEFAULT_BUCKET`] at *both* levels (AC-2, never dropped); an absent (or blank)
//!   raw stays `None`. This mirrors [`crate::joiner::embedded_tags::fill_gaps`]
//!   exactly: table lookup has no UI-actionable hard-failure mode, unlike reading the
//!   DJ's *one* Serato file, so there is nothing for a `Result` to carry.
//! - **Missing is not the default bucket** (AD-11, "never guess"). `None` in means
//!   `None` out — a play that never carried a genre must stay absent and route to the
//!   display-layer "Unknown," never be forced into the default bucket. That would
//!   silently manufacture a normalized value for a track that never had a genre. The
//!   default bucket is only for a genre that is *present but unrecognized*.
//! - **Deterministic** (AC-2). The same raw string always maps to the same
//!   subgenre/parent pair, run to run: the table is a compile-time constant and the
//!   lookup is a pure case-fold/trim of the key with no ordering ambiguity (each alias
//!   belongs to exactly one subgenre, each subgenre to exactly one parent). The fold
//!   allocates one lowercased key per call; the table scan itself ([`bucket_for`]) is
//!   allocation-free.
//! - **Raw preserved verbatim.** The stored [`NormalizedGenre::raw`] is byte-identical
//!   to the input — never trimmed, lowercased, or rewritten (same discipline as
//!   [`crate::joiner::non_empty`], which normalizes only the emptiness test). Case- and
//!   whitespace-folding happens only on the internal *lookup key*, never on the value
//!   we keep.
//! - **Not DJ-editable** (AC-3). The taxonomy is baked into the agent binary as a
//!   `const`; there is no edit UI, no config file, no runtime mutation, no custom-
//!   mapping hook. AC-3 is satisfied by construction — by the *absence* of an editor.
//!
//! What this filter deliberately does *not* do: persist the quad or put it on the
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
///
/// Bumped 1 -> 2: taxonomy restructured to a two-level subgenre/parent-genre
/// hierarchy and the Bollywood bucket (Bhangra/Punjabi/Desi EDM/Bollywood
/// Hip-Hop-Trap/Bollywood) was added.
pub const TAXONOMY_VERSION: u32 = 2;

/// The subgenre/parent a *present but unrecognized* raw genre maps to (AC-2). A
/// genre that the table has no alias for is never dropped — it lands here
/// deterministically at both levels. This is distinct from an *absent* genre
/// (`None`), which stays `None` (see [`normalize`]).
pub const DEFAULT_BUCKET: &str = "Other";

/// The fixed Curfew genre taxonomy: `(parent genre, &[(subgenre, its aliases)])`.
///
/// **Content, not mechanism.** The exact bucket/subgenre set and alias lists are a
/// Curfew-maintained *product* decision (Story 1.6 Open Question #2), drafted here for
/// electronic/DJ libraries and cheap to refine later — bump [`TAXONOMY_VERSION`] when
/// you do. The *mechanism* (fixed, versioned, deterministic, defaulting) is what this
/// story freezes.
///
/// Every parent genre carries a "generic" subgenre named after the parent itself
/// (holding the bare/ungrouped alias, e.g. `"house"` -> subgenre `"House"`), plus one
/// subgenre per distinct alias group within that genre. Alias groups that were pure
/// spelling synonyms (e.g. `"uk garage"`/`"ukg"`) are merged into a single subgenre
/// rather than split.
///
/// **Maintenance contract:** every alias string MUST be lowercase and whitespace-
/// trimmed, because [`normalize`] matches against a lowercased/trimmed lookup key by
/// direct equality (it does not re-fold the aliases). Include a subgenre's own
/// lowercased spelling among its aliases when it has one. Each alias must belong to
/// exactly one subgenre across the *entire* table (not just within one parent) — a
/// duplicate would make the first-match scan order-dependent, breaking determinism; a
/// test guards this.
const TAXONOMY: &[(&str, &[(&str, &[&str])])] = &[
    (
        "House",
        &[
            ("House", &["house"]),
            ("Deep House", &["deep house"]),
            ("Tech House", &["tech house"]),
            ("Progressive House", &["progressive house"]),
            ("Future House", &["future house"]),
            ("Bass House", &["bass house"]),
            ("Electro House", &["electro house"]),
            ("Tropical House", &["tropical house"]),
            ("Afro House", &["afro house"]),
            ("Soulful House", &["soulful house"]),
            ("Funky House", &["funky house"]),
            ("Jackin House", &["jackin house", "jackin' house"]),
        ],
    ),
    (
        "Techno",
        &[
            ("Techno", &["techno"]),
            ("Melodic Techno", &["melodic techno"]),
            ("Minimal Techno", &["minimal techno"]),
            ("Hard Techno", &["hard techno"]),
            ("Dub Techno", &["dub techno"]),
            ("Detroit Techno", &["detroit techno"]),
            ("Peak Time Techno", &["peak time techno"]),
        ],
    ),
    (
        "Trance",
        &[
            ("Trance", &["trance"]),
            ("Progressive Trance", &["progressive trance"]),
            ("Psytrance", &["psytrance", "psychedelic trance"]),
            ("Uplifting Trance", &["uplifting trance"]),
            ("Tech Trance", &["tech trance"]),
            ("Goa Trance", &["goa trance"]),
            ("Hard Trance", &["hard trance"]),
        ],
    ),
    (
        "Drum & Bass",
        &[
            (
                "Drum & Bass",
                &["drum & bass", "drum and bass", "dnb", "d&b"],
            ),
            ("Liquid", &["liquid dnb", "liquid funk"]),
            ("Neurofunk", &["neurofunk"]),
            ("Jungle", &["jungle"]),
            ("Jump Up", &["jump up"]),
        ],
    ),
    (
        "Dubstep",
        &[
            ("Dubstep", &["dubstep"]),
            ("Brostep", &["brostep"]),
            ("Riddim", &["riddim"]),
            ("Melodic Dubstep", &["melodic dubstep"]),
        ],
    ),
    (
        "Bass",
        &[
            ("Bass", &["bass", "bass music"]),
            ("UK Bass", &["uk bass"]),
            ("Future Bass", &["future bass"]),
            ("Wave", &["wave"]),
        ],
    ),
    (
        "Trap",
        &[
            ("Trap", &["trap"]),
            ("Festival Trap", &["festival trap"]),
            ("Hybrid Trap", &["hybrid trap"]),
        ],
    ),
    (
        "Garage",
        &[
            ("Garage", &["garage"]),
            ("UK Garage", &["uk garage", "ukg"]),
            ("2-Step", &["2-step", "2 step"]),
            ("Speed Garage", &["speed garage"]),
            ("Future Garage", &["future garage"]),
        ],
    ),
    (
        "Breakbeat",
        &[
            ("Breakbeat", &["breakbeat", "breaks"]),
            ("Big Beat", &["big beat"]),
            ("Nu Skool Breaks", &["nu skool breaks"]),
        ],
    ),
    (
        "Hard Dance",
        &[
            ("Hard Dance", &["hard dance"]),
            ("Hardstyle", &["hardstyle"]),
            ("Hardcore", &["hardcore"]),
            ("Gabber", &["gabber"]),
            ("Rawstyle", &["rawstyle"]),
        ],
    ),
    (
        "Disco",
        &[
            ("Disco", &["disco"]),
            ("Nu-Disco", &["nu-disco", "nu disco"]),
            ("Italo Disco", &["italo disco"]),
            ("Disco House", &["disco house"]),
        ],
    ),
    (
        "Funk / Soul",
        &[
            ("Funk", &["funk"]),
            ("Soul", &["soul"]),
            ("Funk & Soul", &["funk & soul", "funk and soul"]),
        ],
    ),
    (
        "Hip-Hop",
        &[
            ("Hip-Hop", &["hip-hop", "hip hop", "hiphop"]),
            ("Rap", &["rap"]),
            ("Boom Bap", &["boom bap"]),
        ],
    ),
    (
        "R&B",
        &[
            ("R&B", &["r&b", "rnb", "r and b"]),
            ("Contemporary R&B", &["contemporary r&b"]),
        ],
    ),
    (
        "Pop",
        &[
            ("Pop", &["pop"]),
            ("Dance Pop", &["dance pop"]),
            ("Electropop", &["electropop"]),
            ("Synthpop", &["synthpop", "synth-pop"]),
        ],
    ),
    (
        "Rock",
        &[
            ("Rock", &["rock"]),
            ("Indie Rock", &["indie rock"]),
            ("Alternative Rock", &["alternative rock"]),
            ("Classic Rock", &["classic rock"]),
        ],
    ),
    (
        "Ambient",
        &[
            ("Ambient", &["ambient"]),
            ("Downtempo", &["downtempo"]),
            ("Chillout", &["chillout", "chill out", "chill"]),
            ("Lo-Fi", &["lofi", "lo-fi"]),
        ],
    ),
    (
        "Electronica",
        &[
            ("Electronica", &["electronica", "electronic"]),
            ("EDM", &["edm"]),
            ("IDM", &["idm"]),
            ("Dance", &["dance"]),
        ],
    ),
    (
        "Reggae / Dancehall",
        &[
            ("Reggae", &["reggae", "ragga"]),
            ("Dancehall", &["dancehall"]),
            ("Dub", &["dub"]),
        ],
    ),
    (
        "Latin",
        &[
            ("Latin", &["latin"]),
            ("Reggaeton", &["reggaeton"]),
            ("Salsa", &["salsa"]),
            ("Cumbia", &["cumbia"]),
        ],
    ),
    (
        "Afrobeats",
        &[
            ("Afrobeats", &["afrobeats", "afrobeat"]),
            ("Amapiano", &["amapiano"]),
        ],
    ),
    (
        "Bollywood",
        &[
            (
                "Bollywood",
                &["bollywood", "filmi", "desi pop", "indi pop", "hindi pop"],
            ),
            ("Bhangra", &["bhangra"]),
            ("Punjabi", &["punjabi", "punjabi pop"]),
            ("Desi EDM", &["desi edm", "desi house", "indo house"]),
            (
                "Bollywood Hip-Hop/Trap",
                &[
                    "bollywood hip-hop",
                    "bollywood trap",
                    "desi hip hop",
                    "desi trap",
                ],
            ),
        ],
    ),
];

/// A raw genre string normalized against the fixed Curfew taxonomy, stamped with the
/// table version that produced it. The four fields together are what AD-12 / AR-6
/// require be stored per play (raw + subgenre + normalized parent + version) so trends
/// can be recomputed consistently after the table evolves.
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
    /// The specific subgenre from the fixed Curfew taxonomy (e.g. "Deep House").
    /// Always present alongside `normalized`: a present-but-unrecognized raw maps to
    /// [`DEFAULT_BUCKET`] at this level too (AC-2), never dropped.
    pub subgenre: String,
    /// The parent genre `subgenre` rolls up to (e.g. "House"). Always present: a
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
///   taxonomy subgenre + parent genre.
/// - a *present-but-unrecognized* raw → `Some` with [`DEFAULT_BUCKET`] at both levels
///   (AC-2).
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

    let (subgenre, normalized) = bucket_for(&key).unwrap_or((DEFAULT_BUCKET, DEFAULT_BUCKET));

    Some(NormalizedGenre {
        raw: raw.to_string(),
        subgenre: subgenre.to_string(),
        normalized: normalized.to_string(),
        taxonomy_version: TAXONOMY_VERSION,
    })
}

/// Finds the `(subgenre, parent genre)` pair for an already-folded (lowercased,
/// trimmed) lookup `key`, or `None` if the key is present-but-unrecognized (the
/// caller maps that to [`DEFAULT_BUCKET`] at both levels). Pure and allocation-free
/// over the const [`TAXONOMY`]; the table is small enough that a linear scan is
/// trivially fast and needs no `HashMap`/lazy init (and therefore no new dependency).
fn bucket_for(key: &str) -> Option<(&'static str, &'static str)> {
    for (parent, subgenres) in TAXONOMY {
        for (subgenre, aliases) in *subgenres {
            if aliases.contains(&key) {
                return Some((subgenre, parent));
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AC-1: a known raw genre resolves to its subgenre + parent genre, is stamped
    /// with the current taxonomy version, and keeps its raw string byte-identical to
    /// the input.
    #[test]
    fn known_genre_resolves_to_its_bucket_with_version_and_verbatim_raw() {
        let out = normalize(Some("Deep House")).expect("a present genre normalizes to Some");

        assert_eq!(out.subgenre, "Deep House");
        assert_eq!(out.normalized, "House");
        assert_eq!(out.taxonomy_version, TAXONOMY_VERSION);
        assert_eq!(out.raw, "Deep House", "raw must be preserved verbatim");
    }

    /// A raw genre from a *different* subgenre under the same parent resolves to its
    /// own subgenre but the same parent — proving the two levels are tracked
    /// independently, not collapsed.
    #[test]
    fn different_subgenres_share_parent_but_keep_distinct_subgenre() {
        let deep = normalize(Some("deep house")).unwrap();
        let tech = normalize(Some("tech house")).unwrap();

        assert_eq!(deep.normalized, "House");
        assert_eq!(tech.normalized, "House");
        assert_ne!(deep.subgenre, tech.subgenre);
        assert_eq!(deep.subgenre, "Deep House");
        assert_eq!(tech.subgenre, "Tech House");
    }

    /// AC-1 (matching): case and surrounding-whitespace variants of a known genre all
    /// hit the same subgenre/parent, but each preserves its *own* raw string verbatim
    /// (the fold is on the lookup key only, never the stored value).
    #[test]
    fn case_and_whitespace_variants_hit_same_bucket_but_keep_own_raw() {
        for input in ["deep house", "  Deep House ", "DEEP HOUSE"] {
            let out = normalize(Some(input)).expect("present genre normalizes");
            assert_eq!(
                out.subgenre, "Deep House",
                "{input:?} should map to Deep House"
            );
            assert_eq!(out.normalized, "House", "{input:?} should map to House");
            assert_eq!(out.raw, input, "{input:?} raw must be untouched");
        }
    }

    /// The canonical bucket name itself maps to that bucket at both levels.
    #[test]
    fn canonical_bucket_name_maps_to_itself() {
        let techno = normalize(Some("Techno")).unwrap();
        assert_eq!(techno.subgenre, "Techno");
        assert_eq!(techno.normalized, "Techno");

        let trance = normalize(Some("Trance")).unwrap();
        assert_eq!(trance.subgenre, "Trance");
        assert_eq!(trance.normalized, "Trance");
    }

    /// New Bollywood bucket: distinct subgenres resolve to their own name, sharing the
    /// Bollywood parent.
    #[test]
    fn bollywood_subgenres_resolve_correctly() {
        let bhangra = normalize(Some("Bhangra")).unwrap();
        assert_eq!(bhangra.subgenre, "Bhangra");
        assert_eq!(bhangra.normalized, "Bollywood");

        let punjabi = normalize(Some("punjabi pop")).unwrap();
        assert_eq!(punjabi.subgenre, "Punjabi");
        assert_eq!(punjabi.normalized, "Bollywood");

        let desi_edm = normalize(Some("Desi House")).unwrap();
        assert_eq!(desi_edm.subgenre, "Desi EDM");
        assert_eq!(desi_edm.normalized, "Bollywood");

        let trap = normalize(Some("Bollywood Trap")).unwrap();
        assert_eq!(trap.subgenre, "Bollywood Hip-Hop/Trap");
        assert_eq!(trap.normalized, "Bollywood");

        let generic = normalize(Some("Bollywood")).unwrap();
        assert_eq!(generic.subgenre, "Bollywood");
        assert_eq!(generic.normalized, "Bollywood");
    }

    /// AC-2: a present-but-unrecognized raw maps to the default bucket at both
    /// levels, is never dropped, and is still version-stamped.
    #[test]
    fn present_but_unrecognized_maps_to_default_bucket() {
        let out =
            normalize(Some("totally-made-up-genre-xyz")).expect("a present genre is never dropped");

        assert_eq!(out.subgenre, DEFAULT_BUCKET);
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
            assert_eq!(out.subgenre, DEFAULT_BUCKET);
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
    /// subgenres anywhere in the table (not just within one parent), otherwise the
    /// first-match scan in `bucket_for` would be order-dependent and the maintenance
    /// contract in [`TAXONOMY`]'s doc silently violated.
    #[test]
    fn no_alias_is_shared_across_buckets() {
        use std::collections::HashMap;

        let mut owner: HashMap<&str, (&str, &str)> = HashMap::new();
        for (parent, subgenres) in TAXONOMY {
            for (subgenre, aliases) in *subgenres {
                for alias in *aliases {
                    if let Some(prev) = owner.insert(*alias, (*parent, *subgenre)) {
                        panic!(
                            "alias {alias:?} is claimed by both {prev:?} and {:?}",
                            (*parent, *subgenre)
                        );
                    }
                }
            }
        }
    }

    /// Maintenance contract on the table: every alias is already lowercase and trimmed,
    /// because `normalize` matches a folded key by direct equality and never re-folds
    /// the aliases. An un-folded alias would be silently unreachable.
    #[test]
    fn every_alias_is_lowercased_and_trimmed() {
        for (parent, subgenres) in TAXONOMY {
            for (subgenre, aliases) in *subgenres {
                for alias in *aliases {
                    assert_eq!(
                        *alias,
                        alias.trim().to_lowercase(),
                        "alias {alias:?} in {parent:?}/{subgenre:?} must be lowercase + trimmed to be reachable"
                    );
                }
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
    /// default-bucket string and every parent genre + subgenre name + alias. A
    /// hand-verifiable `(genres, subgenres, aliases)` count is pinned alongside it as a
    /// cross-check. `EXPECTED_FNV` is computed by the *same* function this test runs,
    /// so it is reproducible on every platform — unlike `std::hash::DefaultHasher`,
    /// whose output isn't stable across toolchains. If this fails because you changed
    /// the table on purpose: copy the `actual` value from the panic into
    /// `EXPECTED_FNV`, update the counts, and bump [`TAXONOMY_VERSION`], all in the
    /// same commit.
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

        let mut genres = 0usize;
        let mut subgenres = 0usize;
        let mut aliases = 0usize;
        let mut actual = fold(FNV_OFFSET, DEFAULT_BUCKET);
        for (parent, subgenre_list) in TAXONOMY {
            genres += 1;
            actual = fold(actual, parent);
            for (subgenre, alias_list) in *subgenre_list {
                subgenres += 1;
                actual = fold(actual, subgenre);
                for alias in *alias_list {
                    aliases += 1;
                    actual = fold(actual, alias);
                }
            }
        }

        // Hand-verifiable cross-check (counted directly off the table), so this half of
        // the guard holds regardless of the hash pin.
        assert_eq!(
            (genres, subgenres, aliases),
            (22, 97, 130),
            "taxonomy structure changed — re-pin the counts + EXPECTED_FNV and bump \
             TAXONOMY_VERSION in the same commit; fingerprint is now {actual:#018x}"
        );

        // Content fingerprint pin. See the doc comment for how to re-pin on a real
        // taxonomy change.
        const EXPECTED_FNV: u64 = 0xe08607ac1ad07986;
        assert_eq!(
            actual, EXPECTED_FNV,
            "taxonomy content changed — re-pin EXPECTED_FNV to {actual:#018x} and bump \
             TAXONOMY_VERSION in the same commit"
        );
        assert_eq!(
            TAXONOMY_VERSION, 2,
            "content is pinned to version 2; bump it (and re-pin above) on any table edit"
        );
    }
}
