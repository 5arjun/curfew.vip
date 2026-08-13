import { describe, expect, it } from "vitest";
import {
  arcEpochMs,
  arcTextEquivalent,
  createMonotoneYAt,
  monotonePath,
  type ArcPoint,
  type CurveXY,
} from "./energyArc";

const pt = (sec: number, bpm: number): ArcPoint => ({
  started_at: new Date(sec * 1000).toISOString(),
  bpm,
});

/** Parse an `M … C …` d-string and sample each cubic Bézier segment's y. */
function sampleSegments(d: string): Array<{ y0: number; y3: number; ys: number[] }> {
  const nums = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  // M x0 y0, then per segment: c1x c1y c2x c2y x y (6 numbers).
  const out: Array<{ y0: number; y3: number; ys: number[] }> = [];
  let px = nums[0];
  let py = nums[1];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const [c1x, c1y, c2x, c2y, x3, y3] = nums.slice(i, i + 6);
    void c1x;
    void c2x;
    void px;
    const ys: number[] = [];
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      const mt = 1 - t;
      ys.push(
        mt * mt * mt * py + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y3,
      );
    }
    out.push({ y0: py, y3, ys });
    px = x3;
    py = y3;
  }
  return out;
}

describe("monotonePath (D-8, Fritsch–Carlson)", () => {
  it("returns empty for fewer than 2 points", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 0, y: 10 }])).toBe("");
  });

  it("starts at the first point and ends at the last", () => {
    const d = monotonePath([
      { x: 0, y: 30 },
      { x: 50, y: 10 },
      { x: 100, y: 20 },
    ]);
    expect(d.startsWith("M 0.00 30.00")).toBe(true);
    expect(d.endsWith("100.00 20.00")).toBe(true);
  });

  it("never overshoots the data on a spiky fixture (every segment stays inside its endpoints)", () => {
    // The overshoot case Catmull-Rom fails: hard spikes next to flats.
    const spiky: CurveXY[] = [
      { x: 0, y: 100 },
      { x: 10, y: 100 },
      { x: 20, y: 10 },
      { x: 30, y: 100 },
      { x: 40, y: 100 },
      { x: 50, y: 95 },
      { x: 60, y: 12 },
      { x: 70, y: 11 },
      { x: 80, y: 90 },
    ];
    for (const seg of sampleSegments(monotonePath(spiky))) {
      const lo = Math.min(seg.y0, seg.y3) - 1e-6;
      const hi = Math.max(seg.y0, seg.y3) + 1e-6;
      for (const y of seg.ys) {
        expect(y).toBeGreaterThanOrEqual(lo);
        expect(y).toBeLessThanOrEqual(hi);
      }
    }
  });

  it("createMonotoneYAt evaluates the SAME cubic the path draws (the cursor ball sits on the line)", () => {
    const pts: CurveXY[] = [
      { x: 0, y: 100 },
      { x: 25, y: 100 },
      { x: 40, y: 12 },
      { x: 70, y: 95 },
      { x: 100, y: 90 },
    ];
    const yAt = createMonotoneYAt(pts);
    // Passes through every knot exactly…
    for (const p of pts) expect(yAt(p.x)).toBeCloseTo(p.y, 6);
    // …matches the emitted Bézier segments at their sampled interior points…
    const segs = sampleSegments(monotonePath(pts));
    let seg = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let s = 0; s <= 20; s++) {
        const x = pts[i].x + ((pts[i + 1].x - pts[i].x) * s) / 20;
        // The d-string rounds control points to 2 decimals — compare at the
        // precision the path actually carries.
        expect(yAt(x)).toBeCloseTo(segs[seg].ys[s], 1);
      }
      seg += 1;
    }
    // …and clamps outside the domain.
    expect(yAt(-10)).toBeCloseTo(100, 6);
    expect(yAt(140)).toBeCloseTo(90, 6);
  });

  it("keeps a flat run perfectly flat", () => {
    const flat: CurveXY[] = [
      { x: 0, y: 50 },
      { x: 10, y: 50 },
      { x: 20, y: 50 },
    ];
    for (const seg of sampleSegments(monotonePath(flat))) {
      for (const y of seg.ys) expect(y).toBeCloseTo(50, 6);
    }
  });
});

describe("arcTextEquivalent — ONE chart-summary generator (D-12/D-13)", () => {
  it("locks the register: min–max + climbing through the back half", () => {
    // Flat first half, climb concentrated after the midpoint.
    const s = arcTextEquivalent([pt(0, 122), pt(600, 122), pt(1200, 123), pt(1800, 128)]);
    expect(s).toBe("BPM ranged 122–128, climbing through the back half.");
  });

  it("phrases a first-half climb and an even climb distinctly (templated, never freeform)", () => {
    const firstHalf = arcTextEquivalent([pt(0, 120), pt(600, 128), pt(1200, 128), pt(1800, 129)]);
    expect(firstHalf).toBe("BPM ranged 120–129, climbing through the first half.");
    const even = arcTextEquivalent([pt(0, 120), pt(600, 124), pt(1200, 128)]);
    expect(even).toBe("BPM ranged 120–128, climbing throughout.");
  });

  it("eases down, and holds steady under the |Δ| < 4 threshold", () => {
    expect(arcTextEquivalent([pt(0, 128), pt(600, 127), pt(1200, 120)])).toBe(
      "BPM ranged 120–128, easing down through the back half.",
    );
    expect(arcTextEquivalent([pt(0, 128), pt(600, 135), pt(1200, 129)])).toBe(
      "BPM ranged 128–135, holding steady.",
    );
  });

  it("is scope-reactive (D-13): the dancefloor sparse fallbacks name the window", () => {
    expect(arcTextEquivalent([], "dancefloor")).toBe("No tempo data in the dancefloor window.");
    expect(arcTextEquivalent([], "whole")).toBe("No tempo data for this set.");
    expect(arcTextEquivalent([pt(0, 92)], "dancefloor")).toBe(
      "A single track at 92 BPM in the dancefloor window.",
    );
    expect(arcTextEquivalent([pt(0, 92)])).toBe("A single track at 92 BPM.");
  });

  it("never mentions a peak time (D-13 — AD-11: not placeable accurately enough for prose)", () => {
    const s = arcTextEquivalent([pt(0, 100), pt(600, 140), pt(1200, 110)]);
    expect(s).not.toMatch(/peak/i);
    expect(s).not.toMatch(/\d+:\d+/);
  });
});

describe("arcEpochMs — the one reader for an arc timestamp", () => {
  /**
   * The whole point of this block: `pt()` above converts seconds to an ISO
   * string, which is what every fixture in this directory does too — so the
   * suite has never once fed `arcTextEquivalent` the integer the agent actually
   * sends. `wirePt` below does, and it is the only thing standing between a
   * future refactor and a second 1970 regression.
   */
  const wirePt = (sec: number, bpm: number): ArcPoint => ({ started_at: sec, bpm });

  it("reads a number as SECONDS, not milliseconds", () => {
    // The literal value from the failing set. `new Date(1786245580)` — the call
    // this function replaced — is 1970-01-21.
    expect(arcEpochMs(1786245580)).toBe(1786245580000);
    expect(new Date(arcEpochMs(1786245580)).getUTCFullYear()).toBe(2026);
  });

  it("still parses an ISO string, so fixtures and older stored blobs keep working", () => {
    const ms = Date.UTC(2026, 5, 21, 22, 30, 0);
    expect(arcEpochMs(new Date(ms).toISOString())).toBe(ms);
    // The two forms of the same instant must be interchangeable.
    expect(arcEpochMs(ms / 1000)).toBe(arcEpochMs(new Date(ms).toISOString()));
  });

  it("returns NaN for an unparseable string rather than a wrong instant", () => {
    expect(Number.isNaN(arcEpochMs("not a date"))).toBe(true);
  });

  it("gives the caption's time-midpoint split the same answer either way", () => {
    // The `through the first half` / `back half` clause is chosen by comparing
    // each half's contribution around the TIME midpoint — the one place in the
    // caption that reads timestamps at all, and so the one that could disagree.
    const base = Date.UTC(2026, 5, 21, 22, 0, 0) / 1000;
    const shape: Array<[number, number]> = [
      [0, 120],
      [600, 121],
      [1200, 122],
      [1800, 129],
    ];
    expect(arcTextEquivalent(shape.map(([s, b]) => wirePt(base + s, b)))).toBe(
      arcTextEquivalent(shape.map(([s, b]) => pt(base + s, b))),
    );
    expect(arcTextEquivalent(shape.map(([s, b]) => wirePt(base + s, b)))).toBe(
      "BPM ranged 120–129, climbing through the back half.",
    );
  });
});
