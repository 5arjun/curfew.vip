//! Curfew local agent — Tauri 2 core.
//!
//! Architecture (ARCHITECTURE-SPINE / SOLUTION-DESIGN §2): this core is a
//! pipes-and-filters pipeline —
//!   watcher -> parser -> joiner -> stat-engine -> local store -> sync-queue
//! each an independently testable filter with a typed hand-off. Those filters
//! land in Stories 1.3-1.7; this story only proves the shell compiles and that
//! the Rust side can consume the shared sync contract (AC-2).
//!
//! Dependency rule (AD-3): `agent` depends on `shared` (via the JSON-schema
//! artifact), never on `web`.

/// The `parser` pipeline filter (Story 1.3): decodes a legacy Serato `.session`
/// file into an ordered list of plays. See [`parser`] for the format and invariants.
pub mod parser;

use std::path::PathBuf;

/// Location of the language-neutral sync-contract schema the agent consumes,
/// relative to this crate's manifest dir (`agent/src-tauri`). Rust cannot import
/// the TypeScript type in `@curfew/shared`, so the checked-in JSON-schema file is
/// the seam. DRAFT until Story 1.10 (AR-1).
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
        .setup(|app| {
            // Tray-only surface (UX-DR23): the agent lives in the system tray, not
            // in a window. The `main` window is defined but starts hidden; clicking
            // the tray icon toggles it, and closing it just hides it again rather
            // than tearing it down (otherwise the tray click handler could never
            // reopen it). A full settings UI is a later story.
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri::{Manager, WindowEvent};

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

            let icon = app
                .default_window_icon()
                .cloned()
                .ok_or("agent: missing bundled default icon; tray cannot start")?;

            let quit_item =
                MenuItem::with_id(app, "quit", "Quit Curfew Agent", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit_item])?;

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("Curfew Agent")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.exit(0);
                    }
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
        assert_eq!(
            schema["properties"]["set"]["properties"]["visibility"]["enum"],
            serde_json::json!(["public", "friends_only", "private"]),
            "visibility enum drifted from @curfew/shared"
        );
        assert_eq!(
            schema["$defs"]["segment"]["properties"]["type"]["enum"],
            serde_json::json!(["dancefloor", "dinner", "performance", "custom"]),
            "segment type enum drifted from @curfew/shared"
        );
    }
}
