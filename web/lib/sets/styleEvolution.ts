// Style Evolution trend model (Story 4.1). Pure, deterministic aggregation
// over `SetRecord[]` from the frozen seam — never mutates it. Mirrors the
// existing `web/lib/sets/{hero,listModel,rightColumn,dancefloor}.ts`
// pure-function-over-`SetRecord[]` convention.
//
// D-4: "low-confidence" is binary — `derived.confidence.value < 1.0` — no
// threshold to configure. Every bucketed metric is computed TWICE: once
// excluding low-confidence sets (the default view) and once including them
// (the reveal-affordance view), so the page can flip between the two
// precomputed series without recomputing anything itself.
//
// Granularity (added post-launch-review, 2026-08-06, Arjun): both month AND
// week buckets are computed up front — the same dual excluding/including
// discipline, just parameterized by bucket-key function. AC-3's
// insufficient-history gate (D-5) stays MONTH-based regardless of which
// granularity is currently shown — it is about whether there is enough
// history at all, not about the current view.
import type { SetRecord } from "./types";
import { parseCamelot } from "./setDetail";

export type Granularity = "month" | "week";

/** Local-month key "2026-06"; "" for an unparsable/missing timestamp. Mirrors
 *  `localDayKey` (listModel.ts:51-57) truncated to the month — local time,
 *  not UTC, since a gig's date is the DJ's local date. */
export function localMonthKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/**
 * Local Monday-of-the-week date key "2026-06-15" — the week's start date,
 * not an ISO week number, so it sorts and formats with the same "YYYY-MM-DD"
 * shape as every other local-date key in this codebase (no back-conversion
 * from a week number needed to render a label). "" for unparsable input.
 * Local time, not UTC, same discipline as `localMonthKey`.
 */
export function localWeekKey(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dow = (d.getDay() + 6) % 7; // Mon=0..Sun=6
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - dow);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

/**
 * `H = -Σ pᵢ·log2(pᵢ)` over raw counts. Zero-length or all-zero input → `0`,
 * never `NaN`/`Infinity` (mirrors `bpm_distribution`'s "defined value, never
 * NaN" discipline). A single nonzero category → `0` (no diversity — there is
 * only one thing to be diverse across).
 */
export function shannonEntropy(counts: number[]): number {
  const total = counts.reduce((sum, c) => (Number.isFinite(c) ? sum + c : sum), 0);
  // `NaN <= 0` is false, so a bare `total <= 0` would let a malformed count
  // through and return NaN — which then reaches `style="top: NaN%"` and an
  // SVG `d` attribute. The contract above promises a defined value always.
  if (!Number.isFinite(total) || total <= 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (!Number.isFinite(c) || c <= 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Distinct local-calendar months across ALL sets, computed pre-exclusion
 * (D-5) — backs the insufficient-history gate (AC-3), regardless of which
 * granularity is currently displayed. Gating on the unfiltered history
 * matters: a DJ with real spread across months who happens to have mostly
 * low-confidence sets should see the trend, never a misleading "not enough
 * yet."
 */
export function monthsSpanned(sets: SetRecord[]): number {
  const months = new Set<string>();
  for (const s of sets) {
    const key = localMonthKey(s.started_at);
    if (key) months.add(key);
  }
  return months.size;
}

export interface MonthBpmRange {
  min: number;
  max: number;
}

/** One category's raw play count within a bucket — the entropy calculation's
 *  own input, exposed for the breakdown bars (added post-launch-review,
 *  2026-08-06). Sorted descending by `count`. */
export interface CategoryTally {
  name: string;
  count: number;
}

export interface MonthGenreDiversity {
  /** `null` when the bucket has surviving sets but NOT ONE categorized play —
   *  a gap in the line, never a fabricated `0`/`1.0` (D-8). The object itself
   *  stays non-null so `no_genre_count` survives to the disclosure line,
   *  which AC-5 requires to be shown even when there is no index to plot. */
  index: number | null;
  no_genre_count: number;
  breakdown: CategoryTally[];
}

export interface MonthKeyDiversity {
  /** `null` when the bucket has surviving sets but no keyed play at all — see
   *  `MonthGenreDiversity.index` (same D-8 / AC-6 split). */
  index: number | null;
  no_key_count: number;
  breakdown: CategoryTally[];
}

/** Story 4.7 AC-4/AC-6: median on-air seconds per track this bucket, from
 *  `SyncPlay.played_ms` (~98% populated per Story 3.7 §3d). */
export interface MonthMixPace {
  /** `null` when every play in the bucket is missing `played_ms` — a gap
   *  (D-8), never a fabricated `0`. */
  medianSeconds: number | null;
  /** Plays in this bucket missing `played_ms` — never silently folded into
   *  the median (mirrors `no_genre_count`'s "never omitted" contract). */
  excludedCount: number;
}

/** Story 4.7 AC-4/AC-7: harmonic mix rate this bucket, from
 *  `derived.camelot_mixing_stats` (three raw counts per set; summed here,
 *  then divided — `shared/` never hands over a pre-divided rate). */
export interface MonthHarmonicMix {
  /** `compatible / (compatible + incompatible)` across the bucket's
   *  surviving sets. `null` when there are zero scored transitions to divide
   *  — never a fabricated `0%`. */
  rate: number | null;
  /** Transitions excluded for missing a key on either side, summed across
   *  the bucket — disclosed the same way `no_genre_count` is. */
  excludedNoKey: number;
}

/** One bucket's (month or week) aggregation across every metric. Each field
 *  is `null` (a gap, never a fabricated zero — D-8) when no set in this
 *  partition (excluding/including) landed in this bucket, or carries no data
 *  for that particular metric. */
export interface BucketPoint {
  bpmRange: MonthBpmRange | null;
  genreDiversity: MonthGenreDiversity | null;
  keyDiversity: MonthKeyDiversity | null;
  /** Story 4.7 AC-4: median of each surviving set's own per-set median BPM
   *  (`derived.bpm_distribution.median`) — aggregated at the SET level, the
   *  same level `bpmRange` above merges at, not re-derived from raw plays. */
  medianBpm: number | null;
  mixPace: MonthMixPace | null;
  harmonicMix: MonthHarmonicMix | null;
}

export interface BucketSeries {
  /** Ordered ascending bucket keys — the union across ALL sets (pre-exclusion), so a bucket that loses every set to exclusion still renders as a gap (D-8) rather than vanishing from the x-axis. */
  buckets: string[];
  /** Per-bucket values with low-confidence sets excluded (D-4 default view). Parallel to `buckets`. */
  excluding: BucketPoint[];
  /** Per-bucket values with low-confidence sets included (D-4 reveal view). Parallel to `buckets`. */
  including: BucketPoint[];
}

export interface StyleEvolutionModel {
  /** Every synced set, dated or not (Story 4.7 AC-8, added at code review
   *  2026-08-07). AC-8 scopes the summary tile row to "≥1 set" — and the view
   *  is handed only this model, so without a count it had no way to tell a DJ
   *  with NO history from one with a month of it, and rendered four "—" tiles
   *  at a DJ who has never synced anything. The 0-set empty state is a
   *  separate, unaffected case that AC-8 explicitly does not narrow. */
  setCount: number;
  /** Distinct calendar months across ALL synced sets, pre-exclusion (D-5). Backs AC-3, independent of granularity. */
  monthsSpannedAll: number;
  /** Count of sets with `derived.confidence.value < 1.0` that actually land in
   *  a bucket. Undated sets are deliberately NOT counted: they are dropped
   *  from every series, so including them would have the banner offer to
   *  reveal sessions that revealing cannot draw. */
  lowConfidenceCount: number;
  /** Sets with a missing/unparsable `started_at`, dropped from every series
   *  because there is no bucket to file them under. Disclosed rather than
   *  silently swallowed — the same contract `no_genre_count` holds to. */
  undatedCount: number;
  month: BucketSeries;
  week: BucketSeries;
}

// D-7 (ai-4 closure): the low-confidence tier has no upper density ceiling —
// an 865-play zero-long-gap session and a 4-play zero-long-gap session both
// register identically low-confidence. This is a known, accepted limitation
// of a frozen, do-not-tune signal (Epic 1 retro D4), not something this
// story attempts to fix.
function isLowConfidence(set: SetRecord): boolean {
  return set.derived.confidence.value < 1.0;
}

/** Standard median — sorted middle value, or the average of the two middle
 *  values for an even-length input. `null` for empty input (a gap, D-8). */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function aggregateBucket(sets: SetRecord[]): BucketPoint {
  if (sets.length === 0) {
    return {
      bpmRange: null,
      genreDiversity: null,
      keyDiversity: null,
      medianBpm: null,
      mixPace: null,
      harmonicMix: null,
    };
  }

  let min = Infinity;
  let max = -Infinity;
  for (const s of sets) {
    const bpm = s.derived.bpm_distribution;
    if (bpm.count > 0) {
      if (bpm.min < min) min = bpm.min;
      if (bpm.max > max) max = bpm.max;
    }
  }
  const bpmRange = min <= max ? { min, max } : null;

  // Genre diversity (D-1/AC-5): merge `derived.genre_breakdown.buckets` by
  // genre name across the bucket's surviving sets — the AD-12 caveat (stable
  // taxonomy version assumed; holds today, the taxonomy table has never
  // changed) applies to this merge.
  const genreCounts = new Map<string, number>();
  let noGenreCount = 0;
  for (const s of sets) {
    for (const b of s.derived.genre_breakdown.buckets) {
      genreCounts.set(b.genre, (genreCounts.get(b.genre) ?? 0) + b.play_count);
    }
    noGenreCount += s.derived.genre_breakdown.no_genre_count;
  }
  const genreDiversity: MonthGenreDiversity = {
    // D-8: no categorized play at all → no index to plot. `shannonEntropy([])`
    // is a legitimate `0`, but plotting it would draw a point claiming "1.0
    // effective genres" for a bucket where zero genres are known — the same
    // fabricated-value trap `bpmRange`'s `min <= max` guard above avoids.
    index: genreCounts.size === 0 ? null : shannonEntropy([...genreCounts.values()]),
    no_genre_count: noGenreCount,
    breakdown: [...genreCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };

  // Key diversity (D-2/AC-6): walk per-play `camelot_key` (NOT
  // `derived.camelot_mixing_stats` — that's harmonic transition-compatibility,
  // a different concept) tallied by raw Camelot string.
  const keyCounts = new Map<string, number>();
  let noKeyCount = 0;
  for (const s of sets) {
    for (const p of s.plays) {
      if (p.camelot_key) {
        keyCounts.set(p.camelot_key, (keyCounts.get(p.camelot_key) ?? 0) + 1);
      } else {
        noKeyCount++;
      }
    }
  }
  const keyDiversity: MonthKeyDiversity = {
    // D-8, same as genre above: an all-unkeyed bucket is a gap, not a 1.0.
    index: keyCounts.size === 0 ? null : shannonEntropy([...keyCounts.values()]),
    no_key_count: noKeyCount,
    breakdown: [...keyCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count),
  };

  // Median BPM (Story 4.7 AC-4): median of each surviving set's own per-set
  // median (not re-derived from raw plays) — the same set-level aggregation
  // discipline `bpmRange` above already uses.
  const setMedians: number[] = [];
  for (const s of sets) {
    if (s.derived.bpm_distribution.count > 0) setMedians.push(s.derived.bpm_distribution.median);
  }
  const medianBpm = median(setMedians);

  // Mix pace (Story 4.7 AC-4/AC-6): median on-air seconds per track, from
  // `played_ms`. A play missing it is excluded from the median and counted,
  // never silently folded in — the same "never omitted" contract
  // `no_genre_count` holds to.
  const paceSeconds: number[] = [];
  let mixPaceExcluded = 0;
  for (const s of sets) {
    for (const p of s.plays) {
      if (p.played_ms != null) paceSeconds.push(p.played_ms / 1000);
      else mixPaceExcluded++;
    }
  }
  const mixPace: MonthMixPace = { medianSeconds: median(paceSeconds), excludedCount: mixPaceExcluded };

  // Harmonic mix rate (Story 4.7 AC-4/AC-7): compatible / (compatible +
  // incompatible) transitions, summed across the bucket's surviving sets'
  // `camelot_mixing_stats` — three raw counts per set, `web/` divides.
  let compatible = 0;
  let incompatible = 0;
  let excludedNoKey = 0;
  for (const s of sets) {
    const m = s.derived.camelot_mixing_stats;
    compatible += m.compatible_transitions;
    incompatible += m.incompatible_transitions;
    excludedNoKey += m.excluded_no_key;
  }
  const harmonicDenom = compatible + incompatible;
  const harmonicMix: MonthHarmonicMix = {
    rate: harmonicDenom > 0 ? compatible / harmonicDenom : null,
    excludedNoKey,
  };

  return { bpmRange, genreDiversity, keyDiversity, medianBpm, mixPace, harmonicMix };
}

/**
 * Every month key from `first` to `last` inclusive (added post-launch-review,
 * 2026-08-06, Arjun: a month with zero sets was silently missing from the
 * x-axis entirely — "just because there isn't a set doesn't mean you should
 * remove them" — compressing e.g. April straight into June with no sign May
 * was ever skipped). A month with no sets still gets a bucket; `aggregateBucket`
 * naturally renders it `null` (D-8's gap, not a fabricated zero).
 */
function fillMonthRange(first: string, last: string): string[] {
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  const out: string[] = [];
  while (y < ly || (y === ly && m <= lm)) {
    out.push(`${y}-${`${m}`.padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** Same continuity fix as `fillMonthRange`, stepping by 7 local-calendar days (Monday to Monday) instead of by month. */
function fillWeekRange(first: string, last: string): string[] {
  const [fy, fm, fd] = first.split("-").map(Number);
  const [ly, lm, ld] = last.split("-").map(Number);
  const end = new Date(ly, lm - 1, ld).getTime();
  const out: string[] = [];
  let cur = new Date(fy, fm - 1, fd);
  const pad = (n: number) => `${n}`.padStart(2, "0");
  while (cur.getTime() <= end) {
    out.push(`${cur.getFullYear()}-${pad(cur.getMonth() + 1)}-${pad(cur.getDate())}`);
    cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 7);
  }
  return out;
}

function buildSeries(
  sets: SetRecord[],
  bucketKeyFn: (iso: string | null) => string,
  fillRange: (first: string, last: string) => string[],
): BucketSeries {
  const keySet = new Set<string>();
  for (const s of sets) {
    const key = bucketKeyFn(s.started_at);
    if (key) keySet.add(key);
  }
  const present = [...keySet].sort();
  const buckets = present.length === 0 ? [] : fillRange(present[0], present[present.length - 1]);

  const excluding = buckets.map((b) =>
    aggregateBucket(sets.filter((s) => bucketKeyFn(s.started_at) === b && !isLowConfidence(s))),
  );
  const including = buckets.map((b) => aggregateBucket(sets.filter((s) => bucketKeyFn(s.started_at) === b)));

  return { buckets, excluding, including };
}

/** Builds the full Style Evolution trend model from the DJ's synced sets — both month and week series, computed up front. */
export function buildStyleEvolution(sets: SetRecord[]): StyleEvolutionModel {
  const dated = sets.filter((s) => localMonthKey(s.started_at) !== "");
  return {
    setCount: sets.length,
    monthsSpannedAll: monthsSpanned(sets),
    lowConfidenceCount: dated.filter(isLowConfidence).length,
    undatedCount: sets.length - dated.length,
    month: buildSeries(sets, localMonthKey, fillMonthRange),
    week: buildSeries(sets, localWeekKey, fillWeekRange),
  };
}

/* ── Chart Summary generators — one generator per metric, each following
   energyArc.ts's "one generator, three duties" pattern (D-12 there): the
   SAME string is the visible caption, the chart container's aria
   text-equivalent, and the render-failure fallback. Never three different
   strings for the three duties. ─────────────────────────────────────────── */

/**
 * True when the buckets on screen straddle a year boundary — in which case
 * every label below has to carry its year (2026-08-06: once the fixture grew
 * past twelve months, "peaked in December" and two separate ticks both reading
 * "June" named nothing at all). Within a single year the year is noise, so it
 * stays off.
 */
function spansMultipleYears(buckets: string[]): boolean {
  const years = new Set(buckets.map((b) => b.slice(0, 4)));
  return years.size > 1;
}

function monthLabel(monthKey: string, withYear = false): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString([], withYear ? { month: "long", year: "numeric" } : { month: "long" });
}

/** "Mar 2" — the short label for a week bucket's Monday-start key. */
function weekLabel(weekKey: string, withYear = false): string {
  const [y, m, day] = weekKey.split("-").map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(
    [],
    withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" },
  );
}

/** "March" for a month bucket, "the week of Mar 2" for a week bucket — the
 *  shared noun-phrase both "since ___" and "in ___" compose with below. */
function bucketPhrase(key: string, granularity: Granularity, withYear = false): string {
  return granularity === "month" ? monthLabel(key, withYear) : `the week of ${weekLabel(key, withYear)}`;
}

/**
 * The summary tiles' bare noun-phrase for a bucket — "June", "week of Jun 22".
 * Deliberately article-less, unlike {@link bucketPhrase}: the tiles compose it
 * after "vs "/"from ", where "the week of" would read as a stray determiner.
 *
 * Exists because the tiles must NAME the bucket a delta is measured against
 * rather than assert a fixed "previous month" (code review, 2026-08-07): the
 * reading's comparison bucket is the nearest EARLIER bucket carrying a value,
 * which D-8 gaps routinely make non-adjacent — on the committed fixture, three
 * of the four tiles compare August against JUNE, and at week granularity the
 * median-BPM tile spans five weeks. Saying "previous month" over that is the
 * same fabricated-precision failure D-8 exists to prevent.
 */
export function tileBucketLabel(key: string, granularity: Granularity, withYear = false): string {
  return granularity === "month" ? monthLabel(key, withYear) : `week of ${weekLabel(key, withYear)}`;
}

function presentPoints<T>(buckets: string[], values: Array<T | null>): Array<{ bucket: string; value: T }> {
  const out: Array<{ bucket: string; value: T }> = [];
  for (let i = 0; i < buckets.length; i++) {
    const v = values[i];
    if (v != null) out.push({ bucket: buckets[i], value: v });
  }
  return out;
}

/**
 * BPM range trend caption. Templated min/max/direction register, adapted from
 * energyArc.ts's within-set narrative to a bucket-over-bucket one — e.g. "BPM
 * range widened from 118–124 to 122–130 since March." Gaps (D-8) are skipped
 * when picking the first/last surviving buckets, never treated as 0.
 */
export function bpmRangeSummary(
  buckets: string[],
  values: Array<MonthBpmRange | null>,
  granularity: Granularity,
): string {
  const present = presentPoints(buckets, values);
  if (present.length === 0) return "No BPM data yet.";
  const withYear = spansMultipleYears(buckets);
  if (present.length === 1) {
    const { min, max } = present[0].value;
    // `withYear` is computed BEFORE this branch (it used to be resolved after,
    // so a lone surviving bucket on a multi-year axis read "in June" while the
    // ticks read Jun '25 / Jun '26). `diversityTrendSummary` already does this.
    const where = bucketPhrase(present[0].bucket, granularity, withYear);
    return min === max ? `A steady ${Math.round(min)} BPM in ${where}.` : `BPM ranged ${Math.round(min)}–${Math.round(max)} in ${where}.`;
  }

  const first = present[0];
  const last = present[present.length - 1];
  const firstLabel = `${Math.round(first.value.min)}–${Math.round(first.value.max)}`;
  const lastLabel = `${Math.round(last.value.min)}–${Math.round(last.value.max)}`;
  const since = bucketPhrase(first.bucket, granularity, withYear);

  const firstWidth = first.value.max - first.value.min;
  const lastWidth = last.value.max - last.value.min;

  // An interior bucket materially wider than BOTH endpoints — the endpoints
  // alone would hide it (2026-08-06: across 15 months the chart visibly opened
  // to 50–162 mid-run, while the from/to sentence reported only "narrowed from
  // 73–128 to 50–50", the second of those being a one-play soundcheck). Only
  // interior buckets qualify: a widest-at-an-endpoint run is already exactly
  // what the plain from/to sentence describes.
  const interior = present.slice(1, -1);
  if (interior.length > 0) {
    const widest = interior.reduce((a, b) => (b.value.max - b.value.min > a.value.max - a.value.min ? b : a));
    const widestWidth = widest.value.max - widest.value.min;
    if (widestWidth - Math.max(firstWidth, lastWidth) >= ARC_WIDTH_THRESHOLD) {
      const widestLabel = `${Math.round(widest.value.min)}–${Math.round(widest.value.max)}`;
      return `BPM range ran ${firstLabel} in ${since}, opened widest at ${widestLabel} in ${bucketPhrase(widest.bucket, granularity, withYear)}, and sits at ${lastLabel} in ${bucketPhrase(last.bucket, granularity, withYear)}.`;
    }
  }

  if (firstLabel === lastLabel) {
    return `BPM range has held steady at ${lastLabel} since ${since}.`;
  }

  const WIDTH_STEADY_THRESHOLD = 2;
  if (Math.abs(lastWidth - firstWidth) >= WIDTH_STEADY_THRESHOLD) {
    const direction = lastWidth > firstWidth ? "widened" : "narrowed";
    return `BPM range ${direction} from ${firstLabel} to ${lastLabel} since ${since}.`;
  }

  const shiftedUp = last.value.min + last.value.max > first.value.min + first.value.max;
  const direction = shiftedUp ? "shifted up" : "shifted down";
  return `BPM range ${direction} from ${firstLabel} to ${lastLabel} since ${since}.`;
}

/**
 * `2^H` — the "effective number of categories" a Shannon entropy value `H`
 * implies (a Hill number of order 1 / "true diversity" in ecology, where this
 * exact index/genre-count problem is a long-solved one). Deterministic and
 * directly interpretable, unlike a bare entropy bit value (added
 * post-launch-review, 2026-08-06, Arjun: "more/less variety" wasn't
 * quantitative enough — "what does that even mean?"):
 *   - one genre playing exclusively → `H = 0` → `2^0 = 1` effective genre.
 *   - four genres played in perfectly even rotation → `H = 2` → `2^2 = 4`
 *     effective genres — matches the plain-English count exactly.
 *   - a skewed mix (one dominant genre, several rare ones) lands between 1
 *     and the true distinct-genre count — it discounts genres that barely
 *     get played, which a bare distinct-count would overstate.
 */
export function effectiveDiversity(bits: number): number {
  return 2 ** bits;
}

// The threshold below is on the EFFECTIVE-COUNT scale (not bits) — |Δ| under
// this many effective genres/keys reads as "held steady".
const DIVERSITY_STEADY_THRESHOLD = 0.3;

/** How much wider (in BPM) an interior bucket must be than both endpoints
 *  before the caption reports the arc rather than just from/to. Deliberately
 *  well above `WIDTH_STEADY_THRESHOLD`: a couple of BPM of mid-run wobble is
 *  not a story, a 50-BPM opening-up is. */
const ARC_WIDTH_THRESHOLD = 10;

function fmtCount(n: number): string {
  return n.toFixed(1);
}

function diversityTrendSummary(
  buckets: string[],
  indices: Array<number | null>,
  granularity: Granularity,
  noun: string,
  unitNoun: string,
): string {
  const present = presentPoints(buckets, indices);
  if (present.length === 0) {
    // Sentence-initial "No" outranks the noun, so the noun is lowercase here
    // (unlike every other branch below, where the noun opens the sentence).
    return `No ${noun[0].toLowerCase()}${noun.slice(1)} data yet.`;
  }
  const withYear = spansMultipleYears(buckets);
  if (present.length === 1) {
    const count = fmtCount(effectiveDiversity(present[0].value));
    return `${noun} sits at ${count} effective ${unitNoun} in ${bucketPhrase(present[0].bucket, granularity, withYear)}.`;
  }

  const first = present[0];
  const last = present[present.length - 1];
  const since = bucketPhrase(first.bucket, granularity, withYear);
  const firstCount = effectiveDiversity(first.value);
  const lastCount = effectiveDiversity(last.value);
  const delta = lastCount - firstCount;

  // An interior peak or trough the two endpoints hide (2026-08-06: across 15
  // months the line visibly arced 1.0 → 3.8 → 1.0, and the from/to sentence
  // called that "held steady around 1.0"). Only interior buckets qualify — an
  // extreme sitting AT an endpoint is already what from/to reports.
  const interior = present.slice(1, -1);
  if (interior.length > 0) {
    const peak = interior.reduce((a, b) => (b.value > a.value ? b : a));
    const trough = interior.reduce((a, b) => (b.value < a.value ? b : a));
    const peakCount = effectiveDiversity(peak.value);
    const troughCount = effectiveDiversity(trough.value);
    if (peakCount - Math.max(firstCount, lastCount) >= DIVERSITY_STEADY_THRESHOLD) {
      return `${noun} climbed from ${fmtCount(firstCount)} in ${since} to a peak of ${fmtCount(peakCount)} effective ${unitNoun} in ${bucketPhrase(peak.bucket, granularity, withYear)}, then eased back to ${fmtCount(lastCount)}.`;
    }
    if (Math.min(firstCount, lastCount) - troughCount >= DIVERSITY_STEADY_THRESHOLD) {
      return `${noun} dipped from ${fmtCount(firstCount)} in ${since} to ${fmtCount(troughCount)} effective ${unitNoun} in ${bucketPhrase(trough.bucket, granularity, withYear)}, then recovered to ${fmtCount(lastCount)}.`;
    }
  }

  if (Math.abs(delta) < DIVERSITY_STEADY_THRESHOLD) {
    return `${noun} has held steady around ${fmtCount(lastCount)} effective ${unitNoun} since ${since}.`;
  }
  const direction = delta > 0 ? "broadened" : "narrowed";
  return `${noun} has ${direction} from ${fmtCount(firstCount)} to ${fmtCount(lastCount)} effective ${unitNoun} since ${since}.`;
}

/** Genre-diversity trend caption (D-1/AC-5) — "X effective genres" (D-1's Shannon entropy, converted via `effectiveDiversity`). */
export function genreDiversitySummary(
  buckets: string[],
  values: Array<MonthGenreDiversity | null>,
  granularity: Granularity,
): string {
  return diversityTrendSummary(
    buckets,
    values.map((v) => (v ? v.index : null)),
    granularity,
    "Genre diversity",
    "genres",
  );
}

/** Key-usage-diversity trend caption (D-2/AC-6) — same entropy formula as genre, applied to per-play Camelot keys. */
export function keyDiversitySummary(
  buckets: string[],
  values: Array<MonthKeyDiversity | null>,
  granularity: Granularity,
): string {
  return diversityTrendSummary(
    buckets,
    values.map((v) => (v ? v.index : null)),
    granularity,
    "Key usage",
    "keys",
  );
}

/* ── Summary tiles (Story 4.7, AC-4/AC-5) ──────────────────────────────────
   Four aggregate readings above the sections: median BPM, effective genre
   count, harmonic mix rate, mix pace. Aggregate rather than time-series, so
   they read honestly off a single bucket (AC-8) — no insufficient-history
   gate applies to them. */

export interface TileReading {
  current: number;
  /** Which bucket `current` was read from. A metric can go quiet while others
   *  keep reporting, so this is per-metric and NOT necessarily the series'
   *  last bucket — the tile row can legitimately show two different periods
   *  at once. */
  currentBucket: string;
  /** Against the nearest EARLIER bucket carrying a present value for this
   *  metric (skipping D-8 gaps) — `null` when none exists, never a
   *  fabricated `0` (AC-5). */
  delta: number | null;
  /** The bucket `delta` was actually measured against — `null` exactly when
   *  `delta` is. The tile NAMES this rather than asserting "previous month",
   *  which gap-skipping makes false (see {@link tileBucketLabel}). */
  deltaBucket: string | null;
}

/** Walks a value series back-to-front: the last present value is `current`,
 *  the next present value further back is what `delta` is measured against.
 *  `null` entirely when there is no current value at all. `buckets` is
 *  parallel to `values` — both come from the same `BucketSeries`. */
function latestWithDelta(
  buckets: string[],
  values: Array<number | null>,
): (TileReading & { index: number }) | null {
  let currentIndex = -1;
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i] != null) {
      currentIndex = i;
      break;
    }
  }
  if (currentIndex === -1) return null;
  const current = values[currentIndex] as number;

  let delta: number | null = null;
  let deltaBucket: string | null = null;
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (values[i] != null) {
      delta = current - (values[i] as number);
      deltaBucket = buckets[i];
      break;
    }
  }
  return { current, currentBucket: buckets[currentIndex], delta, deltaBucket, index: currentIndex };
}

/**
 * The most recent bucket's own count for a disclosure that has no reading to
 * sit beside.
 *
 * `buildSummaryTiles` normally discloses the CURRENT bucket's excluded count.
 * When a metric has no current bucket at all — every play in history missing
 * `played_ms`, say — that path yields `0`, which silently drops the count in
 * exactly the case where 100% of the data was excluded (code review,
 * 2026-08-07). AC-6/AC-7 call these counts "never omitted", so the fallback
 * reports the latest bucket that actually excluded something: the tile then
 * reads "—" WITH the reason, instead of "—" with no explanation.
 */
function latestNonZero(counts: Array<number | null>): number {
  for (let i = counts.length - 1; i >= 0; i--) {
    const c = counts[i];
    if (c != null && c > 0) return c;
  }
  return 0;
}

export interface SummaryTiles {
  medianBpm: TileReading | null;
  effectiveGenreCount: TileReading | null;
  harmonicMixRate: TileReading | null;
  mixPace: TileReading | null;
  /** Disclosure counts for the CURRENT bucket (the reading being shown),
   *  never summed across history — mirrors `no_genre_count`'s "never
   *  omitted" contract at the tile's own scale. When a metric has no current
   *  bucket at all, this falls back to the latest bucket that excluded
   *  anything, so the count is never dropped precisely when everything was
   *  excluded (see {@link latestNonZero}). */
  mixPaceExcludedCount: number;
  harmonicExcludedNoKey: number;
}

/** Builds the four summary tiles from one bucket series (the currently
 *  selected granularity × reveal state — AC-2's page-level controls already
 *  govern which `points` array this is called with). `buckets` is that same
 *  series' key array, so each reading can NAME the period it was read from
 *  and the period its delta is measured against. */
export function buildSummaryTiles(buckets: string[], points: BucketPoint[]): SummaryTiles {
  const bpmValues = points.map((p) => p.medianBpm);
  const genreValues = points.map((p) =>
    p.genreDiversity && p.genreDiversity.index != null ? effectiveDiversity(p.genreDiversity.index) : null,
  );
  const harmonicValues = points.map((p) => p.harmonicMix?.rate ?? null);
  const paceValues = points.map((p) => p.mixPace?.medianSeconds ?? null);

  const bpm = latestWithDelta(buckets, bpmValues);
  const genre = latestWithDelta(buckets, genreValues);
  const harmonic = latestWithDelta(buckets, harmonicValues);
  const pace = latestWithDelta(buckets, paceValues);

  const strip = (r: (TileReading & { index: number }) | null): TileReading | null =>
    r && { current: r.current, currentBucket: r.currentBucket, delta: r.delta, deltaBucket: r.deltaBucket };

  return {
    medianBpm: strip(bpm),
    effectiveGenreCount: strip(genre),
    harmonicMixRate: strip(harmonic),
    mixPace: strip(pace),
    mixPaceExcludedCount: pace
      ? (points[pace.index].mixPace?.excludedCount ?? 0)
      : latestNonZero(points.map((p) => p.mixPace?.excludedCount ?? null)),
    harmonicExcludedNoKey: harmonic
      ? (points[harmonic.index].harmonicMix?.excludedNoKey ?? 0)
      : latestNonZero(points.map((p) => p.harmonicMix?.excludedNoKey ?? null)),
  };
}

/* ── Genre share stream + Camelot wheel (Story 4.8) ────────────────────────
   Both hero models derive from per-bucket aggregates this file ALREADY
   computes — `genreDiversity.breakdown` and `keyDiversity.breakdown` — with
   no second walk over `plays` (AC-1/G-4 say so literally). */

/** The taxonomy's literal catch-all genre — kept in sync with
 *  `genreColor.ts`'s `CATCH_ALL_GENRE` (not imported: this module is
 *  `genreColor.ts`'s own upstream, and a value import back would be a
 *  cycle). */
const TAXONOMY_CATCH_ALL = "Other";

export interface GenreShareBand {
  name: string;
  /** `named` = one of the top-6 genres; `catchAll` = the taxonomy's own
   *  literal "Other" genre (a real category); `fold` = this chart's
   *  fold-the-rest aggregate ("Other genres" — never mistakable for a
   *  genre, AC-2). */
  kind: "named" | "catchAll" | "fold";
}

export interface GenreShareModel {
  /** Stack order, bottom → top: named genres in the shared global rank
   *  order, then the literal catch-all, then the fold band. */
  bands: GenreShareBand[];
  /** Parallel to the bucket axis. `null` = a bucket with no categorized
   *  play — a D-8 gap in the stream, never a fabricated all-Other column.
   *  `counts` is parallel to `bands`; `total` is the bucket's categorized
   *  play count, so `counts[i] / total` is an integer-over-integer share
   *  (bit-identical cross-engine — G-8's safe case). */
  columns: Array<{ counts: number[]; total: number } | null>;
}

/** Named genres given their own band in the stream — ruled N=6 (AC-2,
 *  2026-08-07 party mode). Deliberately NOT equal to the breakdown bars'
 *  MAX_CATEGORIES = 5: different geometries, different legibility budgets
 *  (G-3 — an asymmetry to keep, not a bug to unify). */
export const GENRE_STREAM_MAX = 6;

/** The stream's fold-band label. "Everything else", not "Other genres"
 *  (Arjun, 2026-08-08): the taxonomy's own literal "Other" genre already
 *  sits in the same legend, and two near-identical "Other…" entries read as
 *  a mystery, not a distinction. */
export const GENRE_FOLD_LABEL = "Everything else";

/**
 * Per-bucket 100%-stacked genre shares (AC-1/AC-2). `rankedNames` is the
 * shared view-independent ranking from `buildGenreColorAssignment` — the
 * stream selects its top 6 from the SAME list the bars select their top 5
 * from, so the two charts in the Genre section can never disagree about
 * which genre a color names (G-1).
 */
export function buildGenreShare(
  values: Array<MonthGenreDiversity | null>,
  rankedNames: string[],
): GenreShareModel {
  // Present = appears with a nonzero count somewhere in THIS view. A genre
  // absent from the view gets no band (a zero-height band everywhere is
  // legend noise), but its color is still reserved globally, so its absence
  // here never recolors anything (AC-3).
  const present = new Set<string>();
  for (const v of values) {
    for (const t of v?.breakdown ?? []) if (t.count > 0) present.add(t.name);
  }

  // A band is "named" only if the genre holds one of the 6 reserved color
  // slots (the global top-6, whether or not all six are present in THIS
  // view). A genre present here but outside the global slots folds — giving
  // it a band of its own would render it in the fold neutral (its only
  // color), indistinguishable from the fold band beside it.
  const top = rankedNames.slice(0, GENRE_STREAM_MAX).filter((n) => present.has(n));
  const topSet = new Set(top);
  const hasFold = rankedNames.some((n) => present.has(n) && !topSet.has(n));

  const bands: GenreShareBand[] = top.map((name) => ({ name, kind: "named" as const }));
  if (present.has(TAXONOMY_CATCH_ALL)) bands.push({ name: TAXONOMY_CATCH_ALL, kind: "catchAll" });
  if (hasFold) bands.push({ name: GENRE_FOLD_LABEL, kind: "fold" });

  const slot = new Map(bands.map((b, i) => [b.name, i]));
  const foldSlot = hasFold ? bands.length - 1 : -1;

  const columns = values.map((v) => {
    const breakdown = v?.breakdown ?? [];
    const counts = bands.map(() => 0);
    let total = 0;
    for (const t of breakdown) {
      if (t.count <= 0) continue;
      total += t.count;
      const i = slot.get(t.name) ?? foldSlot;
      if (i >= 0) counts[i] += t.count;
    }
    // No categorized play at all → a gap (D-8), even when the bucket exists
    // and carries a `no_genre_count` for the disclosure line.
    return total === 0 ? null : { counts, total };
  });

  return { bands, columns };
}

/** One Camelot cell's aggregate play count. `number`/`letter` come from the
 *  existing `parseCamelot` — never a second parser (Task 1). */
export interface CamelotCell {
  number: number;
  letter: "A" | "B";
  count: number;
}

export interface CamelotWheelModel {
  /** All 24 cells, 1A..12A then 1B..12B, zero-count cells included — a zero
   *  cell renders EMPTY (D-8), never at minimum intensity. */
  cells: CamelotCell[];
  /** Sum of all parseable-key play counts. */
  totalKeyed: number;
  /** The busiest cell's count — the intensity scale's ceiling. */
  maxCount: number;
  /** Plays whose key string failed `parseCamelot` — never silently dropped
   *  into a cell; routed to the AC-10 disclosure beside `no_key_count`. */
  unreadableCount: number;
}

/**
 * The wheel's aggregate: `keyDiversity.breakdown` summed across EVERY bucket
 * of one partition (G-4 — no second walk over `plays`). Feed it the month
 * series of the reveal-selected partition: month and week partition the
 * identical dated-set population, so the totals are provably equal and the
 * granularity toggle has nothing to act on (AC-8's asymmetry, by
 * construction rather than by wiring).
 */
export function buildCamelotWheel(values: Array<MonthKeyDiversity | null>): CamelotWheelModel {
  const counts = new Map<string, number>();
  let unreadableCount = 0;
  for (const v of values) {
    for (const t of v?.breakdown ?? []) {
      if (t.count <= 0) continue;
      const parsed = parseCamelot(t.name);
      if (!parsed) {
        unreadableCount += t.count;
        continue;
      }
      const key = `${parsed.number}${parsed.letter}`;
      counts.set(key, (counts.get(key) ?? 0) + t.count);
    }
  }

  const cells: CamelotCell[] = [];
  for (const letter of ["A", "B"] as const) {
    for (let number = 1; number <= 12; number++) {
      cells.push({ number, letter, count: counts.get(`${number}${letter}`) ?? 0 });
    }
  }
  const totalKeyed = cells.reduce((sum, c) => sum + c.count, 0);
  const maxCount = cells.reduce((max, c) => (c.count > max ? c.count : max), 0);

  return { cells, totalKeyed, maxCount, unreadableCount };
}

/** Integer share → whole-percent label. Integer-over-integer input, so the
 *  value itself is bit-identical cross-engine (G-8); rounding is for prose. */
function pctLabel(count: number, total: number): string {
  return `${Math.round((count / total) * 100)}%`;
}

/**
 * Genre-share stream caption (Story 4.8 hero #1) — the same "one generator,
 * three duties" contract as every generator above. Names the leading genre
 * and its share, from → to when the lead's story spans buckets.
 */
export function genreShareSummary(
  buckets: string[],
  values: Array<MonthGenreDiversity | null>,
  granularity: Granularity,
): string {
  const present = presentPoints(
    buckets,
    values.map((v) => (v && v.breakdown.some((t) => t.count > 0) ? v : null)),
  );
  if (present.length === 0) return "No genre data yet.";
  const withYear = spansMultipleYears(buckets);

  const lead = (v: MonthGenreDiversity) => {
    // breakdown is sorted descending by count; ties break by first-seen,
    // which is stable for a given dataset.
    const top = v.breakdown[0];
    const total = v.breakdown.reduce((sum, t) => sum + t.count, 0);
    return { name: top.name, share: pctLabel(top.count, total) };
  };

  const last = present[present.length - 1];
  const lastLead = lead(last.value);
  if (present.length === 1) {
    return `${lastLead.name} led your mix at ${lastLead.share} in ${bucketPhrase(last.bucket, granularity, withYear)}.`;
  }

  const first = present[0];
  const firstLead = lead(first.value);
  const since = bucketPhrase(first.bucket, granularity, withYear);
  if (firstLead.name === lastLead.name) {
    return `${lastLead.name} has led your mix since ${since}, at ${lastLead.share} in ${bucketPhrase(last.bucket, granularity, withYear)}.`;
  }
  return `${firstLead.name} led at ${firstLead.share} in ${since}; ${lastLead.name} leads at ${lastLead.share} in ${bucketPhrase(last.bucket, granularity, withYear)}.`;
}

/**
 * Camelot wheel text-equivalent (AC-11's literal wording: "top keys and
 * their share") — caption, aria text, and render fallback in one string.
 * Aggregate, so no bucket phrase and no granularity parameter.
 */
export function camelotWheelSummary(wheel: CamelotWheelModel): string {
  if (wheel.totalKeyed === 0) return "No key data yet.";
  const top = [...wheel.cells]
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count || a.number - b.number || (a.letter < b.letter ? -1 : 1))
    .slice(0, 3);
  if (top.length === 1) {
    return `Every keyed play sits in ${top[0].number}${top[0].letter}.`;
  }
  const parts = top.map((c) => `${c.number}${c.letter} (${pctLabel(c.count, wheel.totalKeyed)})`);
  const list = parts.length === 2 ? parts.join(" and ") : `${parts[0]}, ${parts[1]}, and ${parts[2]}`;
  return `Your keys center on ${list}.`;
}

/** |Δ| in percentage points under this reads as "held steady" — the same
 *  role DIVERSITY_STEADY_THRESHOLD plays on the effective-count scale. */
const HARMONIC_STEADY_THRESHOLD = 3;

/**
 * Harmonic-compatibility trend caption (AC-9) — `harmonicMix.rate` has been
 * synced on every set since Story 1.7 and displayed nowhere; this is its
 * first sentence. Same register as `bpmRangeSummary`/`diversityTrendSummary`:
 * gaps skipped when picking first/last (D-8), year labels once the axis
 * spans one.
 */
export function harmonicMixSummary(
  buckets: string[],
  values: Array<MonthHarmonicMix | null>,
  granularity: Granularity,
): string {
  const present = presentPoints(
    buckets,
    values.map((v) => (v && v.rate != null ? v.rate : null)),
  );
  if (present.length === 0) return "No harmonic mixing data yet.";
  const withYear = spansMultipleYears(buckets);
  const pct = (rate: number) => `${Math.round(rate * 100)}%`;

  if (present.length === 1) {
    return `Harmonic mixing sits at ${pct(present[0].value)} in ${bucketPhrase(present[0].bucket, granularity, withYear)}.`;
  }

  const first = present[0];
  const last = present[present.length - 1];
  const since = bucketPhrase(first.bucket, granularity, withYear);
  const deltaPoints = (last.value - first.value) * 100;
  if (Math.abs(deltaPoints) < HARMONIC_STEADY_THRESHOLD) {
    return `Harmonic mixing has held steady around ${pct(last.value)} since ${since}.`;
  }
  const direction = deltaPoints > 0 ? "climbed" : "slipped";
  return `Harmonic mixing ${direction} from ${pct(first.value)} to ${pct(last.value)} since ${since}.`;
}
