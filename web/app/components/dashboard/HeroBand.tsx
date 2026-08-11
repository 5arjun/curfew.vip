import { primaryDancefloorSegment, segmentStats } from "@/lib/sets/dancefloor";
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
  // Story 5.2: the dancefloor window is fetched off the set row (`segments`
  // rows, detected agent-side against this DJ's own floors), not recomputed
  // here. Several → the longest, as the interim pick (D-24).
  const segment = primaryDancefloorSegment(set.segments);
  const floor = segmentStats(set.plays, segment);
  // Item 5 (Arjun: "dancefloor only"): the hero plots ONLY the detected
  // dancefloor window — one continuous smooth chrome line — so the warm-up /
  // wind-down playback gaps (15–35 min pauses) can't manufacture false slopes
  // across silence. No dim full-night backdrop. Falls back to the whole set
  // when detection finds no floor (rare; then there's no window to clip to).
  const floorArc = segment != null;
  const arcSource = segment
    ? set.derived.energy_arc.filter((p) => {
        const t = new Date(p.started_at).getTime();
        return t >= new Date(segment.start).getTime() && t <= new Date(segment.end).getTime();
      })
    : set.derived.energy_arc;
  // null segment → heroArcGeometry emits no band; the clipped points ARE the
  // whole line now, so there's nothing left to split dim-vs-bright.
  const geo = heroArcGeometry(arcSource, null, VIEW);
  const bpm = set.derived.bpm_distribution;

  const stats: Array<{ label: string; value: string }> = [
    { label: "Dancefloor tracks", value: `${floor.track_count}` },
    { label: "Median BPM", value: formatBpm(bpm.count > 0 ? bpm.median : null) },
    { label: "Average BPM", value: formatBpm(bpm.count > 0 ? bpm.mean : null) },
  ];

  return (
    <section className="dz-hero dz-shell" aria-label="Most recent set">
      <span className="dz-dots" aria-hidden="true" />
      <svg
        className="dz-hero-arc"
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        preserveAspectRatio="none"
        role="img"
        // D-3/AC-22: the thumbnail shares the ONE chart-summary generator,
        // aria-only — no visible caption here, thumbnail otherwise untouched.
        // Scoped to match what's actually drawn: `arcSource` is already the
        // dancefloor-only slice when a floor is detected (Item 5), so the
        // caption must read "dancefloor" too, not silently describe the
        // whole night while the pixels show only the floor window.
        aria-label={arcTextEquivalent(arcSource, floorArc ? "dancefloor" : "whole")}
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
          {/* Fade the under-fill in from its left/right ends so the dancefloor
              arc's fill doesn't hard-cut at the frame (item 5). */}
          <linearGradient id="hero-floor-soft" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--color-abyss-text)" stopOpacity="0" />
            <stop offset="0.08" stopColor="var(--color-abyss-text)" stopOpacity="1" />
            <stop offset="0.92" stopColor="var(--color-abyss-text)" stopOpacity="1" />
            <stop offset="1" stopColor="var(--color-abyss-text)" stopOpacity="0" />
          </linearGradient>
          <mask id="hero-floor-mask" maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }}>
            <rect x="0" y="0" width={VIEW.width} height={VIEW.height} fill="url(#hero-floor-soft)" />
          </mask>
        </defs>

        {geo.count >= 2 &&
          (floorArc ? (
            /* Dancefloor-only: one bright continuous chrome line + soft under-fill. */
            <>
              <g mask="url(#hero-floor-mask)">
                <path d={geo.area} className="dz-hero-fill" fill="url(#hero-floor-fill)" />
              </g>
              <path
                d={geo.path}
                className="dz-hero-line dz-hero-line--floor"
                stroke="url(#hero-glow-stroke)"
                vectorEffect="non-scaling-stroke"
                pathLength={1}
              />
            </>
          ) : (
            /* No floor detected → the honest whole-set line, dimmed (fallback). */
            <path
              d={geo.path}
              className="dz-hero-line dz-hero-line--dim"
              stroke="url(#hero-chrome)"
              vectorEffect="non-scaling-stroke"
              pathLength={1}
            />
          ))}
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
