// Zone-explicit civil-date derivation (Story 7.7). The ONE place in `web/`
// that turns an instant into a calendar day/week/month/hour.
//
// The bug this closes: every bucketing helper used to build a `Date` and read
// `getFullYear`/`getMonth`/`getDate`/`getDay`/`getHours` off it, which resolves
// in *the rendering process's* zone. These pages are Server Components, and the
// server is Vercel, and Vercel is UTC — so a DJ's 11pm Friday gig filed as
// Saturday, and an 11pm New Year's Eve set filed under January. Measured on
// production data at story time: 63 of 76 sets (83%) sat on the wrong calendar
// day, and 2 of 76 in the wrong month.
//
// **The rule: no function in this codebase may derive a calendar value from a
// timestamp without being handed a zone.** That is why every export here takes
// `zone` as a required parameter rather than defaulting it — a default is how
// the old behaviour comes back, silently, in the next helper someone writes.
//
// The zone itself comes from `resolveSetZone` below, and only from there.
import type { SetRecord } from "./types";

/** Last-resort zone. Only reached when a set has none AND the DJ has none. */
export const FALLBACK_ZONE = "UTC";

/** A calendar reading of an instant, already resolved into some zone. */
export type Civil = {
  year: number;
  /** 1-based, unlike `Date#getMonth`. */
  month: number;
  day: number;
  /** 0–23. `hourCycle: "h23"`, so midnight is 0 and never 24. */
  hour: number;
  minute: number;
};

/**
 * `Intl.DateTimeFormat` is expensive to construct and these run once per set
 * (and once per play, on the hour histogram) over hundreds of rows. One
 * formatter per zone, reused.
 *
 * Keyed on the zone string, which is also how an invalid zone is remembered:
 * see `formatterFor`.
 */
const formatters = new Map<string, { formatter: Intl.DateTimeFormat; usable: boolean }>();

/**
 * The cache is bounded because its key is remote input. `derived.timezone`
 * arrives from an agent on a machine we do not control, this module lives for
 * the whole life of a long-running server process, and an unusable zone is
 * cached too (that is how we remember not to re-try it). A buggy or hostile
 * agent sending a distinct zone per set would otherwise grow this map without
 * limit. Past the cap we stop caching and simply pay the construction cost —
 * slower, never unbounded. Real deployments hold a handful of zones.
 */
const MAX_CACHED_FORMATTERS = 64;

/**
 * A formatter pinned to `zone`, or the UTC one if `zone` is not a zone this
 * runtime knows, plus whether `zone` was usable at all.
 *
 * Degrading rather than throwing is deliberate and matches the house posture
 * everywhere else in this directory (`getObservationStart`, `hasRenderableDerived`):
 * the zone is data that crossed a wire from a machine we do not control, so a
 * garbage value must render a dashboard, not a 500. `Intl.DateTimeFormat`
 * throws `RangeError` on an unknown IANA name, and an agent from a machine with
 * a corrupt tzdata could produce one.
 *
 * **The `usable` flag is the half that was missing** (code review, 2026-08-17).
 * Degrading quietly inside this module told the rest of the app nothing, so
 * `resolveSetZone` reported a garbage zone as `source: "set"` — a real captured
 * answer — while every value derived from it was silently UTC, and
 * `countZoneFallbacks` said zero. A degradation that is not counted is the
 * silent guess AC-4 forbids.
 *
 * Note `"en-US"` rather than `[]`: the locale is pinned because a floating
 * locale is the *other* live date defect in this codebase (the
 * `toLocaleDateString([], …)` `June`/`juin` hydration mismatch, ledgered
 * separately and explicitly out of scope for this story). We read
 * `formatToParts` numerics only — never a formatted string, never a month or
 * weekday NAME — so the locale cannot leak into any value this module returns.
 * Pinning it means this file can never become a second instance of that bug.
 */
function entryFor(zone: string): { formatter: Intl.DateTimeFormat; usable: boolean } {
  const cached = formatters.get(zone);
  if (cached) return cached;

  let entry: { formatter: Intl.DateTimeFormat; usable: boolean };
  try {
    entry = {
      formatter: new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }),
      usable: true,
    };
  } catch {
    if (process.env.NODE_ENV !== "production") {
      console.error(`[civilTime] unknown time zone ${JSON.stringify(zone)} — falling back to UTC`);
    }
    entry = {
      formatter: zone === FALLBACK_ZONE ? throwingUtcFallback() : entryFor(FALLBACK_ZONE).formatter,
      usable: false,
    };
  }
  if (formatters.size < MAX_CACHED_FORMATTERS) formatters.set(zone, entry);
  return entry;
}

function formatterFor(zone: string): Intl.DateTimeFormat {
  return entryFor(zone).formatter;
}

/**
 * Whether this runtime can actually resolve `zone` — i.e. whether handing it to
 * `Intl` or to a `toLocale*` call is safe.
 *
 * Exported because the degradation cannot live only in this module: `format.ts`
 * and `listModel.ts` pass a zone into `toLocaleDateString`/`toLocaleTimeString`
 * for the locale-shaped NAMES this file deliberately refuses to read, and those
 * throw `RangeError` on an unknown zone. That is a 500 on the dashboard rather
 * than a wrong bucket, and it is reachable: `normalizeTimezone` at signup is a
 * shape check, not a membership check, so an authenticated DJ can persist
 * `"Mars/Olympus_Mons"` on their own `djs` row and have no UI left to clear it.
 */
export function isUsableZone(zone: string | null | undefined): boolean {
  return typeof zone === "string" && zone !== "" && entryFor(zone).usable;
}

/** `zone` if this runtime knows it, else {@link FALLBACK_ZONE}. The guard every
 *  `toLocale*` call site outside this module needs. */
export function usableZoneOr(zone: string, fallback: string = FALLBACK_ZONE): string {
  return isUsableZone(zone) ? zone : fallback;
}

/** Unreachable in practice — every runtime knows "UTC". Present so the
 *  fallback path in `formatterFor` cannot recurse forever if one does not. */
function throwingUtcFallback(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

/**
 * An instant (epoch ms) read as a calendar date in `zone`.
 *
 * Uses `formatToParts` rather than parsing a formatted string: a formatted
 * string is locale-shaped, and parsing `en-CA` output to get ISO-looking digits
 * is exactly the kind of accidental locale dependency this codebase already has
 * one of.
 */
export function civilInZone(ms: number, zone: string): Civil | null {
  // `Number.isFinite` alone is not the guard it looks like: `isFinite(1e16)` is
  // true, `new Date(1e16)` is an Invalid Date, and `formatToParts` then throws
  // `RangeError: Invalid time value` — from a function whose contract is to
  // return `null`. ±8.64e15 ms is ECMA-262's whole representable range.
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return null;
  const parts = formatterFor(zone).formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : Number.NaN;
  };
  const civil: Civil = {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
  return Object.values(civil).every(Number.isFinite) ? civil : null;
}

/** The same, from an ISO string. `null` for missing or unparsable input. */
export function civilFromIso(iso: string | null | undefined, zone: string): Civil | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : civilInZone(ms, zone);
}

const pad = (n: number) => `${n}`.padStart(2, "0");

/**
 * Local-date key `"2026-06-21"` — the day the DJ played, in `zone`. `""` for a
 * missing or unparsable timestamp, the same empty-key convention every caller
 * already handles.
 */
export function localDayKey(iso: string | null | undefined, zone: string): string {
  const c = civilFromIso(iso, zone);
  return c ? `${c.year}-${pad(c.month)}-${pad(c.day)}` : "";
}

/** Local-month key `"2026-06"`, in `zone`. `""` for missing/unparsable input. */
export function localMonthKey(iso: string | null | undefined, zone: string): string {
  const c = civilFromIso(iso, zone);
  return c ? `${c.year}-${pad(c.month)}` : "";
}

/**
 * Local Monday-of-the-week key `"2026-06-15"` — the week's start *date*, not an
 * ISO week number, so it sorts and formats with the same `"YYYY-MM-DD"` shape
 * as every other date key here.
 *
 * **Day-of-week is computed, not asked for.** `Intl` would happily return a
 * weekday, but only as a locale-dependent *name*. Instead: take the civil
 * `{y, m, d}` triple already resolved into `zone`, and do the arithmetic in
 * UTC. That is exact and zone-free precisely because the triple is no longer an
 * instant — it is a calendar date, and calendar dates have no offset left in
 * them. Doing this on a `Date` built from the raw timestamp is what produced
 * the 4 failures the TZ pin was hiding (see `web/vitest.config.ts:18`).
 */
export function localWeekKey(iso: string | null | undefined, zone: string): string {
  const c = civilFromIso(iso, zone);
  if (!c) return "";
  const asUtc = Date.UTC(c.year, c.month - 1, c.day);
  const dow = (new Date(asUtc).getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(asUtc - dow * 86_400_000);
  return `${monday.getUTCFullYear()}-${pad(monday.getUTCMonth() + 1)}-${pad(monday.getUTCDate())}`;
}

/** The hour of the night, 0–23, in `zone`. `null` for missing/unparsable input. */
export function localHour(iso: string | null | undefined, zone: string): number | null {
  const c = civilFromIso(iso, zone);
  return c ? c.hour : null;
}

/**
 * `zone`'s UTC offset in ms at a given instant — positive east of Greenwich,
 * so `instant + offset` is the local wall clock expressed as a UTC instant.
 *
 * Derived by differencing rather than by parsing `timeZoneName: "longOffset"`.
 * Both are correct; this one has no string to parse, so it cannot be broken by
 * a locale that renders `GMT−07:00` with a different minus sign or a
 * non-Latin digit — the same reason `civilInZone` reads parts instead of text.
 */
export function zoneOffsetMs(ms: number, zone: string): number {
  const c = civilInZone(ms, zone);
  if (!c) return 0;
  // Seconds and below are identical in every zone (no sub-minute offsets exist
  // in modern tzdata), so differencing at minute resolution is exact.
  const wallAsUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute);
  const instantAtMinute = Math.floor(ms / 60_000) * 60_000;
  return wallAsUtc - instantAtMinute;
}

/**
 * The first instant of a civil month in `zone`, as epoch ms.
 *
 * The offset must be looked up *at* the instant being computed, but you need
 * the instant to look up the offset. So: guess with the offset at the naive UTC
 * position, correct with the offset at the guessed position, and then **check**
 * — do not assume the correction landed.
 *
 * An earlier version returned the corrected guess unchecked, on the stated
 * grounds that "a month boundary is never that close to a DST transition
 * (transitions happen at 01:00–03:00 local on a Sunday)". That is simply not
 * true: Havana, Santiago, Asunción, Tehran and Beirut all transition at
 * 00:00/24:00 local, which is exactly a month boundary when it falls on the
 * 1st. Measured against real tzdata, the unchecked version returned
 * **2023-09-30 23:00** for `(2023, 10, "America/Asuncion")` — an instant in the
 * previous month, from a function named for the start of this one.
 *
 * When the clock jumps forward across midnight there is no such instant as
 * civil midnight that day, so neither candidate reads back as the target. The
 * later one is the moment the jump happens, i.e. the first instant of that
 * civil day that exists — the same answer `Temporal`'s `compatible`
 * disambiguation gives, and the one that keeps `civilMonthEndMs` from
 * overlapping the month before it.
 */
export function civilMonthStartMs(year: number, month: number, zone: string): number {
  const naive = Date.UTC(year, month - 1, 1);
  const guess = naive - zoneOffsetMs(naive, zone);
  const corrected = naive - zoneOffsetMs(guess, zone);

  const isTargetMidnight = (ms: number): boolean => {
    const c = civilInZone(ms, zone);
    return (
      c !== null &&
      c.year === year &&
      c.month === month &&
      c.day === 1 &&
      c.hour === 0 &&
      c.minute === 0
    );
  };

  // Earliest first: in a fall-back overlap civil midnight happens twice, and the
  // first occurrence is the month's start.
  const earlier = Math.min(guess, corrected);
  const later = Math.max(guess, corrected);
  if (isTargetMidnight(earlier)) return earlier;
  if (isTargetMidnight(later)) return later;
  return later;
}

/**
 * The last instant of a civil month in `zone` — i.e. one ms before the next
 * month begins there.
 *
 * The old implementation was `new Date(y, m, 0, 23, 59, 59, 999)`, which reads
 * the *process's* zone; on Vercel that made every cohort month end at 23:59 UTC
 * regardless of where the DJ was. Today the only consumer compares against a
 * 14–90 day window, so an hour of error changes no rendered value — but the
 * tolerance is not the justification. It is written correctly because the next
 * consumer will not have that tolerance, and nothing about the call site
 * announces that it currently does.
 */
export function civilMonthEndMs(year: number, month: number, zone: string): number {
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return civilMonthStartMs(nextYear, nextMonth, zone) - 1;
}

/** Parses a `"YYYY-MM"` key back to its numeric parts. `null` if malformed. */
export function parseMonthKey(key: string): { year: number; month: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/* ── Zone resolution — the single source of the answer ────────────────────── */

/**
 * How a set's zone was arrived at. `"set"` is the real answer; the other two
 * are degradations the UI is entitled to disclose (AC-4).
 */
export type ZoneSource = "set" | "dj" | "fallback";

export type ResolvedZone = { zone: string; source: ZoneSource };

/**
 * The resolution order, applied in exactly one place:
 *
 *   `set.derived.timezone` → `djs.timezone` → `"UTC"`
 *
 * **Never fail closed on a missing zone.** AD-3 binds the cloud to accept the
 * last N agent versions, so a payload with no `timezone` is valid *forever* —
 * it is not a migration state with an end date. Every set captured before
 * Story 7.7, and every set from an agent that has not auto-updated yet, arrives
 * here with nothing, and must still render. AD-19 independently forbids gating
 * in this direction.
 *
 * What is forbidden is guessing *silently*: a fallback is counted (see
 * {@link countZoneFallbacks}) so a caller can say so.
 *
 * **Usable, not merely present** (code review, 2026-08-17). Each step tests
 * {@link isUsableZone}, not truthiness. A truthy-but-unresolvable zone — `" "`,
 * `"UTC+5"`, a name from a tzdata release this runtime does not have — used to
 * win the chain and be reported as `source: "set"`, while `formatterFor`
 * quietly substituted UTC underneath it. The number the UI would have shown was
 * therefore a claim that every set was bucketed on its own captured zone, at
 * the exact moment none of them were. A zone we cannot resolve is not an
 * answer, and it falls through to the next step like any other absence.
 */
export function resolveSetZone(
  setTimezone: string | null | undefined,
  djTimezone: string | null | undefined,
): ResolvedZone {
  if (isUsableZone(setTimezone)) return { zone: setTimezone as string, source: "set" };
  if (isUsableZone(djTimezone)) return { zone: djTimezone as string, source: "dj" };
  return { zone: FALLBACK_ZONE, source: "fallback" };
}

/** {@link resolveSetZone} for a whole `SetRecord`. */
export function zoneForSet(set: SetRecord, djTimezone: string | null | undefined): ResolvedZone {
  return resolveSetZone(set.derived?.timezone, djTimezone);
}

/**
 * How many sets in `sets` were bucketed on something other than their own
 * captured zone (AC-4).
 *
 * The shape deliberately mirrors the disclosure counts already on these models
 * — `undatedCount`, `noAddDateCount`, `unreconciledDateCount` — so surfacing it
 * later is a copy change, not a model change. Per Arjun (2026-08-17), it stays
 * model-only for now: where it reads on Style Evolution and the calendar is a
 * copy decision, not an implementation one.
 */
export function countZoneFallbacks(
  sets: SetRecord[],
  djTimezone: string | null | undefined,
): number {
  return sets.reduce((n, set) => (zoneForSet(set, djTimezone).source === "set" ? n : n + 1), 0);
}
