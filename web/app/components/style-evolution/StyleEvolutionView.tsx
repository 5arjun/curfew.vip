"use client";

import { useMemo, useState } from "react";
import type { StyleEvolutionModel } from "@/lib/sets/styleEvolution";
import { GranularityToggle, useGranularitySelection } from "./GranularityToggle";
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
export function StyleEvolutionView({ model }: { model: StyleEvolutionModel }) {
  const [metric, setMetric] = useMetricSelection();
  const [granularity, setGranularity] = useGranularitySelection();
  const [revealed, setRevealed] = useState(false);

  const series = model[granularity];
  const points = revealed ? series.including : series.excluding;
  const bpmSeries = useMemo(() => points.map((p) => p.bpmRange), [points]);
  const genreSeries = useMemo(() => points.map((p) => p.genreDiversity), [points]);
  const keySeries = useMemo(() => points.map((p) => p.keyDiversity), [points]);

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

  return (
    <>
      <div className="se-controls">
        <MetricChipToggle value={metric} onChange={setMetric} />
        <div className="se-controls-right">
          <GranularityToggle value={granularity} onChange={setGranularity} />
          <LowConfidenceReveal
            hiddenCount={model.lowConfidenceCount}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
            onHide={() => setRevealed(false)}
          />
        </div>
      </div>

      <TrendChart
        buckets={series.buckets}
        granularity={granularity}
        metric={metric}
        bpmSeries={bpmSeries}
        genreSeries={genreSeries}
        keySeries={keySeries}
      />

      {disclosure && <p className="se-disclosure">{disclosure}</p>}
    </>
  );
}
