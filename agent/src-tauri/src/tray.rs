//! Tray state machine (Story 2.5, AC-1 / UX-DR21). The tray is the agent's only
//! UI surface (UX-DR22): each state below carries both an icon and — the
//! authoritative signal — a text tooltip, so state is never conveyed by
//! color/glyph alone. Later stories (2.6 drive detection, 2.8 set capture, 3.x
//! sync) drive real transitions by calling [`set_tray_state`]; this story only
//! builds the state machine and proves it renders (a debug menu item cycles
//! through the states for manual verification, see Task 5 in the story file).

use std::sync::Mutex;

use tauri::image::Image;
use tauri::{AppHandle, Manager, Theme};

/// The tray's id, used to look it up later via [`tauri::Manager::tray_by_id`]
/// when pushing a state update.
pub const TRAY_ID: &str = "main";

/// The logical state currently shown plus the menu-bar colorway it was last
/// drawn in, tracked so [`poll_menu_bar_theme`] can redraw the icon when the
/// colorway changes without touching the state itself, and can skip the
/// `set_icon` call entirely when it hasn't.
pub struct CurrentTrayState(pub Mutex<(TrayState, Theme)>);

/// The six states this agent's tray can show. `Idle` is the default at
/// startup. `Queued` (Story 3.3, AC-3/UX-DR19) is a fifth state added on top
/// of the four Story 2.5 originally built — UX-DR23's "four tray states"
/// predates this story and does not override AC-3's requirement for a
/// distinct "offline / queued" glyph. `FormatDriftPaused` (Story 3.4, AC-3)
/// is the sixth, added the same mechanical way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayState {
    Idle,
    Syncing,
    Failed,
    DriveNotConnected,
    /// Set completed while offline (or otherwise unsynced) is queued locally
    /// and awaiting the sync-queue drain loop's next attempt — a neutral,
    /// expected state (UX-DR18's Failure Register explicitly places it
    /// outside "failure"), not an error.
    Queued,
    /// A terminal capture failure was recorded (Story 3.4, Task 2) and has
    /// not yet been backfilled — format drift is suspected. A calm, distinct
    /// "paused" state (UX-DR18/UX-DR19), not the alarmed `Failed` state:
    /// this is expected to self-resolve once a fix ships and the startup
    /// backfill sweep (Task 3) clears the underlying `parse_failures` row.
    FormatDriftPaused,
}

impl TrayState {
    /// All six states, in the fixed order the debug cycle menu item rotates
    /// through.
    pub const ALL: [TrayState; 6] = [
        TrayState::Idle,
        TrayState::Syncing,
        TrayState::Failed,
        TrayState::DriveNotConnected,
        TrayState::Queued,
        TrayState::FormatDriftPaused,
    ];

    /// Tooltip text carrying the state as a real label (UX-DR21). Failure-adjacent
    /// wording follows the Console Voice / Failure Register pattern (UX-DR18):
    /// calm, technical, no exclamations.
    pub fn tooltip(self) -> &'static str {
        match self {
            TrayState::Idle => "Curfew Agent — Idle",
            TrayState::Syncing => "Curfew Agent — Syncing",
            TrayState::Failed => "Curfew Agent — Sync failed",
            TrayState::DriveNotConnected => "Curfew Agent — Drive not connected",
            // Base wording on UX-DR19's exact copy string ("Queued — will
            // sync when you're back online", EXPERIENCE.md:86); calm/neutral
            // per UX-DR18, not the Failure Register.
            TrayState::Queued => "Curfew Agent — Offline, sets queued",
            // Terse "Curfew Agent — X" tooltip convention (UX-DR21); the
            // fuller Failure Register sentence ("Format change detected —
            // sync paused until verified.", EXPERIENCE.md:52) is written
            // for a future dashboard-status surface (Story 3.6+), not this
            // tray-only tooltip.
            TrayState::FormatDriftPaused => "Curfew Agent — Format drift detected",
        }
    }

    /// The **single** serialization point for this enum on the wire (Story
    /// 3.9, AD-20): the string the agent-status heartbeat POSTs to
    /// `set_agent_status`, and the exact value set that RPC validates against
    /// server-side. Never stringify a `TrayState` with an ad-hoc `match`
    /// anywhere else — a drifting spelling here is silently rejected by the
    /// RPC (`22023`) and the dashboard simply goes quiet, which is the hardest
    /// class of bug to notice in a fire-and-forget path.
    ///
    /// Note this is deliberately NOT [`TrayState::tooltip`]: the tooltip is
    /// human-facing copy that UX may reword at any time, while this is a
    /// machine contract shared with the migration
    /// (`supabase/migrations/20260805120000_create_agent_status.sql`) and the
    /// web renderer (`web/app/(authenticated)/dashboard/status-copy.ts`).
    pub fn wire_state(self) -> &'static str {
        match self {
            TrayState::Idle => "Idle",
            TrayState::Syncing => "Syncing",
            TrayState::Failed => "Failed",
            TrayState::DriveNotConnected => "DriveNotConnected",
            TrayState::Queued => "Queued",
            TrayState::FormatDriftPaused => "FormatDriftPaused",
        }
    }

    /// The next state in the fixed cycle order, wrapping back to `Idle` — used
    /// only by the debug "cycle state" menu item to prove all four render.
    pub fn next(self) -> TrayState {
        let idx = Self::ALL.iter().position(|s| *s == self).unwrap_or(0);
        Self::ALL[(idx + 1) % Self::ALL.len()]
    }

    /// Compile-time-embedded icon for this state (see `icons/tray/`), in the
    /// colorway matching `theme`: a light menu bar needs the dark-outline
    /// asset to stay visible, a dark menu bar needs the white-outline one —
    /// the reverse of the theme's own name. `include_image!` decodes the PNG
    /// at build time, so no `image` crate is needed as a runtime dependency
    /// of this crate.
    fn icon(self, theme: Theme) -> Image<'static> {
        match (theme, self) {
            (Theme::Light, TrayState::Idle) => tauri::include_image!("icons/tray/light/idle.png"),
            (Theme::Light, TrayState::Syncing) => {
                tauri::include_image!("icons/tray/light/syncing.png")
            }
            (Theme::Light, TrayState::Failed) => {
                tauri::include_image!("icons/tray/light/failed.png")
            }
            (Theme::Light, TrayState::DriveNotConnected) => {
                tauri::include_image!("icons/tray/light/drive-not-connected.png")
            }
            (Theme::Light, TrayState::Queued) => {
                tauri::include_image!("icons/tray/light/queued.png")
            }
            (Theme::Light, TrayState::FormatDriftPaused) => {
                tauri::include_image!("icons/tray/light/format-drift-paused.png")
            }
            // Dark is the default colorway for any theme variant future
            // Tauri versions may add (`Theme` is `#[non_exhaustive]`).
            (_, TrayState::Idle) => tauri::include_image!("icons/tray/dark/idle.png"),
            (_, TrayState::Syncing) => tauri::include_image!("icons/tray/dark/syncing.png"),
            (_, TrayState::Failed) => tauri::include_image!("icons/tray/dark/failed.png"),
            (_, TrayState::DriveNotConnected) => {
                tauri::include_image!("icons/tray/dark/drive-not-connected.png")
            }
            (_, TrayState::Queued) => tauri::include_image!("icons/tray/dark/queued.png"),
            (_, TrayState::FormatDriftPaused) => {
                tauri::include_image!("icons/tray/dark/format-drift-paused.png")
            }
        }
    }
}

/// The menu bar appearance to draw tray icons for.
///
/// On macOS this is *not* the same as the system's general Appearance
/// (Light/Dark) preference: a dark desktop picture can tint the menu bar
/// dark via vibrancy even while Appearance is set to Light, so `NSApp`'s or
/// the main window's `effectiveAppearance` can disagree with what the menu
/// bar actually renders (confirmed on a dev machine: `AppleInterfaceStyle`
/// read Light while the real menu bar — and every other app's template icon
/// in it — was dark). See [`macos_probe`] for how this queries the true,
/// menu-bar-hosted appearance instead.
#[cfg(target_os = "macos")]
fn menu_bar_theme(_app: &AppHandle) -> Theme {
    macos_probe::menu_bar_theme()
}

/// Non-macOS fallback: keyed off the `main` window's effective theme, since
/// there's no menu-bar-vs-window-appearance split to account for elsewhere.
#[cfg(not(target_os = "macos"))]
fn menu_bar_theme(app: &AppHandle) -> Theme {
    app.get_webview_window("main")
        .and_then(|w| w.theme().ok())
        .unwrap_or(Theme::Dark)
}

/// Reads the *real* menu-bar appearance directly from AppKit, bypassing both
/// `NSApplication.effectiveAppearance` and any cached window theme — see
/// [`menu_bar_theme`] for why those can't be trusted here.
///
/// Tauri's tray API doesn't expose the `NSStatusItem` behind our actual tray
/// icon, so this creates its own zero-width, never-visible status item purely
/// to read `effectiveAppearance` off a button that's genuinely hosted in the
/// system menu bar — the same context AppKit resolves template icons
/// against, so this stays correct even under vibrancy tinting that the
/// system Appearance preference doesn't reflect.
#[cfg(target_os = "macos")]
mod macos_probe {
    use std::sync::OnceLock;

    use objc2::rc::Retained;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAppearanceCustomization, NSStatusBar, NSStatusItem};
    use objc2_foundation::NSArray;

    use super::Theme;

    // Safety: only ever touched from the main thread (enforced by the
    // `MainThreadMarker` required to obtain one), matching `NSStatusItem`'s
    // own thread requirements.
    struct ProbeItem(Retained<NSStatusItem>);
    unsafe impl Send for ProbeItem {}
    unsafe impl Sync for ProbeItem {}

    static PROBE: OnceLock<ProbeItem> = OnceLock::new();

    pub fn menu_bar_theme() -> Theme {
        let Some(mtm) = MainThreadMarker::new() else {
            // Every caller in this module runs on the main thread (setup()
            // and window-event callbacks); this is a defensive fallback,
            // not an expected path.
            return Theme::Dark;
        };

        let probe = PROBE.get_or_init(|| {
            let bar = NSStatusBar::systemStatusBar();
            ProbeItem(bar.statusItemWithLength(0.0))
        });

        let Some(button) = probe.0.button(mtm) else {
            return Theme::Dark;
        };

        let appearance = button.effectiveAppearance();
        let names = [unsafe { objc2_app_kit::NSAppearanceNameAqua }, unsafe {
            objc2_app_kit::NSAppearanceNameDarkAqua
        }];
        let best = appearance.bestMatchFromAppearancesWithNames(&NSArray::from_slice(&names));

        match best {
            Some(name) if &*name == unsafe { objc2_app_kit::NSAppearanceNameDarkAqua } => {
                Theme::Dark
            }
            _ => Theme::Light,
        }
    }
}

/// Push a new state to the running tray (icon + tooltip together). Any later
/// story drives real transitions by calling this — no plumbing changes needed.
///
/// The tooltip — the authoritative, text-carrying signal per UX-DR21 — is set
/// first. If it fails, the icon is left untouched rather than risking an
/// icon/tooltip mismatch where the icon shows a new state but the tooltip
/// still describes the old one.
pub fn set_tray_state(app: &AppHandle, state: TrayState) -> tauri::Result<()> {
    let theme = menu_bar_theme(app);
    let tray = app.tray_by_id(TRAY_ID).ok_or_else(|| {
        tauri::Error::AssetNotFound(format!("agent: tray icon '{TRAY_ID}' not found"))
    })?;
    tray.set_tooltip(Some(state.tooltip()))?;
    tray.set_icon(Some(state.icon(theme)))?;
    if let Some(current) = app.try_state::<CurrentTrayState>() {
        *current.0.lock().expect("current tray state mutex poisoned") = (state, theme);
    }
    Ok(())
}

/// The state the tray is showing **right now** — the same value the agent's
/// own UI surface is displaying, read straight out of [`CurrentTrayState`].
///
/// This is what the Story 3.9 heartbeat reports (AD-20), deliberately rather
/// than re-deriving a state from `sync_queue`'s inputs: the dashboard's
/// promise is "what your agent is doing", and the tray is the definition of
/// that. Reading it here also picks up `DriveNotConnected` — written
/// exclusively by `watch_loop`, invisible to `sync_queue`'s own
/// `desired_tray_state` (which returns `None` rather than overwrite it).
///
/// `None` when the state isn't managed at all (a headless/test `AppHandle`),
/// in which case there is genuinely nothing to report.
pub fn current_tray_state(app: &AppHandle) -> Option<TrayState> {
    let current = app.try_state::<CurrentTrayState>()?;
    let state = current
        .0
        .lock()
        .expect("current tray state mutex poisoned")
        .0;
    Some(state)
}

/// Single-writer coordinator for the two independent loops that drive tray
/// state from drive-connectivity and sync-backlog signals (`watcher::watch_loop`
/// and `sync_queue::sync_loop`) — Story 3.3 code review fix. Before this,
/// each loop read the drive-connected signal and wrote the tray
/// independently, leaving a race: a disconnect landing between
/// `sync_queue`'s read and its write could leave the tray showing a stale
/// `Queued`/`Idle` instead of `DriveNotConnected` until the next reconnect
/// (`watch_loop` only re-writes the tray on a *transition*, not every tick).
/// Routing both loops' decide-and-write sequence through the same
/// [`Mutex`] makes that interleaving impossible.
///
/// Also owns the tri-state "is the drive reachable" signal itself —
/// `None` until `watch_loop`'s first classification tick, so a `sync_queue`
/// pass that runs before that first tick does not assume connectivity and
/// briefly flash the wrong state.
pub struct DriveTrayCoordinator(Mutex<Option<bool>>);

impl Default for DriveTrayCoordinator {
    fn default() -> Self {
        Self(Mutex::new(None))
    }
}

impl DriveTrayCoordinator {
    /// Called by `watch_loop` on every connect/disconnect transition —
    /// updates the shared drive-reachability signal and writes the
    /// corresponding tray state atomically under the same lock a concurrent
    /// `sync_queue` write contends on.
    pub fn set_drive_connected(&self, app: &AppHandle, connected: bool) {
        let mut guard = self
            .0
            .lock()
            .expect("drive tray coordinator mutex poisoned");
        *guard = Some(connected);
        let state = if connected {
            TrayState::Idle
        } else {
            TrayState::DriveNotConnected
        };
        let _ = set_tray_state(app, state);
    }

    /// Called by `sync_queue`'s drain loop after each pass. `decide` receives
    /// the current drive-connected signal (locked, so it cannot change out
    /// from under this write) and returns the tray state to write, or `None`
    /// to leave the tray untouched — used so `sync_queue` never overwrites
    /// `DriveNotConnected` (the more specific, more actionable state) with
    /// its own `Queued`/`Idle`/`Failed`.
    pub fn write_if_drive_state(
        &self,
        app: &AppHandle,
        decide: impl FnOnce(Option<bool>) -> Option<TrayState>,
    ) {
        let guard = self
            .0
            .lock()
            .expect("drive tray coordinator mutex poisoned");
        if let Some(state) = decide(*guard) {
            let _ = set_tray_state(app, state);
        }
    }
}

/// Re-checks the menu bar's colorway and redraws the tray icon if it changed,
/// without touching the logical state or tooltip. Meant to be called on a
/// short repeating timer (see `lib.rs`'s `setup()`), *not* only in response
/// to `WindowEvent::ThemeChanged` — macOS doesn't emit any notification for
/// the desktop-picture-vibrancy tinting this app cares about (only for a
/// genuine system Appearance toggle), so a poll is the only way to catch it.
pub fn poll_menu_bar_theme(app: &AppHandle) -> tauri::Result<()> {
    let Some(current) = app.try_state::<CurrentTrayState>() else {
        return Ok(());
    };
    let theme = menu_bar_theme(app);

    let state = {
        let mut current = current.0.lock().expect("current tray state mutex poisoned");
        if current.1 == theme {
            return Ok(());
        }
        current.1 = theme;
        current.0
    };

    let tray = app.tray_by_id(TRAY_ID).ok_or_else(|| {
        tauri::Error::AssetNotFound(format!("agent: tray icon '{TRAY_ID}' not found"))
    })?;
    tray.set_icon(Some(state.icon(theme)))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_state_has_an_icon_in_both_menu_bar_colorways() {
        // `include_image!` panics at compile time if a path is missing, so
        // this mainly guards against the match arms silently falling through
        // to the wrong file for a given (theme, state) pair.
        for state in TrayState::ALL {
            let _ = state.icon(Theme::Light);
            let _ = state.icon(Theme::Dark);
        }
    }

    #[test]
    fn every_state_has_a_real_text_tooltip_not_just_icon() {
        for state in TrayState::ALL {
            let tooltip = state.tooltip();
            assert!(
                tooltip.starts_with("Curfew Agent — "),
                "tooltip must carry the state as text (UX-DR21): {tooltip}"
            );
            assert!(tooltip.len() > "Curfew Agent — ".len());
        }
    }

    #[test]
    fn tooltip_mapping_is_state_specific() {
        assert_eq!(TrayState::Idle.tooltip(), "Curfew Agent — Idle");
        assert_eq!(TrayState::Syncing.tooltip(), "Curfew Agent — Syncing");
        assert_eq!(TrayState::Failed.tooltip(), "Curfew Agent — Sync failed");
        assert_eq!(
            TrayState::DriveNotConnected.tooltip(),
            "Curfew Agent — Drive not connected"
        );
        assert_eq!(
            TrayState::Queued.tooltip(),
            "Curfew Agent — Offline, sets queued"
        );
        assert_eq!(
            TrayState::FormatDriftPaused.tooltip(),
            "Curfew Agent — Format drift detected"
        );
    }

    #[test]
    fn failure_wording_is_calm_and_technical_no_exclamations() {
        // Queued is not a failure state, but UX-DR18's calm/neutral wording
        // requirement (no exclamations) applies just as much here — it's
        // still the Console Voice, not an alarm.
        for state in [
            TrayState::Failed,
            TrayState::DriveNotConnected,
            TrayState::Queued,
            TrayState::FormatDriftPaused,
        ] {
            assert!(!state.tooltip().contains('!'), "UX-DR18: no exclamations");
        }
    }

    // ---- Story 3.9 / AD-20: the wire contract -----------------------------

    #[test]
    fn every_state_serializes_to_its_agreed_wire_string() {
        // These six strings are a contract shared with two other places that
        // cannot see this file: the RPC's allow-list
        // (supabase/migrations/20260805120000_create_agent_status.sql) and the
        // dashboard's copy map (web/.../dashboard/status-copy.ts). Changing a
        // spelling here without changing both there is a silent outage.
        assert_eq!(TrayState::Idle.wire_state(), "Idle");
        assert_eq!(TrayState::Syncing.wire_state(), "Syncing");
        assert_eq!(TrayState::Failed.wire_state(), "Failed");
        assert_eq!(
            TrayState::DriveNotConnected.wire_state(),
            "DriveNotConnected"
        );
        assert_eq!(TrayState::Queued.wire_state(), "Queued");
        assert_eq!(
            TrayState::FormatDriftPaused.wire_state(),
            "FormatDriftPaused"
        );
    }

    #[test]
    fn wire_states_are_distinct_across_all_six_variants() {
        // A copy-paste slip that maps two variants to the same string would
        // make the dashboard render a state the agent is not in, and the
        // per-variant assertions above would still pass if one were edited to
        // match the other.
        let mut seen = std::collections::HashSet::new();
        for state in TrayState::ALL {
            assert!(
                seen.insert(state.wire_state()),
                "duplicate wire string for {state:?}"
            );
        }
        assert_eq!(seen.len(), TrayState::ALL.len());
    }

    #[test]
    fn wire_state_is_not_the_human_facing_tooltip() {
        // Guards against a future "simplification" that collapses the two:
        // the tooltip is UX copy free to be reworded, wire_state is a machine
        // contract that must not move when it is.
        for state in TrayState::ALL {
            assert_ne!(state.wire_state(), state.tooltip());
        }
    }

    #[test]
    fn cycle_visits_all_six_states_then_wraps() {
        let mut state = TrayState::Idle;
        let mut seen = vec![state];
        for _ in 0..5 {
            state = state.next();
            seen.push(state);
        }
        assert_eq!(
            seen,
            vec![
                TrayState::Idle,
                TrayState::Syncing,
                TrayState::Failed,
                TrayState::DriveNotConnected,
                TrayState::Queued,
                TrayState::FormatDriftPaused,
            ]
        );
        assert_eq!(
            state.next(),
            TrayState::Idle,
            "cycle must wrap back to Idle"
        );
    }
}
