// Presentation formatters for the set card (Story 3.6). Pure + deterministic
// (the date formatter reflects the viewer's locale/timezone — a gig's date is
// the DJ's local date, not UTC).
import type { SegmentStats } from "./dancefloor";

/** Mono header date, e.g. "SAT · 21 JUN 2026". Uppercased for the console voice. */
export function formatSetDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const weekday = d.toLocaleDateString([], { weekday: "short" }).toUpperCase();
  const day = d.getDate();
  const month = d.toLocaleDateString([], { month: "short" }).toUpperCase();
  const year = d.getFullYear();
  return `${weekday} · ${day} ${month} ${year}`;
}

/** Session-id header label, e.g. "SET 975". */
export function formatSessionLabel(externalId: string): string {
  return `SET ${externalId}`;
}

/** Human set length, e.g. "5h 56m", "56m", "0m". `null` → "—". */
export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return seconds <= 0 ? "0m" : "1m";
  let hours = Math.floor(seconds / 3600);
  let minutes = Math.round((seconds % 3600) / 60);
  if (minutes === 60) {
    hours += 1;
    minutes = 0;
  }
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/** Track count, e.g. "178 tracks", "1 track". */
export function formatTrackCount(count: number): string {
  return `${count} ${count === 1 ? "track" : "tracks"}`;
}

/* ── Dashboard-redesign registers (Story 3.6 v2, D8/D9) — the liquid-glass
   surfaces speak title-case Hanken, not the console voice above. Same
   locale/timezone discipline: a gig's date and clock are the DJ's local ones. */

/** Row/hero date, e.g. "Fri, Aug 1". `null`/garbage → "—". */
export function formatDayDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** Local clock time, e.g. "10:14 PM". `null`/garbage → "—". */
export function formatClock(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** Start AND end (D8: duration implied), e.g. "10:14 PM – 1:52 AM". */
export function formatTimeRange(startIso: string | null, endIso: string | null): string {
  const start = formatClock(startIso);
  const end = formatClock(endIso);
  if (start === "—" && end === "—") return "—";
  return `${start} – ${end}`;
}

/** Whole-number BPM for stat rows, e.g. "125". `null`/non-finite → "—". */
export function formatBpm(bpm: number | null | undefined): string {
  return typeof bpm === "number" && Number.isFinite(bpm) ? `${Math.round(bpm)}` : "—";
}

/**
 * The top genre chips for the card (AC-5: 2–3 chips), ranked by play count
 * descending with a stable first-seen tie-break. Returns bare normalized genre
 * names; the card decides the fallback when a set is entirely untagged.
 */
export function topGenres(breakdown: SegmentStats["genre_breakdown"], max = 3): string[] {
  return breakdown.buckets
    .map((b, i) => ({ ...b, i }))
    .sort((a, b) => b.play_count - a.play_count || a.i - b.i)
    .slice(0, max)
    .map((b) => b.genre);
}
