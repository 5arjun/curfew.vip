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

/// Account linking + secure token storage (Story 2.10, AD-10): the deep-link
/// handoff from `web/`'s `/link-agent` page, OS-native secure refresh-token
/// storage, and JWT refresh/`dj_id` extraction. See [`auth`].
pub mod auth;
/// Pipeline orchestration (Story 2.8, AC-1): the first real caller of Stories
/// 1.3-1.8's engine, wiring parse -> join -> embedded-tag-fallback -> enrich ->
/// stat -> confidence into one captured session, plus the session-identity and
/// completion-signal logic [`watcher`]'s live loop drives. See [`capture`].
pub mod capture;
/// The live/practice confidence signal (Story 1.8, FR-27): classifies a whole
/// session's [`stats::EnrichedPlay`]s into a heuristic [`confidence::SessionConfidence`].
/// Not a sequential pipeline stage — a sibling consumer of the stat-engine's output,
/// classifying the session those plays came from in parallel with (not instead of)
/// Story 1.7's per-set stats. See [`confidence`].
pub mod confidence;
/// Build-time Supabase/web-URL config (Story 2.10, Task 2): the single place
/// other modules read `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`/`CURFEW_WEB_URL`
/// from. See [`config`].
pub mod config;
/// Filesystem-scope guard (Story 2.7, AC-1): confines the two Serato catalogue
/// reads (`joiner::legacy::LegacyLibrary::load`, `joiner::serato4::open_read_only`)
/// to the DJ's configured Serato root, canonicalizing before comparing so a
/// symlink or `..` cannot redirect a "scoped" read outside it. See [`fs_scope`]
/// for the deliberate exception (embedded-tag track reads, which legitimately
/// point anywhere on disk).
pub mod fs_scope;
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
/// Local SQLite store (Story 2.8, AR-3): durable parse + offline cache + raw
/// retention for captured sessions, authoritative for a set until it syncs. See
/// [`store`].
pub mod store;
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

/// The language-neutral sync-contract schema the agent consumes, embedded at
/// compile time (not resolved via a runtime filesystem path) so a bundled,
/// installed agent can load it without the `shared/` source tree existing on
/// the end-user's machine. Rust cannot import the TypeScript type in
/// `@curfew/shared`, so this checked-in JSON-schema file is the seam. Frozen,
/// additive-only forever as of Story 1.10 (AD-15).
const SYNC_PAYLOAD_SCHEMA_JSON: &str =
    include_str!("../../../shared/schema/sync-payload.schema.json");

/// Error parsing the shared sync-contract schema: its embedded contents were
/// not valid JSON. The schema is compiled into the binary (see
/// [`SYNC_PAYLOAD_SCHEMA_JSON`]), so there is no "file missing" case at
/// runtime — a missing/unreadable file is a build-time failure instead.
#[derive(Debug)]
pub enum SchemaLoadError {
    Parse(serde_json::Error),
}

impl std::fmt::Display for SchemaLoadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SchemaLoadError::Parse(e) => write!(f, "shared schema is not valid JSON: {e}"),
        }
    }
}

impl std::error::Error for SchemaLoadError {}

/// Load and parse the shared sync-contract schema. Proves Rust-side consumption
/// of the `@curfew/shared` contract (AC-2). Returns the parsed JSON document, or
/// a [`SchemaLoadError`] if the embedded schema is malformed — callers in the
/// future pipeline decide how to handle a broken contract rather than inheriting a
/// panic from this public API.
pub fn load_sync_payload_schema() -> Result<serde_json::Value, SchemaLoadError> {
    serde_json::from_str(SYNC_PAYLOAD_SCHEMA_JSON).map_err(SchemaLoadError::Parse)
}

/// Tray handles that need updating in response to auth state changes,
/// reached from outside the `.setup()` closure that originally built them —
/// managed as Tauri state so [`handle_link_url`] (and the startup
/// eager-refresh thread) can refresh the tray's status label after the fact,
/// instead of it being set once and going stale (Task 6).
struct TrayHandles {
    link_status: tauri::menu::MenuItem<tauri::Wry>,
}

/// Refreshes the tray's "Linked as `<dj_id>`"/"Not linked" status text from
/// the current in-memory auth state. Called after every auth state change —
/// a live link succeeding or failing, and the startup eager-refresh
/// finishing — so the tray never shows stale status (Task 6).
fn update_link_status_display(app: &tauri::AppHandle) {
    use tauri::Manager;

    let auth_state = app.state::<auth::AuthState>();
    let text = match auth_state
        .tokens
        .lock()
        .expect("auth token mutex poisoned")
        .as_ref()
        .and_then(|pair| auth::client::current_dj_id(&pair.access_token))
    {
        Some(dj_id) => format!("Linked as {dj_id}"),
        None => "Not linked".to_string(),
    };

    if let Some(tray) = app.try_state::<TrayHandles>() {
        let _ = tray.link_status.set_text(text);
    }
}

/// Resolves a `curfew-agent://link` URL (Story 2.10, Task 3) into a
/// [`auth::client::TokenPair`], persists the refresh token via the real OS
/// keychain, and updates the in-memory [`auth::AuthState`]. Shared by both
/// the already-running (`on_open_url`) and cold-start (`get_current()`)
/// paths, and by the single-instance forwarding callback, so the handling
/// logic is never duplicated. Never logs the raw token value — only the
/// error variant, per this crate's security-note convention.
///
/// Validates the URL's nonce against the one the agent itself generated for
/// the in-flight "Link Account" click (CSRF mitigation, Review Findings):
/// the expected nonce is taken (not cloned) out of `AuthState` up front, so
/// it is consumed exactly once regardless of whether it ends up matching —
/// an unsolicited trigger of this same URL shape (no link in flight, or a
/// replay of an already-consumed one) is rejected.
fn handle_link_url(app: &tauri::AppHandle, url: url::Url) {
    use tauri::Manager;

    let state = app.state::<auth::AuthState>();
    let expected_nonce = state
        .pending_nonce
        .lock()
        .expect("pending nonce mutex poisoned")
        .take();

    let result = match expected_nonce {
        Some(nonce) => auth::resolve_link_tokens(&url, &nonce),
        None => Err(auth::LinkError::NonceMismatch),
    };

    match result {
        Ok(pair) => {
            let store = auth::store::KeyringTokenStore;
            if let Err(_e) = auth::store::TokenStore::save(&store, &pair.refresh_token) {
                #[cfg(debug_assertions)]
                eprintln!("curfew-agent: failed to persist refresh token: {_e}");
                update_link_status_display(app);
                return;
            }
            *state.tokens.lock().expect("auth token mutex poisoned") = Some(pair);
        }
        Err(_e) => {
            #[cfg(debug_assertions)]
            eprintln!("curfew-agent: link URL rejected: {_e}");
        }
    }
    update_link_status_display(app);
}

/// Scans a second-instance launch's argv for a `curfew-agent://` URL (the
/// shape the OS hands a Windows/Linux deep-link launch on argv, per
/// `tauri-plugin-single-instance`'s pairing requirement with
/// `tauri-plugin-deep-link` — see Task 3's gotcha) and forwards it into
/// [`handle_link_url`] on the already-running instance instead of letting a
/// second agent process start.
fn forward_deep_link_from_argv(app: &tauri::AppHandle, argv: &[String]) {
    for arg in argv {
        if let Ok(url) = url::Url::parse(arg) {
            if url.scheme() == "curfew-agent" {
                handle_link_url(app, url);
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be the very first `.plugin(...)` call (the plugin's own
        // requirement) — the agent is a long-running tray background
        // process, so by the time a DJ clicks "Link Account" it's already
        // running. Without single-instance pairing, a second click launches
        // a second agent process instead of notifying the running one.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            forward_deep_link_from_argv(app, &argv);
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
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

            // Story 2.10, Task 6 (AC-1): the agent's only linking trigger — a
            // tray menu item, not a settings-panel addition or a new window
            // (UX-DR22/UX-DR23: never a full window, never mirrors the
            // website UI). The status line above it is disabled/label-only,
            // updated once below after the startup eager-refresh attempt.
            let link_status_item = MenuItem::with_id(
                app,
                "link-status",
                "Checking link status…",
                false,
                None::<&str>,
            )?;
            let link_item =
                MenuItem::with_id(app, "link-account", "Link Account", true, None::<&str>)?;

            #[cfg(debug_assertions)]
            let menu = Menu::with_items(
                app,
                &[&link_status_item, &link_item, &cycle_item, &quit_item],
            )?;
            #[cfg(not(debug_assertions))]
            let menu = Menu::with_items(app, &[&link_status_item, &link_item, &quit_item])?;

            #[cfg(debug_assertions)]
            let debug_state = std::sync::Mutex::new(TrayState::Idle);

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(default_icon)
                .tooltip("Curfew Agent")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "link-account" => {
                        // One-time CSRF nonce for this click (Review
                        // Findings): generated here, remembered in
                        // `AuthState`, and echoed back by `web/`'s
                        // `/link-agent` page in its `curfew-agent://link`
                        // redirect — `handle_link_url` rejects anything that
                        // doesn't match, so an unsolicited trigger of that
                        // same URL shape can't repoint the agent.
                        let nonce = uuid::Uuid::new_v4().to_string();
                        let auth_state = app.state::<auth::AuthState>();
                        *auth_state
                            .pending_nonce
                            .lock()
                            .expect("pending nonce mutex poisoned") = Some(nonce.clone());

                        let url = format!("{}/link-agent?nonce={}", config::CURFEW_WEB_URL, nonce);
                        if let Err(_e) =
                            tauri_plugin_opener::OpenerExt::opener(app).open_url(url, None::<&str>)
                        {
                            #[cfg(debug_assertions)]
                            eprintln!("curfew-agent: failed to open Link Account page: {_e}");
                        }
                    }
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
            //
            // A home-directory resolution failure must not take down the whole
            // tray-only agent (this used to `?`-propagate out of `.setup()`,
            // aborting tray/window creation entirely) — fall back to a path that
            // deliberately resolves nothing so OS-default detection degrades to
            // `NothingFound` instead, while a manual override (which doesn't
            // depend on `home` at all) still works via the tray settings panel.
            let home = app.path().home_dir().unwrap_or_else(|_| {
                #[cfg(debug_assertions)]
                eprintln!(
                    "curfew-agent: could not resolve home directory, Serato OS-default \
                     auto-detection will find nothing (manual override via tray still works)"
                );
                PathBuf::from("/curfew-agent-home-dir-unresolved")
            });
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

            // Story 2.10 (AD-10): account linking + secure token storage.
            // Managed before the deep-link handlers below so they always
            // have somewhere to write.
            app.manage(auth::AuthState::default());
            // Also managed here (rather than kept as a bare local variable)
            // so `handle_link_url`/the eager-refresh thread below can reach
            // the tray's status text after `.setup()` returns.
            app.manage(TrayHandles {
                link_status: link_status_item,
            });

            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        handle_link_url(&handle, url);
                    }
                });

                // Cold-start case: the OS launched the agent directly via the
                // link (less likely than an already-running instance, since
                // the agent auto-launches, but still possible on some
                // platforms/flows). Both paths converge on `handle_link_url`
                // (Task 3) so the parsing/persistence logic is never
                // duplicated. A plugin-level error here (not just "no
                // pending URL") must not take down the whole tray-only agent
                // — same reasoning as the home-dir fallback above, handled
                // gracefully rather than `?`-propagated out of `.setup()`.
                match app.deep_link().get_current() {
                    Ok(Some(urls)) => {
                        for url in urls {
                            handle_link_url(app.handle(), url);
                        }
                    }
                    Ok(None) => {}
                    Err(_e) => {
                        #[cfg(debug_assertions)]
                        eprintln!("curfew-agent: failed to check cold-start deep link: {_e}");
                    }
                }
            }

            // Startup eager-refresh (Task 5): if a refresh token was already
            // persisted from a previous run but no in-memory access token
            // exists yet (the normal case after every restart — access
            // tokens are never persisted), refresh once now so the agent is
            // sync-ready immediately rather than waiting for a first caller
            // to trigger it lazily. A missing refresh token (never linked,
            // or cleared) is not an error — `get_valid_access_token` surfaces
            // that as `AuthError::NotLinked`, which is a no-op here.
            //
            // Run on a spawned thread, not inline in `.setup()` (Review
            // Findings): `SupabaseAuthClient` now applies a bounded HTTP
            // timeout (see `client.rs`), but `.setup()` still must not block
            // agent startup on network I/O, and a blocking `reqwest` client
            // must never risk being constructed on a thread that could
            // already have an async runtime entered. The tray keeps showing
            // "Checking link status…" (set above) until this finishes.
            {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    use tauri::Manager;
                    let auth_state = app_handle.state::<auth::AuthState>();
                    if let Err(_e) = auth::client::get_valid_access_token(
                        &auth_state.tokens,
                        &auth::store::KeyringTokenStore,
                        &auth::client::SupabaseAuthClient::new(),
                    ) {
                        #[cfg(debug_assertions)]
                        eprintln!("curfew-agent: startup token refresh failed: {_e}");
                    }
                    update_link_status_display(&app_handle);
                });
            }

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
