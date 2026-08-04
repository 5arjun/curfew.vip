// Shared client-side view model for Set Detail (Story 3.7) — the one focus
// mechanism (DR-2) and the overlay routing both panes read.
import type { DancefloorSegment } from "@/lib/sets/dancefloor";
import type { Scope } from "@/lib/sets/setDetail";
import type { SyncPlay } from "@/lib/sets/types";

/**
 * DR-2 — THE one shared "focus the tracklist on these plays" mechanism.
 * Single-select: setting a new focus replaces the old. Genre-select,
 * harmonic-select, BPM-band-select, artist-select, Longest/Shortest, and
 * New-tracks all funnel through this shape; Story 3.8's arc click-to-jump
 * reuses it.
 */
export interface Focus {
  /** Stable identity so re-clicking the same value reads as the same focus. */
  key: string;
  /** The "Focused: X ✕" pill label (DR-1). */
  label: string;
  /** `SyncPlay.position`s to highlight — every other row dims, none hide. */
  positions: number[];
}

/** Which right-column drill-in overlay is open (AC-30's overlay set). */
export type OverlayKind = "genre" | "bpm" | "harmonic" | "artists" | null;

/** Everything the panes need from the shell, computed once per scope flip. */
export interface ScopeFrame {
  scope: Scope;
  segment: DancefloorSegment | null;
  /** The scoped slice every stat reads (AC-5: one frame at a time). */
  plays: SyncPlay[];
  /** The ★ PEAK play position within the active scope, or null. */
  peakPosition: number | null;
}
