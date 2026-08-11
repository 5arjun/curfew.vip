// Story 5.2 (Task 5.3): the two segment-source behaviors the v0 retirement has
// to preserve exactly, neither of which had a test before — `buildSetRows` had
// no test file at all, which is how the swap from a computed cut to a fetched
// one could have changed every card's numbers without anything failing.
import { describe, expect, it } from "vitest";
import { buildSetRows } from "./listModel";
import { segmentStats } from "./dancefloor";
import type { SetRecord, SyncPlay } from "./types";

const BASE = Date.UTC(2026, 7, 5, 22, 0, 0);
const at = (minutes: number) => new Date(BASE + minutes * 60_000).toISOString();

function play(position: number, minutes: number, genre: string): SyncPlay {
  return {
    position,
    title: `Track ${position}`,
    artist: "Artist",
    started_at: at(minutes),
    bpm: 128,
    genre: { raw: genre, normalized: genre, taxonomy_version: 2 },
    camelot_key: null,
    in_library: true,
  } as SyncPlay;
}

/** Twelve plays over two hours: six House, then six Techno. */
const PLAYS: SyncPlay[] = [
  ...[0, 10, 20, 30, 40, 50].map((m, i) => play(i + 1, m, "House")),
  ...[60, 70, 80, 90, 100, 110].map((m, i) => play(i + 7, m, "Techno")),
];

function set(segments: Array<{ start: string; end: string }>): SetRecord {
  return {
    external_id: "set-1",
    started_at: at(0),
    ended_at: at(110),
    plays: PLAYS,
    segments,
    derived: {
      most_played_tracks: [],
      most_played_artists: [],
      genre_breakdown: { buckets: [], no_genre_count: 0 },
      bpm_distribution: { count: 12, min: 128, max: 128, mean: 128, median: 128 },
      camelot_mixing_stats: {
        compatible_transitions: 0,
        incompatible_transitions: 0,
        excluded_no_key: 12,
      },
      set_length_sec: 6600,
      track_count: 12,
      energy_arc: [],
      confidence: { value: 1, track_count: 12, long_gap_count: 0 },
    },
  } as SetRecord;
}

describe("buildSetRows reads the FETCHED segment (Story 5.2, D-24)", () => {
  it("a set with NO segments renders exactly the whole-set stats — v0's null fallback, unchanged", () => {
    // v0 returned `null` when detection declined and every consumer fell back to
    // the whole set. The source changed (no rows, rather than a refusal to
    // detect); the rendered numbers must not have.
    const [row] = buildSetRows([set([])]);
    const whole = segmentStats(PLAYS, null);

    expect(row.floorCount).toBe(whole.track_count);
    expect(row.floorCount).toBe(12);
    expect(row.durationLabel).toBe("1h 50m");
    expect(row.genreChips).toEqual(["House", "Techno"]);
  });

  it("a segment spanning the whole night gives the same stats as no segment at all", () => {
    // v0 suppressed a run covering >=90% of the night (`WHOLE_NIGHT_FRACTION`)
    // because its only consumer wanted a stats CUT and no-cut was the honest
    // fallback. D-22 dropped that: "the whole night was dancefloor" is a true,
    // useful suggestion, and it now arrives as a real segment. This asserts the
    // thing that made the suppression unnecessary — scoping to a whole-night
    // segment is arithmetically identical to not scoping at all.
    const [scoped] = buildSetRows([set([{ start: at(0), end: at(110) }])]);
    const [unscoped] = buildSetRows([set([])]);

    expect(scoped.floorCount).toBe(unscoped.floorCount);
    expect(scoped.durationLabel).toBe(unscoped.durationLabel);
    expect(scoped.genreChips).toEqual(unscoped.genreChips);
  });

  it("a real cut scopes the card's count, duration and genre chips to the segment", () => {
    const [row] = buildSetRows([set([{ start: at(60), end: at(110) }])]);

    expect(row.floorCount).toBe(6);
    expect(row.durationLabel).toBe("50m");
    // Only the Techno half is on the floor — the House warm-up is out of scope.
    expect(row.genreChips).toEqual(["Techno"]);
  });

  it("takes the longest of several segments as the card's one dancefloor (interim, D-24)", () => {
    const [row] = buildSetRows([
      set([
        { start: at(0), end: at(20) },
        { start: at(60), end: at(110) },
      ]),
    ]);

    // The 50-minute Techno run wins over the 20-minute House one. This is a
    // rendering pick until Story 5.4 ships a segment picker, not a claim that
    // the longest floor is the important one.
    expect(row.floorCount).toBe(6);
    expect(row.genreChips).toEqual(["Techno"]);
  });
});
