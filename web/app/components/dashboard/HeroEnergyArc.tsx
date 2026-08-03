import { arcGeometry, arcTextEquivalent, type ArcPoint } from "@/lib/sets/energyArc";
import type { DancefloorSegment } from "@/lib/sets/dancefloor";
import type { HeroDancefloor } from "@/lib/sets/describe";

// The hero energy arc (Story 3.6 redesign) — the centerpiece visual of the
// feature set. BPM-over-time rendered LARGE and glowing: a gradient area under a
// luminous ice ridgeline, the detected dancefloor window lit at full strength
// over the dimmed full-night line, a peak marker, and its own baseline
// annotations (DOORS / PEAK WINDOW / LAST CALL). Reuses the frozen `arcGeometry`
// for the projection — this file is the VISUAL only; the geometry + text
// equivalent are unchanged data.
//
// The line/area/band live in a stretch-to-fit SVG (preserveAspectRatio="none",
// non-scaling strokes); the peak dot + axis labels are HTML positioned by
// percent, so they stay crisp and legible instead of being squashed by the
// SVG's non-uniform scale. Colour is the cool `ice` token family via
// stroke-*/fill-* utilities (never a literal or currentColor — the colour guard
// flags both). The draw-on uses pathLength="1" so it is length-independent, and
// is disabled under prefers-reduced-motion.

const VIEW = { width: 1000, height: 240, padding: 10 };

export interface HeroEnergyArcProps {
  points: ArcPoint[];
  segment: DancefloorSegment | null;
  dancefloor: HeroDancefloor | null;
  doorsLabel: string;
  lastCallLabel: string;
}

/** Parses the geometry's "x,y x,y …" string into numeric pairs. */
function parsePoints(s: string): { x: number; y: number }[] {
  if (!s) return [];
  return s
    .split(" ")
    .map((pair) => {
      const [x, y] = pair.split(",").map(Number);
      return { x, y };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

export function HeroEnergyArc({ points, segment, dancefloor, doorsLabel, lastCallLabel }: HeroEnergyArcProps) {
  const geo = arcGeometry(points, segment, VIEW);
  const label = arcTextEquivalent(points, segment);

  const full = parsePoints(geo.full);
  const hasLine = full.length >= 2;

  // Peak = the plotted point sitting highest on screen (y is inverted, so the
  // minimum y). Positioned as an HTML overlay by percent of the viewBox.
  const peak = hasLine ? full.reduce((a, b) => (b.y < a.y ? b : a)) : null;
  const pct = (v: number, span: number) => `${(v / span) * 100}%`;

  const bandLeft = geo.band ? (geo.band.x / VIEW.width) * 100 : null;
  const bandWidth = geo.band ? (geo.band.width / VIEW.width) * 100 : null;

  // Area polygon: the ridgeline dropped to the baseline at both ends.
  const areaPoints = hasLine
    ? `${full[0].x.toFixed(2)},${VIEW.height} ${geo.full} ${full[full.length - 1].x.toFixed(2)},${VIEW.height}`
    : "";

  return (
    <figure className="hero-arc" role="group" aria-label={label}>
      <svg
        className="hero-arc-svg"
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="heroArcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--color-ice)" }} stopOpacity={0.3} />
            <stop offset="55%" style={{ stopColor: "var(--color-ice)" }} stopOpacity={0.08} />
            <stop offset="100%" style={{ stopColor: "var(--color-ice)" }} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Dancefloor band wash (behind everything). */}
        {geo.band && (
          <rect
            className="fill-ice-band hero-arc-band"
            x={geo.band.x}
            y={0}
            width={geo.band.width}
            height={VIEW.height}
          />
        )}

        {/* Area fill under the full-night ridge. */}
        {hasLine && <polygon className="hero-arc-area" points={areaPoints} fill="url(#heroArcFill)" />}

        {/* No tempo data → a calm dashed baseline instead of an empty frame. */}
        {!hasLine && (
          <line
            className="stroke-ice-dim"
            x1={VIEW.padding}
            y1={VIEW.height / 2}
            x2={VIEW.width - VIEW.padding}
            y2={VIEW.height / 2}
            strokeOpacity={0.4}
            strokeWidth={2}
            strokeDasharray="3 5"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Full night — dimmed when a window is emphasised over it. */}
        {hasLine && (
          <polyline
            className="stroke-ice-dim hero-arc-line"
            points={geo.full}
            pathLength={1}
            fill="none"
            strokeOpacity={segment ? 0.55 : 1}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* The dancefloor window at full, glowing strength. */}
        {geo.window && (
          <polyline
            className="stroke-ice-bright hero-arc-line hero-arc-window"
            points={geo.window}
            pathLength={1}
            fill="none"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* HTML annotation layer — crisp regardless of the SVG's non-uniform scale. */}
      <div className="hero-arc-annotations" aria-hidden="true">
        {peak && (
          <span className="hero-arc-peak" style={{ left: pct(peak.x, VIEW.width), top: pct(peak.y, VIEW.height) }}>
            <span className="hero-arc-peak-dot" />
          </span>
        )}

        {bandLeft != null && bandWidth != null && dancefloor && (
          <span className="hero-arc-window-label" style={{ left: `${bandLeft + bandWidth / 2}%` }}>
            <span className="text-label-sm">PEAK WINDOW</span>
            <span className="hero-arc-window-time">
              {dancefloor.startLabel} – {dancefloor.endLabel} · {dancefloor.held}
            </span>
          </span>
        )}

        <span className="hero-arc-axis hero-arc-axis--start text-label-sm">
          DOORS <span className="hero-arc-axis-time">{doorsLabel}</span>
        </span>
        <span className="hero-arc-axis hero-arc-axis--end text-label-sm">
          <span className="hero-arc-axis-time">{lastCallLabel}</span> LAST CALL
        </span>
      </div>
    </figure>
  );
}
