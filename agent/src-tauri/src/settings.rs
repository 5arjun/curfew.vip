//! Settings persistence (Story 2.5, AC-2). The agent's only user-configurable
//! setting at this stage is a manual Serato folder path override — this module
//! accepts, validates-as-a-path-string, and persists it. It does **not** wire the
//! override into real Serato folder detection/watching; that consumption is
//! Story 2.6's job.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE_NAME: &str = "settings.json";

#[derive(Debug, Default, Serialize, Deserialize, Clone, PartialEq)]
pub struct AgentSettings {
    /// Manual override for the Serato folder; `None` until the DJ sets one.
    pub serato_path_override: Option<String>,
}

#[derive(Debug)]
pub enum SettingsError {
    Io(std::io::Error),
    Json(serde_json::Error),
    NoAppConfigDir,
}

impl std::fmt::Display for SettingsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SettingsError::Io(e) => write!(f, "settings I/O error: {e}"),
            SettingsError::Json(e) => write!(f, "settings file is not valid JSON: {e}"),
            SettingsError::NoAppConfigDir => write!(f, "could not resolve app config directory"),
        }
    }
}

impl std::error::Error for SettingsError {}

/// Read settings from an exact file path. Returns defaults if the file doesn't
/// exist yet (first launch, no override set). Split from [`load`] so the
/// round-trip logic is testable without a running Tauri app.
pub fn load_from(path: &Path) -> Result<AgentSettings, SettingsError> {
    if !path.exists() {
        return Ok(AgentSettings::default());
    }
    let raw = std::fs::read_to_string(path).map_err(SettingsError::Io)?;
    serde_json::from_str(&raw).map_err(SettingsError::Json)
}

/// Write settings to an exact file path, creating parent directories as needed.
/// Writes to a sibling temp file and renames it into place so a crash or a
/// racing concurrent write can never leave `path` truncated/corrupted —
/// readers always see either the old contents or the new ones, never a
/// partial write.
pub fn save_to(path: &Path, settings: &AgentSettings) -> Result<(), SettingsError> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent).map_err(SettingsError::Io)?;
    let raw = serde_json::to_string_pretty(settings).map_err(SettingsError::Json)?;
    let tmp_path = parent.join(format!(
        ".{}.tmp-{}",
        SETTINGS_FILE_NAME,
        std::process::id()
    ));
    std::fs::write(&tmp_path, raw).map_err(SettingsError::Io)?;
    std::fs::rename(&tmp_path, path).map_err(SettingsError::Io)
}

fn settings_file_path(app: &AppHandle) -> Result<PathBuf, SettingsError> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|_| SettingsError::NoAppConfigDir)?;
    Ok(dir.join(SETTINGS_FILE_NAME))
}

pub fn load(app: &AppHandle) -> Result<AgentSettings, SettingsError> {
    load_from(&settings_file_path(app)?)
}

pub fn save(app: &AppHandle, settings: &AgentSettings) -> Result<(), SettingsError> {
    save_to(&settings_file_path(app)?, settings)
}

/// Read the current Serato path override, if one has been set. Called by the
/// settings panel on open to pre-fill the field.
#[tauri::command]
pub fn get_serato_path_override(app: AppHandle) -> Result<Option<String>, String> {
    load(&app)
        .map(|s| s.serato_path_override)
        .map_err(|e| e.to_string())
}

/// Checks whether a trimmed, non-empty path string resolves to at least one
/// live history source once resolved into a full [`crate::watcher::detect::WatchPlan`]
/// (Story 3.3b, AC-4) — not merely whether *this* path alone classifies. A
/// Serato 4+ DJ pointing at a genuinely history-less folder (the incident
/// configuration — a USB `_Serato_` carrying a library but no play history)
/// must still be **accepted**, because the fixed internal `master.sqlite`
/// will be watched regardless of what this override resolves to (AC-3);
/// only a DJ with truly nothing anywhere is rejected. Split out from
/// [`set_serato_path_override`] so it is unit-testable without an
/// `AppHandle` — the command itself needs a running Tauri app and has no
/// test coverage today, same as `get_serato_path_override`.
fn validate_override(
    trimmed: &str,
    home: &Path,
    disks: &dyn crate::watcher::detect::DiskSource,
) -> Result<(), String> {
    let plan = crate::watcher::detect::resolve_watch_plan(Some(trimmed), home, disks);
    if plan.serato4.is_none() && plan.legacy.is_none() {
        // Verbatim per AC-4 (Failure Register: calm, technical, no
        // exclamation) — replaces the longer per-format-detail string this
        // story's incident showed was misleading (it implied *this* folder
        // alone was the only thing that mattered).
        return Err("No Serato library found here — point me at your `_Serato_` folder.".into());
    }
    Ok(())
}

/// Persist a new Serato path override. Accepts a non-empty path string whose
/// resolved plan carries at least one live history source (Story 3.3b,
/// AC-4) — this is the confirm action itself (UX-DR20): nothing commits
/// without passing this check, synchronously, at Save.
///
/// A malformed/corrupt existing settings file must never block saving a new
/// override — falls back to defaults rather than propagating the load error,
/// since this call is about to overwrite the file anyway.
#[tauri::command]
pub fn set_serato_path_override(app: AppHandle, path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("path override cannot be empty".into());
    }
    let home = crate::watcher::resolve_home(&app);
    validate_override(trimmed, &home, &crate::watcher::detect::SystemDisks)?;
    let mut settings = load(&app).unwrap_or_default();
    settings.serato_path_override = Some(trimmed.to_string());
    save(&app, &settings).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// No removable volumes — mirrors `watcher::detect`/`watcher::mod`'s own
    /// local `NoDisks` fixture (duplicated per this crate's "no shared
    /// test-support crate" convention).
    struct NoDisks;
    impl crate::watcher::detect::DiskSource for NoDisks {
        fn removable_mount_points(&self) -> Vec<PathBuf> {
            vec![]
        }
    }

    /// A scratch temp dir, unique per test, cleaned up on drop — used as
    /// both the override candidate and the `home` param below.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "curfew-settings-validate-{tag}-{}-{n}",
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

    /// Story 2.6 Task 3 / Story 3.3b AC-4: a folder that resolves to a real
    /// Serato install passes validation; anything else is a clear `Err`,
    /// never a silently accepted garbage path. `home` here is an unrelated,
    /// empty temp dir — this override alone must be sufficient.
    #[test]
    fn validate_override_accepts_a_real_legacy_folder() {
        let serato_dir = TempDir::new("legacy-ok");
        std::fs::write(serato_dir.0.join("database V2"), b"").unwrap();
        let home = TempDir::new("legacy-ok-home");

        let result = validate_override(serato_dir.0.to_str().unwrap(), &home.0, &NoDisks);

        assert!(result.is_ok());
    }

    #[test]
    fn validate_override_rejects_a_folder_with_no_history_and_no_internal_serato4_anywhere() {
        let dir = TempDir::new("empty");
        let home = TempDir::new("empty-home");

        let result = validate_override(dir.0.to_str().unwrap(), &home.0, &NoDisks);

        assert!(result.is_err(), "an unrecognized path must be a clear Err");
        assert_eq!(
            result.unwrap_err(),
            "No Serato library found here — point me at your `_Serato_` folder.",
            "AC-4's rejection copy must be verbatim"
        );
    }

    /// Story 3.3b, AC-3/AC-4 — the incident configuration itself: a Serato 4+
    /// DJ's override points at a folder with a library but genuinely no play
    /// history (e.g. a migrated USB `_Serato_`). Because the fixed internal
    /// `master.sqlite` will be watched regardless (AC-3), this override must
    /// be **accepted**, not rejected — the exact behavior change this story
    /// exists to make.
    #[test]
    fn validate_override_accepts_a_no_history_folder_when_the_internal_serato4_install_exists() {
        let usb = TempDir::new("no-history-usb");
        std::fs::write(usb.0.join("database V2"), b"").unwrap(); // library, no History/
        let home = TempDir::new("no-history-home");
        std::fs::create_dir_all(
            home.0
                .join(crate::watcher::detect::SERATO4_HOME_RELPATH)
                .parent()
                .unwrap(),
        )
        .unwrap();
        std::fs::write(
            home.0.join(crate::watcher::detect::SERATO4_HOME_RELPATH),
            b"",
        )
        .unwrap();

        let result = validate_override(usb.0.to_str().unwrap(), &home.0, &NoDisks);

        assert!(
            result.is_ok(),
            "a no-history override must still be accepted when the internal serato4 install exists"
        );
    }

    /// A scratch file path under the OS temp dir, unique per test so parallel
    /// `cargo test` runs never collide.
    struct TempSettingsFile(PathBuf);

    impl TempSettingsFile {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let n = COUNTER.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "curfew-agent-settings-test-{tag}-{}-{n}",
                std::process::id()
            ));
            Self(dir.join("settings.json"))
        }
    }

    impl Drop for TempSettingsFile {
        fn drop(&mut self) {
            if let Some(parent) = self.0.parent() {
                let _ = std::fs::remove_dir_all(parent);
            }
        }
    }

    #[test]
    fn missing_file_loads_as_default() {
        let file = TempSettingsFile::new("missing");
        let settings = load_from(&file.0).expect("missing file must load as default, not error");
        assert_eq!(settings, AgentSettings::default());
        assert_eq!(settings.serato_path_override, None);
    }

    #[test]
    fn save_then_load_round_trips_the_override() {
        let file = TempSettingsFile::new("roundtrip");
        let settings = AgentSettings {
            serato_path_override: Some("/Users/dj/Music/_Serato_".to_string()),
        };
        save_to(&file.0, &settings).expect("save must succeed, creating parent dirs");
        let loaded = load_from(&file.0).expect("load must succeed after save");
        assert_eq!(loaded, settings);
    }

    #[test]
    fn save_leaves_no_leftover_temp_file() {
        let file = TempSettingsFile::new("no-leftover-tmp");
        save_to(
            &file.0,
            &AgentSettings {
                serato_path_override: Some("/some/path".to_string()),
            },
        )
        .expect("save must succeed");
        let siblings: Vec<_> = std::fs::read_dir(file.0.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        assert_eq!(
            siblings,
            vec![std::ffi::OsString::from(SETTINGS_FILE_NAME)],
            "atomic rename must not leave the temp file behind"
        );
    }

    #[test]
    fn save_succeeds_even_when_existing_file_is_corrupt_json() {
        let file = TempSettingsFile::new("recover-from-corrupt");
        std::fs::create_dir_all(file.0.parent().unwrap()).unwrap();
        std::fs::write(&file.0, "{ not valid json").unwrap();
        assert!(load_from(&file.0).is_err(), "sanity: file starts corrupt");

        save_to(
            &file.0,
            &AgentSettings {
                serato_path_override: Some("/new/path".to_string()),
            },
        )
        .expect("save must overwrite a corrupt file, not be blocked by it");
        let loaded = load_from(&file.0).expect("file must be valid JSON after save");
        assert_eq!(loaded.serato_path_override.as_deref(), Some("/new/path"));
    }

    #[test]
    fn save_overwrites_a_previous_override() {
        let file = TempSettingsFile::new("overwrite");
        save_to(
            &file.0,
            &AgentSettings {
                serato_path_override: Some("/old/path".to_string()),
            },
        )
        .unwrap();
        save_to(
            &file.0,
            &AgentSettings {
                serato_path_override: Some("/new/path".to_string()),
            },
        )
        .unwrap();
        let loaded = load_from(&file.0).unwrap();
        assert_eq!(loaded.serato_path_override.as_deref(), Some("/new/path"));
    }
}
