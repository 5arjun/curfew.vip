//! Install-generation classification + volume discovery (Story 2.6, Tasks 1-2).
//!
//! A DJ's Serato install is one of two structurally different things, not one
//! folder with a version-sniff inside it (see [`classify`]'s doc comment): the
//! legacy `_Serato_/database V2` catalogue, or Serato 4+'s `master.sqlite`. This
//! module answers "which one (if either) lives under this candidate directory?"
//! for both the OS-default startup check and the removable-volume scan, and never
//! touches settings, the tray, or the confirm UI — those are [`super`]'s job.

use std::path::{Path, PathBuf};

use crate::joiner::legacy::{DATABASE_FILENAME, SERATO_DIR};

/// Serato 4+'s `master.sqlite`, relative to a user's home directory — the real,
/// confirmed macOS path (Story 1.3b Dev Agent Record: a real file was inspected
/// read-only at this exact location). Windows has no equivalent confirmed anywhere
/// in this project's research; only the legacy default has a documented Windows
/// convention (see [`os_default_roots`]).
const SERATO4_HOME_RELPATH: &str = "Library/Application Support/Serato/Library/master.sqlite";

/// `master.sqlite`'s own filename, checked directly against a candidate path so a
/// DJ (or a USB mount point) pointing straight at the `Serato/Library` folder
/// still resolves without needing the full home-relative suffix above.
const SERATO4_DB_FILENAME: &str = "master.sqlite";

/// Which generation of Serato install was found at a candidate path, and where.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SeratoInstall {
    /// Pre-Serato-4: the `_Serato_` folder path (containing `database V2` and
    /// `History/Sessions/*.session`).
    Legacy(PathBuf),
    /// Serato 4+: the `master.sqlite` file path.
    Serato4 { db_path: PathBuf },
}

/// Classifies one candidate path: Serato 4+ if a `master.sqlite` resolves under
/// it, else legacy if a `database V2` catalogue resolves under it, else `None`.
///
/// **Serato 4+ wins when both are present** (AC-5) — checked first, unconditionally,
/// so a migrated install (both generations on disk) always routes to the one that
/// still receives new plays.
///
/// `root` is accepted at two levels, because this same function serves three
/// different callers that hand it different things:
/// - a **container** directory one level above Serato's own layout — a home
///   directory (for `Library/Application Support/Serato/Library/master.sqlite`),
///   `~/Music` (for `_Serato_/database V2`), or a USB mount point ([`scan_removable_volumes`]);
/// - the Serato-owned folder **itself** — a DJ's manual override, which Story
///   2.5's settings panel has always prompted for as "`/path/to/_Serato_`" (the
///   `_Serato_` folder directly, not its parent), so treating a container-only
///   root as the sole valid shape would reject every override that already
///   matches that placeholder's convention.
///
/// Neither shape is preferred over the other; both are simply checked, since a
/// direct filesystem stat is cheap and a false-positive here would require an
/// actual `master.sqlite`/`database V2` file to exist at a coincidental nested
/// path (vanishingly unlikely in practice).
pub fn classify(root: &Path) -> Option<SeratoInstall> {
    let via_container = root.join(SERATO4_HOME_RELPATH);
    if via_container.is_file() {
        return Some(SeratoInstall::Serato4 {
            db_path: via_container,
        });
    }
    let via_direct = root.join(SERATO4_DB_FILENAME);
    if via_direct.is_file() {
        return Some(SeratoInstall::Serato4 {
            db_path: via_direct,
        });
    }

    let serato_dir = root.join(SERATO_DIR);
    if serato_dir.join(DATABASE_FILENAME).is_file() {
        return Some(SeratoInstall::Legacy(serato_dir));
    }
    if root.join(DATABASE_FILENAME).is_file() {
        return Some(SeratoInstall::Legacy(root.to_path_buf()));
    }

    None
}

/// The OS-default candidate roots to check at startup, before any removable-volume
/// scan: the home directory (Serato 4+'s default lives under it) and `~/Music`
/// (legacy's default). Two roots, not one, because the two generations' defaults
/// are genuinely different base locations — see [`classify`]'s "critical nuance"
/// in the story's own Task 1.
///
/// **Windows paths are unverified** — no research doc or prior story pins an exact
/// Windows path (`epics.md`/PRD only say "Windows equivalent"). The Windows legacy
/// default is best-effort per Serato's documented convention
/// (`%USERPROFILE%\Music\_Serato_\`, which resolves to the same `<home>/Music`
/// shape `dirs`-free `HOME`/`USERPROFILE` env resolution already produces here) —
/// flagged as unverified in this story's Completion Notes, same gap Story 2.5
/// flagged for tray parity. No Windows dev/CI environment exists to confirm it.
fn os_default_roots(home: &Path) -> [PathBuf; 2] {
    [home.to_path_buf(), home.join("Music")]
}

/// Checks the OS-default locations only (no removable-volume scan) — Serato 4+
/// wins if found under `home` itself, regardless of what else `home/Music` holds
/// (AC-5).
pub fn detect_os_default(home: &Path) -> Option<SeratoInstall> {
    let [primary, secondary] = os_default_roots(home);
    match classify(&primary) {
        found @ Some(SeratoInstall::Serato4 { .. }) => found,
        legacy_at_home => classify(&secondary).or(legacy_at_home),
    }
}

/// A source of removable-disk mount points, injectable so unit tests never need a
/// real `sysinfo` system call — only [`SystemDisks`] hits real hardware.
pub trait DiskSource {
    /// Mount points of every currently-connected removable volume.
    fn removable_mount_points(&self) -> Vec<PathBuf>;
}

/// The real, OS-backed disk source (Story 2.6 Task 2): `sysinfo::Disks`, filtered
/// to removable media only.
pub struct SystemDisks;

impl DiskSource for SystemDisks {
    fn removable_mount_points(&self) -> Vec<PathBuf> {
        sysinfo::Disks::new_with_refreshed_list()
            .iter()
            .filter(|disk| disk.is_removable())
            .map(|disk| disk.mount_point().to_path_buf())
            .collect()
    }
}

/// Scans every connected removable volume, returning the first classified Serato
/// install found. Order among multiple removable volumes is whatever `disks`
/// returns — no "best match" heuristic (per Task 2's note, the DJ's own confirm/
/// edit step, not a ranking, is what corrects a wrong first hit).
pub fn scan_removable_volumes(disks: &dyn DiskSource) -> Option<SeratoInstall> {
    disks
        .removable_mount_points()
        .iter()
        .find_map(|mount_point| classify(mount_point))
}

/// Full detection order (AC-1): OS defaults first, then removable volumes —
/// first match wins, never a "best of several" pick (AC-3 exists precisely so
/// the DJ can correct a wrong first hit instead).
pub fn detect(home: &Path, disks: &dyn DiskSource) -> Option<SeratoInstall> {
    detect_os_default(home).or_else(|| scan_removable_volumes(disks))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A scratch directory, unique per test so parallel `cargo test` runs never
    /// collide, cleaned up on drop. Mirrors `settings.rs`'s `TempSettingsFile`
    /// fixture pattern.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "curfew-watcher-detect-test-{tag}-{}-{n}",
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

    // ---- classify: container-root shape --------------------------------------

    #[test]
    fn classify_finds_legacy_under_a_container_root() {
        let root = TempDir::new("legacy-container");
        touch(&root.0.join(SERATO_DIR).join(DATABASE_FILENAME));

        assert_eq!(
            classify(&root.0),
            Some(SeratoInstall::Legacy(root.0.join(SERATO_DIR)))
        );
    }

    #[test]
    fn classify_finds_serato4_under_a_home_style_container_root() {
        let root = TempDir::new("serato4-container");
        touch(&root.0.join(SERATO4_HOME_RELPATH));

        assert_eq!(
            classify(&root.0),
            Some(SeratoInstall::Serato4 {
                db_path: root.0.join(SERATO4_HOME_RELPATH)
            })
        );
    }

    #[test]
    fn classify_finds_neither_on_an_empty_root() {
        let root = TempDir::new("neither");
        assert_eq!(classify(&root.0), None);
    }

    // ---- classify: manual-override "root is the Serato folder itself" shape --

    #[test]
    fn classify_finds_legacy_when_root_is_the_serato_folder_itself() {
        let root = TempDir::new("legacy-direct");
        touch(&root.0.join(DATABASE_FILENAME));

        assert_eq!(
            classify(&root.0),
            Some(SeratoInstall::Legacy(root.0.clone()))
        );
    }

    #[test]
    fn classify_finds_serato4_when_root_is_the_library_folder_itself() {
        let root = TempDir::new("serato4-direct");
        touch(&root.0.join(SERATO4_DB_FILENAME));

        assert_eq!(
            classify(&root.0),
            Some(SeratoInstall::Serato4 {
                db_path: root.0.join(SERATO4_DB_FILENAME)
            })
        );
    }

    /// AC-5: a migrated install has both generations on disk under the same
    /// container root — Serato 4+ must win, since the legacy folder may no longer
    /// receive new plays.
    #[test]
    fn classify_prefers_serato4_when_both_generations_present() {
        let root = TempDir::new("both-generations");
        touch(&root.0.join(SERATO_DIR).join(DATABASE_FILENAME));
        touch(&root.0.join(SERATO4_HOME_RELPATH));

        assert!(matches!(
            classify(&root.0),
            Some(SeratoInstall::Serato4 { .. })
        ));
    }

    // ---- detect_os_default: the two real base roots are genuinely different ---

    #[test]
    fn detect_os_default_finds_legacy_under_home_music() {
        let home = TempDir::new("os-default-legacy");
        touch(
            &home
                .0
                .join("Music")
                .join(SERATO_DIR)
                .join(DATABASE_FILENAME),
        );

        assert_eq!(
            detect_os_default(&home.0),
            Some(SeratoInstall::Legacy(home.0.join("Music").join(SERATO_DIR)))
        );
    }

    #[test]
    fn detect_os_default_finds_serato4_directly_under_home() {
        let home = TempDir::new("os-default-serato4");
        touch(&home.0.join(SERATO4_HOME_RELPATH));

        assert_eq!(
            detect_os_default(&home.0),
            Some(SeratoInstall::Serato4 {
                db_path: home.0.join(SERATO4_HOME_RELPATH)
            })
        );
    }

    #[test]
    fn detect_os_default_prefers_serato4_over_a_frozen_legacy_folder() {
        let home = TempDir::new("os-default-migrated");
        touch(
            &home
                .0
                .join("Music")
                .join(SERATO_DIR)
                .join(DATABASE_FILENAME),
        );
        touch(&home.0.join(SERATO4_HOME_RELPATH));

        assert!(matches!(
            detect_os_default(&home.0),
            Some(SeratoInstall::Serato4 { .. })
        ));
    }

    #[test]
    fn detect_os_default_finds_nothing_on_a_bare_home() {
        let home = TempDir::new("os-default-empty");
        assert_eq!(detect_os_default(&home.0), None);
    }

    // ---- removable-volume scan: injectable disk source, no real sysinfo call --

    struct FakeDisks(Vec<PathBuf>);

    impl DiskSource for FakeDisks {
        fn removable_mount_points(&self) -> Vec<PathBuf> {
            self.0.clone()
        }
    }

    #[test]
    fn scan_removable_volumes_finds_a_legacy_library_on_a_usb_drive() {
        let volume = TempDir::new("usb-legacy");
        touch(&volume.0.join(SERATO_DIR).join(DATABASE_FILENAME));
        let disks = FakeDisks(vec![volume.0.clone()]);

        assert_eq!(
            scan_removable_volumes(&disks),
            Some(SeratoInstall::Legacy(volume.0.join(SERATO_DIR)))
        );
    }

    #[test]
    fn scan_removable_volumes_skips_a_non_serato_drive_and_finds_the_next() {
        let empty_drive = TempDir::new("usb-empty");
        let real_drive = TempDir::new("usb-real");
        touch(&real_drive.0.join(SERATO_DIR).join(DATABASE_FILENAME));
        let disks = FakeDisks(vec![empty_drive.0.clone(), real_drive.0.clone()]);

        assert_eq!(
            scan_removable_volumes(&disks),
            Some(SeratoInstall::Legacy(real_drive.0.join(SERATO_DIR)))
        );
    }

    #[test]
    fn scan_removable_volumes_finds_nothing_when_no_drive_has_a_library() {
        let empty_drive = TempDir::new("usb-none");
        let disks = FakeDisks(vec![empty_drive.0.clone()]);

        assert_eq!(scan_removable_volumes(&disks), None);
    }

    #[test]
    fn scan_removable_volumes_finds_nothing_with_no_drives_connected() {
        let disks = FakeDisks(vec![]);
        assert_eq!(scan_removable_volumes(&disks), None);
    }

    // ---- full precedence: OS default first, then removable ---------------------

    #[test]
    fn detect_prefers_os_default_over_a_removable_volume() {
        let home = TempDir::new("precedence-home");
        touch(
            &home
                .0
                .join("Music")
                .join(SERATO_DIR)
                .join(DATABASE_FILENAME),
        );
        let volume = TempDir::new("precedence-usb");
        touch(&volume.0.join(SERATO_DIR).join(DATABASE_FILENAME));
        let disks = FakeDisks(vec![volume.0.clone()]);

        assert_eq!(
            detect(&home.0, &disks),
            Some(SeratoInstall::Legacy(home.0.join("Music").join(SERATO_DIR))),
            "an OS-default hit must win over a removable volume, even if scanned"
        );
    }

    #[test]
    fn detect_falls_back_to_a_removable_volume_when_no_os_default_exists() {
        let home = TempDir::new("fallback-home");
        let volume = TempDir::new("fallback-usb");
        touch(&volume.0.join(SERATO_DIR).join(DATABASE_FILENAME));
        let disks = FakeDisks(vec![volume.0.clone()]);

        assert_eq!(
            detect(&home.0, &disks),
            Some(SeratoInstall::Legacy(volume.0.join(SERATO_DIR)))
        );
    }

    #[test]
    fn detect_finds_nothing_when_no_os_default_and_no_removable_hit() {
        let home = TempDir::new("nothing-home");
        let disks = FakeDisks(vec![]);

        assert_eq!(detect(&home.0, &disks), None);
    }
}
