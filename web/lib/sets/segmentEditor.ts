// The segment editor's pure state model (Story 5.3, D-34/D-36/D-37).
//
// Everything here is position arithmetic over a set's own timeline: no React,
// no Supabase, no DOM. The editor's three input paths — tap a row, drag a
// handle, arrow a focused boundary — all reduce to the same two operations
// below, which is what lets D-37's "tap now, drag later" build order work
// without a second implementation of the rules.
//
// POSITIONS, NOT UUIDS, ARE THE CURRENCY IN HERE. A DJ points at a track, and
// `plays.position` is what "which track" means (5.1's own "track, not
// millisecond" reasoning). The translation to the `plays.id` a write needs
// happens once, at the edge, in `playIdAtPosition` — see `./segmentWrites`.
//
// WHAT THIS MODEL DELIBERATELY DOES NOT ENFORCE: overlap between segments.
// That rule lives in the D-29 trigger and only there. A client-side copy would
// be a second implementation of a rule the database already owns, free to drift
// from it, and drift would show up as the UI forbidding a write Postgres would
// have accepted — or worse, permitting one it rejects, with the DJ's boundary
// snapping back. The editor surfaces the server's specific rejection instead
// (`SegmentWriteReason`). Ordering and range ARE enforced here, because they
// are properties of a single draft rather than of the set of all segments, and
// clamping them makes an invalid nudge unrepresentable rather than rejected.
import type { DancefloorSegment } from "./dancefloor";
import type { SetPlay } from "./types";

/** Which end of a segment an interaction is moving. */
export type BoundaryEdge = "first" | "last";

/**
 * The `plays.id` at a given position, or `null` when that play has none.
 *
 * The editor speaks in positions — "the first track that counts" is a row the
 * DJ pointed at — while the write path speaks in uuids, and this is the single
 * place that translation happens. `null` is a real answer, not a failure:
 * fixture-backed plays carry no cloud id (see `SetPlay`), and a boundary
 * genuinely cannot be placed on a play with no row behind it.
 *
 * It lives in this module rather than beside the writes it feeds because the
 * editor is a CLIENT component and `./segmentWrites` reaches
 * `@/lib/supabase/server`. Importing one pure helper from there pulled the
 * whole server client into the browser bundle and broke the production build —
 * caught by `pnpm build`, which is exactly the check that catches it.
 */
export function playIdAtPosition(plays: SetPlay[], position: number): string | null {
  return plays.find((play) => play.position === position)?.id ?? null;
}

/**
 * A segment's boundaries as the editor holds them mid-edit.
 *
 * `segmentId` is `null` for a manual segment the DJ has started but not yet
 * committed — it has no row, and therefore no id, until the write lands. That
 * null is what distinguishes an INSERT from an UPDATE at commit time, so it is
 * load-bearing state rather than a placeholder.
 */
export interface SegmentDraft {
  segmentId: string | null;
  firstPosition: number;
  lastPosition: number;
}

/** The set's own first and last position — the walls every edit clamps to. */
export interface PositionBounds {
  min: number;
  max: number;
}

/**
 * The timeline an edit may move within.
 *
 * Derived from the WHOLE set (`set.plays`), never from the scope-filtered
 * slice: a segment's boundaries can legitimately sit anywhere in the night
 * regardless of which scope is being viewed, and bounding by the visible slice
 * would make a boundary un-draggable back out of the very segment it defines.
 */
export function positionBounds(plays: SetPlay[]): PositionBounds | null {
  if (plays.length === 0) return null;
  let min = plays[0].position;
  let max = plays[0].position;
  for (const play of plays) {
    if (play.position < min) min = play.position;
    if (play.position > max) max = play.position;
  }
  return { min, max };
}

/**
 * A stored segment's boundaries as positions, or `null` when either boundary
 * play is not in this set's list.
 *
 * `null` is reachable in practice, not just in theory: the read seam drops a
 * segment whose boundary play RLS filtered out, and a set whose plays list is
 * paged or filtered will not contain every id. A segment that cannot be located
 * on the timeline cannot be drawn on it either, so the editor renders no
 * handles for it rather than guessing a position (AD-11).
 */
export function segmentPositions(
  segment: DancefloorSegment,
  plays: SetPlay[],
): { firstPosition: number; lastPosition: number } | null {
  let first: number | null = null;
  let last: number | null = null;
  for (const play of plays) {
    if (play.id == null) continue;
    if (play.id === segment.firstPlayId) first = play.position;
    if (play.id === segment.lastPlayId) last = play.position;
  }
  if (first == null || last == null) return null;
  return { firstPosition: first, lastPosition: last };
}

/** The draft that editing an existing segment starts from. */
export function draftFromSegment(segment: DancefloorSegment, plays: SetPlay[]): SegmentDraft | null {
  const positions = segmentPositions(segment, plays);
  if (positions == null) return null;
  return { segmentId: segment.id, ...positions };
}

/**
 * Moves one edge to an absolute position — the tap-to-mark and drag path
 * (D-37), which both land here.
 *
 * The OTHER edge yields rather than blocking: tapping a track before the
 * segment's start while placing its end drags the start along with it, giving a
 * single-track segment, instead of silently ignoring the tap. A DJ who taps a
 * row has said something unambiguous about where a boundary goes, and refusing
 * it would leave them tapping again with no feedback about why.
 */
export function setDraftEdge(
  draft: SegmentDraft,
  edge: BoundaryEdge,
  position: number,
  bounds: PositionBounds,
): SegmentDraft {
  const clamped = Math.min(Math.max(position, bounds.min), bounds.max);
  if (edge === "first") {
    return {
      ...draft,
      firstPosition: clamped,
      lastPosition: Math.max(draft.lastPosition, clamped),
    };
  }
  return {
    ...draft,
    firstPosition: Math.min(draft.firstPosition, clamped),
    lastPosition: clamped,
  };
}

/**
 * Moves one edge by one track — the arrow-key path (AC #2, D-36).
 *
 * Unlike {@link setDraftEdge} this one does NOT push the opposite edge: an
 * arrow press is a small, repeated gesture, and having the far boundary start
 * following along after the near one collides with it would be a surprise the
 * DJ did not ask for. It stops at the other edge instead, which is also what
 * makes a single-track segment (first === last) reachable and stable — the
 * shape D-27's clamp collapses to, and one the D-29 trigger explicitly admits.
 */
export function nudgeDraftEdge(
  draft: SegmentDraft,
  edge: BoundaryEdge,
  delta: number,
  bounds: PositionBounds,
): SegmentDraft {
  if (edge === "first") {
    const next = Math.min(Math.max(draft.firstPosition + delta, bounds.min), draft.lastPosition);
    return { ...draft, firstPosition: next };
  }
  const next = Math.max(Math.min(draft.lastPosition + delta, bounds.max), draft.firstPosition);
  return { ...draft, lastPosition: next };
}

/**
 * How a boundary is spoken aloud — the ONE sentence, used by both the handle's
 * `aria-valuetext` and the live-region nudge announcement (D-36).
 *
 * Shared rather than written twice because it already drifted once: the handle
 * said "Untitled track" while the live region said "an untitled track", so a
 * non-sighted DJ heard two different names for the same track depending on
 * whether they had focused it or arrowed onto it. Caught in the 1440 browser
 * pass; unifying them is what makes that unrepresentable.
 *
 * `tense` is the only difference the two callers need: the handle describes a
 * standing state ("Dancefloor ends at …"), the announcement describes a change
 * that just happened ("Dancefloor now ends at …").
 */
export function boundaryValueText(
  edge: BoundaryEdge,
  play: { title?: string | null } | undefined,
  clock: string,
  tense: "state" | "change" = "state",
): string {
  const title = play?.title ?? "an untitled track";
  const verb = edge === "first" ? "starts" : "ends";
  const now = tense === "change" ? "now " : "";
  return `Dancefloor ${now}${verb} at ${title}${clock ? `, ${clock}` : ""}`;
}

/** What a keypress on a focused boundary handle means (AC #2, D-36). */
export type BoundaryKeyAction = { kind: "nudge"; delta: number } | { kind: "commit" } | null;

/**
 * Maps a key to a boundary action — the full keyboard path, as data.
 *
 * Extracted from the handle component rather than left inline in its
 * `onKeyDown` because this repository deliberately runs no jsdom and no React
 * Testing Library (see the `prop-threading.test.tsx` suites' house rules), so an
 * inline switch would be the one part of AC #2 nothing could assert. As a pure
 * function it is covered directly, and the component keeps only the
 * `preventDefault` plumbing.
 *
 * Up/Left move earlier and Down/Right later — BOTH pairs. The list runs
 * vertically, but arrow-key muscle memory for anything role="slider" is
 * horizontal; accepting only one pair would feel broken to whichever half of
 * users reached for the other.
 */
export function boundaryKeyAction(
  key: string,
  position: number,
  bounds: PositionBounds,
): BoundaryKeyAction {
  switch (key) {
    case "ArrowUp":
    case "ArrowLeft":
      return { kind: "nudge", delta: -1 };
    case "ArrowDown":
    case "ArrowRight":
      return { kind: "nudge", delta: 1 };
    case "Home":
      return { kind: "nudge", delta: bounds.min - position };
    case "End":
      return { kind: "nudge", delta: bounds.max - position };
    case "Enter":
      return { kind: "commit" };
    default:
      return null;
  }
}

/** Whether a position falls inside a draft's bracket — what gets the rail. */
export function draftContains(draft: SegmentDraft, position: number): boolean {
  return position >= draft.firstPosition && position <= draft.lastPosition;
}

/** Whether a draft actually differs from the segment it started as. */
export function draftIsDirty(
  draft: SegmentDraft,
  original: { firstPosition: number; lastPosition: number } | null,
): boolean {
  if (original == null) return true;
  return (
    draft.firstPosition !== original.firstPosition || draft.lastPosition !== original.lastPosition
  );
}

/**
 * How a segment reads at a glance (D-35): the algorithm's proposal, or the DJ's
 * own answer.
 *
 * A confirmed suggestion and a manual boundary are deliberately the SAME state.
 * `source` still distinguishes them in the database — D-18 requires provenance
 * to survive confirmation — but the DJ experiences both as "this is settled",
 * and drawing a visual difference would be showing them a distinction that
 * exists for a future active-learning loop's benefit rather than their own.
 */
export type SegmentVisualState = "suggested" | "confirmed";

export function segmentVisualState(segment: { confirmed: boolean }): SegmentVisualState {
  return segment.confirmed ? "confirmed" : "suggested";
}
