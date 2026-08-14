import heroArc from "./hero-arc.json";

// Shared curve maths for the Landing hero ribbon (Story 6.1, D-1). Pure and
// dependency-free so the WebGL ribbon and the no-WebGL SVG fallback are driven
// by the SAME numbers — if these ever diverged, the fallback would be telling a
// different night's story than the canvas.
//
// Source data: _bmad-output/landing-captures/hero-arc-set-1289.json, extracted
// from the demo catalog's tier-1 "Set detail — peak-time club" set. That is the
// same set shown in the Set Detail capture, which is what makes beat 03's
// ribbon-to-interface handoff literal rather than merely similar.

export type ArcPoint = {
  position: number;
  t: number;
  bpm: number;
  bpmNorm: number;
  camelot: string | null;
  genre: string | null;
  title: string;
  artist: string;
};

export type ArcPoi = {
  id: string;
  t: number;
  label?: string;
  caption: string;
  track?: string;
  seconds?: number;
};

export const arc = heroArc as unknown as {
  source: { set: string; label: string; kind: string; startedAt: string; endedAt: string };
  summary: {
    trackCount: number;
    lengthSec: number;
    bpmMin: number;
    bpmMax: number;
    bpmMedian: number;
    confidence: number;
  };
  dancefloor: { firstPosition: number; lastPosition: number; tStart: number; tEnd: number };
  idleGaps: { tStart: number; tEnd: number; seconds: number }[];
  poi: ArcPoi[];
  points: ArcPoint[];
};

/** Column count along the ribbon. 44 plays resampled up so the crest reads smooth. */
export const SAMPLES = 256;

/**
 * The app's DetailArc holds plateaus between plays rather than drawing a smooth
 * spline through them — a track sits at its BPM until the next one starts. The
 * ribbon keeps that identity: sample piecewise-linearly against real elapsed
 * time, then soften just enough that the silhouette reads as a shape instead of
 * a bar chart. Three box passes ≈ a gaussian, and it is cheap and deterministic.
 */
function boxBlur(values: number[], radius: number): number[] {
  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i += 1) {
    let sum = 0;
    let count = 0;
    for (let k = -radius; k <= radius; k += 1) {
      const j = Math.min(values.length - 1, Math.max(0, i + k));
      sum += values[j];
      count += 1;
    }
    out[i] = sum / count;
  }
  return out;
}

function sampleAt(u: number): number {
  const pts = arc.points;
  if (u <= pts[0].t) return pts[0].bpmNorm;
  const last = pts[pts.length - 1];
  if (u >= last.t) return last.bpmNorm;
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1].t < u) i += 1;
  const a = pts[i];
  const b = pts[i + 1];
  const span = b.t - a.t;
  const k = span > 0 ? (u - a.t) / span : 0;
  return a.bpmNorm + (b.bpmNorm - a.bpmNorm) * k;
}

export type ArcCurve = {
  /** Normalized height 0..1 per column. */
  heights: number[];
  /** d(height)/du per column — drives the ribbon's slope shading. */
  slopes: number[];
};

let cached: ArcCurve | null = null;

export function getArcCurve(): ArcCurve {
  if (cached) return cached;

  const raw = new Array<number>(SAMPLES);
  for (let i = 0; i < SAMPLES; i += 1) raw[i] = sampleAt(i / (SAMPLES - 1));

  let heights = raw;
  for (let pass = 0; pass < 3; pass += 1) heights = boxBlur(heights, 4);

  // Lift off the floor so the ribbon never pinches to nothing at its quiet
  // moments — a zero-height column would vanish and break the silhouette.
  heights = heights.map((h) => 0.12 + h * 0.88);

  const slopes = heights.map((_, i) => {
    const prev = heights[Math.max(0, i - 1)];
    const next = heights[Math.min(heights.length - 1, i + 1)];
    return (next - prev) * 0.5 * SAMPLES;
  });

  cached = { heights, slopes };
  return cached;
}

const START_MS = Date.parse(arc.source.startedAt);
const END_MS = Date.parse(arc.source.endedAt);
const SPAN_MS = END_MS - START_MS;

/** Wall-clock time at a normalized position along the night. */
export function clockAt(t: number): string {
  return new Date(START_MS + t * SPAN_MS).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: arc.source.startedAt.slice(-6) === "-04:00" ? "America/New_York" : undefined,
  });
}

/** The night's own date, in the venue's timezone — the slate on beat 03. */
export function nightDate(): string {
  return new Date(START_MS).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: arc.source.startedAt.slice(-6) === "-04:00" ? "America/New_York" : undefined,
  });
}

export type AxisTick = { t: number; label: string };

/**
 * Hour boundaries inside the set, plus its two ends. This is what turns the
 * ribbon from an abstract curve into a night — without it nothing on screen
 * says the horizontal axis is time at all.
 */
export function getAxisTicks(): AxisTick[] {
  const ticks: AxisTick[] = [{ t: 0, label: clockAt(0) }];
  const first = new Date(START_MS);
  first.setMinutes(0, 0, 0);
  for (let ms = first.getTime() + 3_600_000; ms < END_MS; ms += 3_600_000) {
    const t = (ms - START_MS) / SPAN_MS;
    // Skip a boundary that would collide with either end label.
    if (t > 0.06 && t < 0.94) ticks.push({ t, label: clockAt(t) });
  }
  ticks.push({ t: 1, label: clockAt(1) });
  return ticks;
}

/**
 * Genre → categorical palette slot, ranked by play count in THIS set. Mirrors
 * how the app's own genre breakdown assigns colour: by rank, with everything
 * past the palette folded into the neutral. Returns token NAMES; the values are
 * read from :root at runtime like every other colour the shader consumes.
 */
export function getGenreSlots(): Map<string, string> {
  const counts = new Map<string, number>();
  for (const point of arc.points) {
    if (!point.genre) continue;
    counts.set(point.genre, (counts.get(point.genre) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([genre]) => genre);
  const slots = new Map<string, string>();
  ranked.forEach((genre, i) => {
    slots.set(genre, i < 8 ? `--chart-cat-${i + 1}` : "--chart-cat-other");
  });
  return slots;
}

/** The genre token name in force at each column of the resampled curve. */
export function getColumnGenres(): string[] {
  const slots = getGenreSlots();
  const out = new Array<string>(SAMPLES);
  for (let c = 0; c < SAMPLES; c += 1) {
    const u = c / (SAMPLES - 1);
    let current = arc.points[0];
    for (const point of arc.points) {
      if (point.t <= u) current = point;
      else break;
    }
    out[c] = (current.genre && slots.get(current.genre)) || "--chart-cat-other";
  }
  return out;
}

/**
 * The ribbon's silhouette as an SVG path, in a 0..1 × 0..1 box with y already
 * flipped for screen space. Used by the no-WebGL fallback and as the SSR paint
 * under the canvas, so something true is on screen before three.js loads.
 */
export function toSvgPath(width: number, height: number, closed = true): string {
  const { heights } = getArcCurve();
  const step = width / (SAMPLES - 1);
  let d = `M 0 ${(height * (1 - heights[0])).toFixed(2)}`;
  for (let i = 1; i < SAMPLES; i += 1) {
    d += ` L ${(i * step).toFixed(2)} ${(height * (1 - heights[i])).toFixed(2)}`;
  }
  if (closed) d += ` L ${width} ${height} L 0 ${height} Z`;
  return d;
}
