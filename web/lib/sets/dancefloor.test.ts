import { describe, expect, it } from "vitest";
import type { SyncPlay } from "./types";
import { detectDancefloor, segmentStats } from "./dancefloor";
import fixture from "./recent-sets.fixture.json";

const sets = fixture as unknown as Array<{
  external_id: string;
  started_at: string | null;
  ended_at: string | null;
  plays: SyncPlay[];
  derived: { set_length_sec: number | null; track_count: number; genre_breakdown: { buckets: Array<{ genre: string; play_count: number }>; no_genre_count: number } };
}>;

const set975 = sets.find((s) => s.external_id === "975")!;
const soundcheck = sets.find((s) => s.external_id === "17577")!;

// Minimal SyncPlay factory for synthetic timelines. `startSec`/`bpm` are the
// only fields the detector reads; the rest satisfy the type.
function play(startSec: number, bpm: number | null, genre?: string): SyncPlay {
  return {
    position: 0,
    title: null,
    artist: null,
    started_at: new Date(startSec * 1000).toISOString(),
    bpm,
    genre: genre ? { raw: genre, normalized: genre, taxonomy_version: 2 } : null,
    camelot_key: null,
    in_library: true,
  };
}

describe("detectDancefloor (v0)", () => {
  it("returns null for a sparse set below the detection floor (the soundcheck)", () => {
    expect(soundcheck.plays.length).toBe(1);
    expect(detectDancefloor(soundcheck.plays)).toBeNull();
  });

  it("returns null (whole-set fallback) when no plays are timed", () => {
    const untimed = [play(0, 128), play(0, 128)].map((p) => ({ ...p, started_at: null }));
    expect(detectDancefloor(untimed)).toBeNull();
  });

  it("detects a real segment on set 975, bounded within the night and shorter than the whole set", () => {
    const seg = detectDancefloor(set975.plays);
    expect(seg).not.toBeNull();
    // Bounds fall inside the set's own start/end.
    expect(seg!.start >= set975.started_at!).toBe(true);
    expect(seg!.end <= set975.ended_at!).toBe(true);
    // The scoped set is a strict subset of the full 178 plays (a real cut, not the night).
    const scoped = segmentStats(set975.plays, seg);
    expect(scoped.track_count).toBeGreaterThan(0);
    expect(scoped.track_count).toBeLessThan(set975.derived.track_count);
  });

  it("excludes a slow, sparse warm-up and cuts to the busy peak", () => {
    const plays: SyncPlay[] = [];
    // Warm-up: 40 min, downtempo, sparse (1 play / 10-min window → below density floor).
    for (let i = 0; i < 4; i++) plays.push(play(i * 600, 96));
    // Peak: 40 min, four-to-the-floor, dense (5 plays / 10-min window).
    const peakStart = 4 * 600;
    for (let w = 0; w < 4; w++) for (let n = 0; n < 5; n++) plays.push(play(peakStart + w * 600 + n * 110, 128));
    // Cool-down: sparse again.
    const coolStart = 8 * 600;
    for (let i = 0; i < 3; i++) plays.push(play(coolStart + i * 600, 100));

    const seg = detectDancefloor(plays);
    expect(seg).not.toBeNull();
    // The segment starts at or after the peak, never in the warm-up.
    expect(new Date(seg!.start).getTime() / 1000).toBeGreaterThanOrEqual(peakStart);
  });

  it("falls back to the whole set (null) when a dense run spans essentially the whole night", () => {
    // Uniformly dense + fast for ~2 hours: every window clears, so the run is the night.
    const plays: SyncPlay[] = [];
    for (let i = 0; i < 60; i++) plays.push(play(i * 120, 128));
    expect(detectDancefloor(plays)).toBeNull();
  });
});

describe("segmentStats", () => {
  it("with a null segment reproduces the whole-set derived stats (cross-check vs the agent's own numbers)", () => {
    const whole = segmentStats(set975.plays, null);
    expect(whole.track_count).toBe(set975.derived.track_count);
    expect(whole.set_length_sec).toBe(set975.derived.set_length_sec);
    expect(whole.genre_breakdown.no_genre_count).toBe(set975.derived.genre_breakdown.no_genre_count);
    // Same normalized buckets + counts as the agent computed (order-independent).
    const asMap = (b: Array<{ genre: string; play_count: number }>) =>
      Object.fromEntries(b.map((x) => [x.genre, x.play_count]));
    expect(asMap(whole.genre_breakdown.buckets)).toEqual(asMap(set975.derived.genre_breakdown.buckets));
  });

  it("scopes length and track count to a segment's time bounds", () => {
    const plays = [play(0, 128, "House"), play(600, 128, "House"), play(1200, 128, "Techno"), play(1800, 128, "Techno")];
    const stats = segmentStats(plays, { start: plays[1].started_at!, end: plays[2].started_at! });
    expect(stats.track_count).toBe(2);
    expect(stats.set_length_sec).toBe(600);
    expect(stats.genre_breakdown.buckets).toEqual([
      { genre: "House", play_count: 1 },
      { genre: "Techno", play_count: 1 },
    ]);
  });

  it("a single-play segment has length 0, not null", () => {
    const plays = [play(0, 128)];
    expect(segmentStats(plays, null).set_length_sec).toBe(0);
  });
});
