//! `database V2` date-added lookup for Serato 4+ plays (Story 3.7, §3d — the
//! "small cross-path task" `serato-capture-completeness.md` names).
//!
//! Serato 4+'s `history_entry` cannot answer "when did the library first see
//! this track": its `time_added` is the row's own field (`-1` on real data),
//! and the `asset` join only links ~4.6% of real plays because the tracks live
//! on a USB volume, not the laptop's asset table. The reliable source is the
//! **legacy-format `database V2` catalogue** each Serato library keeps —
//! `~/Music/_Serato_/database V2` for boot-drive tracks, and
//! `/Volumes/<drive>/_Serato_/database V2` for each external drive — whose
//! `tadd`/`uadd` fields carry the add-date at ~94% coverage (Epic 1's
//! measurement, re-verified 2026-08-03).
//!
//! The join key is the play's `portable_id`: a **volume-root-relative** path
//! (`Users/arjun/Music/x.mp3`, or `A Indian/x.mp3` for a USB track) — the
//! exact no-leading-slash convention `database V2` stores its own `pfil`
//! paths in, so the lookup is a direct match with [`LegacyLibrary`]'s existing
//! absolute/relative bridging behind it.
//!
//! **Coverage is honestly drive-dependent.** A track on an unmounted volume
//! has no reachable catalogue, so its date reads absent (`None`, AD-11) —
//! never guessed. Two compensating controls keep that honest rather than
//! destructive: the UI discloses non-covered counts (Story 3.7 AC-15/AC-37),
//! and the captured-set backfill sweep never lets a re-derivation under
//! *fewer* mounted drives erase a date an earlier derivation resolved
//! ([`crate::backfill::backfill_captured_serato4`]'s carry-forward guard).
//!
//! **Read-only, scoped.** Every catalogue is read through
//! [`LegacyLibrary::load`], which opens the file read-only and refuses a path
//! that resolves outside its own volume root (Story 2.7's symlink guard,
//! applied per-catalogue).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use super::legacy::LegacyLibrary;

/// A queryable set of `database V2` catalogues, keyed by portable path.
///
/// Construction decides the mode: [`live`](Self::live) discovers and loads
/// every reachable catalogue on the machine (production) — **lazily**, on the
/// first lookup, so the watch loop can hold one per tick and pay the load cost
/// only on the rare tick that actually captures a session.
/// [`fixed`](Self::fixed) takes an explicit path→epoch map and never touches
/// the filesystem (tests, and the deliberate "no catalogues" case).
#[derive(Debug, Default)]
pub struct DateAddedIndex {
    /// `Some(home)` in live mode — the discovery root for `~/Music`.
    home: Option<PathBuf>,
    /// Lazily-loaded catalogues, tried in order. Deterministic: boot-drive
    /// library first, then mounted volumes sorted by name.
    catalogues: OnceLock<Vec<LegacyLibrary>>,
    /// Test/fixed entries, keyed by the exact portable path string.
    fixed: HashMap<String, i64>,
}

impl DateAddedIndex {
    /// A live index that, on first lookup, discovers and loads every reachable
    /// `database V2` on this machine: `<home>/Music/_Serato_/database V2` plus
    /// each mounted `/Volumes/<drive>/_Serato_/database V2`. A missing or
    /// unreadable catalogue is simply not loaded — tracks it would have covered
    /// read as date-absent (see the module doc for why that is safe).
    ///
    /// `home` is injected (rather than read from `$HOME` here) so the
    /// production caller chain passes the same home the watch-plan resolution
    /// already uses — and so no test can construct a live index by accident.
    pub fn live(home: &Path) -> Self {
        Self {
            home: Some(home.to_path_buf()),
            catalogues: OnceLock::new(),
            fixed: HashMap::new(),
        }
    }

    /// A filesystem-free index over explicit `portable path → epoch seconds`
    /// entries. An empty map is the "no catalogue reachable" case.
    pub fn fixed(entries: HashMap<String, i64>) -> Self {
        Self {
            home: None,
            catalogues: OnceLock::new(),
            fixed: entries,
        }
    }

    /// Whether the catalogues have actually been read yet this index's
    /// lifetime. Story 4.2 (D-3) uses this as its "the library was read on
    /// this tick" signal: the add-scan piggybacks on a load some capture
    /// already paid for, and stays silent on the overwhelming majority of
    /// ticks that capture nothing.
    pub fn is_loaded(&self) -> bool {
        self.catalogues.get().is_some()
    }

    /// Forces the lazy catalogue load. Called by the *legacy* capture path
    /// (Story 4.2), which reads `database V2` through its own
    /// [`LegacyLibrary`] rather than this index and so would otherwise never
    /// trip [`is_loaded`](Self::is_loaded) — leaving a legacy-only DJ with no
    /// add-detection at all. Same file, already warm in the OS page cache.
    pub fn ensure_loaded(&self) {
        let _ = self.loaded_catalogues();
    }

    fn loaded_catalogues(&self) -> &[LegacyLibrary] {
        self.catalogues.get_or_init(|| {
            let Some(home) = &self.home else {
                return Vec::new();
            };
            let mut roots: Vec<PathBuf> = vec![home.join("Music")];
            // Each mounted volume that carries its own Serato library. Sorted
            // for a deterministic lookup order.
            let mut volumes: Vec<PathBuf> = std::fs::read_dir("/Volumes")
                .map(|entries| {
                    entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.path())
                        .filter(|p| p.join(super::legacy::SERATO_DIR).is_dir())
                        .collect()
                })
                .unwrap_or_default();
            volumes.sort();
            roots.extend(volumes);

            roots
                .into_iter()
                .filter_map(|root| LegacyLibrary::load(&root).ok())
                .collect()
        })
    }

    /// The library date-added for one portable path, or `None` when no
    /// reachable catalogue (nor fixed entry) covers it — absent, never guessed.
    pub fn date_added_for(&self, portable_path: &str) -> Option<i64> {
        if let Some(epoch) = self.fixed.get(portable_path) {
            return Some(*epoch);
        }
        // Fixed mode (no home) never touches the filesystem.
        self.home.as_ref()?;
        let path = Path::new(portable_path);
        self.loaded_catalogues()
            .iter()
            .find_map(|catalogue| catalogue.date_added_for(path))
    }

    /// Every track every *reachable* catalogue holds, as
    /// `(portable path, date_added)` — the whole-library view Story 4.2's
    /// go-forward add-detection diffs against its local baseline (D-3).
    ///
    /// Deliberately the same index, the same lazily-loaded catalogues, and the
    /// same reachability rules as [`date_added_for`](Self::date_added_for): a
    /// track on an unmounted volume is simply not in this list, exactly as its
    /// date reads absent above. Story 4.2's caller relies on that — a library
    /// that shrinks because a drive was unplugged must never look like tracks
    /// were *removed*, and a drive that reappears must never look like its
    /// whole contents were *added* (see `capture::scan_library_adds`).
    ///
    /// Earlier catalogues win on a duplicate portable path, matching
    /// `date_added_for`'s `find_map` order.
    ///
    /// Paths are rendered with `to_string_lossy`: a filename is not guaranteed
    /// to be valid Unicode (Story 1.2 findings §5/D2), and dropping such a
    /// track would silently under-count the library rather than merely give it
    /// an approximate identity.
    pub fn all_tracks(&self) -> Vec<(String, Option<i64>)> {
        let mut seen: HashMap<String, Option<i64>> = HashMap::new();
        for (path, date_added) in &self.fixed {
            seen.insert(path.clone(), Some(*date_added));
        }
        if self.home.is_some() {
            for catalogue in self.loaded_catalogues() {
                for (path, date_added) in catalogue.entries() {
                    seen.entry(path.to_string_lossy().into_owned())
                        .or_insert(date_added);
                }
            }
        }
        seen.into_iter().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_index_resolves_only_its_entries() {
        let index = DateAddedIndex::fixed(HashMap::from([(
            "Users/arjun/Music/a.mp3".to_string(),
            1_644_628_114,
        )]));

        assert_eq!(
            index.date_added_for("Users/arjun/Music/a.mp3"),
            Some(1_644_628_114)
        );
        assert_eq!(
            index.date_added_for("A Indian/never-catalogued.mp3"),
            None,
            "an uncovered path is absent, never guessed"
        );
    }

    #[test]
    fn empty_index_is_the_no_catalogue_case() {
        let index = DateAddedIndex::fixed(HashMap::new());
        assert_eq!(index.date_added_for("Users/arjun/Music/a.mp3"), None);
    }
}
