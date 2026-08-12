"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildCamelotWheel,
  buildSummaryTiles,
  type StyleEvolutionModel,
} from "@/lib/sets/styleEvolution";
import { buildGenreColorAssignment } from "@/lib/sets/genreColor";
import { CamelotWheel } from "./CamelotWheel";
import { GenreShareStream } from "./GenreShareStream";
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
// Story 4.8 restructure: Genre and Key each gained an aggregate HERO (the
// genre share stream, the Camelot wheel) above their trend chart, and the
// insufficient-history gate moved INSIDE those two sections (G-9): the
// heroes read honestly off a single set (AC-12), so only the secondary
// trend charts — and Tempo, which has no aggregate hero — stay behind the
// <2-months gate. The `setCount === 0` early return is a separate,
// unaffected case (4.7's review caught exactly that conflation once).
//
// Granularity and the low-confidence reveal are page-level controls (4.7
// AC-2), rendered once and shared — the month/week × excluding/including
// matrix `styleEvolution.ts` precomputes up front is exactly what makes
// that a lookup, not a recompute, per section.
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

/** The gated trend slots' insufficient copy — the page-level EXPERIENCE.md
 *  line claims the whole page has nothing to show, which stopped being true
 *  the moment the heroes started rendering off one set (AC-12). Same
 *  console-voice promise register, scoped to the trends.
 *
 *  One line per section rather than one shared line (D-4, code review
 *  2026-08-08). Genre and Key used to render NOTHING in their gated slot, so
 *  a one-month DJ saw Tempo explain itself while the other two sections just
 *  stopped after their hero with no account of the missing second chart.
 *  Naming the specific trend also keeps three visible gate lines from reading
 *  as the same sentence stamped three times. */
const TREND_GATE_COPY = {
  bpm: "Sets from a second month and the trend lines draw themselves.",
  genre: "Sets from a second month and the diversity trend draws itself.",
  harmonic: "Sets from a second month and the harmonic trend draws itself.",
} as const;

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
  const harmonicSeries = useMemo(() => points.map((p) => p.harmonicMix), [points]);

  // Story 4.8 G-1 (AC-3): ONE deterministic genre→color assignment for the
  // whole page, built from month × including — the superset partition, so
  // neither the reveal (a subset) nor the granularity toggle (a re-partition
  // of the identical dated population) can recolor a genre. Consumed by the
  // share stream AND the breakdown bars.
  const genreColors = useMemo(
    () => buildGenreColorAssignment(model.month.including.map((p) => p.genreDiversity)),
    [model],
  );

  // Story 4.8 AC-8: the wheel is an AGGREGATE over the reveal-selected
  // partition. It reads the MONTH series regardless of the granularity
  // toggle — month and week partition the same dated-set population, so the
  // toggle would have nothing to act on; not wiring it is the recorded
  // decision, not an omission.
  const wheel = useMemo(
    () => buildCamelotWheel((revealed ? model.month.including : model.month.excluding).map((p) => p.keyDiversity)),
    [model, revealed],
  );

  // AC-4/AC-5: aggregate, not time-series — reads honestly off a single
  // bucket, so it does not depend on the AC-8 gate below at all.
  const tiles = useMemo(() => buildSummaryTiles(series.buckets, points), [series.buckets, points]);

  // AC-5/AC-6: plays with no genre/key are excluded from the entropy
  // calculation but their count is always disclosed alongside the chart —
  // never silently folded in or dropped (mirrors genre_breakdown's own
  // no_genre_count "never omitted" contract).
  //
  // Arjun, 2026-08-12: "remove that thing in the bottom left which shows the
  // number of untagged plays". Removed as a standing SENTENCE under the
  // section — not as a fact. AC-5/AC-6 is a never-drop contract and deleting
  // the number outright would leave the entropy quietly computed over a
  // smaller population than the DJ thinks, so it moves into the Genre Mix
  // card's own legend row as a single muted word. One line of running prose
  // becomes three characters in a row that was already there.
  const untaggedCount = useMemo(
    () => genreSeries.reduce((sum, g) => sum + (g?.no_genre_count ?? 0), 0),
    [genreSeries],
  );
  // Story 4.8 AC-10 extends the same line with the wheel's unreadable-key
  // count (keys `parseCamelot` rejects are never silently dropped into a
  // cell) — appended to the ONE existing disclosure rather than growing a
  // second, differently-worded no-key line (G-10).
  const keyDisclosure = useMemo(() => {
    const total = keySeries.reduce((sum, k) => sum + (k?.no_key_count ?? 0), 0);
    const parts: string[] = [];
    if (total > 0) parts.push(`${total} ${total === 1 ? "play" : "plays"} without a key`);
    // A PLAY count, not a count of distinct key strings (`buildCamelotWheel`
    // sums `t.count`) — so it has to be worded as plays, like the clause it
    // sits beside. "N keys unreadable" put two different units in one
    // sentence (P-2, code review 2026-08-08).
    if (wheel.unreadableCount > 0) {
      parts.push(
        `${wheel.unreadableCount} ${wheel.unreadableCount === 1 ? "play" : "plays"} with an unreadable key`,
      );
    }
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [keySeries, wheel.unreadableCount]);
  // Story 4.8 AC-10 (Task 6): transitions the harmonic rate could not score,
  // summed across the visible partition — the scope this line's own chart
  // draws, and the same scope its sibling disclosures above use.
  //
  // Deliberately NOT the tile's wording (P-1, code review 2026-08-08).
  // Reusing it verbatim was meant to stop the page saying one thing two
  // ways, but the tile reads the CURRENT bucket only (`buildSummaryTiles`)
  // while this reads every bucket, so the identical sentence rendered twice
  // on one page with different numbers and no way to tell which was which.
  // Two scopes need two sentences; "across these <buckets>" is the scope
  // word that makes this one answerable.
  const harmonicDisclosure = useMemo(() => {
    const total = harmonicSeries.reduce((sum, h) => sum + (h?.excludedNoKey ?? 0), 0);
    if (total === 0) return null;
    const span = granularity === "week" ? "weeks" : "months";
    return `${total} ${total === 1 ? "transition" : "transitions"} across these ${span} excluded — no key`;
  }, [harmonicSeries, granularity]);
  // A set with no readable start time has no bucket to sit in, so it is
  // absent from every metric here — including the wheel (G-4's caveat).
  // Said out loud once, at the page level, rather than repeated under the
  // sections.
  const undatedDisclosure =
    model.undatedCount > 0
      ? `${model.undatedCount} ${model.undatedCount === 1 ? "set has" : "sets have"} no date and can't be placed on the timeline`
      : null;

  // AC-8 (4.7) narrowed by G-9 (4.8): the gate now scopes to the TREND
  // charts only — Tempo's whole section plus the two secondary charts inside
  // Genre and Key. The heroes and the tile row render whenever there is ≥1
  // set. Still <2 months spanned, D-5, pre-exclusion.
  const sectionsReady = model.monthsSpannedAll >= 2;

  // The 0-set case stays a separate, unaffected state (4.7's review caught
  // the conflation): a DJ who has never synced anything sees the one empty
  // state, not tiles-plus-heroes acting on nothing.
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

      {/* Tempo stays wholly gated (G-9) — it has no aggregate hero. Its
          section shell still renders, so the landmark structure is stable
          across the gate (R-10: three sections, always). */}
      <section className="se-section" aria-label="Tempo">
        <h2 className="se-section-title">Tempo</h2>
        {sectionsReady ? (
          <TrendChart
            buckets={series.buckets}
            granularity={granularity}
            metric="bpm"
            bpmSeries={bpmSeries}
            genreSeries={[]}
            // Arjun, 2026-08-12 — the same call the Genre section already
            // made. The card's title, its Fastest/Slowest legend and the
            // hover chip already say everything the sentence did, and it was
            // the one line of running prose in a row of charts. The Chart
            // Summary string keeps its other two duties either way (the
            // plot's aria text-equivalent, the error-boundary fallback), so
            // nothing is lost to a screen reader.
            showCaption={false}
          />
        ) : (
          <InsufficientHistory copy={TREND_GATE_COPY.bpm} />
        )}
      </section>

      {/* Genre: stream (hero, ungated) → 2^H trend (secondary, gated) →
          untagged disclosure. Sub-charts are plain children of the ONE
          section landmark — no nested <section aria-label> (R-10). */}
      <section className="se-section" aria-label="Genre">
        <h2 className="se-section-title">Genre</h2>
        <GenreShareStream
          buckets={series.buckets}
          granularity={granularity}
          genreSeries={genreSeries}
          genreColors={genreColors}
          untaggedCount={untaggedCount}
        />
        {sectionsReady ? (
          <TrendChart
            buckets={series.buckets}
            granularity={granularity}
            metric="genre"
            bpmSeries={[]}
            genreSeries={genreSeries}
            genreColors={genreColors}
            showCaption={false}
          />
        ) : (
          <InsufficientHistory copy={TREND_GATE_COPY.genre} />
        )}
      </section>

      {/* Key: wheel (hero, ungated) beside the harmonic trend (secondary,
          gated) on desktop — the wheel is square and doesn't earn a full
          row (Arjun, 2026-08-08 walkthrough) — stacked again below 900px.
          Disclosures follow. */}
      <section className="se-section" aria-label="Key">
        <h2 className="se-section-title">Key</h2>
        <div className="se-key-row">
          <CamelotWheel wheel={wheel} />
          {sectionsReady ? (
            <TrendChart
              buckets={series.buckets}
              granularity={granularity}
              metric="harmonic"
              bpmSeries={[]}
              genreSeries={[]}
              harmonicSeries={harmonicSeries}
            />
          ) : (
            <InsufficientHistory copy={TREND_GATE_COPY.harmonic} />
          )}
        </div>
        {keyDisclosure && <p className="se-disclosure">{keyDisclosure}</p>}
        {harmonicDisclosure && <p className="se-disclosure">{harmonicDisclosure}</p>}
      </section>

      {/* Outside the gate on purpose (code review, 2026-08-07): a DJ whose
          sets are ALL undated has `monthsSpannedAll === 0`, so this line —
          the one thing that explains why every reading above is empty — must
          render regardless of the trend gate. */}
      {undatedDisclosure && <p className="se-disclosure">{undatedDisclosure}</p>}
    </>
  );
}
