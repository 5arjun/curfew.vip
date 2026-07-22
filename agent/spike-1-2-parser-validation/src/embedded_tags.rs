//! Embedded-tag reads via the `id3` crate. Validates AC-1's off-library/WAV cases:
//! (a) off-library MP3s referenced by a played session, and (b) the 11 real WAV
//! files on the USB-hosted library, read directly (not via a played session, since
//! most of them were never logged as played from that exact path/drive — see
//! findings doc).

use id3::TagLike;
use std::path::Path;

#[derive(Debug, Clone, Default)]
pub struct EmbeddedTags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
}

pub enum ReadOutcome {
    Tags(EmbeddedTags),
    NoTagsPresent,
    ReadError(String),
}

pub fn read_tags(path: &Path) -> ReadOutcome {
    match id3::Tag::read_from_path(path) {
        Ok(tag) => ReadOutcome::Tags(EmbeddedTags {
            title: tag.title().map(str::to_string),
            artist: tag.artist().map(str::to_string),
            album: tag.album().map(str::to_string),
            genre: tag.genre().map(str::to_string),
        }),
        Err(err) if matches!(err.kind, id3::ErrorKind::NoTag) => ReadOutcome::NoTagsPresent,
        Err(err) => ReadOutcome::ReadError(err.to_string()),
    }
}
