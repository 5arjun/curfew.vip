// Hero-arc geometry (Story 3.6 v2, D8): the dancefloor-highlighted BPM arc that
// spans the whole hero band. Pure + testable, same discipline as energyArc.ts —
// only plays carrying both a timestamp and a BPM are plotted (AD-11), nothing
// fabricated. Unlike the polyline thumbnail, the hero line is a SMOOTH cubic
// path ("a bead of molten chrome tracing the set"): Catmull-Rom through the
// points, emitted as SVG `C` segments. The dancefloor window is NOT a separate
// path — the component clips the same path to the band rect, which keeps the
// bright and dim strokes perfectly continuous.
import type { DancefloorSegment } from "./dancefloor";
import type { ArcPoint } from "./energyArc";

export interface HeroArcView {
  width: number;
  height: number;
  /** Inner padding so strokes/glow never clip at the frame. */
  padding: number;
}

export interface HeroArcGeometry {
  /** Smooth cubic SVG path of the whole night ("" when count < 2). */
  path: string;
  /** The same path closed down to the bottom edge — the under-line fill the component clips to the band. */
  area: string;
  /** Dancefloor band as viewBox x/width, or null (whole-set fallback → no highlight). */
  band: { x: number; width: number } | null;
  /** Plotted point count (0/1 are the degenerate cases). */
  count: number;
  /** Center point when exactly one play is plotted (dot fallback). */
  solo: { x: number; y: number } | null;
}

interface XY {
  x: number;
  y: number;
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

function catmullRomPath(pts: XY[]): string {
  const d: string[] = [`M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    );
  }
  return d.join(" ");
}

export function heroArcGeometry(
  points: ArcPoint[],
  segment: DancefloorSegment | null,
  view: HeroArcView,
): HeroArcGeometry {
  const { width, height, padding } = view;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  if (points.length === 0) {
    return { path: "", area: "", band: null, count: 0, solo: null };
  }

  if (points.length === 1) {
    return {
      path: "",
      area: "",
      band: null,
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

  const xy = smooth.map((p) => ({ x: x(p.t), y: y(p.bpm) }));
  const path = catmullRomPath(xy);
  const last = xy[xy.length - 1];
  const first = xy[0];
  const area = `${path} L ${last.x.toFixed(2)} ${height} L ${first.x.toFixed(2)} ${height} Z`;

  let band: { x: number; width: number } | null = null;
  if (segment) {
    const sMs = EPOCH(segment.start);
    const eMs = EPOCH(segment.end);
    const bx = x(Math.max(sMs, tMin));
    const bw = x(Math.min(eMs, tMax)) - bx;
    if (bw > 0) band = { x: bx, width: bw };
  }

  return { path, area, band, count: points.length, solo: null };
}
