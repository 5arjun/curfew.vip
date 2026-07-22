//! Thin wrapper around `triseratops::library::Library` for resolving in-library
//! track identity, exercised against two real, distinct library roots (local +
//! USB-hosted) per AC-1.
//!
//! Format quirk confirmed empirically (both roots): `database V2` stores file
//! paths **root-relative, without a leading `/`** (e.g. `Users/arjun/Music/...`),
//! while this spike's own `.session` parser (`legacy_session.rs`) yields fully
//! absolute POSIX paths (e.g. `/Users/arjun/Music/...`) for the same track. A
//! successful join requires stripping the leading `/` before lookup — see
//! `resolve()` below. This is exactly the relative-vs-absolute path resolution
//! AC-1 calls out.

use std::path::{Path, PathBuf};
use triseratops::library::{Library, Track};

pub fn load(music_dir: impl AsRef<Path>) -> Result<Library, triseratops::error::Error> {
    Library::read_from_path(music_dir)
}

/// Resolves an absolute POSIX path (as produced by `legacy_session::Play.path`)
/// against a `Library` loaded from a given root, handling the leading-`/` quirk.
pub fn resolve<'a>(library: &'a Library, absolute_session_path: &str) -> Option<&'a Track> {
    if let Some(track) = library.track(Path::new(absolute_session_path)) {
        return Some(track);
    }
    let stripped = absolute_session_path
        .strip_prefix('/')
        .unwrap_or(absolute_session_path);
    library.track(Path::new(stripped))
}

#[allow(dead_code)]
pub fn as_path_buf(s: &str) -> PathBuf {
    PathBuf::from(s)
}
