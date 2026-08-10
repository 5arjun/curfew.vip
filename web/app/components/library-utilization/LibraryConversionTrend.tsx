"use client";

import { useMemo } from "react";
import {
  hasEnoughCohorts,
  undatedDisclosure,
  type ConversionWindow,
  type LibraryConversionModel,
} from "@/lib/sets/libraryConversion";
import { InsufficientHistory, libraryInsufficientCopy } from "@/app/components/style-evolution/InsufficientHistory";
import { TrendChart } from "@/app/components/style-evolution/TrendChart";

/**
 * The library-to-setlist correlation trend (Story 4.2, FR-10) — moved here
 * from Style Evolution (Story 4.7, AC-3: "the library/digging metric MOVES
 * to `/library-utilization`"). Reuses `buildLibraryConversion`'s output
 * unchanged (no recomputation) and reuses `TrendChart`'s existing
 * `metric="library"` path wholesale, exactly as `StyleEvolutionView` did —
 * only the surrounding page moved, not the chart or the model.
 *
 * `window` is a controlled prop, not owned here: `LibraryUtilizationView`
 * holds the ONE selection this trend shares with `ConversionRateMeter`
 * (AC-3 — "the trend and the meter visibly share one window selection").
 */
export function LibraryConversionTrend({
  library,
  window,
}: {
  library: LibraryConversionModel;
  window: ConversionWindow;
}) {
  const cohorts = library.windows[window].cohorts;
  const buckets = useMemo(() => cohorts.map((c) => c.bucket), [cohorts]);
  const series = useMemo<Array<number | null>>(() => cohorts.map((c) => c.rate), [cohorts]);

  // AC-7/D-10: tracks with no resolvable add-date, and cohorts still inside
  // their window, are excluded from the math — and always said out loud.
  const disclosure = useMemo(
    () =>
      undatedDisclosure(
        { noAddDateCount: library.noAddDateCount, pendingCohortCount: library.windows[window].pendingCohortCount },
        window,
      ),
    [library, window],
  );

  return (
    // `role="group"` + `<h3>`, matching `ConversionRateMeter` and every Story
    // 4.9 module. This was the one module on the page with no heading and no
    // accessible name at all — a bare `<div>` — so R-10's outline fix was
    // complete everywhere except the module that sits directly beside the one
    // it was written for.
    <div className="lu-trend" role="group" aria-label="Conversion trend">
      <h3 className="lu-stat-label">Conversion trend</h3>
      {!hasEnoughCohorts(library, window) ? (
        <InsufficientHistory copy={libraryInsufficientCopy(window)} />
      ) : (
        <TrendChart
          buckets={buckets}
          granularity="month"
          metric="library"
          bpmSeries={[]}
          genreSeries={[]}
          librarySeries={series}
          libraryModel={library}
          conversionWindow={window}
        />
      )}
      {disclosure && <p className="se-disclosure">{disclosure}</p>}
    </div>
  );
}
