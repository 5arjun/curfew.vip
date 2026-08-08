"use client";

import { useEffect, useMemo, useState } from "react";
import { buildSummaryTiles, type StyleEvolutionModel } from "@/lib/sets/styleEvolution";
import { GranularityToggle, useGranularitySelection } from "./GranularityToggle";
import { InsufficientHistory } from "./InsufficientHistory";
import { LowConfidenceReveal } from "./LowConfidenceReveal";
import { SummaryTileRow } from "./SummaryTile";
import { TrendChart } from "./TrendChart";

// The client sub-component the server page delegates interactivity to
// (Task 7, Story 4.1) — mirrors the dashboard's server-page/client-component
// split.
//
// Story 4.7 restructure: the four metrics Story 4.1 multiplexed behind
// `MetricChipToggle` into ONE chart slot now render as three ALWAYS-VISIBLE
// stacked sections (AC-1) — the chip is retired outright, not left present
// but inert. The library/digging metric (Story 4.2) is not one of the three:
// AC-3 moved it to `/library-utilization`, so this component no longer
// carries a `library` prop or an `isLibrary` branch at all.
//
// Granularity and the low-confidence reveal are now page-level controls
// (AC-2), rendered once and shared by all three sections — the month/week ×
// excluding/including matrix `styleEvolution.ts` precomputes up front is
// exactly what makes that a lookup, not a recompute, per section.
// Task 6 (AC-2): the retired chip toggle's persisted key is now dead state —
// a returning DJ's browser would otherwise carry it forever. Cleaned up once
// per mount, never thrown from (private browsing / storage disabled) — this
// is a one-time removal, not a new persisted concept, so it does not follow
// the useSyncExternalStore pattern the live toggles use.
const RETIRED_METRIC_STORAGE_KEY = "curfew:style-evolution:metric";
/** The other window-scale toggle Story 4.7's AC-3 reconciliation retired
 *  (`ConversionWindowToggle.tsx`, formerly this page's own 90/60/30 control,
 *  now unified with `/library-utilization`'s shared selection). */
const RETIRED_CONVERSION_WINDOW_STORAGE_KEY = "curfew:style-evolution:conversion-window";

export function StyleEvolutionView({ model }: { model: StyleEvolutionModel }) {
  const [granularity, setGranularity] = useGranularitySelection();
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.removeItem(RETIRED_METRIC_STORAGE_KEY);
      window.localStorage.removeItem(RETIRED_CONVERSION_WINDOW_STORAGE_KEY);
    } catch {
      // Storage unavailable — nothing to clean up, nothing to throw over.
    }
  }, []);

  const series = model[granularity];
  const points = revealed ? series.including : series.excluding;
  const bpmSeries = useMemo(() => points.map((p) => p.bpmRange), [points]);
  const genreSeries = useMemo(() => points.map((p) => p.genreDiversity), [points]);
  const keySeries = useMemo(() => points.map((p) => p.keyDiversity), [points]);

  // AC-4/AC-5: aggregate, not time-series — reads honestly off a single
  // bucket, so it does not depend on the AC-8 gate below at all.
  const tiles = useMemo(() => buildSummaryTiles(series.buckets, points), [series.buckets, points]);

  // AC-5/AC-6: plays with no genre/key are excluded from the entropy
  // calculation but their count is always disclosed alongside the chart —
  // never silently folded in or dropped (mirrors genre_breakdown's own
  // no_genre_count "never omitted" contract).
  const genreDisclosure = useMemo(() => {
    const total = genreSeries.reduce((sum, g) => sum + (g?.no_genre_count ?? 0), 0);
    return total > 0 ? `${total} ${total === 1 ? "play" : "plays"} untagged` : null;
  }, [genreSeries]);
  const keyDisclosure = useMemo(() => {
    const total = keySeries.reduce((sum, k) => sum + (k?.no_key_count ?? 0), 0);
    return total > 0 ? `${total} ${total === 1 ? "play" : "plays"} without a key` : null;
  }, [keySeries]);
  // A set with no readable start time has no bucket to sit in, so it is
  // absent from every metric here. Said out loud once, at the page level,
  // rather than repeated identically under all three sections.
  const undatedDisclosure =
    model.undatedCount > 0
      ? `${model.undatedCount} ${model.undatedCount === 1 ? "set has" : "sets have"} no date and can't be placed on the timeline`
      : null;

  // AC-8: the trend SECTIONS gate on <2 months spanned (D-5, pre-exclusion);
  // the tile row above never does — it is aggregate and reads honestly off
  // one set, which is the whole reason it renders outside this gate.
  const sectionsReady = model.monthsSpannedAll >= 2;

  // AC-8 narrows the gate for a DJ with "≥1 set but <2 months" — it does NOT
  // touch the 0-set case, which is a separate, unaffected state (the story's
  // own Dev Notes say so explicitly). Without this branch the tile row still
  // rendered for a DJ who has never synced anything: four "—" placeholders
  // and a granularity toggle acting on nothing, above the empty state. Found
  // at code review, 2026-08-07.
  if (model.setCount === 0) return <InsufficientHistory />;

  return (
    <>
      <SummaryTileRow tiles={tiles} granularity={granularity} />

      <div className="se-controls">
        <GranularityToggle value={granularity} onChange={setGranularity} />
        <LowConfidenceReveal
          hiddenCount={model.lowConfidenceCount}
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onHide={() => setRevealed(false)}
        />
      </div>

      {sectionsReady ? (
        <>
          <section className="se-section" aria-label="Tempo">
            <h2 className="se-section-title">Tempo</h2>
            <TrendChart
              buckets={series.buckets}
              granularity={granularity}
              metric="bpm"
              bpmSeries={bpmSeries}
              genreSeries={[]}
              keySeries={[]}
            />
          </section>

          <section className="se-section" aria-label="Genre">
            <h2 className="se-section-title">Genre</h2>
            <TrendChart
              buckets={series.buckets}
              granularity={granularity}
              metric="genre"
              bpmSeries={[]}
              genreSeries={genreSeries}
              keySeries={[]}
            />
            {genreDisclosure && <p className="se-disclosure">{genreDisclosure}</p>}
          </section>

          <section className="se-section" aria-label="Key">
            <h2 className="se-section-title">Key</h2>
            <TrendChart
              buckets={series.buckets}
              granularity={granularity}
              metric="key"
              bpmSeries={[]}
              genreSeries={[]}
              keySeries={keySeries}
            />
            {keyDisclosure && <p className="se-disclosure">{keyDisclosure}</p>}
          </section>
        </>
      ) : (
        <InsufficientHistory />
      )}

      {/* Outside the gate on purpose (code review, 2026-08-07): a DJ whose
          sets are ALL undated has `monthsSpannedAll === 0`, so this line —
          the one thing that explains why every reading above is empty — was
          the only branch that could say so, and it sat inside the branch that
          never renders in that case. */}
      {undatedDisclosure && <p className="se-disclosure">{undatedDisclosure}</p>}
    </>
  );
}
