// Presentation formatters for the set card (Story 3.6). Pure + deterministic.
//
// **Every date/clock formatter here takes an explicit `zone`** (Story 7.7).
// They used to read the process's zone, and these render in Server Components,
// so on Vercel that was UTC — a DJ's 11pm Friday set was labelled Saturday. The
// zone comes from `zoneForSet` in `./civilTime` and nowhere else.
//
// The LOCALE is a separate, still-open defect: `toLocaleDateString([], …)`
// resolves to the runtime's default and produces `June`/`juin` hydration
// mismatches on a non-`en` browser. It is ledgered in `deferred-work.md` and
// deliberately out of scope here — do not fix it in passing, and do not add a
// new instance of it either.
// Every `toLocale*` call below is guarded with `usableZoneOr`. `Intl` throws
// `RangeError` on a zone it does not know, and unlike `civilTime`'s own
// derivations — which degrade to UTC internally — a throw HERE is an uncaught
// exception inside a Server Component, i.e. the dashboard, set, track and
// library pages render `global-error` instead of a date. `resolveSetZone` now
// filters unusable zones out of the chain, so this is the second line rather
// than the first; it stays because these are exported functions that take a
// bare string, and the one thing a formatter must never do is take the page
// down (code review, 2026-08-17).
import type { SegmentStats } from "./dancefloor";
import { civilFromIso, usableZoneOr } from "./civilTime";

/** Mono header date, e.g. "SAT · 21 JUN 2026". Uppercased for the console voice. */
export function formatSetDate(iso: string | null, zone: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const civil = civilFromIso(iso, zone);
  if (!civil) return "-";
  // Names through `toLocaleDateString` (locale-shaped, out of scope), numerics
  // off the civil triple — never `getDate`/`getFullYear`, which would read the
  // process's zone and disagree with the month name beside them. Both sides
  // must resolve the SAME zone, which is why the guarded value is reused rather
  // than guarding each call: `civilFromIso` already degraded to UTC internally.
  const safe = usableZoneOr(zone);
  const weekday = d.toLocaleDateString([], { weekday: "short", timeZone: safe }).toUpperCase();
  const month = d.toLocaleDateString([], { month: "short", timeZone: safe }).toUpperCase();
  return `${weekday} · ${civil.day} ${month} ${civil.year}`;
}

/**
 * Session-id header label, e.g. "SET 975".
 *
 * Takes `SetRecord.session_label` (raw `sessions.session_identity`) when the
 * cloud read path supplied one, falling back to `external_id`. Story 4.6's code
 * review found this was rendering a raw 36-char uuid: `external_id` is
 * `sets.id` in the cloud path (the `sync_set` RPC has no `external_id`
 * parameter, so the agent's Serato-facing id is never stored), and the header
 * read `SET 872d5614-9894-5803-80f5-aa1dd4177944` where the fixture stage read
 * `SET 975`.
 *
 * The two real `session_identity` shapes (`agent/src-tauri/src/capture.rs`):
 * - `serato4:<n>` — `n` is Serato's own `history_session.id`, the exact number
 *   the fixture carried, so modern captures render identically to before.
 * - `legacy:<fnv1a_hex>` — pre-Serato-4 sets have no session table and so no
 *   Serato-visible number; identity is a hash of the first play. Shortened
 *   rather than shown whole: it is an opaque dedup key, not an id a DJ can look
 *   up, and 16 hex chars in a mono header line is noise.
 *
 * Anything else passes through if it is short enough to be an id a human might
 * recognise (the fixture's bare `"975"`), and is otherwise shortened — which is
 * what a bare uuid now hits, so even a missing/unjoined `session_label`
 * degrades to `SET 872D5614` rather than the full 36 characters.
 */
export function formatSessionLabel(identity: string): string {
  const serato4 = /^serato4:(\d+)$/.exec(identity);
  if (serato4) return `SET ${serato4[1]}`;

  const legacy = /^legacy:([0-9a-f]+)$/i.exec(identity);
  if (legacy) return `SET ${legacy[1].slice(0, 8).toUpperCase()}`;

  if (identity.length <= 12) return `SET ${identity}`;
  return `SET ${identity.slice(0, 8).toUpperCase()}`;
}

/** Human set length, e.g. "5h 56m", "56m", "0m". `null`/non-finite → "-". */
export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "-";
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

/** Row/hero date in the set's own zone, e.g. "Fri, Aug 1". `null`/garbage → "-". */
export function formatDayDate(iso: string | null, zone: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: usableZoneOr(zone),
  });
}

/**
 * The clock the DJ saw, e.g. "10:14 PM". `null`/garbage → "-".
 *
 * This is the label whose wrongness was most visible: a set that started at
 * 10:14 PM in Los Angeles rendered "5:14 AM" server-side, which is not a time
 * anyone plays a club set at.
 */
export function formatClock(iso: string | null, zone: string): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    timeZone: usableZoneOr(zone),
  });
}

/** Start AND end (D8: duration implied), e.g. "10:14 PM – 1:52 AM". */
export function formatTimeRange(
  startIso: string | null,
  endIso: string | null,
  zone: string,
): string {
  const start = formatClock(startIso, zone);
  const end = formatClock(endIso, zone);
  if (start === "-" && end === "-") return "-";
  return `${start} – ${end}`;
}

/** Whole-number BPM for stat rows, e.g. "125". `null`/non-finite → "-". */
export function formatBpm(bpm: number | null | undefined): string {
  return typeof bpm === "number" && Number.isFinite(bpm) ? `${Math.round(bpm)}` : "-";
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

const ELAPSED_MINUTE_MS = 60 * 1000;
const ELAPSED_HOUR_MS = 60 * ELAPSED_MINUTE_MS;
const ELAPSED_DAY_MS = 24 * ELAPSED_HOUR_MS;

/**
 * Elapsed-time phrase spanning minutes to years — e.g. "under a minute",
 * "40 minutes", "2 hours", "3 days", "2 weeks", "4 months", "1 year" (Story
 * 4.5, time-to-first-play). A coarser sibling to {@link formatDuration},
 * which is seconds-scale for a single set's length; this one measures the gap
 * between two events.
 *
 * **Sub-day tiers are load-bearing, not decoration (Story 4.5 review, Arjun's
 * ruling 2026-08-07).** The first shipped version floored everything under
 * 24h to a single "same day" bucket. Measured against the committed fixture
 * that swallowed **86.5% of real debuts** (215 played tracks, median 0.028
 * days ≈ 40 minutes) — the module rendered one constant string and told the
 * DJ nothing. It also produced ungrammatical copy at the call site, which
 * interpolates this return value as a noun phrase ("a median of same day to
 * debut"). Every tier below returns a noun phrase for that reason.
 *
 * Every return rounds at its own scale and re-checks the threshold, so a
 * value just under a boundary promotes cleanly (59.7 minutes reads "1 hour",
 * not "60 minutes").
 *
 * Defensive edges — all unreachable via `buildTimeToFirstPlay`, which
 * excludes plays before their track's add date and future-dated adds:
 * negative and `NaN` floor to the smallest bucket, but `Infinity` maps to the
 * LARGEST one. Mapping an unbounded duration to "under a minute" would fail
 * in the most misleading possible direction.
 */
export function formatElapsed(ms: number): string {
  if (ms === Number.POSITIVE_INFINITY) return "over a year";
  if (Number.isNaN(ms) || ms < ELAPSED_MINUTE_MS) return "under a minute";

  const minutes = Math.round(ms / ELAPSED_MINUTE_MS);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;

  const hours = Math.round(ms / ELAPSED_HOUR_MS);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"}`;

  const days = Math.round(ms / ELAPSED_DAY_MS);
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"}`;
  if (days < 60) {
    const weeks = Math.round(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"}`;
  }
  if (days < 365) {
    const months = Math.round(days / 30.44);
    return `${months} ${months === 1 ? "month" : "months"}`;
  }
  const years = Math.round(days / 365.25);
  return `${years} ${years === 1 ? "year" : "years"}`;
}
