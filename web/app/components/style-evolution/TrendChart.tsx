"use client";

import { Component, useCallback, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  bpmRangeSummary,
  effectiveDiversity,
  genreDiversitySummary,
  harmonicMixSummary,
  type CategoryTally,
  type Granularity,
  type MonthBpmRange,
  type MonthGenreDiversity,
  type MonthHarmonicMix,
} from "@/lib/sets/styleEvolution";
import {
  CATCH_ALL_GENRE,
  FOLD_COLOR,
  buildGenreColorAssignment,
  genreColorFor,
  selectGenreBands,
  type GenreColorAssignment,
} from "@/lib/sets/genreColor";
import {
  DEFAULT_CONVERSION_WINDOW,
  isLowConfidenceCohort,
  libraryConversionSummary,
  type ConversionWindow,
  type LibraryConversionModel,
} from "@/lib/sets/libraryConversion";
import { createMonotoneYAt, monotonePath, type CurveXY } from "@/lib/sets/energyArc";
import { CursorChip, useCursorChipTarget } from "@/app/components/ui/CursorChip";

// Style Evolution trend chart (Story 4.1, D-3) — a NEW bucketed chart, not a
// fork of DetailArc/energyArc.ts (3.8): those are per-play, continuous
// time-domain, and support zoom + click-to-jump, none of which apply to a
// month/week aggregate with a categorical x-axis. This component shares only
// the VISUAL LANGUAGE with that precedent: the chrome-gradient stroke, the
// CursorChip hover treatment, and the Chart Summary caption-underneath idiom
// (energyArc.ts's "one generator, three duties" — visible caption + aria
// text-equivalent + render-failure fallback, same string, never three).
//
// BPM range renders as a min/max band (a ribbon between two lines); genre and
// key diversity render as a single line over the category composition it
// summarizes.
//
// Curve smoothing (2026-08-06, Arjun: the straight polyline between sparse
// monthly points read as "a random line", not a trend): reuses energyArc.ts's
// `monotonePath`/`createMonotoneYAt` — the pure Fritsch–Carlson math, not the
// arc COMPONENT — a deliberate, narrow amendment to D-3. Every point still
// sits exactly ON the curve (Hermite interpolation's defining property), so
// nothing is fabricated between real buckets; only the connecting line looks
// like a trend instead of a zigzag.
//
// Gaps (D-8 — a bucket with no surviving sets after confidence exclusion) are
// NOT a fabricated zero, but they are no longer a hole either (2026-08-06,
// Arjun: "the line isn't rendering properly, and we cannot even see half of
// the graph"). Three rules, together:
//   1. Every real bucket carries an always-visible DOT. Previously a run of
//      consecutive real buckets shorter than 2 drew literally nothing — an
//      isolated month with real data was invisible, which is what "can't see
//      half the graph" was.
//   2. Consecutive real buckets are joined by the solid monotone curve.
//   3. Across a gap the two runs are joined by a straight DASHED bridge —
//      visibly a connector, not a modeled value, so the trend spans the full
//      axis without claiming data for the empty buckets underneath it.
//
// The category breakdown is drawn INSIDE this chart as stacked columns behind
// the line (2026-08-06, Arjun: "I want the bars to be on the same exact graph
// as the line, with the line overlaid on top of the bars"), replacing the
// separate CategoryBreakdownBars panel. Bars are plain absolutely-positioned
// HTML, not SVG rects: the plot svg is `preserveAspectRatio="none"`, which
// turns any rx/circle into a stretched ellipse, and an HTML stack gets an
// undistorted rounded cap plus its own hover target for free — which also
// retires the hand-aligned hit-row the SVG version needed.

// "key" was retired by Story 4.8: the Key section's composition is now
// wheel (hero) → harmonic trend (secondary), with no 2^H slot, so nothing
// rendered `metric="key"` any more. The branch, `keyColor`, the "Other keys"
// label and the whole non-genre `ranked` block survived only because tests
// kept them compiling — removed at code review (P-15, 2026-08-08). The pure
// generator `keyDiversitySummary` is deliberately KEPT in styleEvolution.ts,
// still exported and still tested: it costs nothing and is the piece a future
// key-trend story would actually want back.
export type TrendMetric = "bpm" | "genre" | "library" | "harmonic";

const VIEW = { width: 1000, height: 260, padding: 28 };
const Y_AXIS_GUTTER = 42; // left margin reserved for the y-axis labels (4.2% of VIEW.width)
/** The gutter a chart that ALSO carries the bar-scale label needs. "120 tracks"
 *  / "53 plays" is roughly twice the width of a "100%" tick, and inside the
 *  42-unit gutter it wrapped onto two lines and crowded the tick above it
 *  (Arjun, 2026-08-18 — the library trend). Both values reach the stylesheet as
 *  the `--se-yaxis` custom property below, so the CSS box and the viewBox
 *  coordinates can no longer be edited apart. */
const Y_AXIS_GUTTER_WIDE = 64;
/** Minimum vertical separation, in viewBox units, between two gutter labels
 *  before one is nudged clear of the other — the two half line-heights (10.5px
 *  and 9.5px type) plus air. 15 → 18 alongside the gutter widening below: the
 *  old value was the two labels touching, which was tolerable while the wider
 *  one wrapped and the eye had a line break to read the split by, and is not
 *  now that both are single lines. */
const AXIS_LABEL_CLEARANCE = 18;
const BAND_FILL_SAMPLES = 24; // per run — dense enough that the sampled ribbon reads as smooth
/** Named categories given their own bar. Dropped 6→5 (2026-08-06, Arjun:
 *  "is it possible to make the bars wider? maybe we show 5 instead of 6") —
 *  fewer slots per month, so each bar gets a wider share of the group. */
const MAX_CATEGORIES = 5;
// The literal catch-all genre ("Other", genre.rs normalization) is a real,
// playable category — but like the synthetic fold-the-rest bucket it says
// nothing about style, and on real data it is the tallest bar in almost every
// month. Both are treated as "other" by the Show-other toggle; they keep
// SEPARATE names and colours (the distinction an earlier review protected).
// The name constant itself now lives in genreColor.ts (Story 4.8), the shared
// home of every genre-color rule, and is imported above.
/** Tallest bar, as a fraction of the plot band — headroom so a peak bar never
 *  crowds the top axis label or swallows the line above it. */
const BAR_MAX_FRACTION = 0.86;
/** A month's whole group of bars, in viewBox units, capped so a two-bucket
 *  view doesn't render two slabs. */
const BAR_GROUP_MAX_WIDTH = 110;

function monthName(y: number, m: number): string {
  return new Date(y, m - 1, 1).toLocaleDateString([], { month: "long" });
}

/** Axis tick — always just the containing month's full name (Arjun,
 *  2026-08-06: day numbers on the x-axis were noise; the month alone
 *  orients — "just February, April, June, July is fine"). Same for week
 *  granularity: the axis shows the month a week falls in, not its exact
 *  start date (the hover chip below still shows that precisely). */
function bucketTick(key: string, withYear: boolean): string {
  const [y, m] = key.split("-").map(Number);
  // month/week keys both start "YYYY-MM" — no granularity branch needed.
  // `withYear` shortens to "Jun '25" once the axis spans more than one year:
  // full month names would repeat ("June" … "June") and name nothing.
  if (!withYear) return monthName(y, m);
  const short = new Date(y, m - 1, 1).toLocaleDateString([], { month: "short" });
  return `${short} '${`${y}`.slice(2)}`;
}

/** Hover-chip label — precise, unlike the axis tick above: the exact
 *  Monday-start date for week granularity (nothing finer exists for month
 *  granularity, so it's the same month name there). */
function bucketDetail(key: string, granularity: Granularity): string {
  const [y, m] = key.split("-").map(Number);
  if (granularity === "month") return monthName(y, m);
  const d = Number(key.split("-")[2]);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Library-metric hover-chip detail. Leads with the exact counts (Arjun,
 *  2026-08-07: the bare percentage alone left "how many tracks are we even
 *  talking about" undiscoverable without the added-vs-played bars' own
 *  scale label to cross-reference) — every month, not only low-confidence
 *  ones, so a DJ never has to guess whether a number is being withheld. */
function libraryHoverDetail(played: number, added: number, window: ConversionWindow): string {
  if (added === 0) return "no tracks added";
  const pct = Math.round((played / added) * 100);
  return `${played} of ${added} tracks played within ${window} days (${pct}%)`;
}

/** A month's group of bars, in viewBox units, for a given bucket count and
 *  gutter — the same `0.84 × pitch, capped` rule the render uses, hoisted so
 *  the x scale can reserve half a group at each end BEFORE the groups are
 *  measured (see `xForIndex`). */
function barGroupWidthFor(count: number, gutter: number): number {
  const usable = VIEW.width - VIEW.padding * 2 - gutter;
  const pitch = count > 1 ? usable / (count - 1) : usable;
  return Math.min(pitch * 0.84, BAR_GROUP_MAX_WIDTH);
}

/**
 * `inset` reserves half a bar group at each end of the scale.
 *
 * Bar groups are centred on their bucket's x (`translateX(-50%)`), and the
 * first bucket used to sit exactly ON the axis line — so half of February's
 * group was drawn underneath the y-axis labels, which printed "50%" and "0%"
 * straight over the bar (Arjun, 2026-08-18). The line metrics don't need the
 * inset, so they don't get one: only a chart that draws bars pays the width.
 *
 * Half a group measured against the UN-inset pitch is always enough room,
 * because insetting only shortens the pitch, and a shorter pitch can only make
 * the group narrower.
 */
function xForIndex(i: number, count: number, gutter: number, inset: number): number {
  if (count <= 1) return VIEW.width / 2;
  const usable = VIEW.width - VIEW.padding * 2 - gutter - inset * 2;
  return VIEW.padding + gutter + inset + (usable * i) / (count - 1);
}

// Fixed to 4 decimal places (Story 4.7 fix — found while all three metrics
// started SSR-ing by default for the first time): a bare template-literal
// percentage emits the FULL float64 shortest-round-trip string (up to ~17
// significant digits). `effectiveDiversity`'s `2 ** bits` can differ from
// server (Node's V8) to client (the browser's V8 build) at the ULP level —
// legal per spec, transcendental math is implementation-approximated, not
// bit-exact across engines — which at 17 digits of precision reads as a
// genuine SSR/hydration mismatch on every page load. Four decimal places is
// already far finer than this chart can visually resolve (a 0.0001% error
// is a fraction of a sub-pixel at any realistic viewport) and matches the
// `.toFixed(2)` discipline this file already uses for its SVG path strings.
const pctX = (x: number) => `${((x / VIEW.width) * 100).toFixed(4)}%`;
const pctY = (y: number) => `${((y / VIEW.height) * 100).toFixed(4)}%`;

interface YDomain {
  min: number;
  max: number;
}

function mapY(v: number, domain: YDomain): number {
  const t = domain.max === domain.min ? 0.5 : (v - domain.min) / (domain.max - domain.min);
  return VIEW.padding + (1 - t) * (VIEW.height - VIEW.padding * 2);
}

/** Contiguous runs of non-null indices — a run is what gets drawn as one
 *  connected curve; the gaps between runs are exactly the D-8 gaps, spanned
 *  by the dashed bridges rather than left as holes. */
function nonNullRuns<T>(values: Array<T | null>): number[][] {
  const runs: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (values[i] != null) cur.push(i);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Straight segments joining each run's last point to the next run's first —
 *  drawn dashed. Straight on purpose: a curve through a gap would read as an
 *  interpolated trend, a dashed straight line reads as "nothing measured
 *  here." */
function bridgeSegments(runs: number[][], pointAt: (i: number) => CurveXY): Array<[CurveXY, CurveXY]> {
  const out: Array<[CurveXY, CurveXY]> = [];
  for (let r = 1; r < runs.length; r++) {
    const prev = runs[r - 1];
    const next = runs[r];
    out.push([pointAt(prev[prev.length - 1]), pointAt(next[0])]);
  }
  return out;
}

function segPath([a, b]: [CurveXY, CurveXY]): string {
  return `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} L ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

/** Samples a monotone curve through `pts` at fine resolution — used to build
 *  the band's smooth fill polygon from the SAME evaluator that draws the
 *  stroke, so the fill edge always matches the line exactly. */
function sampleCurve(pts: CurveXY[]): CurveXY[] {
  if (pts.length < 2) return pts;
  const yAt = createMonotoneYAt(pts);
  const out: CurveXY[] = [];
  const first = pts[0].x;
  const last = pts[pts.length - 1].x;
  const steps = Math.max(2, (pts.length - 1) * BAND_FILL_SAMPLES);
  for (let s = 0; s <= steps; s++) {
    const x = first + ((last - first) * s) / steps;
    out.push({ x, y: yAt(x) });
  }
  return out;
}

function polygonPath(points: CurveXY[]): string {
  return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
}

/* ── Error boundary (D-16 precedent from DetailArc): a render failure swaps
   in the Chart Summary caption block — the chart is a nicety, the caption is
   the guaranteed-accessible content underneath it either way. ─────────── */
// Exported (Story 4.8): the genre share stream and the Camelot wheel wrap
// themselves in this same boundary — their Chart Summary is likewise the
// guaranteed-accessible content under a chart that is a nicety.
export class TrendChartErrorBoundary extends Component<
  { caption: string; resetKey: string; children: ReactNode },
  { failed: boolean; resetKey: string }
> {
  state = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  // Recover when the thing being drawn changes. Without this a single bad
  // render left the caption-only fallback in place for the rest of the
  // session — every later metric/granularity/reveal switch re-rendered the
  // same already-failed instance, even though the new props draw fine.
  static getDerivedStateFromProps(
    props: { resetKey: string },
    state: { failed: boolean; resetKey: string },
  ) {
    if (props.resetKey !== state.resetKey) return { failed: false, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error: Error) {
    // The chart is a nicety and the caption below carries the same content,
    // so this must not rethrow — but a silent swallow makes the failure
    // invisible in the field.
    console.error("[TrendChart] render failed, falling back to the Chart Summary caption:", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="se-chart se-chart-fallback dz-shell" role="img" aria-label={this.props.caption}>
          <span className="dz-dots" aria-hidden="true" />
          <p className="se-chart-caption">{this.props.caption}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

const METRIC_TITLE: Record<TrendMetric, string> = {
  bpm: "BPM Range",
  genre: "Genre Diversity",
  library: "Library Conversion",
  harmonic: "Harmonic Mixing",
};

// Story 4.2 (D-7): the library-conversion metric reuses this component's
// SINGLE-LINE path wholesale — same runs/bridges/dots/curve, same CursorChip,
// same caption idiom. Three things about it are genuinely different, and each
// is branched explicitly rather than folded into the diversity path:
//
//   1. Its x-axis buckets are months tracks were ADDED, not months sets were
//      PLAYED. The caller passes the right `buckets` for the selected metric,
//      so nothing here has to know — but it is why the two can never share a
//      plot, and why only one metric is ever on screen at a time.
//   2. Its y-axis is a percentage with a real 0 and a real 100, not a count
//      with a floor of 1 — so it gets its own domain rather than `lineDomain`.
//   3. It has no category composition, so no bars: `breakdowns` stays empty
//      and `hasBars` is false, which the existing code already handles.
const PCT_DOMAIN: YDomain = { min: 0, max: 100 };

// "Effective genres/keys" (D-1/D-2 Shannon entropy, converted via
// `effectiveDiversity`) — a deterministic, directly-interpretable count
// instead of a raw entropy bit value (added post-launch-review, 2026-08-06,
// Arjun: "more/less variety" wasn't quantitative enough).
const UNIT_NOUN: Partial<Record<TrendMetric, string>> = { genre: "genres" };

interface RankedCategory {
  name: string;
  color: string;
  /** An "other" bucket rather than a style in its own right — hidden, and
   *  excluded from the bar scale, until Show other is ticked. */
  catchAll: boolean;
}

export function TrendChart({
  buckets,
  granularity,
  metric,
  bpmSeries,
  genreSeries,
  harmonicSeries,
  genreColors,
  showCaption = true,
  librarySeries,
  libraryModel,
  conversionWindow = DEFAULT_CONVERSION_WINDOW,
}: {
  buckets: string[];
  granularity: Granularity;
  metric: TrendMetric;
  bpmSeries: Array<MonthBpmRange | null>;
  genreSeries: Array<MonthGenreDiversity | null>;
  /** Story 4.8 (AC-9): per-bucket harmonic mix rate, parallel to `buckets`
   *  when `metric === "harmonic"` — the same percentage plot the library
   *  metric already draws, against the same fixed 0–100 domain. */
  harmonicSeries?: Array<MonthHarmonicMix | null>;
  /** Story 4.8 (AC-3, G-1): the page-level deterministic genre→color
   *  assignment, shared with the genre share stream so the two charts in the
   *  Genre section can never disagree. Callers rendering `metric === "genre"`
   *  should always pass it — without it this component falls back to building
   *  one from its own (view-dependent) series, which keeps names stable
   *  within a view but lets the reveal toggle re-rank slots. */
  genreColors?: GenreColorAssignment;
  /** Hide the visible caption paragraph (Arjun, 2026-08-08 — the Genre
   *  section's charts drop it). The Chart Summary string keeps its other
   *  two duties either way: the plot's aria text-equivalent and the error
   *  fallback. */
  showCaption?: boolean;
  /** Story 4.2: per-cohort conversion rates (0–1), parallel to `buckets` when
   *  `metric === "library"`. The caller passes the ADD-month buckets for that
   *  metric — see `PCT_DOMAIN`'s note above. */
  librarySeries?: Array<number | null>;
  /** Story 4.2: the model the library caption is generated from (AC-2's one
   *  generator). Absent for the other three metrics. */
  libraryModel?: LibraryConversionModel;
  /** Story 4.2 (D-13): the selected conversion window, in days. Named in the
   *  caption, the subtitle, and the hover chip — never left implicit, since
   *  the same chart reads differently at 90 and at 30. */
  conversionWindow?: ConversionWindow;
}) {
  // THE one Chart Summary string per metric (visible caption + aria
  // text-equivalent + render-failure fallback — AC-4).
  const caption =
    metric === "bpm"
      ? bpmRangeSummary(buckets, bpmSeries, granularity)
      : metric === "genre"
        ? genreDiversitySummary(buckets, genreSeries, granularity)
        : metric === "harmonic"
          ? harmonicMixSummary(buckets, harmonicSeries ?? [], granularity)
          : libraryModel
            ? libraryConversionSummary(libraryModel, conversionWindow)
            : "No library additions tracked yet.";

  return (
    <TrendChartErrorBoundary
      caption={caption}
      // The window belongs in the reset key for the same reason metric and
      // granularity do: changing it changes what is drawn, so a boundary
      // tripped by one window must not stay tripped for the next.
      resetKey={`${metric}:${granularity}:${conversionWindow}:${buckets.length}`}
    >
      <TrendChartPlot
        buckets={buckets}
        granularity={granularity}
        metric={metric}
        bpmSeries={bpmSeries}
        genreSeries={genreSeries}
        harmonicSeries={harmonicSeries}
        genreColors={genreColors}
        showCaption={showCaption}
        librarySeries={librarySeries}
        libraryModel={libraryModel}
        conversionWindow={conversionWindow}
        caption={caption}
      />
    </TrendChartErrorBoundary>
  );
}

type Hover = { bucketIndex: number; category: RankedCategory | null; count: number };

function TrendChartPlot({
  buckets,
  granularity,
  metric,
  bpmSeries,
  genreSeries,
  harmonicSeries,
  genreColors,
  showCaption = true,
  librarySeries,
  libraryModel,
  conversionWindow = DEFAULT_CONVERSION_WINDOW,
  caption,
}: {
  buckets: string[];
  granularity: Granularity;
  metric: TrendMetric;
  bpmSeries: Array<MonthBpmRange | null>;
  genreSeries: Array<MonthGenreDiversity | null>;
  harmonicSeries?: Array<MonthHarmonicMix | null>;
  genreColors?: GenreColorAssignment;
  showCaption?: boolean;
  librarySeries?: Array<number | null>;
  libraryModel?: LibraryConversionModel;
  conversionWindow?: ConversionWindow;
  caption: string;
}) {
  // `xs` is computed further down, once `hasBars`/`hasLibraryBars` are known —
  // the x scale reserves room for the bar groups and the gutter widens for
  // their scale label, and both answers depend on whether any bar is drawn.

  // Effective genre/key COUNT (D-1/D-2's entropy, converted) — the plotted
  // quantity itself is now the same deterministic number the axis and
  // caption show, not the raw entropy bits.
  // A bucket can carry a disclosure count (untagged/unkeyed plays) while
  // having no index to plot — `index: null` is D-8's gap, so it must stay a
  // gap here rather than becoming `effectiveDiversity(0)` = a 1.0 point.
  const lineValues: Array<number | null> = useMemo(() => {
    if (metric === "genre")
      return genreSeries.map((v) => (v && v.index != null ? effectiveDiversity(v.index) : null));
    // Story 4.2: rate 0–1 → percent, so the plotted quantity, the axis label,
    // the hover chip, and the caption all speak in the same unit.
    if (metric === "library") return (librarySeries ?? []).map((v) => (v == null ? null : v * 100));
    // Story 4.8 (AC-9): same rate→percent discipline. `rate === null` (zero
    // scored transitions) stays a gap in the line (D-8).
    if (metric === "harmonic") return (harmonicSeries ?? []).map((v) => (v && v.rate != null ? v.rate * 100 : null));
    return [];
  }, [metric, genreSeries, librarySeries, harmonicSeries]);

  // Story 4.2 low-confidence disclosure: `buckets[i]` is `libraryBuckets[i]`
  // is `libraryModel.windows[conversionWindow].cohorts[i].bucket` (all three
  // built from the same array in `StyleEvolutionView`, in the same order),
  // so the cohort's `added` count is a direct index lookup — no re-matching
  // by bucket key needed.
  const libraryAddedByIndex: number[] = useMemo(() => {
    if (metric !== "library" || !libraryModel) return [];
    const cohorts = libraryModel.windows[conversionWindow].cohorts;
    return buckets.map((_, i) => cohorts[i]?.added ?? 0);
  }, [metric, libraryModel, conversionWindow, buckets]);

  /** Same index alignment as `libraryAddedByIndex` above — how many of that
   *  cohort's added tracks were actually played within the window (Arjun,
   *  2026-08-07: show added-vs-played as its own pair of bars, the same
   *  underlying numbers the line's percentage is already computed from). */
  const libraryPlayedByIndex: number[] = useMemo(() => {
    if (metric !== "library" || !libraryModel) return [];
    const cohorts = libraryModel.windows[conversionWindow].cohorts;
    return buckets.map((_, i) => cohorts[i]?.converted ?? 0);
  }, [metric, libraryModel, conversionWindow, buckets]);

  // Scaled against the taller of the two series across every visible month —
  // "added" is always ≥ "played" per cohort, but the TALLEST bar overall
  // could be either one depending on how the window's completed cohorts
  // land, so this doesn't just take libraryAddedByIndex's own max.
  const libraryBarMax = useMemo(() => {
    if (metric !== "library") return 0;
    let max = 0;
    for (let i = 0; i < buckets.length; i++) {
      if ((libraryAddedByIndex[i] ?? 0) > max) max = libraryAddedByIndex[i];
      if ((libraryPlayedByIndex[i] ?? 0) > max) max = libraryPlayedByIndex[i];
    }
    return max;
  }, [metric, buckets, libraryAddedByIndex, libraryPlayedByIndex]);
  const libraryBarScale = libraryBarMax || 1;
  const hasLibraryBars = metric === "library" && libraryBarMax > 0;

  /* ── Category composition, drawn as the grouped bars behind the line ───── */

  // Off by default: the "other" buckets are usually the tallest bar on the
  // chart and say the least, so hiding them lets the real categories rescale
  // to fill the plot (2026-08-06, Arjun). Ticking it puts them back and every
  // bar shrinks to the new scale — animated, not a jump.
  const [showOther, setShowOther] = useState(false);

  // Library conversion has no category composition to draw — an empty
  // breakdown leaves `hasBars` false and the bar layer unrendered, with no
  // extra branch needed anywhere below.
  const breakdowns: Array<CategoryTally[] | null> = useMemo(() => {
    if (metric === "genre") return genreSeries.map((v) => v?.breakdown ?? null);
    return [];
  }, [metric, genreSeries]);

  // "Everything else"/"Other keys" — NOT the bare "Other" this app's own
  // genre taxonomy already uses as a real catch-all category name (genre.rs
  // normalization). A collision there would silently merge a real, playable
  // genre with this component's own fold-the-rest-in bucket in the legend —
  // caught in review (2026-08-06) against the real fixture, which does have
  // an actual "Other" genre. "Everything else" rather than "Other genres"
  // (Arjun, 2026-08-08): two "Other…" entries side by side read as a
  // mystery, not a distinction. Matches the stream's GENRE_FOLD_LABEL.
  const otherLabel = "Everything else";

  // Genre color + slot selection (Story 4.8, G-1): the shared page-level
  // assignment, so a genre's color follows its NAME — never its rank within
  // the current view, which is what used to let the low-confidence reveal
  // recolor every bar (the failure AC-3 names verbatim). Bars show up to
  // MAX_CATEGORIES of the globally color-slotted genres present in this
  // view, in global rank order; anything else folds. N=5 here vs the share
  // stream's N=6 is deliberate (G-3) — different geometries, different
  // legibility budgets — but both select from the same ranked list, so a
  // color never means two genres.
  //
  // Keys keep their existing exact `--camelot-*` mapping and still rank by
  // view-local totals — a key's color is keyed on its name by construction,
  // so the reshuffle failure cannot occur there. Catch-alls stay pinned to
  // the LAST slots regardless of size, so ticking Show other only ever
  // appends bars on the right.
  const ranked = useMemo<RankedCategory[]>(() => {
    const present = new Set<string>();
    const viewTotals = new Map<string, number>();
    for (const bucket of breakdowns) {
      if (!bucket) continue;
      for (const c of bucket) {
        if (c.count > 0) {
          present.add(c.name);
          viewTotals.set(c.name, (viewTotals.get(c.name) ?? 0) + c.count);
        }
      }
    }

    if (metric === "genre") {
      // Fallback assignment from this chart's own series — see the prop doc.
      const assignment =
        genreColors ?? buildGenreColorAssignment(breakdowns.map((b) => (b ? { breakdown: b } : null)));
      // The shared selection rule (D-3): choose from the color roster by
      // count in THIS view so a rostered genre absent here does not cost a
      // bar, then order by global rank so hue and sequence never move.
      const top = selectGenreBands(assignment, viewTotals, MAX_CATEGORIES);
      const topSet = new Set(top);
      const cats: RankedCategory[] = top.map((name) => ({
        name,
        color: genreColorFor(assignment, name),
        catchAll: false,
      }));
      if (present.has(CATCH_ALL_GENRE)) {
        cats.push({ name: CATCH_ALL_GENRE, color: genreColorFor(assignment, CATCH_ALL_GENRE), catchAll: true });
      }
      // Categories past the cap fold into a disclosed "Other" slot — never
      // silently dropped, matching `no_genre_count`'s own "never omitted"
      // contract elsewhere in this feature. Reads `present`, not the roster:
      // a genre outside the color roster entirely still has to be disclosed
      // as folded (D-3/P-14).
      if ([...present].some((n) => n !== CATCH_ALL_GENRE && !topSet.has(n))) {
        cats.push({ name: otherLabel, color: FOLD_COLOR, catchAll: true });
      }
      return cats;
    }

    // Genre is the only metric with a category composition (`breakdowns` is
    // empty for bpm/library/harmonic, so `hasBars` stays false and the bar
    // layer never renders). The old non-genre branch here only ever served
    // metric="key" and returned [] for everything else — removed with it.
    return [];
  }, [breakdowns, metric, otherLabel, genreColors]);

  const hasCatchAll = ranked.some((c) => c.catchAll);

  /** How many named categories did not get a bar — drives the "only top 5
   *  displayed" footnote, which should not appear on a library that simply
   *  has five or fewer to show.
   *
   *  Counted against what `ranked` ACTUALLY drew, not against MAX_CATEGORIES
   *  (P-14, code review 2026-08-08). Since D-3 the genre path selects from a
   *  color roster, so the drawn count and the cap can differ: subtracting the
   *  cap suppressed the footnote while genres sat folded, and overstated it
   *  the other way. */
  const droppedCount = useMemo(() => {
    const named = new Set<string>();
    for (const bucket of breakdowns) {
      if (!bucket) continue;
      for (const c of bucket) {
        if (c.count > 0 && !(metric === "genre" && c.name === CATCH_ALL_GENRE)) named.add(c.name);
      }
    }
    const drawn = ranked.filter((c) => !c.catchAll).length;
    return Math.max(0, named.size - drawn);
  }, [breakdowns, metric, ranked]);

  /** Per-bucket counts, one slot per ranked category, in ranked order. A
   *  category with no plays this bucket keeps its (empty) slot, so a colour
   *  never shifts position between months. */
  const groups = useMemo(() => {
    const slotted = new Set(ranked.map((c) => c.name));
    return breakdowns.map((bucket) => {
      const counts = ranked.map(() => 0);
      if (!bucket) return counts;
      for (const c of bucket) {
        const name = slotted.has(c.name) ? c.name : otherLabel;
        const slot = ranked.findIndex((r) => r.name === name);
        if (slot >= 0) counts[slot] += c.count;
      }
      return counts;
    });
  }, [breakdowns, ranked, otherLabel]);

  // Grouped bars are scaled against the tallest SINGLE bar, not a bucket
  // total — each bar is read against its peers across the timeline. The scale
  // is taken over the VISIBLE bars only, which is the whole point of the
  // toggle: with the catch-alls hidden the five real categories rescale to
  // fill the plot instead of cowering under a bar that dwarfs them.
  const maxBarCount = useMemo(() => {
    let max = 0;
    for (const counts of groups) {
      for (let ci = 0; ci < counts.length; ci++) {
        if ((showOther || !ranked[ci].catchAll) && counts[ci] > max) max = counts[ci];
      }
    }
    return max;
  }, [groups, ranked, showOther]);
  const barScale = maxBarCount || 1;
  const hasBars = ranked.length > 0 && maxBarCount > 0;
  // The legend row must survive `maxBarCount === 0`, otherwise the control
  // that restores the bars disappears along with them: when every category in
  // view is a catch-all and Show other is off, nothing is visible to measure,
  // so `hasBars` goes false and takes the checkbox with it — leaving no way
  // back. Reachable on real data (whole months normalize entirely to "Other").
  const hasCategoryRow = ranked.length > 0;

  /* ── The x scale, and the gutter it starts after ───────────────────────── */

  // A chart that draws bars also prints their scale in the gutter ("120
  // tracks" / "53 plays"), which needs a wider box than a "100%" tick, and
  // needs its groups kept off the axis. Neither is knowable until here, which
  // is why the scale is built at this point rather than at the top of the
  // component. Both numbers reach the stylesheet as `--se-yaxis` below.
  const anyBars = hasBars || hasLibraryBars;
  const yAxisGutter = anyBars ? Y_AXIS_GUTTER_WIDE : Y_AXIS_GUTTER;
  const barInset = anyBars ? barGroupWidthFor(buckets.length, yAxisGutter) / 2 : 0;
  const xs = useMemo(
    () => buckets.map((_, i) => xForIndex(i, buckets.length, yAxisGutter, barInset)),
    [buckets, yAxisGutter, barInset],
  );

  /* ── Y domains ─────────────────────────────────────────────────────────── */

  // Real observed BPM min/max (unpadded) — what the y-axis labels show, so a
  // DJ reading the axis sees the actual numbers, not a chart-breathing-room
  // artifact.
  const bpmDataRange = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const v of bpmSeries) {
      if (v) {
        if (v.min < min) min = v.min;
        if (v.max > max) max = v.max;
      }
    }
    return min === Infinity ? null : { min, max };
  }, [bpmSeries]);

  const bandDomain = useMemo<YDomain>(() => {
    if (!bpmDataRange) return { min: 0, max: 1 };
    if (bpmDataRange.min === bpmDataRange.max) return { min: bpmDataRange.min - 5, max: bpmDataRange.max + 5 };
    const pad = (bpmDataRange.max - bpmDataRange.min) * 0.12;
    return { min: bpmDataRange.min - pad, max: bpmDataRange.max + pad };
  }, [bpmDataRange]);

  // Effective count has a hard floor of 1 (one category dominating), not 0 —
  // the axis and the domain both start there.
  const lineMax = useMemo(() => {
    let max = 1;
    for (const v of lineValues) if (v != null && v > max) max = v;
    return max;
  }, [lineValues]);
  // A conversion rate is a percentage: a real 0 and a real 100, fixed, never
  // rescaled to the data. "40% of what I bought got played" has to be readable
  // against the whole scale — an auto-fitted axis would make 38% vs 41% look
  // like a collapse.
  const lineDomain = useMemo<YDomain>(
    () =>
      metric === "library" || metric === "harmonic"
        ? PCT_DOMAIN
        : { min: 1, max: lineMax <= 1 ? 2 : lineMax * 1.15 },
    [metric, lineMax],
  );

  /* ── Runs, bridges, points ─────────────────────────────────────────────── */

  const bandRuns = useMemo(() => nonNullRuns(bpmSeries), [bpmSeries]);
  const lineRuns = useMemo(() => nonNullRuns(lineValues), [lineValues]);
  const hasAnyPoint = metric === "bpm" ? bpmSeries.some((v) => v != null) : lineValues.some((v) => v != null);

  /** The line's y for a bucket — the band's MAX edge for BPM (where the
   *  cursor ball and the top stroke both ride). `null` for a gap. */
  const lineY = useCallback(
    (i: number): number | null => {
      if (metric === "bpm") return bpmSeries[i] ? mapY(bpmSeries[i]!.max, bandDomain) : null;
      return lineValues[i] != null ? mapY(lineValues[i] as number, lineDomain) : null;
    },
    [metric, bpmSeries, bandDomain, lineValues, lineDomain],
  );

  const tipId = useId();
  // Tap-to-toggle for the explainer — the CSS covers hover and keyboard
  // focus, but neither reaches a touch user.
  const [tipOpen, setTipOpen] = useState(false);
  const chipTargetRef = useCursorChipTarget();
  const [hover, setHover] = useState<Hover | null>(null);

  const onEnter = useCallback(
    (h: Hover, e: React.MouseEvent) => {
      chipTargetRef.current = { x: e.clientX, y: e.clientY };
      setHover(h);
    },
    [chipTargetRef],
  );
  const onMove = useCallback(
    (e: React.MouseEvent) => {
      chipTargetRef.current = { x: e.clientX, y: e.clientY };
    },
    [chipTargetRef],
  );
  const clearHover = useCallback(() => setHover(null), []);

  // `hover` is only cleared by mouse-leave, so a granularity switch driven
  // from the keyboard (pointer still resting on the plot) can leave an index
  // pointing past the end of the now-shorter bucket list. Reading through
  // this guard instead of indexing directly keeps that a no-chip frame rather
  // than a `.split()` on `undefined` — which threw, tripped the boundary, and
  // took the chart down for the session.
  const hoveredBucket = hover != null ? (buckets[hover.bucketIndex] ?? null) : null;

  const rootRef = useRef<HTMLDivElement>(null);

  // Nothing measured at all — the caption alone stands, matching DetailArc's
  // sparse fallback. A SINGLE surviving bucket is no longer a fallback case:
  // it draws as one dot (BPM: a min–max whisker), which is exactly the
  // isolated-point rendering the gap rules above exist for.
  if (!hasAnyPoint) {
    return (
      <div className="se-chart se-chart-fallback dz-shell" role="img" aria-label={caption}>
        <span className="dz-dots" aria-hidden="true" />
        {/* AC-4: the SAME string is the visible caption and the aria
            text-equivalent. This branch used to render its own inline
            sentence ("Not enough surviving months to draw a trend yet."),
            so screen-reader and sighted users read two different things
            about the same state. A richer empty-state line is fine to add
            later — but it has to BECOME the caption, not sit beside it. */}
        <p className="se-chart-caption">{caption}</p>
      </div>
    );
  }

  const maxLabels = granularity === "week" ? 6 : 8;
  const tickStep = buckets.length > maxLabels ? Math.ceil(buckets.length / maxLabels) : 1;
  const multiYear = new Set(buckets.map((b) => b.slice(0, 4))).size > 1;
  // The final bucket always earns a tick — but only if the last STEPPED tick
  // isn't already sitting on top of it. At 20 buckets the step lands on 18 and
  // the forced label on 19, which collided into one unreadable smear
  // ("Jul '26Aug '26").
  const lastIndex = buckets.length - 1;
  const showLastTick = lastIndex - Math.floor(lastIndex / tickStep) * tickStep >= Math.ceil(tickStep / 2);

  // Hover columns: each bucket owns the span to the midpoint of its
  // neighbours, so the hit target is centred on the point it reports. (An
  // equal-flex row, which this used to be, drifts off the outer points —
  // their x sits inside the axis padding, not at the container edge.)
  const columnEdges = [0, ...xs.slice(1).map((x, i) => (xs[i] + x) / 2), VIEW.width];

  // 0.84 of the bucket pitch: the remaining 16% is the air that separates one
  // month's group of bars from the next.
  const groupWidth = buckets.length > 1 ? xs[1] - xs[0] : VIEW.width - VIEW.padding * 2 - yAxisGutter;
  const barGroupWidth = Math.min(groupWidth * 0.84, BAR_GROUP_MAX_WIDTH);
  const barBottomPct = (VIEW.padding / VIEW.height) * 100;
  const barBandPct = ((VIEW.height - VIEW.padding * 2) / VIEW.height) * 100 * BAR_MAX_FRACTION;

  // Both scales share the one gutter, so their two top labels can land on the
  // same line — the bar band's ceiling and the line's peak are independent
  // quantities that happen to collide at some datasets. When they do, the bar
  // count (the context number) steps down below the line's (the subject).
  const yLineTop = mapY(lineMax, lineDomain);
  const yBarsTop = (VIEW.height * (100 - barBottomPct - barBandPct)) / 100;
  const yBarsLabel = Math.abs(yLineTop - yBarsTop) < AXIS_LABEL_CLEARANCE ? yLineTop + AXIS_LABEL_CLEARANCE : yBarsTop;

  return (
    /* `role="img"` sits on the PLOT, not on this card: the card also holds the
       Show-other checkbox and the explainer button, and role="img" collapses
       its whole subtree into one opaque node for assistive tech, which would
       bury both controls. The plot is the actual graphic; `caption` remains its
       text-equivalent (AC-4), and the same string is still the visible caption
       below. */
    <div
      ref={rootRef}
      className="se-chart se-chart-full dz-shell"
      // The y-axis gutter, published to CSS. `.se-chart-yaxis`'s width used to
      // be a hand-copied 4.2% with a comment asking the next editor to keep it
      // in sync with `Y_AXIS_GUTTER` — which is a rule a stylesheet cannot
      // enforce and a review cannot see broken. One source now, two consumers.
      style={{ "--se-yaxis": pctX(yAxisGutter) } as React.CSSProperties}
    >
      <span className="dz-dots" aria-hidden="true" />

      <div className="se-chart-head">
        <p className="se-chart-title">{METRIC_TITLE[metric]}</p>
        {metric === "bpm" ? (
          <div className="se-chart-legend">
            <span className="se-legend-swatch se-legend-swatch--max" aria-hidden="true" />
            <span>Fastest track</span>
            <span className="se-legend-swatch se-legend-swatch--min" aria-hidden="true" />
            <span>Slowest track</span>
          </div>
        ) : metric === "harmonic" ? (
          // States WHAT is plotted, like the diversity subtitle below — the
          // "am I getting better at mixing" line (Story 4.8 AC-9). No
          // explainer button: "share of transitions that stay in key" is the
          // whole definition.
          <p className="se-chart-subtitle">Share of transitions that stay in key</p>
        ) : metric === "library" ? (
          // States WHAT is plotted; the explainer holds the two things a DJ
          // would otherwise have to guess — which month a point belongs to
          // (the one the tracks were BOUGHT in, not played in), and why the
          // line stops short of today.
          <>
            <p className="se-chart-subtitle">
              Share of each month&rsquo;s new tracks played within {conversionWindow} days
              <span className="se-chart-info">
                <button
                  type="button"
                  className="se-chart-info-btn"
                  aria-label="What the library conversion trend measures"
                  aria-describedby={tipId}
                  aria-expanded={tipOpen}
                  onClick={() => setTipOpen((open) => !open)}
                  onBlur={() => setTipOpen(false)}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                    <circle className="se-chart-info-ring" cx="8" cy="8" r="7" />
                    <circle className="se-chart-info-dot" cx="8" cy="4.6" r="0.95" />
                    <path className="se-chart-info-stem" d="M8 7.1v4.6" />
                  </svg>
                </button>
                <span role="tooltip" id={tipId} className="se-chart-info-tip">
                  Each point is the month you ADDED the tracks, not the month you played them. The most recent months
                  are missing on purpose — they haven&rsquo;t had their full {conversionWindow} days yet. Shortening
                  the window asks a harder question (how FAST new music reaches a set), so rates fall — but more
                  months qualify, so the line reaches closer to today.
                </span>
              </span>
            </p>
            {hasLibraryBars && (
              <div className="se-chart-legend">
                <span className="se-legend-swatch se-legend-swatch--bar se-legend-swatch--added" aria-hidden="true" />
                <span>Added</span>
                <span className="se-legend-swatch se-legend-swatch--bar se-legend-swatch--played" aria-hidden="true" />
                <span>Played</span>
              </div>
            )}
          </>
        ) : (
          // The definition used to sit here in full and ran the width of the
          // card. Now the label states WHAT is plotted and the explainer holds
          // WHY it is not just a distinct count (2026-08-06, Arjun).
          <p className="se-chart-subtitle">
            Effective number of {UNIT_NOUN[metric]} played
            <span className="se-chart-info">
              <button
                type="button"
                className="se-chart-info-btn"
                aria-label={`What "effective number of ${UNIT_NOUN[metric]}" means`}
                aria-describedby={tipId}
                aria-expanded={tipOpen}
                onClick={() => setTipOpen((open) => !open)}
                onBlur={() => setTipOpen(false)}
              >
                {/* Paint lives in CSS, not in attributes — the
                    no-hardcoded-colors guard treats the inherit-paint keyword
                    as a named colour literal, so SVG fills and strokes are
                    tokenised there like every other chart glyph in this app. */}
                <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                  <circle className="se-chart-info-ring" cx="8" cy="8" r="7" />
                  <circle className="se-chart-info-dot" cx="8" cy="4.6" r="0.95" />
                  <path className="se-chart-info-stem" d="M8 7.1v4.6" />
                </svg>
              </button>
              <span role="tooltip" id={tipId} className="se-chart-info-tip">
                Weighted by how evenly you mix them, not just how many you touch. Playing 4 {UNIT_NOUN[metric]}, but
                one 80% of the time, reads closer to 1–2 than 4.
              </span>
            </span>
          </p>
        )}
      </div>

      <div className="se-chart-plot" role="img" aria-label={caption}>
        {/* Y-axis. Each number sits at the exact height of the value it
            names, not at the container edge — and the two scales share the
            one gutter, told apart by colour rather than by opposite sides
            (2026-08-06, Arjun): cyan is the line (it matches the stroke),
            muted grey with its "plays" noun is the bars. */}
        <div className="se-chart-yaxis" aria-hidden="true">
          {metric === "bpm" && bpmDataRange ? (
            <>
              <span className="se-chart-ylabel" style={{ top: pctY(mapY(bpmDataRange.max, bandDomain)) }}>
                {Math.round(bpmDataRange.max)}
              </span>
              {/* One surviving track (min === max) puts both labels at the
                  same y — the padded domain centres them — so the number
                  would print on top of itself. One label is the honest
                  reading of a single-value range. */}
              {Math.round(bpmDataRange.min) !== Math.round(bpmDataRange.max) && (
                <span className="se-chart-ylabel" style={{ top: pctY(mapY(bpmDataRange.min, bandDomain)) }}>
                  {Math.round(bpmDataRange.min)}
                </span>
              )}
            </>
          ) : metric === "library" || metric === "harmonic" ? (
            // Fixed 0/50/100 ticks, matching the fixed domain above — the
            // reference points that make a rate legible at a glance
            // (harmonic reuses the whole percentage path, Story 4.8 G-5).
            <>
              {[100, 50, 0].map((tick) => (
                <span key={tick} className="se-chart-ylabel" style={{ top: pctY(mapY(tick, lineDomain)) }}>
                  {tick}%
                </span>
              ))}
              {hasLibraryBars && (
                <span className="se-chart-ylabel se-chart-ylabel--bars" style={{ top: pctY(yBarsLabel) }}>
                  {libraryBarMax}
                  <span className="se-chart-ylabel-noun"> tracks</span>
                </span>
              )}
            </>
          ) : metric !== "bpm" ? (
            <>
              <span className="se-chart-ylabel" style={{ top: pctY(mapY(lineMax, lineDomain)) }}>
                {/* Significant figures, not fixed decimals: the tenth of an
                    effective genre is noise once the count is in double
                    digits, and "16.9" is wide enough to sit on top of the
                    first column in the narrow gutter a phone leaves (measured
                    overlapping at 320px). The caption still carries the
                    precise value. */}
                {lineMax >= 10 ? Math.round(lineMax) : lineMax.toFixed(1)}
              </span>
              {/* The floor label is the same point as the ceiling when every
                  bucket sits at one effective category, which painted "1.0"
                  and "1" on top of each other. */}
              {lineMax > 1 && (
                <span className="se-chart-ylabel" style={{ top: pctY(mapY(1, lineDomain)) }}>
                  1
                </span>
              )}
              {hasBars && (
                <span className="se-chart-ylabel se-chart-ylabel--bars" style={{ top: pctY(yBarsLabel) }}>
                  {/* The noun is dropped at phone width, where the gutter is
                      too narrow to hold it without covering the first column
                      — see the max-width: 640px block in style-evolution.css. */}
                  {maxBarCount}
                  <span className="se-chart-ylabel-noun"> plays</span>
                </span>
              )}
            </>
          ) : null}
        </div>

        {/* Per-bucket hover columns, underneath everything — discrete hover,
            not a continuous cursor follow: with only a handful of buckets
            (vs. hundreds of plays), a hover column per bucket is simpler and
            just as precise. Bar segments sit above these and take priority
            where they overlap. */}
        <div className="se-chart-hit-row" aria-hidden="true">
          {buckets.map((b, i) => (
            <div
              key={b}
              className="se-chart-hit"
              style={{ left: pctX(columnEdges[i]), width: pctX(columnEdges[i + 1] - columnEdges[i]) }}
              onMouseEnter={(e) => onEnter({ bucketIndex: i, category: null, count: 0 }, e)}
              onMouseMove={onMove}
              onMouseLeave={clearHover}
            />
          ))}
        </div>

        {/* Grouped composition bars — one bar per category sitting inline with
            its peers inside a month, with clear air between months. Every
            ranked category holds its slot even at zero plays, so a colour
            never moves position between buckets. */}
        {hasBars && (
          <div className="se-chart-bars" aria-hidden="true">
            {buckets.map((b, bi) => {
              const counts = groups[bi];
              if (counts.every((n) => n === 0)) return null;
              return (
                <div
                  key={b}
                  className="se-chart-group"
                  style={{
                    left: pctX(xs[bi]),
                    width: pctX(barGroupWidth),
                    bottom: `${barBottomPct}%`,
                    height: `${barBandPct}%`,
                  }}
                >
                  {ranked.map((cat, ci) => {
                    const hidden = cat.catchAll && !showOther;
                    const live = !hidden && counts[ci] > 0;
                    return (
                      <span
                        key={cat.name}
                        className="se-chart-bar"
                        data-hidden={hidden || undefined}
                        data-hot={hover?.bucketIndex === bi && hover.category?.name === cat.name ? true : undefined}
                        style={{
                          height: hidden ? "0%" : `${(counts[ci] / barScale) * 100}%`,
                          background: cat.color,
                        }}
                        onMouseEnter={live ? (e) => onEnter({ bucketIndex: bi, category: cat, count: counts[ci] }, e) : undefined}
                        onMouseMove={live ? onMove : undefined}
                        onMouseLeave={live ? clearHover : undefined}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
        )}

        {/* Added-vs-played bars (Arjun, 2026-08-07): reuses the exact same
            group/bar geometry the genre/key composition bars use above
            (`.se-chart-bars`/`.se-chart-group`/`.se-chart-bar`,
            `barGroupWidth`/`barBottomPct`/`barBandPct`) — a fixed two-series
            pair rather than a ranked/capped category list, so it gets its
            own small render path instead of being forced through
            `ranked`/`groups`/`showOther`, which exist for the "top N of
            many, fold the rest into Other" shape genre/key actually has. */}
        {hasLibraryBars && (
          <div className="se-chart-bars" aria-hidden="true">
            {buckets.map((b, bi) => {
              const added = libraryAddedByIndex[bi] ?? 0;
              const played = libraryPlayedByIndex[bi] ?? 0;
              if (added === 0 && played === 0) return null;
              return (
                <div
                  key={b}
                  className="se-chart-group"
                  style={{
                    left: pctX(xs[bi]),
                    width: pctX(barGroupWidth),
                    bottom: `${barBottomPct}%`,
                    height: `${barBandPct}%`,
                  }}
                >
                  <span
                    className="se-chart-bar se-chart-bar--added"
                    style={{ height: `${(added / libraryBarScale) * 100}%` }}
                  />
                  <span
                    className="se-chart-bar se-chart-bar--played"
                    style={{ height: `${(played / libraryBarScale) * 100}%` }}
                  />
                </div>
              );
            })}
          </div>
        )}

        <svg
          className="se-chart-svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <defs>
            {/* userSpaceOnUse, not the default objectBoundingBox: a gradient
                in bounding-box units is dropped entirely when the box has zero
                width or height, which silently erased the isolated-bucket
                whisker (a vertical line — zero-width box) and would have
                erased a perfectly flat run too. Spanning the viewBox also
                makes one sweep serve the whole chart, so a short run and a
                long one are lit the same way instead of each getting its own
                full sweep. */}
            <linearGradient id="se-chart-stroke" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={VIEW.width} y2="0">
              <stop offset="0" stopColor="var(--color-abyss-accent)" />
              <stop offset="0.5" stopColor="var(--metal-abyss-tint)" />
              <stop offset="1" stopColor="var(--color-abyss-accent)" />
            </linearGradient>
            <linearGradient id="se-chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-abyss-accent-glow)" />
              <stop offset="1" stopColor="var(--color-abyss-scrim-fade)" />
            </linearGradient>
          </defs>

          {metric === "bpm" ? (
            <>
              {bandRuns.map((run, ri) => {
                const top: CurveXY[] = run.map((i) => ({ x: xs[i], y: mapY(bpmSeries[i]!.max, bandDomain) }));
                const bottom: CurveXY[] = run.map((i) => ({ x: xs[i], y: mapY(bpmSeries[i]!.min, bandDomain) }));
                // An isolated bucket has no ribbon and no curve — it draws as
                // a min–max whisker, the band collapsed to a single x. Round
                // caps + non-scaling stroke keep it undistorted under
                // preserveAspectRatio="none".
                if (run.length < 2) {
                  return (
                    <line
                      key={ri}
                      className="se-chart-whisker"
                      x1={top[0].x.toFixed(2)}
                      y1={top[0].y.toFixed(2)}
                      x2={bottom[0].x.toFixed(2)}
                      y2={bottom[0].y.toFixed(2)}
                      stroke="url(#se-chart-stroke)"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                }
                const topSampled = sampleCurve(top);
                const bottomSampled = sampleCurve(bottom);
                const ribbon = `${polygonPath(topSampled)} L ${bottomSampled
                  .slice()
                  .reverse()
                  .map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
                  .join(" L ")} Z`;
                return (
                  <g key={ri}>
                    <path d={ribbon} className="se-chart-band" fill="url(#se-chart-fill)" />
                    <path
                      d={monotonePath(top)}
                      className="se-chart-line"
                      stroke="url(#se-chart-stroke)"
                      vectorEffect="non-scaling-stroke"
                    />
                    <path
                      d={monotonePath(bottom)}
                      className="se-chart-line se-chart-line--min"
                      vectorEffect="non-scaling-stroke"
                    />
                  </g>
                );
              })}
              {bridgeSegments(bandRuns, (i) => ({ x: xs[i], y: mapY(bpmSeries[i]!.max, bandDomain) })).map((seg, i) => (
                <path
                  key={`bt-${i}`}
                  d={segPath(seg)}
                  className="se-chart-bridge"
                  stroke="url(#se-chart-stroke)"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {bridgeSegments(bandRuns, (i) => ({ x: xs[i], y: mapY(bpmSeries[i]!.min, bandDomain) })).map((seg, i) => (
                <path
                  key={`bb-${i}`}
                  d={segPath(seg)}
                  className="se-chart-bridge se-chart-bridge--min"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          ) : (
            <>
              {lineRuns.map((run, ri) =>
                run.length < 2 ? null : (
                  <path
                    key={ri}
                    d={monotonePath(run.map((i) => ({ x: xs[i], y: mapY(lineValues[i] as number, lineDomain) })))}
                    className="se-chart-line"
                    stroke="url(#se-chart-stroke)"
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
              {bridgeSegments(lineRuns, (i) => ({ x: xs[i], y: mapY(lineValues[i] as number, lineDomain) })).map(
                (seg, i) => (
                  <path
                    key={`lb-${i}`}
                    d={segPath(seg)}
                    className="se-chart-bridge"
                    stroke="url(#se-chart-stroke)"
                    vectorEffect="non-scaling-stroke"
                  />
                ),
              )}
            </>
          )}
        </svg>

        {/* Always-visible point marks — one per real bucket (both band edges
            for BPM). HTML, not <circle>: preserveAspectRatio="none" would
            stretch an SVG circle into an ellipse. These are what make an
            isolated bucket visible at all. */}
        <div className="se-chart-dots" aria-hidden="true">
          {buckets.map((b, i) => {
            if (metric === "bpm") {
              const v = bpmSeries[i];
              if (!v) return null;
              return (
                <span key={b}>
                  <span className="se-chart-dot" style={{ left: pctX(xs[i]), top: pctY(mapY(v.max, bandDomain)) }} />
                  <span
                    className="se-chart-dot se-chart-dot--min"
                    style={{ left: pctX(xs[i]), top: pctY(mapY(v.min, bandDomain)) }}
                  />
                </span>
              );
            }
            const v = lineValues[i];
            if (v == null) return null;
            // Low-confidence cohorts still plot (D-9's own line never drops
            // a completed cohort) but read as de-emphasised, not equal to a
            // well-sampled one — see `libraryAddedByIndex` above. The flag
            // badge itself renders in `.se-chart-flags` below, not here — see
            // that block's comment for why.
            const lowConfidence = metric === "library" && isLowConfidenceCohort(libraryAddedByIndex[i] ?? 0);
            return (
              <span
                key={b}
                className={lowConfidence ? "se-chart-dot se-chart-dot--low-confidence" : "se-chart-dot"}
                style={{ left: pctX(xs[i]), top: pctY(mapY(v, lineDomain)) }}
              />
            );
          })}
        </div>

        {/* The set-detail chart's own chrome-sphere cursor ball (D-3: same
           VISUAL LANGUAGE, `.sd-arc-cursor-dot`'s exact treatment). Snaps to
           the hovered bucket rather than following the mouse continuously —
           DetailArc's per-play time domain needs a continuous ball; a handful
           of categorical buckets doesn't. */}
        <span
          className="se-chart-cursor-dot"
          data-on={(hover != null && lineY(hover.bucketIndex) != null) || undefined}
          style={
            hover != null && lineY(hover.bucketIndex) != null
              ? { left: pctX(xs[hover.bucketIndex]), top: pctY(lineY(hover.bucketIndex) as number) }
              : undefined
          }
          aria-hidden="true"
        />

        {/* Low-confidence flag badges, their OWN layer above the cursor ball
            (`.se-chart-dots` sits below `.se-chart-cursor-dot` at z-index 3
            vs. 5 — a badge rendered inside `.se-chart-dots` got its
            stacking capped there and partly disappeared under the ball on
            hover, exactly the bug the badge exists to prevent). Kept as a
            separate small layer rather than raising `.se-chart-dots` itself,
            which would wrongly put every ordinary dot above the cursor too. */}
        {metric === "library" && (
          <div className="se-chart-flags" aria-hidden="true">
            {buckets.map((b, i) => {
              const v = lineValues[i];
              if (v == null || !isLowConfidenceCohort(libraryAddedByIndex[i] ?? 0)) return null;
              return (
                <span
                  key={b}
                  className="se-chart-dot-flag"
                  style={{ left: pctX(xs[i]), top: pctY(mapY(v, lineDomain)) }}
                >
                  !
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div className="se-chart-ticks" aria-hidden="true">
        {buckets.map((b, i) =>
          i % tickStep === 0 || (i === lastIndex && showLastTick) ? (
            <span key={b} className="se-chart-tick" style={{ left: pctX(xs[i]) }}>
              {bucketTick(b, multiYear)}
            </span>
          ) : null,
        )}
      </div>

      {hasCategoryRow && (
        <div className="se-chart-cats">
          {ranked.map((cat) =>
            cat.catchAll && !showOther ? null : (
              <span key={cat.name} className="se-chart-cat">
                <span className="se-chart-cat-swatch" style={{ background: cat.color }} aria-hidden="true" />
                {cat.name}
              </span>
            ),
          )}
          {droppedCount > 0 && <span className="se-chart-cats-note">*only top {MAX_CATEGORIES} displayed</span>}
          {hasCatchAll && (
            <label className="se-chart-other-toggle">
              <input type="checkbox" checked={showOther} onChange={(e) => setShowOther(e.target.checked)} />
              Show other
            </label>
          )}
        </div>
      )}

      {showCaption && <p className="se-chart-caption">{caption}</p>}

      <CursorChip
        target={chipTargetRef}
        boundsRef={rootRef}
        visible={hoveredBucket != null}
        contentKey={hoveredBucket != null ? `${hover?.bucketIndex}-${hover?.category?.name ?? ""}` : null}
        offsetY={-44}
        compact
      >
        {hover != null && hoveredBucket != null && (
          <p className="cursor-chip-mono">
            {bucketDetail(hoveredBucket, granularity)}
            {" · "}
            {hover.category
              ? `${hover.category.name} · ${hover.count} ${hover.count === 1 ? "play" : "plays"}`
              : metric === "bpm"
                ? bpmSeries[hover.bucketIndex]
                  ? `${Math.round(bpmSeries[hover.bucketIndex]!.min)}–${Math.round(bpmSeries[hover.bucketIndex]!.max)} BPM`
                  : "no data"
                : lineValues[hover.bucketIndex] == null
                  ? "no data"
                  : metric === "library"
                    ? libraryHoverDetail(
                        libraryPlayedByIndex[hover.bucketIndex] ?? 0,
                        libraryAddedByIndex[hover.bucketIndex] ?? 0,
                        conversionWindow,
                      )
                    : metric === "harmonic"
                      ? `${Math.round(lineValues[hover.bucketIndex] as number)}% of transitions in key`
                      : `${(lineValues[hover.bucketIndex] as number).toFixed(1)} effective ${UNIT_NOUN[metric]}`}
          </p>
        )}
      </CursorChip>
    </div>
  );
}
