// Set-list row model (Story 3.6 v2, D9/D12). Built server-side from the frozen
// seam into a compact, serialisable shape: the client panel gets exactly what
// its rows, expanded cards, and live search need — never the full 178-play
// wire records. Pure + deterministic aside from locale/timezone formatting
// (a gig's date/clock are the DJ's local ones, same rule as format.ts).
import { dancefloorSegments, primaryDancefloorSegment, segmentStats } from "./dancefloor";
import {
  formatBpm,
  formatClock,
  formatDayDate,
  formatDuration,
  formatTimeRange,
  topGenres,
} from "./format";
import { HERO_MIN_TRACKS } from "./hero";
import type { SetRecord, SyncPlay } from "./types";

export interface SetTrack {
  title: string;
  artist: string;
}

export interface SetRowModel {
  id: string;
  /** "Fri, Aug 1" — the row's (and expanded title's) date. */
  dateLabel: string;
  /** "10:14 PM" — collapsed row, left side. */
  startClock: string;
  /** "10:14 PM – 1:52 AM" — expanded stat row. */
  timeRange: string;
  /** Dancefloor track count (whole set when detection falls back). */
  floorCount: number;
  /** "2h 12m" — dancefloor-scoped duration (AC-7), paired with floorCount. */
  durationLabel: string;
  /**
   * How many real dancefloor segments this set carries (Story 5.4, AC #4).
   * `floorCount`/`durationLabel` above still describe only the longest
   * (`primaryDancefloorSegment`) — this is what lets the row DISCLOSE that
   * more exist rather than silently staying quiet about them, closing
   * `deferred-work.md`'s line-759 gap. `1` for the common single-floor case,
   * `0` when the set carries no dancefloor at all.
   */
  floorSegmentCount: number;
  avgBpm: string;
  medianBpm: string;
  /** 2–3 top genre chips (AC-1/AC-5), dancefloor-scoped like floorCount/durationLabel. */
  genreChips: string[];
  /** Every track played, in play order — the expanded card's full tracklist (item 11). */
  tracklist: SetTrack[];
  /** Local day key "2026-06-21" — calendar cross-linking (D10). */
  dayKey: string;
  /** Story 3.7 spec §3g: "low-confidence/no-dancefloor" — either the FR-27
      confidence signal (`derived.confidence.value < 1.0`) or too few tracks
      to be a real dancefloor (same `HERO_MIN_TRACKS` bar hero.ts already
      uses to keep a soundcheck out of the hero slot). Hidden from the
      archive by default (Style Evolution's pattern), never silently. */
  isLowConfidence: boolean;
  /** Epoch ms of started_at — sort by date (D12 filters). */
  startedAtMs: number;
  /** Whole-set length in seconds (0 when unknown) — sort by set length. */
  lengthSec: number;
  /** Lowercased searchable surface: date labels + EVERY play's title/artist (D12). */
  haystack: string;
}

/**
 * "+2 more floors" — the quiet disclosure text for a `floorSegmentCount`
 * (Story 5.4, AC #4), shared so the set-list row and the hero band can't
 * word the same fact two different ways. `null` at 0 or 1 segments: the
 * disclosure exists to say "there's more here than the one stat shows," and
 * at 0/1 there isn't.
 */
export function floorDisclosureLabel(floorSegmentCount: number): string | null {
  if (floorSegmentCount <= 1) return null;
  const extra = floorSegmentCount - 1;
  return `+${extra} more floor${extra === 1 ? "" : "s"}`;
}

/** Local-date key for calendar linking; "" when the set has no timestamp. */
export function localDayKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function setTracklist(plays: SyncPlay[]): SetTrack[] {
  // Every play, in order — the expanded card lists the whole night (item 11),
  // scrollable within its own region. Title/artist only; the heavy per-play
  // wire fields stay out of the serialised row model.
  return plays.map((p) => ({
    title: p.title ?? "Unknown",
    artist: p.artist ?? "Unknown",
  }));
}

/**
 * The product-wide "this set isn't a real gig" rule (spec §3g): a rehearsal-
 * grade confidence signal, OR too few tracks to be worth narrating
 * (`HERO_MIN_TRACKS`).
 *
 * That second clause used to be phrased as "too few tracks for dancefloor
 * detection to have anything to work with (`HERO_MIN_TRACKS` ===
 * `MIN_PLAYS_FOR_DETECTION`)". Story 5.2 moved detection to the agent and cut
 * the alias, so the identity no longer holds by construction — `HERO_MIN_TRACKS`
 * is its own literal now (see `hero.ts`). The threshold's value is unchanged;
 * only the justification is, and it is a display bar, not a detection one.
 *
 * Exported so the set list and the most-played card share ONE definition.
 * They used to diverge: the list hid these sets while the card beside it
 * still counted their plays, which is how a 1-play soundcheck ended up
 * crowning the most-played track.
 *
 * **THREE definitions of "low confidence" exist in `web/`, they disagree, and
 * this is the one to reach for when the question is "should this session count
 * toward a statistic":**
 *   - here — `confidence.value < 1.0 || trackCount < HERO_MIN_TRACKS`. Also
 *     adopted page-wide by `/library-utilization` (Story 4.9, D-20).
 *   - `styleEvolution.ts`'s module-private `isLowConfidence` — the bare
 *     `confidence.value < 1.0` (Story 4.1's D-4: binary, no tier). It does NOT
 *     exclude short sessions, because `agent/src-tauri/src/confidence.rs` is
 *     symmetric by design and a two-track soundcheck scores a clean `1.0`.
 *   - `SetHeader.tsx`'s display-only `c.value <= 0.5 || c.track_count < 4` — a
 *     quieter bar for a note that hides nothing.
 * Do not add a fourth. Reconciling the three is its own story, not a drive-by.
 */
export function isLowConfidenceSet(set: SetRecord): boolean {
  const trackCount = set.derived.track_count ?? set.plays.length;
  return set.derived.confidence.value < 1.0 || trackCount < HERO_MIN_TRACKS;
}

export function buildSetRows(sets: SetRecord[]): SetRowModel[] {
  return sets.map((set) => {
    // Story 5.2: the cut is FETCHED (`set.segments`, from the `segments` rows),
    // not recomputed here. A set with no segments yields `null` and every
    // consumer below falls back to whole-set stats — the same code path v0's
    // `null` took, just with a new source.
    const segment = primaryDancefloorSegment(set.segments);
    const floor = segmentStats(set.plays, segment);
    const floorSegmentCount = dancefloorSegments(set.segments).length;
    const bpm = set.derived.bpm_distribution;
    const dateLabel = formatDayDate(set.started_at);
    const startedAtMs = set.started_at ? new Date(set.started_at).getTime() : 0;

    // Searchable date: dateLabel is the ABBREVIATED "Fri, Jun 26", so typing a
    // full month ("june"/"august") or the year matched nothing. Add the long
    // form so both abbreviated and full names (and the year, full weekday) hit.
    const startDate = set.started_at ? new Date(set.started_at) : null;
    const searchDate =
      startDate && !Number.isNaN(startDate.getTime())
        ? startDate.toLocaleDateString([], {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })
        : "";
    const names = set.plays.flatMap((p) => [p.title ?? "", p.artist ?? ""]);
    const haystack = [dateLabel, searchDate, ...names].join(" ").toLowerCase();

    return {
      id: set.external_id,
      dateLabel,
      startClock: formatClock(set.started_at),
      timeRange: formatTimeRange(set.started_at, set.ended_at),
      floorCount: floor.track_count,
      durationLabel: formatDuration(floor.set_length_sec),
      floorSegmentCount,
      avgBpm: formatBpm(bpm.count > 0 ? bpm.mean : null),
      medianBpm: formatBpm(bpm.count > 0 ? bpm.median : null),
      genreChips: topGenres(floor.genre_breakdown),
      tracklist: setTracklist(set.plays),
      dayKey: localDayKey(set.started_at),
      isLowConfidence: isLowConfidenceSet(set),
      startedAtMs: Number.isNaN(startedAtMs) ? 0 : startedAtMs,
      lengthSec: set.derived.set_length_sec ?? 0,
      haystack,
    };
  });
}
