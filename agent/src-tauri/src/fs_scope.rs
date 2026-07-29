//! Filesystem-scope guard for catalogue reads (Story 2.7, AC-1).
//!
//! Confines Serato **catalogue** reads (the legacy `database V2` file, the Serato
//! 4+ `master.sqlite` file) to the DJ's configured Serato root, even when a
//! symlink planted somewhere under that root would otherwise redirect the read
//! elsewhere on disk. Canonicalization (which resolves symlinks) happens before
//! comparison — a `Path::starts_with` check against the raw, non-canonicalized
//! paths is not a security boundary, since a syntactically-nested path can still
//! resolve outside its apparent parent via a symlink.
//!
//! **Deliberately not applied to [`crate::joiner::embedded_tags`]'s track-file
//! reads.** A played track's own audio file (`parser::Play.path`) is sourced from
//! the DJ's Serato history and can legitimately live anywhere on disk the DJ's
//! music library does — often a different folder or drive entirely, not nested
//! under the Serato root at all. Confining that read to the configured root would
//! break Story 1.5's shipped off-library fallback. This guard governs only the
//! two catalogue reads that are supposed to stay inside the configured root:
//! `joiner::legacy::LegacyLibrary::load` and `joiner::serato4::open_read_only`.

use std::path::{Path, PathBuf};

/// Everything that can go wrong confirming a candidate path stays within a
/// configured root. Mirrors the `Display`/`std::error::Error` idiom of
/// `SettingsError`/`JoinError` — a small enum in application code, no
/// `anyhow`/`thiserror`.
#[derive(Debug)]
pub enum ScopeError {
    /// The root or the candidate could not be canonicalized (most commonly:
    /// neither exists yet).
    Io(std::io::Error),
    /// Both paths resolved, but the candidate's canonical form does not fall
    /// under the root's.
    OutsideRoot { root: PathBuf, candidate: PathBuf },
}

impl std::fmt::Display for ScopeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ScopeError::Io(e) => write!(f, "failed to resolve path for scope check: {e}"),
            ScopeError::OutsideRoot { root, candidate } => write!(
                f,
                "path {} resolves outside the configured Serato root {}",
                candidate.display(),
                root.display()
            ),
        }
    }
}

impl std::error::Error for ScopeError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            ScopeError::Io(e) => Some(e),
            ScopeError::OutsideRoot { .. } => None,
        }
    }
}

/// Confirms `candidate` resolves under `root`, both canonicalized first to
/// defeat `..` traversal and symlink escapes. Returns the canonicalized
/// candidate on success, so callers read the exact path that was checked
/// rather than re-deriving it and risking a TOCTOU mismatch between the two.
pub fn ensure_within_root(root: &Path, candidate: &Path) -> Result<PathBuf, ScopeError> {
    let root = root.canonicalize().map_err(ScopeError::Io)?;
    let candidate = candidate.canonicalize().map_err(ScopeError::Io)?;

    if candidate.starts_with(&root) {
        Ok(candidate)
    } else {
        Err(ScopeError::OutsideRoot { root, candidate })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "curfew-fs-scope-test-{tag}-{}-{n}",
                std::process::id()
            ));
            std::fs::create_dir_all(&dir).expect("temp fixture dir creates");
            Self(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"").unwrap();
    }

    /// A path genuinely inside the configured root passes, and the returned
    /// path canonicalizes to the same file.
    #[test]
    fn path_inside_root_passes() {
        let root = TempDir::new("inside");
        let file = root.0.join("_Serato_").join("database V2");
        touch(&file);

        let checked = ensure_within_root(&root.0, &file).expect("inside-root path passes");

        assert_eq!(checked, file.canonicalize().unwrap());
    }

    /// A sibling directory is not the configured root, however similarly named.
    #[test]
    fn sibling_directory_is_rejected() {
        let root = TempDir::new("sibling-root");
        let sibling = TempDir::new("sibling-other");
        let file = sibling.0.join("database V2");
        touch(&file);

        let err = ensure_within_root(&root.0, &file).expect_err("sibling path must be rejected");

        assert!(matches!(err, ScopeError::OutsideRoot { .. }));
    }

    /// A literal `..` component escaping the root is rejected once canonicalized,
    /// even though the un-canonicalized path is textually nested under the root.
    #[test]
    fn dot_dot_traversal_is_rejected() {
        let root = TempDir::new("dotdot-root");
        let outside = TempDir::new("dotdot-outside");
        let secret = outside.0.join("secret.db");
        touch(&secret);

        let traversal = root
            .0
            .join("..")
            .join(outside.0.file_name().unwrap())
            .join("secret.db");

        let err = ensure_within_root(&root.0, &traversal).expect_err("traversal must be rejected");

        assert!(matches!(err, ScopeError::OutsideRoot { .. }));
    }

    /// A symlink planted inside the root pointing outside it must not be
    /// followed into a false pass — this is the exact defeat `Path::starts_with`
    /// on non-canonicalized paths would miss, and the reason this guard
    /// canonicalizes before comparing.
    #[cfg(unix)]
    #[test]
    fn symlink_escape_is_rejected() {
        let root = TempDir::new("symlink-root");
        let outside = TempDir::new("symlink-outside");
        let secret = outside.0.join("secret.db");
        touch(&secret);

        let link = root.0.join("database V2");
        std::os::unix::fs::symlink(&secret, &link).expect("symlink creates");

        let err = ensure_within_root(&root.0, &link).expect_err("symlink escape must be rejected");

        assert!(matches!(err, ScopeError::OutsideRoot { .. }));
    }

    #[cfg(windows)]
    #[test]
    fn symlink_escape_is_rejected() {
        let root = TempDir::new("symlink-root");
        let outside = TempDir::new("symlink-outside");
        let secret = outside.0.join("secret.db");
        touch(&secret);

        let link = root.0.join("database V2");
        std::os::windows::fs::symlink_file(&secret, &link).expect("symlink creates");

        let err = ensure_within_root(&root.0, &link).expect_err("symlink escape must be rejected");

        assert!(matches!(err, ScopeError::OutsideRoot { .. }));
    }

    /// A candidate that does not exist cannot be canonicalized, and surfaces as
    /// an I/O error rather than a scope violation — callers with their own
    /// "not found" error variant (see `joiner::legacy::JoinError::Io`) map this
    /// case to their existing not-found handling, not a new scope-specific one.
    #[test]
    fn nonexistent_candidate_is_an_io_error() {
        let root = TempDir::new("missing-candidate-root");
        let missing = root.0.join("does-not-exist");

        assert!(matches!(
            ensure_within_root(&root.0, &missing),
            Err(ScopeError::Io(_))
        ));
    }

    /// A root that does not exist at all is also an I/O error, not a scope
    /// violation — there is nothing to canonicalize it against yet.
    #[test]
    fn nonexistent_root_is_an_io_error() {
        let root = std::env::temp_dir().join("curfew_fs_scope_definitely_missing_7e2a");
        let _ = std::fs::remove_dir_all(&root);
        let candidate = std::env::temp_dir();

        assert!(matches!(
            ensure_within_root(&root, &candidate),
            Err(ScopeError::Io(_))
        ));
    }
}
