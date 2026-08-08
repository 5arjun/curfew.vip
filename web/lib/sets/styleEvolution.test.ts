import { describe, expect, it } from "vitest";
import {
  bpmRangeSummary,
  buildStyleEvolution,
  buildSummaryTiles,
  effectiveDiversity,
  genreDiversitySummary,
  keyDiversitySummary,
  localMonthKey,
  localWeekKey,
  monthsSpanned,
  shannonEntropy,
} from "./styleEvolution";
import type { SetRecord, SyncPlay } from "./types";

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

function set(overrides: {
  external_id: string;
  started_at: string | null;
  confidence?: number;
  bpm?: { count: number; min: number; max: number; mean: number; median: number };
  genreBuckets?: Array<{ genre: string; play_count: number }>;
  noGenreCount?: number;
  plays?: SyncPlay[];
  mixingStats?: { compatible_transitions: number; incompatible_transitions: number; excluded_no_key: number };
}): SetRecord {
  const plays = overrides.plays ?? [];
  return {
    external_id: overrides.external_id,
    started_at: overrides.started_at,
    ended_at: overrides.started_at,
    plays,
    derived: {
      most_played_tracks: [],
      most_played_artists: [],
      genre_breakdown: {
        buckets: overrides.genreBuckets ?? [],
        no_genre_count: overrides.noGenreCount ?? 0,
      },
      bpm_distribution: overrides.bpm ?? { count: 0, min: 0, max: 0, mean: 0, median: 0 },
      camelot_mixing_stats:
        overrides.mixingStats ?? { compatible_transitions: 0, incompatible_transitions: 0, excluded_no_key: 0 },
      set_length_sec: null,
      track_count: plays.length,
      energy_arc: [],
      confidence: {
        value: overrides.confidence ?? 1.0,
        track_count: plays.length,
        long_gap_count: 0,
      },
    },
  } as SetRecord;
}

describe("localMonthKey", () => {
  it("truncates a local timestamp to YYYY-MM", () => {
    expect(localMonthKey("2026-06-21T10:00:00.000Z")).toBe("2026-06");
  });

  it("returns '' for null or unparsable input", () => {
    expect(localMonthKey(null)).toBe("");
    expect(localMonthKey("not-a-date")).toBe("");
  });

  it("pads single-digit months", () => {
    expect(localMonthKey("2026-01-05T12:00:00.000Z")).toBe("2026-01");
  });

  it("buckets across a year boundary correctly", () => {
    // Local midday timestamps avoid any timezone-driven day rollover flakiness.
    expect(localMonthKey("2025-12-31T12:00:00.000Z")).toBe("2025-12");
    expect(localMonthKey("2026-01-01T12:00:00.000Z")).toBe("2026-01");
  });

  it("stays in the same local month across a DST transition (no manual UTC-offset math to misfire)", () => {
    // US DST spring-forward 2026-03-08. Both timestamps land in local March
    // regardless of the runner's timezone offset shifting mid-month.
    const before = localMonthKey("2026-03-01T12:00:00.000Z");
    const after = localMonthKey("2026-03-15T12:00:00.000Z");
    expect(before).toBe("2026-03");
    expect(after).toBe("2026-03");
  });
});

describe("localWeekKey", () => {
  it("returns the local Monday date of the containing week", () => {
    // 2026-03-04 is a Wednesday; its week's Monday is 2026-03-02.
    expect(localWeekKey("2026-03-04T12:00:00.000Z")).toBe("2026-03-02");
  });

  it("a Monday maps to itself", () => {
    expect(localWeekKey("2026-03-02T12:00:00.000Z")).toBe("2026-03-02");
  });

  it("a Sunday maps to the Monday that started its week", () => {
    expect(localWeekKey("2026-03-08T12:00:00.000Z")).toBe("2026-03-02");
  });

  it("returns '' for null or unparsable input", () => {
    expect(localWeekKey(null)).toBe("");
    expect(localWeekKey("not-a-date")).toBe("");
  });

  it("crosses a month boundary correctly", () => {
    // 2026-03-01 is a Sunday; its week's Monday is 2026-02-23.
    expect(localWeekKey("2026-03-01T12:00:00.000Z")).toBe("2026-02-23");
  });

  it("crosses a year boundary correctly", () => {
    // 2026-01-01 is a Thursday; its week's Monday is 2025-12-29.
    expect(localWeekKey("2026-01-01T12:00:00.000Z")).toBe("2025-12-29");
  });

  it("stays in the same local week across a DST transition", () => {
    // US DST spring-forward 2026-03-08 (a Sunday) — same week as 2026-03-05.
    const wed = localWeekKey("2026-03-05T12:00:00.000Z");
    const sun = localWeekKey("2026-03-08T12:00:00.000Z");
    expect(wed).toBe(sun);
  });
});

describe("shannonEntropy", () => {
  it("returns 0 for empty input", () => {
    expect(shannonEntropy([])).toBe(0);
  });

  it("returns 0 for all-zero input, never NaN/Infinity", () => {
    expect(shannonEntropy([0, 0, 0])).toBe(0);
  });

  it("returns 0 for a single nonzero category (no diversity)", () => {
    expect(shannonEntropy([5])).toBe(0);
    expect(shannonEntropy([0, 5, 0])).toBe(0);
  });

  it("returns 1 for an even 50/50 split of two categories", () => {
    expect(shannonEntropy([5, 5])).toBeCloseTo(1, 10);
  });

  it("returns 2 for an even split across four categories", () => {
    expect(shannonEntropy([1, 1, 1, 1])).toBeCloseTo(2, 10);
  });

  it("is never NaN/Infinity for skewed distributions", () => {
    const h = shannonEntropy([100, 1]);
    expect(Number.isFinite(h)).toBe(true);
    expect(h).toBeGreaterThan(0);
  });
});

describe("monthsSpanned", () => {
  it("counts distinct months pre-exclusion, including low-confidence sets", () => {
    const sets = [
      set({ external_id: "1", started_at: "2026-01-05T12:00:00.000Z", confidence: 0.2 }),
      set({ external_id: "2", started_at: "2026-02-05T12:00:00.000Z", confidence: 0.2 }),
    ];
    expect(monthsSpanned(sets)).toBe(2);
  });

  it("ignores sets with no timestamp", () => {
    const sets = [set({ external_id: "1", started_at: null })];
    expect(monthsSpanned(sets)).toBe(0);
  });

  it("dedupes multiple sets in the same month", () => {
    const sets = [
      set({ external_id: "1", started_at: "2026-01-01T12:00:00.000Z" }),
      set({ external_id: "2", started_at: "2026-01-20T12:00:00.000Z" }),
    ];
    expect(monthsSpanned(sets)).toBe(1);
  });
});

describe("buildStyleEvolution", () => {
  it("returns empty buckets/lowConfidenceCount for no sets", () => {
    const model = buildStyleEvolution([]);
    expect(model.month.buckets).toEqual([]);
    expect(model.week.buckets).toEqual([]);
    expect(model.monthsSpannedAll).toBe(0);
    expect(model.lowConfidenceCount).toBe(0);
  });

  it("orders month buckets ascending regardless of input order", () => {
    const sets = [
      set({ external_id: "1", started_at: "2026-03-01T12:00:00.000Z" }),
      set({ external_id: "2", started_at: "2026-01-01T12:00:00.000Z" }),
      set({ external_id: "3", started_at: "2026-02-01T12:00:00.000Z" }),
    ];
    const model = buildStyleEvolution(sets);
    expect(model.month.buckets).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("orders week buckets ascending by Monday-start date", () => {
    const sets = [
      set({ external_id: "1", started_at: "2026-03-04T12:00:00.000Z" }), // week of 2026-03-02
      set({ external_id: "2", started_at: "2026-02-25T12:00:00.000Z" }), // week of 2026-02-23
    ];
    const model = buildStyleEvolution(sets);
    expect(model.week.buckets).toEqual(["2026-02-23", "2026-03-02"]);
  });

  it("bpmRange is min-of-mins/max-of-maxes across surviving sets in the month", () => {
    const sets = [
      set({
        external_id: "1",
        started_at: "2026-01-01T12:00:00.000Z",
        bpm: { count: 10, min: 118, max: 124, mean: 121, median: 121 },
      }),
      set({
        external_id: "2",
        started_at: "2026-01-15T12:00:00.000Z",
        bpm: { count: 10, min: 122, max: 130, mean: 126, median: 126 },
      }),
    ];
    const model = buildStyleEvolution(sets);
    expect(model.month.excluding[0].bpmRange).toEqual({ min: 118, max: 130 });
  });

  it("week series aggregates the same two sets separately when they fall in different weeks", () => {
    const sets = [
      set({
        external_id: "1",
        started_at: "2026-01-01T12:00:00.000Z", // week of 2025-12-29
        bpm: { count: 10, min: 118, max: 124, mean: 121, median: 121 },
      }),
      set({
        external_id: "2",
        started_at: "2026-01-15T12:00:00.000Z", // week of 2026-01-12
        bpm: { count: 10, min: 122, max: 130, mean: 126, median: 126 },
      }),
    ];
    const model = buildStyleEvolution(sets);
    // The week in between (2026-01-05) has no set — a real gap bucket, not
    // silently skipped (post-launch-review fix: "just because there isn't a
    // set doesn't mean you should remove them").
    expect(model.week.buckets).toEqual(["2025-12-29", "2026-01-05", "2026-01-12"]);
    expect(model.week.excluding[0].bpmRange).toEqual({ min: 118, max: 124 });
    expect(model.week.excluding[1].bpmRange).toBeNull();
    expect(model.week.excluding[2].bpmRange).toEqual({ min: 122, max: 130 });
    // The month series still merges both into January.
    expect(model.month.buckets).toEqual(["2026-01"]);
    expect(model.month.excluding[0].bpmRange).toEqual({ min: 118, max: 130 });
  });

  it("excluding/including diverge when a month has low-confidence sets (D-4 reveal)", () => {
    const sets = [
      set({
        external_id: "1",
        started_at: "2026-01-01T12:00:00.000Z",
        confidence: 1.0,
        bpm: { count: 5, min: 120, max: 120, mean: 120, median: 120 },
      }),
      set({
        external_id: "2",
        started_at: "2026-01-10T12:00:00.000Z",
        confidence: 0.2,
        bpm: { count: 5, min: 140, max: 140, mean: 140, median: 140 },
      }),
    ];
    const model = buildStyleEvolution(sets);
    expect(model.lowConfidenceCount).toBe(1);
    expect(model.month.excluding[0].bpmRange).toEqual({ min: 120, max: 120 });
    expect(model.month.including[0].bpmRange).toEqual({ min: 120, max: 140 });
  });

  it("a month with all-excluded sets is a gap (null) in `excluding`, not a fabricated zero (D-8)", () => {
    const sets = [
      set({
        external_id: "1",
        started_at: "2026-01-01T12:00:00.000Z",
        confidence: 0.2,
        bpm: { count: 5, min: 120, max: 120, mean: 120, median: 120 },
      }),
    ];
    const model = buildStyleEvolution(sets);
    expect(model.month.buckets).toEqual(["2026-01"]);
    expect(model.month.excluding[0]).toEqual({ bpmRange: null, genreDiversity: null, keyDiversity: null, medianBpm: null, mixPace: null, harmonicMix: null });
    expect(model.month.including[0].bpmRange).toEqual({ min: 120, max: 120 });
  });

  it("merges genre_breakdown buckets by name across the month's surviving sets, discloses no_genre_count (D-1/AC-5)", () => {
    const sets = [
      set({
        external_id: "1",
        started_at: "2026-01-01T12:00:00.000Z",
        genreBuckets: [{ genre: "house", play_count: 5 }],
        noGenreCount: 1,
      }),
      set({
        external_id: "2",
        started_at: "2026-01-10T12:00:00.000Z",
        genreBuckets: [
          { genre: "house", play_count: 5 },
          { genre: "techno", play_count: 10 },
        ],
        noGenreCount: 2,
      }),
    ];
    const model = buildStyleEvolution(sets);
    const genre = model.month.excluding[0].genreDiversity;
    expect(genre).not.toBeNull();
    expect(genre!.no_genre_count).toBe(3);
    // house: 10, techno: 10 -> even split -> entropy 1.
    expect(genre!.index).toBeCloseTo(1, 10);
    // Breakdown exposes the same merged counts the entropy was computed from,
    // sorted descending — the breakdown bars' data source (post-launch-review).
    expect(genre!.breakdown).toEqual([
      { name: "house", count: 10 },
      { name: "techno", count: 10 },
    ]);
  });

  it("tallies per-play camelot_key (raw string) across the month's surviving sets, discloses no_key_count (D-2/AC-6)", () => {
    const sets = [
      set({
        external_id: "1",
        started_at: "2026-01-01T12:00:00.000Z",
        plays: [
          play({ position: 1, camelot_key: "8A" }),
          play({ position: 2, camelot_key: "8A" }),
          play({ position: 3, camelot_key: null }),
        ],
      }),
      set({
        external_id: "2",
        started_at: "2026-01-10T12:00:00.000Z",
        plays: [play({ position: 1, camelot_key: "9B" }), play({ position: 2, camelot_key: "9B" })],
      }),
    ];
    const model = buildStyleEvolution(sets);
    const key = model.month.excluding[0].keyDiversity;
    expect(key).not.toBeNull();
    expect(key!.no_key_count).toBe(1);
    // 8A: 2, 9B: 2 -> even split -> entropy 1.
    expect(key!.index).toBeCloseTo(1, 10);
    expect(key!.breakdown).toEqual([
      { name: "8A", count: 2 },
      { name: "9B", count: 2 },
    ]);
  });

  it("exclusion/reveal recompute independently per month — an excluded month elsewhere never leaks into a clean month", () => {
    const sets = [
      set({
        external_id: "1",
        started_at: "2026-01-01T12:00:00.000Z",
        confidence: 1.0,
        bpm: { count: 5, min: 100, max: 100, mean: 100, median: 100 },
      }),
      set({
        external_id: "2",
        started_at: "2026-02-01T12:00:00.000Z",
        confidence: 0.2,
        bpm: { count: 5, min: 200, max: 200, mean: 200, median: 200 },
      }),
    ];
    const model = buildStyleEvolution(sets);
    expect(model.month.buckets).toEqual(["2026-01", "2026-02"]);
    expect(model.month.excluding[0].bpmRange).toEqual({ min: 100, max: 100 });
    expect(model.month.excluding[1].bpmRange).toBeNull();
    expect(model.month.including[0].bpmRange).toEqual({ min: 100, max: 100 });
    expect(model.month.including[1].bpmRange).toEqual({ min: 200, max: 200 });
  });

  it("monthsSpannedAll stays month-based regardless of granularity (D-5 gate is not week-aware)", () => {
    // Two sets in the same calendar month but different weeks: still 1 month spanned.
    const sets = [
      set({ external_id: "1", started_at: "2026-01-01T12:00:00.000Z" }),
      set({ external_id: "2", started_at: "2026-01-29T12:00:00.000Z" }),
    ];
    const model = buildStyleEvolution(sets);
    expect(model.monthsSpannedAll).toBe(1);
    // Continuous fill: 5 Mondays span 2025-12-29..2026-01-26, not just the 2
    // weeks the two sets actually landed in.
    expect(model.week.buckets.length).toBe(5);
  });

  it("fills in a month with zero sets as a real gap bucket, never silently skipping it", () => {
    const sets = [
      set({
        external_id: "1",
        started_at: "2026-04-01T12:00:00.000Z",
        bpm: { count: 5, min: 120, max: 120, mean: 120, median: 120 },
      }),
      set({
        external_id: "2",
        started_at: "2026-06-01T12:00:00.000Z",
        bpm: { count: 5, min: 130, max: 130, mean: 130, median: 130 },
      }),
    ];
    const model = buildStyleEvolution(sets);
    expect(model.month.buckets).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(model.month.excluding[0].bpmRange).toEqual({ min: 120, max: 120 });
    expect(model.month.excluding[1]).toEqual({ bpmRange: null, genreDiversity: null, keyDiversity: null, medianBpm: null, mixPace: null, harmonicMix: null });
    expect(model.month.excluding[2].bpmRange).toEqual({ min: 130, max: 130 });
  });

  it("fills a month range across a year boundary", () => {
    const sets = [
      set({ external_id: "1", started_at: "2025-11-01T12:00:00.000Z" }),
      set({ external_id: "2", started_at: "2026-02-01T12:00:00.000Z" }),
    ];
    const model = buildStyleEvolution(sets);
    expect(model.month.buckets).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
});

describe("bpmRangeSummary", () => {
  it("reports no data when every bucket is a gap", () => {
    expect(bpmRangeSummary(["2026-01"], [null], "month")).toBe("No BPM data yet.");
  });

  it("reports a single surviving month directly", () => {
    expect(bpmRangeSummary(["2026-03"], [{ min: 120, max: 120 }], "month")).toBe(
      "A steady 120 BPM in March.",
    );
    expect(bpmRangeSummary(["2026-03"], [{ min: 118, max: 124 }], "month")).toBe(
      "BPM ranged 118–124 in March.",
    );
  });

  it("reports a single surviving week with the week-of phrasing", () => {
    expect(bpmRangeSummary(["2026-03-02"], [{ min: 118, max: 124 }], "week")).toBe(
      "BPM ranged 118–124 in the week of Mar 2.",
    );
  });

  it("skips gap months when picking first/last surviving points", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    const values = [{ min: 118, max: 124 }, null, { min: 122, max: 130 }];
    expect(bpmRangeSummary(months, values, "month")).toBe(
      "BPM range widened from 118–124 to 122–130 since January.",
    );
  });

  it("reports steady when the range is identical first-to-last", () => {
    const months = ["2026-01", "2026-02"];
    const values = [{ min: 118, max: 124 }, { min: 118, max: 124 }];
    expect(bpmRangeSummary(months, values, "month")).toBe(
      "BPM range has held steady at 118–124 since January.",
    );
  });

  it("reports narrowed when the range shrinks by >= the steady threshold", () => {
    const months = ["2026-01", "2026-02"];
    const values = [{ min: 110, max: 130 }, { min: 118, max: 122 }];
    expect(bpmRangeSummary(months, values, "month")).toBe(
      "BPM range narrowed from 110–130 to 118–122 since January.",
    );
  });

  it("reports a directional shift when width is unchanged but the band moved", () => {
    const months = ["2026-01", "2026-02"];
    const values = [{ min: 100, max: 106 }, { min: 120, max: 126 }];
    expect(bpmRangeSummary(months, values, "month")).toBe(
      "BPM range shifted up from 100–106 to 120–126 since January.",
    );
  });

  it("reports the week-of phrasing for a multi-point week series", () => {
    const weeks = ["2026-03-02", "2026-03-09"];
    const values = [{ min: 118, max: 124 }, { min: 122, max: 130 }];
    expect(bpmRangeSummary(weeks, values, "week")).toBe(
      "BPM range widened from 118–124 to 122–130 since the week of Mar 2.",
    );
  });
});

describe("effectiveDiversity", () => {
  it("maps H=0 (one category) to exactly 1 effective category", () => {
    expect(effectiveDiversity(0)).toBe(1);
  });

  it("maps an even split across N categories to exactly N", () => {
    // H = 2 bits is exactly the entropy of 4 evenly-split categories.
    expect(effectiveDiversity(2)).toBeCloseTo(4, 10);
  });

  it("is monotonically increasing in H", () => {
    expect(effectiveDiversity(1.5)).toBeGreaterThan(effectiveDiversity(1));
  });
});

describe("genreDiversitySummary / keyDiversitySummary", () => {
  it("reports no data when every bucket is a gap", () => {
    expect(genreDiversitySummary(["2026-01"], [null], "month")).toBe("No genre diversity data yet.");
    expect(keyDiversitySummary(["2026-01"], [null], "month")).toBe("No key usage data yet.");
  });

  it("reports a single surviving month as a deterministic effective-genre count, not a bare index", () => {
    const summary = genreDiversitySummary(["2026-03"], [{ index: 1, no_genre_count: 0, breakdown: [] }], "month");
    expect(summary).toBe(`Genre diversity sits at ${effectiveDiversity(1).toFixed(1)} effective genres in March.`);
  });

  it("reports a single surviving week by week-of phrasing", () => {
    const summary = genreDiversitySummary(["2026-03-02"], [{ index: 1, no_genre_count: 0, breakdown: [] }], "week");
    expect(summary).toBe(
      `Genre diversity sits at ${effectiveDiversity(1).toFixed(1)} effective genres in the week of Mar 2.`,
    );
  });

  it("reports broadened with the real from/to effective-genre counts when the count climbs past the steady threshold", () => {
    const months = ["2026-01", "2026-02"];
    const values = [{ index: 0, no_genre_count: 0, breakdown: [] }, { index: 1, no_genre_count: 0, breakdown: [] }];
    const from = effectiveDiversity(0).toFixed(1); // 1.0
    const to = effectiveDiversity(1).toFixed(1); // 2.0
    expect(genreDiversitySummary(months, values, "month")).toBe(
      `Genre diversity has broadened from ${from} to ${to} effective genres since January.`,
    );
  });

  it("reports narrowed with the real from/to effective-key counts when the count drops past the steady threshold", () => {
    const months = ["2026-01", "2026-02"];
    const values = [{ index: 1, no_key_count: 0, breakdown: [] }, { index: 0, no_key_count: 0, breakdown: [] }];
    const from = effectiveDiversity(1).toFixed(1); // 2.0
    const to = effectiveDiversity(0).toFixed(1); // 1.0
    expect(keyDiversitySummary(months, values, "month")).toBe(
      `Key usage has narrowed from ${from} to ${to} effective keys since January.`,
    );
  });

  it("reports steady (with the real count) when the effective count barely moves", () => {
    const months = ["2026-01", "2026-02"];
    const values = [{ index: 1, no_genre_count: 0, breakdown: [] }, { index: 1.05, no_genre_count: 0, breakdown: [] }];
    const around = effectiveDiversity(1.05).toFixed(1);
    expect(genreDiversitySummary(months, values, "month")).toBe(
      `Genre diversity has held steady around ${around} effective genres since January.`,
    );
  });

  it("never surfaces the raw entropy BITS value — only the converted effective-count", () => {
    // Raw bits = 2; the copy must show the CONVERTED count (4.0), never the
    // raw "2" a reader could otherwise mistake for a genre count.
    const months = ["2026-01", "2026-02"];
    const values = [{ index: 2, no_genre_count: 0, breakdown: [] }, { index: 2, no_genre_count: 0, breakdown: [] }];
    const summary = genreDiversitySummary(months, values, "month");
    expect(summary).toContain("4.0 effective genres");
    expect(summary).not.toMatch(/\b2\.0\b/);
  });
});

/* ── Arc-aware captions + multi-year labelling (2026-08-06). Once the fixture
   grew past a year, the endpoint-only sentence actively misled: a series that
   visibly climbed 1.0 → 3.8 → 1.0 was captioned "held steady around 1.0", and
   two different Junes both rendered as bare "June". ────────────────────────*/
describe("captions describe the arc, not just the endpoints", () => {
  const g = (index: number) => ({ index, no_genre_count: 0, breakdown: [] });
  const k = (index: number) => ({ index, no_key_count: 0, breakdown: [] });

  it("reports an interior PEAK the endpoints hide instead of 'held steady'", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    // 1.0 → 4.0 → 1.0 effective: identical endpoints, a peak in between.
    const summary = genreDiversitySummary(months, [g(0), g(2), g(0)], "month");
    expect(summary).toBe(
      "Genre diversity climbed from 1.0 in January to a peak of 4.0 effective genres in February, then eased back to 1.0.",
    );
    expect(summary).not.toContain("held steady");
  });

  it("reports an interior TROUGH the endpoints hide", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    const summary = keyDiversitySummary(months, [k(2), k(0), k(2)], "month");
    expect(summary).toBe(
      "Key usage dipped from 4.0 in January to 1.0 effective keys in February, then recovered to 4.0.",
    );
  });

  it("leaves the plain from/to sentence alone when the extreme sits AT an endpoint", () => {
    // Monotone climb: the peak IS the last point, which from/to already says.
    const months = ["2026-01", "2026-02", "2026-03"];
    expect(genreDiversitySummary(months, [g(0), g(1), g(2)], "month")).toBe(
      "Genre diversity has broadened from 1.0 to 4.0 effective genres since January.",
    );
  });

  it("ignores a mid-run wobble below the steady threshold", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    const summary = genreDiversitySummary(months, [g(1), g(1.05), g(1)], "month");
    expect(summary).toContain("held steady");
  });

  it("reports a BPM range that opened widest mid-run", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    const values = [{ min: 120, max: 128 }, { min: 100, max: 160 }, { min: 122, max: 126 }];
    expect(bpmRangeSummary(months, values, "month")).toBe(
      "BPM range ran 120–128 in January, opened widest at 100–160 in February, and sits at 122–126 in March.",
    );
  });

  it("leaves BPM from/to alone when the mid-run wobble is under the arc threshold", () => {
    const months = ["2026-01", "2026-02", "2026-03"];
    const values = [{ min: 110, max: 130 }, { min: 109, max: 132 }, { min: 118, max: 122 }];
    expect(bpmRangeSummary(months, values, "month")).toBe(
      "BPM range narrowed from 110–130 to 118–122 since January.",
    );
  });

  it("carries the YEAR in every label once the buckets straddle a year boundary", () => {
    const months = ["2025-06", "2025-12", "2026-06"];
    const summary = genreDiversitySummary(months, [g(0), g(2), g(0)], "month");
    expect(summary).toContain("June 2025");
    expect(summary).toContain("December 2025");
    // A bare month name would be ambiguous across the two Junes in range.
    expect(summary).not.toMatch(/\bin June\b(?! 20)/);
  });

  it("omits the year while the buckets stay inside one calendar year", () => {
    const months = ["2026-01", "2026-02"];
    expect(genreDiversitySummary(months, [g(0), g(2)], "month")).toBe(
      "Genre diversity has broadened from 1.0 to 4.0 effective genres since January.",
    );
  });

  it("carries the year in week-of phrasing too", () => {
    const weeks = ["2025-12-29", "2026-01-05", "2026-01-12"];
    const summary = bpmRangeSummary(weeks, [{ min: 120, max: 128 }, { min: 100, max: 160 }, { min: 122, max: 126 }], "week");
    expect(summary).toContain("the week of Dec 29, 2025");
    expect(summary).toContain("the week of Jan 5, 2026");
  });
});

describe("code review 2026-08-06 regressions", () => {
  it("a bucket with sets but no categorized play is a gap, not a fabricated 1.0", () => {
    // The set survives exclusion and has plays — it simply has no genre
    // bucket and no camelot key on any play. Before the fix this produced
    // `index: 0`, which the chart converted to `2^0` and drew as a real
    // point claiming "1.0 effective genres" for a bucket where zero genres
    // are known (D-8: gap, never a fabricated value).
    const model = buildStyleEvolution([
      set({
        external_id: "a",
        started_at: "2026-03-04T21:00:00.000Z",
        genreBuckets: [],
        noGenreCount: 12,
        plays: [play({ position: 1 }), play({ position: 2 })],
      }),
    ]);
    const point = model.month.excluding[0];
    expect(point.genreDiversity?.index).toBeNull();
    expect(point.keyDiversity?.index).toBeNull();
    // ...but the honest disclosure counts survive (AC-5/AC-6): the object is
    // still there, only the plottable index is null.
    expect(point.genreDiversity?.no_genre_count).toBe(12);
    expect(point.keyDiversity?.no_key_count).toBe(2);
  });

  it("still produces a real index when a bucket has categorized plays", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "a",
        started_at: "2026-03-04T21:00:00.000Z",
        genreBuckets: [
          { genre: "House", play_count: 4 },
          { genre: "Techno", play_count: 4 },
        ],
        plays: [play({ position: 1, camelot_key: "8A" }), play({ position: 2, camelot_key: "9A" })],
      }),
    ]);
    const point = model.month.excluding[0];
    expect(point.genreDiversity?.index).toBe(1); // two even categories → H = 1 bit
    expect(point.keyDiversity?.index).toBe(1);
  });

  it("shannonEntropy returns 0 rather than NaN for a malformed count", () => {
    // `NaN <= 0` is false, so the old `total <= 0` guard let NaN through and
    // it reached an SVG `d` attribute and a `top: NaN%` style.
    expect(shannonEntropy([Number.NaN])).toBe(0);
    expect(shannonEntropy([3, Number.NaN, 1])).not.toBeNaN();
    expect(Number.isFinite(shannonEntropy([3, Number.NaN, 1]))).toBe(true);
  });

  it("undated sets are disclosed, not counted as hideable low-confidence sessions", () => {
    // An undated set is dropped from every series (no bucket to file it
    // under), so counting it in lowConfidenceCount had the banner offer to
    // reveal a session that revealing could never draw.
    const model = buildStyleEvolution([
      set({ external_id: "dated", started_at: "2026-03-04T21:00:00.000Z", confidence: 0.2 }),
      set({ external_id: "undated", started_at: null, confidence: 0.2 }),
    ]);
    expect(model.lowConfidenceCount).toBe(1);
    expect(model.undatedCount).toBe(1);
  });

  it("a lone surviving bucket still carries its year on a multi-year axis", () => {
    // `withYear` used to be computed after this branch's early return, so the
    // caption read "in June" while the ticks read Jun '25 / Jun '26.
    const buckets = ["2025-06", "2025-07", "2026-06"];
    const values = [null, null, { min: 120, max: 128 }];
    expect(bpmRangeSummary(buckets, values, "month")).toContain("2026");
  });
});

describe("median BPM (Story 4.7 AC-4)", () => {
  it("is the median of each surviving set's own per-set median, not a re-derivation from raw plays", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "a",
        started_at: "2026-03-04T21:00:00.000Z",
        bpm: { count: 3, min: 120, max: 128, mean: 124, median: 122 },
      }),
      set({
        external_id: "b",
        started_at: "2026-03-10T21:00:00.000Z",
        bpm: { count: 2, min: 124, max: 130, mean: 127, median: 128 },
      }),
    ]);
    expect(model.month.excluding[0].medianBpm).toBe(125); // median of [122, 128]
  });

  it("excludes a set with an empty BPM distribution (count: 0) rather than treating its median as a real 0", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "a",
        started_at: "2026-03-04T21:00:00.000Z",
        bpm: { count: 0, min: 0, max: 0, mean: 0, median: 0 },
      }),
    ]);
    expect(model.month.excluding[0].medianBpm).toBeNull();
  });
});

describe("mix pace (Story 4.7 AC-4/AC-6)", () => {
  it("is the median played_ms across the bucket's plays, converted to seconds", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "a",
        started_at: "2026-03-04T21:00:00.000Z",
        plays: [
          play({ position: 1, played_ms: 180_000 }),
          play({ position: 2, played_ms: 220_000 }),
          play({ position: 3, played_ms: 200_000 }),
        ],
      }),
    ]);
    expect(model.month.excluding[0].mixPace?.medianSeconds).toBe(200);
    expect(model.month.excluding[0].mixPace?.excludedCount).toBe(0);
  });

  it("excludes plays missing played_ms from the median AND discloses the count — never silently folded in", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "a",
        started_at: "2026-03-04T21:00:00.000Z",
        plays: [
          play({ position: 1, played_ms: 180_000 }),
          play({ position: 2, played_ms: null }),
          play({ position: 3, played_ms: undefined }),
        ],
      }),
    ]);
    expect(model.month.excluding[0].mixPace?.medianSeconds).toBe(180);
    expect(model.month.excluding[0].mixPace?.excludedCount).toBe(2);
  });

  it("is null (a gap, not a fabricated 0) when every play is missing played_ms", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "a",
        started_at: "2026-03-04T21:00:00.000Z",
        plays: [play({ position: 1, played_ms: null })],
      }),
    ]);
    expect(model.month.excluding[0].mixPace?.medianSeconds).toBeNull();
    expect(model.month.excluding[0].mixPace?.excludedCount).toBe(1);
  });
});

describe("harmonic mix rate (Story 4.7 AC-4/AC-7)", () => {
  it("is compatible / (compatible + incompatible), summed across the bucket's sets", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "a",
        started_at: "2026-03-04T21:00:00.000Z",
        mixingStats: { compatible_transitions: 6, incompatible_transitions: 2, excluded_no_key: 1 },
      }),
      set({
        external_id: "b",
        started_at: "2026-03-10T21:00:00.000Z",
        mixingStats: { compatible_transitions: 2, incompatible_transitions: 2, excluded_no_key: 0 },
      }),
    ]);
    // (6+2) / (6+2+2+2) = 8/12
    expect(model.month.excluding[0].harmonicMix?.rate).toBeCloseTo(8 / 12);
    expect(model.month.excluding[0].harmonicMix?.excludedNoKey).toBe(1);
  });

  it("is null (never a fabricated 0%) when there are zero scored transitions", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "a",
        started_at: "2026-03-04T21:00:00.000Z",
        mixingStats: { compatible_transitions: 0, incompatible_transitions: 0, excluded_no_key: 3 },
      }),
    ]);
    expect(model.month.excluding[0].harmonicMix?.rate).toBeNull();
    expect(model.month.excluding[0].harmonicMix?.excludedNoKey).toBe(3);
  });
});

describe("buildSummaryTiles (Story 4.7 AC-4/AC-5)", () => {
  it("reads the current period as the latest bucket carrying a value, with a delta against the nearest earlier one", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "jan",
        started_at: "2026-01-04T21:00:00.000Z",
        bpm: { count: 1, min: 120, max: 120, mean: 120, median: 120 },
      }),
      set({
        external_id: "mar",
        started_at: "2026-03-04T21:00:00.000Z",
        bpm: { count: 1, min: 128, max: 128, mean: 128, median: 128 },
      }),
    ]);
    const tiles = buildSummaryTiles(model.month.buckets, model.month.excluding);
    // Feb is a real gap (D-8) between the two dated sets — delta must still
    // skip it and compare against January, not treat the gap as "no previous".
    expect(tiles.medianBpm).toEqual({
      current: 128,
      currentBucket: "2026-03",
      delta: 8,
      // The whole point of carrying this (code review, 2026-08-07): the tile
      // must be able to say "vs January". A flat "vs previous month" would be
      // a lie here — the previous MONTH is February, which has no reading.
      deltaBucket: "2026-01",
    });
  });

  it("renders no delta at all — never a fabricated 0 — when there is no earlier bucket to compare against", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "only",
        started_at: "2026-03-04T21:00:00.000Z",
        bpm: { count: 1, min: 120, max: 120, mean: 120, median: 120 },
      }),
    ]);
    const tiles = buildSummaryTiles(model.month.buckets, model.month.excluding);
    expect(tiles.medianBpm).toEqual({
      current: 120,
      currentBucket: "2026-03",
      delta: null,
      // `null` in lockstep with `delta` — the tile renders no delta markup at
      // all, so there is no bucket to name.
      deltaBucket: null,
    });
  });

  it("is entirely null for a metric with no data anywhere in the series, not a fabricated reading", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "only",
        started_at: "2026-03-04T21:00:00.000Z",
        bpm: { count: 0, min: 0, max: 0, mean: 0, median: 0 },
      }),
    ]);
    const tiles = buildSummaryTiles(model.month.buckets, model.month.excluding);
    expect(tiles.medianBpm).toBeNull();
  });

  it("discloses the CURRENT bucket's own excluded counts, not a sum across history", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "jan",
        started_at: "2026-01-04T21:00:00.000Z",
        plays: [play({ position: 1, played_ms: null }), play({ position: 2, played_ms: null })],
      }),
      set({
        external_id: "mar",
        started_at: "2026-03-04T21:00:00.000Z",
        plays: [play({ position: 1, played_ms: 200_000 }), play({ position: 2, played_ms: null })],
      }),
    ]);
    const tiles = buildSummaryTiles(model.month.buckets, model.month.excluding);
    expect(tiles.mixPace?.current).toBe(200);
    expect(tiles.mixPaceExcludedCount).toBe(1); // March's own exclusion, not Jan's 2 + March's 1
  });
});

describe("summary-tile code-review 2026-08-07 regressions", () => {
  it("names the bucket a delta is measured against, so the tile never has to claim 'previous month'", () => {
    // The defect this guards: `latestWithDelta` skips D-8 gaps by design, but
    // the tile's copy asserted a flat "previous month". On the committed
    // fixture that made three of four tiles say "vs previous month" over an
    // August-vs-JUNE comparison, in both the visible line and the aria-label.
    const model = buildStyleEvolution([
      set({
        external_id: "nov",
        started_at: "2025-11-04T21:00:00.000Z",
        bpm: { count: 1, min: 120, max: 120, mean: 120, median: 120 },
      }),
      set({
        external_id: "aug",
        started_at: "2026-08-04T21:00:00.000Z",
        bpm: { count: 1, min: 126, max: 126, mean: 126, median: 126 },
      }),
    ]);
    const tiles = buildSummaryTiles(model.month.buckets, model.month.excluding);
    expect(tiles.medianBpm?.currentBucket).toBe("2026-08");
    expect(tiles.medianBpm?.deltaBucket).toBe("2025-11");
    // Nine months apart and across a year boundary — the exact case a fixed
    // "previous month" string misreports.
    expect(tiles.medianBpm?.delta).toBe(6);
  });

  it("still discloses the excluded-play count when NO bucket has a mix pace at all (AC-6's 'never omitted')", () => {
    // The worst case for the disclosure contract: 100% of plays excluded, so
    // there is no current bucket to hang the count on. Reporting 0 there drops
    // the count precisely when it explains everything on screen.
    const model = buildStyleEvolution([
      set({
        external_id: "only",
        started_at: "2026-03-04T21:00:00.000Z",
        plays: [play({ position: 1, played_ms: null }), play({ position: 2, played_ms: undefined })],
      }),
    ]);
    const tiles = buildSummaryTiles(model.month.buckets, model.month.excluding);
    expect(tiles.mixPace).toBeNull();
    expect(tiles.mixPaceExcludedCount).toBe(2);
  });

  it("still discloses excluded_no_key when NO bucket has a scoreable transition (AC-7, same contract)", () => {
    const model = buildStyleEvolution([
      set({
        external_id: "only",
        started_at: "2026-03-04T21:00:00.000Z",
        mixingStats: { compatible_transitions: 0, incompatible_transitions: 0, excluded_no_key: 9 },
      }),
    ]);
    const tiles = buildSummaryTiles(model.month.buckets, model.month.excluding);
    expect(tiles.harmonicMixRate).toBeNull();
    expect(tiles.harmonicExcludedNoKey).toBe(9);
  });

  it("carries a set count so AC-8's tile row can tell 'no history' from 'one month of history'", () => {
    // AC-8 narrows the gate for a DJ with ">=1 set but <2 months" and
    // explicitly does NOT touch the 0-set case. The view is handed only this
    // model, so without a count it rendered four "—" tiles at a DJ who has
    // never synced anything.
    expect(buildStyleEvolution([]).setCount).toBe(0);
    expect(
      buildStyleEvolution([set({ external_id: "a", started_at: "2026-03-04T21:00:00.000Z" })]).setCount,
    ).toBe(1);
    // Undated sets count too — they exist, they just cannot be bucketed.
    expect(buildStyleEvolution([set({ external_id: "a", started_at: null })]).setCount).toBe(1);
  });
});
