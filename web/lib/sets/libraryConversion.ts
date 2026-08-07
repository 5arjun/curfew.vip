// Library-to-setlist correlation (Story 4.2, FR-10) — "are the tracks I keep
// buying actually making it to the dancefloor?", as a trend line over
// month-added cohorts.
//
// Pure and deterministic over already-fetched records, never mutating them
// (D-6): the same convention every other module in this directory follows
// (`hero`, `listModel`, `rightColumn`, `dancefloor`, `styleEvolution`). AD-1
// permits the cloud to SQL-reaggregate over synced rows, but nothing else in
// this codebase computes a stat that way, and introducing a second computation
// style for one story would cost more than it buys.
//
// `nowMs` is always injected, never read from the clock inside these functions
// — Story 4.1's review made that non-negotiable: a `Date.now()` inside a
// "pure" function is what made that suite machine-dependent and let two real
// bugs through a green gate.
import { formatElapsed } from "./format";
import { localMonthKey } from "./styleEvolution";
import type { SetRecord } from "./types";

/**
 * Selectable conversion windows, in days (D-13, Arjun 2026-08-07).
 *
 * **90 is the default and stays the default** — D-8 locked it to match the
 * window FR-11 already fixed for Story 4.3's conversion-rate meter
 * (`prd.md:239`, resolved 2026-07-21), so the trend line a DJ sees first and
 * the meter they see later can never disagree by quietly measuring different
 * things. 60 and 30 are an *exploration* affordance layered on top of that
 * default, not a redefinition of the metric.
 *
 * What shortening actually answers: not "did this track ever get played" but
 * "how FAST does new music reach a set". Two side effects, both intended and
 * both worth knowing when reading the chart:
 *   - Rates fall. A track first played on day 75 counts at 90 and not at 60.
 *   - The line gets LONGER. A cohort needs only its own window to complete
 *     (D-9), so at 30 days two more recent months are already scoreable.
 *
 * Ordered longest-first so the toggle reads 90 / 60 / 30 left to right — the
 * default sits leftmost, and the row reads as "loosen → tighten".
 */
export const CONVERSION_WINDOWS = [90, 60, 30] as const;
export type ConversionWindow = (typeof CONVERSION_WINDOWS)[number];

/**
 * D-8's locked window — the trend chart's first-visit default.
 *
 * **No longer the pip meter's default** (Arjun, 2026-08-07, post-launch of
 * this trend chart): the meter switched to a 60/30/14 scale of its own (see
 * {@link LIVE_CONVERSION_WINDOWS}), a deliberate divergence from the
 * "trend and meter never disagree" framing D-8 originally set — the two
 * features are allowed to measure different things now.
 */
export const DEFAULT_CONVERSION_WINDOW: ConversionWindow = 90;

/**
 * @deprecated Kept as the name D-8 and the migration comments refer to.
 * Prefer {@link DEFAULT_CONVERSION_WINDOW}.
 */
export const CONVERSION_WINDOW_DAYS = DEFAULT_CONVERSION_WINDOW;

/**
 * Selectable windows for the pip meter's LIVE current-window rate (Arjun,
 * 2026-08-07: "instead of 90 do 60 and add a drop down... 30 days or 2
 * weeks"). A separate scale from {@link CONVERSION_WINDOWS} on purpose — the
 * meter and the trend chart above are independent features as of this
 * change, each free to pick the window granularity that suits how it's
 * actually used (a live snapshot reads naturally at shorter, more recent
 * windows; a month-bucketed trend needs the longer ones to have enough
 * cohorts). 14 is "2 weeks" in the dropdown copy, not "14 days" — matching
 * how a DJ would actually say it.
 */
export const LIVE_CONVERSION_WINDOWS = [60, 30, 14] as const;
export type LiveWindow = (typeof LIVE_CONVERSION_WINDOWS)[number];

/** The meter's first-visit default (Arjun, 2026-08-07 — was 90 via {@link DEFAULT_CONVERSION_WINDOW}). */
export const DEFAULT_LIVE_WINDOW: LiveWindow = 60;

/**
 * How a DJ would actually say a live window ("2 weeks", not "14 days") —
 * the ONE place that special-case lives, so the visible caption and
 * {@link liveConversionRateSummary}'s `aria-label` text can never drift
 * apart the way a duplicated `window === 14 ? ... : ...` ternary would let
 * them (caught in Story 4.3's own review).
 */
export function liveWindowPhrase(window: number): string {
  return window === 14 ? "2 weeks" : `${window} days`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * One synced library add-event, as `library_track_events` stores it — the
 * denominator that did not exist before this story (Story 1.10, Open Question
 * #1). Mirrors `SyncLibraryAddEvent` in `@curfew/shared`.
 */
export interface LibraryAddEvent {
  /** Opaque `fnv1a_hex` track identity (D-2). Joins to `SyncPlay.track_id`. */
  track_id: string;
  /** ISO 8601, or `null` when no reachable catalogue covered the track (D-10). */
  added_at: string | null;
}

/** One completed month-added cohort — a plotted point on the trend line. */
export interface CohortPoint {
  /** Local-month key of when these tracks were ADDED, e.g. "2026-03". */
  bucket: string;
  /** Tracks added in this month that have a resolvable add-date. The denominator. */
  added: number;
  /** How many of them were played within this series' window of being added. */
  converted: number;
  /** `converted / added`, 0–1. Never `null` here: a cohort with no tracks is not emitted at all. */
  rate: number;
}

/** One window's worth of cohorts — the unit the chart plots. */
export interface WindowSeries {
  /** Which window produced these numbers, in days. */
  window: ConversionWindow;
  /**
   * Completed cohorts only, ascending by month (D-9). A cohort still inside
   * its conversion window is absent entirely — not zero, not partial, not a
   * provisional low number that would libel a DJ's most recent digging.
   */
  cohorts: CohortPoint[];
  /**
   * Cohorts omitted because their window has not closed yet (D-9). Surfaced
   * rather than silently dropped, so "the last few months are missing" reads
   * as a deliberate wait rather than a bug. Shrinks as the window shortens.
   */
  pendingCohortCount: number;
}

export interface LibraryConversionModel {
  /**
   * Every selectable window, precomputed up front — switching the toggle picks
   * a precomputed series rather than recomputing (the same discipline
   * `styleEvolution`'s month/week × excluding/including matrix follows: no work
   * happens on click).
   */
  windows: Record<ConversionWindow, WindowSeries>;
  /**
   * Tracks with no resolvable `tadd`/`uadd` (D-10). Excluded from every
   * cohort's numerator AND denominator — never folded in, never silently
   * dropped. Always disclosed alongside the chart. Window-independent: an
   * undated track is undated at every window.
   */
  noAddDateCount: number;
  /** Every add-event on file, including the two excluded classes above. */
  totalTracked: number;
}

/**
 * The last instant of a local calendar month, in ms — the moment from which
 * that cohort's slowest-added track starts its 90-day clock.
 */
function monthEndMs(monthKey: string): number {
  const [year, month] = monthKey.split("-").map(Number);
  // Day 0 of the NEXT month is the last day of this one; 23:59:59.999 local.
  return new Date(year, month, 0, 23, 59, 59, 999).getTime();
}

/**
 * Whether a month-added cohort has finished converting (D-9).
 *
 * Measured from the END of the month, not its start: a track added on March
 * 31st has not had its 90 days until late June, and reporting March as
 * "complete" in mid-June would score that track a failure purely for having
 * been bought late in the month. Strictly conservative on purpose — a cohort
 * shown at all is one where every single track had its full window.
 */
export function isCohortComplete(monthKey: string, nowMs: number, window: ConversionWindow): boolean {
  return nowMs >= monthEndMs(monthKey) + window * DAY_MS;
}

/** ms since epoch for an ISO timestamp, or `null` if missing/unparsable. */
function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Earliest play time per track identity, across every set.
 *
 * Earliest rather than any-play because the question is "did this track make
 * it into a set *while it was still new*" — a track first played two years
 * after being added does not become a conversion because it was also played
 * again last week.
 *
 * Plays with no `track_id` (every pre-4.2 row) and no `started_at` simply
 * cannot participate; they are skipped, never counted as a non-conversion of
 * some other track.
 */
export function firstPlayByTrack(sets: SetRecord[]): Map<string, number> {
  const first = new Map<string, number>();
  for (const set of sets) {
    for (const play of set.plays) {
      const trackId = play.track_id;
      if (!trackId) continue;
      const playedMs = msOf(play.started_at);
      if (playedMs === null) continue;
      const existing = first.get(trackId);
      if (existing === undefined || playedMs < existing) first.set(trackId, playedMs);
    }
  }
  return first;
}

/**
 * Every play time per track identity, ascending — the sibling index to
 * {@link firstPlayByTrack}, for the one question a single earliest-play value
 * cannot answer: "what is the first play *at or after* some per-track date?"
 *
 * {@link buildLiveConversionRate} only ever needs the global minimum, so it
 * keeps using `firstPlayByTrack`. Story 4.5's time-to-first-play needs this
 * one: a track with a pre-add play AND a genuine post-add debut has a global
 * minimum that answers the wrong question, and reading it discarded 18 real
 * debuts on the committed fixture (Story 4.5 review).
 *
 * Same skip rules as `firstPlayByTrack` — plays with no `track_id` (every
 * pre-4.2 row) or no parseable `started_at` cannot participate.
 */
export function playsByTrack(sets: SetRecord[]): Map<string, number[]> {
  const byTrack = new Map<string, number[]>();
  for (const set of sets) {
    for (const play of set.plays) {
      const trackId = play.track_id;
      if (!trackId) continue;
      const playedMs = msOf(play.started_at);
      if (playedMs === null) continue;
      const existing = byTrack.get(trackId);
      if (existing === undefined) byTrack.set(trackId, [playedMs]);
      else existing.push(playedMs);
    }
  }
  for (const times of byTrack.values()) times.sort((a, b) => a - b);
  return byTrack;
}

/**
 * Whether a track counts as converted: first played within `window` days
 * *after* it was added.
 *
 * The window is closed at both ends, `[added, added + window]`. A play strictly
 * BEFORE the add date is not a conversion — it is a clock/catalogue
 * inconsistency (the same track resolved from a different drive, say), and
 * counting it would inflate the rate using data that says the opposite of what
 * the metric claims.
 */
export function convertedWithinWindow(
  addedMs: number,
  firstPlayMs: number | undefined,
  window: ConversionWindow = DEFAULT_CONVERSION_WINDOW,
): boolean {
  if (firstPlayMs === undefined) return false;
  return firstPlayMs >= addedMs && firstPlayMs <= addedMs + window * DAY_MS;
}

/**
 * The whole model, from synced add-events plus play history (AC-1, AC-7).
 *
 * Cohorts are keyed by the local month a track was ADDED — deliberately a
 * different x-axis from Style Evolution's other three metrics, which bucket by
 * the month a set was PLAYED. Only one metric is ever on screen at a time
 * (`MetricChipToggle`), so the two never share a plot and cannot be misread as
 * the same axis.
 *
 * Every window in {@link CONVERSION_WINDOWS} is computed in one pass (D-13):
 * the expensive half — building the first-play index and bucketing the events —
 * is shared, and only the two comparisons per event differ per window. That is
 * what lets the toggle be a lookup rather than a recompute.
 */
export function buildLibraryConversion(
  events: LibraryAddEvent[],
  sets: SetRecord[],
  nowMs: number,
): LibraryConversionModel {
  const firstPlay = firstPlayByTrack(sets);

  let noAddDateCount = 0;
  // bucket -> { added, converted-per-window }
  const tally = new Map<string, { added: number; converted: Map<ConversionWindow, number> }>();
  // One event per track is the DB's own guarantee (unique (dj_id, track_id)),
  // but de-duping here too keeps the pure function honest against any caller
  // that hands it a redelivered batch.
  const seen = new Set<string>();

  for (const event of events) {
    if (seen.has(event.track_id)) continue;
    seen.add(event.track_id);

    const addedMs = msOf(event.added_at);
    if (addedMs === null) {
      noAddDateCount++;
      continue;
    }

    const bucket = localMonthKey(event.added_at);
    if (!bucket) {
      // A date that parsed to ms but not to a month key should be
      // unreachable; treat it as undated rather than inventing a bucket.
      noAddDateCount++;
      continue;
    }

    let entry = tally.get(bucket);
    if (!entry) {
      entry = { added: 0, converted: new Map(CONVERSION_WINDOWS.map((w) => [w, 0])) };
      tally.set(bucket, entry);
    }
    entry.added++;

    const played = firstPlay.get(event.track_id);
    for (const window of CONVERSION_WINDOWS) {
      if (convertedWithinWindow(addedMs, played, window)) {
        entry.converted.set(window, (entry.converted.get(window) ?? 0) + 1);
      }
    }
  }

  const ordered = [...tally.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const windows = {} as Record<ConversionWindow, WindowSeries>;
  for (const window of CONVERSION_WINDOWS) {
    const cohorts: CohortPoint[] = [];
    let pendingCohortCount = 0;
    for (const [bucket, entry] of ordered) {
      if (!isCohortComplete(bucket, nowMs, window)) {
        pendingCohortCount++;
        continue;
      }
      const converted = entry.converted.get(window) ?? 0;
      cohorts.push({ bucket, added: entry.added, converted, rate: converted / entry.added });
    }
    windows[window] = { window, cohorts, pendingCohortCount };
  }

  return { windows, noAddDateCount, totalTracked: seen.size };
}

/**
 * AC-3's insufficient-history gate: fewer than two completed cohorts is not a
 * trend, it is a dot. Deliberately counts COMPLETED cohorts only — a DJ three
 * months into using Curfew genuinely has nothing to compare yet, and saying so
 * beats drawing a line through one point.
 */
export function hasEnoughCohorts(model: LibraryConversionModel, window: ConversionWindow): boolean {
  return model.windows[window].cohorts.length >= 2;
}

/**
 * Below this many added tracks, a cohort's rate is de-emphasised rather than
 * plotted at full confidence (deferred-work.md: a 1-track cohort read as
 * confidently as a 256-track one, immediately next to it, with nothing on
 * the chart telling them apart). A default, not a derived value — same
 * footing as {@link RATE_STEADY_THRESHOLD} above. Revisit before Story 4.3's
 * conversion-rate meter, which reads these same cohorts.
 */
export const LOW_CONFIDENCE_COHORT_SIZE = 5;

/** Whether a cohort's `added` count is too small to plot at full confidence. */
export function isLowConfidenceCohort(added: number): boolean {
  return added < LOW_CONFIDENCE_COHORT_SIZE;
}

/**
 * Story 4.3 (AC-1, AC-3, AC-4), Decision E-1: the pip meter's **live,
 * current-window** stat. Deliberately a **separate** computation from
 * {@link buildLibraryConversion} above, not a read of `model.windows[...]` —
 * see the story's Context & Authority section (Decision E-1) for why: the
 * cohort model structurally *excludes* any cohort whose window has not fully
 * elapsed yet ({@link isCohortComplete}), which is exactly the population
 * this meter is about ("tracks added in the last N days").
 *
 * Denominator = every dated add-event whose `added_at` falls in
 * `[nowMs - window*day, nowMs]` — no {@link isCohortComplete} gate: a track
 * added yesterday is already in the denominator, unlike the cohort model
 * where its whole month would not plot for another `window` days. Numerator
 * = however many of those have EVER been played, with no upper time bound
 * (unlike {@link convertedWithinWindow}'s `[added, added + window]` cap) —
 * that cap exists in the cohort model to make "did this track convert
 * *within its own window*" a well-defined per-cohort question; this meter
 * asks a different question ("has it been played at all, yet"), so a play
 * landing after the window has closed still counts.
 *
 * A play strictly BEFORE its track's `added_at` is still excluded, matching
 * {@link convertedWithinWindow}'s existing precedent: it is a clock/catalogue
 * inconsistency (the same track resolved from a different drive, say), never
 * real evidence the DJ played a track after acquiring it.
 */
export interface LiveConversionRate {
  /** Which window this rate was computed for — see {@link LIVE_CONVERSION_WINDOWS}. */
  window: LiveWindow;
  /** Dated tracks added within the trailing window as of `nowMs`. The denominator. */
  added: number;
  /** How many of `added` have a play at or after their own `added_at`. */
  played: number;
  /** `played / added`, 0–1. `null` when `added` is 0 — nothing to divide, never a fabricated 0%. */
  rate: number | null;
  /** Whether `added` is small enough to read as low-confidence (D-13 precedent, {@link isLowConfidenceCohort}). */
  lowConfidence: boolean;
  /**
   * Tracks with no resolvable `tadd`/`uadd` at all (AC-4) — the SAME
   * window-independent count {@link buildLibraryConversion}'s
   * `noAddDateCount` reports, over the same `events`. An undated track's true
   * add date is unknowable, so it is excluded here exactly as there: never
   * guessed into the window, never silently folded into `added`.
   */
  noAddDateCount: number;
}

/**
 * Builds {@link LiveConversionRate} from the same synced add-events and play
 * history {@link buildLibraryConversion} reads (AC-1, AC-3, AC-4). `nowMs` is
 * injected, never read from the clock — the same hard rule this file's header
 * states for every function here.
 *
 * `sets` is diffed into a first-play index internally UNLESS the caller
 * already has one (e.g. the page precomputing every {@link LIVE_CONVERSION_WINDOWS}
 * entry up front, per D-13) — pass it as `precomputedFirstPlay` so the O(sets)
 * pass isn't repeated once per window (Story 4.3 review).
 */
export function buildLiveConversionRate(
  events: LibraryAddEvent[],
  sets: SetRecord[],
  nowMs: number,
  window: LiveWindow = DEFAULT_LIVE_WINDOW,
  precomputedFirstPlay?: Map<string, number>,
): LiveConversionRate {
  const firstPlay = precomputedFirstPlay ?? firstPlayByTrack(sets);
  const windowStartMs = nowMs - window * DAY_MS;

  // One event per track is the DB's own guarantee (unique (dj_id, track_id)),
  // but de-duping here too keeps this pure function honest against any caller
  // that hands it a redelivered batch — mirrors `buildLibraryConversion`.
  const seen = new Set<string>();
  let noAddDateCount = 0;
  let added = 0;
  let played = 0;

  for (const event of events) {
    if (seen.has(event.track_id)) continue;
    seen.add(event.track_id);

    const addedMs = msOf(event.added_at);
    if (addedMs === null) {
      noAddDateCount++;
      continue;
    }
    // Outside the trailing window — either added too long ago, or (clock
    // skew) an add date that has not happened yet from `nowMs`'s vantage.
    // Neither belongs in "added in the last `window` days".
    if (addedMs < windowStartMs || addedMs > nowMs) continue;

    added++;
    const firstPlayMs = firstPlay.get(event.track_id);
    if (firstPlayMs !== undefined && firstPlayMs >= addedMs) {
      played++;
    }
  }

  return {
    window,
    added,
    played,
    rate: added === 0 ? null : played / added,
    lowConfidence: isLowConfidenceCohort(added),
    noAddDateCount,
  };
}

/* ── Chart summary — one generator, three duties (AC-2) ────────────────── */

/** "March 2026" / "March" for a cohort's month key. Mirrors `styleEvolution`'s
 *  own `monthLabel`, kept local so this module stays importable on its own. */
function monthLabel(monthKey: string, withYear: boolean): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(
    [],
    withYear ? { month: "long", year: "numeric" } : { month: "long" },
  );
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

/** |Δ| below this many percentage points reads as "held steady" rather than a
 *  move. A few points of drift between two cohorts is sampling noise, not a
 *  change in how a DJ digs. Same spirit as `DIVERSITY_STEADY_THRESHOLD`. */
const RATE_STEADY_THRESHOLD = 0.05;

/**
 * THE chart-summary string (AC-2): the visible caption AND the chart's aria
 * text-equivalent AND what the render-failure fallback shows — one pure
 * generator, three duties, following `energyArc.ts`'s `arcTextEquivalent`
 * template exactly.
 *
 * Story 4.1's review found the single worst way to get this wrong: rendering
 * one sentence visibly while exposing a *different* one as `aria-label`. There
 * is one function here for that reason, and the component must not compose its
 * own variant.
 *
 * The undated-track disclosure (D-10) is deliberately NOT part of this string
 * — it is a standing fact about coverage, not a description of the trend, and
 * folding it in would put it inside the render-failure fallback where it reads
 * as an explanation of the failure. `undatedDisclosure` below owns it.
 */
export function libraryConversionSummary(
  model: LibraryConversionModel,
  window: ConversionWindow,
): string {
  const { cohorts, pendingCohortCount } = model.windows[window];
  if (cohorts.length === 0) {
    return pendingCohortCount > 0
      ? `No cohorts have finished their ${window}-day window yet.`
      : "No library additions tracked yet.";
  }

  const withYear = new Set(cohorts.map((c) => c.bucket.slice(0, 4))).size > 1;

  if (cohorts.length === 1) {
    const only = cohorts[0];
    return `${only.converted} of the ${only.added} tracks added in ${monthLabel(only.bucket, withYear)} made it into a set within ${window} days (${pct(only.rate)}).`;
  }

  const first = cohorts[0];
  const last = cohorts[cohorts.length - 1];
  // Arjun, 2026-08-07: the bare percentage alone left "how many tracks are we
  // even talking about" undiscoverable without hovering — the exact counts
  // now lead every summary, not just the hover chip / single-cohort case.
  const lastPhrase = `${last.converted} of the ${last.added} tracks added in ${monthLabel(last.bucket, withYear)} made it into a set within ${window} days (${pct(last.rate)})`;
  const delta = last.rate - first.rate;

  if (Math.abs(delta) < RATE_STEADY_THRESHOLD) {
    return `${lastPhrase} — about the same as ${monthLabel(first.bucket, withYear)}.`;
  }

  const direction = delta > 0 ? "up" : "down";
  return `${lastPhrase} — ${direction} from ${pct(first.rate)} in ${monthLabel(first.bucket, withYear)}.`;
}

/**
 * The pip meter's chart-summary string (Story 4.3, AC-2/AC-3) — same "one
 * generator, three duties" discipline as {@link libraryConversionSummary}:
 * one function backs the visible caption, the `aria-label`, and (should the
 * meter ever grow a render-failure fallback) that fallback too. Names the
 * window explicitly (AC-3), matching `TrendChart`'s D-13 precedent of never
 * leaving the active window implicit.
 */
export function liveConversionRateSummary(rate: LiveConversionRate): string {
  const windowPhrase = liveWindowPhrase(rate.window);
  if (rate.added === 0) {
    return `No tracks added in the last ${windowPhrase}.`;
  }
  return `${rate.played} of ${rate.added} tracks added in the last ${windowPhrase} have been played in a set (${pct(rate.rate ?? 0)}).`;
}

/**
 * The always-visible coverage disclosure (AC-7 / D-10; reused for Story 4.3's
 * meter, AC-4). Returns `null` when there is genuinely nothing to disclose,
 * so a clean library never carries a caveat it hasn't earned.
 *
 * Two separate honesty debts, deliberately in one line: tracks whose add-date
 * no reachable catalogue could resolve (excluded from the math entirely), and
 * cohorts still inside their conversion window (excluded from the line, D-9).
 * Both are omissions the DJ can see the shape of; neither is ever folded into
 * a number silently.
 *
 * Takes the two counts directly (not a {@link LibraryConversionModel}) so
 * {@link LiveConversionRate} — which has no cohorts and therefore no
 * `pendingCohortCount` concept — can reuse this exact generator (Story 4.3
 * Task 2) rather than a second one: pass `pendingCohortCount: 0` and the
 * second clause simply never fires.
 *
 * `window` is a bare `number`, not {@link ConversionWindow}: the cohort model
 * and the live meter ({@link LiveWindow}) now select from two different
 * window scales, and this generator only ever interpolates the value into a
 * sentence — it has no reason to care which scale it came from.
 */
export function undatedDisclosure(
  counts: { noAddDateCount: number; pendingCohortCount: number },
  window: number,
): string | null {
  const { noAddDateCount, pendingCohortCount } = counts;
  const parts: string[] = [];
  if (noAddDateCount > 0) {
    parts.push(
      `${noAddDateCount} ${noAddDateCount === 1 ? "track has" : "tracks have"} no known add date`,
    );
  }
  if (pendingCohortCount > 0) {
    parts.push(
      `${pendingCohortCount} recent ${pendingCohortCount === 1 ? "month is" : "months are"} still inside the ${window}-day window`,
    );
  }
  if (parts.length === 0) return null;
  return `${parts.join(", and ")} — not counted here.`;
}

/* ── Time-to-first-play (Story 4.5, FR-13) ──────────────────────────────── */

/**
 * One qualifying track's debut story. A discriminated union rather than a
 * nullable `elapsedMs` (AC-3): "never played yet" and "played, 0ms after
 * add" are different facts, and collapsing "never played" to `null`/`0`
 * would either vanish it from a median silently or corrupt the median with a
 * fabricated instant debut.
 */
export type TimeToFirstPlayEntry =
  | { trackId: string; addedMs: number; status: "played"; elapsedMs: number }
  | { trackId: string; addedMs: number; status: "never-played" }
  | { trackId: string; addedMs: number; status: "played-before-add" };

export interface TimeToFirstPlayModel {
  /** One entry per dated add-event (AC-5 excludes undated ones — see `noAddDateCount`). */
  entries: TimeToFirstPlayEntry[];
  /** Median elapsed time across `status: "played"` entries only. `null` when none exist. */
  medianElapsedMs: number | null;
  /** Qualifying tracks never played (AC-3) — always shown, never folded into the median. */
  neverPlayedCount: number;
  /**
   * Median time the never-played population has been sitting unplayed, as of
   * `nowMs`. `null` when nothing is unplayed. Exists so the never-played count
   * can be stated with its age rather than lumping a track added an hour ago
   * in with one ignored for two years (Story 4.5 review, Arjun's ruling
   * 2026-08-07 — the "days since add, unplayed" framing Dev Notes anticipated).
   */
  neverPlayedMedianAgeMs: number | null;
  /**
   * Tracks whose only observed plays PREDATE their add date — a
   * clock/catalogue inconsistency (the same track resolved from another
   * drive, say), not a debut and not evidence the track was never played.
   * Excluded from the median AND from `neverPlayedCount`, because asserting
   * "hasn't been played yet" about a track the DJ demonstrably played is a
   * false statement, not a conservative one (Story 4.5 review).
   */
  playedBeforeAddCount: number;
  /** Tracks with no resolvable `tadd`/`uadd` (AC-5) — same window-independent gap
   *  {@link buildLibraryConversion}'s `noAddDateCount` reports, over the same `events`. */
  noAddDateCount: number;
}

/**
 * Below this many qualifying tracks (AC-4), the median is de-emphasised in
 * favour of the insufficient-history state rather than plotted as a
 * distribution drawn from a handful of points. A product default, not a
 * derived value — same footing as {@link LOW_CONFIDENCE_COHORT_SIZE}, but a
 * distinct constant: that one bounds a single 90-day cohort's size, this one
 * bounds a lifetime-to-date qualifying-track count, and reusing one for both
 * would silently couple two unrelated judgment calls.
 */
export const MIN_TIME_TO_FIRST_PLAY_TRACKS = 5;

/**
 * Minimum number of tracks that must actually have DEBUTED before a median is
 * shown at all. A product default, same footing as
 * {@link MIN_TIME_TO_FIRST_PLAY_TRACKS} above.
 *
 * This is the second half of AC-4, and the first shipped version was missing
 * it (Story 4.5 review): gating only on population size let a DJ with 500
 * qualifying tracks and a single debut see an unqualified "median" drawn from
 * n=1. AC-4's wording is "*rather than a distribution drawn from a handful of
 * points*", which a population-size gate structurally cannot enforce, because
 * never-played tracks pass the gate and contribute nothing to the median.
 */
export const MIN_TIME_TO_FIRST_PLAY_DEBUTS = 5;

/**
 * AC-4's insufficient-history gate — whether the module renders at all.
 *
 * Deliberately a POPULATION gate, not a debut gate: a DJ whose qualifying
 * tracks mostly haven't debuted yet should still see the honest "N tracks
 * haven't been played yet" state, not have the module hidden for the very
 * reason it would be interesting. Whether the *median* is shown is a separate
 * question — see {@link hasEnoughTimeToFirstPlayDebuts}.
 */
export function hasEnoughTimeToFirstPlayTracks(model: TimeToFirstPlayModel): boolean {
  return model.entries.length >= MIN_TIME_TO_FIRST_PLAY_TRACKS;
}

/**
 * AC-4's second gate — whether enough tracks have actually debuted for a
 * median to mean anything. Below this, the module still renders (see above),
 * but reports the never-played population instead of a thin median.
 */
export function hasEnoughTimeToFirstPlayDebuts(model: TimeToFirstPlayModel): boolean {
  return playedCountOf(model) >= MIN_TIME_TO_FIRST_PLAY_DEBUTS;
}

/** Tracks with a real, computed debut — the median's actual sample size. */
export function playedCountOf(model: TimeToFirstPlayModel): number {
  return model.entries.filter((e) => e.status === "played").length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Builds {@link TimeToFirstPlayModel} from the same synced add-events and
 * play history {@link buildLibraryConversion}/{@link buildLiveConversionRate}
 * read (AC-1, AC-2, AC-3, AC-5).
 *
 * The population boundary (AC-1/AC-2: "tracks added on or after the DJ's
 * subscription start", per the re-spec) needs no filter written here at
 * all — see this story's Context & Authority section. `library_track_events`
 * can only ever contain tracks whose add was observed go-forward (Story
 * 4.2's D-1 baseline-then-diff design silently absorbs anything older into
 * the baseline and never emits it as an event), so every `events` row handed
 * to this function is already inside the population by construction. A
 * second filter here would be redundant at best.
 *
 * Unlike {@link buildLiveConversionRate}, this function takes no `nowMs` —
 * the population is closed-form from `events`/`sets` alone, with no trailing
 * window to measure against "now".
 */
export function buildTimeToFirstPlay(
  events: LibraryAddEvent[],
  sets: SetRecord[],
  nowMs: number,
  precomputedPlays?: Map<string, number[]>,
): TimeToFirstPlayModel {
  const plays = precomputedPlays ?? playsByTrack(sets);

  let noAddDateCount = 0;
  let neverPlayedCount = 0;
  let playedBeforeAddCount = 0;
  const entries: TimeToFirstPlayEntry[] = [];
  const neverPlayedAges: number[] = [];

  for (const event of dedupeAddEvents(events)) {
    const addedMs = msOf(event.added_at);
    if (addedMs === null) {
      noAddDateCount++;
      continue;
    }
    // Clock-skew guard, matching `buildLiveConversionRate`'s existing
    // precedent (`addedMs > nowMs` is dropped there too). Without it the same
    // future-dated event was excluded by one module on this page and reported
    // as a never-played failure by the other (Story 4.5 review).
    if (addedMs > nowMs) continue;

    // The earliest play AT OR AFTER the add date — NOT the globally earliest
    // play. Testing the global minimum (the first shipped version) discarded
    // every track that had both a pre-add play and a real post-add debut:
    // measured at 18 of 523 on the committed fixture, with elapsed values up
    // to 78.5 days silently dropped from the median and counted into
    // "haven't been played yet" instead. Task 1's own wording is the correct
    // predicate: "if a play exists at or after `added_at`".
    const trackPlays = plays.get(event.track_id);
    const debutMs = trackPlays?.find((playedMs) => playedMs >= addedMs);

    if (debutMs !== undefined) {
      entries.push({ trackId: event.track_id, addedMs, status: "played", elapsedMs: debutMs - addedMs });
    } else if (trackPlays !== undefined && trackPlays.length > 0) {
      // Observed plays exist, but all of them predate the add date. Not a
      // debut, and NOT "never played" — see `playedBeforeAddCount`.
      playedBeforeAddCount++;
      entries.push({ trackId: event.track_id, addedMs, status: "played-before-add" });
    } else {
      neverPlayedCount++;
      neverPlayedAges.push(nowMs - addedMs);
      entries.push({ trackId: event.track_id, addedMs, status: "never-played" });
    }
  }

  const playedElapsed = entries
    .filter((e): e is Extract<TimeToFirstPlayEntry, { status: "played" }> => e.status === "played")
    .map((e) => e.elapsedMs);

  return {
    entries,
    medianElapsedMs: median(playedElapsed),
    neverPlayedCount,
    neverPlayedMedianAgeMs: median(neverPlayedAges),
    playedBeforeAddCount,
    noAddDateCount,
  };
}

/**
 * Collapses redelivered add-events to one row per track identity.
 *
 * One event per track is the DB's own guarantee (`unique (dj_id, track_id)`),
 * so this only matters against a caller handing over a redelivered batch —
 * but the tie-break is not arbitrary. **A dated row always beats an undated
 * one, and among dated rows the EARLIEST `added_at` wins.** The first shipped
 * version kept whichever row appeared first in the array, so an undated
 * redelivery arriving ahead of a dated one permanently undated the track, and
 * two dated rows let the later date win — inflating every elapsed time
 * computed from it (Story 4.5 review).
 *
 * This is the same earliest-wins rule Story 4.3 already ruled for the
 * identical collision at the agent layer (`capture::dedupe_by_identity`),
 * applied at the read side rather than invented separately.
 */
function dedupeAddEvents(events: LibraryAddEvent[]): LibraryAddEvent[] {
  const best = new Map<string, LibraryAddEvent>();
  for (const event of events) {
    const existing = best.get(event.track_id);
    if (existing === undefined) {
      best.set(event.track_id, event);
      continue;
    }
    const incomingMs = msOf(event.added_at);
    if (incomingMs === null) continue;
    const existingMs = msOf(existing.added_at);
    if (existingMs === null || incomingMs < existingMs) best.set(event.track_id, event);
  }
  return [...best.values()];
}

/**
 * The time-to-first-play module's chart-summary string — same "one
 * generator, three duties" discipline as {@link libraryConversionSummary}/
 * {@link liveConversionRateSummary}: backs the visible caption and the
 * `aria-label` from one function, so they can never drift apart.
 */
export function timeToFirstPlaySummary(model: TimeToFirstPlayModel): string {
  const playedCount = playedCountOf(model);
  const unplayed = model.neverPlayedCount;

  // Below the debut floor there is no median worth stating, whatever the
  // population size — AC-4's "rather than a distribution drawn from a handful
  // of points" (Story 4.5 review). Report the waiting population instead.
  if (!hasEnoughTimeToFirstPlayDebuts(model)) {
    if (unplayed === 0) return "No tracks have debuted yet.";
    const age = model.neverPlayedMedianAgeMs;
    const waiting = `${unplayed} ${unplayed === 1 ? "track has" : "tracks have"} been added but not played yet`;
    return age === null ? `${waiting}.` : `${waiting} — a median of ${formatElapsed(age)} on the shelf.`;
  }

  // `playedCount >= MIN_TIME_TO_FIRST_PLAY_DEBUTS` guarantees a non-null
  // median; asserting it beats a `?? 0` fallback, which would silently invent
  // the smallest possible value if the invariant ever broke.
  const elapsed = formatElapsed(model.medianElapsedMs as number);
  const debuts = `${playedCount === 1 ? "1 track has" : `${playedCount} tracks have`} debuted, a median of ${elapsed} after being added`;
  if (unplayed === 0) return `${debuts}.`;
  return `${debuts} — ${unplayed} ${unplayed === 1 ? "other hasn't" : "others haven't"} been played yet.`;
}
