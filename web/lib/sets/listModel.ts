// Set-list row model (Story 3.6 v2, D9/D12). Built server-side from the frozen
// seam into a compact, serialisable shape: the client panel gets exactly what
// its rows, expanded cards, and live search need — never the full 178-play
// wire records. Pure + deterministic aside from locale/timezone formatting
// (a gig's date/clock are the DJ's local ones, same rule as format.ts).
import { detectDancefloor, segmentStats } from "./dancefloor";
import { formatBpm, formatClock, formatDayDate, formatDuration, formatTimeRange } from "./format";
import type { SetRecord, SyncPlay } from "./types";

export interface TeaserTrack {
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
  /** "2h 12m" — whole-set duration. */
  durationLabel: string;
  avgBpm: string;
  medianBpm: string;
  /** Opening stretch of the detected dancefloor — "how the night opened" (D9). */
  teaser: TeaserTrack[];
  /** Local day key "2026-06-21" — calendar cross-linking (D10). */
  dayKey: string;
  /** Epoch ms of started_at — sort by date (D12 filters). */
  startedAtMs: number;
  /** Whole-set length in seconds (0 when unknown) — sort by set length. */
  lengthSec: number;
  /** Lowercased searchable surface: date labels + EVERY play's title/artist (D12). */
  haystack: string;
}

const TEASER_LENGTH = 5;

/** Local-date key for calendar linking; "" when the set has no timestamp. */
export function localDayKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function teaserTracks(plays: SyncPlay[], floorStartIso: string | null): TeaserTrack[] {
  // The first tracks of the detected dancefloor segment; when detection fell
  // back to the whole set, the night's opening stretch is the honest teaser.
  const startIdx = floorStartIso
    ? Math.max(
        0,
        plays.findIndex((p) => p.started_at != null && p.started_at >= floorStartIso),
      )
    : 0;
  return plays.slice(startIdx, startIdx + TEASER_LENGTH).map((p) => ({
    title: p.title ?? "Unknown",
    artist: p.artist ?? "Unknown",
  }));
}

export function buildSetRows(sets: SetRecord[]): SetRowModel[] {
  return sets.map((set) => {
    const segment = detectDancefloor(set.plays);
    const floor = segmentStats(set.plays, segment);
    const bpm = set.derived.bpm_distribution;
    const dateLabel = formatDayDate(set.started_at);
    const startedAtMs = set.started_at ? new Date(set.started_at).getTime() : 0;

    const names = set.plays.flatMap((p) => [p.title ?? "", p.artist ?? ""]);
    const haystack = [dateLabel, formatDayDate(set.started_at), ...names]
      .join(" ")
      .toLowerCase();

    return {
      id: set.external_id,
      dateLabel,
      startClock: formatClock(set.started_at),
      timeRange: formatTimeRange(set.started_at, set.ended_at),
      floorCount: floor.track_count,
      durationLabel: formatDuration(set.derived.set_length_sec),
      avgBpm: formatBpm(bpm.count > 0 ? bpm.mean : null),
      medianBpm: formatBpm(bpm.count > 0 ? bpm.median : null),
      teaser: teaserTracks(set.plays, segment?.start ?? null),
      dayKey: localDayKey(set.started_at),
      startedAtMs: Number.isNaN(startedAtMs) ? 0 : startedAtMs,
      lengthSec: set.derived.set_length_sec ?? 0,
      haystack,
    };
  });
}
