// Library Utilization's PLAY-SIDE stats (Story 4.9) — repeat-track rate, set
// similarity, workhorses, one-and-done, rotation size — plus the page-level
// low-confidence partition every module on the page now reads through (D-20).
//
// A NEW FILE rather than additions to `libraryConversion.ts` (990 lines),
// deliberately: that file is scoped to the add-event/library join, and not one
// metric here ever touches an add-event. Everything below is computable from
// `plays` alone, which is what makes Story 4.9 a `web/`-only story with zero
// agent work — every field read (`title`, `artist`, `started_at`,
// `derived.confidence`, `derived.track_count`) has been on the frozen
// `SyncPlay`/`SyncSetDerived` contract since the Story 1.10 freeze (AD-3).
//
// House shape mirrors `libraryConversion.ts`: exported constants, exported
// interfaces, one `build*` per model, one `*Summary(model): string` generator
// per module for the accessible name. `nowMs` is always injected, never read
// from the clock — Story 4.1's review lesson (a `Date.now()` inside a "pure"
// function is what made that suite machine-dependent).

import { isLowConfidenceSet } from "./listModel";
import { MOST_PLAYED_RECENT_SETS } from "./rightColumn";
import { formatDayDate, formatSessionLabel } from "./format";
import type { SetRecord } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Rounded percent, matching `libraryConversion.ts`'s own `pct`. */
function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/* ═══════════════════════════════════════════════════════════════════════════
   D-20 — the page's low-confidence contract
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Splits a DJ's sets into the population every figure on `/library-utilization`
 * is computed from, and a count of what that left out (Story 4.9, AC-10; D-20).
 *
 * **The predicate is `listModel.ts`'s compound `isLowConfidenceSet`, NOT
 * `styleEvolution.ts`'s bare `confidence.value < 1.0`, and that divergence is
 * deliberate.** AC-10 asks for "the same exclude-visibly contract Style
 * Evolution does" — the shared thing is the *affordance* (hide by default,
 * disclose the count, offer a reveal), not the predicate. The bare form would
 * not do what AC-10 exists for: `agent/src-tauri/src/confidence.rs` is
 * symmetric by its own design note — *"A session that's obviously 'not a set'
 * (too few plays) and a session that's obviously a real set both score 1.0"* —
 * so `LOW_CONFIDENCE_VALUE` is only ever assigned to the dense-continuous
 * ambiguous case, and a two-track soundcheck scores a clean 1.0. Filtering on
 * `< 1.0` would let exactly the soundchecks AC-10 names straight into a repeat
 * rate. `listModel`'s `|| trackCount < HERO_MIN_TRACKS` term is what catches
 * them, and `rightColumn.ts:60-64` records the shipped bug it was added to fix
 * (a one-play soundcheck deciding the most-played card).
 *
 * **Page-wide, not scoped to Story 4.9's new modules.** Story 4.3's meter,
 * Story 4.2/4.7's trend and Story 4.5's time-to-first-play had no confidence
 * filtering at all before this (grep `libraryConversion.ts` for
 * `derived.confidence` — there are no hits), so they counted soundcheck plays.
 * Two populations on one page is the exact "modules disagreeing on screen"
 * failure Story 4.7's AC-3 exists to prevent, and a single visible "N hidden —
 * show them?" control sitting above modules it does not govern repeats
 * `page.tsx`'s own ruling against a control appearing to own a figure it
 * cannot move.
 *
 * Retrofitting three shipped modules was a zero-blast-radius change exactly
 * once: production held 0 sets and 0 plays when this landed (re-measured
 * read-only 2026-08-08, matching Story 4.5's review), so no DJ has ever seen a
 * number this moved. That will never be true again.
 */
export interface ConfidencePartition {
  /** The sets every figure on the page is computed from, caller order preserved. */
  surviving: SetRecord[];
  /** Every set the predicate excluded — what the reveal swaps back in. */
  hidden: SetRecord[];
}

export function partitionSetsByConfidence(sets: SetRecord[]): ConfidencePartition {
  const surviving: SetRecord[] = [];
  const hidden: SetRecord[] = [];
  for (const set of sets) {
    if (isLowConfidenceSet(set)) hidden.push(set);
    else surviving.push(set);
  }
  return { surviving, hidden };
}

/* D-20(iii)'s reveal descriptor lives on `LibraryUtilizationReveal`, its only
   consumer and a `"use client"` component. Exporting it from here made that
   client component import this 832-line server module — plus `listModel`,
   `rightColumn` and `format` through it — for one string literal, betting on
   tree-shaking to undo it. */

/* ═══════════════════════════════════════════════════════════════════════════
   D-18 — one track identity, shared by all five metrics
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Composite `title` + `artist` identity, and **never `track_id`** (D-18).
 *
 * **It does not normalize.** No trim, no case fold — `"Deep End"` and
 * `"Deep End "` are two tracks here, which can split one track's plays across
 * Workhorses and Played-once and under-count carryover in the repeat rate. That
 * is a deliberate trade, not an oversight: the key is byte-identical to
 * `rightColumn.ts:115`'s existing one, and D-18's whole point is ONE key space
 * for "which track is this" across the product. Normalizing here alone would
 * fork it. If casing/whitespace drift from Serato turns out to matter, both
 * sites change together or neither does. (This comment used to open with the
 * word "Normalized", which is exactly what stopped the next reader checking
 * before keying a sixth metric through it.)
 *
 * Three reasons this must not be "fixed" into agreeing with
 * `libraryConversion.ts`'s `track_id` keying, which answers a different
 * question (it joins to `library_track_events`, and nothing here does):
 *   1. `SyncPlay.track_id` is `?: string | null` — optional post-freeze, and
 *      `null` whenever the source carried no portable path. Keying on it would
 *      silently drop every off-library track from a "what do I lean on" list.
 *   2. Mixing the two key spaces double-counts one track whose plays split
 *      between rows that do and don't carry a hash.
 *   3. `track_id` exists to make a play joinable to an add-event. These five
 *      metrics never join.
 */
export function trackKey(title: string, artist: string | null | undefined): string {
  return JSON.stringify([title, artist ?? ""]);
}

/** ms since epoch for an ISO timestamp, or `null` if missing/unparsable. */
function msOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A set's sort key. Undated sets sort last rather than poisoning the comparator
 * with `NaN`, which would leave the order engine-dependent — the same guard and
 * the same reason as `rightColumn.ts:87-91`'s own `startMs`.
 */
function startMs(set: SetRecord): number {
  const ms = msOf(set.started_at);
  return ms === null ? -Infinity : ms;
}

/* ═══════════════════════════════════════════════════════════════════════════
   The set-membership index (GAP-4)
   ═══════════════════════════════════════════════════════════════════════════ */

/** One set, reduced to what the five metrics actually need. */
export interface IndexedSet {
  /** `SetRecord.external_id` — the set identity `playsByTrack` does not carry. */
  id: string;
  /** Human axis label. From `session_label`, never the raw uuid `external_id`. */
  label: string;
  /** `-Infinity` for an undated set (see {@link startMs}). */
  startMs: number;
  /** Distinct {@link trackKey}s played in this set. */
  tracks: Set<string>;
  /** Identified plays in this set — total, not distinct. */
  playCount: number;
}

/**
 * The set-membership index every metric here reads.
 *
 * **Deliberately NOT `libraryConversion.ts`'s `playsByTrack` (GAP-4).** That
 * index is already built on this page and is the obvious thing to reach for,
 * and the post-merge "one shared index, not two" rule invites reusing it — but
 * that rule is scoped to `playsByTrack`'s three *conversion* consumers, and
 * reusing it here is impossible rather than merely untidy:
 *   - it is `Map<track_id, number[]>` and carries **no set identity at all**,
 *     so it cannot answer AC-2, AC-4, AC-5 or AC-6;
 *   - it `continue`s past every play with no `track_id`, which contradicts
 *     D-18's key space directly;
 *   - it also drops every play with an unparseable `started_at`, which these
 *     metrics have no reason to lose.
 * Building a second index here is therefore not a regression of that rule.
 */
export interface UtilizationIndex {
  /** Surviving sets, **oldest-first**, undated ones excluded (see {@link undatedSetCount}). */
  dated: IndexedSet[];
  /** Every surviving set including undated ones, caller order preserved. */
  all: IndexedSet[];
  /** {@link trackKey} → the ids of the sets it was played in. */
  setsByTrack: Map<string, Set<string>>;
  /** {@link trackKey} → total identified plays across the surviving population. */
  playsByKey: Map<string, number>;
  /** {@link trackKey} → what to render. `artist` is `"Unknown"` when absent (AD-11). */
  displayByKey: Map<string, { title: string; artist: string }>;
  /** {@link trackKey} → most recent parseable play time, `-Infinity` if none. */
  lastPlayedMsByKey: Map<string, number>;
  /** {@link trackKey} → the order it was first seen in. The total-order tie-break. */
  firstSeenByKey: Map<string, number>;
  /**
   * {@link trackKey} → the `plays.track_id` that key's plays carry, or `null`
   * when there is no single one (Story 4.10, **D-27**). The bridge between this
   * file's `trackKey` space and `/track/[track_id]`'s `track_id` space — the
   * two key spaces D-18 forbids reconciling, carried one-directionally rather
   * than merged.
   *
   * **CARRIED THROUGH FROM THE PLAY ROWS, NEVER RE-DERIVED.** `track_id` is
   * `fnv1a_hex(normalize(title) ␞ normalize(artist))`, computed in Rust
   * (`agent/src-tauri/src/capture.rs:146-189`). Do NOT reimplement `fnv1a` or
   * `normalize_identity_text` in TypeScript to fill this map: a second
   * implementation that drifts by one whitespace or case-folding rule produces
   * `/track/…` URLs that silently 404, and nothing in any gate would catch it.
   * `SET_WITH_PLAYS_SELECT` already selects `track_id` on every play, so this
   * map costs one `Map.set` per play row the builder was already walking —
   * zero new computation, zero new query.
   *
   * **`null` covers two different causes, deliberately treated alike (D-26,
   * D-28):**
   *   1. *No identity at all* — the play resolved no artist tag, so
   *      `track_id_from_title_artist` returned nothing (AD-11: one field alone
   *      is too little signal to trust as an identity). Measured at ~21% of
   *      real plays, 212 of 1,267 `trackKey` groups on the committed seed.
   *   2. *Two identities for one key* — **fails closed** (D-28). A play synced
   *      before Story 4.3's deploy carries the old path-hash `track_id`
   *      permanently, and nothing re-derives a historical play's identity, so
   *      one key CAN in principle span two ids. Picking one arbitrarily would
   *      send the DJ to a page holding half their plays. Measured 0 on the
   *      seed and unreachable in production (re-measured read-only 2026-08-10:
   *      1 dj / 0 sets / 0 plays), so this branch is defensive today — covered
   *      by a unit test rather than a browser state.
   *
   * Both render the row unlinked and count into the ONE disclosure
   * {@link unlinkableTracksDisclosure} builds (SM-C1).
   */
  trackIdByKey: Map<string, string | null>;
  /**
   * Plays excluded for having no `title` at all — never omitted, never guessed
   * (AD-11; `rightColumn.ts:114`'s own `title != null` guard). A play with no
   * title has no identity to count under, and inventing one would merge every
   * such play into a single phantom track.
   */
  nullTitlePlayCount: number;
  /**
   * Surviving sets with no parseable `started_at`. They are absent from every
   * time-ordered metric here (repeat rate, similarity, rotation size) because
   * there is no position to give them, and present in the two that ask no
   * question about time (workhorses, one-and-done). Disclosed rather than
   * silently dropped — `styleEvolution`'s `undatedCount` precedent.
   */
  undatedSetCount: number;
}

/**
 * Builds {@link UtilizationIndex} from an already-surviving set population.
 *
 * Pass the output of {@link partitionSetsByConfidence}. This function does NOT
 * filter by confidence itself: the page owns that decision once, page-wide, and
 * a second filter here would make the reveal unable to swap the hidden sets
 * back in.
 *
 * **Horizon.** `sets` comes from `getRecentSets()`, which is bounded at
 * `RECENT_SETS_LIMIT = 500` (`web/lib/sets/index.ts`). So "lifetime" in AC-5
 * and AC-6 means "within the 500 most recent sets". Nobody is near that today
 * (58 sets on real data), but it becomes a silent truncation the moment someone
 * crosses it — see `deferred-work.md`'s standing entry on this page's
 * lifetime-scope-through-a-`getRecentSets`-seam hazard. Named here rather than
 * worked around with a second query.
 */
export function buildUtilizationIndex(sets: SetRecord[]): UtilizationIndex {
  const all: IndexedSet[] = [];
  const setsByTrack = new Map<string, Set<string>>();
  const playsByKey = new Map<string, number>();
  const displayByKey = new Map<string, { title: string; artist: string }>();
  const lastPlayedMsByKey = new Map<string, number>();
  const firstSeenByKey = new Map<string, number>();
  const trackIdByKey = new Map<string, string | null>();
  // Keys that have already seen two different ids. Separate from the map above
  // because `null` there is ambiguous by design (D-27): it means both "no id
  // yet" and "failed closed", and without this set a conflict would be undone
  // by the next play carrying either of the two ids.
  const conflictedKeys = new Set<string>();
  let nullTitlePlayCount = 0;
  let undatedSetCount = 0;

  for (const set of sets) {
    const tracks = new Set<string>();
    let playCount = 0;

    for (const play of set.plays) {
      const title = play.title;
      // `== null` alone is not enough: `plays.title` is a bare nullable `text`
      // column with no CHECK against `''`, and the read path passes it through
      // unnormalized, so an empty string is type-legal AND reachable. It would
      // pass a null-only guard and key every such play under `["",""]` — the
      // single phantom track this guard exists to prevent, which could then
      // rank in Workhorses and render as a blank row. Same treatment, same
      // count: a play with no usable title has no identity to count under.
      if (title == null || title === "") {
        nullTitlePlayCount++;
        continue;
      }
      const key = trackKey(title, play.artist);
      playCount++;
      tracks.add(key);

      if (!firstSeenByKey.has(key)) firstSeenByKey.set(key, firstSeenByKey.size);
      // `||`, not `??`: an empty-string artist is not nullish, so `??` would
      // let `""` through and render a blank artist cell — "omitted", which is
      // the one thing AD-11's convention forbids. The KEY still uses `?? ""`
      // (see `trackKey`) so an empty artist and a missing artist remain one
      // track; only the display differs.
      if (!displayByKey.has(key)) displayByKey.set(key, { title, artist: play.artist || "Unknown" });
      playsByKey.set(key, (playsByKey.get(key) ?? 0) + 1);

      // D-27/D-28. `.trim()` and the `""` check for the same reason the title
      // guard above needs them (Non-negotiable 9): `plays.track_id` is a bare
      // nullable `text` column with no CHECK against `''`, and an empty or
      // blank id would pass every `== null` guard, then route to `/track/`
      // — a URL that is not this route at all.
      const rawId = play.track_id;
      const id = rawId != null && rawId.trim() !== "" ? rawId.trim() : null;
      if (id === null) {
        // Records the key as *seen with no id yet*. Must not overwrite an id a
        // previous play already supplied: a key whose plays are half-identified
        // still has exactly one identity, and D-28 fails closed only on TWO
        // ids, never on one id plus a gap.
        if (!trackIdByKey.has(key)) trackIdByKey.set(key, null);
      } else if (!conflictedKeys.has(key)) {
        const existing = trackIdByKey.get(key) ?? null;
        if (existing === null) trackIdByKey.set(key, id);
        else if (existing !== id) {
          trackIdByKey.set(key, null);
          conflictedKeys.add(key);
        }
      }

      const membership = setsByTrack.get(key);
      if (membership === undefined) setsByTrack.set(key, new Set([set.external_id]));
      else membership.add(set.external_id);

      // A play with no parseable time cannot move "most recently played", but
      // it must not reset it either — hence `max` against `-Infinity`.
      const playedMs = msOf(play.started_at);
      if (playedMs !== null) {
        lastPlayedMsByKey.set(key, Math.max(lastPlayedMsByKey.get(key) ?? -Infinity, playedMs));
      } else if (!lastPlayedMsByKey.has(key)) {
        lastPlayedMsByKey.set(key, -Infinity);
      }
    }

    const ms = startMs(set);
    if (ms === -Infinity) undatedSetCount++;
    all.push({
      id: set.external_id,
      // NEVER the raw `external_id`: post-4.6 that is a uuid, and rendering it
      // is the documented `SET 872d5614-…` regression (`types.ts`).
      label: set.session_label ? formatSessionLabel(set.session_label) : "Untitled set",
      startMs: ms,
      tracks,
      playCount,
    });
  }

  // Oldest-first, with `id` breaking ties so the order is total — a comparator
  // returning 0 leaves two identical requests free to disagree (`getRecentSets`
  // makes the same argument for the same reason).
  const dated = all
    .filter((s) => s.startMs !== -Infinity)
    .sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));

  return {
    dated,
    all,
    setsByTrack,
    playsByKey,
    displayByKey,
    lastPlayedMsByKey,
    firstSeenByKey,
    trackIdByKey,
    nullTitlePlayCount,
    undatedSetCount,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-2 / AC-3 — repeat-track rate (D-17)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How many surviving sets immediately preceding a set count as "nearby"
 * (AC-3, ruled 2026-08-07 in party mode: wide enough to forgive gaps between
 * gigs without reading as counting ancient repeats).
 *
 * **Predecessors only — the measured set is never one of its own five.**
 */
export const REPEAT_WINDOW_SETS = 5;

export interface RepeatTrackRateModel {
  /**
   * The unweighted mean of every measurable set's carryover share, or `null`
   * when nothing was measurable — never a fabricated `0` (D-8).
   */
  rate: number | null;
  /** How many sets the mean averaged over. Stated alongside the rate (D-17). */
  measuredSetCount: number;
  /** {@link REPEAT_WINDOW_SETS}, surfaced so the copy cannot drift from the math. */
  windowSets: number;
  /** Dated surviving sets — the population the mean was drawn from. */
  survivingSetCount: number;
  /** Sets absent for having no date (see {@link UtilizationIndex.undatedSetCount}). */
  undatedSetCount: number;
}

/**
 * AC-2/AC-3's "am I playing the same thing every night" counterpart to the
 * aging shelf's neglect signal — the exact quantity, fixed by **D-17**.
 *
 * For each surviving set that has at least one surviving predecessor:
 *
 *     (distinct tracks in that set that ALSO appear in the up-to-5 surviving
 *      sets immediately preceding it) ÷ (distinct tracks in that set)
 *
 * and the surfaced figure is the **unweighted mean** of those per-set shares,
 * with {@link measuredSetCount} stated alongside it.
 *
 * **Three things about this that are decisions, not implementation details:**
 *
 * 1. *The oldest set is excluded, never counted as 0%.* It has no predecessor,
 *    so its carryover is unknown — and D-8's discipline is that a gap is a gap.
 *    Scoring it 0 would drag the mean down by a fabricated value that gets
 *    smaller in effect the more history a DJ has, i.e. it would silently
 *    flatter long-tenured DJs.
 *
 * 2. *Unweighted is deliberate.* The question AC-2 poses is "does a **typical
 *    night** repeat", so each night counts once regardless of how long it was.
 *    A play-weighted mean would answer "does a typical **play** repeat", which
 *    is a different question and would let one six-hour marathon outvote a
 *    month of shorter gigs.
 *
 * 3. *This ruling and D-20's predicate must ship together or not at all.* The
 *    known danger of an unweighted mean is small-set skew — a three-track
 *    warm-up carries the same weight as a full night. What removes that danger
 *    here is precisely {@link partitionSetsByConfidence}'s compound predicate,
 *    which drops every set under `HERO_MIN_TRACKS`. Reverting D-20 to Style
 *    Evolution's bare `< 1.0` would silently re-open it.
 *
 * A single-ratio alternative ("of the distinct tracks across your trailing 5
 * surviving sets, the share appearing in more than one") was considered and
 * REJECTED by Arjun on 2026-08-08: it cannot skew, but it reads only the most
 * recent block and so cannot answer "does a *typical* night repeat" at all.
 * Do not implement both, and do not average them.
 *
 * With exactly 2 surviving sets there is exactly 1 measurable set — which is
 * why AC-2's gate is "≥2 captured sets" and not "≥2 measurable ones".
 */
export function buildRepeatTrackRate(index: UtilizationIndex): RepeatTrackRateModel {
  const shares: number[] = [];

  // `index.dated` is oldest-first, so a set's predecessors are the entries
  // immediately before it. Undated sets are absent by construction: a set with
  // no date has no position in this sequence, and guessing one would put a
  // real repeat rate on an invented ordering.
  for (let i = 1; i < index.dated.length; i += 1) {
    const measured = index.dated[i];
    if (measured.tracks.size === 0) continue; // no denominator — a gap, not a 0%.

    const predecessors = index.dated.slice(Math.max(0, i - REPEAT_WINDOW_SETS), i);
    const recent = new Set<string>();
    for (const p of predecessors) for (const key of p.tracks) recent.add(key);

    let carried = 0;
    for (const key of measured.tracks) if (recent.has(key)) carried += 1;
    shares.push(carried / measured.tracks.size);
  }

  return {
    rate: shares.length === 0 ? null : shares.reduce((a, b) => a + b, 0) / shares.length,
    measuredSetCount: shares.length,
    windowSets: REPEAT_WINDOW_SETS,
    survivingSetCount: index.dated.length,
    undatedSetCount: index.undatedSetCount,
  };
}

/** AC-2's gate: at least one set had a predecessor to be measured against. */
export function hasEnoughRepeatHistory(model: RepeatTrackRateModel): boolean {
  return model.rate !== null && model.measuredSetCount > 0;
}

/**
 * The module's accessible name (AC-2/AC-3).
 *
 * States the sample size next to the rate, because a mean over one set and a
 * mean over forty are different claims and the figure alone cannot tell them
 * apart. Gate-blind by design — callers below the gate must fall back to
 * naming the region rather than announcing a figure the visible UI declined to
 * state (Story 4.5's browser pass).
 */
export function repeatTrackRateSummary(model: RepeatTrackRateModel): string {
  if (model.rate === null) return "Repeat tracks";
  const nights = `${model.measuredSetCount} ${plural(model.measuredSetCount, "night", "nights")}`;
  // "up to N", never "the N sets before it". `REPEAT_WINDOW_SETS` is the window
  // CEILING, not a count of sets that exist: at the exactly-2-surviving-sets
  // boundary AC-2's gate is written to admit, there is exactly 1 predecessor,
  // and naming 5 states a population the DJ does not have.
  return (
    `On a typical night, ${pct(model.rate)} of what you play has already turned up in ` +
    `the up-to-${model.windowSets} sets before it — averaged across ${nights}.`
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-4 — set similarity (D-19, D-22)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How many recent surviving sets the similarity matrix covers (**D-19**).
 *
 * Reuses the dashboard's `MOST_PLAYED_RECENT_SETS` rather than inventing a
 * second "recent" scale on the same product — two different answers to "how
 * many sets is recent" on two screens is a disagreement a DJ can see.
 */
export const SIMILARITY_MATRIX_SETS = MOST_PLAYED_RECENT_SETS;

/**
 * Makes axis labels unique, in place of the caller's order.
 *
 * `session_label` is `?: string | null` (`types.ts:27`) and `index.ts:181`
 * derives it from `row.sessions?.session_identity ?? null`, so a set whose
 * `sessions` join is missing falls back to the literal `"Untitled set"`. Two of
 * those give the matrix two identical axes, duplicate React keys on both of
 * them, and a text equivalent reading *"Untitled set and Untitled set are your
 * most alike sets"* — a text equivalent that cannot identify either set is not
 * one (AC-4; `EXPERIENCE.md`'s chart rule; SC 1.4.1).
 *
 * Only duplicates are touched, so a fully-labelled history renders exactly as
 * before. Numbered by position in the passed order (newest-first), so the
 * suffixes read down the axis in the order the DJ sees them.
 */
function disambiguateLabels(labels: string[]): string[] {
  const seen = new Map<string, number>();
  for (const label of labels) seen.set(label, (seen.get(label) ?? 0) + 1);

  const used = new Map<string, number>();
  return labels.map((label) => {
    if ((seen.get(label) ?? 0) < 2) return label;
    const n = (used.get(label) ?? 0) + 1;
    used.set(label, n);
    return `${label} ${n}`;
  });
}

/**
 * The axis labels the matrix actually shows (Arjun, 2026-08-10).
 *
 * **A date, not the Serato session number.** `formatSessionLabel` yields
 * `SET 975`, and the grid then stripped the word so the axis read a bare
 * `975` — an internal id from Serato's `history_session` table that means
 * nothing to the DJ, on the one axis where they most need to recognise a
 * night. `Jun 13` is a night they remember.
 *
 * **The session label is not discarded**, it moves: it stays on
 * {@link SimilarityAxis.label} and rides the link's accessible name, so the
 * identity the rest of the product uses (`SetDetail`'s header, `/track`'s set
 * rows) is still reachable and the two surfaces cannot be read as different
 * sets.
 *
 * **Same-day collisions get the session number back, not a counter.** Two gigs
 * on one night is ordinary, and `disambiguateLabels`' numeric suffix would read
 * `Jun 13 1` / `Jun 13 2` — which looks like a typo and identifies nothing.
 * Appending the real session number (`Jun 13 · 975`) disambiguates with a fact.
 * The numeric form still runs afterwards as the second guard, for the pair that
 * shares a day AND has no session label at all.
 *
 * Undated sets cannot reach here: `buildSetSimilarity` reads `index.dated`, so
 * every axis has a real date and there is no `"—"` case to design for.
 */
function buildAxisDayLabels(recent: IndexedSet[]): string[] {
  const dayOf = (s: IndexedSet) => formatDayDate(new Date(s.startMs).toISOString());

  const dayCounts = new Map<string, number>();
  for (const s of recent) {
    const day = dayOf(s);
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }

  const withNumbers = recent.map((s) => {
    const day = dayOf(s);
    if ((dayCounts.get(day) ?? 0) < 2) return day;
    // `formatSessionLabel`'s output minus its prefix — the same strip the grid
    // used to do at render time, done once here so the axis and the text
    // equivalent cannot disagree about what a set is called.
    const session = s.label.replace(/^SET /, "");
    return session && s.label !== "Untitled set" ? `${day} · ${session}` : day;
  });

  return disambiguateLabels(withNumbers);
}

export interface SimilarityAxis {
  /** `sets.id` — the `/set/[id]` route key. Never rendered; it is a uuid. */
  setId: string;
  /** `SET 975`, from `session_label`. The product-wide identity, kept for the accessible name. */
  label: string;
  /** What the axis shows: a date, disambiguated. See {@link buildAxisDayLabels}. */
  dayLabel: string;
}

export interface SimilarityPair {
  /** Indexes into {@link SetSimilarityModel.axes}. */
  a: number;
  b: number;
  /** Jaccard overlap, 0–1. */
  share: number;
}

export interface SetSimilarityModel {
  /**
   * The sets on both axes, newest-first — each carrying its route key, its
   * session label and its date label. Was a bare `labels: string[]` until
   * 2026-08-10; the matrix's axes are now links into `/set/[id]`, which needs
   * an id the string never carried.
   */
  axes: SimilarityAxis[];
  /**
   * `matrix[a][b]` is the Jaccard overlap of two sets' distinct tracks.
   * `null` on the diagonal (a set against itself is trivially 1.0 and says
   * nothing) and wherever either set has no identified tracks — `0 ÷ 0` is
   * unknown, not zero (D-8).
   */
  matrix: (number | null)[][];
  /** Sets actually in the matrix — at most {@link SIMILARITY_MATRIX_SETS}. */
  shownSetCount: number;
  /** Every dated surviving set, so the UI can state the cap when it bites. */
  survivingSetCount: number;
  /** True when more surviving sets exist than the matrix shows (D-19). */
  truncated: boolean;
  /** Every off-diagonal pair with a defined share, most alike first. AC-4's text equivalent and D-22's degraded list. */
  ranked: SimilarityPair[];
  /** Sets absent for having no date. */
  undatedSetCount: number;
}

/**
 * AC-4's aggregate, non-time-series view of the same overlap data the repeat
 * rate reads — pairwise Jaccard (`|A ∩ B| ÷ |A ∪ B|`) over distinct tracks.
 *
 * Capped at {@link SIMILARITY_MATRIX_SETS} (**D-19**) and it reports
 * {@link SetSimilarityModel.truncated} so the UI can say so: a silent top-10
 * truncation reads as "this is all your history".
 *
 * Jaccard rather than raw intersection size deliberately — a 90-track marathon
 * and a 20-track warm-up sharing 15 tracks are not equally alike, and only a
 * normalized measure says so.
 */
export function buildSetSimilarity(index: UtilizationIndex): SetSimilarityModel {
  // Newest-first: the top-left of the matrix is the most recent night, which
  // is where a DJ looks first. `index.dated` is oldest-first, so reverse then
  // take — never take then reverse, which would show the OLDEST ten.
  const recent = [...index.dated].reverse().slice(0, SIMILARITY_MATRIX_SETS);

  const dayLabels = buildAxisDayLabels(recent);
  const axes: SimilarityAxis[] = recent.map((s, i) => ({
    setId: s.id,
    label: s.label,
    dayLabel: dayLabels[i],
  }));
  const matrix: (number | null)[][] = recent.map(() => recent.map(() => null));
  const ranked: SimilarityPair[] = [];

  for (let a = 0; a < recent.length; a += 1) {
    for (let b = a + 1; b < recent.length; b += 1) {
      const A = recent[a].tracks;
      const B = recent[b].tracks;
      if (A.size === 0 || B.size === 0) continue; // unknown, not 0% (D-8).

      let intersection = 0;
      for (const key of A) if (B.has(key)) intersection += 1;
      const union = A.size + B.size - intersection;
      const share = union === 0 ? null : intersection / union;
      if (share === null) continue;

      matrix[a][b] = share;
      matrix[b][a] = share;
      ranked.push({ a, b, share });
    }
  }

  // Descending by share, then by recency of both members, so the order is
  // total — a comparator returning 0 leaves two identical requests free to
  // disagree (the same argument `getRecentSets` makes for its own tie-break).
  ranked.sort((x, y) => y.share - x.share || x.a - y.a || x.b - y.b);

  return {
    axes,
    matrix,
    shownSetCount: recent.length,
    survivingSetCount: index.dated.length,
    truncated: index.dated.length > recent.length,
    ranked,
    undatedSetCount: index.undatedSetCount,
  };
}

/** AC-4/AC-9's gate: a matrix needs at least two sets to compare. */
export function hasEnoughSimilarityHistory(model: SetSimilarityModel): boolean {
  return model.shownSetCount >= 2 && model.ranked.length > 0;
}

/**
 * AC-4's required TEXT EQUIVALENT (EXPERIENCE.md's chart rule, WCAG 2.2
 * SC 1.4.1) — names the most-alike pair and its share in words, so the matrix
 * is never the only carrier of its own finding.
 */
export function setSimilaritySummary(model: SetSimilarityModel): string {
  const top = model.ranked[0];
  if (!top) return "Set similarity";
  const cap = model.truncated
    ? ` Showing your ${model.shownSetCount} most recent sets of ${model.survivingSetCount}.`
    : "";
  // The DATE labels, matching what the axes and the ranked list show — a text
  // equivalent that named the sets differently from the picture would be a
  // second vocabulary for the same two nights.
  return (
    `${model.axes[top.a].dayLabel} and ${model.axes[top.b].dayLabel} are your most alike sets, ` +
    `sharing ${pct(top.share)} of their tracks.${cap}`
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-5 — workhorses
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How many rows the list is TALL — it scrolls in place past that (Arjun,
 * 2026-08-12, replacing the "load more" `<details>` this used to size).
 *
 * Raised 6 → 10 in the same pass. At six, fifty rows sat in a 264px box:
 * ~2,900px of content behind an 11:1 scroll ratio, which reads as a bottomless
 * pit rather than as a list you can get to the end of. Ten rows makes the
 * internal scroll about five screens, which a flick actually completes.
 */
export const WORKHORSES_VISIBLE_ROWS = 10;

/**
 * The most rows either track list will BUILD (not merely show).
 *
 * `WORKHORSES_VISIBLE_ROWS` governs how tall the list renders; this governs
 * what exists at all. The distinction matters because the list scrolls in
 * place, so every row past the visible ones is already in the DOM rather than
 * fetched on demand — on real data that was ~396 workhorse rows and ~835
 * played-once rows, per prerendered subtree, to display ten of each.
 *
 * Capped and STATED, the same treatment D-19 gives the similarity matrix: a
 * silent truncation of a list the DJ reads as "everything" is the failure, not
 * the truncation itself.
 */
export const TRACK_LIST_MAX_ROWS = 50;

export interface WorkhorseRow {
  title: string;
  /** `"Unknown"` when the play carried no artist (AD-11). */
  artist: string;
  /** Distinct sets this track appeared in — the ranking key. */
  setCount: number;
  /** Total plays, the tie-break. Shown for context, never the rank. */
  plays: number;
  /**
   * `/track/[track_id]`'s identity, or `null` when this track has none
   * (Story 4.10, D-26). A `null` row renders as plain text, never a dead link,
   * and counts into {@link unlinkableTracksDisclosure}.
   */
  trackId: string | null;
}

export interface WorkhorsesModel {
  /**
   * Tracks that appeared in ≥2 sets, ordered, capped at
   * {@link TRACK_LIST_MAX_ROWS}. Empty is a real answer.
   */
  rows: WorkhorseRow[];
  /** How many qualified before the cap — so the UI can state it (D-19's rule). */
  totalRowCount: number;
  /** True when the cap actually bit. */
  truncated: boolean;
  /** Sets the list was drawn from. */
  setCount: number;
  /** Plays excluded for having no title (D-18) — disclosed, never omitted. */
  nullTitlePlayCount: number;
}

/**
 * AC-5 — tracks ranked by **the number of sets they appeared in**, not by play
 * count.
 *
 * **This is deliberately a DIFFERENT QUESTION from the dashboard's most-played
 * card, and the two must never be "fixed" into agreeing.** Side by side:
 *
 * | | dashboard most-played (`rightColumn.ts`) | workhorses (here) |
 * |---|---|---|
 * | ranks by | total play count | count of distinct sets appeared in |
 * | population | the last 10 non-low-confidence sets | the whole surviving population |
 * | scope within a set | the detected dancefloor segment only | the whole set |
 *
 * Most-played answers *"what did I hammer lately"*. This answers *"what do I
 * actually lean on"* — a track played four times in one night is a moment; a
 * track played once in twelve nights is a habit, and only this ranking can see
 * the difference. A future reader will notice the two surfaces disagree and be
 * tempted to reconcile them; that disagreement is the feature.
 *
 * Whole sets, NOT dancefloor-segment-scoped: that segmentation belongs to the
 * dashboard, and inheriting it would add a second, unintended difference on top
 * of the one intended difference above.
 *
 * Tracks appearing in exactly one set are excluded — they are not workhorses,
 * and many of them are AC-6's one-and-done list two modules down.
 */
export function buildWorkhorses(index: UtilizationIndex): WorkhorsesModel {
  const ranked: { row: WorkhorseRow; firstSeen: number }[] = [];

  for (const [key, sets] of index.setsByTrack) {
    if (sets.size < 2) continue;
    const display = index.displayByKey.get(key);
    if (!display) continue;
    ranked.push({
      row: {
        title: display.title,
        artist: display.artist,
        setCount: sets.size,
        plays: index.playsByKey.get(key) ?? 0,
        trackId: index.trackIdByKey.get(key) ?? null,
      },
      firstSeen: index.firstSeenByKey.get(key) ?? 0,
    });
  }

  // A TOTAL order: sets desc, then plays desc, then first-seen asc. The last
  // term is unique per track, so the comparator never returns 0 — the defect
  // `getRecentSets`' own comment calls out, and the reason two identical
  // requests here can never render a different order.
  ranked.sort(
    (a, b) =>
      b.row.setCount - a.row.setCount || b.row.plays - a.row.plays || a.firstSeen - b.firstSeen,
  );

  return {
    rows: ranked.slice(0, TRACK_LIST_MAX_ROWS).map((entry) => entry.row),
    totalRowCount: ranked.length,
    truncated: ranked.length > TRACK_LIST_MAX_ROWS,
    setCount: index.all.length,
    nullTitlePlayCount: index.nullTitlePlayCount,
  };
}

/** AC-5/AC-9's gate: no track has yet appeared in two different sets. */
export function hasEnoughWorkhorses(model: WorkhorsesModel): boolean {
  return model.rows.length > 0;
}

export function workhorsesSummary(model: WorkhorsesModel): string {
  if (model.rows.length === 0) return "Workhorses";
  // `totalRowCount`, not `rows.length`: the accessible name states how many
  // tracks QUALIFIED, which is the DJ's actual figure. `rows` is capped at
  // `TRACK_LIST_MAX_ROWS` for payload reasons and naming that instead would
  // announce the cap as if it were the answer.
  const n = model.totalRowCount;
  const lead = model.rows[0];
  return (
    // "in N sets", never "in N of them": the nearest antecedent for "them" is
    // the TRACK count in the first sentence, so "1 track has carried… appeared
    // in 12 of them" states 12 of 1. Two different quantities, one pronoun.
    `${n} ${plural(n, "track has", "tracks have")} carried across more than one set. ` +
    `${lead.title} by ${lead.artist} has appeared in ${lead.setCount} ${plural(lead.setCount, "set", "sets")}.`
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-6 — one-and-done
   ═══════════════════════════════════════════════════════════════════════════ */

/** How many rows tall the list is before it scrolls. See {@link WORKHORSES_VISIBLE_ROWS}. */
export const ONE_AND_DONE_VISIBLE_ROWS = 10;

export interface OneAndDoneRow {
  title: string;
  artist: string;
  /** When it played. `-Infinity` when no play carried a parseable time. */
  lastPlayedMs: number;
  /** See {@link WorkhorseRow.trackId} — same contract, same disclosure. */
  trackId: string | null;
}

export interface OneAndDoneModel {
  /** Capped at {@link TRACK_LIST_MAX_ROWS}. */
  rows: OneAndDoneRow[];
  /** How many qualified before the cap — so the UI can state it (D-19's rule). */
  totalRowCount: number;
  /** True when the cap actually bit. */
  truncated: boolean;
  setCount: number;
  nullTitlePlayCount: number;
  /**
   * Distinct identified tracks in the whole surviving population.
   *
   * Exists so the module can tell its two empty states apart. `rows.length ===
   * 0` is true both when EVERY track came round again and when NOTHING was
   * ever played, and a single string cannot describe both — the gate-counts-one-
   * thing-while-the-copy-describes-another failure Story 4.5's review produced
   * the module-specific-copy rule for.
   */
  identifiedTrackCount: number;
}

/**
 * AC-6 — tracks played **exactly once** across the surviving population: the
 * actionable mirror of AC-5's workhorses.
 *
 * Exactly once by TOTAL PLAYS, not by set membership: a track played twice
 * within a single set does not qualify. The DJ reached for it and came back to
 * it, which is the opposite of the thing this list is about.
 *
 * Ordered most-recently-played first, because the list is meant to be acted on
 * — the track you tried last week is the one worth another look. Alphabetical
 * would be a filing system, not a prompt.
 *
 * **Reads as a complement to Story 4.4's aging shelf, not a duplicate of it**,
 * and the distinction is written here before both exist so neither drifts:
 * this list is about tracks the DJ *did* play and dropped; the shelf is about
 * tracks never reached at all. Same "neglect" theme (FR-12), opposite sides of
 * the first play.
 */
export function buildOneAndDone(index: UtilizationIndex): OneAndDoneModel {
  const ranked: { row: OneAndDoneRow; firstSeen: number }[] = [];

  for (const [key, plays] of index.playsByKey) {
    if (plays !== 1) continue;
    const display = index.displayByKey.get(key);
    if (!display) continue;
    ranked.push({
      row: {
        title: display.title,
        artist: display.artist,
        lastPlayedMs: index.lastPlayedMsByKey.get(key) ?? -Infinity,
        trackId: index.trackIdByKey.get(key) ?? null,
      },
      firstSeen: index.firstSeenByKey.get(key) ?? 0,
    });
  }

  // Most recent first; `firstSeen` makes it total, and an undated play's
  // `-Infinity` sorts it last rather than poisoning the comparator with NaN.
  ranked.sort((a, b) => b.row.lastPlayedMs - a.row.lastPlayedMs || a.firstSeen - b.firstSeen);

  return {
    rows: ranked.slice(0, TRACK_LIST_MAX_ROWS).map((entry) => entry.row),
    totalRowCount: ranked.length,
    truncated: ranked.length > TRACK_LIST_MAX_ROWS,
    setCount: index.all.length,
    nullTitlePlayCount: index.nullTitlePlayCount,
    identifiedTrackCount: index.playsByKey.size,
  };
}

/** AC-6/AC-9's gate. */
export function hasEnoughOneAndDone(model: OneAndDoneModel): boolean {
  return model.rows.length > 0;
}

export function oneAndDoneSummary(model: OneAndDoneModel): string {
  // `totalRowCount` for the same reason `workhorsesSummary` uses it.
  const n = model.totalRowCount;
  if (n === 0) return "Played once";
  return `${n} ${plural(n, "track has", "tracks have")} played exactly once so far.`;
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-7 — rotation size (D-21)
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * AC-7's window, **fixed at 60 days** (**D-21**) — it is AC-7's literal text
 * ("across a trailing 60-day window"), not a subscription to the conversion
 * dropdown. Following the dropdown would leave this tile violating its own AC
 * at the 14-day selection.
 *
 * The number matches Story 4.3's shipped conversion-rate DEFAULT so every
 * window on the page agrees at first paint, which is what AC-7 asks for.
 */
export const ROTATION_WINDOW_DAYS = 60;

export interface RotationSizeModel {
  /** Distinct tracks played in the window, or `null` when no set fell in it. */
  distinctTracks: number | null;
  /** Total identified plays in the window, or `null`. Never a fabricated 0 (D-8). */
  totalPlays: number | null;
  /** {@link ROTATION_WINDOW_DAYS} — surfaced so the copy cannot drift from the math. */
  windowDays: number;
  /** Sets that fell inside the window. */
  setCount: number;
  /** Sets absent for having no date and so no placeable position in the window. */
  undatedSetCount: number;
}

/**
 * AC-7 — distinct tracks against total plays over a trailing 60 days, e.g.
 * "340 plays, 180 unique".
 *
 * Windowed on the SET's start, not each play's own timestamp: a set is one
 * night, and splitting a set that straddles the boundary would report half a
 * gig. `nowMs` is injected rather than read — the rule this whole file follows.
 *
 * Undated sets cannot be placed inside or outside a date window at all, so they
 * are absent and counted in {@link RotationSizeModel.undatedSetCount} rather
 * than being quietly assumed recent (which would inflate both figures) or
 * quietly assumed old (which would deflate them).
 */
export function buildRotationSize(index: UtilizationIndex, nowMs: number): RotationSizeModel {
  const windowStartMs = nowMs - ROTATION_WINDOW_DAYS * DAY_MS;

  const distinct = new Set<string>();
  let totalPlays = 0;
  let setCount = 0;

  for (const set of index.dated) {
    // `> nowMs` excludes a future-dated set (clock skew) for the same reason
    // `buildLiveConversionRate` excludes a future-dated add: it is not part of
    // "the last 60 days" from `nowMs`'s vantage.
    if (set.startMs < windowStartMs || set.startMs > nowMs) continue;
    setCount += 1;
    totalPlays += set.playCount;
    for (const key of set.tracks) distinct.add(key);
  }

  // The null guard keys on IDENTIFIED PLAYS, not on sets-in-window. A set can
  // fall inside the window and still yield nothing to count — every play in it
  // carrying a null title, or the set carrying no plays at all — and reporting
  // that as "0 plays, 0 unique" is a fabricated zero, not a measurement (D-8;
  // the Story 4.7 R-2 shape, where a disclosure read 0 precisely when it had
  // something to say). An earlier version of this gated on `setCount === 0`
  // and did exactly that.
  const identified = totalPlays > 0;

  return {
    distinctTracks: identified ? distinct.size : null,
    totalPlays: identified ? totalPlays : null,
    windowDays: ROTATION_WINDOW_DAYS,
    setCount,
    undatedSetCount: index.undatedSetCount,
  };
}

/** AC-7/AC-9's gate: nothing identifiable fell inside the window, so there is nothing to state. */
export function hasEnoughRotation(model: RotationSizeModel): boolean {
  return model.totalPlays !== null && model.distinctTracks !== null;
}

export function rotationSizeSummary(model: RotationSizeModel): string {
  if (model.totalPlays === null || model.distinctTracks === null) return "Rotation size";
  // Same two nouns the visible readout uses ("plays" / "different"), because an
  // accessible name that renames a figure makes the two registers disagree
  // about what was measured — and both are pluralized, so neither can render
  // "1 plays".
  return (
    `Over the last ${model.windowDays} days you played ${model.distinctTracks} different ` +
    `${plural(model.distinctTracks, "track", "tracks")} across ${model.totalPlays} ` +
    `${plural(model.totalPlays, "play", "plays")}.`
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Page-level disclosures
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * What this page's play-side stats leave out, said once at page level rather
 * than repeated under five modules (the dedup Story 4.5's review ruled,
 * applied to the same class of clause).
 *
 * `null` when there is nothing to disclose — and deliberately NOT `"0 plays
 * excluded"`, which is the Story 4.7 R-2 failure (a disclosure reporting 0
 * precisely when it had something to say).
 */
export function utilizationDisclosure(index: UtilizationIndex): string | null {
  const clauses: string[] = [];

  // Saying "above" over-claims against the meter, the trend and
  // time-to-first-play, which sit above this line and exclude neither — the
  // exact over-claim Story 4.11's review revised `unidentifiableTracksDisclosure`
  // for. This clause names its own reach instead.
  if (index.undatedSetCount > 0) {
    // Deliberately NOT "every figure": `buildUtilizationIndex` populates
    // `setsByTrack`/`playsByKey` from ALL surviving sets including undated
    // ones, so workhorses and played-once DO count them — it is only the three
    // metrics that ask a question about time that drop them.
    clauses.push(
      `${index.undatedSetCount} ${plural(index.undatedSetCount, "set has", "sets have")} no date, ` +
        `so ${plural(index.undatedSetCount, "it is", "they are")} absent from the repeat rate, ` +
        `set similarity and rotation size`,
    );
  }
  if (clauses.length === 0) return null;
  return `${clauses.join(". ")}.`;
}

/**
 * Tracks in this index that have no `track_id`, and so no `/track/[track_id]`
 * page (Story 4.10, **AC-4**; D-26/D-28).
 *
 * Counted over the WHOLE index rather than over the rendered rows, and that is
 * the honest denominator rather than the convenient one: Workhorses and
 * played-once are both capped at `TRACK_LIST_MAX_ROWS`, and search shows a
 * capped slice of whatever matched, so a count of "unlinkable rows currently on
 * screen" would move every time a `<details>` opened and would understate the
 * population the DJ is actually searching.
 */
export function unlinkableTrackCount(index: UtilizationIndex): number {
  let n = 0;
  for (const id of index.trackIdByKey.values()) if (id === null) n += 1;
  return n;
}

/**
 * AC-4's one-sentence disclosure: some tracks cannot be opened, and the DJ is
 * told how many rather than left to discover it by clicking (SM-C1).
 *
 * **Returns `null` only when nothing is excluded — never `"0 tracks"`.** That
 * is the Story 4.7 R-2 failure, the single most-repeated defect in this epic: a
 * disclosure collapsing to 0 in precisely the case it exists for. Note that the
 * 100%-excluded case here reads `"212 of the 212 tracks"`, not `"0"` — the
 * count is of the excluded population, so it *rises* to the total rather than
 * falling to zero as the exclusion widens.
 *
 * No ranking vocabulary and no apology (`DESIGN.md:199`; UX-DR18's calm failure
 * register): this states a property of the tags, not a shortcoming of the DJ or
 * a fault in Curfew.
 */
export function unlinkableTracksDisclosure(index: UtilizationIndex): string | null {
  const n = unlinkableTrackCount(index);
  if (n === 0) return null;
  const total = index.trackIdByKey.size;
  return (
    `${n} of the ${total} ${plural(total, "track", "tracks")} here ${plural(n, "has", "have")} ` +
    `no identity Curfew can open a page on — that needs both a title and an artist tag. ` +
    `${plural(n, "It", "They")} still ${plural(n, "shows", "show")} in the lists and in search, without a link.`
  );
}
