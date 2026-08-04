//! Legacy `database V2` library join (AC-1, AC-3, AC-4).
//!
//! Reads the pre-Serato-4 binary catalogue at `<library root>/_Serato_/database V2`
//! into a path-keyed lookup table, then resolves a [`Play`](crate::parser::Play) against
//! it.
//!
//! **Why this does not use `triseratops::library::Library`/`Track`.** The pinned
//! `triseratops` commit exposes a high-level `Library::read_from_path` + `Library::track`
//! API that looks like exactly the right tool — but `Track` has no `bpm` field at all,
//! and `Track::from_fields` drops `database::Field::BPM` through a trailing catch-all
//! arm. Building on it compiles, resolves key and genre correctly, and returns `None`
//! for BPM on every track forever: a silent wrong answer indistinguishable from
//! "off-library" or "genuinely absent", which is the precise failure mode AD-11 and
//! Story 1.3's review pass exist to prevent. So this module calls the same crate's
//! lower-level [`database::parse`] entry point and reads the fields itself. The binary
//! decode is still 100% `triseratops`' own `nom` code — only the field extraction is
//! ours.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use triseratops::library::database::{self, Field};

use super::{non_empty, sane_bpm, JoinedMetadata};
use crate::parser::Play;

/// Serato's library directory name, and the catalogue file inside it. Mirrors
/// `triseratops`' own path convention so this loader looks where the crate would.
///
/// `pub(crate)` (not module-private): Story 2.6's `watcher::detect`
/// install-generation classifier reuses these exact names rather than
/// redeclaring them, per that story's own Task 1 — but that consumer is
/// same-crate, so there's no reason to widen the crate's public API surface.
pub(crate) const SERATO_DIR: &str = "_Serato_";
pub(crate) const DATABASE_FILENAME: &str = "database V2";

/// Everything that can go wrong loading a `database V2` catalogue: the file could not
/// be read, or its bytes did not decode. Mirrors the `Display`/`std::error::Error`
/// idiom of `SchemaLoadError` in [`crate`](../lib.rs) and `ParseError` in
/// [`crate::parser`] — a small enum in application code rather than an `anyhow` chain.
///
/// Callers mapping this to UI copy must distinguish the two shapes of [`Io`](Self::Io)
/// as the parser does: `ErrorKind::PermissionDenied` means macOS TCC has not granted
/// access to `~/Music/_Serato_/` and needs a "grant access" prompt, while
/// `ErrorKind::NotFound` most likely means this DJ has no legacy library at all (they
/// may be a Serato 4+ user — see [`super::serato4`]), which is not an error worth
/// alarming them about.
#[derive(Debug)]
pub enum JoinError {
    /// The catalogue file could not be read from disk.
    Io(std::io::Error),
    /// The catalogue file's bytes did not decode as `database V2`.
    Parse(triseratops::error::Error),
    /// The catalogue path resolved outside the configured Serato root (Story
    /// 2.7, AC-1) — a symlink or similar redirected a "scoped" read elsewhere.
    /// A missing/unreadable root or catalogue is [`Io`](Self::Io), not this
    /// variant; this is only reached once both paths exist and disagree.
    Scope(crate::fs_scope::ScopeError),
}

impl std::fmt::Display for JoinError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            JoinError::Io(e) => write!(f, "failed to read Serato library database: {e}"),
            JoinError::Parse(e) => write!(f, "malformed Serato library database: {e}"),
            JoinError::Scope(e) => write!(f, "refusing to read Serato library database: {e}"),
        }
    }
}

impl std::error::Error for JoinError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            JoinError::Io(e) => Some(e),
            JoinError::Parse(e) => Some(e),
            JoinError::Scope(e) => Some(e),
        }
    }
}

/// The three fields this story resolves, for one catalogued track.
///
/// Deliberately our own type rather than `triseratops::library::Track` — see the module
/// docs for why that type cannot carry BPM.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct LibraryTrack {
    /// Serato's analysed BPM, parsed from its stored decimal-string form.
    pub bpm: Option<f64>,
    /// Musical key, raw (already Camelot notation at the source).
    pub key: Option<String>,
    /// Genre, raw and un-normalized.
    pub genre: Option<String>,
    /// When the library first saw this track — Unix epoch seconds, from the
    /// catalogue's `uadd` (u32 epoch) or `tadd` (the same epoch as a decimal
    /// string — verified identical on real data, Story 3.7 §3d) date-added
    /// field. Powers "New tracks played"; `None` when neither field is present
    /// or the string form is not a plain epoch number (never guess a date
    /// format, AD-11).
    pub date_added: Option<i64>,
}

/// A loaded `database V2` catalogue, indexed by the file path it stores for each track.
#[derive(Debug, Clone, Default)]
pub struct LegacyLibrary {
    tracks: HashMap<PathBuf, LibraryTrack>,
}

impl LegacyLibrary {
    /// Loads the catalogue at `<library_root>/_Serato_/database V2`.
    ///
    /// **Read-only:** the file is opened via [`std::fs::read`] and never written,
    /// moved, or truncated — Serato itself may have it open.
    ///
    /// **Scoped to `library_root` (Story 2.7, AC-1):** the derived catalogue
    /// path is confirmed, after canonicalization, to still resolve under
    /// `library_root` before it is read — defense-in-depth against a symlink
    /// planted under the configured root redirecting the read elsewhere. A
    /// missing root or catalogue surfaces as [`JoinError::Io`], matching prior
    /// behavior; only a path that exists but resolves outside the root is
    /// [`JoinError::Scope`].
    pub fn load(library_root: &Path) -> Result<Self, JoinError> {
        let path = library_root.join(SERATO_DIR).join(DATABASE_FILENAME);
        let path =
            crate::fs_scope::ensure_within_root(library_root, &path).map_err(|e| match e {
                crate::fs_scope::ScopeError::Io(io) => JoinError::Io(io),
                scope @ crate::fs_scope::ScopeError::OutsideRoot { .. } => JoinError::Scope(scope),
            })?;
        let bytes = std::fs::read(&path).map_err(JoinError::Io)?;
        Self::from_database_bytes(&bytes)
    }

    /// Decodes catalogue bytes into a path-keyed lookup table.
    ///
    /// Split out from [`load`](Self::load) so the decode is testable without a file on
    /// disk (and without ever committing real library data — Story 1.9 owns fixtures).
    ///
    /// A track record with no file path is skipped: the path *is* the join key, so such
    /// a record could never be resolved against a play, and keeping it would only
    /// inflate the table.
    pub fn from_database_bytes(bytes: &[u8]) -> Result<Self, JoinError> {
        let fields = database::parse(bytes).map_err(JoinError::Parse)?;

        let mut tracks = HashMap::new();
        for field in fields {
            let Field::Track(inner) = field else {
                // Crates, column layouts, the version header — nothing this join needs.
                continue;
            };

            let mut path: Option<PathBuf> = None;
            let mut track = LibraryTrack::default();
            // `tadd`'s epoch string, held back so the binary `uadd` (read as
            // `Field::DateAdded`) wins whenever both are present — they carry
            // the identical epoch on real data, but the u32 needs no parse.
            let mut tadd_fallback: Option<i64> = None;
            for inner_field in inner {
                match inner_field {
                    // An empty stored path is not a join key: keeping it would let a
                    // played track that also resolves to an empty path spuriously match.
                    Field::FilePath(p) if !p.as_os_str().is_empty() => path = Some(p),
                    // Stored as a decimal string, e.g. "128.00". An unparseable one is
                    // absent, never a guess and never a panic (AD-11).
                    Field::BPM(s) => track.bpm = s.parse::<f64>().ok().and_then(sane_bpm),
                    Field::Key(s) => track.key = non_empty(s),
                    Field::Genre(s) => track.genre = non_empty(s),
                    // Date-added (Story 3.7 §3d): `uadd` u32 epoch, `0` = never set.
                    Field::DateAdded(epoch) if epoch > 0 => {
                        track.date_added = Some(i64::from(epoch));
                    }
                    // `tadd` — the same epoch as a decimal string (verified on real
                    // data). Anything that is not a plain positive integer is
                    // absent, never a guessed date (AD-11).
                    Field::DateAddedStr(s) => {
                        tadd_fallback = s.trim().parse::<i64>().ok().filter(|t| *t > 0);
                    }
                    _ => {}
                }
            }
            if track.date_added.is_none() {
                track.date_added = tadd_fallback;
            }

            if let Some(path) = path {
                tracks.insert(path, track);
            }
        }

        Ok(Self { tracks })
    }

    /// How many catalogued tracks are indexed.
    pub fn len(&self) -> usize {
        self.tracks.len()
    }

    /// Whether the catalogue indexed no tracks at all.
    pub fn is_empty(&self) -> bool {
        self.tracks.is_empty()
    }

    /// Looks up one track, absorbing the absolute-vs-relative path mismatch (AC-3).
    ///
    /// `database V2` stores paths **root-relative with no leading `/`** (e.g.
    /// `Users/arjun/Music/x.mp3`), while a `.session` play log records the same track
    /// fully absolute (`/Users/arjun/Music/x.mp3`) — confirmed against two real library
    /// roots in Story 1.2 (findings §5/D4). A direct lookup by the absolute path
    /// therefore always misses. Both spellings are tried, absolute first, so a library
    /// that happens to store absolute paths still resolves.
    ///
    /// Comparison is on [`Path`] throughout: a filename is not guaranteed to be valid
    /// Unicode (findings §5/D2), so nothing here converts a path back to `&str`.
    fn get(&self, played_path: &Path) -> Option<&LibraryTrack> {
        if let Some(track) = self.tracks.get(played_path) {
            return Some(track);
        }
        let relative = played_path.strip_prefix(Path::new("/")).ok()?;
        self.tracks.get(relative)
    }

    /// The catalogue's date-added for one played path, via the same
    /// absolute/relative bridging as the full join — the narrow read
    /// [`super::date_added::DateAddedIndex`] needs (Story 3.7 §3d) without
    /// widening [`get`](Self::get) itself.
    pub(crate) fn date_added_for(&self, played_path: &Path) -> Option<i64> {
        self.get(played_path)?.date_added
    }
}

/// Resolves one played track against a loaded legacy library (AC-1, AC-3, AC-4).
///
/// A hit reports `in_library: true` plus whatever the catalogue actually holds — each
/// field independently possibly `None`. A miss, or a play with no path to join on at
/// all, reports the off-library default. Nothing on `play` is read beyond its path, and
/// nothing on it is modified: the play log's own inline `genre`/`key` come from a
/// different source, and reconciling the two is a later stage's decision.
///
/// **`total_length_ms` is not read here (Story 3.7 §3d, AC-42, code-review
/// disclosed gap).** The catalogue's `triseratops::Field::Length(String)`
/// (`len` tag) exists, but its on-disk string convention (seconds? `M:SS`?)
/// is not verified against a real `database V2` export the way `bpm`/`key`/
/// `tadd`/`uadd` were (Story 3.7's own verification pass, `serato-capture-
/// completeness.md`) — parsing it on a guess would risk exactly the
/// fabricated-value failure mode AD-11 exists to prevent. Left absent
/// (never guessed) until it can be verified; low priority given AC-42 already
/// scopes the legacy path to "sanity-check only, Arjun's library is serato4."
pub fn join(play: &Play, library: &LegacyLibrary) -> JoinedMetadata {
    // No path means no join key — no library can resolve this play, so don't look.
    let Some(path) = play.path.as_deref() else {
        return JoinedMetadata::default();
    };

    let Some(track) = library.get(Path::new(path)) else {
        return JoinedMetadata::default();
    };

    JoinedMetadata {
        in_library: true,
        bpm: track.bpm,
        key: track.key.clone(),
        genre: track.genre.clone(),
        library_added_at: track.date_added,
        ..JoinedMetadata::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // ---- Synthetic byte-fixture builders --------------------------------------
    //
    // A real `database V2` is the DJ's own library and is never committed (Story 1.9
    // owns golden fixtures). These helpers emit the confirmed on-disk field envelope:
    // 1-byte type + 3-byte name + 4-byte big-endian length + content, with text stored
    // as UTF-16BE code units.

    /// A field: `[type][name (3 bytes)][len][content]`.
    fn field(field_type: u8, name: &[u8; 3], content: &[u8]) -> Vec<u8> {
        let mut f = vec![field_type];
        f.extend_from_slice(name);
        f.extend_from_slice(&(content.len() as u32).to_be_bytes());
        f.extend_from_slice(content);
        f
    }

    /// UTF-16BE encoding, the catalogue's text representation.
    fn utf16be(s: &str) -> Vec<u8> {
        s.encode_utf16().flat_map(u16::to_be_bytes).collect()
    }

    fn text_field(name: &[u8; 3], value: &str) -> Vec<u8> {
        field(b't', name, &utf16be(value))
    }

    fn path_field(value: &str) -> Vec<u8> {
        field(b'p', b"fil", &utf16be(value))
    }

    /// An `otrk` container holding one track's fields.
    fn track_record(fields: &[Vec<u8>]) -> Vec<u8> {
        field(b'o', b"trk", &fields.concat())
    }

    /// The version header every real catalogue opens with, which the walk must ignore.
    fn version_header() -> Vec<u8> {
        let content = utf16be("2.0/Serato Scratch LIVE Database");
        let mut f = Vec::from(*b"vrsn");
        f.extend_from_slice(&(content.len() as u32).to_be_bytes());
        f.extend_from_slice(&content);
        f
    }

    /// A fully-populated track record.
    fn full_track(path: &str, bpm: &str, key: &str, genre: &str) -> Vec<u8> {
        track_record(&[
            path_field(path),
            text_field(b"sng", "Some Title"),
            text_field(b"bpm", bpm),
            text_field(b"key", key),
            text_field(b"gen", genre),
        ])
    }

    /// A [`Play`] carrying only what the join reads — its path.
    fn play_at(path: &str) -> Play {
        Play {
            path: Some(path.to_string()),
            ..Play::default()
        }
    }

    fn library_from(records: &[Vec<u8>]) -> LegacyLibrary {
        let mut bytes = version_header();
        for record in records {
            bytes.extend_from_slice(record);
        }
        LegacyLibrary::from_database_bytes(&bytes).expect("synthetic catalogue decodes")
    }

    // ---- Tests ----------------------------------------------------------------

    /// AC-1: an in-library track resolves BPM, key, and genre from the catalogue —
    /// BPM included, which is the field `triseratops`' own `Track` type would drop.
    #[test]
    fn in_library_track_resolves_bpm_key_and_genre() {
        let library = library_from(&[full_track(
            "Users/arjun/Music/a.mp3",
            "128.00",
            "1A",
            "Deep House",
        )]);

        let joined = join(&play_at("/Users/arjun/Music/a.mp3"), &library);

        assert_eq!(
            joined,
            JoinedMetadata {
                in_library: true,
                bpm: Some(128.0),
                key: Some("1A".to_string()),
                genre: Some("Deep House".to_string()),
                ..JoinedMetadata::default()
            }
        );
    }

    /// Story 3.7 (§3d): the catalogue's `uadd` (u32 epoch) date-added resolves
    /// onto the join, and the binary form wins over the `tadd` string when both
    /// are present (they carry the identical epoch on real data — the u32 just
    /// needs no parse).
    #[test]
    fn date_added_resolves_from_uadd_preferring_it_over_tadd() {
        let library = library_from(&[track_record(&[
            path_field("Users/arjun/Music/dated.mp3"),
            field(b'u', b"add", &1_644_628_114u32.to_be_bytes()),
            text_field(b"add", "1_600_000_000 (not this one)"),
        ])]);

        let joined = join(&play_at("/Users/arjun/Music/dated.mp3"), &library);

        assert_eq!(joined.library_added_at, Some(1_644_628_114));
    }

    /// Story 3.7 (§3d): with only the `tadd` string present, its plain epoch
    /// number parses; a non-numeric `tadd` is absent, never a guessed date.
    #[test]
    fn date_added_falls_back_to_a_numeric_tadd_string() {
        let library = library_from(&[
            track_record(&[
                path_field("Users/arjun/Music/tadd-only.mp3"),
                text_field(b"add", "1644628114"),
            ]),
            track_record(&[
                path_field("Users/arjun/Music/garbage-tadd.mp3"),
                text_field(b"add", "June 10th 2021"),
            ]),
        ]);

        assert_eq!(
            join(&play_at("/Users/arjun/Music/tadd-only.mp3"), &library).library_added_at,
            Some(1_644_628_114)
        );
        assert_eq!(
            join(&play_at("/Users/arjun/Music/garbage-tadd.mp3"), &library).library_added_at,
            None,
            "a non-epoch tadd must not become a fabricated date"
        );
    }

    /// AC-4: an in-library track missing one field reports that field absent and still
    /// resolves the rest — the `None` is what routes it to Story 1.5's fallback.
    #[test]
    fn in_library_track_missing_a_field_reports_it_absent() {
        let library = library_from(&[track_record(&[
            path_field("Users/arjun/Music/no-bpm.mp3"),
            text_field(b"key", "8B"),
            text_field(b"gen", "Techno"),
        ])]);

        let joined = join(&play_at("/Users/arjun/Music/no-bpm.mp3"), &library);

        assert_eq!(
            joined,
            JoinedMetadata {
                in_library: true,
                bpm: None,
                key: Some("8B".to_string()),
                genre: Some("Techno".to_string()),
                ..JoinedMetadata::default()
            },
            "a gap in one column must not cost the track its other fields, or its membership"
        );
    }

    /// AC-4: a field stored as an empty string is absent, not a resolved blank value —
    /// otherwise `Some("")` would look like an answer and block the fallback.
    #[test]
    fn empty_string_field_is_absent_not_blank() {
        let library = library_from(&[full_track("Users/arjun/Music/blank.mp3", "124.5", "", "")]);

        let joined = join(&play_at("/Users/arjun/Music/blank.mp3"), &library);

        assert_eq!(joined.key, None);
        assert_eq!(joined.genre, None);
        assert_eq!(
            joined.bpm,
            Some(124.5),
            "the populated field still resolves"
        );
    }

    /// A play whose path is nowhere in the catalogue is off-library: no membership, no
    /// fields — the shape Story 1.5's embedded-tag fallback acts on.
    #[test]
    fn off_library_play_resolves_nothing() {
        let library = library_from(&[full_track(
            "Users/arjun/Music/a.mp3",
            "128.00",
            "1A",
            "House",
        )]);

        let joined = join(&play_at("/Users/arjun/Downloads/never-added.mp3"), &library);

        assert_eq!(joined, JoinedMetadata::default());
    }

    /// AC-3: the catalogue stores paths root-relative while the play log records them
    /// absolute — the join must bridge that, or every in-library track looks off-library.
    #[test]
    fn absolute_play_path_resolves_against_root_relative_library_path() {
        let library = library_from(&[full_track(
            "Volumes/ARJUN SSD/Theo Indian/track.wav",
            "96.00",
            "5A",
            "Bollywood",
        )]);

        let joined = join(
            &play_at("/Volumes/ARJUN SSD/Theo Indian/track.wav"),
            &library,
        );

        assert!(joined.in_library, "leading-slash mismatch must not miss");
        assert_eq!(joined.bpm, Some(96.0));
        assert_eq!(joined.key.as_deref(), Some("5A"));
    }

    /// AC-3: a catalogue that stores the absolute spelling resolves too — the absolute
    /// lookup is tried first, so neither convention depends on the other failing.
    #[test]
    fn absolute_library_path_resolves_directly() {
        let library = library_from(&[full_track(
            "/Users/arjun/Music/absolute.mp3",
            "140.00",
            "11A",
            "Drum & Bass",
        )]);

        let joined = join(&play_at("/Users/arjun/Music/absolute.mp3"), &library);

        assert!(joined.in_library);
        assert_eq!(joined.bpm, Some(140.0));
    }

    /// AD-11: an unparseable BPM is absent, never a fabricated number and never a panic.
    /// The track is still in-library, and its other fields still resolve.
    #[test]
    fn unparseable_bpm_is_absent_not_invented() {
        let library = library_from(&[full_track(
            "Users/arjun/Music/weird.mp3",
            "not a number",
            "3A",
            "Disco",
        )]);

        let joined = join(&play_at("/Users/arjun/Music/weird.mp3"), &library);

        assert_eq!(joined.bpm, None, "a garbage BPM must not become a value");
        assert!(joined.in_library);
        assert_eq!(joined.key.as_deref(), Some("3A"));
    }

    /// A zero BPM is Serato's "not analysed", not a real measurement — letting it
    /// through would drag every tempo average the stat engine computes (Story 1.7).
    #[test]
    fn zero_bpm_is_treated_as_unanalysed() {
        let library = library_from(&[
            full_track("Users/arjun/Music/unanalysed.mp3", "0.00", "2A", "Ambient"),
            full_track("Users/arjun/Music/negative.mp3", "-5", "2A", "Ambient"),
        ]);

        assert_eq!(
            join(&play_at("/Users/arjun/Music/unanalysed.mp3"), &library).bpm,
            None
        );
        assert_eq!(
            join(&play_at("/Users/arjun/Music/negative.mp3"), &library).bpm,
            None
        );
    }

    /// A play with no path can never resolve against any library, and must not be
    /// reported as in-library on the strength of an empty lookup.
    #[test]
    fn play_without_a_path_is_off_library() {
        let library = library_from(&[full_track(
            "Users/arjun/Music/a.mp3",
            "128.00",
            "1A",
            "House",
        )]);

        let joined = join(&Play::default(), &library);

        assert_eq!(joined, JoinedMetadata::default());
    }

    /// A track record with no file path has no join key, so it is not indexed — it
    /// could never be resolved and would only inflate the table.
    #[test]
    fn track_record_without_a_path_is_not_indexed() {
        let library = library_from(&[
            track_record(&[text_field(b"bpm", "120.00"), text_field(b"gen", "House")]),
            full_track("Users/arjun/Music/a.mp3", "128.00", "1A", "House"),
        ]);

        assert_eq!(library.len(), 1);
        assert!(!library.is_empty());
    }

    /// A track record whose file path is present but empty has no usable join key
    /// either — indexing it under `""` would let a played track that also resolves
    /// to an empty path spuriously match.
    #[test]
    fn track_record_with_an_empty_path_is_not_indexed() {
        let library = library_from(&[
            full_track("", "120.00", "1A", "House"),
            full_track("Users/arjun/Music/a.mp3", "128.00", "1A", "House"),
        ]);

        assert_eq!(
            library.len(),
            1,
            "the empty-path record must not be indexed"
        );
    }

    /// A catalogue holding two records for the same path keeps the later one. Serato
    /// libraries do accumulate duplicate entries, and the path is the only join key
    /// there is, so one of them has to win. Pinned as a decision rather than left as an
    /// accident of `HashMap::insert`: last-wins, matching file order.
    ///
    /// **[ASSUMPTION]** Last-wins is believed correct because it should match the
    /// catalogue's own append order, so a re-analysed track's newer BPM would beat a
    /// stale row rather than being shadowed by it — but unlike this module's other two
    /// path-resolution assumptions (see `deferred-work.md`), this one has no Story 1.2
    /// findings citation behind it. Confirm against a real catalogue with a genuinely
    /// re-analysed duplicate during Story 1.9's fixture work, alongside the other two.
    #[test]
    fn duplicate_paths_resolve_to_the_last_record() {
        let library = library_from(&[
            full_track("Users/arjun/Music/dupe.mp3", "120.00", "1A", "Stale"),
            full_track("Users/arjun/Music/dupe.mp3", "128.00", "8B", "Fresh"),
        ]);

        let joined = join(&play_at("/Users/arjun/Music/dupe.mp3"), &library);

        assert_eq!(library.len(), 1, "one path is one entry, not two");
        assert_eq!(joined.bpm, Some(128.0));
        assert_eq!(joined.genre.as_deref(), Some("Fresh"));
    }

    /// Loading is read-only and file-backed: the catalogue is found under
    /// `_Serato_/database V2`, and the file is left byte-for-byte untouched (Serato
    /// itself may have it open).
    #[test]
    fn load_reads_the_serato_path_without_mutating_it() {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "curfew_joiner_test_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let serato_dir = root.join(SERATO_DIR);
        std::fs::create_dir_all(&serato_dir).expect("temp library dir");

        let mut bytes = version_header();
        bytes.extend_from_slice(&full_track(
            "Users/arjun/Music/a.mp3",
            "128.00",
            "1A",
            "House",
        ));
        let db_path = serato_dir.join(DATABASE_FILENAME);
        std::fs::write(&db_path, &bytes).expect("temp catalogue write");

        let library = LegacyLibrary::load(&root).expect("catalogue at the Serato path loads");
        let after = std::fs::read(&db_path).expect("catalogue re-read");
        let _ = std::fs::remove_dir_all(&root);

        assert_eq!(library.len(), 1);
        assert!(join(&play_at("/Users/arjun/Music/a.mp3"), &library).in_library);
        assert_eq!(after, bytes, "catalogue bytes unchanged by loading it");
    }

    /// A missing catalogue surfaces as `JoinError::Io` — the common case of a Serato 4+
    /// DJ with no legacy library at all, and never a panic.
    #[test]
    fn missing_catalogue_maps_to_io_error() {
        let root = std::env::temp_dir().join("curfew_joiner_definitely_missing_4c1a");
        let _ = std::fs::remove_dir_all(&root);

        assert!(matches!(LegacyLibrary::load(&root), Err(JoinError::Io(_))));
    }

    /// Story 2.7 AC-1: a `_Serato_` folder replaced with a symlink pointing
    /// outside `library_root` must not be followed — `load` refuses it as a
    /// scope violation rather than silently reading whatever the symlink
    /// points to.
    #[cfg(unix)]
    #[test]
    fn load_refuses_a_serato_dir_symlinked_outside_the_root() {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "curfew_joiner_scope_root_{}_{}",
            std::process::id(),
            n
        ));
        let outside = std::env::temp_dir().join(format!(
            "curfew_joiner_scope_outside_{}_{}",
            std::process::id(),
            n
        ));
        let outside_serato = outside.join(SERATO_DIR);
        std::fs::create_dir_all(&outside_serato).expect("outside dir creates");
        std::fs::write(outside_serato.join(DATABASE_FILENAME), version_header())
            .expect("outside catalogue writes");

        std::fs::create_dir_all(&root).expect("root dir creates");
        std::os::unix::fs::symlink(&outside_serato, root.join(SERATO_DIR))
            .expect("symlink creates");

        let result = LegacyLibrary::load(&root);
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&outside);

        assert!(
            matches!(result, Err(JoinError::Scope(_))),
            "a symlinked-outside Serato dir must be refused, got {result:?}"
        );
    }

    /// A corrupt catalogue is a reported error, not a panic and not a silently empty
    /// library that would make every played track look off-library.
    #[test]
    fn malformed_catalogue_maps_to_parse_error() {
        let mut bytes = version_header();
        // A field claiming far more content than follows.
        bytes.extend_from_slice(b"otrk");
        bytes.extend_from_slice(&9_000u32.to_be_bytes());
        bytes.extend_from_slice(&[0u8; 4]);

        assert!(matches!(
            LegacyLibrary::from_database_bytes(&bytes),
            Err(JoinError::Parse(_))
        ));
    }
}
