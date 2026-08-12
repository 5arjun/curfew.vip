"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import {
  buildGenreShare,
  genreShareSummary,
  pctLabel,
  type GenreShareModel,
  type Granularity,
  type MonthGenreDiversity,
} from "@/lib/sets/styleEvolution";
import {
  genreColorFor,
  tailColorFor,
  FOLD_COLOR,
  GENRE_SLOT_COUNT,
  type GenreColorAssignment,
} from "@/lib/sets/genreColor";
import { createMonotoneYAt, type CurveXY } from "@/lib/sets/energyArc";
import { CursorChip, useCursorChipTarget } from "@/app/components/ui/CursorChip";
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
// viewBox, same padding, same 4.2% y-axis gutter) so the stream's columns
// sit vertically aligned with the 2^H trend chart directly below it in the
// same section.
//
// Hover (Arjun, 2026-08-08 walkthrough: "hovering doesn't provide
// information about the share"): each band path is a mouse hover target that
// snaps the house CursorChip to the nearest bucket and reads
// "March · House · 32% (12 plays)". Mouse-only enrichment following the
// grouped bars' aria-hidden precedent — the Chart Summary caption remains
// the accessible text-equivalent, so no keyboard path is owed.
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
const Y_AXIS_GUTTER = 42; // keep in sync with TrendChart / the 4.2% CSS gutter
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

/** Hover-chip bucket label — precise like TrendChart's `bucketDetail`: the
 *  exact Monday-start date for week granularity, the month name for month. */
function bucketDetail(key: string, granularity: Granularity): string {
  const [y, m] = key.split("-").map(Number);
  if (granularity === "month") return new Date(y, m - 1, 1).toLocaleDateString([], { month: "long" });
  const d = Number(key.split("-")[2]);
  return new Date(y, m - 1, d).toLocaleDateString([], { month: "short", day: "numeric" });
}

export function GenreShareStream({
  buckets,
  granularity,
  genreSeries,
  genreColors,
  untaggedCount = 0,
}: {
  buckets: string[];
  granularity: Granularity;
  genreSeries: Array<MonthGenreDiversity | null>;
  /** The page-level shared assignment (G-1) — the same one the breakdown
   *  bars consume, so the two charts in this section always agree. */
  genreColors: GenreColorAssignment;
  /** Plays with no genre at all, summed across the visible partition. They
   *  are excluded from every share on this chart, and AC-5/AC-6 makes that
   *  exclusion a thing that must always be stated — it used to be a sentence
   *  under the whole section (2026-08-12: removed as prose, kept as a fact).
   *  It rides the legend row here because that row is already the card's
   *  "what is and isn't in these bands" line. */
  untaggedCount?: number;
}) {
  // "Show every genre" (Arjun, 2026-08-12) — breaks the single folded band
  // into one band per genre. Lives HERE rather than in the plot because the
  // model, and therefore the caption and the error-boundary reset key, all
  // change with it: the caption is the chart's only accessible reading (the
  // visible one was dropped in 4.8), so it has to describe the expanded stack
  // when the stack is expanded.
  const [showAllGenres, setShowAllGenres] = useState(false);

  // The COLOR ROSTER, not the full ranking: only genres holding a reserved
  // hue can get a band, and the roster is one wider than the band cap so a
  // rostered genre absent from this view no longer costs a band (D-3).
  // Built out here rather than in the plot so the caption can describe the
  // bands that actually render (P-5).
  const model = useMemo(
    () => buildGenreShare(genreSeries, genreColors.ranked.slice(0, GENRE_SLOT_COUNT), showAllGenres),
    [genreSeries, genreColors, showAllGenres],
  );

  // THE one Chart Summary string (aria text-equivalent + render-failure
  // fallback; the visible caption was dropped from this chart 2026-08-08).
  const caption = genreShareSummary(buckets, genreSeries, granularity, model);

  // Reset the boundary when the DRAWN DATA changes, which `buckets.length`
  // cannot detect: `BucketSeries.buckets` is the union across ALL sets
  // (pre-exclusion), so it is byte-identical for the `excluding` and
  // `including` partitions and the reveal toggle never cleared a tripped
  // boundary — the exact failure the boundary's own comment says the key
  // exists to prevent (P-3, code review 2026-08-08). The categorized-play
  // total moves with the reveal; when it does not, the two partitions draw
  // the same chart and not resetting is the correct outcome.
  const playTotal = useMemo(
    () => genreSeries.reduce((sum, g) => sum + (g?.breakdown ?? []).reduce((n, t) => n + t.count, 0), 0),
    [genreSeries],
  );

  return (
    <TrendChartErrorBoundary
      caption={caption}
      resetKey={`genre-share:${granularity}:${buckets.length}:${playTotal}:${showAllGenres}`}
    >
      <GenreShareStreamPlot
        buckets={buckets}
        granularity={granularity}
        model={model}
        genreColors={genreColors}
        caption={caption}
        showAllGenres={showAllGenres}
        onToggleAllGenres={() => setShowAllGenres((on) => !on)}
        untaggedCount={untaggedCount}
      />
    </TrendChartErrorBoundary>
  );
}

/** Identity, never indices — see `hoverDetail` (P-4). */
type StreamHover = { bandName: string; bucketKey: string };

function GenreShareStreamPlot({
  buckets,
  granularity,
  model,
  genreColors,
  caption,
  showAllGenres,
  onToggleAllGenres,
  untaggedCount,
}: {
  buckets: string[];
  granularity: Granularity;
  model: GenreShareModel;
  genreColors: GenreColorAssignment;
  caption: string;
  showAllGenres: boolean;
  onToggleAllGenres: () => void;
  untaggedCount: number;
}) {
  const xs = useMemo(() => buckets.map((_, i) => xForIndex(i, buckets.length)), [buckets]);
  const runs = useMemo(() => columnRuns(model.columns), [model]);

  const bandColor = (bandIndex: number) => {
    const band = model.bands[bandIndex];
    // A tail band's genre holds no reserved hue by definition, so asking the
    // assignment for one would hand back the fold neutral and paint every
    // expanded band the same grey — the exact failure the expansion exists to
    // fix. Its shade comes from the tail ramp instead.
    if (band.kind === "tail") return tailColorFor(band.tailRank ?? 0);
    return genreColorFor(genreColors, band.name);
  };

  /** The bands that get an inline legend entry: the six named genres plus the
   *  taxonomy's own "Other". Never the fold band and never the tail — both of
   *  those are represented by the one control at the end of the row. */
  const namedBands = useMemo(
    () =>
      model.bands
        .map((band, index) => ({ band, index }))
        .filter(({ band }) => band.kind === "named" || band.kind === "catchAll"),
    [model],
  );

  /** The tail, as legend entries, in BOTH states — which is why the model
   *  carries `tail` independently of whether it drew tail bands. Folded, each
   *  entry wears the fold neutral, because that is genuinely the one band all
   *  of them are inside; expanded, each wears its own step of the ramp. */
  const tailEntries = useMemo(
    () =>
      model.tail.map((name, tailRank) => ({
        name,
        color: showAllGenres ? tailColorFor(tailRank) : FOLD_COLOR,
      })),
    [model, showAllGenres],
  );

  const tailTipId = useId();

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

  /* ── Hover: band identity comes from the path under the cursor; the
     bucket is the nearest column to the cursor's x THAT THIS BAND ACTUALLY
     OCCUPIES. Mouse-only enrichment (the bars' precedent) — the caption
     stays the accessible reading.

     The band qualifier is P-4 (code review 2026-08-08). A band tapers to
     zero height between a bucket it holds and one it does not, so plain
     nearest-column attribution reported "July · Techno · 0% (0 plays)" while
     the cursor sat on visibly painted Techno. Identity from the path and
     bucket from proximity have to be reconciled, and the band is the one the
     DJ is demonstrably pointing at. ──────────────────────────────────────── */
  const plotRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipTargetRef = useCursorChipTarget();
  const [hover, setHover] = useState<StreamHover | null>(null);

  const bucketAtClientX = useCallback(
    (clientX: number, bandIndex: number): number | null => {
      const rect = plotRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return null;
      const u = ((clientX - rect.left) / rect.width) * VIEW.width;
      let best: number | null = null;
      let bestDist = Infinity;
      for (let i = 0; i < xs.length; i++) {
        const col = model.columns[i];
        if (col == null || (col.counts[bandIndex] ?? 0) === 0) continue;
        const d = Math.abs(xs[i] - u);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best;
    },
    [xs, model],
  );

  const onBandMove = useCallback(
    (bandIndex: number, e: React.MouseEvent) => {
      chipTargetRef.current = { x: e.clientX, y: e.clientY };
      const bucketIndex = bucketAtClientX(e.clientX, bandIndex);
      const bandName = model.bands[bandIndex]?.name;
      const bucketKey = bucketIndex == null ? undefined : buckets[bucketIndex];
      setHover(bandName == null || bucketKey == null ? null : { bandName, bucketKey });
    },
    [chipTargetRef, bucketAtClientX, model, buckets],
  );
  const clearHover = useCallback(() => setHover(null), []);

  // Resolved by IDENTITY, not by the indices the pointer saw. Hover only
  // clears on mouseleave, so a page-level toggle driven from the keyboard
  // while the cursor rests on a band rebuilds `bands`/`columns` underneath
  // it — an in-range index then silently points at a different genre and a
  // different date, which the old range check could not catch (P-4). A name
  // and a bucket key either still exist in the new model or they do not.
  const hoverDetail = useMemo(() => {
    if (hover == null) return null;
    const bandIndex = model.bands.findIndex((b) => b.name === hover.bandName);
    const bucketIndex = buckets.indexOf(hover.bucketKey);
    if (bandIndex < 0 || bucketIndex < 0) return null;
    const col = model.columns[bucketIndex];
    if (!col) return null;
    const count = col.counts[bandIndex];
    return `${bucketDetail(buckets[bucketIndex], granularity)} · ${hover.bandName} · ${pctLabel(count, col.total)} (${count} ${count === 1 ? "play" : "plays"})`;
  }, [hover, model, buckets, granularity]);

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
    <div ref={rootRef} className="se-chart se-chart-full dz-shell">
      <span className="dz-dots" aria-hidden="true" />

      <div className="se-chart-head">
        <p className="se-chart-title">Genre Mix</p>
        <p className="se-chart-subtitle">
          Share of each {granularity === "month" ? "month's" : "week's"} plays, by genre
        </p>
      </div>

      <div ref={plotRef} className="se-chart-plot" role="img" aria-label={caption}>
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
            <path
              key={r.key}
              d={r.d}
              className="se-stream-band"
              data-hot={hover?.bandName === model.bands[r.bandIndex]?.name ? true : undefined}
              fill={bandColor(r.bandIndex)}
              onMouseEnter={(e) => onBandMove(r.bandIndex, e)}
              onMouseMove={(e) => onBandMove(r.bandIndex, e)}
              onMouseLeave={clearHover}
            />
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
          taxonomy's own genre) and "Everything else" (this chart's fold)
          keep separate names AND separate swatches, the protected
          distinction — reworded 2026-08-08 because two "Other…" entries
          side by side read as a mystery. No visible caption on this card
          (Arjun, same session): `caption` still serves as the aria
          text-equivalent above and the error-boundary fallback.

          The TAIL never enters this row (Arjun, 2026-08-12). Expanded, it can
          be thirty genres — inlining them turned a one-line legend into a
          paragraph that pushed the section below it off the fold, and buried
          the six bands that carry the reading. It gets one control at the end
          of the row instead: click to expand or fold, hover for the full
          list with the shades those genres are actually drawn in. */}
      <div className="se-chart-cats">
        {namedBands.map(({ band, index }) => (
          <span key={band.name} className="se-chart-cat">
            <span className="se-chart-cat-swatch" style={{ background: bandColor(index) }} aria-hidden="true" />
            {band.name}
          </span>
        ))}

        {tailEntries.length > 0 && (
          <span className="se-chart-tail">
            <button
              type="button"
              className="se-chart-tail-btn"
              aria-pressed={showAllGenres}
              aria-describedby={tailTipId}
              onClick={onToggleAllGenres}
            >
              <span className="se-chart-tail-swatches" aria-hidden="true">
                {tailEntries.slice(0, 3).map((entry) => (
                  <span key={entry.name} className="se-chart-cat-swatch" style={{ background: entry.color }} />
                ))}
              </span>
              {showAllGenres
                ? `${tailEntries.length} shown separately`
                : `+${tailEntries.length} more ${tailEntries.length === 1 ? "genre" : "genres"}`}
            </button>

            {/* The swatch beside each name is the one that genre is drawn in
                RIGHT NOW — the fold neutral while they are still one band,
                its own shade once they are not. So the tip never promises a
                colour that isn't on the chart yet; folded, the repeated grey
                IS the honest reading ("all of these are that one band"). */}
            <span role="tooltip" id={tailTipId} className="se-chart-tail-tip">
              <span className="se-chart-tail-tip-head">
                {showAllGenres ? "Drawn separately" : "Folded into one band"}
              </span>
              <span className="se-chart-tail-list">
                {tailEntries.map((entry) => (
                  <span key={entry.name} className="se-chart-cat">
                    <span
                      className="se-chart-cat-swatch"
                      style={{ background: entry.color }}
                      aria-hidden="true"
                    />
                    {entry.name}
                  </span>
                ))}
              </span>
            </span>
          </span>
        )}

        {untaggedCount > 0 && (
          <span className="se-chart-cats-note">
            {untaggedCount} {untaggedCount === 1 ? "play" : "plays"} untagged
          </span>
        )}
      </div>

      <CursorChip
        target={chipTargetRef}
        boundsRef={rootRef}
        visible={hoverDetail != null}
        contentKey={hover != null ? `${hover.bucketKey}-${hover.bandName}` : null}
        offsetY={-44}
        compact
      >
        {hoverDetail != null && <p className="cursor-chip-mono">{hoverDetail}</p>}
      </CursorChip>
    </div>
  );
}
