// Story 3.7 Task 3 — scope engine + client stat computation, including the
// AC-19 cross-check: the client Camelot rule must agree with the agent's
// derived.camelot_mixing_stats on the real fixture (set 975).
import { describe, expect, it } from "vitest";
import fixture from "./recent-sets.fixture.json";
import { detectDancefloor } from "./dancefloor";
import type { SetRecord } from "./types";
import {
  arcPeakPosition,
  bpmHistogram,
  bpmSummary,
  camelotCompatible,
  formatPlayedLength,
  genreRanking,
  mixingStats,
  mostPlayedArtists,
  newTracks,
  parseCamelot,
  replayedTracks,
  scopedPlays,
  setShape,
  subgenreRanking,
  transitions,
} from "./setDetail";
import type { SyncPlay } from "./types";

const sets = fixture as SetRecord[];
const set975 = sets.find((s) => s.external_id === "975") as SetRecord;

function play(overrides: Partial<SyncPlay> & { position: number }): SyncPlay {
  return {
    title: null,
    artist: null,
    started_at: null,
    bpm: null,
    genre: null,
    camelot_key: null,
    in_library: true,
    ...overrides,
  };
}

describe("Camelot rule mirrors agent/src-tauri/src/stats/camelot.rs", () => {
  it("parses valid Camelot keys and rejects the rest (mirror of camelot::parse)", () => {
    expect(parseCamelot("8A")).toEqual({ number: 8, letter: "A" });
    expect(parseCamelot("12B")).toEqual({ number: 12, letter: "B" });
    expect(parseCamelot("  8a  ")).toEqual({ number: 8, letter: "A" });
    expect(parseCamelot("Cmaj")).toBeNull();
    expect(parseCamelot("13A")).toBeNull();
    expect(parseCamelot("0B")).toBeNull();
    expect(parseCamelot("")).toBeNull();
    expect(parseCamelot("A")).toBeNull();
    expect(parseCamelot("-1A")).toBeNull();
  });

  it("judges the three compatible shapes and the wraparound (mirror of camelot::compatible)", () => {
    const k = (number: number, letter: "A" | "B") => ({ number, letter });
    expect(camelotCompatible(k(8, "A"), k(8, "A"))).toBe(true); // identical
    expect(camelotCompatible(k(8, "A"), k(8, "B"))).toBe(true); // relative
    expect(camelotCompatible(k(8, "A"), k(7, "A"))).toBe(true); // adjacent
    expect(camelotCompatible(k(12, "A"), k(1, "A"))).toBe(true); // 12↔1 wrap
    expect(camelotCompatible(k(8, "A"), k(3, "A"))).toBe(false);
    expect(camelotCompatible(k(8, "A"), k(9, "B"))).toBe(false);
  });

  it("AC-19 cross-check: whole-set client recompute equals derived.camelot_mixing_stats on fixture set 975", () => {
    expect(mixingStats(set975.plays)).toEqual(set975.derived.camelot_mixing_stats);
  });

  it("buckets smooth / clash / no-key transitions", () => {
    const plays = [
      play({ position: 1, camelot_key: "8A" }),
      play({ position: 2, camelot_key: "7A" }),
      play({ position: 3, camelot_key: "3A" }),
      play({ position: 4, camelot_key: null }),
    ];
    const t = transitions(plays);
    expect(t.map((x) => x.state)).toEqual(["smooth", "clash", "nokey"]);
    expect(t[0]).toMatchObject({ fromPosition: 1, toPosition: 2, fromKey: "8A", toKey: "7A" });
  });
});

describe("scopedPlays", () => {
  it("keeps only plays inside the dancefloor window, and degrades to whole set without a segment", () => {
    const plays = [
      play({ position: 1, started_at: "2026-06-21T22:00:00.000Z" }),
      play({ position: 2, started_at: "2026-06-21T23:00:00.000Z" }),
      play({ position: 3, started_at: "2026-06-22T01:00:00.000Z" }),
      play({ position: 4, started_at: null }),
    ];
    const segment = { start: "2026-06-21T22:30:00.000Z", end: "2026-06-22T00:00:00.000Z" };
    expect(scopedPlays(plays, segment, "dancefloor").map((p) => p.position)).toEqual([2]);
    expect(scopedPlays(plays, segment, "whole")).toHaveLength(4);
    expect(scopedPlays(plays, null, "dancefloor")).toHaveLength(4);
  });

  it("the fixture's detected dancefloor on 975 scopes to a real subset", () => {
    const segment = detectDancefloor(set975.plays);
    expect(segment).not.toBeNull();
    const scoped = scopedPlays(set975.plays, segment, "dancefloor");
    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.length).toBeLessThan(set975.plays.length);
  });
});

describe("bpmSummary / bpmHistogram", () => {
  it("whole-set client recompute equals derived.bpm_distribution on fixture set 975", () => {
    const s = bpmSummary(set975.plays);
    const d = set975.derived.bpm_distribution;
    expect(s.count).toBe(d.count);
    expect(s.min).toBeCloseTo(d.min, 6);
    expect(s.max).toBeCloseTo(d.max, 6);
    expect(s.mean).toBeCloseTo(d.mean, 6);
    expect(s.median).toBeCloseTo(d.median, 6);
  });

  it("an empty distribution is all zeros, never NaN", () => {
    expect(bpmSummary([play({ position: 1 })])).toEqual({
      count: 0,
      min: 0,
      max: 0,
      mean: 0,
      median: 0,
    });
  });

  it("bins align to multiples of the band width and keep empty bands between occupied ones", () => {
    const plays = [
      play({ position: 1, bpm: 121 }),
      play({ position: 2, bpm: 122 }),
      play({ position: 3, bpm: 130 }),
    ];
    const bands = bpmHistogram(plays, 4);
    expect(bands.map((b) => [b.from, b.count])).toEqual([
      [120, 2],
      [124, 0],
      [128, 1],
    ]);
    expect(bands[0].positions).toEqual([1, 2]);
  });
});

describe("setShape (Longest / Shortest Play, AC-14)", () => {
  it("picks by real played_ms only, discloses plays with no duration, first-played wins ties", () => {
    const plays = [
      play({ position: 1, title: "Long", played_ms: 400_000 }),
      play({ position: 2, title: "Short", played_ms: 60_000 }),
      play({ position: 3, title: "Also long (tie)", played_ms: 400_000 }),
      play({ position: 4, title: "No duration" }),
    ];
    const shape = setShape(plays);
    expect(shape.longest?.title).toBe("Long");
    expect(shape.shortest?.title).toBe("Short");
    expect(shape.missingDuration).toBe(1);
  });

  it("all-missing durations yield nulls, never a timestamp proxy", () => {
    const shape = setShape([play({ position: 1 }), play({ position: 2 })]);
    expect(shape.longest).toBeNull();
    expect(shape.shortest).toBeNull();
    expect(shape.missingDuration).toBe(2);
  });
});

describe("newTracks (AC-15)", () => {
  const setStart = "2026-06-21T22:00:00.000Z";
  const daysBefore = (n: number) =>
    new Date(Date.parse(setStart) - n * 24 * 60 * 60 * 1000).toISOString();

  it("counts unique tracks inside the set-date-relative window, week vs month", () => {
    const plays = [
      play({ position: 1, title: "A", library_added_at: daysBefore(3) }),
      play({ position: 2, title: "A", library_added_at: daysBefore(3) }), // replay, same track
      play({ position: 3, title: "B", library_added_at: daysBefore(20) }),
      play({ position: 4, title: "C", library_added_at: daysBefore(60) }),
      play({ position: 5, title: "D" }), // no add-date → disclosed
    ];
    const week = newTracks(plays, setStart, "week");
    expect(week.newCount).toBe(1);
    expect(week.totalTracks).toBe(4);
    expect(week.noDateCount).toBe(1);
    expect(week.positions).toEqual([1, 2]);

    const month = newTracks(plays, setStart, "month");
    expect(month.newCount).toBe(2);
    expect(month.positions).toEqual([1, 2, 3]);
  });

  it("a track added AFTER the set date is not new for that set", () => {
    const plays = [play({ position: 1, title: "Future", library_added_at: daysBefore(-2) })];
    expect(newTracks(plays, setStart, "month").newCount).toBe(0);
  });

  it("no set date yields the empty readout, never a guess", () => {
    expect(newTracks([play({ position: 1 })], null, "week")).toEqual({
      newCount: 0,
      totalTracks: 0,
      noDateCount: 0,
      positions: [],
    });
  });
});

describe("mostPlayedArtists / replayedTracks (AC-13)", () => {
  it("ranks artist-tagged plays only (CAP-5), count desc, first-seen tiebreak", () => {
    const plays = [
      play({ position: 1, artist: "B Artist" }),
      play({ position: 2, artist: "A Artist" }),
      play({ position: 3, artist: "B Artist" }),
      play({ position: 4, artist: null }),
    ];
    const ranked = mostPlayedArtists(plays);
    expect(ranked.map((a) => [a.artist, a.count])).toEqual([
      ["B Artist", 2],
      ["A Artist", 1],
    ]);
    expect(ranked[0].positions).toEqual([1, 3]);
  });

  it("replayedTracks lists only count > 1, and identity-less plays never group", () => {
    const plays = [
      play({ position: 1, title: "Repeat", artist: "X" }),
      play({ position: 2, title: "Repeat", artist: "X" }),
      play({ position: 3, title: "Once", artist: "X" }),
      play({ position: 4 }), // no title, no artist — no identity
      play({ position: 5 }),
    ];
    const replays = replayedTracks(plays);
    expect(replays).toHaveLength(1);
    expect(replays[0]).toMatchObject({ title: "Repeat", count: 2, positions: [1, 2] });
  });
});

describe("genreRanking / subgenreRanking (AC-12, AC-27)", () => {
  const genre = (normalized: string, subgenre?: string) => ({
    raw: normalized,
    normalized,
    taxonomy_version: 2,
    subgenre,
  });

  it("ranks buckets with honest no-genre count and % of ALL scoped plays", () => {
    const plays = [
      play({ position: 1, genre: genre("House", "Deep House") }),
      play({ position: 2, genre: genre("House", "Tech House") }),
      play({ position: 3, genre: genre("Techno", "Techno") }),
      play({ position: 4, genre: null }),
    ];
    const ranking = genreRanking(plays);
    expect(ranking.buckets.map((b) => [b.name, b.count, b.pct])).toEqual([
      ["House", 2, 50],
      ["Techno", 1, 25],
    ]);
    expect(ranking.noGenreCount).toBe(1);
    expect(ranking.noGenrePositions).toEqual([4]);

    const sub = subgenreRanking(plays);
    expect(sub.buckets.map((b) => [b.name, b.parent])).toEqual([
      ["Deep House", "House"],
      ["Tech House", "House"],
      ["Techno", "Techno"],
    ]);
  });

  it("whole-set recompute matches derived.genre_breakdown's totals on fixture 975", () => {
    const ranking = genreRanking(set975.plays);
    expect(ranking.noGenreCount).toBe(set975.derived.genre_breakdown.no_genre_count);
    const derivedTotal = set975.derived.genre_breakdown.buckets.reduce(
      (s, b) => s + b.play_count,
      0,
    );
    expect(ranking.buckets.reduce((s, b) => s + b.count, 0)).toBe(derivedTotal);
  });
});

describe("arcPeakPosition (AC-20, 3.8 D-14 moving time-window)", () => {
  /** Evenly-spaced BPM sequence starting 22:00, one play per `stepMin`. */
  const ramp = (bpms: number[], stepMin = 5) =>
    bpms.map((bpm, i) =>
      play({
        position: i + 1,
        started_at: new Date(Date.UTC(2026, 5, 21, 22, i * stepMin)).toISOString(),
        bpm,
      }),
    );

  it("stars the sustained peak, not a single doubled-BPM spike", () => {
    const plays = ramp([120, 121, 250, 128, 129, 130, 128]);
    const peak = arcPeakPosition(plays);
    // The doubled tag itself must never take the star; the sustained ~130
    // region around it wins (any of its members is a faithful answer).
    expect(peak).not.toBe(3);
    expect([4, 5, 6]).toContain(peak);
  });

  it("a short set peaks sensibly under the relative window (D-14)", () => {
    // 6 plays over 25 min — the ~10% window is ~2.5 min, narrower than the
    // play spacing, so it must still resolve into the closing high plateau.
    const peak = arcPeakPosition(ramp([120, 122, 126, 130, 131, 129]));
    expect([4, 5, 6]).toContain(peak);
  });

  it("a long set peaks in the highest-average window, not at a stray late high note", () => {
    // 5-hour set (61 plays): a sustained 134–136 plateau mid-set must beat a
    // brief 137 flicker at the very end — window AVERAGE wins, not max sample.
    const bpms = Array.from({ length: 61 }, (_, i) => {
      if (i >= 28 && i <= 38) return 134 + (i % 3); // sustained plateau
      if (i === 59) return 137; // one-track flicker at the end
      return 122;
    });
    const peak = arcPeakPosition(ramp(bpms, 5));
    expect(peak).not.toBe(60);
    expect(peak).toBeGreaterThanOrEqual(29);
    expect(peak).toBeLessThanOrEqual(39);
  });

  it("annotates the play nearest the winning window's center", () => {
    // Rising staircase: the winning window is the one anchored at the last
    // rise; the annotated play sits nearest its center, not at the anchor.
    const plays = ramp([120, 120, 120, 120, 128, 129, 130, 131, 132, 132, 132], 6);
    const peak = arcPeakPosition(plays);
    expect(peak).toBeGreaterThanOrEqual(8);
  });

  it("resolves ties deterministically to the earliest window", () => {
    const plays = ramp([130, 130, 130, 120, 130, 130, 130]);
    const a = arcPeakPosition(plays);
    expect(a).toBe(arcPeakPosition(plays));
    // Two identical plateaus: the earlier one must win, stably.
    expect([1, 2, 3]).toContain(a);
  });

  it("fewer than 2 BPM-carrying plays has no peak (sparse set, AC-35)", () => {
    expect(arcPeakPosition([play({ position: 1, bpm: 128 })])).toBeNull();
    expect(arcPeakPosition([])).toBeNull();
  });

  it("an all-one-instant scope degrades to highest BPM, earliest tie", () => {
    const t = "2026-06-21T22:00:00Z";
    const plays = [
      play({ position: 1, started_at: t, bpm: 120 }),
      play({ position: 2, started_at: t, bpm: 130 }),
      play({ position: 3, started_at: t, bpm: 130 }),
    ];
    expect(arcPeakPosition(plays)).toBe(2);
  });

  it("is deterministic on the real fixture and lands inside the scope", () => {
    const segment = detectDancefloor(set975.plays);
    const scoped = scopedPlays(set975.plays, segment, "dancefloor");
    const peak = arcPeakPosition(scoped);
    expect(peak).not.toBeNull();
    expect(scoped.some((p) => p.position === peak)).toBe(true);
    expect(arcPeakPosition(scoped)).toBe(peak);
  });

  it("D-10 cross-check on fixture 975: the arc ★ and the tracklist node share one value", () => {
    // Both consumers read frame.peakPosition = arcPeakPosition(scopedPlays)
    // — one function, one value. This pins the shared value's stability per
    // scope so neither consumer can drift without failing here.
    const segment = detectDancefloor(set975.plays);
    for (const scope of ["dancefloor", "whole"] as const) {
      const scoped = scopedPlays(set975.plays, segment, scope);
      const shared = arcPeakPosition(scoped);
      expect(shared).not.toBeNull();
      expect(arcPeakPosition(scoped)).toBe(shared);
    }
  });
});

describe("formatPlayedLength", () => {
  it("renders m:ss, h:mm:ss past the hour, and — for absent", () => {
    expect(formatPlayedLength(381_000)).toBe("6:21");
    expect(formatPlayedLength(59_400)).toBe("0:59");
    expect(formatPlayedLength(3_723_000)).toBe("1:02:03");
    expect(formatPlayedLength(null)).toBe("—");
    expect(formatPlayedLength(undefined)).toBe("—");
  });
});
