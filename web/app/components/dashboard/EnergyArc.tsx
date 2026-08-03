import { arcGeometry, arcTextEquivalent, type ArcPoint } from "@/lib/sets/energyArc";
import type { DancefloorSegment } from "@/lib/sets/dancefloor";

// Reusable energy-arc thumbnail (Story 3.6, cool-direction redesign). BPM-over-
// time as a hairline sparkline for the archive cards: an ice stroke with a soft
// glow, the detected dancefloor window drawn at full strength over the dimmed
// full-night line. `mode` is kept in the API so Story 3.8 can render the SAME
// geometry in a full annotated chart; the large hero chart is HeroEnergyArc.
//
// Colour comes from the cool `ice` token family via stroke-*/fill-* utilities
// (the @theme alias of --color-ice*), never a literal or currentColor — both of
// which no-hardcoded-colors.test.ts flags. Static by default (no draw-on) to
// keep the archive calm; the glow is a CSS filter reading a token.

export interface EnergyArcProps {
  points: ArcPoint[];
  segment?: DancefloorSegment | null;
  mode?: "thumbnail" | "full";
  className?: string;
}

const VIEW = { width: 100, height: 32, padding: 3 };

export function EnergyArc({ points, segment = null, mode = "thumbnail", className }: EnergyArcProps) {
  const geo = arcGeometry(points, segment, VIEW);
  const label = arcTextEquivalent(points, segment);

  return (
    <svg
      viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      data-mode={mode}
      className={["energy-arc", className].filter(Boolean).join(" ")}
      style={{ width: "100%", display: "block" }}
    >
      {/* Faint band behind the dancefloor window. */}
      {geo.band && (
        <rect className="fill-ice-band" x={geo.band.x} y={0} width={geo.band.width} height={VIEW.height} />
      )}

      {/* Degenerate cases: no tempo data → a dim dashed baseline; one play → a dot. */}
      {geo.count === 0 && (
        <line
          className="stroke-ice-dim"
          x1={VIEW.padding}
          y1={VIEW.height / 2}
          x2={VIEW.width - VIEW.padding}
          y2={VIEW.height / 2}
          strokeOpacity={0.5}
          strokeWidth={2}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
        />
      )}
      {geo.soloPoint && (
        <circle className="fill-ice" cx={geo.soloPoint.x} cy={geo.soloPoint.y} r={2.5} />
      )}

      {/* Full night, dimmed when a dancefloor window is emphasised over it. */}
      {geo.full && (
        <polyline
          className={segment ? "stroke-ice-dim" : "stroke-ice energy-arc-glow"}
          points={geo.full}
          fill="none"
          strokeOpacity={segment ? 0.7 : 0.95}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* The dancefloor window, at full strength with a glow. */}
      {geo.window && (
        <polyline
          className="stroke-ice-bright energy-arc-glow"
          points={geo.window}
          fill="none"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
