//! Clean-room parser for the legacy Serato `.session` binary play-log.
//!
//! This is the `parser` filter of the agent pipeline documented in
//! [`crate`](../lib.rs) (`watcher -> parser -> joiner -> stat-engine -> local store
//! -> sync-queue`). It reads a `.session` file into an ordered list of [`Play`]s —
//! the raw as-played sequence — for later enrichment and stats (AR-5).
//!
//! Design invariants (Story 1.3):
//! - **No panics on the parse path.** Every fallible step returns `Result`/`Option`;
//!   malformed input yields [`ParseError`], never a crash.
//! - **Fail loud on overrun.** A record/field whose declared length overruns its
//!   enclosing bound is [`ParseError::Truncated`], never a silently clamped read.
//! - **Read-only.** [`parse_session_file`] never mutates or removes the source file,
//!   so the raw file is trivially retained for backfill (AR-7) at this build stage.
//! - **Deterministic + de-duplicated.** Parsing the same bytes twice yields identical
//!   output; byte-identical duplicate records are collapsed by row ID (findings §5).
//!
//! The binary decode itself lives in [`session`]; this module is the public surface.

mod session;

pub use session::parse;

use std::path::Path;

/// One play from a `.session` file: a track reference plus the high-confidence
/// per-play fields from Story 1.2's field map (findings doc §3).
///
/// **Every field is optional.** Absence is a normal case, not corruption — the spike
/// observed even a "high confidence" field (artist) come back missing on an otherwise
/// well-formed record. A play is never dropped for having missing fields. Row ID
/// (field 1) is deliberately absent: it is consumed internally for de-duplication and
/// never exposed. Low-confidence fields (BPM/field 15, times/29/53) are excluded by
/// design — BPM comes from the library join / embedded tags in later stories.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Play {
    /// Absolute file path — the track reference (field 2).
    pub path: Option<String>,
    /// Track title (field 6).
    pub title: Option<String>,
    /// Track artist (field 7).
    pub artist: Option<String>,
    /// Record label (field 8).
    pub label: Option<String>,
    /// Genre (field 9).
    pub genre: Option<String>,
    /// Freeform grouping / tag list (field 17).
    pub grouping: Option<String>,
    /// Release year (field 23), stored as its raw string form.
    pub year: Option<String>,
    /// Play start time — Unix epoch, UTC (field 28).
    pub start_time: Option<u32>,
    /// Deck the track played on — observed values 1 or 2 (field 31).
    pub deck: Option<u32>,
    /// Played duration in seconds (field 45).
    pub duration_sec: Option<u32>,
    /// Musical key in Camelot notation, e.g. `"1A"` (field 51).
    pub key: Option<String>,
}

/// Everything that can go wrong parsing a `.session` file. Exactly two variants:
/// an IO failure reading the file, and a structural overrun in the binary format.
/// Mirrors the `Display`/`std::error::Error` idiom of `SchemaLoadError` in
/// [`crate`](../lib.rs).
#[derive(Debug)]
pub enum ParseError {
    /// The file could not be read from disk (only reachable via [`parse_session_file`]).
    Io(std::io::Error),
    /// A record or field declared a length that overruns its enclosing bound. Carries
    /// the byte offset of the offending record/field for diagnostics.
    Truncated { offset: usize },
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ParseError::Io(e) => write!(f, "failed to read .session file: {e}"),
            ParseError::Truncated { offset } => write!(
                f,
                "malformed .session: a record length overruns its bounds at byte offset {offset}"
            ),
        }
    }
}

impl std::error::Error for ParseError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ParseError::Io(e) => Some(e),
            ParseError::Truncated { .. } => None,
        }
    }
}

/// Reads a `.session` file from disk and parses it into an ordered list of [`Play`]s.
///
/// **Read-only:** the source file is opened for reading via [`std::fs::read`] and is
/// never deleted, moved, renamed, or truncated — on either the success or the error
/// path — so the raw file is retained for backfill (AR-7). An IO failure maps to
/// [`ParseError::Io`]; decoding is delegated to [`parse`].
pub fn parse_session_file(path: &Path) -> Result<Vec<Play>, ParseError> {
    let data = std::fs::read(path).map_err(ParseError::Io)?;
    parse(&data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    // ---- Synthetic byte-fixture builders --------------------------------------
    //
    // Real Serato session data is personal DJ history and is never committed as a
    // fixture (golden-file fixtures are Story 1.9's job). These helpers emit valid
    // records matching the confirmed envelope from given field values.

    /// UTF-16BE encoding of `s` with the trailing NUL terminator, as a real field payload.
    fn utf16be_nul(s: &str) -> Vec<u8> {
        let mut out = Vec::new();
        for unit in s.encode_utf16() {
            out.extend_from_slice(&unit.to_be_bytes());
        }
        out.extend_from_slice(&[0, 0]); // NUL terminator
        out
    }

    /// A UTF-16BE text field: `[id][len][utf-16be payload]`.
    fn text_field(id: u32, s: &str) -> Vec<u8> {
        let payload = utf16be_nul(s);
        let mut f = Vec::new();
        f.extend_from_slice(&id.to_be_bytes());
        f.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        f.extend_from_slice(&payload);
        f
    }

    /// A 4-byte big-endian numeric field: `[id][4][value]`.
    fn u32_field(id: u32, value: u32) -> Vec<u8> {
        let mut f = Vec::new();
        f.extend_from_slice(&id.to_be_bytes());
        f.extend_from_slice(&4u32.to_be_bytes());
        f.extend_from_slice(&value.to_be_bytes());
        f
    }

    /// Wraps `payload` in a tag/length/payload record.
    fn tagged(tag: &[u8; 4], payload: &[u8]) -> Vec<u8> {
        let mut r = Vec::new();
        r.extend_from_slice(tag);
        r.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        r.extend_from_slice(payload);
        r
    }

    /// A full `oent` record wrapping an `adat` record built from `fields`.
    fn oent(fields: &[Vec<u8>]) -> Vec<u8> {
        let adat = tagged(b"adat", &fields.concat());
        tagged(b"oent", &adat)
    }

    /// A leading non-`oent` header record (like the real `vrsn` header) that the
    /// structural walk must skip without decoding.
    fn vrsn_header() -> Vec<u8> {
        tagged(b"vrsn", &[0x00, 0x01, 0x00, 0x00])
    }

    /// A representative multi-field play record.
    fn play_record(
        row_id: u32,
        path: &str,
        title: &str,
        artist: &str,
        start: u32,
        deck: u32,
    ) -> Vec<u8> {
        oent(&[
            u32_field(1, row_id),
            text_field(2, path),
            text_field(6, title),
            text_field(7, artist),
            u32_field(28, start),
            u32_field(31, deck),
        ])
    }

    /// Writes `bytes` to a unique temp `.session` file, runs `f` against its path,
    /// then reads the file back. Returns `(f's result, bytes-on-disk-after)` and
    /// removes the temp file. Used to prove [`parse_session_file`] never mutates its input.
    fn with_temp_session<R>(bytes: &[u8], f: impl FnOnce(&Path) -> R) -> (R, Vec<u8>) {
        static COUNTER: AtomicUsize = AtomicUsize::new(0);
        let name = format!(
            "curfew_parser_test_{}_{}.session",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let path: PathBuf = std::env::temp_dir().join(name);
        std::fs::write(&path, bytes).expect("temp fixture write");
        let result = f(&path);
        let after = std::fs::read(&path).expect("temp fixture re-read");
        let _ = std::fs::remove_file(&path);
        (result, after)
    }

    // ---- Tests ----------------------------------------------------------------

    /// AC-1: a synthetic multi-play file (behind a leading `vrsn` header) parses to an
    /// ordered `Vec<Play>` with correct field values, and the header is skipped.
    #[test]
    fn parses_ordered_plays_with_fields_skipping_leading_header() {
        let data = [
            vrsn_header(),
            play_record(1, "/music/a.mp3", "Title A", "Artist A", 1_000, 1),
            play_record(2, "/music/b.mp3", "Title B", "Artist B", 2_000, 2),
        ]
        .concat();

        let plays = parse(&data).expect("valid session parses");

        assert_eq!(plays.len(), 2, "two plays, leading vrsn header skipped");

        assert_eq!(plays[0].path.as_deref(), Some("/music/a.mp3"));
        assert_eq!(plays[0].title.as_deref(), Some("Title A"));
        assert_eq!(plays[0].artist.as_deref(), Some("Artist A"));
        assert_eq!(plays[0].start_time, Some(1_000));
        assert_eq!(plays[0].deck, Some(1));

        assert_eq!(
            plays[1].path.as_deref(),
            Some("/music/b.mp3"),
            "file order preserved"
        );
        assert_eq!(plays[1].title.as_deref(), Some("Title B"));
        assert_eq!(plays[1].deck, Some(2));
    }

    /// AC-1: two byte-identical `oent` records (same row ID) that are NOT adjacent
    /// collapse to a single play, with the order of the surviving plays preserved.
    #[test]
    fn dedups_duplicate_rows_by_row_id_preserving_order() {
        let dup = play_record(10, "/music/dup.mp3", "Dup", "Artist", 5_000, 1);
        let other = play_record(11, "/music/other.mp3", "Other", "Artist2", 6_000, 2);

        // dup, other, dup — duplicates are separated by `other`, so adjacent-only
        // dedup would fail to collapse them; the HashSet approach must.
        let data = [dup.clone(), other, dup].concat();

        let plays = parse(&data).expect("valid session parses");

        assert_eq!(plays.len(), 2, "duplicate row_id counted exactly once");
        assert_eq!(
            plays[0].path.as_deref(),
            Some("/music/dup.mp3"),
            "first occurrence wins"
        );
        assert_eq!(
            plays[1].path.as_deref(),
            Some("/music/other.mp3"),
            "remaining order preserved"
        );
    }

    /// AC-3: an outer `oent` whose declared length points past the buffer end is a
    /// hard `Truncated`, never a panic.
    #[test]
    fn truncated_outer_record_errors() {
        let mut data = Vec::new();
        data.extend_from_slice(b"oent");
        data.extend_from_slice(&1_000u32.to_be_bytes()); // claims 1000 payload bytes...
        data.extend_from_slice(&[0u8; 10]); // ...but only 10 follow

        assert!(matches!(parse(&data), Err(ParseError::Truncated { .. })));
    }

    /// AC-3: an inner `adat` length that overruns its enclosing `oent` payload is a
    /// hard `Truncated` (the length is checked against the oent bound, not the file).
    #[test]
    fn truncated_adat_record_errors() {
        let mut adat = Vec::new();
        adat.extend_from_slice(b"adat");
        adat.extend_from_slice(&500u32.to_be_bytes()); // adat claims 500 bytes...
        adat.extend_from_slice(&[0u8; 4]); // ...but only 4 follow
        let data = tagged(b"oent", &adat); // outer oent length is itself correct

        assert!(matches!(parse(&data), Err(ParseError::Truncated { .. })));
    }

    /// AC-3: an individual field length that overruns its enclosing `adat` payload is
    /// a hard `Truncated` (checked against the adat bound).
    #[test]
    fn truncated_field_errors() {
        let mut fields = Vec::new();
        fields.extend_from_slice(&2u32.to_be_bytes()); // field 2 (path)...
        fields.extend_from_slice(&999u32.to_be_bytes()); // ...claims 999 bytes...
        fields.extend_from_slice(&[0u8; 4]); // ...but only 4 follow
        let data = tagged(b"oent", &tagged(b"adat", &fields));

        assert!(matches!(parse(&data), Err(ParseError::Truncated { .. })));
    }

    /// AC-4: parsing the same bytes twice yields identical output.
    #[test]
    fn parse_is_deterministic() {
        let data = [
            play_record(1, "/music/a.mp3", "A", "Artist A", 1_000, 1),
            play_record(2, "/music/b.mp3", "B", "Artist B", 2_000, 2),
            play_record(3, "/music/c.mp3", "C", "Artist C", 3_000, 1),
        ]
        .concat();

        assert_eq!(parse(&data).unwrap(), parse(&data).unwrap());
    }

    /// AC-1/AC-3: a file with zero recognizable `oent` records is valid empty data,
    /// not an error — whether it's a lone header or an empty buffer.
    #[test]
    fn zero_oent_parses_to_empty_vec() {
        assert_eq!(parse(&vrsn_header()).unwrap(), Vec::<Play>::new());
        assert_eq!(parse(&[]).unwrap(), Vec::<Play>::new());
    }

    /// AC-3 (Task 3): `parse_session_file` leaves the source file byte-for-byte
    /// unchanged on the success path.
    #[test]
    fn parse_session_file_does_not_mutate_source_on_success() {
        let bytes = play_record(1, "/music/a.mp3", "A", "Artist A", 1_000, 1);
        let (result, after) = with_temp_session(&bytes, |p| parse_session_file(p));

        assert_eq!(result.unwrap().len(), 1, "valid file parses");
        assert_eq!(
            after, bytes,
            "source file bytes unchanged after a successful parse"
        );
    }

    /// AC-3 (Task 3): `parse_session_file` leaves the source file byte-for-byte
    /// unchanged even when parsing returns `Err`.
    #[test]
    fn parse_session_file_does_not_mutate_source_on_error() {
        // A truncated outer record -> Err, but the file must be untouched.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"oent");
        bytes.extend_from_slice(&1_000u32.to_be_bytes());
        bytes.extend_from_slice(&[0u8; 10]);

        let (result, after) = with_temp_session(&bytes, |p| parse_session_file(p));

        assert!(
            matches!(result, Err(ParseError::Truncated { .. })),
            "truncated file errors"
        );
        assert_eq!(
            after, bytes,
            "source file bytes unchanged after a failing parse"
        );
    }

    /// A missing source file surfaces as `ParseError::Io`, never a panic.
    #[test]
    fn missing_file_maps_to_io_error() {
        let path = std::env::temp_dir().join("curfew_parser_definitely_missing_9e3f.session");
        let _ = std::fs::remove_file(&path);
        assert!(matches!(parse_session_file(&path), Err(ParseError::Io(_))));
    }
}
