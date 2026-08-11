// Shared client-side view model for Set Detail (Story 3.7) — the one focus
// mechanism (DR-2) and the overlay routing both panes read.
import type { DancefloorSegment, SegmentBounds } from "@/lib/sets/dancefloor";
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
  /**
   * Which segment the editor is currently working on (Story 5.3, D-30/Task 6.2).
   *
   * EXTENDS the frame, never replaces `segment`: every existing consumer
   * (`DetailArc`, `Tracklist`, `StatsColumn`) still scopes by `segment` exactly
   * as before. Recomputing stats against the segment being edited is Story
   * 5.4's, and doing it here would make every arrow press rewrite the whole
   * right column.
   */
  activeSegmentId: string | null;
  /**
   * The live, uncommitted boundaries of that edit (D-34) — `null` when nothing
   * is being edited.
   *
   * Only the arc's highlight band reads this. The band is the "one reflection"
   * D-34 permits: the tracklist stays the single interaction surface, and the
   * arc shows where the boundary currently is without becoming a second thing
   * to drag. Deliberately NOT wired into the scope zoom, which stays driven by
   * the committed segment — the view lurching on every nudge would make the
   * mirror harder to read, not easier.
   */
  editingBounds: SegmentBounds | null;
  /** The scoped slice every stat reads (AC-5: one frame at a time). */
  plays: SyncPlay[];
  /** The ★ PEAK play position within the active scope, or null. */
  peakPosition: number | null;
}
