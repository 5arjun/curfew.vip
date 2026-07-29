//! Curfew local agent — Tauri 2 core.
//!
//! Architecture (ARCHITECTURE-SPINE / SOLUTION-DESIGN §2): this core is a
//! pipes-and-filters pipeline —
//!   watcher -> parser -> joiner -> stat-engine -> local store -> sync-queue
//! each an independently testable filter with a typed hand-off (`confidence` is a
//! sibling consumer of the stat-engine's output, not a stage in this chain — see
//! [`confidence`]). Those filters land in Stories 1.3-1.7.
//!
//! Dependency rule (AD-3): `agent` depends on `shared` (via the JSON-schema
//! artifact), never on `web`.

/// The live/practice confidence signal (Story 1.8, FR-27): classifies a whole
/// session's [`stats::EnrichedPlay`]s into a heuristic [`confidence::SessionConfidence`].
/// Not a sequential pipeline stage — a sibling consumer of the stat-engine's output,
/// classifying the session those plays came from in parallel with (not instead of)
/// Story 1.7's per-set stats. See [`confidence`].
pub mod confidence;
/// The `genre` pipeline filter (Story 1.6): normalizes a raw genre string to the
/// fixed Curfew taxonomy, producing a raw + normalized + `taxonomy_version` triple
/// (AD-12). Sits after the `joiner` (which supplies the raw genre) and before the
/// stat-engine (which will consume the normalized value). See [`genre`].
pub mod genre;
/// The `joiner` pipeline filter (Story 1.4): resolves a played track to the
/// BPM/key/genre held by the DJ's Serato library, across both library formats.
/// See [`joiner`] for the two paths and their shared invariants.
pub mod joiner;
/// The `parser` pipeline filter: decodes a legacy Serato `.session` file (Story 1.3)
/// or reads Serato 4+'s `master.sqlite` play log directly (Story 1.3b) into an ordered
/// list of plays. See [`parser`] for the formats and invariants.
pub mod parser;
/// Local settings persistence (Story 2.5): the Serato folder path override, the
/// only setting this agent currently exposes. See [`settings`].
pub mod settings;
/// The `stat-engine` pipeline filter (Story 1.7): assembles a `parser::Play` and its
/// `joiner::JoinedMetadata` into one `EnrichedPlay` record, then computes per-set
/// summary stats, Camelot-wheel mixing stats, and the energy-arc series — all
/// arithmetic-only (NFR-1, NFR-3). See [`stats`] for the assembly step and stat
/// functions.
pub mod stats;
/// Tray state machine (Story 2.5): the four idle/syncing/failed/drive-not-connected
/// states and the tooltip/icon update this agent's sole UI surface uses. See
/// [`tray`].
pub mod tray;
/// The `watcher` pipeline stage (Story 2.6): Serato install auto-detection
/// (OS defaults + removable volumes), the manual-override/first-run-confirm
/// precedence, and the live watch loop (new-session detection + drive
/// reconnect). See [`watcher`].
pub mod watcher;

use std::path::PathBuf;

/// Location of the language-neutral sync-contract schema the agent consumes,
/// relative to this crate's manifest dir (`agent/src-tauri`). Rust cannot import
/// the TypeScript type in `@curfew/shared`, so the checked-in JSON-schema file is
/// the seam. Frozen, additive-only forever as of Story 1.10 (AD-15).
pub const SYNC_PAYLOAD_SCHEMA_RELPATH: &str = "../../shared/schema/sync-payload.schema.json";

/// Absolute path to the shared sync-contract schema, resolved from this crate.
pub fn sync_payload_schema_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(SYNC_PAYLOAD_SCHEMA_RELPATH)
}

/// Error loading the shared sync-contract schema: either the file could not be
/// read or its contents were not valid JSON.
#[derive(Debug)]
pub enum SchemaLoadError {
    Read(std::io::Error),
    Parse(serde_json::Error),
}

impl std::fmt::Display for SchemaLoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SchemaLoadError::Read(e) => write!(f, "failed to read shared schema: {e}"),
            SchemaLoadError::Parse(e) => write!(f, "shared schema is not valid JSON: {e}"),
        }
    }
}

impl std::error::Error for SchemaLoadError {}

/// Load and parse the shared sync-contract schema. Proves Rust-side consumption
/// of the `@curfew/shared` contract (AC-2). Returns the parsed JSON document, or
/// a [`SchemaLoadError`] if the seam file is missing or malformed — callers in the
/// future pipeline decide how to handle a broken contract rather than inheriting a
/// panic from this public API.
pub fn load_sync_payload_schema() -> Result<serde_json::Value, SchemaLoadError> {
    let path = sync_payload_schema_path();
    let raw = std::fs::read_to_string(&path).map_err(SchemaLoadError::Read)?;
    serde_json::from_str(&raw).map_err(SchemaLoadError::Parse)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            settings::get_serato_path_override,
            settings::set_serato_path_override,
            watcher::get_pending_detected_path,
        ])
        .setup(|app| {
            // Tray-only surface (UX-DR23): the agent lives in the system tray, not
            // in a window. The `main` window is the settings panel — defined but
            // starts hidden; clicking the tray icon toggles it, and closing it just
            // hides it again rather than tearing it down (otherwise the tray click
            // handler could never reopen it).
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri::{Manager, WindowEvent};
            use tray::{set_tray_state, TrayState, TRAY_ID};

            // Don't show a Dock icon / Cmd+Tab entry for a tray-only app.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let window = app
                .get_webview_window("main")
                .ok_or("agent: main window not found during setup")?;

            let close_target = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = close_target.hide();
                }
            });

            let default_icon = app
                .default_window_icon()
                .cloned()
                .ok_or("agent: missing bundled default icon; tray cannot start")?;

            // Debug-only: cycles the tray through all four states so AC-1 can be
            // manually verified without real sync/watcher logic (that's 2.6/2.8/3.x).
            // Not present in release builds.
            #[cfg(debug_assertions)]
            let cycle_item = MenuItem::with_id(
                app,
                "debug-cycle-state",
                "Cycle tray state (debug)",
                true,
                None::<&str>,
            )?;

            let quit_item =
                MenuItem::with_id(app, "quit", "Quit Curfew Agent", true, None::<&str>)?;

            #[cfg(debug_assertions)]
            let menu = Menu::with_items(app, &[&cycle_item, &quit_item])?;
            #[cfg(not(debug_assertions))]
            let menu = Menu::with_items(app, &[&quit_item])?;

            #[cfg(debug_assertions)]
            let debug_state = std::sync::Mutex::new(TrayState::Idle);

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(default_icon)
                .tooltip("Curfew Agent")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    #[cfg(debug_assertions)]
                    "debug-cycle-state" => {
                        let mut state =
                            debug_state.lock().expect("debug tray state mutex poisoned");
                        *state = state.next();
                        let _ = set_tray_state(app, *state);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = if window.is_visible().unwrap_or(false) {
                                window.hide()
                            } else {
                                let _ = window.show();
                                window.set_focus()
                            };
                        }
                    }
                })
                .build(app)?;

            // Apply the real per-state icon/tooltip now that the tray exists —
            // defaults to Idle; Story 2.6's detection below may immediately
            // override this to DriveNotConnected if a confirmed override no
            // longer resolves at launch.
            set_tray_state(app.handle(), TrayState::Idle)?;

            // Story 2.6: find (or confirm, or start watching) the DJ's Serato
            // install. An existing manual override (Story 2.5) is the single
            // source of truth and skips detection entirely (Task 3); otherwise
            // OS defaults + removable volumes are scanned (Tasks 1-2) and, if
            // something is found, the DJ must confirm it before it is used
            // (Task 4, UX-DR20 — never silent).
            let home = app
                .path()
                .home_dir()
                .map_err(|_| "agent: could not resolve home directory for Serato detection")?;
            let settings = settings::load(app.handle()).unwrap_or_default();
            let resolution =
                watcher::resolve_startup(&settings, &home, &watcher::detect::SystemDisks);

            let pending_detected_path = match &resolution {
                watcher::StartupResolution::PendingConfirmation(path) => Some(path.clone()),
                watcher::StartupResolution::Confirmed(_)
                | watcher::StartupResolution::NothingFound => None,
            };
            app.manage(watcher::PendingDetectionState(std::sync::Mutex::new(
                pending_detected_path,
            )));

            if let watcher::StartupResolution::PendingConfirmation(_) = resolution {
                // AC-3: the confirm gate must not depend on the DJ thinking to
                // click the tray icon — this window starts `visible: false`
                // (Story 2.5) and only reveals on tray click otherwise.
                window.show()?;
                window.set_focus()?;
            }

            // Always started, regardless of resolution: the loop itself tracks
            // the live override on disk (see `watch_loop`'s doc comment), so it
            // picks up a path saved via the confirm UI just now, or edited later
            // from the tray settings panel, without needing a relaunch.
            watcher::start_watching(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// AC-2 (Rust side): the agent can load the shared JSON-schema and it carries
    /// the contract version + the AR-15 fixed enums, matching `@curfew/shared`.
    ///
    /// Also proves the frozen shape from Story 1.10: `set.plays[]` carries the
    /// `EnrichedPlay`/`JoinedMetadata.in_library`-derived fields, and
    /// `set.derived.confidence` carries the Story 1.8 confidence signal.
    #[test]
    fn parses_shared_sync_contract_schema() {
        let schema = load_sync_payload_schema().expect("shared sync-contract schema must load");

        assert_eq!(
            schema["properties"]["contract_version"]["const"], 1,
            "contract_version const must match CONTRACT_VERSION in @curfew/shared"
        );
        assert_eq!(
            schema["properties"]["source"]["enum"],
            serde_json::json!(["serato"]),
            "source enum drifted from @curfew/shared"
        );

        // Story 1.10 Task 1: visibility/segments are web-authored overlays (AD-6)
        // and must never appear on the agent's outbound payload.
        assert!(
            schema["properties"]["set"]["properties"]["visibility"].is_null(),
            "set.visibility must not be present on the frozen sync payload (AD-6/AD-16)"
        );
        assert!(
            schema["properties"]["segments"].is_null(),
            "top-level segments must not be present on the frozen sync payload (AD-6/AD-16)"
        );
        assert!(
            schema["$defs"]["segment"].is_null(),
            "$defs.segment must not be present on the frozen sync payload (AD-6/AD-16)"
        );

        // Story 1.10 Task 2: set.plays[] shape, sourced from EnrichedPlay + JoinedMetadata.in_library.
        let play_required = schema["$defs"]["play"]["required"]
            .as_array()
            .expect("play $def must declare required fields");
        for field in ["position", "genre", "camelot_key", "in_library"] {
            assert!(
                play_required.iter().any(|v| v == field),
                "play.{field} must be required on the frozen sync payload"
            );
        }
        assert_eq!(
            schema["$defs"]["play"]["properties"]["in_library"]["type"],
            serde_json::json!("boolean"),
            "play.in_library must be a required, non-nullable boolean"
        );
        let mut genre_required: Vec<&str> = schema["$defs"]["genre"]["required"]
            .as_array()
            .expect("genre $def must declare required fields")
            .iter()
            .map(|v| v.as_str().expect("required entries must be strings"))
            .collect();
        genre_required.sort_unstable();
        assert_eq!(
            genre_required,
            vec!["normalized", "raw", "taxonomy_version"],
            "play.genre must carry raw/normalized/taxonomy_version verbatim (AD-12)"
        );

        // Story 1.10 Task 3: set.derived carries the stat-engine + confidence outputs.
        let derived_required = schema["$defs"]["derived"]["required"]
            .as_array()
            .expect("derived $def must declare required fields");
        for field in [
            "most_played_tracks",
            "most_played_artists",
            "genre_breakdown",
            "bpm_distribution",
            "camelot_mixing_stats",
            "set_length_sec",
            "track_count",
            "energy_arc",
            "confidence",
        ] {
            assert!(
                derived_required.iter().any(|v| v == field),
                "derived.{field} must be required on the frozen sync payload"
            );
        }
        let mut confidence_required: Vec<&str> = schema["$defs"]["confidence"]["required"]
            .as_array()
            .expect("confidence $def must declare required fields")
            .iter()
            .map(|v| v.as_str().expect("required entries must be strings"))
            .collect();
        confidence_required.sort_unstable();
        assert_eq!(
            confidence_required,
            vec!["long_gap_count", "track_count", "value"],
            "derived.confidence must mirror SessionConfidence's fields (Story 1.8)"
        );
    }
}
