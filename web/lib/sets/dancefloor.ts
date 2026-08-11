// Segment-scoped stat recomputation (Story 3.6 Task 5, AC-7/8) + the interim
// "which segment is THE dancefloor" pick.
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ v0 DETECTION IS RETIRED (Story 5.2, D-1/D-24). `detectDancefloor` and its │
// │ five global constants used to live here, knowingly interim, because AR-13 │
// │ mandates PER-DJ-CALIBRATED floors ("never a global constant"). That       │
// │ calibrated detector now exists — ONE algorithm, in the agent stat engine   │
// │ (`agent/src-tauri/src/stats/segments.rs`) — and the web reads its output   │
// │ as `segments` rows off the set row instead of recomputing anything. v0's   │
// │ constants live on as that detector's cold-start prior, not as a second     │
// │ system running in parallel.                                                │
// │                                                                            │
// │ What stayed: the SCOPING utilities below. They are consumers of a segment, │
// │ not detectors of one, and Story 5.4 builds segment-scoped stats on them.   │
// └─────────────────────────────────────────────────────────────────────────┘
import type { SyncPlay } from "./types";

/**
 * The two ISO bounds a segment SCOPES by.
 *
 * Split out of `DancefloorSegment` in Story 5.3 for the functions below that
 * genuinely only need bounds — `playsInSegment`, `segmentStats`, and the arc
 * geometry. Those answer "which plays fall inside this window", a question that
 * has nothing to do with which row the window came from, and widening them to
 * demand a row identity they never read would force every synthetic test
 * timeline to mint uuids that assert nothing.
 */
export interface SegmentBounds {
  start: string;
  end: string;
}

/**
 * One segment as the web consumes it: the row's own identity, plus ISO time
 * bounds resolved from its boundary plays (`first_play_id`/`last_play_id` →
 * `plays.started_at`). `null` at a call site means "no segment" — the honest
 * whole-set fallback, exactly as v0's `null` meant.
 *
 * **The three ids arrived in Story 5.3 and are what makes this row editable.**
 * Before it, the web only ever read a segment as a time window, because that
 * was all it could do with one; `id` is what an UPDATE/DELETE addresses,
 * and `firstPlayId`/`lastPlayId` are what a boundary adjust rewrites. The
 * bounds are still derived from those two plays, so the two halves can never
 * describe different windows — but only the ids survive a re-sync (D-27), which
 * is why the write path speaks in ids and never in timestamps.
 */
export interface DancefloorSegment extends SegmentBounds {
  /** `segments.id` — the row an edit addresses. */
  id: string;
  /** `segments.first_play_id` — the play the DJ pointed at as "the floor starts here". */
  firstPlayId: string;
  /** `segments.last_play_id` — likewise for where it ends. */
  lastPlayId: string;
  /**
   * `segments.confirmed` — whether the DJ has settled this floor, or it is
   * still the algorithm's unanswered proposal (D-18).
   *
   * The editor's whole visual language turns on this one boolean (D-35):
   * unconfirmed floors render dashed and lower-opacity with a confirm
   * affordance, confirmed ones solid. `source` is deliberately NOT carried
   * into this shape alongside it — a confirmed suggestion and a hand-drawn
   * boundary look and behave identically to a DJ, and the provenance that
   * still separates them in the database exists for a future active-learning
   * loop rather than for anything on screen.
   */
  confirmed: boolean;
}

/**
 * The comparator both helpers below rank by: longest elapsed first, ties broken
 * on the earlier start then the earlier end.
 *
 * Shared rather than duplicated so `dancefloorSegments(...)[0]` and
 * `primaryDancefloorSegment(...)` cannot drift into disagreeing about which
 * segment is "the" dancefloor — the selector defaults to the same one the card
 * and hero already show, and a DJ never sees those two surfaces contradict.
 */
function byPrimaryRank(a: SegmentBounds, b: SegmentBounds): number {
  const elapsed = (s: SegmentBounds) => {
    const ms = new Date(s.end).getTime() - new Date(s.start).getTime();
    return Number.isNaN(ms) ? -1 : ms;
  };
  return (
    elapsed(b) - elapsed(a) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end)
  );
}

/**
 * EVERY dancefloor segment on a set, ranked (Story 5.3, D-30).
 *
 * The singular pick below is a rendering shortcut that was harmless while the
 * web could only read segments: showing the longest floor and staying quiet
 * about a second one costs a DJ nothing they could have acted on. The moment
 * editing ships, that silence becomes actively misleading — a DJ could adjust
 * "the" dancefloor while a real second one sits invisible and untouched. This
 * is what the editor's selector renders so the count is never hidden.
 *
 * Returns a new array; the caller's is never sorted in place.
 */
export function dancefloorSegments(
  segments: DancefloorSegment[] | null | undefined,
): DancefloorSegment[] {
  if (!segments || segments.length === 0) return [];
  return [...segments].sort(byPrimaryRank);
}

/**
 * The single segment a card/hero shows when it can only show one.
 *
 * A set can legitimately carry zero, one, or several dancefloor segments (FR-28,
 * D-15) — a wedding with a cocktail-hour floor and a post-dinner peak is two,
 * not one. Every consumer below still has exactly one "the dancefloor" slot, so
 * until Story 5.4 ships a real segment picker this takes the **longest by
 * elapsed time**. That is an interim rendering pick recorded as such (D-24), not
 * a product decision about which floor matters — do not build on it as if the
 * longest floor is semantically the main one.
 *
 * Ties break on the earlier start, then on the earlier end, so the choice is
 * total and stable rather than dependent on row order from PostgREST.
 */
export function primaryDancefloorSegment(
  segments: DancefloorSegment[] | null | undefined,
): DancefloorSegment | null {
  return dancefloorSegments(segments)[0] ?? null;
}

/** Card-facing stats recomputed over a segment (AC-7). Same shape/semantics as the whole-set derived stats, but scoped. */
export interface SegmentStats {
  set_length_sec: number | null;
  track_count: number;
  genre_breakdown: {
    buckets: Array<{ genre: string; play_count: number }>;
    no_genre_count: number;
  };
}

/**
 * Recomputes the card-facing stats (length, track count, genre breakdown) over a
 * segment (AC-7), so the card's numbers reflect the dancefloor rather than the
 * whole night. `segment === null` means the whole set (the honest fallback).
 * Genre bucketing mirrors the agent's `stats::genre_breakdown`: normalized
 * bucket, first-seen order, an explicit `no_genre_count` (never folded away).
 */
/**
 * The plays that actually fall inside a segment. `segment === null` is the
 * honest whole-set fallback (this set carries no suggested segment at all), in
 * which case every play counts.
 *
 * Exported so anything scoping to the dancefloor — segment stats, the
 * most-played card — applies the identical bound rather than re-deriving it.
 */
export function playsInSegment(plays: SyncPlay[], segment: SegmentBounds | null): SyncPlay[] {
  if (!segment) return plays;
  return plays.filter((p) => p.started_at != null && p.started_at >= segment.start && p.started_at <= segment.end);
}

export function segmentStats(plays: SyncPlay[], segment: SegmentBounds | null): SegmentStats {
  const inSegment = playsInSegment(plays, segment);

  const order: string[] = [];
  const counts = new Map<string, number>();
  let noGenre = 0;
  for (const p of inSegment) {
    const normalized = p.genre?.normalized;
    if (normalized) {
      if (!counts.has(normalized)) order.push(normalized);
      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    } else {
      noGenre++;
    }
  }

  // `plays[]`/`inSegment` are not guaranteed pre-sorted, so derive the span
  // from actual min/max epoch rather than array position — else an
  // out-of-order play silently understates (or zeroes) the length.
  const epochs = inSegment
    .map((p) => (p.started_at != null ? new Date(p.started_at).getTime() : NaN))
    .filter((t) => !Number.isNaN(t));
  const lengthSec =
    epochs.length >= 2
      ? Math.max(0, Math.round((Math.max(...epochs) - Math.min(...epochs)) / 1000))
      : epochs.length === 1
        ? 0
        : null;

  return {
    set_length_sec: lengthSec,
    track_count: inSegment.length,
    genre_breakdown: {
      buckets: order.map((genre) => ({ genre, play_count: counts.get(genre) ?? 0 })),
      no_genre_count: noGenre,
    },
  };
}
