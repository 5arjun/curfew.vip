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
 * One segment as the web consumes it: ISO time bounds, resolved from the
 * `segments` row's boundary plays (`first_play_id`/`last_play_id` →
 * `plays.started_at`). `null` at a call site means "no segment" — the honest
 * whole-set fallback, exactly as v0's `null` meant.
 */
export interface DancefloorSegment {
  start: string;
  end: string;
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
  if (!segments || segments.length === 0) return null;
  const elapsed = (s: DancefloorSegment) => {
    const ms = new Date(s.end).getTime() - new Date(s.start).getTime();
    return Number.isNaN(ms) ? -1 : ms;
  };
  return [...segments].sort(
    (a, b) => elapsed(b) - elapsed(a) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end),
  )[0];
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
export function playsInSegment(plays: SyncPlay[], segment: DancefloorSegment | null): SyncPlay[] {
  if (!segment) return plays;
  return plays.filter((p) => p.started_at != null && p.started_at >= segment.start && p.started_at <= segment.end);
}

export function segmentStats(plays: SyncPlay[], segment: DancefloorSegment | null): SegmentStats {
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
