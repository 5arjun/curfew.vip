//! Tray state machine (Story 2.5, AC-1 / UX-DR21). The tray is the agent's only
//! UI surface (UX-DR22): each state below carries both an icon and — the
//! authoritative signal — a text tooltip, so state is never conveyed by
//! color/glyph alone. Later stories (2.6 drive detection, 2.8 set capture, 3.x
//! sync) drive real transitions by calling [`set_tray_state`]; this story only
//! builds the state machine and proves it renders (a debug menu item cycles
//! through the states for manual verification, see Task 5 in the story file).

use tauri::image::Image;
use tauri::AppHandle;

/// The tray's id, used to look it up later via [`tauri::Manager::tray_by_id`]
/// when pushing a state update.
pub const TRAY_ID: &str = "main";

/// The five states this agent's tray can show. `Idle` is the default at
/// startup. `Queued` (Story 3.3, AC-3/UX-DR19) is a fifth state added on top
/// of the four Story 2.5 originally built — UX-DR23's "four tray states"
/// predates this story and does not override AC-3's requirement for a
/// distinct "offline / queued" glyph.
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
}

impl TrayState {
    /// All five states, in the fixed order the debug cycle menu item rotates
    /// through.
    pub const ALL: [TrayState; 5] = [
        TrayState::Idle,
        TrayState::Syncing,
        TrayState::Failed,
        TrayState::DriveNotConnected,
        TrayState::Queued,
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
        }
    }

    /// The next state in the fixed cycle order, wrapping back to `Idle` — used
    /// only by the debug "cycle state" menu item to prove all four render.
    pub fn next(self) -> TrayState {
        let idx = Self::ALL.iter().position(|s| *s == self).unwrap_or(0);
        Self::ALL[(idx + 1) % Self::ALL.len()]
    }

    /// Compile-time-embedded icon for this state (see `icons/tray/`). `include_image!`
    /// decodes the PNG at build time, so no `image` crate is needed as a runtime
    /// dependency of this crate.
    fn icon(self) -> Image<'static> {
        match self {
            TrayState::Idle => tauri::include_image!("icons/tray/idle.png"),
            TrayState::Syncing => tauri::include_image!("icons/tray/syncing.png"),
            TrayState::Failed => tauri::include_image!("icons/tray/failed.png"),
            TrayState::DriveNotConnected => {
                tauri::include_image!("icons/tray/drive-not-connected.png")
            }
            TrayState::Queued => tauri::include_image!("icons/tray/queued.png"),
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
    let tray = app.tray_by_id(TRAY_ID).ok_or_else(|| {
        tauri::Error::AssetNotFound(format!("agent: tray icon '{TRAY_ID}' not found"))
    })?;
    tray.set_tooltip(Some(state.tooltip()))?;
    tray.set_icon(Some(state.icon()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
        ] {
            assert!(!state.tooltip().contains('!'), "UX-DR18: no exclamations");
        }
    }

    #[test]
    fn cycle_visits_all_five_states_then_wraps() {
        let mut state = TrayState::Idle;
        let mut seen = vec![state];
        for _ in 0..4 {
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
            ]
        );
        assert_eq!(
            state.next(),
            TrayState::Idle,
            "cycle must wrap back to Idle"
        );
    }
}
