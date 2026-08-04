// heroArcGeometry coverage added by Story 3.8: the D-15/AC-5 monotonic-time
// guarantee, the D-4 band-from-time-bounds fix, and the overlay projections
// the full chart's annotations position from.
import { describe, expect, it } from "vitest";
import type { ArcPoint } from "./energyArc";
import { heroArcGeometry } from "./heroArc";

const VIEW = { width: 1000, height: 260, padding: 18 };
const iso = (ms: number) => new Date(ms).toISOString();

describe("heroArcGeometry — monotonic timeline (D-15 / epics AC-5)", () => {
  it("x stays strictly monotonic through a DST fall-back hour (epoch-ms math, no repeated-hour collision)", () => {
    // US fall-back 2026: Nov 1, 2:00 AM EDT → 1:00 AM EST (06:00Z). Local
    // wall-clock repeats 1:00–2:00; epoch ms does not. Plays every 20 min
    // across the transition:
    const start = Date.UTC(2026, 10, 1, 4, 0, 0); // 12:00 AM EDT
    const points: ArcPoint[] = Array.from({ length: 13 }, (_, i) => ({
      started_at: iso(start + i * 20 * 60 * 1000), // through 08:00Z = 3:00 AM EST
      bpm: 120 + (i % 5),
    }));
    const geo = heroArcGeometry(points, null, VIEW);
    expect(geo.curve.length).toBeGreaterThan(2);
    for (let i = 1; i < geo.curve.length; i++) {
      const dx = geo.curve[i].x - geo.curve[i - 1].x;
      const dt = geo.curve[i].t - geo.curve[i - 1].t;
      expect(dx).toBeGreaterThan(0); // no x-collisions
      expect(dt).toBeGreaterThan(0); // no negative deltas
    }
  });
});

describe("heroArcGeometry — D-4 band from segment time bounds", () => {
  const start = Date.UTC(2026, 5, 21, 22, 0, 0);
  const min = 60 * 1000;

  it("emits a band even when no BPM-carrying play falls inside the window", () => {
    // Plays cluster before and after the detected window — the old play-overlap
    // rule returned band: null here, silently un-zooming a "Dancefloor" scope.
    const points: ArcPoint[] = [
      { started_at: iso(start), bpm: 120 },
      { started_at: iso(start + 10 * min), bpm: 122 },
      { started_at: iso(start + 80 * min), bpm: 126 },
      { started_at: iso(start + 90 * min), bpm: 124 },
    ];
    const segment = { start: iso(start + 30 * min), end: iso(start + 60 * min) };
    const geo = heroArcGeometry(points, segment, VIEW);
    expect(geo.band).not.toBeNull();
    expect(geo.band!.width).toBeGreaterThan(0);
    // And the band sits between the two clusters, where the window really is.
    expect(geo.band!.x).toBeGreaterThan(geo.mapX(new Date(points[1].started_at).getTime()));
    expect(geo.band!.x + geo.band!.width).toBeLessThan(
      geo.mapX(new Date(points[2].started_at).getTime()),
    );
  });

  it("projects the band from time bounds (mapX agreement)", () => {
    const points: ArcPoint[] = Array.from({ length: 6 }, (_, i) => ({
      started_at: iso(start + i * 10 * min),
      bpm: 120 + i,
    }));
    const segment = { start: iso(start + 10 * min), end: iso(start + 30 * min) };
    const geo = heroArcGeometry(points, segment, VIEW);
    expect(geo.band!.x).toBeCloseTo(geo.mapX(start + 10 * min), 6);
    expect(geo.band!.x + geo.band!.width).toBeCloseTo(geo.mapX(start + 30 * min), 6);
  });

  it("still yields no band for a degenerate (zero-width) segment", () => {
    const points: ArcPoint[] = [
      { started_at: iso(start), bpm: 120 },
      { started_at: iso(start + 10 * min), bpm: 122 },
    ];
    const t = iso(start + 5 * min);
    expect(heroArcGeometry(points, { start: t, end: t }, VIEW).band).toBeNull();
  });
});

describe("heroArcGeometry — overlay projections (D-18 anchors)", () => {
  it("exposes curve points inside the padded viewBox and consistent mapX/mapY", () => {
    const points: ArcPoint[] = Array.from({ length: 8 }, (_, i) => ({
      started_at: iso(Date.UTC(2026, 5, 21, 22, i * 10)),
      bpm: 118 + i,
    }));
    const geo = heroArcGeometry(points, null, VIEW);
    expect(geo.count).toBe(8);
    expect(geo.tMax).toBeGreaterThan(geo.tMin);
    for (const c of geo.curve) {
      expect(c.x).toBeGreaterThanOrEqual(VIEW.padding);
      expect(c.x).toBeLessThanOrEqual(VIEW.width - VIEW.padding);
      expect(c.y).toBeGreaterThanOrEqual(VIEW.padding);
      expect(c.y).toBeLessThanOrEqual(VIEW.height - VIEW.padding);
      expect(geo.mapX(c.t)).toBeCloseTo(c.x, 6);
    }
    // Highest smoothed BPM maps to the smallest y (inverted axis).
    expect(geo.mapY(126)).toBeLessThan(geo.mapY(118));
  });

  it("returns safe empties for the degenerate counts", () => {
    expect(heroArcGeometry([], null, VIEW).count).toBe(0);
    const one = heroArcGeometry([{ started_at: iso(0), bpm: 120 }], null, VIEW);
    expect(one.count).toBe(1);
    expect(one.solo).not.toBeNull();
    expect(one.curve).toEqual([]);
  });
});
