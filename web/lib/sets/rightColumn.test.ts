import { describe, expect, it } from "vitest";
import { buildRightColumn } from "./rightColumn";
import type { SetRecord, SyncPlay } from "./types";

// Covers the 2026-08-06 code-review ruling (Arjun): the most-played card
// counts only what was played ON THE DANCEFLOOR, in sets that were real gigs.
// The set-window rewrite that preceded this shipped with no test file at all,
// which is how it kept crowning a soundcheck while claiming to have fixed
// exactly that.

const BASE = Date.UTC(2026, 6, 1, 22, 0, 0); // 2026-07-01T22:00:00Z

function at(minutes: number): string {
  return new Date(BASE + minutes * 60_000).toISOString();
}

function play(position: number, title: string, minutes: number, bpm: number): SyncPlay {
  return {
    title,
    artist: title === "Warmup" ? "WarmupArtist" : "FloorArtist",
    started_at: at(minutes),
    bpm,
    genre: null,
    camelot_key: null,
    in_library: true,
    position,
  } as SyncPlay;
}

function set(overrides: {
  external_id: string;
  dayOffset: number;
  confidence?: number;
  plays: SyncPlay[];
  /** Story 5.2: the dancefloor cut now ARRIVES on the set row, from the `segments` table. */
  segments?: Array<{ start: string; end: string }>;
}): SetRecord {
  const { plays } = overrides;
  const started = new Date(BASE + overrides.dayOffset * 86_400_000).toISOString();
  return {
    external_id: overrides.external_id,
    started_at: started,
    ended_at: started,
    plays,
    // Story 5.3 added row identity to the read shape for the editor's sake.
    // The right column reads a segment only as a time window, so these cases
    // still state only the window and the identity is filled in from it —
    // rather than minting uuids that would suggest a database row behind them.
    segments: (overrides.segments ?? []).map((s) => ({
      ...s,
      id: `seg:${overrides.external_id}:${s.start}`,
      firstPlayId: `first:${overrides.external_id}:${s.start}`,
      lastPlayId: `last:${overrides.external_id}:${s.end}`,
      confirmed: false,
    })),
    derived: {
      most_played_tracks: [],
      most_played_artists: [],
      genre_breakdown: { buckets: [], no_genre_count: 0 },
      bpm_distribution: { count: 0, min: 0, max: 0, mean: 0, median: 0 },
      camelot_mixing_stats: { compatible_transitions: 0, incompatible_transitions: 0, excluded_no_key: 0 },
      set_length_sec: null,
      track_count: plays.length,
      energy_arc: [],
      confidence: { value: overrides.confidence ?? 1.0, track_count: plays.length, long_gap_count: 0 },
    },
  } as SetRecord;
}

/**
 * A real gig: a slow, sparse warm-up, then a dense 128-BPM run.
 *
 * Story 5.2: the cut is no longer recomputed here from the plays — it arrives as
 * a `segments` row covering the floor stretch only, exactly the shape the agent's
 * detector produces and the read seam resolves. The assertion the tests make is
 * unchanged: warm-up plays sit outside the segment and must not be tallied.
 */
function gigWithWarmup(externalId: string, dayOffset: number): SetRecord {
  const plays: SyncPlay[] = [];
  let position = 1;
  for (const m of [0, 2, 4, 10, 12, 14]) plays.push(play(position++, "Warmup", m, 100));
  for (const m of [20, 22, 24, 26, 30, 32, 34, 36, 40, 42, 44, 46]) {
    plays.push(play(position++, "Floor", m, 128));
  }
  return set({
    external_id: externalId,
    dayOffset,
    plays,
    segments: [{ start: at(20), end: at(46) }],
  });
}

describe("most-played counts only dancefloor time", () => {
  it("excludes warm-up plays that fall outside the detected segment", () => {
    // Warmup is played 6 times and Floor 12 — but even if the counts were
    // reversed, Warmup sits outside the segment and must not be counted.
    const model = buildRightColumn([gigWithWarmup("a", 0)]);
    expect(model.mostPlayed.recent.track?.title).toBe("Floor");
    expect(model.mostPlayed.recent.track?.plays).toBe(12);
    expect(model.mostPlayed.recent.artist?.artist).toBe("FloorArtist");
  });

  it("a newer soundcheck never displaces a real gig's track", () => {
    // The soundcheck is the NEWEST set, so under a plain last-N-sets window it
    // would occupy a slot and its lone track could tie or win. It is below
    // HERO_MIN_TRACKS, so it is not a dancefloor set at all.
    const soundcheck = set({
      external_id: "soundcheck",
      dayOffset: 5,
      plays: [play(1, "Soundcheck", 0, 128), play(2, "Soundcheck", 1, 128)],
    });
    const model = buildRightColumn([soundcheck, gigWithWarmup("gig", 0)]);
    expect(model.mostPlayed.recent.track?.title).toBe("Floor");
    // The soundcheck is not counted as one of the sets that were read, either.
    expect(model.mostPlayed.recent.setCount).toBe(1);
  });

  it("a low-confidence rehearsal is excluded even when it has plenty of tracks", () => {
    // Density alone is not enough — the frozen FR-27 signal still governs.
    // (D-7: that signal has no upper density ceiling, so a very busy rehearsal
    // still reads low-confidence. That is the accepted, documented behavior.)
    const rehearsal = gigWithWarmup("rehearsal", 5);
    const lowConf = { ...rehearsal, derived: { ...rehearsal.derived, confidence: { value: 0.2, track_count: 18, long_gap_count: 0 } } } as SetRecord;
    const model = buildRightColumn([lowConf, gigWithWarmup("gig", 0)]);
    expect(model.mostPlayed.recent.setCount).toBe(1);
  });

  it("reports no track rather than inventing one when there are no dancefloor sets", () => {
    const soundcheck = set({
      external_id: "soundcheck",
      dayOffset: 0,
      plays: [play(1, "Soundcheck", 0, 128)],
    });
    const model = buildRightColumn([soundcheck]);
    expect(model.mostPlayed.recent.track).toBeNull();
    expect(model.mostPlayed.recent.setCount).toBe(0);
  });

  it("orders undated sets deterministically instead of via a NaN comparator", () => {
    // `startMs` maps an unparsable timestamp to -Infinity, and the old
    // comparator subtracted: `-Infinity - (-Infinity)` is NaN, leaving two
    // such sets in an engine-defined order — the exact failure the sentinel's
    // own doc comment claims to prevent. The frozen contract types
    // `started_at` as a non-null string, so a malformed value (not `null`) is
    // the reachable shape here. This has to not throw and stay stable.
    const undatedA = { ...gigWithWarmup("u1", 0), started_at: "not-a-date" };
    const undatedB = { ...gigWithWarmup("u2", 0), started_at: "also-not-a-date" };
    const model = buildRightColumn([undatedA, undatedB]);
    expect(model.mostPlayed.recent.setCount).toBe(2);
    expect(model.mostPlayed.recent.track?.title).toBe("Floor");
  });
});
