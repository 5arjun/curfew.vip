//! Off-library embedded-tag fallback (Story 1.5, AC-1/AC-2/AC-3).
//!
//! [`legacy::join`](super::legacy::join) and [`serato4::join_session`](super::serato4::join_session)
//! resolve BPM/key/genre from the DJ's Serato library. A track that is off-library
//! entirely, or in-library with a gap in one column, leaves the corresponding
//! [`JoinedMetadata`] field `None`. This module is the next fallback step AD-11
//! defines: read the same three fields straight from the *played file's own*
//! embedded tag, if one is present and decodable.
//!
//! Two tag carriers, dispatched by sniffing the file's actual content (not its
//! extension):
//! - **ID3** (MP3/WAV/AIFF, via the [`id3`] crate) — key from `TKEY`, genre from
//!   `TCON`, BPM from a Serato Autotags `GEOB` frame.
//! - **Vorbis comments** (FLAC/OGG Vorbis, via [`lofty`]) — key and genre from raw
//!   comment fields; BPM only for FLAC, from a `SERATO_AUTOGAIN` comment field. OGG
//!   Vorbis BPM is out of scope: the pinned `triseratops` commit has no `OggTag`
//!   impl for `Autotags` (see [`triseratops::tag::Autotags`]'s trait-impl list), so
//!   there is nothing to decode it with.
//!
//! **Infallible by design.** Unlike [`legacy::JoinError`](super::legacy::JoinError),
//! this module never returns a `Result`. A missing file, an unsupported format, a
//! malformed tag, or a permission error all resolve the same way: no data from this
//! source. That is exactly the "absent, never guessed" outcome AD-11 already defines
//! for a gap in the library join — off-library reads are not the DJ's *one* library
//! file, where a permission error is UI-actionable, but an arbitrary, possibly
//! unreadable file per played track.
//!
//! MP4/M4A is deliberately not implemented here even though `triseratops::Autotags`
//! has an `MP4Tag` impl — AC-1 names only ID3 and Vorbis comments; MP4 support would
//! be a new story's scope, not silent creep on this one.

use triseratops::tag::format::flac::FLACTag;
use triseratops::tag::format::id3::ID3Tag;
use triseratops::tag::Autotags;

use super::{non_empty, sane_bpm, JoinedMetadata};

/// The Vorbis-comment field assumed to hold musical key.
///
/// **[ASSUMPTION]** Vorbis comments have no ratified standard field for key (unlike
/// `GENRE`), and no real FLAC/OGG file has ever been inspected in this project. This
/// is the confirmed-plausible default, not yet checked against a real file — see the
/// story's Open Questions.
const VORBIS_KEY_FIELD: &str = "KEY";
const VORBIS_GENRE_FIELD: &str = "GENRE";

/// Calls into the pinned `triseratops` dependency's Autotags parser, treating a
/// panic the same as a parse `Err`: no data, not a crash.
///
/// `take_autotags` (the pinned commit's `src/tag/autotags.rs`) calls
/// `take_version(input).unwrap()`, which panics on any input under 2 bytes (its own
/// test confirms `take_version(&[0x0A])` errors). Both `Autotags::parse_id3` and
/// `Autotags::parse_flac` funnel through it, so a truncated or malformed GEOB/
/// Vorbis-comment payload — entirely plausible for an arbitrary off-library file —
/// can panic rather than return `Err`. `.ok()` alone can't catch that; this module's
/// "infallible by design" contract needs `catch_unwind` at this one boundary, since
/// the panic originates inside a pinned dependency this story doesn't own.
fn parse_autotags_safely(
    parse: impl FnOnce() -> Result<Autotags, triseratops::error::Error> + std::panic::UnwindSafe,
) -> Option<Autotags> {
    std::panic::catch_unwind(parse).ok().and_then(Result::ok)
}

/// Fills any `None` field on `metadata` from the played track's own embedded file
/// tag, using `path` (the play's file path) to locate it.
///
/// Never touches [`in_library`](JoinedMetadata::in_library) — that flag describes
/// library membership (Story 1.4's concern), not field completeness. Only `bpm`,
/// `key`, and `genre` are ever changed here, and only when they arrive `None`: a
/// value the library already resolved is never overwritten, even if the embedded tag
/// disagrees with it.
///
/// Skips all file I/O when there is nothing to gain from it: if every field is
/// already `Some`, or `path` is `None` (an off-library play with no path, exactly
/// like [`legacy::join`](super::legacy::join)'s own short-circuit), `metadata` is
/// returned unchanged without opening anything.
pub fn fill_gaps(metadata: JoinedMetadata, path: Option<&str>) -> JoinedMetadata {
    if metadata.bpm.is_some() && metadata.key.is_some() && metadata.genre.is_some() {
        return metadata;
    }
    let Some(path) = path else {
        return metadata;
    };

    let embedded = read_embedded_tags(path);

    JoinedMetadata {
        in_library: metadata.in_library,
        bpm: metadata.bpm.or(embedded.bpm),
        key: metadata.key.or(embedded.key),
        genre: metadata.genre.or(embedded.genre),
    }
}

/// The three fields this module can pull from one embedded file tag.
#[derive(Debug, Clone, Default, PartialEq)]
struct EmbeddedFields {
    bpm: Option<f64>,
    key: Option<String>,
    genre: Option<String>,
}

/// Opens `path`, sniffs its actual format (content, not extension), and reads
/// whichever embedded-tag source applies. Any failure at any stage — the file
/// doesn't exist, the format isn't one of the four supported, the tag is malformed —
/// resolves to [`EmbeddedFields::default`], matching this module's infallible
/// contract.
fn read_embedded_tags(path: &str) -> EmbeddedFields {
    use lofty::config::ParseOptions;
    use lofty::file::{AudioFile, FileType};

    let Ok(probe) = lofty::probe::Probe::open(path) else {
        return EmbeddedFields::default();
    };
    let Ok(probe) = probe.guess_file_type() else {
        return EmbeddedFields::default();
    };

    match probe.file_type() {
        Some(FileType::Mpeg | FileType::Aiff | FileType::Wav) => read_id3_tags(path),
        Some(FileType::Flac) => {
            let mut reader = probe.into_inner();
            let Ok(flac) = lofty::flac::FlacFile::read_from(&mut reader, ParseOptions::default())
            else {
                return EmbeddedFields::default();
            };
            let Some(comments) = flac.vorbis_comments() else {
                return EmbeddedFields::default();
            };

            let mut fields = extract_vorbis_fields(comments);
            fields.bpm = comments
                .get(Autotags::FLAC_COMMENT)
                .and_then(|value| parse_autotags_safely(|| Autotags::parse_flac(value.as_bytes())))
                .and_then(|autotags| sane_bpm(autotags.bpm));
            fields
        }
        Some(FileType::Vorbis) => {
            let mut reader = probe.into_inner();
            let Ok(vorbis) =
                lofty::ogg::VorbisFile::read_from(&mut reader, ParseOptions::default())
            else {
                return EmbeddedFields::default();
            };
            // OGG Vorbis BPM is explicitly out of scope (module docs): `Autotags` has
            // no `OggTag` impl in the pinned `triseratops` commit, so `bpm` stays
            // `None` here unconditionally.
            extract_vorbis_fields(vorbis.vorbis_comments())
        }
        _ => EmbeddedFields::default(),
    }
}

/// Reads an ID3 tag (MP3/WAV/AIFF) from `path`. A missing file, a file with no ID3
/// tag, or any other `id3` error all resolve to "no data" — see the module docs.
fn read_id3_tags(path: &str) -> EmbeddedFields {
    let Ok(tag) = id3::Tag::read_from_path(path) else {
        return EmbeddedFields::default();
    };
    extract_id3_fields(&tag)
}

/// Pure field extraction over an already-parsed ID3 tag — split out from
/// [`read_id3_tags`] so this logic is testable without touching a real filesystem
/// path, mirroring [`legacy::LegacyLibrary::from_database_bytes`](super::legacy::LegacyLibrary::from_database_bytes)'s
/// IO-vs-pure split.
fn extract_id3_fields(tag: &id3::Tag) -> EmbeddedFields {
    use id3::TagLike;

    // TKEY: no dedicated helper on `TagLike`, unlike genre — read the raw frame text.
    let key = tag
        .get("TKEY")
        .and_then(|frame| frame.content().text())
        .map(|value| value.to_string())
        .and_then(non_empty);

    // TCON, raw: `.genre()` not `.genre_parsed()` — interpreting a legacy numeric
    // ID3v1 genre reference is Story 1.6's job, not this one's.
    let genre = tag
        .genre()
        .map(|value| value.to_string())
        .and_then(non_empty);

    // BPM: the Serato Autotags GEOB frame, identified by its description matching
    // the constant (never the hardcoded literal, in case a future `triseratops`
    // update changes it). A raw binary read, not base64 — `parse_id3` is a direct
    // pass-through to `Autotags::parse`.
    let bpm = tag
        .encapsulated_objects()
        .find(|object| object.description == Autotags::ID3_TAG)
        .and_then(|object| parse_autotags_safely(|| Autotags::parse_id3(&object.data)))
        .and_then(|autotags| sane_bpm(autotags.bpm));

    EmbeddedFields { bpm, key, genre }
}

/// Pure field extraction over already-parsed Vorbis comments — split out from
/// [`read_embedded_tags`] for the same testability reason as [`extract_id3_fields`].
/// Reads raw comment fields directly, never `lofty`'s cross-format `ItemKey`/generic
/// `Tag` translation layer, matching this module's "raw values only" convention.
/// BPM is never set here — the FLAC-only Autotags decode lives in
/// [`read_embedded_tags`], since the field it reads from (`SERATO_AUTOGAIN`) is
/// FLAC-specific, not a general Vorbis-comment convention.
fn extract_vorbis_fields(comments: &lofty::ogg::VorbisComments) -> EmbeddedFields {
    EmbeddedFields {
        bpm: None,
        key: comments
            .get(VORBIS_KEY_FIELD)
            .map(|value| value.to_string())
            .and_then(non_empty),
        genre: comments
            .get(VORBIS_GENRE_FIELD)
            .map(|value| value.to_string())
            .and_then(non_empty),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- ID3 fixtures (pure-logic tests, no filesystem) -----------------------

    fn geob_frame(description: &str, data: Vec<u8>) -> id3::Frame {
        id3::frame::EncapsulatedObject {
            mime_type: "application/octet-stream".to_string(),
            filename: String::new(),
            description: description.to_string(),
            data,
        }
        .into()
    }

    /// A valid Serato Autotags GEOB payload, built via `triseratops`' own writer —
    /// a round-trip fixture, not hand-rolled bytes.
    fn autotags_id3_bytes(bpm: f64) -> Vec<u8> {
        let autotags = Autotags {
            version: triseratops::tag::generic::Version { major: 1, minor: 1 },
            bpm,
            auto_gain: 0.0,
            gain_db: 0.0,
        };
        let mut buf = Vec::new();
        autotags.write_id3(&mut buf).expect("autotags encode");
        buf
    }

    /// AC-1: all three fields present and resolvable.
    #[test]
    fn id3_all_fields_present_resolve() {
        use id3::TagLike;

        let mut tag = id3::Tag::new();
        tag.add_frame(id3::Frame::text("TKEY", "8A"));
        tag.set_genre("Deep House");
        tag.add_frame(geob_frame(Autotags::ID3_TAG, autotags_id3_bytes(128.0)));

        let fields = extract_id3_fields(&tag);

        assert_eq!(fields.key.as_deref(), Some("8A"));
        assert_eq!(fields.genre.as_deref(), Some("Deep House"));
        assert_eq!(fields.bpm, Some(128.0));
    }

    /// TKEY/TCON absent: `key`/`genre` stay `None`, no panic.
    #[test]
    fn id3_missing_key_and_genre_frames_are_none() {
        let tag = id3::Tag::new();

        let fields = extract_id3_fields(&tag);

        assert_eq!(fields.key, None);
        assert_eq!(fields.genre, None);
    }

    /// No GEOB frame at all: `bpm` stays `None`.
    #[test]
    fn id3_no_geob_frame_bpm_is_none() {
        use id3::TagLike;

        let mut tag = id3::Tag::new();
        tag.add_frame(id3::Frame::text("TKEY", "8A"));

        let fields = extract_id3_fields(&tag);

        assert_eq!(fields.bpm, None);
    }

    /// A GEOB frame present but under a different description is ignored.
    #[test]
    fn id3_geob_with_wrong_description_is_ignored() {
        use id3::TagLike;

        let mut tag = id3::Tag::new();
        tag.add_frame(geob_frame("Some Other Tag", autotags_id3_bytes(128.0)));

        let fields = extract_id3_fields(&tag);

        assert_eq!(fields.bpm, None);
    }

    /// A GEOB frame matching the Serato Autotags description but with under 2 bytes
    /// of data must not panic — the pinned `triseratops` commit's `take_autotags`
    /// calls `take_version(input).unwrap()`, which errors (and would panic without
    /// `parse_autotags_safely`'s `catch_unwind`) on exactly this input shape.
    #[test]
    fn id3_geob_with_truncated_payload_is_no_data_not_panic() {
        use id3::TagLike;

        let mut tag = id3::Tag::new();
        tag.add_frame(geob_frame(Autotags::ID3_TAG, vec![0x01]));

        let fields = extract_id3_fields(&tag);

        assert_eq!(fields.bpm, None);
    }

    /// A legacy numeric TCON value is stored as-is, unparsed — proves the
    /// "raw, not `.genre_parsed()`" decision.
    #[test]
    fn id3_legacy_numeric_genre_is_stored_raw() {
        use id3::TagLike;

        let mut tag = id3::Tag::new();
        tag.set_genre("(17)");

        let fields = extract_id3_fields(&tag);

        assert_eq!(fields.genre.as_deref(), Some("(17)"));
    }

    /// A path that doesn't exist at all: all three fields `None`, no panic.
    /// `id3::Tag::read_from_path` resolves this to an IO `Err`, which `read_id3_tags`
    /// maps to "no data" like every other `id3` error — distinct from the
    /// `ErrorKind::NoTag` case below (an existing file that simply has no tag).
    #[test]
    fn read_id3_tags_missing_file_is_no_data() {
        let fields = read_id3_tags("/definitely/does/not/exist/curfew_1_5_test.mp3");

        assert_eq!(fields, EmbeddedFields::default());
    }

    /// An existing, readable file with no ID3 tag at all: all three fields `None`,
    /// no panic. This is Task 5(f)'s literal scenario — `id3::Tag::read_from_path`
    /// resolves a tag-less file to `ErrorKind::NoTag`, which `read_id3_tags` maps to
    /// "no data" the same as every other `id3` error, distinct from the
    /// missing-path/IO-error case above.
    #[test]
    fn read_id3_tags_tagless_file_is_no_data() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "curfew_embedded_tags_notag_test_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::write(&path, b"not an id3 tag, just plain bytes").expect("temp fixture write");

        let fields = read_id3_tags(path.to_str().expect("temp path is UTF-8"));
        let _ = std::fs::remove_file(&path);

        assert_eq!(fields, EmbeddedFields::default());
    }

    // ---- Vorbis-comment fixtures (pure-logic tests, no filesystem) ------------

    fn vorbis_comments(fields: &[(&str, &str)]) -> lofty::ogg::VorbisComments {
        let mut comments = lofty::ogg::VorbisComments::new();
        for (key, value) in fields {
            comments.push((*key).to_string(), (*value).to_string());
        }
        comments
    }

    /// GENRE/KEY/SERATO_AUTOGAIN all present: genre and key resolve here; BPM
    /// resolution is FLAC-path-specific and covered separately in
    /// `read_embedded_tags`'s FLAC branch, not this pure function.
    #[test]
    fn vorbis_genre_and_key_resolve() {
        let comments = vorbis_comments(&[("GENRE", "Techno"), ("KEY", "5A")]);

        let fields = extract_vorbis_fields(&comments);

        assert_eq!(fields.genre.as_deref(), Some("Techno"));
        assert_eq!(fields.key.as_deref(), Some("5A"));
        assert_eq!(fields.bpm, None, "extract_vorbis_fields never sets bpm");
    }

    /// SERATO_AUTOGAIN absent has no bearing on `extract_vorbis_fields` (bpm is
    /// always `None` from this function) — documented so the FLAC-only bpm path
    /// isn't mistaken for something this pure function does.
    #[test]
    fn vorbis_fields_without_autogain_have_no_bpm() {
        let comments = vorbis_comments(&[("GENRE", "Techno")]);

        let fields = extract_vorbis_fields(&comments);

        assert_eq!(fields.bpm, None);
    }

    /// Empty-string GENRE/KEY are absent via `non_empty`, not `Some("")`.
    #[test]
    fn vorbis_empty_fields_are_none() {
        let comments = vorbis_comments(&[("GENRE", ""), ("KEY", "")]);

        let fields = extract_vorbis_fields(&comments);

        assert_eq!(fields.genre, None);
        assert_eq!(fields.key, None);
    }

    /// A FLAC file's `SERATO_AUTOGAIN` Vorbis-comment field decodes via
    /// `Autotags::parse_flac`, which base64+envelope-decodes internally — this
    /// exercises exactly that decode, matching what `read_embedded_tags`'s FLAC
    /// branch does with the raw field's bytes.
    #[test]
    fn flac_autogain_field_decodes_bpm() {
        let autotags = Autotags {
            version: triseratops::tag::generic::Version { major: 1, minor: 1 },
            bpm: 140.0,
            auto_gain: 0.0,
            gain_db: 0.0,
        };
        let mut encoded = Vec::new();
        autotags.write_flac(&mut encoded).expect("flac encode");
        let encoded = String::from_utf8(encoded).expect("flac envelope is ASCII/base64");

        let comments = vorbis_comments(&[(Autotags::FLAC_COMMENT, &encoded)]);

        let decoded = Autotags::parse_flac(
            comments
                .get(Autotags::FLAC_COMMENT)
                .expect("field present")
                .as_bytes(),
        )
        .expect("valid enveloped Autotags");

        assert_eq!(decoded.bpm, 140.0);
    }

    // `lofty` 0.24.0 has no from-scratch *writer* for a FLAC/OGG container
    // (`VorbisComments::save_to`/`dump_to` only patch metadata into an existing
    // valid audio stream), so the FLAC dispatch test below hand-builds minimal
    // container bytes directly instead — the same approach the ID3 dispatch test
    // takes with a hand-built MPEG frame sync, and the only way to drive
    // `read_embedded_tags`'s `FileType::Flac` match arm through real content
    // sniffing rather than calling `extract_vorbis_fields`/`Autotags::parse_flac`
    // directly. OGG Vorbis dispatch is left uncovered by a real-file test: unlike
    // FLAC's flat metadata-block layout, Ogg's page framing (CRC32-checksummed
    // pages) is real container-format work disproportionate to a one-line
    // `extract_vorbis_fields` reuse — the same "don't over-invest" call this
    // story's own Task 5 guidance already makes for the thin IO-path test.

    // ---- Content-sniffing dispatch (real temp file, `read_embedded_tags`) -----

    /// A no-extension file is still routed to the ID3 path by content, not by name —
    /// `lofty::probe::Probe::guess_file_type` sniffs the ID3v2 header plus a
    /// following MPEG frame sync, exactly the "probe-based dispatch, not a naive
    /// extension-string match" this story's tests require. Exercises the full
    /// `read_embedded_tags` IO wrapper, not just the pure extraction function.
    #[test]
    fn read_embedded_tags_routes_a_no_extension_file_by_content() {
        use id3::TagLike;
        use std::sync::atomic::{AtomicUsize, Ordering};

        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "curfew_embedded_tags_test_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));

        let mut tag = id3::Tag::new();
        tag.add_frame(id3::Frame::text("TKEY", "3A"));
        tag.set_genre("Techno");
        tag.add_frame(geob_frame(Autotags::ID3_TAG, autotags_id3_bytes(132.0)));

        let mut bytes = Vec::new();
        tag.write_to(&mut bytes, id3::Version::Id3v24)
            .expect("id3 tag encodes");
        // A minimal MPEG frame sync (confirmed against lofty's own
        // `search_for_frame_sync`/`quick_type_guess` test fixtures) so content
        // sniffing resolves this to `FileType::Mpeg` with nothing after the ID3
        // block — no real audio data needed for dispatch, only for playback.
        bytes.extend_from_slice(&[0xFF, 0xFB, 0x00, 0x00]);
        std::fs::write(&path, &bytes).expect("temp fixture write");

        let fields = read_embedded_tags(path.to_str().expect("temp path is UTF-8"));
        let _ = std::fs::remove_file(&path);

        assert_eq!(fields.key.as_deref(), Some("3A"));
        assert_eq!(fields.genre.as_deref(), Some("Techno"));
        assert_eq!(fields.bpm, Some(132.0));
    }

    /// Builds a minimal, spec-valid FLAC file byte-for-byte: the `fLaC` marker, a
    /// mandatory STREAMINFO block (lofty only requires its length be `>= 18` bytes;
    /// content is irrelevant to tag reading), and one VORBIS_COMMENT block carrying
    /// `fields` in the standard `u32-LE-length-prefixed "KEY=VALUE"` layout `lofty`'s
    /// own reader expects.
    fn minimal_flac_bytes(fields: &[(&str, &str)]) -> Vec<u8> {
        let mut comment_block = Vec::new();
        let vendor = b"curfew-test";
        comment_block.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        comment_block.extend_from_slice(vendor);
        comment_block.extend_from_slice(&(fields.len() as u32).to_le_bytes());
        for (key, value) in fields {
            let entry = format!("{key}={value}");
            comment_block.extend_from_slice(&(entry.len() as u32).to_le_bytes());
            comment_block.extend_from_slice(entry.as_bytes());
        }

        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"fLaC");
        // STREAMINFO block header: not last, 34-byte zeroed content (the
        // spec-mandated minimum size for this block).
        bytes.push(0x00);
        bytes.extend_from_slice(&34u32.to_be_bytes()[1..]);
        bytes.extend_from_slice(&[0u8; 34]);
        // VORBIS_COMMENT block header (type 4), marked as the last metadata block.
        bytes.push(0x80 | 0x04);
        let comment_len = comment_block.len() as u32;
        bytes.extend_from_slice(&comment_len.to_be_bytes()[1..]);
        bytes.extend_from_slice(&comment_block);
        bytes
    }

    /// A FLAC file is routed to the Vorbis-comment path by content (the `fLaC`
    /// marker, on a no-extension file), and its `SERATO_AUTOGAIN` field decodes
    /// through the real `read_embedded_tags` dispatch — not just the pure
    /// `extract_vorbis_fields`/`Autotags::parse_flac` calls `flac_autogain_field_decodes_bpm`
    /// exercises directly. This is the FLAC-branch counterpart to the ID3 dispatch
    /// test above.
    #[test]
    fn read_embedded_tags_routes_a_flac_file_by_content_and_decodes_autogain() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "curfew_embedded_tags_flac_test_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));

        let autotags = Autotags {
            version: triseratops::tag::generic::Version { major: 1, minor: 1 },
            bpm: 140.0,
            auto_gain: 0.0,
            gain_db: 0.0,
        };
        let mut encoded = Vec::new();
        autotags.write_flac(&mut encoded).expect("flac encode");
        let encoded = String::from_utf8(encoded).expect("flac envelope is ASCII/base64");

        let bytes = minimal_flac_bytes(&[
            ("GENRE", "Techno"),
            ("KEY", "5A"),
            (Autotags::FLAC_COMMENT, &encoded),
        ]);
        std::fs::write(&path, &bytes).expect("temp fixture write");

        let fields = read_embedded_tags(path.to_str().expect("temp path is UTF-8"));
        let _ = std::fs::remove_file(&path);

        assert_eq!(fields.genre.as_deref(), Some("Techno"));
        assert_eq!(fields.key.as_deref(), Some("5A"));
        assert_eq!(fields.bpm, Some(140.0));
    }

    // ---- `fill_gaps` orchestration ---------------------------------------------

    /// All three fields already `Some`: returns input unchanged, and never even
    /// looks at `path` — a nonexistent path proves no file was opened, since
    /// opening it would still resolve to "no data" either way, but the short-circuit
    /// is what this test is pinning down structurally (see the early return in
    /// `fill_gaps` before `path` is ever read).
    #[test]
    fn fill_gaps_skips_io_when_nothing_is_missing() {
        let metadata = JoinedMetadata {
            in_library: false,
            bpm: Some(128.0),
            key: Some("8A".to_string()),
            genre: Some("House".to_string()),
        };

        let filled = fill_gaps(metadata.clone(), Some("/definitely/does/not/exist.mp3"));

        assert_eq!(filled, metadata);
    }

    /// `path: None`: returns input unchanged.
    #[test]
    fn fill_gaps_with_no_path_returns_input_unchanged() {
        let metadata = JoinedMetadata::default();

        let filled = fill_gaps(metadata.clone(), None);

        assert_eq!(filled, metadata);
    }

    /// A path pointing at nothing resolves every gap to `None`, not a panic — the
    /// same infallible contract as the field-level extraction functions.
    #[test]
    fn fill_gaps_with_missing_file_leaves_gaps_none() {
        let metadata = JoinedMetadata::default();

        let filled = fill_gaps(metadata, Some("/definitely/does/not/exist_1_5.mp3"));

        assert_eq!(filled, JoinedMetadata::default());
    }

    /// Partial gaps: a field already resolved by the library join (e.g. `key` from
    /// a Serato 4+ row) is never overwritten by the embedded-tag fallback, even when
    /// there is no embedded tag to disagree with it. This is the case Story 1.4's
    /// AC-4 exists for.
    #[test]
    fn fill_gaps_never_overwrites_an_already_resolved_field() {
        let metadata = JoinedMetadata {
            in_library: true,
            bpm: None,
            key: Some("8A".to_string()),
            genre: None,
        };

        let filled = fill_gaps(metadata, Some("/definitely/does/not/exist_1_5_partial.mp3"));

        assert_eq!(
            filled.key.as_deref(),
            Some("8A"),
            "pre-existing value must survive"
        );
        assert!(
            filled.in_library,
            "in_library must never be touched by this module"
        );
        assert_eq!(filled.bpm, None);
        assert_eq!(filled.genre, None);
    }
}
