// Energy-arc geometry + text-equivalent (Story 3.6 Task 7) — the pure, testable
// core the reusable <EnergyArc> primitive renders. Thumbnail mode consumes it
// now; Story 3.8's full annotated chart renders the SAME geometry in "full" mode.
//
// BPM-over-time: x maps to a play's timestamp, y to its BPM (inverted for SVG:
// higher BPM sits higher on screen). No fabricated points — only plays carrying
// both a timestamp and a BPM are plotted (AD-11), matching the agent's own
// `energy_arc` contract.
import type { DancefloorSegment } from "./dancefloor";

export interface ArcPoint {
  started_at: string;
  bpm: number;
}

export interface ArcGeometry {
  /** SVG polyline `points` for the whole night (dimmed layer). */
  full: string;
  /** SVG polyline `points` for just the dancefloor window (emphasized layer), or null when no segment. */
  window: string | null;
  /** The dancefloor band as `{ x, width }` in viewBox units, or null. */
  band: { x: number; width: number } | null;
  /** Number of plotted points (0/1 are the sparse/degenerate cases the component handles specially). */
  count: number;
  /** The single point (x,y) when exactly one is plotted, for the dot fallback. */
  soloPoint: { x: number; y: number } | null;
}

export interface ArcViewBox {
  width: number;
  height: number;
  /** Inner padding so the 2px stroke never clips at the edges. */
  padding: number;
}

const EPOCH = (iso: string) => new Date(iso).getTime();

/**
 * Projects arc points into an SVG viewBox and slices out the dancefloor window.
 * Time drives x; BPM drives y (inverted). A flat set (all one BPM, or all one
 * instant) draws along the vertical/horizontal midline rather than dividing by
 * zero.
 */
export function arcGeometry(
  points: ArcPoint[],
  segment: DancefloorSegment | null,
  view: ArcViewBox,
): ArcGeometry {
  const { width, height, padding } = view;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  if (points.length === 0) {
    return { full: "", window: null, band: null, count: 0, soloPoint: null };
  }

  const times = points.map((p) => EPOCH(p.started_at));
  const bpms = points.map((p) => p.bpm);
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const bMin = Math.min(...bpms);
  const bMax = Math.max(...bpms);
  const tSpan = tMax - tMin || 1;
  const bSpan = bMax - bMin || 1;

  const x = (t: number) => padding + ((t - tMin) / tSpan) * innerW;
  // Invert y: max BPM at the top (padding), min BPM at the bottom.
  const y = (b: number) => padding + (1 - (b - bMin) / bSpan) * innerH;

  const xy = points.map((p) => ({ x: x(EPOCH(p.started_at)), y: y(p.bpm) }));
  const toPoints = (pts: { x: number; y: number }[]) =>
    pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");

  if (points.length === 1) {
    // A single track: no line to draw; center a dot on the midline so the card
    // still reads as "one play", not an empty box.
    const solo = { x: padding + innerW / 2, y: padding + innerH / 2 };
    return { full: "", window: null, band: null, count: 1, soloPoint: solo };
  }

  let windowPts: { x: number; y: number }[] = [];
  let band: { x: number; width: number } | null = null;
  if (segment) {
    const sMs = EPOCH(segment.start);
    const eMs = EPOCH(segment.end);
    windowPts = points
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => {
        const t = EPOCH(p.started_at);
        return t >= sMs && t <= eMs;
      })
      .map(({ i }) => xy[i]);
    if (windowPts.length > 0) {
      const bx = x(Math.max(sMs, tMin));
      const bw = x(Math.min(eMs, tMax)) - bx;
      band = { x: bx, width: Math.max(0, bw) };
    }
  }

  return {
    full: toPoints(xy),
    window: windowPts.length >= 2 ? toPoints(windowPts) : null,
    band,
    count: points.length,
    soloPoint: null,
  };
}

/**
 * A screen-reader text equivalent for the arc (AC-15: the energy-arc thumbnail
 * must carry a text equivalent). Reports the BPM range, the overall direction,
 * and — when present — the detected dancefloor window in local time.
 */
export function arcTextEquivalent(points: ArcPoint[], segment: DancefloorSegment | null): string {
  if (points.length === 0) return "Energy arc unavailable — no tempo data for this set.";
  if (points.length === 1) return `Energy arc: a single track at ${Math.round(points[0].bpm)} BPM.`;

  const bpms = points.map((p) => p.bpm);
  const min = Math.round(Math.min(...bpms));
  const max = Math.round(Math.max(...bpms));
  const first = points[0].bpm;
  const last = points[points.length - 1].bpm;
  const delta = last - first;
  const direction = Math.abs(delta) < 4 ? "holding steady" : delta > 0 ? "rising overall" : "easing down overall";

  const time = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const floor = segment ? ` Dancefloor detected ${time(segment.start)}–${time(segment.end)}.` : "";

  return `Energy arc: tempo ${min} to ${max} BPM, ${direction}.${floor}`;
}
