"use client";

import { useMemo, useState } from "react";
import {
  hasEnoughCohorts,
  undatedDisclosure,
  type LibraryConversionModel,
} from "@/lib/sets/libraryConversion";
import type { StyleEvolutionModel } from "@/lib/sets/styleEvolution";
import { ConversionWindowToggle, useConversionWindowSelection } from "./ConversionWindowToggle";
import { GranularityToggle, useGranularitySelection } from "./GranularityToggle";
import { InsufficientHistory, LIBRARY_INSUFFICIENT_COPY } from "./InsufficientHistory";
import { LowConfidenceReveal } from "./LowConfidenceReveal";
import { MetricChipToggle, useMetricSelection } from "./MetricChipToggle";
import { TrendChart } from "./TrendChart";

// The client sub-component the server page delegates interactivity to
// (Task 7) — mirrors the dashboard's server-page/client-sub-component split
// (`dashboard/page.tsx` → `AgentStatusBanner`/`ConfidenceTile`, etc.). Owns
// the chip selection (persisted, D-6), the granularity toggle (persisted,
// added post-launch-review), and the reveal toggle (unpersisted, D-4); the
// month/week × excluding/including series all already live on `model`
// (styleEvolution.ts computed every combination up front), so switching any
// of the three controls is just picking a different precomputed array — no
// work happens on click.
export function StyleEvolutionView({
  model,
  library,
}: {
  model: StyleEvolutionModel;
  /** Story 4.2 (FR-10): the library-conversion cohorts, computed server-side
   *  by the same page (`buildLibraryConversion`) — a separate model because it
   *  is a separate x-axis (months tracks were ADDED, not played). */
  library: LibraryConversionModel;
}) {
  const [metric, setMetric] = useMetricSelection();
  const [granularity, setGranularity] = useGranularitySelection();
  const [conversionWindow, setConversionWindow] = useConversionWindowSelection();
  const [revealed, setRevealed] = useState(false);

  // Story 4.2: the library metric is month-cohort-only and has no confidence
  // dimension — an add-event is not a set, so neither the week/month toggle
  // nor the low-confidence reveal has anything to act on. Both are hidden
  // rather than disabled: a control that is present but inert is worse than
  // one that isn't there.
  const isLibrary = metric === "library";

  const series = model[granularity];
  const points = revealed ? series.including : series.excluding;
  const bpmSeries = useMemo(() => points.map((p) => p.bpmRange), [points]);
  const genreSeries = useMemo(() => points.map((p) => p.genreDiversity), [points]);
  const keySeries = useMemo(() => points.map((p) => p.keyDiversity), [points]);

  // Story 4.2: this metric's own x-axis. Passed as `buckets` when it is the
  // selected metric, so `TrendChart` needs no notion of two axes — only one
  // metric is ever rendered at a time.
  //
  // D-13: every window is already computed on `library`, so switching the
  // toggle is a lookup, not a recompute — the same "no work happens on click"
  // discipline the month/week × excluding/including matrix follows above. Note
  // the x-axis itself changes with the window: a shorter window completes more
  // cohorts (D-9), so the line grows to the right rather than just moving down.
  const libraryCohorts = library.windows[conversionWindow].cohorts;
  const libraryBuckets = useMemo(() => libraryCohorts.map((c) => c.bucket), [libraryCohorts]);
  const librarySeries = useMemo<Array<number | null>>(
    () => libraryCohorts.map((c) => c.rate),
    [libraryCohorts],
  );

  // AC-5/AC-6: plays with no genre/key are excluded from the entropy
  // calculation but their count is always disclosed alongside the chart —
  // never silently folded in or dropped (mirrors genre_breakdown's own
  // no_genre_count "never omitted" contract).
  const disclosure = useMemo(() => {
    const parts: string[] = [];
    if (metric === "genre") {
      const total = genreSeries.reduce((sum, g) => sum + (g?.no_genre_count ?? 0), 0);
      if (total > 0) parts.push(`${total} ${total === 1 ? "play" : "plays"} untagged`);
    }
    if (metric === "key") {
      const total = keySeries.reduce((sum, k) => sum + (k?.no_key_count ?? 0), 0);
      if (total > 0) parts.push(`${total} ${total === 1 ? "play" : "plays"} without a key`);
    }
    // A set with no readable start time has no bucket to sit in, so it is
    // absent from every metric here. Say so rather than let it vanish — the
    // same "never silently dropped" contract the two counts above hold to.
    if (model.undatedCount > 0) {
      parts.push(
        `${model.undatedCount} ${model.undatedCount === 1 ? "set has" : "sets have"} no date and can't be placed on the timeline`,
      );
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [metric, genreSeries, keySeries, model.undatedCount]);

  // AC-7/D-10: tracks with no resolvable add-date, and cohorts still inside
  // their 90-day window, are excluded from the math — and always said out
  // loud. Its own generator, not folded into `disclosure` above, because the
  // two describe different exclusions on different axes.
  const libraryDisclosure = useMemo(
    () =>
      undatedDisclosure(
        {
          noAddDateCount: library.noAddDateCount,
          pendingCohortCount: library.windows[conversionWindow].pendingCohortCount,
        },
        conversionWindow,
      ),
    [library, conversionWindow],
  );

  return (
    <>
      <div className="se-controls">
        <MetricChipToggle value={metric} onChange={setMetric} />
        {isLibrary ? (
          // Same slot, same visual language: this metric has month-only
          // cohorts and no confidence dimension, so the week/month toggle and
          // the low-confidence reveal have nothing to act on — the window
          // toggle takes their place rather than sitting alongside them.
          <div className="se-controls-right">
            <ConversionWindowToggle value={conversionWindow} onChange={setConversionWindow} />
          </div>
        ) : (
          <div className="se-controls-right">
            <GranularityToggle value={granularity} onChange={setGranularity} />
            <LowConfidenceReveal
              hiddenCount={model.lowConfidenceCount}
              revealed={revealed}
              onReveal={() => setRevealed(true)}
              onHide={() => setRevealed(false)}
            />
          </div>
        )}
      </div>

      {isLibrary && !hasEnoughCohorts(library, conversionWindow) ? (
        <InsufficientHistory copy={LIBRARY_INSUFFICIENT_COPY} />
      ) : (
        <TrendChart
          buckets={isLibrary ? libraryBuckets : series.buckets}
          granularity={isLibrary ? "month" : granularity}
          metric={metric}
          bpmSeries={bpmSeries}
          genreSeries={genreSeries}
          keySeries={keySeries}
          librarySeries={librarySeries}
          libraryModel={library}
          conversionWindow={conversionWindow}
        />
      )}

      {isLibrary
        ? libraryDisclosure && <p className="se-disclosure">{libraryDisclosure}</p>
        : disclosure && <p className="se-disclosure">{disclosure}</p>}
    </>
  );
}
