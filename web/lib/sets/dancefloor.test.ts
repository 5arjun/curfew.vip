import { describe, expect, it } from "vitest";
import type { SyncPlay } from "./types";
import type { DancefloorSegment } from "./dancefloor";
import { dancefloorSegments, primaryDancefloorSegment, segmentStats } from "./dancefloor";
import { fixtureSegments } from "./fixtureSegments";
import fixture from "./recent-sets.fixture.json";

const sets = fixture as unknown as Array<{
  external_id: string;
  started_at: string | null;
  ended_at: string | null;
  plays: SyncPlay[];
  derived: { set_length_sec: number | null; track_count: number; genre_breakdown: { buckets: Array<{ genre: string; play_count: number }>; no_genre_count: number } };
}>;

const set975 = sets.find((s) => s.external_id === "975")!;

// Minimal SyncPlay factory for synthetic timelines. `startSec`/`bpm` are the
// only fields the scoping utilities read; the rest satisfy the type.
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

// v0's detection cases used to live here (`detectDancefloor`: the sparse
// soundcheck, the untimed set, the warm-up-then-peak cut, the whole-night
// fallback). Story 5.2 retired that function — detection is ONE algorithm in the
// agent's Rust stat engine now (D-1/D-24) — so those behaviors are asserted
// there, in `agent/src-tauri/src/stats/segments.rs`'s own suite, against the
// same scenarios plus the ones v0 could not express (per-DJ floors, several
// segments, idle hard-breaks, DST). What remains here is what `web/` still owns:
// picking one segment to render, and scoping stats to it.
/**
 * A segment in the shape the read seam now produces (Story 5.3 Task 1.3):
 * ISO bounds plus the three ids an edit addresses the row by. The ids are
 * derived from the bounds purely so each case below stays one line — nothing in
 * the read path relates an id to a timestamp.
 */
function seg(start: string, end: string): DancefloorSegment {
  return { id: `seg-${start}`, firstPlayId: `first-${start}`, lastPlayId: `last-${end}`, confirmed: false, start, end };
}

describe("primaryDancefloorSegment", () => {
  it("returns null when a set has no segments at all — the whole-set fallback source", () => {
    expect(primaryDancefloorSegment([])).toBeNull();
    expect(primaryDancefloorSegment(undefined)).toBeNull();
    expect(primaryDancefloorSegment(null)).toBeNull();
  });

  it("returns the only segment when a set has exactly one", () => {
    const only = seg("2026-06-21T23:00:00.000Z", "2026-06-22T00:00:00.000Z");
    expect(primaryDancefloorSegment([only])).toEqual(only);
  });

  it("takes the LONGEST by elapsed time when a set has several (D-24's interim pick)", () => {
    const short = seg("2026-06-21T22:00:00.000Z", "2026-06-21T22:20:00.000Z");
    const long = seg("2026-06-22T00:00:00.000Z", "2026-06-22T02:00:00.000Z");
    // Deliberately out of chronological order: the pick is by duration, and must
    // not depend on the order PostgREST happened to return the rows in.
    expect(primaryDancefloorSegment([long, short])).toEqual(long);
    expect(primaryDancefloorSegment([short, long])).toEqual(long);
  });

  it("breaks a duration tie on the earlier start, so the choice is total and stable", () => {
    const earlier = seg("2026-06-21T22:00:00.000Z", "2026-06-21T23:00:00.000Z");
    const later = seg("2026-06-22T01:00:00.000Z", "2026-06-22T02:00:00.000Z");
    expect(primaryDancefloorSegment([later, earlier])).toEqual(earlier);
    expect(primaryDancefloorSegment([earlier, later])).toEqual(earlier);
  });

  it("carries the row's identity through untouched — it picks a segment, it does not reshape one", () => {
    const only = seg("2026-06-21T23:00:00.000Z", "2026-06-22T00:00:00.000Z");
    const picked = primaryDancefloorSegment([only])!;
    expect(picked.id).toBe(only.id);
    expect(picked.firstPlayId).toBe(only.firstPlayId);
    expect(picked.lastPlayId).toBe(only.lastPlayId);
  });
});

// Story 5.3 Task 1.4 (D-30). The singular helper above stays exactly as it was:
// every existing consumer (dashboard card, hero, right column) still shows ONE
// dancefloor. This plural one exists so the editor's selector can show the DJ
// that a second real floor exists at all, rather than silently editing "the"
// dancefloor while another sits invisible.
describe("dancefloorSegments", () => {
  it("returns [] for a set with no segments, matching the singular helper's null", () => {
    expect(dancefloorSegments([])).toEqual([]);
    expect(dancefloorSegments(undefined)).toEqual([]);
    expect(dancefloorSegments(null)).toEqual([]);
  });

  it("returns the single segment as a one-element list", () => {
    const only = seg("2026-06-21T23:00:00.000Z", "2026-06-22T00:00:00.000Z");
    expect(dancefloorSegments([only])).toEqual([only]);
  });

  it("returns EVERY segment, ordered exactly as the singular helper ranks them", () => {
    const short = seg("2026-06-21T22:00:00.000Z", "2026-06-21T22:20:00.000Z");
    const long = seg("2026-06-22T00:00:00.000Z", "2026-06-22T02:00:00.000Z");
    const middle = seg("2026-06-21T23:00:00.000Z", "2026-06-21T23:50:00.000Z");
    // Same total order as `primaryDancefloorSegment`, so the selector's default
    // chip and the card's "the dancefloor" can never disagree about which
    // segment that is — the invariant asserted directly below.
    expect(dancefloorSegments([short, long, middle])).toEqual([long, middle, short]);
    expect(dancefloorSegments([middle, short, long])).toEqual([long, middle, short]);
  });

  it("its head IS primaryDancefloorSegment, for any input", () => {
    const cases: DancefloorSegment[][] = [
      [],
      [seg("2026-06-21T23:00:00.000Z", "2026-06-22T00:00:00.000Z")],
      [
        seg("2026-06-21T22:00:00.000Z", "2026-06-21T22:20:00.000Z"),
        seg("2026-06-22T00:00:00.000Z", "2026-06-22T02:00:00.000Z"),
      ],
      // A duration tie, where the tie-break is the only thing deciding the head.
      [
        seg("2026-06-22T01:00:00.000Z", "2026-06-22T02:00:00.000Z"),
        seg("2026-06-21T22:00:00.000Z", "2026-06-21T23:00:00.000Z"),
      ],
    ];
    for (const input of cases) {
      expect(dancefloorSegments(input)[0] ?? null).toEqual(primaryDancefloorSegment(input));
    }
  });

  it("does not mutate the caller's array — it is a read helper over a fetched row set", () => {
    const short = seg("2026-06-21T22:00:00.000Z", "2026-06-21T22:20:00.000Z");
    const long = seg("2026-06-22T00:00:00.000Z", "2026-06-22T02:00:00.000Z");
    const input = [short, long];
    dancefloorSegments(input);
    expect(input).toEqual([short, long]);
  });

  it("returns the real several-segment fixture set's floors, all of them", () => {
    // `fixtureSegments` resolves the Rust detector's own committed output, so
    // this asserts against genuine algorithm output rather than a hand-picked
    // shape — the same discipline the scoping cases below follow.
    const several = sets.find((s) => fixtureSegments(s).length > 1);
    expect(several, "no committed fixture set carries several segments").toBeDefined();
    const all = dancefloorSegments(fixtureSegments(several!));
    expect(all.length).toBeGreaterThan(1);
    expect(all).toContainEqual(primaryDancefloorSegment(fixtureSegments(several!)));
  });
});

describe("the fetched segment scopes set 975 to a real cut", () => {
  it("is a strict subset of the night, bounded inside it", () => {
    // The segment the Rust detector actually produces for this set, committed at
    // `segments.fixture.json` and seeded into the local stack — read here
    // through the same positions→ISO resolution the read seam performs.
    const seg = primaryDancefloorSegment(fixtureSegments(set975));
    expect(seg).not.toBeNull();
    expect(seg!.start >= set975.started_at!).toBe(true);
    expect(seg!.end <= set975.ended_at!).toBe(true);

    const scoped = segmentStats(set975.plays, seg);
    expect(scoped.track_count).toBeGreaterThan(0);
    expect(scoped.track_count).toBeLessThan(set975.derived.track_count);
  });

  it("renders exactly the whole set when there is no segment (the null fallback path)", () => {
    const whole = segmentStats(set975.plays, null);
    expect(whole.track_count).toBe(set975.derived.track_count);
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
