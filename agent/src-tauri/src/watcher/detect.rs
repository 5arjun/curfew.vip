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
/// convention (see [`os_default_roots`]). `pub(crate)` so other modules' test
/// fixtures (Story 3.3b, e.g. `settings::tests`) can build a realistic internal
/// Serato4 fixture without duplicating this literal.
pub(crate) const SERATO4_HOME_RELPATH: &str =
    "Library/Application Support/Serato/Library/master.sqlite";

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
/// `root` is accepted at three shapes, because this same function serves callers
/// that each hand it something different:
/// - a **container** directory one level above Serato's own layout — a home
///   directory (for `Library/Application Support/Serato/Library/master.sqlite`),
///   `~/Music` (for `_Serato_/database V2`), or a USB mount point ([`scan_removable_volumes`]);
/// - the Serato-owned folder **itself** — a DJ's manual override, which Story
///   2.5's settings panel has always prompted for as "`/path/to/_Serato_`" (the
///   `_Serato_` folder directly, not its parent), so treating a container-only
///   root as the sole valid shape would reject every override that already
///   matches that placeholder's convention;
/// - the `master.sqlite` **file itself** — [`install_path`](super::install_path)
///   renders a Serato4 detection as `db_path`, the literal file path, which is
///   exactly what gets round-tripped back through this function from the confirm
///   UI and from `settings::validate_override`. Without this branch, `classify()`
///   would reject the very path it produced (root.join(...) against an
///   already-file-shaped root never resolves), breaking Save for every Serato 4+
///   install — caught in this story's own review round.
///
/// None of the three shapes is preferred over the others; all are simply
/// checked, since a direct filesystem stat is cheap and a false-positive here
/// would require an actual `master.sqlite`/`database V2` file to exist at a
/// coincidental nested path (vanishingly unlikely in practice).
pub fn classify(root: &Path) -> Option<SeratoInstall> {
    if root.is_file() && root.file_name() == Some(std::ffi::OsStr::new(SERATO4_DB_FILENAME)) {
        return Some(SeratoInstall::Serato4 {
            db_path: root.to_path_buf(),
        });
    }

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

/// Classifies one candidate path the same way [`classify`] does, but
/// **collects every hit instead of returning on the first** (Story 3.3b,
/// AC-1/AC-3). A migrated install — both generations still on disk under one
/// root, e.g. a USB `_Serato_` folder that still carries pre-migration
/// `.session` files alongside a real `master.sqlite` — must surface as
/// **both** a `Serato4` and a `Legacy` hit; [`classify`]'s "Serato 4+ wins"
/// precedence is exactly the single-answer behavior this story moves away
/// from at watch-time (precedence becomes a capture-time dedup instead, see
/// `capture::same_night`).
///
/// `classify` itself is kept unchanged and still exported — `watch_loop`'s
/// per-source reachability check still wants a single-answer "does this
/// exact source still resolve" probe, and this function is additive, not a
/// replacement.
pub fn classify_all(root: &Path) -> Vec<SeratoInstall> {
    let mut found = Vec::new();

    let serato4 =
        if root.is_file() && root.file_name() == Some(std::ffi::OsStr::new(SERATO4_DB_FILENAME)) {
            Some(SeratoInstall::Serato4 {
                db_path: root.to_path_buf(),
            })
        } else {
            let via_container = root.join(SERATO4_HOME_RELPATH);
            if via_container.is_file() {
                Some(SeratoInstall::Serato4 {
                    db_path: via_container,
                })
            } else {
                let via_direct = root.join(SERATO4_DB_FILENAME);
                via_direct.is_file().then_some(SeratoInstall::Serato4 {
                    db_path: via_direct,
                })
            }
        };
    found.extend(serato4);

    let serato_dir = root.join(SERATO_DIR);
    let legacy = if serato_dir.join(DATABASE_FILENAME).is_file() {
        Some(SeratoInstall::Legacy(serato_dir))
    } else if root.join(DATABASE_FILENAME).is_file() {
        Some(SeratoInstall::Legacy(root.to_path_buf()))
    } else {
        None
    };
    found.extend(legacy);

    found
}

/// A live Serato 4+ history source to watch: `db_path` is the `master.sqlite`
/// file itself, `root` is the scope-guard root `joiner::serato4::open_read_only`
/// checks it against. **`root` is per-source, not the DJ's configured
/// override** — the internal source (fixed under `$HOME`) and an override
/// pointing at a USB volume can be entirely different filesystem locations,
/// so each source must carry the root that actually contains it (see the
/// story's Dev Notes, "The `open_read_only` root trap").
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Serato4Source {
    pub root: PathBuf,
    pub db_path: PathBuf,
}

/// A live legacy history source to watch: `serato_dir` is the `_Serato_`
/// folder (`History/Sessions/*.session` is watched under it), `library_root`
/// is its parent — the root `capture::build_legacy` expects.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LegacySource {
    pub serato_dir: PathBuf,
    pub library_root: PathBuf,
}

/// Every history source this agent should watch concurrently (Story 3.3b,
/// AC-1) — the set-of-sources replacement for one install at one place.
/// `serato4`/`legacy` are independent: neither slot implies or excludes the
/// other, and **Serato 4+ wins nothing here** — when a real night surfaces
/// from both, precedence is resolved at capture time
/// (`capture::same_night`), never at watch-time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WatchPlan {
    pub serato4: Option<Serato4Source>,
    pub legacy: Option<LegacySource>,
}

/// Whether two paths name the same file once symlinks/`..` are resolved —
/// used only for [`resolve_watch_plan`]'s de-dup rule. Falls back to a raw
/// equality check if either side fails to canonicalize (most commonly: a
/// test fixture path, or a transient mid-Save state) — a resolution failure
/// must never manufacture a false "these are different files" that would
/// stand up two watchers on the same physical database.
fn paths_match(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

/// Resolves the full set of history sources to watch (Story 3.3b, AC-1/AC-3)
/// — the root-cause fix for the incident where a saved override skipped
/// detecting the OS-fixed Serato 4+ internal database entirely (see the
/// story's Dev Notes, "Read this first: what actually broke").
///
/// Rules, applied in this exact order:
/// 1. **Always** probe `home` for the internal Serato 4+ `master.sqlite`
///    (`SERATO4_HOME_RELPATH`) — unconditionally, override or not. This
///    single check alone is the root-cause fix.
/// 2. When an override is saved, union in every source [`classify_all`]
///    resolves under it.
/// 3. When no override is saved, union in [`detect`]'s hit (so first-run/
///    auto-detect behavior for a legacy-only DJ is unchanged).
/// 4. **Dedup by canonicalized path.** An override that *is* the internal
///    `master.sqlite` itself (exactly what a Serato 4+ auto-detect Save
///    produces) makes rules 1 and 2 resolve to the same file — that must
///    collapse to **one** source, not two watchers on one path.
/// 5. Serato 4+ wins nothing here: both slots fill independently.
pub fn resolve_watch_plan(
    override_path: Option<&str>,
    home: &Path,
    disks: &dyn DiskSource,
) -> WatchPlan {
    let mut serato4: Option<Serato4Source> = None;
    let mut legacy: Option<LegacySource> = None;

    // Rule 1: unconditional internal-master.sqlite probe.
    let internal_db_path = home.join(SERATO4_HOME_RELPATH);
    if internal_db_path.is_file() {
        serato4 = Some(Serato4Source {
            root: internal_db_path.clone(),
            db_path: internal_db_path,
        });
    }

    // Rules 2/3: union in whatever the override (or, absent one, full
    // detection) resolves.
    let extra_installs: Vec<SeratoInstall> = match override_path {
        Some(path) => classify_all(Path::new(path)),
        None => detect(home, disks).into_iter().collect(),
    };

    for install in extra_installs {
        match install {
            SeratoInstall::Serato4 { db_path } => {
                // Rule 4: dedup by canonicalized path.
                let already_have_this_file = serato4
                    .as_ref()
                    .is_some_and(|existing| paths_match(&existing.db_path, &db_path));
                if !already_have_this_file {
                    serato4.get_or_insert(Serato4Source {
                        root: db_path.clone(),
                        db_path,
                    });
                }
            }
            SeratoInstall::Legacy(serato_dir) => {
                legacy.get_or_insert_with(|| LegacySource {
                    library_root: serato_dir.parent().unwrap_or(&serato_dir).to_path_buf(),
                    serato_dir,
                });
            }
        }
    }

    WatchPlan { serato4, legacy }
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

    /// Regression test (code review, story 2.6): `install_path()` renders a
    /// Serato4 detection as the literal `master.sqlite` file path, which is
    /// exactly what round-trips back through `classify()` from the confirm UI
    /// and `settings::validate_override`. Feeding that file path back in as
    /// `root` must resolve, not reject the exact path this function produced.
    #[test]
    fn classify_accepts_the_master_sqlite_file_path_fed_back_as_root() {
        let root = TempDir::new("serato4-file-as-root");
        let db_path = root.0.join(SERATO4_DB_FILENAME);
        touch(&db_path);

        assert_eq!(
            classify(&db_path),
            Some(SeratoInstall::Serato4 {
                db_path: db_path.clone()
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

    // ---- classify_all: collects every hit, doesn't stop at the first --------

    /// The exact migrated-USB shape (Arjun's own setup): a `_Serato_` folder
    /// carrying pre-migration `database V2` **and** a real `master.sqlite`
    /// dropped alongside it. `classify` would return only Serato4 (AC-5
    /// precedence); `classify_all` must return both.
    #[test]
    fn classify_all_returns_both_generations_for_a_migrated_root() {
        let root = TempDir::new("classify-all-migrated");
        touch(&root.0.join(SERATO_DIR).join(DATABASE_FILENAME));
        touch(&root.0.join(SERATO4_HOME_RELPATH));

        let found = classify_all(&root.0);

        assert_eq!(found.len(), 2);
        assert!(found
            .iter()
            .any(|i| matches!(i, SeratoInstall::Serato4 { .. })));
        assert!(found.iter().any(|i| matches!(i, SeratoInstall::Legacy(_))));

        assert_eq!(
            classify(&root.0),
            Some(SeratoInstall::Serato4 {
                db_path: root.0.join(SERATO4_HOME_RELPATH)
            }),
            "sanity: classify() still returns only the Serato4 winner"
        );
    }

    #[test]
    fn classify_all_returns_a_single_hit_for_a_legacy_only_root() {
        let root = TempDir::new("classify-all-legacy-only");
        touch(&root.0.join(SERATO_DIR).join(DATABASE_FILENAME));

        let found = classify_all(&root.0);

        assert_eq!(found, vec![SeratoInstall::Legacy(root.0.join(SERATO_DIR))]);
    }

    #[test]
    fn classify_all_returns_empty_for_a_root_with_neither() {
        let root = TempDir::new("classify-all-empty");
        assert_eq!(classify_all(&root.0), Vec::new());
    }

    // ---- resolve_watch_plan: the incident fix --------------------------------

    /// AC-1/AC-3: the incident configuration itself — override points at a
    /// USB `_Serato_` folder with no history at all (legacy-only shape,
    /// nothing Serato4-shaped under it), but the DJ's real Serato 4+ install
    /// lives at the fixed internal home path. The resolved plan must still
    /// carry the internal serato4 source — this is the root-cause fix,
    /// proven directly.
    #[test]
    fn resolve_watch_plan_finds_the_internal_serato4_source_despite_a_legacy_only_override() {
        let home = TempDir::new("plan-incident-home");
        touch(&home.0.join(SERATO4_HOME_RELPATH));
        let usb = TempDir::new("plan-incident-usb");
        touch(&usb.0.join(SERATO_DIR).join(DATABASE_FILENAME));
        let disks = FakeDisks(vec![]);

        let plan = resolve_watch_plan(Some(usb.0.to_str().unwrap()), &home.0, &disks);

        assert_eq!(
            plan.serato4,
            Some(Serato4Source {
                root: home.0.join(SERATO4_HOME_RELPATH),
                db_path: home.0.join(SERATO4_HOME_RELPATH),
            }),
            "AC-3: the internal master.sqlite must be watched regardless of the override"
        );
        assert_eq!(
            plan.legacy,
            Some(LegacySource {
                serato_dir: usb.0.join(SERATO_DIR),
                library_root: usb.0.clone(),
            }),
            "AC-1: the override's own legacy source must still be watched too"
        );
    }

    /// The dedup rule (Task 1, rule 4): an override that *is* the internal
    /// `master.sqlite` — what a Serato 4+ auto-detect Save actually produces
    /// — must resolve to exactly one serato4 source, not two watchers on the
    /// same file.
    #[test]
    fn resolve_watch_plan_dedups_when_override_is_the_internal_master_sqlite() {
        let home = TempDir::new("plan-dedup-home");
        let internal = home.0.join(SERATO4_HOME_RELPATH);
        touch(&internal);
        let disks = FakeDisks(vec![]);

        let plan = resolve_watch_plan(Some(internal.to_str().unwrap()), &home.0, &disks);

        assert_eq!(
            plan.serato4,
            Some(Serato4Source {
                root: internal.clone(),
                db_path: internal,
            })
        );
        assert_eq!(plan.legacy, None);
    }

    /// Both a real internal serato4 install and a distinct override-derived
    /// legacy install resolve into both plan slots simultaneously (AC-1) —
    /// the base "watch both" case with no dedup in play.
    #[test]
    fn resolve_watch_plan_fills_both_slots_when_both_sources_are_real_and_distinct() {
        let home = TempDir::new("plan-both-home");
        touch(&home.0.join(SERATO4_HOME_RELPATH));
        let override_dir = TempDir::new("plan-both-override");
        touch(&override_dir.0.join(SERATO_DIR).join(DATABASE_FILENAME));
        let disks = FakeDisks(vec![]);

        let plan = resolve_watch_plan(Some(override_dir.0.to_str().unwrap()), &home.0, &disks);

        assert!(plan.serato4.is_some());
        assert!(plan.legacy.is_some());
    }

    /// No override saved: falls back to `detect(home, disks)`, so a
    /// legacy-only DJ's first-run/auto-detect behavior is unchanged from
    /// before this story.
    #[test]
    fn resolve_watch_plan_with_no_override_falls_back_to_detect() {
        let home = TempDir::new("plan-no-override-home");
        touch(
            &home
                .0
                .join("Music")
                .join(SERATO_DIR)
                .join(DATABASE_FILENAME),
        );
        let disks = FakeDisks(vec![]);

        let plan = resolve_watch_plan(None, &home.0, &disks);

        assert_eq!(
            plan.legacy,
            Some(LegacySource {
                serato_dir: home.0.join("Music").join(SERATO_DIR),
                library_root: home.0.join("Music"),
            })
        );
        assert_eq!(plan.serato4, None);
    }

    /// No override, and truly nothing anywhere: both slots stay empty.
    #[test]
    fn resolve_watch_plan_with_no_override_and_nothing_detected_is_fully_empty() {
        let home = TempDir::new("plan-nothing-home");
        let disks = FakeDisks(vec![]);

        let plan = resolve_watch_plan(None, &home.0, &disks);

        assert_eq!(
            plan,
            WatchPlan {
                serato4: None,
                legacy: None,
            }
        );
    }
}
