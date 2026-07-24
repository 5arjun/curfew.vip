//! Library join: resolves a played track to the BPM/key/genre the DJ's own Serato
//! library holds for it.
//!
//! This is the `joiner` filter of the agent pipeline documented in
//! [`crate`](../lib.rs) (`watcher -> parser -> joiner -> stat-engine -> local store
//! -> sync-queue`). It sits between the parser (Story 1.3) and the stat engine, and
//! it is the only component that ever reads the library catalogue (AD-1: the edge
//! owns the session↔library join; the cloud never re-derives it).
//!
//! Three submodules, one output type:
//! - [`legacy`] — the pre-Serato-4 `_Serato_/database V2` binary catalogue, joined by
//!   file path against a [`crate::parser::Play`].
//! - [`serato4`] — Serato 4+'s `master.sqlite`, where the same three fields are
//!   already denormalized onto the play row, so the "join" is a read, not a lookup.
//! - [`embedded_tags`] — the off-library fallback (Story 1.5): reads BPM/key/genre
//!   straight from the played file's own ID3 or Vorbis-comment tags for whatever
//!   `legacy`/`serato4` left `None`.
//!
//! Design invariants (Story 1.4, extended by Story 1.5):
//! - **Never guess** (AD-11). A field that is absent, empty, or unparseable in the
//!   source comes back `None`. A fabricated or partially-decoded value would be
//!   indistinguishable from a real one downstream.
//! - **No panics on the join path.** Every fallible step returns `Result`/`Option`,
//!   matching the bar set by Stories 1.1 and 1.3 — including path handling, which
//!   never assumes a filename is valid Unicode (Story 1.2 findings §5/D2).
//! - **Read-only.** No source file is opened for writing; Serato may hold the same
//!   files open during a gig.
//! - **Raw values only.** Genre is returned exactly as the source stores it —
//!   normalization (FR-8/AD-12, raw + normalized + `taxonomy_version`) is Story 1.6's
//!   job, and key is already Camelot notation at the source (findings §3) or taken
//!   raw from the embedded tag.
//!
//! What this filter deliberately does *not* do: reconcile its result against the play
//! log's own inline `genre`/`key` ([`crate::parser::Play`] carries those from a
//! different source — the merge policy belongs to whichever stage assembles the final
//! per-play record), run local audio DSP or key-finding (Story 1.5 AC-3, explicitly
//! out of scope), or display "Unknown" (a `None` here is the input to that chain, not
//! the end of it).

/// Off-library embedded-tag fallback (Story 1.5, AC-1/AC-2/AC-3).
pub mod embedded_tags;
/// Legacy `database V2` library join (Story 1.4, AC-1/AC-3).
pub mod legacy;
/// Serato 4+ `master.sqlite` metadata read (Story 1.4, AC-2).
pub mod serato4;

/// What the library knows about one played track.
///
/// **Every metadata field is independently optional, and that is what satisfies
/// AC-4.** `None` means "this library had no usable value for this field" — whether
/// because the track is off-library entirely, or because it is in-library with a gap
/// in that one column. Both cases route to the same place (Story 1.5's embedded-tag
/// fallback, then a visible "Unknown" per AD-11), so nothing downstream needs to tell
/// them apart, and no code here special-cases one against the other.
///
/// [`in_library`](Self::in_library) is the flag the Consistency Conventions require to
/// travel with unknown data ("never omitted, never guessed") — it describes *library
/// membership*, not field completeness. An in-library track with no genre is
/// `in_library: true` with `genre: None`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct JoinedMetadata {
    /// Whether the played track was found in the DJ's library at all.
    pub in_library: bool,
    /// Beats per minute, as analysed by Serato.
    pub bpm: Option<f64>,
    /// Musical key, raw and exactly as stored at the source. When sourced from the
    /// library join, this is Camelot notation, e.g. `"1A"` (findings §3). When
    /// sourced from an embedded file tag ([`embedded_tags`]'s fallback), it is
    /// whatever the tagging tool wrote — `TKEY`/Vorbis `KEY` carry no notation
    /// guarantee, and nothing on this struct distinguishes which source a value
    /// came from.
    pub key: Option<String>,
    /// Genre, raw and un-normalized (normalization is Story 1.6's
    /// [`crate::genre::normalize`]).
    pub genre: Option<String>,
}

/// Accepts a BPM only if it is a real measurement.
///
/// Serato records an unanalysed or unreadable BPM as `0` (or, in the legacy format, an
/// empty/garbage string). Zero, negative, and non-finite values are not slow tracks —
/// they are missing data wearing a number, and letting one through would quietly drag
/// every average the stat engine computes (Story 1.7). Treated as absent, exactly like
/// a field that was never written.
fn sane_bpm(value: f64) -> Option<f64> {
    (value.is_finite() && value > 0.0).then_some(value)
}

/// Accepts a text value only if it carries something.
///
/// An empty string is how a "cleared" tag is stored, not a genre named "". Returning
/// `Some("")` would look like a resolved value and block Story 1.5's fallback from ever
/// running for that field, so it is reported as absent instead. The value itself is
/// never trimmed or rewritten — only the emptiness test is normalized.
fn non_empty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The default is the off-library answer: no membership, no fields — the shape
    /// every miss returns, in both formats.
    #[test]
    fn default_is_the_off_library_answer() {
        assert_eq!(
            JoinedMetadata::default(),
            JoinedMetadata {
                in_library: false,
                bpm: None,
                key: None,
                genre: None,
            }
        );
    }

    /// A BPM that is not a real measurement is absent, never a zero that would sink
    /// a set's average tempo.
    #[test]
    fn sane_bpm_rejects_non_measurements() {
        assert_eq!(sane_bpm(128.0), Some(128.0));
        assert_eq!(sane_bpm(0.0), None);
        assert_eq!(sane_bpm(-1.0), None);
        assert_eq!(sane_bpm(f64::NAN), None);
        assert_eq!(sane_bpm(f64::INFINITY), None);
    }

    /// A cleared tag reads as absent, but a real value is passed through untouched —
    /// including surrounding whitespace, which is the library's data, not ours to edit.
    #[test]
    fn non_empty_rejects_only_the_empty_string() {
        assert_eq!(non_empty("House".to_string()), Some("House".to_string()));
        assert_eq!(non_empty(String::new()), None);
        assert_eq!(non_empty(" ".to_string()), Some(" ".to_string()));
    }
}
