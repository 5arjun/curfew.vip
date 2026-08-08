"use client";

import { useMemo } from "react";
import {
  buildGenreShare,
  genreShareSummary,
  type GenreShareModel,
  type Granularity,
  type MonthGenreDiversity,
} from "@/lib/sets/styleEvolution";
import { genreColorFor, type GenreColorAssignment } from "@/lib/sets/genreColor";
import { createMonotoneYAt, type CurveXY } from "@/lib/sets/energyArc";
import { TrendChartErrorBoundary } from "./TrendChart";

// Genre share stream (Story 4.8, AC-1..6/AC-12) — the Genre section's hero:
// a 100%-stacked share view of genre composition per bucket, computed
// entirely from the `genreDiversity.breakdown` tallies `styleEvolution.ts`
// already carries (no new pass over `plays`). Bands are the top-6 genres from
// the page's shared color assignment plus the taxonomy's literal "Other"
// genre and a fold band — model logic in `buildGenreShare`, this component
// only draws.
//
// Geometry mirrors TrendChart's plot conventions on purpose (same 1000×260
// viewBox, same padding, same 5.8% y-axis gutter) so the stream's columns
// sit vertically aligned with the 2^H trend chart directly below it in the
// same section.
//
// D-8 shapes the drawing: a bucket with no categorized plays is a HOLE in
// the stream (the runs/gap discipline TrendChart established), never an
// all-Other column. An isolated bucket draws as one full-height stacked
// column — which is also exactly the AC-12 single-set rendering.
//
// G-8: the share math itself is integer-over-integer (bit-identical across
// engines — cleared by 4.7's review for the equivalent bar interpolations),
// but every emitted coordinate still rounds to the file family's fixed
// decimals: `.toFixed(2)` for SVG path strings, `.toFixed(4)` for
// inline-style percentages.

const VIEW = { width: 1000, height: 260, padding: 28 };
const Y_AXIS_GUTTER = 58; // keep in sync with TrendChart / the 5.8% CSS gutter
/** Curve samples per run segment — same density the trend band fill uses. */
const FILL_SAMPLES = 24;
/** An isolated bucket's column width in viewBox units (capped like
 *  TrendChart's BAR_GROUP_MAX_WIDTH, wider since it stands alone). */
const LONE_COLUMN_MAX_WIDTH = 90;

function xForIndex(i: number, count: number): number {
  if (count <= 1) return VIEW.width / 2;
  const usable = VIEW.width - VIEW.padding * 2 - Y_AXIS_GUTTER;
  return VIEW.padding + Y_AXIS_GUTTER + (usable * i) / (count - 1);
}

const pctX = (x: number) => `${((x / VIEW.width) * 100).toFixed(4)}%`;
const pctY = (y: number) => `${((y / VIEW.height) * 100).toFixed(4)}%`;

/** Cumulative share (0–1) → plot y. Share 0 sits on the baseline, 1 at the
 *  plot top — the whole domain is fixed by construction, no auto-fit. */
function shareY(cum: number): number {
  return VIEW.padding + (1 - cum) * (VIEW.height - VIEW.padding * 2);
}

/** Contiguous runs of non-null column indices — same gap discipline as
 *  TrendChart's `nonNullRuns`. */
function columnRuns(columns: GenreShareModel["columns"]): number[][] {
  const runs: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < columns.length; i++) {
    if (columns[i] != null) cur.push(i);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/** Same month-name tick TrendChart draws (the axis shows the containing
 *  month, never day numbers — 2026-08-06 ruling). */
function bucketTick(key: string, withYear: boolean): string {
  const [y, m] = key.split("-").map(Number);
  if (!withYear) return new Date(y, m - 1, 1).toLocaleDateString([], { month: "long" });
  const short = new Date(y, m - 1, 1).toLocaleDateString([], { month: "short" });
  return `${short} '${`${y}`.slice(2)}`;
}

export function GenreShareStream({
  buckets,
  granularity,
  genreSeries,
  genreColors,
}: {
  buckets: string[];
  granularity: Granularity;
  genreSeries: Array<MonthGenreDiversity | null>;
  /** The page-level shared assignment (G-1) — the same one the breakdown
   *  bars consume, so the two charts in this section always agree. */
  genreColors: GenreColorAssignment;
}) {
  // THE one Chart Summary string (visible caption + aria text-equivalent +
  // render-failure fallback).
  const caption = genreShareSummary(buckets, genreSeries, granularity);

  return (
    <TrendChartErrorBoundary caption={caption} resetKey={`genre-share:${granularity}:${buckets.length}`}>
      <GenreShareStreamPlot
        buckets={buckets}
        granularity={granularity}
        genreSeries={genreSeries}
        genreColors={genreColors}
        caption={caption}
      />
    </TrendChartErrorBoundary>
  );
}

function GenreShareStreamPlot({
  buckets,
  granularity,
  genreSeries,
  genreColors,
  caption,
}: {
  buckets: string[];
  granularity: Granularity;
  genreSeries: Array<MonthGenreDiversity | null>;
  genreColors: GenreColorAssignment;
  caption: string;
}) {
  const model = useMemo(() => buildGenreShare(genreSeries, genreColors.ranked), [genreSeries, genreColors]);
  const xs = useMemo(() => buckets.map((_, i) => xForIndex(i, buckets.length)), [buckets]);
  const runs = useMemo(() => columnRuns(model.columns), [model]);

  const bandColor = (bandIndex: number) => {
    const band = model.bands[bandIndex];
    return genreColorFor(genreColors, band.name);
  };

  // Per-band filled regions. For each run of ≥2 buckets, every stacking
  // boundary (cumulative share) is sampled through the SAME monotone
  // evaluator the trend charts use, then clamped against the boundary below
  // it — independent Hermite curves through ordered points can transiently
  // cross, and a clamp during sampling is what guarantees bands never
  // overlap or go negative.
  const regions = useMemo(() => {
    const out: Array<{ key: string; bandIndex: number; d: string }> = [];
    for (const run of runs) {
      const cums = run.map((i) => {
        const col = model.columns[i]!;
        const c: number[] = [0];
        let acc = 0;
        for (const n of col.counts) {
          acc += n;
          c.push(acc / col.total);
        }
        return c; // length = bands + 1, last === 1 exactly
      });

      if (run.length === 1) {
        // Isolated bucket (and the AC-12 single-set case): one full-height
        // stacked column, not an error state.
        const i = run[0];
        const pitch = buckets.length > 1 ? xs[1] - xs[0] : VIEW.width - VIEW.padding * 2 - Y_AXIS_GUTTER;
        const half = Math.min(pitch * 0.42, LONE_COLUMN_MAX_WIDTH) / 2;
        const x0 = (xs[i] - half).toFixed(2);
        const x1 = (xs[i] + half).toFixed(2);
        for (let b = 0; b < model.bands.length; b++) {
          if (cums[0][b + 1] - cums[0][b] <= 0) continue;
          const yTop = shareY(cums[0][b + 1]).toFixed(2);
          const yBot = shareY(cums[0][b]).toFixed(2);
          out.push({
            key: `${buckets[i]}:${b}`,
            bandIndex: b,
            d: `M ${x0} ${yTop} L ${x1} ${yTop} L ${x1} ${yBot} L ${x0} ${yBot} Z`,
          });
        }
        continue;
      }

      const first = xs[run[0]];
      const last = xs[run[run.length - 1]];
      const steps = Math.max(2, (run.length - 1) * FILL_SAMPLES);
      const sampleXs = Array.from({ length: steps + 1 }, (_, s) => first + ((last - first) * s) / steps);

      // Boundary 0 is the baseline; boundary bands.length is a flat 100%.
      // Everything between is sampled and clamped bottom-up.
      const sampled: number[][] = [sampleXs.map(() => 0)];
      for (let b = 1; b <= model.bands.length; b++) {
        const pts: CurveXY[] = run.map((i, ri) => ({ x: xs[i], y: cums[ri][b] }));
        const yAt = createMonotoneYAt(pts);
        const below = sampled[b - 1];
        sampled.push(sampleXs.map((x, si) => Math.min(1, Math.max(below[si], yAt(x)))));
      }

      for (let b = 0; b < model.bands.length; b++) {
        // Skip a band that is empty across this whole run — no zero-area
        // path noise.
        if (!run.some((i, ri) => cums[ri][b + 1] - cums[ri][b] > 0)) continue;
        const top = sampled[b + 1];
        const bottom = sampled[b];
        const forward = sampleXs
          .map((x, si) => `${si === 0 ? "M" : "L"} ${x.toFixed(2)} ${shareY(top[si]).toFixed(2)}`)
          .join(" ");
        const back = sampleXs
          .map((x, si) => `${x.toFixed(2)} ${shareY(bottom[si]).toFixed(2)}`)
          .reverse()
          .join(" L ");
        out.push({ key: `${buckets[run[0]]}:${b}`, bandIndex: b, d: `${forward} L ${back} Z` });
      }
    }
    return out;
  }, [runs, model, xs, buckets]);

  const hasAnyColumn = model.columns.some((c) => c != null);

  if (!hasAnyColumn) {
    return (
      <div className="se-chart se-chart-fallback dz-shell" role="img" aria-label={caption}>
        <span className="dz-dots" aria-hidden="true" />
        <p className="se-chart-caption">{caption}</p>
      </div>
    );
  }

  const maxLabels = granularity === "week" ? 6 : 8;
  const tickStep = buckets.length > maxLabels ? Math.ceil(buckets.length / maxLabels) : 1;
  const multiYear = new Set(buckets.map((b) => b.slice(0, 4))).size > 1;
  const lastIndex = buckets.length - 1;
  const showLastTick = lastIndex - Math.floor(lastIndex / tickStep) * tickStep >= Math.ceil(tickStep / 2);

  return (
    <div className="se-chart se-chart-full dz-shell">
      <span className="dz-dots" aria-hidden="true" />

      <div className="se-chart-head">
        <p className="se-chart-title">Genre Mix</p>
        <p className="se-chart-subtitle">
          Share of each {granularity === "month" ? "month's" : "week's"} plays, by genre
        </p>
      </div>

      <div className="se-chart-plot se-stream-plot" role="img" aria-label={caption}>
        <div className="se-chart-yaxis" aria-hidden="true">
          <span className="se-chart-ylabel" style={{ top: pctY(shareY(1)) }}>
            100%
          </span>
          <span className="se-chart-ylabel" style={{ top: pctY(shareY(0)) }}>
            0
          </span>
        </div>

        <svg
          className="se-chart-svg"
          viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          {regions.map((r) => (
            <path key={r.key} d={r.d} className="se-stream-band" fill={bandColor(r.bandIndex)} />
          ))}
        </svg>
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

      {/* Legend — identity never rides on color alone. "Other" (the
          taxonomy's own genre) and "Other genres" (this chart's fold) keep
          separate names AND separate swatches, the protected distinction. */}
      <div className="se-chart-cats">
        {model.bands.map((band, bi) => (
          <span key={band.name} className="se-chart-cat">
            <span className="se-chart-cat-swatch se-stream-swatch" style={{ background: bandColor(bi) }} aria-hidden="true" />
            {band.kind === "fold" ? `${band.name}*` : band.name}
          </span>
        ))}
        {model.bands.some((b) => b.kind === "fold") && (
          <span className="se-chart-cats-note">*everything past the top 6, folded</span>
        )}
      </div>

      <p className="se-chart-caption">{caption}</p>
    </div>
  );
}
