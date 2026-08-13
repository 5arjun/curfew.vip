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

/**
 * A point's timestamp as it actually arrives from `derived.energy_arc`.
 *
 * **Unix epoch SECONDS when it is a number**, which is what every real agent
 * sync carries: `CapturedEnergyPoint::started_at` in
 * `agent/src-tauri/src/store.rs` is a `u32`, and `sync.rs` forwards
 * `derived_json` to `sync_set` verbatim. `derived` is a jsonb column read back
 * unchanged, so — unlike `plays[].started_at`, which `sync_set` converts with
 * `to_timestamp(...)` and PostgREST hands back as ISO — nothing in the stack
 * ever turned this into a date string. The `string` branch survives only for
 * hand-authored fixtures and any older stored blob.
 */
export type ArcTime = number | string;

export interface ArcPoint {
  started_at: ArcTime;
  bpm: number;
}

/**
 * The ONE reader for an arc timestamp — epoch ms, or `NaN` if unparseable.
 *
 * Every consumer of `derived.energy_arc` must go through this instead of
 * `new Date(p.started_at).getTime()`. That call is the bug this function
 * exists to make unrepresentable: `new Date(1786245580)` reads the integer as
 * *milliseconds* and lands on 1970-01-21, a factor of 1000 off, which surfaced
 * as "No tempo data in the dancefloor window." on a set whose arc was full of
 * points. Every gate stayed green because `web/lib/sets/*.fixture.json` writes
 * `energy_arc[].started_at` as an ISO string, so the suite only ever exercised
 * the string path — see `arcEpochMs`'s own numeric tests, which are the only
 * thing that can catch a regression here.
 *
 * Seconds-vs-milliseconds is decided by TYPE, not by magnitude: the agent's
 * field is a `u32`, so it cannot physically carry an epoch-ms value (those
 * pass 2^32 in 1970+49 days), and a magnitude sniff would only add a threshold
 * to get wrong.
 */
export function arcEpochMs(t: ArcTime): number {
  return typeof t === "number" ? t * 1000 : new Date(t).getTime();
}

export interface CurveXY {
  x: number;
  y: number;
}

const f = (n: number) => n.toFixed(2);

/** The Fritsch–Carlson tangents the path AND the point evaluator share — one
 * computation so the cursor ball can never disagree with the drawn line. */
function monotoneTangents(pts: CurveXY[]): { dx: number[]; tangent: number[] } {
  const n = pts.length;
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
  return { dx, tangent };
}

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
  const { dx, tangent } = monotoneTangents(pts);

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

/**
 * An evaluator for the SAME cubic `monotonePath` draws: y at any x, exactly on
 * the line (cubic Hermite with the shared tangents — a chord lerp visibly
 * floats off the bowed segments; 3.8 review round 3's cursor-ball fix).
 * Tangents are computed once at creation; each call is a binary search + one
 * Hermite evaluation. x outside the domain clamps to the end points.
 */
export function createMonotoneYAt(pts: CurveXY[]): (x: number) => number {
  const n = pts.length;
  if (n === 0) return () => 0;
  if (n === 1) return () => pts[0].y;
  const { dx, tangent } = monotoneTangents(pts);

  return (x: number) => {
    if (x <= pts[0].x) return pts[0].y;
    if (x >= pts[n - 1].x) return pts[n - 1].y;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].x <= x) lo = mid;
      else hi = mid;
    }
    const h = dx[lo];
    const t = (x - pts[lo].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return (
      h00 * pts[lo].y + h10 * h * tangent[lo] + h01 * pts[lo + 1].y + h11 * h * tangent[lo + 1]
    );
  };
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
  const t0 = arcEpochMs(points[0].started_at);
  const t1 = arcEpochMs(points[points.length - 1].started_at);
  const midT = t0 + (t1 - t0) / 2;
  let midIdx = 0;
  let midDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const dist = Math.abs(arcEpochMs(points[i].started_at) - midT);
    // `<=` (not `<`): on an exact tie, prefer the later index — an earlier-wins
    // tie-break silently biases every even split toward "back half" phrasing.
    if (dist <= midDist) {
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
