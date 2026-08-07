// Dancefloor detection v0 + segment-scoped stat recomputation (Story 3.6 Task 5,
// AC-6/7/8).
//
// ┌─────────────────────────────────────────────────────────────────────────┐
// │ INTERIM — global-heuristic v0. AR-13 mandates PER-DJ-CALIBRATED floors    │
// │ ("never a global constant"); that calibrated detector is Story 5.2 and    │
// │ SUPERSEDES everything in this file. The constants below are deliberately   │
// │ global and deliberately temporary — shipped knowingly so the dashboard    │
// │ has a real (if rough) dancefloor cut from day one, NOT presented as the    │
// │ final AR-13 answer. Do not treat these numbers as tuned.                   │
// └─────────────────────────────────────────────────────────────────────────┘
//
// Everything here is pure and recomputed from `plays[]` (each `SyncPlay` carries
// its own `started_at` + `bpm`), which is what makes segment-scoped stats — and
// the future pointer editor (Story 5.1) — buildable with no schema change.
import type { SyncPlay } from "./types";

/** Window size the night is bucketed into. ~10 min (AR-13 shape). INTERIM/global. */
const WINDOW_SEC = 600;
/** Below this many *timed* plays, detection is not worth attempting — whole set. INTERIM/global. */
export const MIN_PLAYS_FOR_DETECTION = 6;
/** A window "clears the floor" only with at least this many plays in it. INTERIM/global. */
const DENSITY_FLOOR = 3;
/** …and, when BPM is known for the window, a median at least this fast (excludes a slow warm-up/dinner). INTERIM/global. */
const BPM_FLOOR = 118;
/** A single sub-floor window between two clearing windows is bridged (a brief lull is not a new set). INTERIM/global. */
const GAP_MERGE_WINDOWS = 1;
/** If the qualifying run covers this fraction (or more) of the night, it IS the night → whole-set fallback, never force a cut. INTERIM/global. */
const WHOLE_NIGHT_FRACTION = 0.9;

/** A detected dancefloor segment as ISO time bounds (matches the future AR-15 `segments` time-bound shape), or `null` → the honest whole-set fallback. */
export interface DancefloorSegment {
  start: string;
  end: string;
}

interface TimedPlay {
  index: number;
  epochMs: number;
  bpm: number | null;
}

function timedPlays(plays: SyncPlay[]): TimedPlay[] {
  return plays.flatMap((p, index) => {
    if (p.started_at == null) return [];
    const epochMs = new Date(p.started_at).getTime();
    if (Number.isNaN(epochMs)) return [];
    return [{ index, epochMs, bpm: p.bpm ?? null }];
  });
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Suggests the dancefloor segment for a set (AC-6), computed at render from
 * `plays[]`:
 *   1. bucket the night into ~10-min windows,
 *   2. a window clears the floor on play-density + (when known) median BPM,
 *   3. take the LONGEST contiguous run of clearing windows, bridging single-window gaps,
 *   4. fall back to the whole set (`null`) when nothing qualifies OR the run spans
 *      essentially the whole night — never force exactly one segment.
 *
 * Returns `null` for the whole-set fallback; otherwise the ISO time bounds of the run.
 */
export function detectDancefloor(plays: SyncPlay[]): DancefloorSegment | null {
  const timed = timedPlays(plays);
  if (timed.length < MIN_PLAYS_FOR_DETECTION) return null;

  const firstMs = timed[0].epochMs;
  const lastMs = timed[timed.length - 1].epochMs;
  const spanSec = (lastMs - firstMs) / 1000;
  if (spanSec <= 0) return null;

  const windowCount = Math.max(1, Math.ceil(spanSec / WINDOW_SEC));
  const windows: TimedPlay[][] = Array.from({ length: windowCount }, () => []);
  for (const p of timed) {
    // `plays[]` is not guaranteed pre-sorted, so a play before `firstMs` is
    // possible — clamp both ends or an out-of-order play produces a negative
    // index and crashes the whole render.
    const w = Math.max(
      0,
      Math.min(windowCount - 1, Math.floor((p.epochMs - firstMs) / 1000 / WINDOW_SEC)),
    );
    windows[w].push(p);
  }

  const clears = windows.map((w) => {
    if (w.length < DENSITY_FLOOR) return false;
    const bpms = w.map((p) => p.bpm).filter((b): b is number => b != null);
    const med = median(bpms);
    // BPM gates only when the window actually has BPM data; a window dense enough
    // but with no BPM still counts (never guess a tempo it doesn't have — AD-11).
    return med == null || med >= BPM_FLOOR;
  });

  // Longest contiguous run of clearing windows, bridging gaps up to GAP_MERGE_WINDOWS.
  let bestStart = -1;
  let bestEnd = -1;
  let runStart = -1;
  let gap = 0;
  for (let i = 0; i < clears.length; i++) {
    if (clears[i]) {
      if (runStart === -1) runStart = i;
      gap = 0;
      if (bestStart === -1 || i - runStart > bestEnd - bestStart) {
        bestStart = runStart;
        bestEnd = i;
      }
    } else if (runStart !== -1) {
      gap++;
      if (gap > GAP_MERGE_WINDOWS) {
        runStart = -1;
        gap = 0;
      }
    }
  }

  if (bestStart === -1) return null; // nothing qualified → whole set

  const runWindows = bestEnd - bestStart + 1;
  if (runWindows >= windowCount * WHOLE_NIGHT_FRACTION) return null; // it IS the night

  // Time bounds = first play of the first run window .. last play of the last run window.
  const runPlays = windows.slice(bestStart, bestEnd + 1).flat();
  if (runPlays.length === 0) return null;
  const startIso = plays[runPlays[0].index].started_at;
  const endIso = plays[runPlays[runPlays.length - 1].index].started_at;
  if (startIso == null || endIso == null) return null;
  return { start: startIso, end: endIso };
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
 * The plays that actually fall inside a detected segment. `segment === null`
 * is the honest whole-set fallback (detection declined, or the run WAS the
 * night), in which case every play counts.
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
