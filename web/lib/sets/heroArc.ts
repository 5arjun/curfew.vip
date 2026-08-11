// Hero-arc geometry (Story 3.6 v2 D8; upgraded in place by Story 3.8): the
// dancefloor-highlighted BPM arc the dashboard hero AND the Set Detail full
// chart both render. Pure + testable, same discipline as energyArc.ts — only
// plays carrying both a timestamp and a BPM are plotted (AD-11), nothing
// fabricated. The line is the monotone cubic from energyArc.ts (3.8 D-8 —
// smooth but it never overshoots the data, unlike the old Catmull-Rom); the
// thumbnail inherits the same curve. The dancefloor window is NOT a separate
// path — the component clips the same path to the band rect, which keeps the
// bright and dim strokes perfectly continuous.
//
// 3.8 additions: the smoothed curve points and the x/y projections are exposed
// so the full chart's HTML annotation overlay (D-18) and key strip share this
// exact domain math; the band comes from the segment's TIME BOUNDS, not play
// overlap (the D-4 fix — a window with no BPM-carrying plays must still band
// honestly instead of silently un-zooming).
import type { SegmentBounds } from "./dancefloor";
import { createMonotoneYAt, monotonePath, type ArcPoint } from "./energyArc";

export interface HeroArcView {
  width: number;
  height: number;
  /** Inner padding so strokes/glow never clip at the frame. */
  padding: number;
}

export interface HeroArcGeometry {
  /** Monotone cubic SVG path of the whole night ("" when count < 2). */
  path: string;
  /** The same path closed down to the bottom edge — the under-line fill the component clips to the band. */
  area: string;
  /** Dancefloor band as viewBox x/width from the segment's TIME bounds (D-4), or null. */
  band: { x: number; width: number } | null;
  /** Plotted point count (0/1 are the degenerate cases). */
  count: number;
  /** Center point when exactly one play is plotted (dot fallback). */
  solo: { x: number; y: number } | null;
  /** The smoothed points actually drawn, with their epoch-ms times and
   * smoothed BPM (3.8 overlay anchors + the cursor time/BPM readout). */
  curve: Array<{ t: number; x: number; y: number; bpm: number }>;
  /** Epoch-ms → viewBox x, over the plotted domain (extrapolates linearly outside it). */
  mapX: (t: number) => number;
  /** BPM → viewBox y (inverted: higher BPM sits higher). */
  mapY: (bpm: number) => number;
  /** The DRAWN cubic's y at viewBox x — exactly on the line, end-clamped
   * (the cursor ball's anchor; shares monotonePath's tangents). */
  yAtX: (x: number) => number;
  /** viewBox x → epoch-ms (mapX's inverse — the time axis is linear). */
  timeAtX: (x: number) => number;
  /** viewBox y → BPM (mapY's inverse — the cursor readout's value). */
  bpmAtY: (y: number) => number;
  /** Plotted time domain (epoch ms) — the smoothed series' bounds; 0/0 when count < 2. */
  tMin: number;
  tMax: number;
}

const EPOCH = (iso: string) => new Date(iso).getTime();

/** Rolling-median half-window (± tracks) that tames per-track BPM outliers. */
const SMOOTH_HALF_WINDOW = 2;
/** Cap on emitted points — enough for an expressive line, few enough to flow. */
const MAX_POINTS = 72;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The hero line is a TREND of the night, not a per-track scatter: raw
 * track-to-track BPM jumps (doubled/halved tags, one ambient cut) read as a
 * seismograph at hero scale. A rolling median over ±SMOOTH_HALF_WINDOW
 * neighbours keeps the real ramps while killing single-track spikes, then the
 * series is bucket-averaged down to ≤ MAX_POINTS. Timestamps are preserved
 * (bucket-mean), so the dancefloor band still lands on the true clock.
 */
function smoothPoints(points: ArcPoint[]): Array<{ t: number; bpm: number }> {
  const raw = points.map((p) => ({ t: EPOCH(p.started_at), bpm: p.bpm }));
  const smoothed = raw.map((p, i) => {
    const from = Math.max(0, i - SMOOTH_HALF_WINDOW);
    const to = Math.min(raw.length - 1, i + SMOOTH_HALF_WINDOW);
    return { t: p.t, bpm: median(raw.slice(from, to + 1).map((q) => q.bpm)) };
  });
  if (smoothed.length <= MAX_POINTS) return smoothed;
  const bucketSize = smoothed.length / MAX_POINTS;
  const out: Array<{ t: number; bpm: number }> = [];
  for (let b = 0; b < MAX_POINTS; b++) {
    const slice = smoothed.slice(Math.floor(b * bucketSize), Math.floor((b + 1) * bucketSize));
    if (slice.length === 0) continue;
    out.push({
      t: slice.reduce((s, p) => s + p.t, 0) / slice.length,
      bpm: slice.reduce((s, p) => s + p.bpm, 0) / slice.length,
    });
  }
  return out;
}

export function heroArcGeometry(
  points: ArcPoint[],
  segment: SegmentBounds | null,
  view: HeroArcView,
): HeroArcGeometry {
  const { width, height, padding } = view;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const empty = {
    path: "",
    area: "",
    band: null,
    solo: null,
    curve: [],
    mapX: () => 0,
    mapY: () => 0,
    yAtX: () => 0,
    timeAtX: () => 0,
    bpmAtY: () => 0,
    tMin: 0,
    tMax: 0,
  };

  if (points.length === 0) {
    return { ...empty, count: 0 };
  }

  if (points.length === 1) {
    return {
      ...empty,
      count: 1,
      solo: { x: padding + innerW / 2, y: padding + innerH / 2 },
    };
  }

  const smooth = smoothPoints(points);
  const times = smooth.map((p) => p.t);
  const bpms = smooth.map((p) => p.bpm);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const bMin = Math.min(...bpms);
  const bMax = Math.max(...bpms);
  const tSpan = tMax - tMin || 1;
  const bSpan = bMax - bMin || 1;

  const x = (t: number) => padding + ((t - tMin) / tSpan) * innerW;
  const y = (b: number) => padding + (1 - (b - bMin) / bSpan) * innerH;

  const curve = smooth.map((p) => ({ t: p.t, x: x(p.t), y: y(p.bpm), bpm: p.bpm }));
  const path = monotonePath(curve);
  const last = curve[curve.length - 1];
  const first = curve[0];
  const area = `${path} L ${last.x.toFixed(2)} ${height} L ${first.x.toFixed(2)} ${height} Z`;

  // D-4: the band is the segment's TIME bounds projected into x — independent
  // of whether any plotted play falls inside it. (Whether the scoped window
  // has enough points to draw is the COMPONENT's honesty check, not a reason
  // to silently drop the band and un-zoom the "Dancefloor" scope.) The
  // segment can still extend past the plotted BPM-carrying points' domain
  // (detection runs over all plays, not just BPM-carrying ones), so the
  // rect is clamped to the drawable view range — never to tMin/tMax, which
  // would reintroduce the un-zoom bug D-4 fixed.
  let band: { x: number; width: number } | null = null;
  if (segment) {
    const left = padding;
    const right = width - padding;
    const bx = Math.min(Math.max(x(EPOCH(segment.start)), left), right);
    const bEnd = Math.min(Math.max(x(EPOCH(segment.end)), left), right);
    const bw = bEnd - bx;
    if (bw > 0) band = { x: bx, width: bw };
  }

  const yAtX = createMonotoneYAt(curve);
  const timeAtX = (vx: number) => tMin + ((vx - padding) / innerW) * tSpan;
  const bpmAtY = (vy: number) => bMin + (1 - (vy - padding) / innerH) * bSpan;

  return {
    path,
    area,
    band,
    count: points.length,
    solo: null,
    curve,
    mapX: x,
    mapY: y,
    yAtX,
    timeAtX,
    bpmAtY,
    tMin,
    tMax,
  };
}
