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
/// Startup backfill/reprocess sweep (Story 3.4, Task 3, AR-7 layer 3): retries
/// every unresolved `parse_failures` row against the current build, once a
/// version bump (shipped via [`crate::error_reporting`]'s sibling layer-3
/// updater loop) makes a retry worth attempting. See [`backfill`].
pub mod backfill;
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
/// Agent-side tagged error reporting (Story 3.4, Task 1, AD-13/AR-7 layer 2):
/// the `ErrorReporter` trait + `SentryReporter`, reporting terminal capture
/// failures to Sentry tagged with `agent_version`. See [`error_reporting`].
pub mod error_reporting;
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
/// Agent-status heartbeat (Story 3.9, AD-20): the agent's one sanctioned cloud
/// write beyond the idempotent set sync — POSTs the current `tray::TrayState`
/// to the `set_agent_status` RPC on every `sync_queue` drain pass, so the web
/// dashboard can tell a live-but-idle agent from a silent one. Fire-and-forget;
/// never blocks or gates sync. See [`heartbeat`].
pub mod heartbeat;
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
/// Sync-queue client (Story 3.2, AR-2/AD-4): the synchronous, online-only
/// half of the pipeline's `sync-queue` stage — computes the deterministic
/// `set_id = hash(dj_id, session_identity)` and pushes captured sessions to
/// the cloud via an idempotent PostgREST RPC call. See [`sync`].
pub mod sync;
/// Offline sync-queue drain loop (Story 3.3, AR-2/AD-4): the backoff-driven
/// background thread that periodically retries [`sync::sync_pending_sessions`]
/// and drives `tray::TrayState::Queued` while a backlog exists. See
/// [`sync_queue`].
pub mod sync_queue;
/// Tray state machine (Story 2.5): the four idle/syncing/failed/drive-not-connected
/// states and the tooltip/icon update this agent's sole UI surface uses. See
/// [`tray`].
pub mod tray;
/// The `watcher` pipeline stage (Story 2.6): Serato install auto-detection
/// (OS defaults + removable volumes), the manual-override/first-run-confirm
/// precedence, and the live watch loop (new-session detection + drive
/// reconnect). See [`watcher`].
pub mod watcher;

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

/// The event the settings panel listens on to re-render its account row.
///
/// The panel is a *persistent* webview (`main` is shown/hidden, never
/// recreated), so `ui/index.html`'s `invoke("get_linked_account")` runs once
/// per process — not once per open. Without this push, a link that succeeded
/// while the panel existed left it reading "Not linked yet" until the whole
/// agent was restarted, which is exactly what happened on 2026-08-20: the
/// token was in the keychain for eight minutes while the panel — the first
/// screen a paying DJ meets — insisted nothing had happened.
const LINK_STATUS_EVENT: &str = "link-status-changed";

/// What the panel receives on [`LINK_STATUS_EVENT`]: the same shape
/// [`get_linked_account`] returns, plus the reason the last attempt failed,
/// if it did.
#[derive(serde::Serialize, Clone)]
struct LinkStatusChanged {
    linked: bool,
    email: Option<String>,
    /// Human-readable and safe to display — a `LinkError`'s variant text,
    /// never a token value (this crate's security-note convention).
    error: Option<String>,
}

/// Refreshes the tray's "Linked as `<dj_id>`"/"Not linked" status text from
/// the current in-memory auth state, and pushes the same change to the
/// settings panel. Called after every auth state change — a live link
/// succeeding or failing, and the startup eager-refresh finishing — so
/// neither surface shows stale status (Task 6).
///
/// `error` is `Some` only on a rejected link, and is what turns the panel's
/// silent no-op into a recoverable message.
fn update_link_status_display(app: &tauri::AppHandle, error: Option<String>) {
    use tauri::{Emitter, Manager};

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

    let account = resolve_linked_account(app);
    let _ = app.emit(
        LINK_STATUS_EVENT,
        LinkStatusChanged {
            linked: account.linked,
            email: account.email,
            error,
        },
    );
}

/// Starts the "Link Account" handshake: mints this click's one-time CSRF
/// nonce, remembers it in [`auth::AuthState`], and opens `/link-agent` in the
/// DJ's browser.
///
/// Extracted from the tray menu handler on 2026-08-17 so the tray item and
/// the settings panel's own Link button run the *same* code. The nonce is the
/// reason this matters: a second, hand-rolled copy of this flow that forgot
/// to store the nonce would open a browser page whose redirect
/// `handle_link_url` then silently rejects — a link button that appears to
/// work and never links. One implementation, one nonce discipline.
fn begin_link(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    let nonce = uuid::Uuid::new_v4().to_string();
    let auth_state = app.state::<auth::AuthState>();
    *auth_state
        .pending_nonce
        .lock()
        .expect("pending nonce mutex poisoned") = Some(nonce.clone());

    let url = format!("{}/link-agent?nonce={}", config::CURFEW_WEB_URL, nonce);
    tauri_plugin_opener::OpenerExt::opener(app)
        .open_url(url, None::<&str>)
        .map_err(|e| format!("Could not open the link page: {e}"))
}

/// What the settings panel renders in its account row.
///
/// `email` is `None` in a real, common case that is NOT "unlinked": only the
/// refresh token is persisted (`auth::store`'s module doc), and a Supabase
/// refresh token is an opaque string carrying no identity. So on a fresh
/// launch, before anything has refreshed the access token into memory, the
/// agent knows it is linked but cannot say to whom. The panel distinguishes
/// the three states rather than collapsing the middle one into "not linked",
/// which would tell a correctly-linked DJ to link again.
#[derive(serde::Serialize)]
pub struct LinkedAccount {
    linked: bool,
    email: Option<String>,
}

/// Reads the current link state for the settings panel. Never refreshes, never
/// hits the network, and never writes: this runs on every panel open, and a
/// display-only row must not be able to mutate auth state or block on a
/// server. Reads the in-memory access token first (the only thing that
/// carries an email), then falls back to "is a refresh token stored at all".
#[tauri::command]
fn get_linked_account(app: tauri::AppHandle) -> LinkedAccount {
    resolve_linked_account(&app)
}

/// The account row's state, resolved once and shared by the panel's initial
/// `invoke` and by every [`LINK_STATUS_EVENT`] push, so the two can never
/// disagree about what "linked" means.
fn resolve_linked_account(app: &tauri::AppHandle) -> LinkedAccount {
    use auth::store::TokenStore;
    use tauri::Manager;

    let state = app.state::<auth::AuthState>();
    let in_memory = state
        .tokens
        .lock()
        .expect("auth tokens mutex poisoned")
        .as_ref()
        .map(|pair| pair.access_token.clone());

    if let Some(access_token) = in_memory {
        return LinkedAccount {
            linked: true,
            email: auth::client::current_email(&access_token),
        };
    }

    LinkedAccount {
        linked: matches!(auth::store::KeyringTokenStore.load(), Ok(Some(_))),
        email: None,
    }
}

/// The settings panel's Link button (2026-08-17). Same handshake as the tray
/// item — see [`begin_link`].
#[tauri::command]
fn start_link(app: tauri::AppHandle) -> Result<(), String> {
    begin_link(&app)
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

    // Every branch below reports, including the failures. These were
    // `#[cfg(debug_assertions)]`-only until 2026-08-20, which meant a rejected
    // link in a *release* build produced nothing at all: no log line, no tray
    // change, no panel change. The DJ clicked, the browser handed off, and
    // both ends stayed silent — indistinguishable from the app not being
    // installed. A rejection the DJ can act on is the whole point of the
    // handshake having a failure mode.
    match result {
        Ok(pair) => {
            let store = auth::store::KeyringTokenStore;
            if let Err(e) = auth::store::TokenStore::save(&store, &pair.refresh_token) {
                eprintln!("curfew-agent: failed to persist refresh token: {e}");
                update_link_status_display(
                    app,
                    Some("Could not save the account to your keychain. Try linking again.".into()),
                );
                return;
            }
            *state.tokens.lock().expect("auth token mutex poisoned") = Some(pair);
            update_link_status_display(app, None);
        }
        Err(e) => {
            eprintln!("curfew-agent: link URL rejected: {e}");
            update_link_status_display(app, Some(link_rejection_message(&e)));
        }
    }
}

/// Turns a [`auth::LinkError`] into something a DJ can act on, rather than
/// the internal variant text.
///
/// `NonceMismatch` is the one that actually happens in practice, and its
/// cause is mundane: the one-time nonce lives in memory and is consumed on
/// first use, so a second click on an already-used `/link-agent` tab, or any
/// click after the agent restarted mid-handshake, lands here. The recovery is
/// always the same and the DJ has no way to guess it — start the handshake
/// again from the agent so a fresh nonce is minted.
fn link_rejection_message(error: &auth::LinkError) -> String {
    match error {
        auth::LinkError::NonceMismatch => {
            "That link has already been used or has expired. Click Link Account to try again."
                .into()
        }
        auth::LinkError::Url(_) => {
            "That link was malformed. Click Link Account to try again.".into()
        }
        auth::LinkError::Token(_) => {
            "Your sign-in could not be read. Sign in on curfew.vip, then click Link Account again."
                .into()
        }
    }
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

/// Where the menu bar icon currently sits, in physical pixels
/// (`x, y, width, height`), captured from whichever [`tauri::tray::TrayIconEvent`]
/// last fired. `None` until the pointer has touched the tray at least once.
///
/// The settings panel is anchored to this so it drops out of the icon like a
/// native popover rather than appearing wherever the window manager feels like.
/// It has to be remembered rather than queried, because Tauri exposes the
/// icon's rect only on an event — there is no "where is my tray icon" call —
/// and the panel can also be opened from a path that has no event to read
/// (the first-run confirm gate).
#[derive(Default)]
struct TrayAnchor(std::sync::Mutex<Option<(f64, f64, f64, f64)>>);

/// Records the icon's rect from a tray event, in physical pixels.
///
/// Tauri hands back a [`tauri::Rect`] whose position and size are each
/// independently either logical or physical, so all four combinations are
/// converted explicitly — an assumption either way silently misplaces the
/// panel by a factor of the display's scale, which is invisible on a 1x
/// external monitor and half a screen off on a Retina one.
fn remember_tray_anchor(app: &tauri::AppHandle, rect: tauri::Rect, scale: f64) {
    use tauri::Manager;

    let (x, y) = match rect.position {
        tauri::Position::Physical(p) => (p.x as f64, p.y as f64),
        tauri::Position::Logical(p) => (p.x * scale, p.y * scale),
    };
    let (w, h) = match rect.size {
        tauri::Size::Physical(s) => (s.width as f64, s.height as f64),
        tauri::Size::Logical(s) => (s.width * scale, s.height * scale),
    };
    if let Some(anchor) = app.try_state::<TrayAnchor>() {
        if let Ok(mut slot) = anchor.0.lock() {
            *slot = Some((x, y, w, h));
        }
    }
}

/// Drops the settings panel beneath the menu bar icon, horizontally centred on
/// it, and shows it.
///
/// Falls back to Tauri's own centring when the tray rect is unknown — the
/// first-run confirm gate can open this panel before the DJ has ever pointed at
/// the icon, and a panel in the middle of the screen is a far better outcome
/// than one pinned to a corner or not shown at all.
///
/// The horizontal clamp is not defensive padding: a status item near the right
/// edge of the menu bar (which is where this one lives, alongside every other
/// third-party item) would otherwise centre the panel half-way off the screen.
fn show_panel(app: &tauri::AppHandle) {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let anchor = app
        .try_state::<TrayAnchor>()
        .and_then(|a| a.0.lock().ok().and_then(|slot| *slot));

    if let (Some((tx, ty, tw, th)), Ok(size)) = (anchor, window.outer_size()) {
        let scale = window.scale_factor().unwrap_or(1.0);
        let gap = 6.0 * scale;
        let win_w = size.width as f64;

        let mut x = tx + tw / 2.0 - win_w / 2.0;
        let y = ty + th + gap;

        if let Ok(Some(monitor)) = window.current_monitor() {
            let m_pos = monitor.position();
            let m_size = monitor.size();
            let margin = 8.0 * scale;
            let min_x = m_pos.x as f64 + margin;
            let max_x = m_pos.x as f64 + m_size.width as f64 - win_w - margin;
            // `max` second, and only when the range is real: on a display
            // narrower than the panel the two bounds cross, and clamping to a
            // crossed range would push the window off the opposite edge.
            if max_x > min_x {
                x = x.clamp(min_x, max_x);
            }
        }

        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    } else {
        let _ = window.center();
    }

    let _ = window.show();
    let _ = window.set_focus();
}

/// How often [`updater_loop`] checks for a new release, after its first
/// immediate check on startup. **Flagged to Arjun as a tunable, not a
/// load-bearing number** — same treatment Story 1.7 gave its unconfirmed
/// performance targets — proposed as a starting default.
#[cfg(not(debug_assertions))]
const UPDATE_CHECK_INTERVAL: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);

/// Story 3.4, Task 5 (AR-7 layer 3): the missing "something" that actually
/// calls the auto-updater plugin's `check()`/`download_and_install()` —
/// registered since Story 2.9c, with a real signing pubkey and GitHub-
/// releases endpoint already configured, but never invoked by anything
/// until this story. Without this, a shipped parser fix never reaches an
/// installed agent, and `backfill::reprocess_parse_failures`'s whole
/// "retry once the version changes" mechanism (see that module's doc
/// comment) never has a version change to react to.
///
/// Mirrors `watch_loop`/`sync_loop`'s exact `std::thread::spawn(move ||
/// loop { ... })` shape — deliberately not an async top-level loop or a new
/// `tokio` dependency (this codebase has zero existing `tokio::*`/
/// `async_runtime::spawn` usage); `tauri::async_runtime::block_on` is used
/// only for the two calls that are genuinely async, inside an otherwise
/// synchronous loop. Silent background behavior with no user-facing prompt
/// (FR-5) — no UI change accompanies this task.
#[cfg(not(debug_assertions))]
fn updater_loop(app: tauri::AppHandle) {
    use error_reporting::ErrorReporter;
    use tauri_plugin_updater::UpdaterExt;

    loop {
        tauri::async_runtime::block_on(async {
            let Ok(updater) = app.updater() else {
                return;
            };
            match updater.check().await {
                Ok(Some(update)) => {
                    // Story 3.4 review, decision 1: never restart out from
                    // under a DJ set the agent hasn't finished capturing yet
                    // (still `Watching`, not-yet-quiet-period). Skip this
                    // tick entirely rather than install-then-defer-restart —
                    // the next tick (or the DJ's next set ending) retries.
                    if has_active_capture(&app) {
                        return;
                    }
                    match update.download_and_install(|_, _| {}, || {}).await {
                        Ok(()) => app.restart(), // does not return
                        Err(e) => {
                            error_reporting::SentryReporter.report(
                                "updater download_and_install",
                                config::AGENT_VERSION,
                                &e.to_string(),
                            );
                        }
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    error_reporting::SentryReporter.report(
                        "updater check",
                        config::AGENT_VERSION,
                        &e.to_string(),
                    );
                }
            }
        });
        std::thread::sleep(UPDATE_CHECK_INTERVAL);
    }
}

/// Whether a DJ set is currently mid-capture, per the local store's
/// `Watching` rows (Story 3.4 review, decision 1). Fails open to `false` on
/// a store-open error — the same convention `store::has_active_capture`'s
/// own doc comment follows — a store hiccup must not permanently block an
/// update from ever installing.
#[cfg(not(debug_assertions))]
fn has_active_capture(app: &tauri::AppHandle) -> bool {
    let Ok(conn) = store::open(app) else {
        return false;
    };
    store::has_active_capture(&conn)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Must bind to a local, not a discarded `_` — the guard's `Drop` is what
    // flushes pending events on exit. `run()` blocks for the app's whole
    // lifetime (`.run(...)` below never returns until exit), so a local
    // here is alive exactly as long as the process needs it to be. `None`
    // (no-op) until Arjun provisions a real `SENTRY_DSN` — see `config.rs`.
    let _sentry_guard = error_reporting::init();

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
            get_linked_account,
            start_link,
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
            use tray::{set_tray_state, CurrentTrayState, TrayState, TRAY_ID};

            // Don't show a Dock icon / Cmd+Tab entry for a tray-only app.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Tracks the logical tray state + last-drawn colorway so a menu
            // bar appearance change can redraw the icon below without
            // changing what it means — see `tray::poll_menu_bar_theme`. The
            // placeholder `Theme::Dark` here is overwritten by the real
            // `set_tray_state(Idle)` call below before anything reads it.
            app.manage(CurrentTrayState(std::sync::Mutex::new((
                TrayState::Idle,
                tauri::Theme::Dark,
            ))));

            app.manage(TrayAnchor::default());

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
                        // The one-time CSRF nonce this flow depends on is
                        // minted inside `begin_link` (Review Findings):
                        // remembered in `AuthState` and echoed back by
                        // `web/`'s `/link-agent` page in its
                        // `curfew-agent://link` redirect — `handle_link_url`
                        // rejects anything that doesn't match, so an
                        // unsolicited trigger of that same URL shape can't
                        // repoint the agent. Body moved to `begin_link`
                        // 2026-08-17 so the settings panel's Link button is
                        // the same flow rather than a second copy of it.
                        if let Err(_e) = begin_link(app) {
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
                    let app = tray.app_handle();

                    // Every tray event carries the icon's current rect, and the
                    // icon moves whenever a neighbouring menu bar item appears
                    // or disappears — so the anchor is refreshed on all of them,
                    // not just the click. A `Move`/`Enter` almost always
                    // precedes the click that opens the panel, which means the
                    // rect is usually fresh before it is needed.
                    let scale = app
                        .get_webview_window("main")
                        .and_then(|w| w.scale_factor().ok())
                        .unwrap_or(1.0);
                    match &event {
                        TrayIconEvent::Click { rect, .. }
                        | TrayIconEvent::DoubleClick { rect, .. }
                        | TrayIconEvent::Enter { rect, .. }
                        | TrayIconEvent::Move { rect, .. }
                        | TrayIconEvent::Leave { rect, .. } => {
                            remember_tray_anchor(app, *rect, scale);
                        }
                        _ => {}
                    }

                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let visible = app
                            .get_webview_window("main")
                            .and_then(|w| w.is_visible().ok())
                            .unwrap_or(false);
                        if visible {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        } else {
                            show_panel(app);
                        }
                    }
                })
                .build(app)?;

            // Apply the real per-state icon/tooltip now that the tray exists —
            // defaults to Idle; Story 2.6's detection below may immediately
            // override this to DriveNotConnected if a confirmed override no
            // longer resolves at launch.
            set_tray_state(app.handle(), TrayState::Idle)?;

            // Desktop-picture vibrancy can re-tint the menu bar (light vs.
            // dark) with no AppKit notification to hook — `WindowEvent::
            // ThemeChanged` only fires for an actual system Appearance
            // toggle (see `tray::poll_menu_bar_theme`'s doc comment) — so a
            // short poll is the only way to keep the icon's colorway
            // matching its surroundings. AppKit calls must run on the main
            // thread, hence the `run_on_main_thread` hop from this
            // background thread.
            let poll_app_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_secs(1));
                let handle = poll_app_handle.clone();
                if poll_app_handle
                    .run_on_main_thread(move || {
                        let _ = tray::poll_menu_bar_theme(&handle);
                    })
                    .is_err()
                {
                    break;
                }
            });

            // Story 2.6: find (or confirm, or start watching) the DJ's Serato
            // install. An existing manual override (Story 2.5) is the single
            // source of truth and skips detection entirely (Task 3); otherwise
            // OS defaults + removable volumes are scanned (Tasks 1-2) and, if
            // something is found, the DJ must confirm it before it is used
            // (Task 4, UX-DR20 — never silent).
            //
            // A home-directory resolution failure must not take down the whole
            // tray-only agent (this used to `?`-propagate out of `.setup()`,
            // aborting tray/window creation entirely) — `resolve_home` falls
            // back to a path that deliberately resolves nothing so OS-default
            // detection degrades to `NothingFound` instead, while a manual
            // override (which doesn't depend on `home` at all) still works via
            // the tray settings panel. Story 3.3b: the same fallback is also
            // needed by `watch_loop` now, so it lives in one shared place.
            let home = watcher::resolve_home(app.handle());
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
            // Story 3.3 (review fix): single-writer coordinator shared by
            // `watch_loop` and the sync-queue drain loop below, so the two
            // independent tray writers can never interleave and stomp
            // `DriveNotConnected` with a stale `Queued`/`Idle`/`Failed`.
            app.manage(tray::DriveTrayCoordinator::default());

            if let watcher::StartupResolution::PendingConfirmation(_) = resolution {
                // AC-3: the confirm gate must not depend on the DJ thinking to
                // click the tray icon — this window starts `visible: false`
                // (Story 2.5) and only reveals on tray click otherwise.
                //
                // Goes through `show_panel` so first run gets the same anchored
                // placement as every later open. At this point in setup no tray
                // event has fired yet, so in practice this centres — which is
                // the right answer for a window the DJ did not ask for and has
                // no icon to associate it with yet.
                show_panel(app.handle());
            }

            // Always started, regardless of resolution: the loop itself tracks
            // the live override on disk (see `watch_loop`'s doc comment), so it
            // picks up a path saved via the confirm UI just now, or edited later
            // from the tray settings panel, without needing a relaunch.
            watcher::start_watching(app.handle().clone());

            // Story 3.4, Task 3 (AR-7 layer 3): startup backfill/reprocess
            // sweep — retries every unresolved `parse_failures` row now that
            // the agent may be running a newer build than whatever recorded
            // the failure (see `backfill`'s module doc comment for why that
            // comparison alone is the whole retry trigger). Resolves the
            // `WatchPlan` the same way `watch_loop`'s first tick does.
            // Spawned on its own thread, not inline (same reasoning as the
            // startup eager-refresh thread below) — `.setup()` must not
            // block agent startup on store I/O.
            {
                let backfill_plan = watcher::detect::resolve_watch_plan(
                    settings.serato_path_override.as_deref(),
                    &home,
                    &watcher::detect::SystemDisks,
                );
                let app_handle = app.handle().clone();
                let backfill_home = home.clone();
                std::thread::spawn(move || {
                    let Ok(conn) = store::open(&app_handle) else {
                        return;
                    };
                    // Story 3.7 (§3d): one lazy date-added index for the whole
                    // startup sweep — the `database V2` catalogues load once,
                    // however many sessions get re-derived.
                    let dates = joiner::date_added::DateAddedIndex::live(&backfill_home);
                    // Decision A: establish the go-forward baseline BEFORE the
                    // sweep below, not merely soon after. The sweep clears
                    // `synced_at` on every row whose derived output changed,
                    // and `store::rows_pending_sync` withholds serato4 rows at
                    // or below the baseline — so a sweep that runs first, on a
                    // store with no baseline yet, would re-queue a DJ's whole
                    // pre-signup history with the guard still unarmed. The
                    // watch loop's first tick resolves the same baseline, but
                    // it races this thread, and "usually first" is not a
                    // guarantee worth a DJ's history. Persisting is monotonic,
                    // so both call sites resolving at once is harmless.
                    if let Some(source) = &backfill_plan.serato4 {
                        if let Ok(serato4_conn) =
                            joiner::serato4::open_read_only(&source.root, &source.db_path)
                        {
                            watcher::ensure_serato4_baseline(&conn, &serato4_conn);
                        }
                    }
                    backfill::reprocess_parse_failures(
                        &conn,
                        &backfill_plan,
                        &dates,
                        &error_reporting::SentryReporter,
                    );
                    // Story 3.6: re-derive already-`captured` serato4 sets so a
                    // shipped stat-correctness fix (the Camelot `key_value`
                    // recovery) reaches sessions captured before it — locally
                    // AND in the cloud (a changed row clears synced_at so the
                    // drain loop re-pushes the correction; Arjun 2026-08-02).
                    // Self-terminating (only changed rows are written/re-queued)
                    // and a no-op when no serato4 source is reachable. Runs after
                    // the failure reprocess so a row that just recovered from
                    // `parse_failures` is also re-derived on the same pass.
                    backfill::backfill_captured_serato4(
                        &conn,
                        &backfill_plan,
                        &dates,
                        &error_reporting::SentryReporter,
                    );
                });
            }

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

            // Story 3.3: the offline sync-queue drain loop. Started after
            // both `AuthState` (it needs the in-memory token cache) and
            // `DriveTrayCoordinator` (read on its very first iteration) are
            // already managed above — same "always started, tracks live
            // state itself" shape as `watcher::start_watching`.
            sync_queue::start_syncing(app.handle().clone());

            // Story 3.4, Task 5: the auto-updater check/download/install
            // loop, on its own spawned thread (mirrors every other
            // startup-thread pattern above — `.setup()` must not block on
            // it, and it loops forever). Release builds only — an unsigned
            // debug build has no valid updater signature to verify against,
            // and a dev loop silently polling GitHub every few hours during
            // local development is pure noise.
            #[cfg(not(debug_assertions))]
            {
                let updater_app_handle = app.handle().clone();
                std::thread::spawn(move || updater_loop(updater_app_handle));
            }

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
                    update_link_status_display(&app_handle, None);
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
