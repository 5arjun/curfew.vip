import { detectDancefloor, segmentStats } from "@/lib/sets/dancefloor";
import { arcTextEquivalent } from "@/lib/sets/energyArc";
import { formatBpm, formatDayDate, formatTimeRange } from "@/lib/sets/format";
import { heroArcGeometry } from "@/lib/sets/heroArc";
import type { SetRecord } from "@/lib/sets/types";
import { MetalButton } from "@/app/components/dashboard/MetalButton";

// Hero band (D8) — chart-as-canvas: the BPM line spans the whole band as a
// molten-chrome stroke; the detected dancefloor window glows (brighter stroke
// + soft under-fill, via clipPath so the bright segment is the SAME continuous
// path) while warm-up/wind-down sit dimmed. Date + start–end above; the three
// stats float along the bottom; the liquid-metal arrow (icon mode) at the far
// right is the set-view entry. Server component — only the arrow is client.
const VIEW = { width: 1000, height: 300, padding: 18 };

export function HeroBand({ set }: { set: SetRecord }) {
  const segment = detectDancefloor(set.plays);
  const floor = segmentStats(set.plays, segment);
  const geo = heroArcGeometry(set.derived.energy_arc, segment, VIEW);
  const bpm = set.derived.bpm_distribution;

  const stats: Array<{ label: string; value: string }> = [
    { label: "Dancefloor tracks", value: `${floor.track_count}` },
    { label: "Median BPM", value: formatBpm(bpm.count > 0 ? bpm.median : null) },
    { label: "Average BPM", value: formatBpm(bpm.count > 0 ? bpm.mean : null) },
  ];

  return (
    <section className="dz-hero dz-shell" aria-label="Most recent set">
      <svg
        className="dz-hero-arc"
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={arcTextEquivalent(set.derived.energy_arc, segment)}
      >
        <defs>
          {/* Molten chrome for the dim full-night line; ice→cyan for the glowing window. */}
          <linearGradient id="hero-chrome" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--metal-abyss-back)" />
            <stop offset="0.5" stopColor="var(--metal-abyss-tint)" />
            <stop offset="1" stopColor="var(--metal-abyss-back)" />
          </linearGradient>
          <linearGradient id="hero-glow-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--color-abyss-accent)" />
            <stop offset="0.5" stopColor="var(--metal-abyss-tint)" />
            <stop offset="1" stopColor="var(--color-abyss-accent)" />
          </linearGradient>
          <linearGradient id="hero-floor-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-abyss-accent-glow)" />
            <stop offset="1" stopColor="var(--color-abyss-scrim-fade)" />
          </linearGradient>
          {geo.band && (
            <clipPath id="hero-floor-clip">
              <rect x={geo.band.x} y="0" width={geo.band.width} height={VIEW.height} />
            </clipPath>
          )}
        </defs>

        {geo.count >= 2 && (
          <>
            <path
              d={geo.path}
              className="dz-hero-line dz-hero-line--dim"
              stroke="url(#hero-chrome)"
              vectorEffect="non-scaling-stroke"
            />
            {geo.band && (
              <g clipPath="url(#hero-floor-clip)">
                <path d={geo.area} className="dz-hero-fill" fill="url(#hero-floor-fill)" />
                <path
                  d={geo.path}
                  className="dz-hero-line dz-hero-line--floor"
                  stroke="url(#hero-glow-stroke)"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
          </>
        )}
        {geo.solo && <circle cx={geo.solo.x} cy={geo.solo.y} r="5" className="dz-hero-solo" />}
      </svg>

      <div className="dz-hero-content">
        <p className="dz-hero-when">
          <span className="dz-hero-date">{formatDayDate(set.started_at)}</span>
          <span className="dz-hero-time">{formatTimeRange(set.started_at, set.ended_at)}</span>
        </p>

        <dl className="dz-hero-stats">
          {stats.map((s) => (
            <div key={s.label} className="dz-hero-stat">
              <dd>{s.value}</dd>
              <dt>{s.label}</dt>
            </div>
          ))}
        </dl>

        <div className="dz-hero-enter">
          <MetalButton mode="icon" label="Enter the set" href={`/set/${set.external_id}`} />
        </div>
      </div>
    </section>
  );
}
