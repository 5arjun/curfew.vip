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
  //
  // `pendingCohortCount` is pinned to 0 (Arjun, 2026-08-12: remove "1 recent
  // month is still inside the 60-day window — not counted here"). AC-7/D-10 is
  // that the exclusion is never SILENT, and it is not: the chart's own
  // explainer button says it in full, on the chart, in the same breath as the
  // thing it explains — "The most recent months are missing on purpose — they
  // haven't had their full N days yet." The retired line was that sentence a
  // second time, in smaller type, below the chart. The no-add-date clause is a
  // different fact with no such second home, so it still renders.
  const disclosure = useMemo(
    () => undatedDisclosure({ noAddDateCount: library.noAddDateCount, pendingCohortCount: 0 }, window),
    [library, window],
  );

  return (
    // `role="group"` + `<h3>`, matching `ConversionRateMeter` and every Story
    // 4.9 module. This was the one module on the page with no heading and no
    // accessible name at all — a bare `<div>` — so R-10's outline fix was
    // complete everywhere except the module that sits directly beside the one
    // it was written for.
    <div className="lu-conversion-cell lu-trend" role="group" aria-label="Conversion trend">
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
          // Arjun, 2026-08-12 — the "1 of the 1 tracks added in April 2026 made
          // it into a set within 60 days (100%) — up from 0% in January 2025"
          // line. It read the two endpoints of a curve the DJ is looking at,
          // and on a thin library it stated a 100% built from one track as
          // though it were a trend. The hover chip gives the same counts per
          // month, on demand and without the false confidence. Same call the
          // Tempo and Genre charts already made; the Chart Summary string keeps
          // its aria and error-fallback duties.
          showCaption={false}
        />
      )}
      {disclosure && <p className="se-disclosure">{disclosure}</p>}
    </div>
  );
}
