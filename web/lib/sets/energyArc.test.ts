import { describe, expect, it } from "vitest";
import { arcGeometry, arcTextEquivalent, type ArcPoint } from "./energyArc";

const VIEW = { width: 100, height: 32, padding: 3 };
const pt = (sec: number, bpm: number): ArcPoint => ({ started_at: new Date(sec * 1000).toISOString(), bpm });

describe("arcGeometry", () => {
  it("returns an empty geometry for no points", () => {
    const g = arcGeometry([], null, VIEW);
    expect(g.count).toBe(0);
    expect(g.full).toBe("");
    expect(g.soloPoint).toBeNull();
  });

  it("centers a solo dot for a single play (no line to draw)", () => {
    const g = arcGeometry([pt(0, 120)], null, VIEW);
    expect(g.count).toBe(1);
    expect(g.full).toBe("");
    expect(g.soloPoint).toEqual({ x: 50, y: 16 });
  });

  it("plots a full polyline and clamps within the padded viewBox", () => {
    const g = arcGeometry([pt(0, 100), pt(60, 140), pt(120, 120)], null, VIEW);
    expect(g.count).toBe(3);
    const coords = g.full.split(" ").map((p) => p.split(",").map(Number));
    // First point at left padding, last at right padding; max BPM at top padding.
    expect(coords[0][0]).toBeCloseTo(3, 1);
    expect(coords[2][0]).toBeCloseTo(97, 1);
    expect(Math.min(...coords.map((c) => c[1]))).toBeCloseTo(3, 1); // 140bpm → top
  });

  it("slices the dancefloor window as its own emphasized polyline + band", () => {
    const points = [pt(0, 100), pt(60, 128), pt(120, 130), pt(180, 105)];
    const g = arcGeometry(points, { start: points[1].started_at, end: points[2].started_at }, VIEW);
    expect(g.window).not.toBeNull();
    expect(g.window!.split(" ").length).toBe(2); // only the two in-window points
    expect(g.band).not.toBeNull();
    expect(g.band!.width).toBeGreaterThan(0);
  });

  it("does not divide by zero on a flat (single-BPM) set", () => {
    const g = arcGeometry([pt(0, 128), pt(60, 128)], null, VIEW);
    const coords = g.full.split(" ").map((p) => p.split(",").map(Number));
    expect(coords.every((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))).toBe(true);
  });
});

describe("arcTextEquivalent", () => {
  it("describes the range and rising direction", () => {
    const s = arcTextEquivalent([pt(0, 100), pt(60, 130)], null);
    expect(s).toContain("100 to 130 BPM");
    expect(s).toContain("rising");
  });

  it("reports a steady set", () => {
    expect(arcTextEquivalent([pt(0, 128), pt(60, 129)], null)).toContain("holding steady");
  });

  it("mentions the dancefloor window when a segment is present", () => {
    const s = arcTextEquivalent([pt(0, 100), pt(600, 128)], { start: new Date(0).toISOString(), end: new Date(600000).toISOString() });
    expect(s).toContain("Dancefloor detected");
  });

  it("handles the single-track case", () => {
    expect(arcTextEquivalent([pt(0, 92)], null)).toContain("single track");
  });
});
