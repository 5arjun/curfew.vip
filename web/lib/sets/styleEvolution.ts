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
  /** Against the nearest EARLIER bucket carrying a present value for this
   *  metric (skipping D-8 gaps) — `null` when none exists, never a
   *  fabricated `0` (AC-5). */
  delta: number | null;
}

/** Walks a value series back-to-front: the last present value is `current`,
 *  the next present value further back is what `delta` is measured against.
 *  `null` entirely when there is no current value at all. */
function latestWithDelta(values: Array<number | null>): (TileReading & { index: number }) | null {
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
  for (let i = currentIndex - 1; i >= 0; i--) {
    if (values[i] != null) {
      delta = current - (values[i] as number);
      break;
    }
  }
  return { current, delta, index: currentIndex };
}

export interface SummaryTiles {
  medianBpm: TileReading | null;
  effectiveGenreCount: TileReading | null;
  harmonicMixRate: TileReading | null;
  mixPace: TileReading | null;
  /** Disclosure counts for the CURRENT bucket only (the reading being shown),
   *  never summed across history — mirrors `no_genre_count`'s "never
   *  omitted" contract at the tile's own scale. */
  mixPaceExcludedCount: number;
  harmonicExcludedNoKey: number;
}

/** Builds the four summary tiles from one bucket series (the currently
 *  selected granularity × reveal state — AC-2's page-level controls already
 *  govern which `points` array this is called with). */
export function buildSummaryTiles(points: BucketPoint[]): SummaryTiles {
  const bpmValues = points.map((p) => p.medianBpm);
  const genreValues = points.map((p) =>
    p.genreDiversity && p.genreDiversity.index != null ? effectiveDiversity(p.genreDiversity.index) : null,
  );
  const harmonicValues = points.map((p) => p.harmonicMix?.rate ?? null);
  const paceValues = points.map((p) => p.mixPace?.medianSeconds ?? null);

  const bpm = latestWithDelta(bpmValues);
  const genre = latestWithDelta(genreValues);
  const harmonic = latestWithDelta(harmonicValues);
  const pace = latestWithDelta(paceValues);

  return {
    medianBpm: bpm && { current: bpm.current, delta: bpm.delta },
    effectiveGenreCount: genre && { current: genre.current, delta: genre.delta },
    harmonicMixRate: harmonic && { current: harmonic.current, delta: harmonic.delta },
    mixPace: pace && { current: pace.current, delta: pace.delta },
    mixPaceExcludedCount: pace ? (points[pace.index].mixPace?.excludedCount ?? 0) : 0,
    harmonicExcludedNoKey: harmonic ? (points[harmonic.index].harmonicMix?.excludedNoKey ?? 0) : 0,
  };
}
