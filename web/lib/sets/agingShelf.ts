// Aging shelf (Story 4.4, FR-12) — "which of my tracks have gone unplayed
// long enough to be worth resurfacing?", as a list sorted by days unplayed.
//
// Pure and deterministic over already-fetched records, never mutating them
// (D-6): the same convention every other module in this directory follows
// (`libraryConversion`, `libraryRoster`, `hero`, `listModel`, `dancefloor`,
// `styleEvolution`). `nowMs` is always injected, never read from the clock in
// here — Story 4.1's review made that non-negotiable.
//
// **The rows are read-only, and that is a ruling, not an omission.** UX-DR12
// specifies a row-level "add to prep crate" action and calls it "the one place
// the product nudges toward an action, not just a report". Arjun ruled it out
// of MVP on 2026-08-08: there is no cloud→agent command channel anywhere in
// this system (AD-8 and all three of its named write amendments — AD-20
// heartbeat, AD-21 add-events, AD-22 roster — are outbound-only, and nothing
// pulls instructions down), and a real Serato crate write would additionally be
// the first-ever WRITE to Serato against a binary `.crate` format with
// file-locking hazards. Its own story or epic. **Do not add a substitute
// affordance here** — no dismiss, no star, no "mark as reviewed". Without the
// action the shelf simply IS the report, and that is the honest shape.
//
// Tier A only (Context §5): a row is title — artist — days unplayed. BPM, key
// and genre are Tier B and explicitly parked (AD-22), and are not to be
// synthesized from `plays` for the subset that happens to have been played —
// a shelf where some rows carry tags and most do not reads as broken data
// rather than a deliberate scope.
import type { LibraryRosterEntry } from "./libraryRoster";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How long a track must have gone unplayed to reach the shelf.
 *
 * **90 days, not "3 calendar months"** — deliberately, and stated here so it is
 * not re-litigated as an oversight. FR-12 says "3+ months", but every other
 * window in Epic 4 is a day count ({@link CONVERSION_WINDOWS} is 60/30/14), and
 * a calendar-month definition drifts by up to 3 days depending on which month a
 * track's clock starts in — so two tracks with identical shelf ages would
 * qualify on different days purely because one was added in February.
 */
export const AGING_THRESHOLD_DAYS = 90;

/**
 * The recently-downloaded-not-yet-played nudge window (AC-6).
 *
 * `[ASSUMPTION]` — 30 days appears in the PRD and `epics.md` AC-4 but was never
 * confirmed by Arjun. `EXPERIENCE.md:97` carries the same `[ASSUMPTION —
 * PRD sync owed]` marker and the reasoning: long enough that a same-day
 * download does not nag, short enough to read as distinct from the 3-month
 * shelf. PRD-sync is owed (Story 4.4 Task 7).
 *
 * Computed from **raw `added_at`**, with no clamp (AC-6): this is a real fact
 * about the DJ's library, not an inference about how long Curfew has been
 * observing — which is why it survives the fail-closed suppression that removes
 * every row.
 */
export const RECENT_DOWNLOAD_DAYS = 30;

/**
 * How many rows the module renders at once.
 *
 * A 5,000-track library with a cold catalogue puts thousands of qualifying rows
 * on this page. The cap is never silent: {@link AgingShelfModel.qualifyingCount}
 * carries the full number so the component can state it out loud (AC-9, SM-C1's
 * no-silent-caps contract), and both sort directions are sorted BEFORE the cap
 * so ascending surfaces the genuinely shortest-aging 100 rather than a reversed
 * slice of the same 100 — a reversed slice would be a different, silently wrong
 * list.
 */
export const SHELF_ROW_CAP = 100;

/** Which end of the shelf the DJ is looking at (AC-2). */
export type AgingShelfSort = "longest" | "shortest";

/** Which clock branch produced a row's `daysUnplayed` — see {@link buildAgingShelf}. */
export type AgingShelfBasis = "observed-play" | "add-date";

/** One shelf row. Tier A only, and deliberately carries no action (Context §1/§5). */
export interface AgingShelfRow {
  trackId: string;
  /** Raw, un-normalized title, straight from the roster. */
  title: string | null;
  /** Raw, un-normalized artist, straight from the roster. */
  artist: string | null;
  /** Whole days since the row's clock started. Never negative — see the unreconciled guard. */
  daysUnplayed: number;
  basis: AgingShelfBasis;
}

/** A roster entry with no usable add date and no observed play (AC-7). */
export interface UnknownAddDateRow {
  trackId: string;
  title: string | null;
  artist: string | null;
}

export interface AgingShelfModel {
  /**
   * Both sort directions, each sorted then capped independently (AC-2, AC-9).
   *
   * Precomputed rather than sorted on click, the same "no work happens on
   * click" discipline D-13 established for the conversion windows — and the
   * only shape that makes the sort-before-cap rule structurally true for both
   * directions instead of true for one and reversed for the other.
   */
  rows: Record<AgingShelfSort, AgingShelfRow[]>;
  /** Every qualifying track, UNCAPPED — what AC-9's disclosure states. */
  qualifyingCount: number;
  /** Whether `qualifyingCount` exceeds {@link SHELF_ROW_CAP}, so the list is truncated. */
  capped: boolean;
  /** AC-7's group: rendered as its own labelled block, never interleaved, never counted into the aging total. */
  unknownAddDate: UnknownAddDateRow[];
  /** Size of {@link unknownAddDate} — uncapped, since it is stated as a count, not listed. */
  unknownAddDateCount: number;
  /** AC-6, from raw `added_at` with no clamp: added in the last {@link RECENT_DOWNLOAD_DAYS} days, never played. */
  recentlyDownloadedCount: number;
  /**
   * Roster entries the DJ still owns — i.e. after AC-8's `absent_at` exclusion.
   * `0` is the day-one "nothing synced" state, which is a DIFFERENT fact from a
   * clear shelf and must never render as one (Context §4).
   */
  presentTrackCount: number;
  /**
   * How long Curfew has been able to observe, in whole days — or `null` when
   * `observationStartMs` could not be read (AC-11).
   */
  observationDays: number | null;
  /**
   * `true` when the no-play branch was suppressed because `observationStartMs`
   * was `null` (AC-11). Kept as its own field rather than inferred from
   * `observationDays === null` so the fail-closed path is greppable.
   */
  observationSuppressed: boolean;
  /**
   * Tracks the fail-closed rule dropped: no observed play, and no observation
   * anchor to clamp their add date against. Surfaced so the population
   * reconciles rather than vanishing — the same "counted, not just skipped"
   * discipline Story 4.5's review imposed on `futureDatedCount`.
   */
  suppressedNoPlayCount: number;
  /**
   * Dates that do not survive contact with the clock: an `added_at` in the
   * future, or a last play in the future. Excluded from every figure above and
   * disclosed as a count, matching how `buildTimeToFirstPlay` — the module
   * directly above this one on the page — already disposes of the identical
   * row. See {@link buildAgingShelf}'s own note on why that disposition was
   * chosen while the three-way ruling is still open.
   */
  unreconciledDateCount: number;
  /**
   * Whether Curfew has watched long enough for "nothing is aging" to be a claim
   * it can make at all (AC-4/AC-5, Context §4). `false` under
   * {@link AGING_THRESHOLD_DAYS} of observation AND whenever the anchor is
   * suppressed — in both cases the answer is "not known yet", never
   * "everything you've bought is getting played".
   */
  canJudge: boolean;
}

/**
 * ms since epoch for an ISO timestamp, or `null` if missing/unparsable.
 *
 * A local copy of `libraryConversion.ts`'s identical private helper rather than
 * an export from it: that module is read-only for this story (its three shipped
 * models are load-bearing for two other pages), and a three-line date parse is
 * not worth widening its public surface to share.
 */
function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Whole days between two instants, floored — the shelf counts days, not fractions. */
function wholeDaysBetween(fromMs: number, toMs: number): number {
  return Math.floor((toMs - fromMs) / DAY_MS);
}

/**
 * The whole model, from the DJ's roster plus their play history (AC-1, AC-2,
 * AC-6, AC-7, AC-8, AC-9, AC-11).
 *
 * **The clock has two branches, and only one of them clamps** (Context §2):
 *
 * | Branch | Condition | Measured from |
 * | --- | --- | --- |
 * | observed | the track has ≥1 play in a Curfew-captured set | that track's LATEST play, unclamped |
 * | fallback | no observed play at all | `max(added_at, observationStartMs)` |
 *
 * Why the clamp exists: Decision A means Curfew only ever observes plays going
 * forward. A veteran's track added in 2019 and played every weekend — but never
 * yet in a Curfew-captured set — would otherwise read "2,400 days unplayed",
 * and the whole shelf would read as all-aging. A track's shelf age must never
 * be older than however long Curfew has actually been able to watch it. An
 * observed play, by contrast, is a fact rather than an inference, so it is
 * never clamped.
 *
 * **`is_baseline` is not a branch condition and must not become one.** `max()`
 * already handles both populations uniformly: a post-install add has
 * `added_at >= observationStartMs`, so the clamp is a no-op there. Unlike Story
 * 4.5 — which fixed its Decision B problem by EXCLUDING the pre-subscription
 * population — this shelf must cover the DJ's entire library, baseline tracks
 * included; excluding them would gut the feature rather than fix it, and is
 * precisely why Story 4.11 shipped the roster carrying `is_baseline` rows at
 * all.
 *
 * **`observationStartMs === null` fails CLOSED** (AC-11): the fallback branch
 * is suppressed entirely and only tracks with a real observed last play can
 * appear. It must never degrade to raw `added_at` — that is the exact
 * behaviour the clamp exists to remove, and shipping it silently under a story
 * claiming to have fixed it would be a regression with a green gate.
 *
 * `plays` is the **shared page-level index** (`playsByTrack`), taken as a
 * parameter rather than rebuilt: the page already builds exactly one and shares
 * it across three modules, and building a fourth would be both a wasted pass
 * over every play and the shape that produced the earlier global-earliest-play
 * bug. This module reads the LAST play, where the three conversion metrics read
 * the first at-or-after — different questions over the same ascending array.
 *
 * FUTURE-DATED ROWS: `deferred-work.md`'s "three-way future-dated disposition"
 * is still open and explicitly asks for ONE ruling applied consistently across
 * this page's modules, so this story does not invent a fourth. It follows
 * `buildTimeToFirstPlay`'s disposition — count and disclose, never drop
 * silently — which is the one of the existing three that surfaces the row
 * rather than mislabelling it. If the open ruling lands differently, this is
 * the single place to change.
 */
export function buildAgingShelf(
  entries: LibraryRosterEntry[],
  observationStartMs: number | null,
  nowMs: number,
  plays: Map<string, number[]>,
): AgingShelfModel {
  const qualifying: AgingShelfRow[] = [];
  const unknownAddDate: UnknownAddDateRow[] = [];
  let presentTrackCount = 0;
  let recentlyDownloadedCount = 0;
  let suppressedNoPlayCount = 0;
  let unreconciledDateCount = 0;

  const recentWindowStartMs = nowMs - RECENT_DOWNLOAD_DAYS * DAY_MS;

  for (const entry of entries) {
    // AC-8, first and unconditionally. The DJ deleted this track;
    // recommending it is the failure AD-22's soft-delete exists to prevent, and
    // an absent row must leave EVERY count untouched, not just the list.
    // (Also filtered server-side in `getLibraryRoster` — this is the pure
    // model's own guarantee over whatever it is handed, not a duplicate check.)
    if (entry.absent_at != null) continue;
    presentTrackCount += 1;

    const addedMs = msOf(entry.added_at);
    const trackPlays = plays.get(entry.track_id);
    const lastPlayMs =
      trackPlays !== undefined && trackPlays.length > 0
        ? // Ascending by `playsByTrack`'s own contract, so the last element is
          // the latest play — no scan needed.
          trackPlays[trackPlays.length - 1]
        : null;

    // AC-6, computed here from RAW `added_at` with no clamp, and deliberately
    // before any of the branches below: it is a fact about the DJ's library,
    // so it must survive both the fail-closed suppression and a recent
    // observation start clamping the same track to a few days.
    if (
      lastPlayMs === null &&
      addedMs !== null &&
      addedMs <= nowMs &&
      addedMs >= recentWindowStartMs
    ) {
      recentlyDownloadedCount += 1;
    }

    // AC-7. No usable add date AND no observed play — there is no clock to
    // start, so the track is neither aged nor omitted: it gets its own group.
    // A track with an unusable add date but a real play is NOT unknown; its
    // clock runs from the play, which is a fact.
    if (addedMs === null && lastPlayMs === null) {
      unknownAddDate.push({
        trackId: entry.track_id,
        title: entry.title,
        artist: entry.artist,
      });
      continue;
    }

    let startMs: number;
    let basis: AgingShelfBasis;

    if (lastPlayMs !== null) {
      // Observed branch — unclamped, on purpose.
      startMs = lastPlayMs;
      basis = "observed-play";
    } else if (observationStartMs === null) {
      // Fail-closed (AC-11). NOT `startMs = addedMs`: that is the pre-fix
      // behaviour, and reaching for it here is the single mistake this whole
      // story exists to prevent.
      suppressedNoPlayCount += 1;
      continue;
    } else {
      // Fallback branch — the clamp itself. `addedMs` is non-null here: the
      // AC-7 branch above already took the case where both are missing, and
      // this arm requires `lastPlayMs === null`.
      startMs = Math.max(addedMs as number, observationStartMs);
      basis = "add-date";
    }

    // One guard for every clock source that can sit in the future — a
    // future-dated `added_at`, a future-dated play, or (unreachable, but not
    // assumed) a future observation start. All three are the same fact to a DJ:
    // a date Curfew cannot reconcile. Counted rather than dropped silently, so
    // the population reconciles; see this function's own note on the open
    // three-way ruling.
    if (startMs > nowMs) {
      unreconciledDateCount += 1;
      continue;
    }

    const daysUnplayed = wholeDaysBetween(startMs, nowMs);
    if (daysUnplayed < AGING_THRESHOLD_DAYS) continue;

    qualifying.push({
      trackId: entry.track_id,
      title: entry.title,
      artist: entry.artist,
      daysUnplayed,
      basis,
    });
  }

  // Sorted BEFORE the cap, independently per direction (AC-9). Two explicit
  // sorts rather than one sort plus a reversed tail slice: the slice would be
  // correct today but is one refactor away from the reversed-same-100 bug the
  // cap's doc comment warns about, and 100 rows either way is not a cost.
  //
  // `track_id` breaks ties so the order is TOTAL. Without it a tied population
  // — which is the normal case here, since a whole baseline cohort clamps to
  // the identical `observationStartMs` and therefore the identical day count —
  // leaves the cap free to pick a different arbitrary 100 on each render.
  const byLongest = [...qualifying].sort(
    (a, b) => b.daysUnplayed - a.daysUnplayed || a.trackId.localeCompare(b.trackId),
  );
  const byShortest = [...qualifying].sort(
    (a, b) => a.daysUnplayed - b.daysUnplayed || a.trackId.localeCompare(b.trackId),
  );

  const observationDays =
    observationStartMs === null ? null : wholeDaysBetween(observationStartMs, nowMs);

  return {
    rows: {
      longest: byLongest.slice(0, SHELF_ROW_CAP),
      shortest: byShortest.slice(0, SHELF_ROW_CAP),
    },
    qualifyingCount: qualifying.length,
    capped: qualifying.length > SHELF_ROW_CAP,
    unknownAddDate,
    unknownAddDateCount: unknownAddDate.length,
    recentlyDownloadedCount,
    presentTrackCount,
    observationDays,
    observationSuppressed: observationStartMs === null,
    suppressedNoPlayCount,
    unreconciledDateCount,
    // Both conditions collapse to the same copy consequence: we cannot say
    // "everything you've bought is getting played", because we do not know.
    canJudge: observationDays !== null && observationDays >= AGING_THRESHOLD_DAYS,
  };
}

/**
 * Which of the module's four terminal states the model calls for.
 *
 * Lives here rather than as a ternary inside the component for two reasons:
 * it is the AC-4/AC-5 decision — the one Context §4 says must never collapse
 * three states into two — so it deserves direct test coverage; and
 * {@link agingShelfSummary} reads the SAME function, which is what makes the
 * accessible name and the visible state structurally unable to drift. Story
 * 4.5's review found a section announcing a figure the UI had explicitly
 * declined to state, and this module has three states where that could recur.
 *
 * - `rows` — there are qualifying tracks; render the list.
 * - `nothing-synced` — no agent has ever synced a roster (Story 4.6 AC-3).
 * - `not-yet-possible` — under {@link AGING_THRESHOLD_DAYS} days of
 *   observation, or no anchor at all. A positive-framed WAIT that says nothing
 *   about whether tracks are getting played, because nothing is known yet.
 * - `all-clear` — observation is long enough AND nothing qualifies. The ONLY
 *   state where `EXPERIENCE.md`'s "Everything you've bought is getting played."
 *   is true.
 *
 * `rows` is tested FIRST, ahead of the gates. Under the observation threshold
 * nothing can structurally qualify, so that ordering is normally moot — but a
 * synced set whose `started_at` predates signup would produce rows while
 * `canJudge` is false, and rendering "not yet possible" above a list of real
 * rows would be the module contradicting itself on screen.
 */
export type AgingShelfState = "rows" | "nothing-synced" | "not-yet-possible" | "all-clear";

export function agingShelfState(model: AgingShelfModel): AgingShelfState {
  if (model.qualifyingCount > 0) return "rows";
  if (model.presentTrackCount === 0) return "nothing-synced";
  return model.canJudge ? "all-clear" : "not-yet-possible";
}

/**
 * THE module's text equivalent (AC-13) — one pure generator backing the
 * section's accessible name, following the same "one generator, N duties"
 * template `libraryConversionSummary`/`timeToFirstPlaySummary` established, and
 * kept in `TimeToFirstPlay`'s register.
 *
 * **It states no number in any gated state, deliberately** — it branches on
 * {@link agingShelfState}, the same function the component renders from, so
 * the name can only claim a figure in the state that actually shows one.
 *
 * The cap rides in this string too (AC-9). A screen-reader user hearing "100
 * tracks" over a 4,000-track shelf is the silent-truncation failure with extra
 * steps.
 *
 * **It takes the active `sort`**, and that is not cosmetic — it was a real bug
 * caught in this story's browser pass. Without it, flipping the control to
 * shortest-unplayed left the visible disclosure reading "the shortest-unplayed
 * 100" while the section's accessible name still announced "the longest-unplayed
 * 100": a screen-reader user would have been told the list contained the
 * opposite end of the shelf from the one actually rendered. The two lists share
 * no rows at the extremes, so it was a wrong answer, not a stale wording.
 */
export function agingShelfSummary(
  model: AgingShelfModel,
  sort: AgingShelfSort = "longest",
): string {
  const state = agingShelfState(model);
  // Both gated states render copy, not a count, so the name must not state one
  // either — it falls back to naming the region, and `InsufficientHistory`'s
  // own `role="status"` carries the explanation to AT.
  if (state === "nothing-synced" || state === "not-yet-possible") return "Aging shelf";
  if (state === "all-clear") {
    return `Aging shelf: nothing has gone unplayed for ${AGING_THRESHOLD_DAYS} days.`;
  }

  const one = model.qualifyingCount === 1;
  const base = `Aging shelf: ${model.qualifyingCount} ${
    one ? "track hasn't" : "tracks haven't"
  } been played in ${AGING_THRESHOLD_DAYS} days or more`;

  return model.capped
    ? `${base}; the ${sort}-unplayed ${SHELF_ROW_CAP} are listed.`
    : `${base}.`;
}
