"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { dancefloorSegments, type DancefloorSegment } from "@/lib/sets/dancefloor";
import { formatClock } from "@/lib/sets/format";
import {
  boundaryValueText,
  draftFromSegment,
  draftIsDirty,
  nudgeDraftEdge,
  playIdAtPosition,
  positionBounds,
  segmentPositions,
  setDraftEdge,
  type BoundaryEdge,
  type SegmentDraft,
} from "@/lib/sets/segmentEditor";
import type { SegmentWriteReason } from "@/lib/sets/segmentWrites";
import type { SetRecord } from "@/lib/sets/types";
import {
  adjustSegmentBoundaryAction,
  confirmSegmentAction,
  createManualSegmentAction,
  deleteSegmentAction,
} from "@/app/(authenticated)/set/[id]/actions";

// The segment editor's state, owned in one place (Story 5.3).
//
// It lives here rather than inside `Tracklist` because THREE surfaces read it:
// the tracklist draws the handles and rails, the arc mirrors the live boundary
// (D-34, Task 8), and the selector says which segment is being edited (D-30).
// D-34 is explicit that there is one source of truth and one reflection — two
// components each holding their own copy of "where is this boundary right now"
// is precisely the two-interaction-surfaces-fighting failure it rules out.
//
// The DRAFT is the whole mechanism. An edit moves positions locally, every
// surface renders from those positions immediately, and only an explicit commit
// writes (AC #2's "arrows nudge, Enter confirms"; AC #3's "confirm commits").
// Nothing optimistically rewrites the fetched rows: after a successful write the
// server action revalidates and the real rows come back, so a rejected write
// simply leaves the DJ where they were, still editing.
//
// EVERY interaction path (tap, drag, arrow-key) is keyed by which SEGMENT it
// belongs to, not just which edge — `Tracklist` renders a boundary handle for
// every segment (not only the active one, so their rails are always visible),
// so a handle's own segment id must be threaded through every callback rather
// than assumed to be "whichever one is currently active." `ensureActive` is the
// one place that resolves "the segment this interaction targets" into "the
// draft that interaction should act on," switching the active segment first
// when they differ (code review finding, 2026-08-11).

/** How a boundary is currently being placed — the tap-to-mark arming state (D-37). */
export type PlacingState = { edge: BoundaryEdge } | null;

/** The pseudo-id `Tracklist` assigns the in-progress new segment, which has no row yet. */
const NEW_SEGMENT_ID = "sd-new-segment";

export interface SegmentEditor {
  /** Every dancefloor segment on this set, ranked (D-30). */
  segments: DancefloorSegment[];
  /** The segment whose handles are live. Others still render their rail, dimmed. */
  activeId: string | null;
  /** Live boundaries of the active edit — what every surface renders. */
  draft: SegmentDraft | null;
  /** `true` while a new manual segment is being drawn and has no row yet. */
  isNew: boolean;
  /**
   * Whether the DJ is in edit mode at all — a floor is selected, or they have
   * asked to draw a new one.
   *
   * Everything guarded keys off this: the "+" gutter affordances only exist
   * here (so a stray click in a row gap can never start a segment), the
   * out-of-segment rows dim, and the action bar sticks to the viewport top.
   */
  isEditing: boolean;
  /** `true` once "+ New" is pressed and before the first gutter tap. */
  adding: boolean;
  beginAdd: () => void;
  placing: PlacingState;
  /** Which edge, on which segment, is mid-drag right now — drives the "no CSS
   * transition, live transform" visual state from React, not an imperative DOM
   * write, so it survives the handle remounting under a different row mid-drag
   * (code review finding, 2026-08-11: this is what makes a drag crossing a
   * track boundary stay continuous instead of reverting to a per-row snap). */
  draggingSegmentId: string | null;
  draggingEdge: BoundaryEdge | null;
  /** Which edge a keyboard nudge just moved — the handle that owns it consumes
   * this to reclaim DOM focus after the row-crossing remount (D-36 a11y). */
  justNudgedEdge: BoundaryEdge | null;
  pending: boolean;
  /** Which rule the last write broke, if any (D-29's four cases). */
  error: SegmentWriteReason | null;
  /** Live-region text, re-announced on every nudge (D-36). */
  announcement: string;
  /** Whether the active draft differs from what is stored. */
  dirty: boolean;
  selectSegment: (id: string | null) => void;
  /** Arms tap-to-mark for `edge` on `segmentId`, selecting it first if it is not already active. */
  startPlacing: (segmentId: string, edge: BoundaryEdge) => void;
  tapRow: (position: number) => void;
  /** Moves an edge to an absolute position without arming first — the drag path. */
  setEdge: (segmentId: string, edge: BoundaryEdge, position: number) => void;
  /** Marks `segmentId`'s `edge` as mid-drag (or clears it when `edge` is `null`). */
  setDragging: (segmentId: string | null, edge: BoundaryEdge | null) => void;
  nudge: (segmentId: string, edge: BoundaryEdge, delta: number) => void;
  startManualAt: (position: number) => void;
  /** Commits the active draft. `segmentId`, if given, is selected first when not already active. */
  commit: (segmentId?: string) => void;
  cancel: () => void;
  removeActive: () => void;
  /** Where a segment sits on the timeline, drafts included. */
  positionsFor: (segment: DancefloorSegment) => { firstPosition: number; lastPosition: number } | null;
}

export function useSegmentEditor(
  set: SetRecord,
  /**
   * Asks the shell to page the tracklist far enough to render `position`.
   *
   * Required, not a nicety: the tracklist pages at 50 rows, and a set's second
   * or third dancefloor routinely starts past that. Without this, selecting
   * "Dancefloor 2" showed its Confirm/Cancel/Remove controls while its handles
   * sat unrendered 19 rows below the fold — editing affordances for a segment
   * the DJ could not see or reach. `setFocus` already does exactly this for the
   * DR-2 highlight; this is the same move for the same reason. (Caught in the
   * 1440 browser pass, invisible to every other gate.)
   */
  revealPosition: (position: number, scrollIntoView?: boolean) => void,
  /** The set's own IANA zone, resolved once by the page (Story 7.7). */
  zone: string,
): SegmentEditor {
  const segments = useMemo(() => dancefloorSegments(set.segments), [set.segments]);
  const bounds = useMemo(() => positionBounds(set.plays), [set.plays]);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SegmentDraft | null>(null);
  const [placing, setPlacing] = useState<PlacingState>(null);
  const [draggingSegmentId, setDraggingSegmentId] = useState<string | null>(null);
  const [draggingEdge, setDraggingEdgeState] = useState<BoundaryEdge | null>(null);
  const [error, setError] = useState<SegmentWriteReason | null>(null);
  const [adding, setAdding] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  /** Which edge a keyboard nudge just moved — consumed by the handle that owns
   * it to reclaim DOM focus after the row-crossing remount, then cleared. */
  const [justNudgedEdge, setJustNudgedEdge] = useState<BoundaryEdge | null>(null);
  const [pending, startTransition] = useTransition();

  const activeSegment = useMemo(
    () => segments.find((s) => s.id === activeId) ?? null,
    [segments, activeId],
  );

  const storedPositions = useMemo(
    () => (activeSegment ? segmentPositions(activeSegment, set.plays) : null),
    [activeSegment, set.plays],
  );

  const dirty = draft != null && draftIsDirty(draft, storedPositions);

  /**
   * The rendered positions of any segment: the live draft for the one being
   * edited, the stored boundaries for the rest. This is what makes the arc and
   * the tracklist agree mid-drag without either one owning the value.
   */
  const positionsFor = useCallback(
    (segment: DancefloorSegment) => {
      if (draft?.segmentId === segment.id) {
        return { firstPosition: draft.firstPosition, lastPosition: draft.lastPosition };
      }
      return segmentPositions(segment, set.plays);
    },
    [draft, set.plays],
  );

  /**
   * "Dancefloor now starts at Sunset Blvd, 12:04am."
   *
   * `aria-valuenow` alone is not an accessible implementation of AC #2 (D-36):
   * a bare position number tells a non-sighted DJ nothing about which track
   * they just landed on, which is the entire content of the sighted experience.
   */
  const describe = useCallback(
    (edge: BoundaryEdge, position: number) => {
      const play = set.plays.find((p) => p.position === position);
      return boundaryValueText(edge, play, formatClock(play?.started_at ?? null, zone), "change");
    },
    // `zone` formats the clock inside this announcement (Story 7.7) — a stale
    // one would read the wrong time to a screen reader.
    [set.plays, zone],
  );

  /** Drops every trace of an in-progress edit. */
  const leaveEditMode = useCallback(() => {
    setActiveId(null);
    setDraft(null);
    setPlacing(null);
    setAdding(false);
  }, []);

  /**
   * Resolves "the segment this interaction targets" into the draft it should
   * act on, switching the active segment first when they differ.
   *
   * Blocked entirely while `pending`: a write for the currently active segment
   * may still be in flight, and letting a keyboard/drag/tap interaction switch
   * or re-target mid-write is exactly what let a stray double-Enter fire two
   * concurrent writes, and a stray chip click during a commit silently close
   * out whatever the DJ had just selected (code review finding, 2026-08-11).
   */
  const ensureActive = useCallback(
    (segmentId: string): SegmentDraft | null => {
      if (pending) return null;
      if (segmentId === NEW_SEGMENT_ID) {
        // The in-progress "new manual segment" has no persisted row to select —
        // its identity IS whatever draft is already active for adding.
        return draft?.segmentId == null ? draft : null;
      }
      if (draft?.segmentId === segmentId && activeId === segmentId) return draft;
      const segment = segments.find((s) => s.id === segmentId) ?? null;
      if (segment == null) return null;
      const next = draftFromSegment(segment, set.plays);
      setActiveId(segmentId);
      setDraft(next);
      setPlacing(null);
      setError(null);
      setAdding(false);
      if (next) revealPosition(next.firstPosition, true);
      return next;
    },
    [pending, draft, activeId, segments, set.plays, revealPosition],
  );

  const selectSegment = useCallback(
    (id: string | null) => {
      if (pending) return;
      if (id == null) {
        // Re-clicking the already-active chip routes here. Silently discarding
        // an unsaved drag/tap edit on a stray double-tap is a real footgun on
        // touch — Cancel stays the one explicit, intentional discard path
        // (Arjun's ruling, code review 2026-08-11).
        if (dirty) return;
        leaveEditMode();
        setError(null);
        return;
      }
      ensureActive(id);
    },
    [pending, dirty, leaveEditMode, ensureActive],
  );

  /**
   * Arms "draw me a new floor" without yet choosing where.
   *
   * The gutter "+" affordances are hidden outside edit mode, so a set with no
   * segments at all would otherwise have no way in. This is that door, and it
   * is what keeps a stray click between two rows from silently starting a
   * segment (Arjun, 2026-08-11).
   */
  const beginAdd = useCallback(() => {
    if (pending) return;
    leaveEditMode();
    setError(null);
    setAdding(true);
  }, [pending, leaveEditMode]);

  const startPlacing = useCallback(
    (segmentId: string, edge: BoundaryEdge) => {
      if (ensureActive(segmentId) == null) return;
      setPlacing({ edge });
      setError(null);
    },
    [ensureActive],
  );

  /**
   * The primary interaction (D-37): tap the first track that counts, tap the
   * last. Deliberately inert unless a boundary is armed — every row in the
   * tracklist is also a focus target for the DR-2 highlight mechanism, and
   * making a bare row tap move a boundary would hijack that.
   */
  const tapRow = useCallback(
    (position: number) => {
      if (placing == null || draft == null || bounds == null) return;
      const next = setDraftEdge(draft, placing.edge, position, bounds);
      setDraft(next);
      setPlacing(null);
      setAnnouncement(
        describe(placing.edge, placing.edge === "first" ? next.firstPosition : next.lastPosition),
      );
    },
    [placing, draft, bounds, describe],
  );

  /**
   * The desktop-drag path (D-37's enhancement), layered onto the same state.
   *
   * Identical to a tap except that no arming step precedes it — grabbing a
   * handle IS the arming. Both land in `setDraftEdge`, which is what makes drag
   * additive rather than a second implementation of the rules.
   */
  const setEdge = useCallback(
    (segmentId: string, edge: BoundaryEdge, position: number) => {
      if (bounds == null) return;
      const base = ensureActive(segmentId);
      if (base == null) return;
      const next = setDraftEdge(base, edge, position, bounds);
      // A drag fires continuously; re-announcing an unchanged position would
      // flood the live region with the same sentence dozens of times.
      const moved = edge === "first" ? next.firstPosition : next.lastPosition;
      const before = edge === "first" ? base.firstPosition : base.lastPosition;
      setDraft(next);
      if (moved !== before) setAnnouncement(describe(edge, moved));
    },
    [ensureActive, bounds, describe],
  );

  const setDragging = useCallback((segmentId: string | null, edge: BoundaryEdge | null) => {
    setDraggingSegmentId(segmentId);
    setDraggingEdgeState(edge);
  }, []);

  const nudge = useCallback(
    (segmentId: string, edge: BoundaryEdge, delta: number) => {
      if (bounds == null) return;
      const base = ensureActive(segmentId);
      if (base == null) return;
      const next = nudgeDraftEdge(base, edge, delta, bounds);
      setDraft(next);
      const moved = edge === "first" ? next.firstPosition : next.lastPosition;
      // Arrowing a boundary downward past the last rendered row must page too,
      // or the focused handle unmounts mid-interaction and focus is lost.
      revealPosition(moved);
      setAnnouncement(describe(edge, moved));
      // The handle is about to remount under a different row (position-keyed
      // DOM), which drops native focus. This is consumed by that fresh handle
      // to reclaim it — see the effect below.
      setJustNudgedEdge(edge);
    },
    [ensureActive, bounds, describe, revealPosition],
  );

  // `justNudgedEdge` is a one-shot signal: the freshly-mounted handle reads it
  // on layout to refocus itself, and this clears it one frame later so a
  // second, unrelated focus change is never mistaken for a pending nudge.
  useEffect(() => {
    if (justNudgedEdge == null) return;
    const id = requestAnimationFrame(() => setJustNudgedEdge(null));
    return () => cancelAnimationFrame(id);
  }, [justNudgedEdge]);

  /**
   * The "+" path (AC #1's fallback): a new floor starts as a single track at the
   * gutter the DJ clicked, and its end handle is immediately armed so the next
   * tap finishes it. A one-track segment is a legal shape all the way down —
   * the D-29 trigger admits it and D-27's clamp produces it — so this is a real
   * intermediate state rather than a placeholder needing special handling.
   */
  const startManualAt = useCallback(
    (position: number) => {
      if (bounds == null || pending) return;
      setActiveId(null);
      setError(null);
      setAdding(false);
      setDraft({ segmentId: null, firstPosition: position, lastPosition: position });
      setPlacing({ edge: "last" });
      setAnnouncement(describe("first", position));
    },
    [bounds, pending, describe],
  );

  // Cancel LEAVES edit mode rather than merely reverting the draft: the action
  // bar is the only thing on screen saying an edit is in progress, so keeping it
  // up after "Cancel" would read as "that didn't work".
  const cancel = useCallback(() => {
    if (pending) return;
    leaveEditMode();
    setError(null);
  }, [pending, leaveEditMode]);

  const commit = useCallback(
    (segmentId?: string) => {
      const base = segmentId != null ? ensureActive(segmentId) : pending ? null : draft;
      if (base == null) return;
      const firstPlayId = playIdAtPosition(set.plays, base.firstPosition);
      const lastPlayId = playIdAtPosition(set.plays, base.lastPosition);
      // A play with no cloud id cannot be a boundary — true of fixture-backed
      // data by construction, and never reachable from a real set.
      if (firstPlayId == null || lastPlayId == null) {
        setError("unknown");
        return;
      }

      startTransition(async () => {
        setError(null);
        if (base.segmentId == null) {
          const result = await createManualSegmentAction(set.external_id, firstPlayId, lastPlayId);
          if (!result.ok) {
            setError(result.reason);
            return;
          }
          leaveEditMode();
          return;
        }

        // Boundaries first, then confirmation. If the boundary write is rejected
        // there is nothing to confirm yet — confirming a segment whose new extent
        // the database refused would settle a floor the DJ never actually got.
        if (draftIsDirty(base, storedPositions)) {
          const moved = await adjustSegmentBoundaryAction(set.external_id, base.segmentId, {
            firstPlayId,
            lastPlayId,
          });
          if (!moved.ok) {
            setError(moved.reason);
            return;
          }
        }

        const targetSegment = segments.find((s) => s.id === base.segmentId) ?? activeSegment;
        if (targetSegment && !targetSegment.confirmed) {
          const confirmed = await confirmSegmentAction(set.external_id, base.segmentId);
          if (!confirmed.ok) {
            setError(confirmed.reason);
            return;
          }
        }
        // The edit is done, so the editor goes away. Leaving Confirm/Cancel/Remove
        // on screen after a successful commit reads as "nothing happened" — the
        // one signal a DJ has that the write landed is the controls retiring.
        // Only on SUCCESS: a rejected write keeps them exactly where they were,
        // still editing, with the reason beside the button they pressed.
        leaveEditMode();
      });
    },
    [
      ensureActive,
      pending,
      draft,
      set.plays,
      set.external_id,
      storedPositions,
      segments,
      activeSegment,
      leaveEditMode,
    ],
  );

  const removeActive = useCallback(() => {
    if (activeId == null || pending) return;
    startTransition(async () => {
      setError(null);
      const result = await deleteSegmentAction(set.external_id, activeId);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      leaveEditMode();
    });
  }, [activeId, pending, set.external_id, leaveEditMode]);

  return {
    segments,
    activeId,
    draft,
    isNew: draft?.segmentId == null && draft != null,
    isEditing: activeId != null || draft != null || adding,
    adding,
    beginAdd,
    placing,
    draggingSegmentId,
    draggingEdge,
    justNudgedEdge,
    pending,
    error,
    announcement,
    dirty,
    selectSegment,
    startPlacing,
    tapRow,
    setEdge,
    setDragging,
    nudge,
    startManualAt,
    commit,
    cancel,
    removeActive,
    positionsFor,
  };
}

export { NEW_SEGMENT_ID };
