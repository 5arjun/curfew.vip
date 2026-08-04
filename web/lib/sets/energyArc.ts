// Energy-arc pure core (Story 3.6 Task 7, upgraded in place by Story 3.8) —
// the monotone-cubic path generator every arc renders through and the ONE
// chart-summary generator (D-12: visible caption + aria text-equivalent +
// render-failure fallback are the same string).
//
// BPM-over-time: x maps to a play's timestamp, y to its BPM (inverted for SVG:
// higher BPM sits higher on screen). No fabricated points — only plays carrying
// both a timestamp and a BPM are plotted (AD-11), matching the agent's own
// `energy_arc` contract. The 3.6 polyline output (`arcGeometry`) retired in 3.8
// (D-8): both the detail arc and the dashboard thumbnail draw the monotone
// cubic below via heroArc.ts.

export interface ArcPoint {
  started_at: string;
  bpm: number;
}

export interface CurveXY {
  x: number;
  y: number;
}

const f = (n: number) => n.toFixed(2);

/**
 * Hand-rolled monotone cubic path (D-8, Fritsch–Carlson): smooth like the old
 * Catmull-Rom hero line but it NEVER overshoots the data — each segment stays
 * inside its endpoints' y-range, so a spiky BPM sequence can't fling the curve
 * above the real max or below the real min. Points must be x-sorted. Emits an
 * SVG `M … C …` d-string ("" for fewer than 2 points).
 */
export function monotonePath(pts: CurveXY[]): string {
  const n = pts.length;
  if (n < 2) return "";

  // Secant slopes between neighbours.
  const dx: number[] = new Array(n - 1);
  const slope: number[] = new Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x || 1e-9;
    slope[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }

  // Tangents: average of adjacent secants, zeroed at local extrema (sign
  // change), then the Fritsch–Carlson limiter clamps them so no segment can
  // leave its endpoints' range.
  const tangent: number[] = new Array(n);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      tangent[i] = tau * a * slope[i];
      tangent[i + 1] = tau * b * slope[i];
    }
  }

  // Hermite segments emitted as cubic Béziers.
  const d: string[] = [`M ${f(pts[0].x)} ${f(pts[0].y)}`];
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d.push(
      `C ${f(pts[i].x + h)} ${f(pts[i].y + tangent[i] * h)}, ${f(pts[i + 1].x - h)} ${f(
        pts[i + 1].y - tangent[i + 1] * h,
      )}, ${f(pts[i + 1].x)} ${f(pts[i + 1].y)}`,
    );
  }
  return d.join(" ");
}

/* ── Chart summary — one generator, three duties (D-12/D-13) ──────────── */

export type ArcScope = "dancefloor" | "whole";

/** Reuse of the established steadiness threshold: |Δ| < 4 BPM = steady. */
const STEADY_THRESHOLD = 4;

/**
 * THE chart-summary string (D-12): the visible bottom-right caption AND the
 * arc container's aria text-equivalent AND what the render-failure error
 * boundary shows — one pure generator, never three.
 *
 * Content is locked to D-13's register: min–max range + direction, templated,
 * scope-reactive, NO peak time (BPM-only detection can't place the peak
 * accurately enough to state as prose — AD-11). Direction vocabulary:
 * climbing / easing down / holding steady; the concentration clause compares
 * the first and back halves of the active scope. Callers pass the SCOPED
 * points — the caption recomputes with the flip (D-13). The dashboard
 * thumbnail uses the same generator aria-only (D-3).
 */
export function arcTextEquivalent(points: ArcPoint[], scope: ArcScope = "whole"): string {
  const inWindow = scope === "dancefloor";
  if (points.length === 0) {
    return inWindow ? "No tempo data in the dancefloor window." : "No tempo data for this set.";
  }
  if (points.length === 1) {
    const bpm = Math.round(points[0].bpm);
    return inWindow
      ? `A single track at ${bpm} BPM in the dancefloor window.`
      : `A single track at ${bpm} BPM.`;
  }

  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    if (p.bpm < min) min = p.bpm;
    if (p.bpm > max) max = p.bpm;
  }

  const range = `BPM ranged ${Math.round(min)}–${Math.round(max)}`;
  const first = points[0].bpm;
  const last = points[points.length - 1].bpm;
  const delta = last - first;
  if (Math.abs(delta) < STEADY_THRESHOLD) return `${range}, holding steady.`;

  const direction = delta > 0 ? "climbing" : "easing down";

  // Where the trend concentrates (D-13, templated): split at the time
  // midpoint and compare each half's contribution in the overall direction.
  const t0 = new Date(points[0].started_at).getTime();
  const t1 = new Date(points[points.length - 1].started_at).getTime();
  const midT = t0 + (t1 - t0) / 2;
  let midIdx = 0;
  let midDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dist = Math.abs(new Date(points[i].started_at).getTime() - midT);
    if (dist < midDist) {
      midDist = dist;
      midIdx = i;
    }
  }
  const sign = delta > 0 ? 1 : -1;
  const firstHalf = Math.max(0, sign * (points[midIdx].bpm - first));
  const backHalf = Math.max(0, sign * (last - points[midIdx].bpm));
  const clause =
    backHalf >= 2 * firstHalf && backHalf > 0
      ? " through the back half"
      : firstHalf >= 2 * backHalf && firstHalf > 0
        ? " through the first half"
        : " throughout";

  return `${range}, ${direction}${clause}.`;
}
