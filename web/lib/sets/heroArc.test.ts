// heroArcGeometry coverage added by Story 3.8: the D-15/AC-5 monotonic-time
// guarantee, the D-4 band-from-time-bounds fix, and the overlay projections
// the full chart's annotations position from.
import { describe, expect, it } from "vitest";
import type { ArcPoint } from "./energyArc";
import { arcInSegment, heroArcGeometry } from "./heroArc";

const VIEW = { width: 1000, height: 260, padding: 18 };
const iso = (ms: number) => new Date(ms).toISOString();
/** The WIRE form of an arc timestamp: Unix epoch seconds, as `u32`. */
const sec = (ms: number) => Math.floor(ms / 1000);

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

describe("the arc's REAL wire form — numeric epoch-seconds `started_at`", () => {
  /**
   * These are the only tests in the suite that can catch this class of bug, and
   * they exist because ~800 others could not.
   *
   * `derived.energy_arc[].started_at` is an INTEGER on the wire —
   * `CapturedEnergyPoint::started_at` is a `u32` and `sync.rs` forwards
   * `derived_json` verbatim into a jsonb column that is read back unchanged.
   * Every `*.fixture.json` in this directory writes it as an ISO string, so
   * every existing test exercises the string path only, and `new Date(1786…)`
   * reading epoch seconds as MILLISECONDS (1970-01-21, a factor of 1000 off)
   * stayed invisible through the whole of Epics 3–5. Production was empty, so
   * the first real agent sync would have been the discovery.
   *
   * Each case below therefore builds the SAME arc twice — once numeric, once
   * ISO — and demands they agree. A fixture cannot be substituted for this.
   */
  const start = Date.UTC(2026, 5, 21, 22, 0, 0);
  const min = 60 * 1000;
  const bpms = [120, 122, 125, 128, 126, 121];
  const at = (i: number) => start + i * 10 * min;

  const numeric: ArcPoint[] = bpms.map((bpm, i) => ({ started_at: sec(at(i)), bpm }));
  const isoForm: ArcPoint[] = bpms.map((bpm, i) => ({ started_at: iso(at(i)), bpm }));
  // Segment bounds are ISO on BOTH sides — they come from the read model
  // (`plays.started_at`), never from `derived`. That asymmetry is the bug.
  const segment = { start: iso(at(1)), end: iso(at(4)) };

  it("scopes to a segment window instead of matching nothing (the reported failure)", () => {
    // The symptom: the dancefloor filter compared 1970 arc times against 2026
    // segment bounds, matched zero points, and the caption became
    // "No tempo data in the dancefloor window." over a full arc.
    expect(arcInSegment(numeric, segment).map((p) => p.bpm)).toEqual([122, 125, 128, 126]);
    expect(arcInSegment(numeric, segment)).toHaveLength(
      arcInSegment(isoForm, segment).length,
    );
  });

  it("lands on the real instant, not 1970", () => {
    const geo = heroArcGeometry(numeric, null, VIEW);
    expect(geo.tMin).toBe(at(0));
    expect(geo.tMax).toBe(at(5));
    expect(new Date(geo.tMin).getUTCFullYear()).toBe(2026);
  });

  it("draws the identical geometry the ISO form draws", () => {
    const fromWire = heroArcGeometry(numeric, segment, VIEW);
    const fromIso = heroArcGeometry(isoForm, segment, VIEW);
    expect(fromWire.path).toBe(fromIso.path);
    expect(fromWire.area).toBe(fromIso.area);
    expect(fromWire.curve).toEqual(fromIso.curve);
    expect(fromWire.tMin).toBe(fromIso.tMin);
    expect(fromWire.tMax).toBe(fromIso.tMax);
  });

  it("keeps the dancefloor band on the window (it collapsed to null before)", () => {
    // The band is projected from the segment's ISO bounds through the arc's own
    // x-domain. With the points 1000x compressed into 1970, both bounds fell far
    // outside that domain, clamped to the same edge, and `bw > 0` went false —
    // so the hero silently un-zoomed with no band at all.
    const geo = heroArcGeometry(numeric, segment, VIEW);
    expect(geo.band).not.toBeNull();
    expect(geo.band!.width).toBeGreaterThan(0);
    expect(geo.band!.x).toBeCloseTo(geo.mapX(at(1)), 6);
    expect(geo.band!.x + geo.band!.width).toBeCloseTo(geo.mapX(at(4)), 6);
    expect(geo.band).toEqual(heroArcGeometry(isoForm, segment, VIEW).band);
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
