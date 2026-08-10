import { describe, expect, it } from "vitest";
import {
  buildOneAndDone,
  buildRepeatTrackRate,
  buildRotationSize,
  buildSetSimilarity,
  buildUtilizationIndex,
  buildWorkhorses,
  hasEnoughOneAndDone,
  hasEnoughRepeatHistory,
  hasEnoughRotation,
  hasEnoughSimilarityHistory,
  hasEnoughWorkhorses,
  oneAndDoneSummary,
  partitionSetsByConfidence,
  repeatTrackRateSummary,
  rotationSizeSummary,
  ROTATION_WINDOW_DAYS,
  setSimilaritySummary,
  SIMILARITY_MATRIX_SETS,
  trackKey,
  TRACK_LIST_MAX_ROWS,
  unlinkableTracksDisclosure,
  utilizationDisclosure,
  workhorsesSummary,
} from "./libraryUtilization";
import type { SetRecord, SyncPlay } from "./types";

/* ── Fixture builders, same shape as `styleEvolution.test.ts`'s ─────────── */

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

/** A titled play. `t("A", "X", "2026-06-01T22:00:00.000Z")` reads as one row. */
function t(title: string, artist: string | null, startedAt: string | null, position = 0): SyncPlay {
  return play({ position, title, artist, started_at: startedAt });
}

function set(overrides: {
  external_id: string;
  started_at: string | null;
  confidence?: number;
  trackCount?: number;
  sessionLabel?: string | null;
  plays?: SyncPlay[];
}): SetRecord {
  const plays = (overrides.plays ?? []).map((p, i) => ({ ...p, position: i }));
  return {
    external_id: overrides.external_id,
    started_at: overrides.started_at,
    ended_at: overrides.started_at,
    plays,
    session_label: overrides.sessionLabel ?? null,
    derived: {
      most_played_tracks: [],
      most_played_artists: [],
      genre_breakdown: { buckets: [], no_genre_count: 0 },
      bpm_distribution: { count: 0, min: 0, max: 0, mean: 0, median: 0 },
      camelot_mixing_stats: { compatible_transitions: 0, incompatible_transitions: 0, excluded_no_key: 0 },
      set_length_sec: null,
      track_count: overrides.trackCount ?? plays.length,
      energy_arc: [],
      confidence: {
        value: overrides.confidence ?? 1.0,
        track_count: overrides.trackCount ?? plays.length,
        long_gap_count: 0,
      },
    },
  } as SetRecord;
}

/** A dated set of `n` distinct titled tracks — clears the 6-track gate at n≥6. */
function fullSet(id: string, startedAt: string | null, titles: string[]): SetRecord {
  return set({
    external_id: id,
    started_at: startedAt,
    sessionLabel: `serato4:${id}`,
    plays: titles.map((title, i) => t(title, "Artist", startedAt, i)),
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   D-20 — the page's low-confidence contract
   ═══════════════════════════════════════════════════════════════════════════ */

describe("partitionSetsByConfidence (Story 4.9 AC-10, D-20)", () => {
  it("keeps a long, confidently-classified set", () => {
    const sets = [fullSet("a", "2026-06-01T22:00:00.000Z", ["1", "2", "3", "4", "5", "6"])];
    expect(partitionSetsByConfidence(sets).surviving).toHaveLength(1);
    expect(partitionSetsByConfidence(sets).hidden).toHaveLength(0);
  });

  it("hides a set whose confidence is below 1.0", () => {
    const sets = [
      set({
        external_id: "a",
        started_at: "2026-06-01T22:00:00.000Z",
        confidence: 0.2,
        plays: ["1", "2", "3", "4", "5", "6", "7"].map((n, i) => t(n, "Artist", null, i)),
      }),
    ];
    const { surviving, hidden } = partitionSetsByConfidence(sets);
    expect(surviving).toHaveLength(0);
    expect(hidden).toHaveLength(1);
  });

  // THE D-20 REGRESSION GUARD. `confidence.rs` is symmetric by design: a
  // session too short to be a set scores a clean 1.0, exactly like a long,
  // naturally-punctuated one. So `styleEvolution.ts`'s bare
  // `confidence.value < 1.0` lets a soundcheck straight through — and this is
  // the one test that fails if someone "reconciles" this page onto it.
  it("hides a SHORT set that scored a fully-confident 1.0 (the soundcheck trap)", () => {
    const soundcheck = fullSet("sc", "2026-06-01T18:00:00.000Z", ["1", "2", "3"]);
    expect(soundcheck.derived.confidence.value).toBe(1.0);

    const { surviving, hidden } = partitionSetsByConfidence([soundcheck]);
    expect(surviving).toHaveLength(0);
    expect(hidden).toHaveLength(1);
  });

  it("reads derived.track_count when it disagrees with plays.length", () => {
    // `track_count` is the agent's own count; `plays.length` is what synced.
    const sparse = set({ external_id: "a", started_at: null, trackCount: 3, plays: [] });
    expect(partitionSetsByConfidence([sparse]).hidden).toHaveLength(1);
  });

  it("preserves caller order in both partitions", () => {
    const sets = [
      fullSet("a", "2026-06-03T22:00:00.000Z", ["1", "2", "3", "4", "5", "6"]),
      fullSet("sc", "2026-06-02T22:00:00.000Z", ["1", "2"]),
      fullSet("b", "2026-06-01T22:00:00.000Z", ["1", "2", "3", "4", "5", "6"]),
    ];
    const { surviving, hidden } = partitionSetsByConfidence(sets);
    expect(surviving.map((s) => s.external_id)).toEqual(["a", "b"]);
    expect(hidden.map((s) => s.external_id)).toEqual(["sc"]);
  });

  it("returns two empty lists for no sets", () => {
    expect(partitionSetsByConfidence([])).toEqual({ surviving: [], hidden: [] });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D-18 — track identity
   ═══════════════════════════════════════════════════════════════════════════ */

describe("trackKey (D-18)", () => {
  it("keys on title + artist", () => {
    expect(trackKey("Song", "Artist")).toBe(trackKey("Song", "Artist"));
    expect(trackKey("Song", "Artist")).not.toBe(trackKey("Song", "Other"));
  });

  it("treats a null artist as the empty string, matching rightColumn.ts", () => {
    expect(trackKey("Song", null)).toBe(trackKey("Song", undefined));
    expect(trackKey("Song", null)).toBe(JSON.stringify(["Song", ""]));
  });

  it("does not collide across a title/artist boundary shift", () => {
    expect(trackKey("A", "BC")).not.toBe(trackKey("AB", "C"));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   The set-membership index (GAP-4)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildUtilizationIndex (GAP-4)", () => {
  it("records which sets a track appeared in, not just how often it played", () => {
    const index = buildUtilizationIndex([
      fullSet("a", "2026-06-01T22:00:00.000Z", ["Shared", "OnlyA"]),
      fullSet("b", "2026-06-02T22:00:00.000Z", ["Shared", "OnlyB"]),
    ]);
    expect(index.setsByTrack.get(trackKey("Shared", "Artist"))?.size).toBe(2);
    expect(index.setsByTrack.get(trackKey("OnlyA", "Artist"))?.size).toBe(1);
  });

  // D-18's double-count guard: `track_id` is optional and null whenever the
  // source carried no portable path, so one track's plays routinely split
  // between rows that do and don't carry a hash. Keyed on title+artist they
  // are one track; keyed on `track_id` they would be two (one of them the
  // `null` bucket, which `playsByTrack` drops entirely).
  it("counts one track once when its plays split across rows with and without track_id", () => {
    const withHash = { ...t("Song", "Artist", "2026-06-01T22:00:00.000Z"), track_id: "abc123" };
    const withoutHash = { ...t("Song", "Artist", "2026-06-01T23:00:00.000Z"), track_id: null };
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [withHash, withoutHash, t("B", "Artist", null), t("C", "Artist", null), t("D", "Artist", null), t("E", "Artist", null)],
      }),
    ]);
    expect(index.playsByKey.get(trackKey("Song", "Artist"))).toBe(2);
    expect(index.displayByKey.size).toBe(5);
  });

  it("excludes null-title plays and discloses the count", () => {
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [t("Named", "Artist", null), play({ position: 1 }), play({ position: 2 })],
      }),
    ]);
    expect(index.nullTitlePlayCount).toBe(2);
    expect(index.displayByKey.size).toBe(1);
    expect(index.all[0].playCount).toBe(1);
  });

  it("falls back to 'Unknown' for a missing artist (AD-11)", () => {
    const index = buildUtilizationIndex([
      set({ external_id: "a", started_at: null, plays: [t("Song", null, null)] }),
    ]);
    expect(index.displayByKey.get(trackKey("Song", null))).toEqual({ title: "Song", artist: "Unknown" });
  });

  it("orders dated sets oldest-first and drops undated ones into a disclosed count", () => {
    const index = buildUtilizationIndex([
      fullSet("newest", "2026-06-03T22:00:00.000Z", ["1"]),
      fullSet("undated", null, ["2"]),
      fullSet("oldest", "2026-06-01T22:00:00.000Z", ["3"]),
    ]);
    expect(index.dated.map((s) => s.id)).toEqual(["oldest", "newest"]);
    expect(index.undatedSetCount).toBe(1);
    expect(index.all).toHaveLength(3);
  });

  it("does not put NaN into the comparator for an unparsable date", () => {
    const index = buildUtilizationIndex([
      fullSet("bad", "not-a-date", ["1"]),
      fullSet("good", "2026-06-01T22:00:00.000Z", ["2"]),
    ]);
    expect(index.dated.map((s) => s.id)).toEqual(["good"]);
    expect(index.undatedSetCount).toBe(1);
  });

  it("labels axes from session_label, never the raw uuid external_id", () => {
    const index = buildUtilizationIndex([
      set({
        external_id: "872d5614-9894-5803-80f5-aa1dd4177944",
        started_at: "2026-06-01T22:00:00.000Z",
        sessionLabel: "serato4:975",
        plays: [t("Song", "Artist", null)],
      }),
    ]);
    expect(index.all[0].label).not.toContain("872d5614");
    expect(index.all[0].label).toContain("975");
  });

  it("tracks the most recent play time, and is not reset by an undated play", () => {
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [
          t("Song", "Artist", "2026-06-01T22:00:00.000Z"),
          t("Song", "Artist", null),
          t("Song", "Artist", "2026-06-01T23:00:00.000Z"),
        ],
      }),
    ]);
    expect(index.lastPlayedMsByKey.get(trackKey("Song", "Artist"))).toBe(
      new Date("2026-06-01T23:00:00.000Z").getTime(),
    );
  });

  it("gives a track with no parseable play time -Infinity rather than NaN", () => {
    const index = buildUtilizationIndex([
      set({ external_id: "a", started_at: null, plays: [t("Song", "Artist", null)] }),
    ]);
    expect(index.lastPlayedMsByKey.get(trackKey("Song", "Artist"))).toBe(-Infinity);
  });

  it("returns empty structures for no sets", () => {
    const index = buildUtilizationIndex([]);
    expect(index.dated).toEqual([]);
    expect(index.all).toEqual([]);
    expect(index.nullTitlePlayCount).toBe(0);
    expect(index.undatedSetCount).toBe(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-2 / AC-3 — repeat-track rate (D-17)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildRepeatTrackRate (AC-2, AC-3, D-17)", () => {
  const day = (n: number) => `2026-06-${String(n).padStart(2, "0")}T22:00:00.000Z`;

  it("EXCLUDES the oldest set rather than scoring it 0% (D-8: a gap, never a fabricated zero)", () => {
    // Two sets, fully identical. The newer carries 100%; the older has no
    // predecessor. Scoring the older as 0 would yield a mean of 50%.
    const index = buildUtilizationIndex([
      fullSet("old", day(1), ["A", "B"]),
      fullSet("new", day(2), ["A", "B"]),
    ]);
    const model = buildRepeatTrackRate(index);
    expect(model.rate).toBe(1);
    expect(model.measuredSetCount).toBe(1);
  });

  it("is the exactly-2-sets boundary AC-2's gate is written for", () => {
    const index = buildUtilizationIndex([
      fullSet("old", day(1), ["A", "B", "C", "D"]),
      fullSet("new", day(2), ["A", "B", "X", "Y"]),
    ]);
    const model = buildRepeatTrackRate(index);
    expect(model.measuredSetCount).toBe(1);
    expect(model.rate).toBe(0.5);
  });

  it("takes the UNWEIGHTED mean of per-set shares, not a play-weighted one", () => {
    // Set 2: 1 of 1 carried over  → 100%
    // Set 3: 1 of 4 carried over  → 25%
    // Unweighted mean = 62.5%. A track-weighted mean would be 2/5 = 40%.
    const index = buildUtilizationIndex([
      fullSet("s1", day(1), ["A"]),
      fullSet("s2", day(2), ["A"]),
      fullSet("s3", day(3), ["A", "X", "Y", "Z"]),
    ]);
    expect(buildRepeatTrackRate(index).rate).toBeCloseTo(0.625, 10);
    expect(buildRepeatTrackRate(index).measuredSetCount).toBe(2);
  });

  it("measures each set against its own up-to-5 PREDECESSORS, never itself", () => {
    // s7's window is s2..s6. "A" appears only in s1 and s7, so it is NOT a
    // carryover for s7 — and s7's own copy of "A" must not make it one.
    const index = buildUtilizationIndex([
      fullSet("s1", day(1), ["A"]),
      fullSet("s2", day(2), ["B"]),
      fullSet("s3", day(3), ["C"]),
      fullSet("s4", day(4), ["D"]),
      fullSet("s5", day(5), ["E"]),
      fullSet("s6", day(6), ["F"]),
      fullSet("s7", day(7), ["A"]),
    ]);
    const index7 = buildUtilizationIndex([
      fullSet("s1", day(1), ["A"]),
      fullSet("s2", day(2), ["B"]),
      fullSet("s3", day(3), ["C"]),
      fullSet("s4", day(4), ["D"]),
      fullSet("s5", day(5), ["E"]),
      fullSet("s6", day(6), ["F"]),
    ]);
    // Sets 2..6 all carry 0%; set 7 carries 0% too because "A" fell out of the
    // 5-set window. Mean over 6 measured sets is 0.
    expect(buildRepeatTrackRate(index).rate).toBe(0);
    expect(buildRepeatTrackRate(index).measuredSetCount).toBe(6);
    expect(buildRepeatTrackRate(index7).measuredSetCount).toBe(5);
  });

  it("counts a repeat that is 5 sets back but not 6", () => {
    const within = buildUtilizationIndex([
      fullSet("s1", day(1), ["A"]),
      fullSet("s2", day(2), ["B"]),
      fullSet("s3", day(3), ["C"]),
      fullSet("s4", day(4), ["D"]),
      fullSet("s5", day(5), ["E"]),
      fullSet("s6", day(6), ["A"]), // s1 is 5 back — inside the window.
    ]);
    // s2..s5 carry 0, s6 carries 1 → mean 1/5.
    expect(buildRepeatTrackRate(within).rate).toBeCloseTo(0.2, 10);
  });

  it("returns null with no measurable set rather than 0% (D-8)", () => {
    expect(buildRepeatTrackRate(buildUtilizationIndex([])).rate).toBeNull();
    const one = buildUtilizationIndex([fullSet("s1", day(1), ["A"])]);
    expect(buildRepeatTrackRate(one).rate).toBeNull();
    expect(buildRepeatTrackRate(one).measuredSetCount).toBe(0);
    expect(hasEnoughRepeatHistory(buildRepeatTrackRate(one))).toBe(false);
  });

  it("skips a set with no identified tracks rather than dividing by zero", () => {
    const index = buildUtilizationIndex([
      fullSet("s1", day(1), ["A"]),
      set({ external_id: "empty", started_at: day(2), plays: [play({ position: 0 })] }),
      fullSet("s3", day(3), ["A"]),
    ]);
    const model = buildRepeatTrackRate(index);
    expect(model.measuredSetCount).toBe(1);
    expect(model.rate).toBe(1);
  });

  it("does not let an undated set poison the ordering", () => {
    const index = buildUtilizationIndex([
      fullSet("s1", day(1), ["A"]),
      fullSet("undated", null, ["Z"]),
      fullSet("s2", day(2), ["A"]),
    ]);
    const model = buildRepeatTrackRate(index);
    expect(model.rate).toBe(1);
    expect(model.measuredSetCount).toBe(1);
    expect(model.undatedSetCount).toBe(1);
  });

  it("summarises the rate with the sample size beside it, and names the region below the gate", () => {
    const index = buildUtilizationIndex([
      fullSet("s1", day(1), ["A", "B"]),
      fullSet("s2", day(2), ["A", "B"]),
    ]);
    expect(repeatTrackRateSummary(buildRepeatTrackRate(index))).toContain("100%");
    expect(repeatTrackRateSummary(buildRepeatTrackRate(index))).toContain("1 night");
    expect(repeatTrackRateSummary(buildRepeatTrackRate(buildUtilizationIndex([])))).toBe("Repeat tracks");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-4 — set similarity (D-19)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildSetSimilarity (AC-4, D-19)", () => {
  const day = (n: number) => `2026-06-${String(n).padStart(2, "0")}T22:00:00.000Z`;

  it("scores identical sets 1 and disjoint sets 0", () => {
    const identical = buildSetSimilarity(
      buildUtilizationIndex([fullSet("a", day(1), ["A", "B"]), fullSet("b", day(2), ["A", "B"])]),
    );
    expect(identical.ranked[0].share).toBe(1);

    const disjoint = buildSetSimilarity(
      buildUtilizationIndex([fullSet("a", day(1), ["A", "B"]), fullSet("b", day(2), ["X", "Y"])]),
    );
    expect(disjoint.ranked[0].share).toBe(0);
  });

  it("computes Jaccard, not raw intersection", () => {
    // A={1,2,3}, B={3,4}. Intersection 1, union 4 → 0.25.
    const model = buildSetSimilarity(
      buildUtilizationIndex([fullSet("a", day(1), ["1", "2", "3"]), fullSet("b", day(2), ["3", "4"])]),
    );
    expect(model.ranked[0].share).toBe(0.25);
  });

  it("leaves the diagonal null — a set against itself says nothing", () => {
    const model = buildSetSimilarity(
      buildUtilizationIndex([fullSet("a", day(1), ["A"]), fullSet("b", day(2), ["A"])]),
    );
    expect(model.matrix[0][0]).toBeNull();
    expect(model.matrix[1][1]).toBeNull();
    expect(model.matrix[0][1]).toBe(1);
    expect(model.matrix[1][0]).toBe(1);
  });

  it("leaves a pair null when either set has no identified tracks (0/0 is unknown, not 0)", () => {
    const model = buildSetSimilarity(
      buildUtilizationIndex([
        fullSet("a", day(1), ["A"]),
        set({ external_id: "empty", started_at: day(2), plays: [play({ position: 0 })] }),
      ]),
    );
    expect(model.matrix[0][1]).toBeNull();
    expect(model.ranked).toHaveLength(0);
    expect(hasEnoughSimilarityHistory(model)).toBe(false);
  });

  it("caps at SIMILARITY_MATRIX_SETS and REPORTS the cap rather than truncating silently", () => {
    const sets = Array.from({ length: 14 }, (_, i) => fullSet(`s${i}`, day(i + 1), ["A", `T${i}`]));
    const model = buildSetSimilarity(buildUtilizationIndex(sets));
    expect(SIMILARITY_MATRIX_SETS).toBe(10);
    expect(model.shownSetCount).toBe(10);
    expect(model.survivingSetCount).toBe(14);
    expect(model.truncated).toBe(true);
    expect(model.matrix).toHaveLength(10);
    expect(setSimilaritySummary(model)).toContain("10 most recent sets of 14");
  });

  it("shows the NEWEST sets when it truncates, not the oldest", () => {
    const sets = Array.from({ length: 12 }, (_, i) =>
      set({
        external_id: `s${i}`,
        started_at: day(i + 1),
        sessionLabel: `serato4:${900 + i}`,
        plays: ["A", `T${i}`].map((t2, j) => t(t2, "Artist", day(i + 1), j)),
      }),
    );
    const model = buildSetSimilarity(buildUtilizationIndex(sets));
    // `label` still carries the session identity even though the AXIS now
    // shows a date — the newest-first slice is what this case is about.
    expect(model.axes[0].label).toBe("SET 911");
    expect(model.axes.map((a) => a.label)).not.toContain("SET 900");
  });

  it("does not flag truncation when everything fits", () => {
    const model = buildSetSimilarity(
      buildUtilizationIndex([fullSet("a", day(1), ["A"]), fullSet("b", day(2), ["A"])]),
    );
    expect(model.truncated).toBe(false);
    expect(setSimilaritySummary(model)).not.toContain("most recent sets of");
  });

  it("ranks most-alike first and carries it into the text equivalent", () => {
    const model = buildSetSimilarity(
      buildUtilizationIndex([
        set({ external_id: "a", started_at: day(1), sessionLabel: "serato4:1", plays: [t("A", "Artist", day(1))] }),
        set({ external_id: "b", started_at: day(2), sessionLabel: "serato4:2", plays: [t("X", "Artist", day(2))] }),
        set({ external_id: "c", started_at: day(3), sessionLabel: "serato4:3", plays: [t("A", "Artist", day(3))] }),
      ]),
    );
    expect(model.ranked[0].share).toBe(1);
    const summary = setSimilaritySummary(model);
    // The two nights that share a track — named by DATE since 2026-08-10, the
    // same vocabulary the axes and the ranked list use. `a` and `c` are the
    // pair; `b` shares nothing with either.
    expect(summary).toContain(model.axes.find((x) => x.label === "SET 3")!.dayLabel);
    expect(summary).toContain(model.axes.find((x) => x.label === "SET 1")!.dayLabel);
    expect(summary).toContain("100%");
  });

  it("names the region rather than a figure when there is nothing to compare", () => {
    expect(setSimilaritySummary(buildSetSimilarity(buildUtilizationIndex([])))).toBe("Set similarity");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-5 — workhorses
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildWorkhorses (AC-5)", () => {
  const day = (n: number) => `2026-06-${String(n).padStart(2, "0")}T22:00:00.000Z`;

  // THE AC-5 CONTRAST. The dashboard's most-played ranks by play count; this
  // ranks by set count. "Spread" plays once in three sets; "Hammered" plays
  // four times in one. The two surfaces must disagree, on purpose.
  it("ranks by SET COUNT, not play count — the deliberate difference from most-played", () => {
    const model = buildWorkhorses(
      buildUtilizationIndex([
        set({
          external_id: "a",
          started_at: day(1),
          plays: [
            t("Hammered", "Artist", day(1), 0),
            t("Hammered", "Artist", day(1), 1),
            t("Hammered", "Artist", day(1), 2),
            t("Hammered", "Artist", day(1), 3),
            t("Spread", "Artist", day(1), 4),
          ],
        }),
        set({ external_id: "b", started_at: day(2), plays: [t("Spread", "Artist", day(2))] }),
        set({ external_id: "c", started_at: day(3), plays: [t("Spread", "Artist", day(3))] }),
      ]),
    );
    expect(model.rows[0].title).toBe("Spread");
    expect(model.rows[0].setCount).toBe(3);
    expect(model.rows[0].plays).toBe(3);
    // "Hammered" has more plays but only one set, so it is not a workhorse at all.
    expect(model.rows.map((r) => r.title)).not.toContain("Hammered");
  });

  it("resolves ties to a stable TOTAL order: sets, then plays, then first-seen", () => {
    const build = () =>
      buildWorkhorses(
        buildUtilizationIndex([
          set({
            external_id: "a",
            started_at: day(1),
            plays: [t("First", "Artist", day(1), 0), t("Second", "Artist", day(1), 1), t("Third", "Artist", day(1), 2), t("Third", "Artist", day(1), 3)],
          }),
          set({
            external_id: "b",
            started_at: day(2),
            plays: [t("First", "Artist", day(2), 0), t("Second", "Artist", day(2), 1), t("Third", "Artist", day(2), 2)],
          }),
        ]),
      );
    // All three appear in 2 sets. "Third" has 3 plays and leads; "First" and
    // "Second" tie at 2 plays and fall back to first-seen order.
    expect(build().rows.map((r) => r.title)).toEqual(["Third", "First", "Second"]);
    // Deterministic across repeated builds — no comparator returning 0.
    expect(build().rows.map((r) => r.title)).toEqual(build().rows.map((r) => r.title));
  });

  it("counts whole sets, not the dancefloor segment (that scoping belongs to the dashboard)", () => {
    // Two plays in a two-play set: too short for dancefloor detection to have
    // scoped anything, and they still count here.
    const model = buildWorkhorses(
      buildUtilizationIndex([
        set({ external_id: "a", started_at: day(1), plays: [t("Song", "Artist", day(1))] }),
        set({ external_id: "b", started_at: day(2), plays: [t("Song", "Artist", day(2))] }),
      ]),
    );
    expect(model.rows[0].setCount).toBe(2);
  });

  it("returns an empty list, not a fabricated row, when nothing has repeated", () => {
    const model = buildWorkhorses(
      buildUtilizationIndex([fullSet("a", day(1), ["A"]), fullSet("b", day(2), ["B"])]),
    );
    expect(model.rows).toEqual([]);
    expect(hasEnoughWorkhorses(model)).toBe(false);
    expect(workhorsesSummary(model)).toBe("Workhorses");
  });

  it("carries the null-title exclusion count for disclosure", () => {
    const model = buildWorkhorses(
      buildUtilizationIndex([
        set({ external_id: "a", started_at: day(1), plays: [t("Song", "Artist", day(1), 0), play({ position: 1 })] }),
        set({ external_id: "b", started_at: day(2), plays: [t("Song", "Artist", day(2))] }),
      ]),
    );
    expect(model.nullTitlePlayCount).toBe(1);
  });

  it("uses no ranking vocabulary in its summary (DESIGN.md:199)", () => {
    const model = buildWorkhorses(
      buildUtilizationIndex([fullSet("a", day(1), ["A"]), fullSet("b", day(2), ["A"])]),
    );
    const summary = workhorsesSummary(model).toLowerCase();
    for (const banned of ["top", "best", "#1", "winner", "champion", "leader"]) {
      expect(summary).not.toContain(banned);
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-6 — one-and-done
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildOneAndDone (AC-6)", () => {
  const day = (n: number) => `2026-06-${String(n).padStart(2, "0")}T22:00:00.000Z`;

  it("EXCLUDES a track played twice inside a single set", () => {
    const model = buildOneAndDone(
      buildUtilizationIndex([
        set({
          external_id: "a",
          started_at: day(1),
          plays: [t("Twice", "Artist", day(1), 0), t("Twice", "Artist", day(1), 1), t("Once", "Artist", day(1), 2)],
        }),
      ]),
    );
    expect(model.rows.map((r) => r.title)).toEqual(["Once"]);
  });

  it("excludes a track played once in each of two sets", () => {
    const model = buildOneAndDone(
      buildUtilizationIndex([
        set({ external_id: "a", started_at: day(1), plays: [t("Song", "Artist", day(1))] }),
        set({ external_id: "b", started_at: day(2), plays: [t("Song", "Artist", day(2))] }),
      ]),
    );
    expect(model.rows).toEqual([]);
  });

  it("orders most-recently-played first — actionable, not alphabetical", () => {
    const model = buildOneAndDone(
      buildUtilizationIndex([
        set({
          external_id: "a",
          started_at: day(1),
          plays: [t("Aardvark", "Artist", day(1), 0), t("Zebra", "Artist", day(3), 1)],
        }),
      ]),
    );
    expect(model.rows.map((r) => r.title)).toEqual(["Zebra", "Aardvark"]);
  });

  it("sorts a track with no parseable play time last rather than throwing off the order", () => {
    const model = buildOneAndDone(
      buildUtilizationIndex([
        set({
          external_id: "a",
          started_at: day(1),
          plays: [t("Undated", "Artist", null, 0), t("Dated", "Artist", day(1), 1)],
        }),
      ]),
    );
    expect(model.rows.map((r) => r.title)).toEqual(["Dated", "Undated"]);
  });

  it("names the region when the list is empty", () => {
    expect(oneAndDoneSummary(buildOneAndDone(buildUtilizationIndex([])))).toBe("Played once");
    expect(hasEnoughOneAndDone(buildOneAndDone(buildUtilizationIndex([])))).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-7 — rotation size (D-21)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildRotationSize (AC-7, D-21)", () => {
  const NOW = new Date("2026-08-08T12:00:00.000Z").getTime();
  const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

  it("reports total plays and distinct tracks over a FIXED 60-day window", () => {
    const model = buildRotationSize(
      buildUtilizationIndex([
        set({
          external_id: "a",
          started_at: daysAgo(5),
          plays: [t("A", "Artist", daysAgo(5), 0), t("A", "Artist", daysAgo(5), 1), t("B", "Artist", daysAgo(5), 2)],
        }),
      ]),
      NOW,
    );
    expect(model.totalPlays).toBe(3);
    expect(model.distinctTracks).toBe(2);
    expect(model.windowDays).toBe(60);
    expect(ROTATION_WINDOW_DAYS).toBe(60);
  });

  it("excludes a set older than the window", () => {
    const model = buildRotationSize(
      buildUtilizationIndex([
        set({ external_id: "old", started_at: daysAgo(61), plays: [t("A", "Artist", daysAgo(61))] }),
        set({ external_id: "new", started_at: daysAgo(59), plays: [t("B", "Artist", daysAgo(59))] }),
      ]),
      NOW,
    );
    expect(model.setCount).toBe(1);
    expect(model.distinctTracks).toBe(1);
  });

  it("excludes a future-dated set (clock skew), matching the live conversion rate's guard", () => {
    const model = buildRotationSize(
      buildUtilizationIndex([
        set({ external_id: "future", started_at: daysAgo(-3), plays: [t("A", "Artist", null)] }),
      ]),
      NOW,
    );
    expect(model.setCount).toBe(0);
    expect(model.totalPlays).toBeNull();
  });

  it("returns null figures, not zeros, when no set falls inside the window (D-8)", () => {
    const model = buildRotationSize(buildUtilizationIndex([]), NOW);
    expect(model.totalPlays).toBeNull();
    expect(model.distinctTracks).toBeNull();
    expect(hasEnoughRotation(model)).toBe(false);
    expect(rotationSizeSummary(model)).toBe("Rotation size");
  });

  it("counts undated sets nowhere, and discloses them", () => {
    const model = buildRotationSize(
      buildUtilizationIndex([
        set({ external_id: "u", started_at: null, plays: [t("A", "Artist", null)] }),
        set({ external_id: "d", started_at: daysAgo(1), plays: [t("B", "Artist", daysAgo(1))] }),
      ]),
      NOW,
    );
    expect(model.setCount).toBe(1);
    expect(model.distinctTracks).toBe(1);
    expect(model.undatedSetCount).toBe(1);
  });

  it("names its own 60-day window in the summary (D-21)", () => {
    const model = buildRotationSize(
      buildUtilizationIndex([set({ external_id: "a", started_at: daysAgo(1), plays: [t("A", "Artist", daysAgo(1))] })]),
      NOW,
    );
    expect(rotationSizeSummary(model)).toContain("60 days");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Page-level disclosure
   ═══════════════════════════════════════════════════════════════════════════ */

describe("utilizationDisclosure", () => {
  it("returns null when there is nothing to disclose — never '0 plays excluded' (4.7's R-2)", () => {
    expect(utilizationDisclosure(buildUtilizationIndex([]))).toBeNull();
    const clean = buildUtilizationIndex([
      set({ external_id: "a", started_at: "2026-06-01T22:00:00.000Z", plays: [t("A", "Artist", null)] }),
    ]);
    expect(utilizationDisclosure(clean)).toBeNull();
  });

  it("discloses excluded null-title plays", () => {
    const index = buildUtilizationIndex([
      set({ external_id: "a", started_at: "2026-06-01T22:00:00.000Z", plays: [play({ position: 0 }), play({ position: 1 })] }),
    ]);
    expect(utilizationDisclosure(index)).toContain("2 plays have no track name");
  });

  it("discloses undated sets, and both clauses together when both apply", () => {
    const index = buildUtilizationIndex([
      set({ external_id: "a", started_at: null, plays: [play({ position: 0 })] }),
    ]);
    const line = utilizationDisclosure(index);
    expect(line).toContain("1 play has no track name");
    expect(line).toContain("1 set has no date");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Code-review regression guards (2026-08-08)

   Every test below pins a defect the review found. They are grouped rather
   than filed under each builder's own describe block, because what they have
   in common is the reason the suite missed them: the existing assertions check
   FIGURES (`toContain("100%")`, `toContain("60 days")`) and never the prose
   around them, so four separate copy defects — a wrong pronoun antecedent, a
   window ceiling stated as a count, an accessible name renaming its own
   figure, and a disclosure over-claiming its scope — were all structurally
   invisible to 476 passing tests.
   ═══════════════════════════════════════════════════════════════════════════ */

describe("review regressions", () => {
  it("rotation size returns null, not 0, when a windowed set yields no identified plays", () => {
    // The set falls inside the window and has plays, but every one of them is
    // untitled — so there is nothing to count. Gating on sets-in-window
    // reported "0 plays, 0 unique", which is D-8's fabricated zero and the
    // Story 4.7 R-2 shape.
    const now = Date.parse("2026-06-10T00:00:00.000Z");
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T22:00:00.000Z",
        trackCount: 8,
        plays: [play({ position: 0 }), play({ position: 1 })],
      }),
    ]);
    const model = buildRotationSize(index, now);

    expect(model.setCount).toBe(1);
    expect(model.totalPlays).toBeNull();
    expect(model.distinctTracks).toBeNull();
    expect(hasEnoughRotation(model)).toBe(false);
    expect(rotationSizeSummary(model)).toBe("Rotation size");
  });

  it("treats an empty-string title as unidentified rather than a phantom track", () => {
    // `title == null` alone let `""` through, keying every such play under
    // `["",""]` — one phantom track that could rank in Workhorses and render
    // as a blank row. `plays.title` is a bare nullable text column, so `""` is
    // reachable.
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [t("", "Artist", "2026-06-01T22:00:00.000Z"), t("", "Other", "2026-06-01T22:05:00.000Z")],
      }),
    ]);

    expect(index.playsByKey.size).toBe(0);
    expect(index.nullTitlePlayCount).toBe(2);
    expect(utilizationDisclosure(index)).toContain("2 plays have no track name");
  });

  it("renders an empty-string artist as Unknown, never as a blank", () => {
    // `?? "Unknown"` never fires for `""` because `""` is not nullish, so the
    // row rendered with an omitted artist — the one thing AD-11 forbids.
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [t("Track", "", "2026-06-01T22:00:00.000Z")],
      }),
    ]);

    const display = [...index.displayByKey.values()][0];
    expect(display.artist).toBe("Unknown");
  });

  it("labels the axes by DATE, and carries the route key and session label alongside", () => {
    // Changed 2026-08-10 (Arjun): the axis used to render a bare `975` — the
    // Serato `history_session` id, which means nothing to a DJ. It now renders
    // the night. `setId` rides along because the axes are links into
    // `/set/[id]`, and `label` because the accessible name still names the set
    // the way the rest of the product does.
    const index = buildUtilizationIndex([
      set({
        external_id: "set-a",
        started_at: "2026-06-01T22:00:00.000Z",
        sessionLabel: "serato4:101",
        trackCount: 6,
        plays: [t("A", "X", "2026-06-01T22:00:00.000Z"), t("B", "X", "2026-06-01T22:01:00.000Z")],
      }),
      set({
        external_id: "set-b",
        started_at: "2026-06-02T22:00:00.000Z",
        sessionLabel: "serato4:102",
        trackCount: 6,
        plays: [t("A", "X", "2026-06-02T22:00:00.000Z"), t("C", "X", "2026-06-02T22:01:00.000Z")],
      }),
    ]);
    const model = buildSetSimilarity(index);

    // Newest-first. `vitest.config.ts` pins TZ=UTC and LC_ALL=en-US, so these
    // strings are deterministic here — the rendered form for a DJ in another
    // zone is a browser-pass question, not a unit-test one.
    expect(model.axes.map((a) => a.dayLabel)).toEqual(["Tue, Jun 2", "Mon, Jun 1"]);
    expect(model.axes.map((a) => a.setId)).toEqual(["set-b", "set-a"]);
    expect(model.axes.map((a) => a.label)).toEqual(["SET 102", "SET 101"]);
    expect(setSimilaritySummary(model)).toContain("Tue, Jun 2");
    expect(setSimilaritySummary(model)).toContain("Mon, Jun 1");
  });

  it("disambiguates two sets on the SAME night with their session numbers, not a counter", () => {
    // Two gigs in one night is ordinary. A bare counter would read "Jun 1 1" /
    // "Jun 1 2", which looks like a typo and identifies neither.
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T18:00:00.000Z",
        sessionLabel: "serato4:101",
        trackCount: 6,
        plays: [t("A", "X", "2026-06-01T18:00:00.000Z"), t("B", "X", "2026-06-01T18:01:00.000Z")],
      }),
      set({
        external_id: "b",
        started_at: "2026-06-01T23:00:00.000Z",
        sessionLabel: "serato4:102",
        trackCount: 6,
        plays: [t("A", "X", "2026-06-01T23:00:00.000Z"), t("C", "X", "2026-06-01T23:01:00.000Z")],
      }),
    ]);
    const model = buildSetSimilarity(index);

    expect(model.axes.map((a) => a.dayLabel)).toEqual(["Mon, Jun 1 · 102", "Mon, Jun 1 · 101"]);
    expect(new Set(model.axes.map((a) => a.dayLabel)).size).toBe(2);
  });

  it("falls back to a counter when same-night sets have no session label either", () => {
    // Two sets with no `session_label` both fall back to "Untitled set", so
    // there is no number to disambiguate with — the numeric guard is what
    // keeps the axes unique and the React keys distinct (AC-4, SC 1.4.1).
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T18:00:00.000Z",
        trackCount: 6,
        plays: [t("A", "X", "2026-06-01T18:00:00.000Z"), t("B", "X", "2026-06-01T18:01:00.000Z")],
      }),
      set({
        external_id: "b",
        started_at: "2026-06-01T23:00:00.000Z",
        trackCount: 6,
        plays: [t("A", "X", "2026-06-01T23:00:00.000Z"), t("C", "X", "2026-06-01T23:01:00.000Z")],
      }),
    ]);
    const model = buildSetSimilarity(index);
    const days = model.axes.map((a) => a.dayLabel);

    expect(new Set(days).size).toBe(days.length);
    expect(days).toEqual(["Mon, Jun 1 1", "Mon, Jun 1 2"]);
    expect(setSimilaritySummary(model)).toContain("Mon, Jun 1 1");
  });

  it("leaves already-unique labels untouched", () => {
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T22:00:00.000Z",
        sessionLabel: "serato4:101",
        plays: [t("A", "X", "2026-06-01T22:00:00.000Z")],
      }),
      set({
        external_id: "b",
        started_at: "2026-06-02T22:00:00.000Z",
        sessionLabel: "serato4:102",
        plays: [t("A", "X", "2026-06-02T22:00:00.000Z")],
      }),
    ]);

    // Distinct nights, so no suffix is added to either axis.
    expect(buildSetSimilarity(index).axes.map((a) => a.dayLabel)).toEqual([
      "Tue, Jun 2",
      "Mon, Jun 1",
    ]);
  });

  it("names the unit in the workhorses summary instead of a pronoun with the wrong antecedent", () => {
    // "1 track has carried… has appeared in 12 of them" read as 12 of 1: the
    // nearest antecedent for "them" is the TRACK count, but the figure is a
    // SET count.
    const sets = Array.from({ length: 3 }, (_, i) =>
      set({
        external_id: `s${i}`,
        started_at: `2026-06-0${i + 1}T22:00:00.000Z`,
        trackCount: 6,
        plays: [t("Shared", "X", `2026-06-0${i + 1}T22:00:00.000Z`)],
      }),
    );
    const summary = workhorsesSummary(buildWorkhorses(buildUtilizationIndex(sets)));

    expect(summary).toContain("appeared in 3 sets");
    expect(summary).not.toContain("of them");
  });

  it("states the repeat window as a ceiling, not as a count of sets that exist", () => {
    // At exactly 2 surviving sets there is exactly 1 predecessor, so "the 5
    // sets before it" names a history the DJ does not have — at precisely the
    // boundary AC-2's gate is written to admit.
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T22:00:00.000Z",
        trackCount: 6,
        plays: [t("A", "X", "2026-06-01T22:00:00.000Z")],
      }),
      set({
        external_id: "b",
        started_at: "2026-06-02T22:00:00.000Z",
        trackCount: 6,
        plays: [t("A", "X", "2026-06-02T22:00:00.000Z")],
      }),
    ]);
    const summary = repeatTrackRateSummary(buildRepeatTrackRate(index));

    expect(summary).toContain("up-to-5 sets");
    expect(summary).toContain("1 night");
  });

  it("uses the same nouns in the rotation accessible name as the visible readout, pluralized", () => {
    const now = Date.parse("2026-06-10T00:00:00.000Z");
    const index = buildUtilizationIndex([
      set({
        external_id: "a",
        started_at: "2026-06-01T22:00:00.000Z",
        trackCount: 6,
        plays: [t("A", "X", "2026-06-01T22:00:00.000Z")],
      }),
    ]);
    const summary = rotationSizeSummary(buildRotationSize(index, now));

    expect(summary).toContain("1 play.");
    expect(summary).not.toContain("1 plays");
    expect(summary).not.toContain("1 tracks");
  });

  it("scopes each disclosure clause to the figures it actually governs", () => {
    // One "not counted in the stats above" tail cannot cover both clauses:
    // null-title plays are absent everywhere, but undated sets are still
    // counted by workhorses and played-once. "Above" also over-claimed against
    // the meter and the trend, which exclude neither.
    const index = buildUtilizationIndex([
      set({ external_id: "a", started_at: null, plays: [play({ position: 0 })] }),
    ]);
    const line = utilizationDisclosure(index) ?? "";

    expect(line).toContain("absent from every utilization figure here");
    expect(line).toContain("absent from the repeat rate, set similarity and rotation size");
    expect(line).not.toContain("the stats above");
  });

  it("reports zero identified tracks so one-and-done can tell its two empty states apart", () => {
    // `rows.length === 0` is true both when every track came round again and
    // when nothing was ever played. The module shipped one string for both,
    // telling a DJ with no plays that "every track you've played has come
    // round again" — the state empty production actually renders.
    const empty = buildOneAndDone(buildUtilizationIndex([]));
    expect(empty.rows).toHaveLength(0);
    expect(empty.identifiedTrackCount).toBe(0);

    const played = buildOneAndDone(
      buildUtilizationIndex([
        set({
          external_id: "a",
          started_at: "2026-06-01T22:00:00.000Z",
          trackCount: 6,
          plays: [t("A", "X", "2026-06-01T22:00:00.000Z"), t("A", "X", "2026-06-01T22:05:00.000Z")],
        }),
      ]),
    );
    expect(played.rows).toHaveLength(0);
    expect(played.identifiedTrackCount).toBe(1);
  });
});

describe("track-list row cap (code review decision, 2026-08-08)", () => {
  /** N sets each replaying one shared track plus its own unique one. */
  function setsWithDistinctTracks(n: number) {
    return Array.from({ length: n }, (_, i) =>
      set({
        external_id: `s${i}`,
        started_at: `2026-06-${String(i + 1).padStart(2, "0")}T22:00:00.000Z`,
        trackCount: 6,
        plays: [
          t("Shared", "X", `2026-06-${String(i + 1).padStart(2, "0")}T22:00:00.000Z`),
          t(`Solo ${i}`, "X", `2026-06-${String(i + 1).padStart(2, "0")}T22:05:00.000Z`),
        ],
      }),
    );
  }

  it("caps one-and-done rows while reporting the true total, so the cap can be stated", () => {
    // 60 sets → 60 tracks played exactly once, past the 50-row cap.
    const model = buildOneAndDone(buildUtilizationIndex(setsWithDistinctTracks(60)));

    expect(model.rows).toHaveLength(TRACK_LIST_MAX_ROWS);
    expect(model.totalRowCount).toBe(60);
    expect(model.truncated).toBe(true);
    // The accessible name states what QUALIFIED, never the cap — announcing 50
    // would present a payload decision as the DJ's figure.
    expect(oneAndDoneSummary(model)).toContain("60 tracks");
  });

  it("does not mark a short list truncated", () => {
    const model = buildOneAndDone(buildUtilizationIndex(setsWithDistinctTracks(3)));

    expect(model.truncated).toBe(false);
    expect(model.rows).toHaveLength(model.totalRowCount);
  });

  it("caps workhorses the same way and keeps the highest-ranked rows", () => {
    // Every track appears in all 60 sets, so all 60 qualify as workhorses.
    const sets = Array.from({ length: 60 }, (_, i) =>
      set({
        external_id: `w${i}`,
        started_at: `2026-06-${String(i + 1).padStart(2, "0")}T22:00:00.000Z`,
        trackCount: 6,
        plays: Array.from({ length: 60 }, (_, k) =>
          t(`Track ${k}`, "X", `2026-06-${String(i + 1).padStart(2, "0")}T22:0${k % 10}:00.000Z`),
        ),
      }),
    );
    const model = buildWorkhorses(buildUtilizationIndex(sets));

    expect(model.rows).toHaveLength(TRACK_LIST_MAX_ROWS);
    expect(model.totalRowCount).toBe(60);
    expect(model.truncated).toBe(true);
    expect(workhorsesSummary(model)).toContain("60 tracks have");
    // The cap slices the ALREADY-SORTED list, so it drops the tail, never the
    // lead — the rows the module exists to show survive it.
    expect(model.rows[0].setCount).toBe(60);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Story 4.10 — `trackIdByKey` (D-27/D-28) and AC-4's disclosure
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildUtilizationIndex carries track_id through, one direction only (D-27)", () => {
  // Task 1's measurement on the committed seed, which these three cases are the
  // shapes of: 1,267 `trackKey` groups — 1,055 with a single non-null id, 212
  // with none, 0 with two. The third is defensive rather than observed, and
  // production is empty (re-measured read-only 2026-08-10, 1 dj / 0 sets / 0
  // plays), so a unit test is the only place it can be exercised at all.
  it("(a) carries the id when every play of a key agrees", () => {
    const index = buildUtilizationIndex([
      set({
        external_id: "s1",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [
          { ...t("Deep End", "Hardrive", "2026-06-01T22:00:00.000Z"), track_id: "abc123" },
          { ...t("Deep End", "Hardrive", "2026-06-01T23:00:00.000Z"), track_id: "abc123" },
        ],
      }),
    ]);
    expect(index.trackIdByKey.get(trackKey("Deep End", "Hardrive"))).toBe("abc123");
  });

  it("(b) is null when no play of a key carries one — the ~21% with no artist tag", () => {
    const index = buildUtilizationIndex([
      set({
        external_id: "s1",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [{ ...t("Untagged", null, "2026-06-01T22:00:00.000Z"), track_id: null }],
      }),
    ]);
    expect(index.trackIdByKey.get(trackKey("Untagged", null))).toBeNull();
  });

  it("(c) FAILS CLOSED on two distinct ids for one key (D-28), never picking one", () => {
    const index = buildUtilizationIndex([
      set({
        external_id: "s1",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [
          // The legacy path-hash shape: a play synced before Story 4.3's deploy
          // keeps its old id permanently, and nothing re-derives it.
          { ...t("Deep End", "Hardrive", "2026-06-01T22:00:00.000Z"), track_id: "oldpathhash" },
          { ...t("Deep End", "Hardrive", "2026-06-01T23:00:00.000Z"), track_id: "newidentity" },
        ],
      }),
    ]);
    expect(index.trackIdByKey.get(trackKey("Deep End", "Hardrive"))).toBeNull();
  });

  it("a later matching id cannot resurrect a key that already failed closed", () => {
    const index = buildUtilizationIndex([
      set({
        external_id: "s1",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [
          { ...t("Deep End", "Hardrive", "2026-06-01T22:00:00.000Z"), track_id: "one" },
          { ...t("Deep End", "Hardrive", "2026-06-01T23:00:00.000Z"), track_id: "two" },
          { ...t("Deep End", "Hardrive", "2026-06-02T00:00:00.000Z"), track_id: "one" },
        ],
      }),
    ]);
    expect(index.trackIdByKey.get(trackKey("Deep End", "Hardrive"))).toBeNull();
  });

  it("adopts the one id a half-identified key carries — a gap is not a conflict", () => {
    const index = buildUtilizationIndex([
      set({
        external_id: "s1",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [
          { ...t("Deep End", "Hardrive", "2026-06-01T22:00:00.000Z"), track_id: null },
          { ...t("Deep End", "Hardrive", "2026-06-01T23:00:00.000Z"), track_id: "abc123" },
        ],
      }),
    ]);
    expect(index.trackIdByKey.get(trackKey("Deep End", "Hardrive"))).toBe("abc123");
  });

  it("treats an empty or blank track_id as absent, never as a route", () => {
    const index = buildUtilizationIndex([
      set({
        external_id: "s1",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: [
          { ...t("Blank", "Artist", "2026-06-01T22:00:00.000Z"), track_id: "" },
          { ...t("Spaces", "Artist", "2026-06-01T23:00:00.000Z"), track_id: "   " },
        ],
      }),
    ]);
    expect(index.trackIdByKey.get(trackKey("Blank", "Artist"))).toBeNull();
    expect(index.trackIdByKey.get(trackKey("Spaces", "Artist"))).toBeNull();
  });
});

describe("unlinkableTracksDisclosure (AC-4, SM-C1)", () => {
  const withIds = (rows: [string, string | null, string | null][]) =>
    buildUtilizationIndex([
      set({
        external_id: "s1",
        started_at: "2026-06-01T22:00:00.000Z",
        plays: rows.map(([title, artist, id], i) => ({
          ...t(title, artist, `2026-06-01T2${i}:00:00.000Z`),
          track_id: id,
        })),
      }),
    ]);

  it("returns null when every track is linkable — never '0 tracks'", () => {
    expect(unlinkableTracksDisclosure(withIds([["A", "X", "id1"], ["B", "Y", "id2"]]))).toBeNull();
  });

  it("states the count against the total", () => {
    const note = unlinkableTracksDisclosure(withIds([["A", "X", "id1"], ["B", null, null]]));
    expect(note).toContain("1 of the 2 tracks");
    expect(note).toContain("has");
  });

  // STORY 4.7 R-2, the single most-repeated defect in this epic: the count must
  // not collapse in the case the disclosure exists for. Here 100% excluded
  // makes it RISE to the total rather than fall to zero.
  it("still states a count when EVERY track is unlinkable", () => {
    const note = unlinkableTracksDisclosure(withIds([["A", null, null], ["B", null, null]]));
    expect(note).toContain("2 of the 2 tracks");
    expect(note).not.toContain("0 ");
  });

  it("pluralizes both halves rather than rendering '1 tracks'", () => {
    const one = unlinkableTracksDisclosure(withIds([["A", null, null]]));
    expect(one).toContain("1 of the 1 track ");
    expect(one).toContain("It still shows");
    expect(one).not.toContain("They still");
  });
});

describe("Story 4.10 threads trackId onto both list models", () => {
  const index = buildUtilizationIndex([
    set({
      external_id: "s1",
      started_at: "2026-06-01T22:00:00.000Z",
      plays: [
        { ...t("Carried", "X", "2026-06-01T22:00:00.000Z"), track_id: "id-carried" },
        { ...t("Once", null, "2026-06-01T23:00:00.000Z"), track_id: null },
      ],
    }),
    set({
      external_id: "s2",
      started_at: "2026-06-08T22:00:00.000Z",
      plays: [{ ...t("Carried", "X", "2026-06-08T22:00:00.000Z"), track_id: "id-carried" }],
    }),
  ]);

  it("gives a workhorse row its id", () => {
    expect(buildWorkhorses(index).rows[0].trackId).toBe("id-carried");
  });

  it("gives a played-once row a null id when the track has no identity", () => {
    expect(buildOneAndDone(index).rows[0].trackId).toBeNull();
  });
});
