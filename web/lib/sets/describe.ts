// Editorial narrative for the hero set (Story 3.6 redesign). The hero has a
// warm, magazine voice — but every clause here is derived from REAL data
// (duration, track count, dominant tagged genre, peak BPM, the detected
// dancefloor window, arc direction). No venue is invented (there is no venue in
// the data); identity comes from date + session + the night's own shape.
//
// Pure + deterministic. Reuses the frozen seam (detectDancefloor, format) so the
// hero copy and the archive cards agree on the same numbers.
import { detectDancefloor, type DancefloorSegment } from "./dancefloor";
import { formatDuration, formatSessionLabel, formatSetDate } from "./format";
import type { SetRecord } from "./types";

export interface HeroStat {
  label: string;
  value: string;
}

export interface HeroDancefloor {
  /** Local clock, e.g. "12:41 AM". */
  startLabel: string;
  endLabel: string;
  /** Human span the floor held, e.g. "1h 29m". */
  held: string;
}

export interface SetDescription {
  eyebrow: string;
  headline: string;
  dek: string;
  stats: HeroStat[];
  /** The raw detected window, for the arc geometry (null → whole-set fallback). */
  segment: DancefloorSegment | null;
  dancefloor: HeroDancefloor | null;
  /** Local clock for the two ends of the whole set, for the arc's baseline. */
  doorsLabel: string;
  lastCallLabel: string;
  /** True when the set ran past midnight into the next day. */
  crossesMidnight: boolean;
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The dominant *tagged* genre, ignoring the catch-all "Other" bucket + untagged. */
function dominantGenre(set: SetRecord): string | null {
  const buckets = set.derived.genre_breakdown?.buckets ?? [];
  const ranked = buckets
    .filter((b) => b.genre.toLowerCase() !== "other")
    .sort((a, b) => b.play_count - a.play_count);
  return ranked[0]?.genre ?? null;
}

function peakBpm(set: SetRecord): number | null {
  const dist = set.derived.bpm_distribution;
  if (dist && dist.count > 0) return Math.round(dist.max);
  const arc = set.derived.energy_arc ?? [];
  if (arc.length === 0) return null;
  return Math.round(Math.max(...arc.map((p) => p.bpm)));
}

function arcDirection(set: SetRecord): "rising" | "easing" | "steady" | "none" {
  const arc = set.derived.energy_arc ?? [];
  if (arc.length < 2) return "none";
  const delta = arc[arc.length - 1].bpm - arc[0].bpm;
  if (Math.abs(delta) < 6) return "steady";
  return delta > 0 ? "rising" : "easing";
}

/** Whole-set length in seconds, preferring the derived value, else the arc span. */
function lengthSec(set: SetRecord): number | null {
  if (typeof set.derived.set_length_sec === "number") return set.derived.set_length_sec;
  if (set.started_at && set.ended_at) {
    const s = new Date(set.started_at).getTime();
    const e = new Date(set.ended_at).getTime();
    if (!Number.isNaN(s) && !Number.isNaN(e) && e >= s) return Math.round((e - s) / 1000);
  }
  return null;
}

export function describeSet(set: SetRecord): SetDescription {
  const trackCount = set.derived.track_count ?? set.plays.length;
  const len = lengthSec(set);
  const genre = dominantGenre(set);
  const peak = peakBpm(set);
  const direction = arcDirection(set);
  const segment = detectDancefloor(set.plays);

  let dancefloor: HeroDancefloor | null = null;
  if (segment) {
    const heldSec = Math.round((new Date(segment.end).getTime() - new Date(segment.start).getTime()) / 1000);
    dancefloor = {
      startLabel: clock(segment.start),
      endLabel: clock(segment.end),
      held: formatDuration(heldSec),
    };
  }

  // Headline: one confident clause chosen from the night's actual shape.
  const headline = dancefloor
    ? "The night found its floor."
    : direction === "rising"
      ? "The night kept climbing."
      : direction === "easing"
        ? "An easy way down."
        : direction === "steady"
          ? "A long, level night."
          : "A quiet check.";

  // Dek: the factual sentence. Each clause appears only when its data exists —
  // never a fabricated or zero-filled stat.
  const parts: string[] = [];
  if (len != null) parts.push(`${formatDuration(len)} across ${trackCount} ${trackCount === 1 ? "track" : "tracks"}`);
  else parts.push(`${trackCount} ${trackCount === 1 ? "track" : "tracks"}`);
  let dek = parts.join("");
  const tail: string[] = [];
  if (genre) tail.push(`mostly ${genre.toLowerCase()}`);
  if (peak != null) tail.push(`cresting at ${peak} BPM`);
  if (tail.length > 0) dek += `. ${capitalize(tail.join(", "))}`;
  if (dancefloor) dek += `, and the floor held from ${dancefloor.startLabel} to ${dancefloor.endLabel}`;
  dek += ".";

  // Stat strip — four glances, each dropped when it has no honest value.
  const stats: HeroStat[] = [];
  if (len != null) stats.push({ label: "SET LENGTH", value: formatDuration(len) });
  stats.push({ label: "TRACKS", value: String(trackCount) });
  if (peak != null) stats.push({ label: "PEAK", value: `${peak} BPM` });
  const clean = set.derived.camelot_mixing_stats?.compatible_transitions;
  if (typeof clean === "number" && clean > 0) stats.push({ label: "IN-KEY BLENDS", value: String(clean) });

  const startDay = set.started_at ? new Date(set.started_at).getDate() : null;
  const endDay = set.ended_at ? new Date(set.ended_at).getDate() : null;

  return {
    eyebrow: `${formatSetDate(set.started_at)} · ${formatSessionLabel(set.external_id)}`,
    headline,
    dek,
    stats,
    segment,
    dancefloor,
    doorsLabel: set.started_at ? clock(set.started_at) : "—",
    lastCallLabel: set.ended_at ? clock(set.ended_at) : "—",
    crossesMidnight: startDay != null && endDay != null && startDay !== endDay,
  };
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
