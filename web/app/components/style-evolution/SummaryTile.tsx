import { tileBucketLabel, type Granularity, type SummaryTiles, type TileReading } from "@/lib/sets/styleEvolution";

// Summary tile row (Story 4.7, AC-4/AC-5/AC-8/AC-9) — four aggregate
// readings above the sections: median BPM, effective genre count, harmonic
// mix rate, mix pace. Aggregate rather than time-series, so — unlike the
// trend sections below them — they render whenever there is at least one
// set, independent of the page's insufficient-history gate (AC-8).
//
// No existing "stat tile with a delta" component exists in this codebase to
// reuse (`ConfidenceTile`/`OdometerCard` are numeral-only, no delta) — this
// follows their shared `dz-shell`/`dz-dots` tile-shell convention for visual
// consistency with the dashboard's stat-tile language, but is new markup.
//
// AC-9: the section's `aria-label` carries the WHOLE sentence (value + delta
// + what the delta is against) as one string — the same "section aria-label,
// visible content aria-hidden" split `ConversionRateMeter`'s readout already
// uses, so a screen reader hears one coherent statement rather than
// reconstructing it from three separate nodes in whatever order it visits
// them.

/** `+4` / `−3` / `+0.3` — a signed, fixed-precision delta string. Never
 *  called when `delta` is `null` (AC-5: no delta markup at all, not a
 *  fabricated `-`). */
function signed(delta: number, decimals: number): string {
  const rounded = Math.abs(delta) < 10 ** -decimals / 2 ? 0 : delta;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  return `${sign}${Math.abs(rounded).toFixed(decimals)}`;
}

function mmss(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${`${rem}`.padStart(2, "0")}`;
}

/**
 * What the delta is measured against, NAMED — "June", "week of Jun 22".
 *
 * This used to be a flat `"previous month"`/`"previous week"` (code review,
 * 2026-08-07): `latestWithDelta` skips D-8 gaps when picking the comparison
 * bucket, so on the committed fixture three of the four tiles compare August
 * against JUNE while claiming "previous month", and at week granularity the
 * median-BPM tile spans five weeks. AC-9 requires the tile to state what the
 * delta is against; naming the bucket is the only version of that which is
 * true whether or not a gap was skipped.
 *
 * The year is carried only when the two buckets straddle one — the same
 * "disambiguate, don't decorate" rule `spansMultipleYears` applies to the
 * axis, scoped here to the one comparison actually being made.
 */
function comparisonLabel(reading: TileReading, granularity: Granularity): string | null {
  if (reading.deltaBucket == null) return null;
  const withYear = reading.deltaBucket.slice(0, 4) !== reading.currentBucket.slice(0, 4);
  return tileBucketLabel(reading.deltaBucket, granularity, withYear);
}

interface TileSpec {
  key: string;
  label: string;
  /** The visible/aria value string, e.g. "126 BPM". */
  valueText: string;
  /** The visible/aria delta string, e.g. "+4 BPM" — `null` renders no delta
   *  markup at all (AC-5). */
  deltaText: string | null;
  /** The named bucket `deltaText` is measured against — `null` exactly when
   *  `deltaText` is. */
  comparison: string | null;
  /** An always-visible disclosure line under the tile (AC-6/AC-7's "never
   *  omitted" counts) — `null` when there is nothing to disclose. */
  hint: string | null;
}

function tileSpec(
  key: string,
  label: string,
  reading: TileReading | null,
  granularity: Granularity,
  fmt: (v: number) => string,
  deltaFmt: (d: number) => string,
  hint: string | null,
): TileSpec {
  if (!reading) return { key, label, valueText: "-", deltaText: null, comparison: null, hint };
  return {
    key,
    label,
    valueText: fmt(reading.current),
    deltaText: reading.delta == null ? null : deltaFmt(reading.delta),
    comparison: comparisonLabel(reading, granularity),
    hint,
  };
}

function SummaryTile({ label, valueText, deltaText, comparison, hint }: Omit<TileSpec, "key">) {
  const ariaLabel =
    deltaText && comparison
      ? `${label}: ${valueText}, ${deltaText} from ${comparison}${hint ? `. ${hint}` : ""}`
      : `${label}: ${valueText}${hint ? `. ${hint}` : ""}`;

  return (
    <section className="se-tile dz-shell" aria-label={ariaLabel}>
      <span className="dz-dots" aria-hidden="true" />
      <p className="se-tile-label" aria-hidden="true">
        {label}
      </p>
      <p className="se-tile-value" aria-hidden="true">
        {valueText}
      </p>
      {/* AC-5: no delta markup at all when there is nothing to compare
          against — never an empty string, never a "-" that would read as a
          real measured flatline. */}
      {deltaText && comparison && (
        <p className="se-tile-delta" aria-hidden="true">
          {deltaText} vs {comparison}
        </p>
      )}
      {hint && (
        <p className="se-tile-hint" aria-hidden="true">
          {hint}
        </p>
      )}
    </section>
  );
}

export function SummaryTileRow({ tiles, granularity }: { tiles: SummaryTiles; granularity: Granularity }) {
  const specs: TileSpec[] = [
    tileSpec(
      "bpm",
      "Median BPM",
      tiles.medianBpm,
      granularity,
      (v) => `${Math.round(v)} BPM`,
      (d) => `${signed(d, 0)} BPM`,
      null,
    ),
    tileSpec(
      "genre",
      "Effective genres",
      tiles.effectiveGenreCount,
      granularity,
      (v) => v.toFixed(1),
      (d) => signed(d, 1),
      null,
    ),
    tileSpec(
      "harmonic",
      "Harmonic mix rate",
      tiles.harmonicMixRate,
      granularity,
      (v) => `${Math.round(v * 100)}%`,
      (d) => `${signed(d * 100, 0)}pp`,
      tiles.harmonicExcludedNoKey > 0
        ? `${tiles.harmonicExcludedNoKey} ${tiles.harmonicExcludedNoKey === 1 ? "transition" : "transitions"} excluded · no key`
        : null,
    ),
    tileSpec(
      "pace",
      "Mix pace",
      tiles.mixPace,
      granularity,
      (v) => `${mmss(v)} / track`,
      (d) => `${signed(d, 0)}s`,
      tiles.mixPaceExcludedCount > 0
        ? `${tiles.mixPaceExcludedCount} ${tiles.mixPaceExcludedCount === 1 ? "play" : "plays"} excluded · no duration`
        : null,
    ),
  ];

  return (
    <div className="se-tiles">
      {specs.map(({ key, ...spec }) => (
        <SummaryTile key={key} {...spec} />
      ))}
    </div>
  );
}
