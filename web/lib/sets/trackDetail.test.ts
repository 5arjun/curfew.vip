import { describe, expect, it } from "vitest";
import {
  buildClockStrip,
  buildMixNeighbours,
  buildNeighbourAnchors,
  buildRideTime,
  buildTrackHistory,
  buildTrackIdentity,
  formatRideTime,
  hasMixNeighbours,
  hasPlayHistory,
  hasRideTime,
  mixNeighboursDisclosure,
  mixNeighboursSummary,
  partitionTrackPlaysByConfidence,
  rideTimeDisclosure,
  rideTimeSummary,
  trackHistorySummary,
  MIX_NEIGHBOUR_SET_LIMIT,
  type MixNeighbourRow,
  type TrackPlayRecord,
} from "./trackDetail";
import type { LibraryRosterEntry } from "./libraryRoster";
import type { SyncPlay, SyncSetDerived } from "./types";

/* ── Fixture builders ───────────────────────────────────────────────────── */

function derived(confidence = 1.0, trackCount = 20): SyncSetDerived {
  return {
    most_played_tracks: [],
    most_played_artists: [],
    genre_breakdown: { buckets: [], no_genre_count: 0 },
    bpm_distribution: { count: 0, min: 0, max: 0, mean: 0, median: 0 },
    camelot_mixing_stats: { compatible_transitions: 0, incompatible_transitions: 0, excluded_no_key: 0 },
    set_length_sec: null,
    track_count: trackCount,
    energy_arc: [],
    confidence: { value: confidence, track_count: trackCount, long_gap_count: 0 },
  } as unknown as SyncSetDerived;
}

function play(overrides: Partial<SyncPlay> & { position: number }): SyncPlay {
  return {
    title: "Deep End",
    artist: "Hardrive",
    started_at: null,
    bpm: null,
    genre: null,
    camelot_key: null,
    in_library: true,
    ...overrides,
  };
}

function record(overrides: {
  setId?: string;
  setLabel?: string | null;
  setStartedAt?: string | null;
  confidence?: number;
  trackCount?: number;
  play?: Partial<SyncPlay> & { position: number };
}): TrackPlayRecord {
  return {
    setId: overrides.setId ?? "set-1",
    // `in`, not `??`: an explicit `null` is the case half these tests are
    // ABOUT (an unlabelled set, an undated set), and `??` would hand it the
    // default and quietly test nothing. Caught by two failing assertions
    // rather than by reading — which is the argument for writing the negative
    // cases first.
    setLabel: "setLabel" in overrides ? (overrides.setLabel ?? null) : "serato4:975",
    setStartedAt:
      "setStartedAt" in overrides
        ? (overrides.setStartedAt ?? null)
        : "2026-06-01T21:00:00.000Z",
    setDerived: derived(overrides.confidence, overrides.trackCount),
    play: play(overrides.play ?? { position: 4 }),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-12 — the confidence partition (D-34)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("partitionTrackPlaysByConfidence (AC-12, D-34)", () => {
  it("hides plays from short sets that scored a clean confidence 1.0", () => {
    // The exact case `styleEvolution.ts`'s bare `< 1.0` lets through and
    // `listModel`'s compound predicate catches: `confidence.rs` is symmetric by
    // design, so a two-track soundcheck scores 1.0.
    const { surviving, hidden, hiddenSetCount } = partitionTrackPlaysByConfidence([
      record({ setId: "real", trackCount: 40 }),
      record({ setId: "soundcheck", trackCount: 2 }),
    ]);
    expect(surviving).toHaveLength(1);
    expect(surviving[0].setId).toBe("real");
    expect(hidden).toHaveLength(1);
    expect(hiddenSetCount).toBe(1);
  });

  it("hides plays from a low-confidence set that is long enough", () => {
    const { hidden } = partitionTrackPlaysByConfidence([
      record({ setId: "murky", confidence: 0.4, trackCount: 40 }),
    ]);
    expect(hidden).toHaveLength(1);
  });

  // `hiddenCount` feeds `LibraryUtilizationReveal`, whose control reads "N
  // short or low-confidence SETS hidden". Counting plays there would state the
  // right number under the wrong noun.
  it("counts SETS, not plays, so four plays in one hidden set count once", () => {
    const { hiddenSetCount, hidden } = partitionTrackPlaysByConfidence([
      record({ setId: "soundcheck", trackCount: 2, play: { position: 1 } }),
      record({ setId: "soundcheck", trackCount: 2, play: { position: 2 } }),
      record({ setId: "soundcheck", trackCount: 2, play: { position: 3 } }),
      record({ setId: "soundcheck", trackCount: 2, play: { position: 4 } }),
    ]);
    expect(hidden).toHaveLength(4);
    expect(hiddenSetCount).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-5 / AC-6 — identity and tags
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildTrackIdentity (AC-5, AC-6)", () => {
  it("takes each field from the most recent play that HAS it, independently", () => {
    // A record ripped untagged and genre-tagged later has plays on both sides
    // of the edit. Taking the newest play wholesale would show its gaps as the
    // track's gaps.
    const identity = buildTrackIdentity(
      [
        record({ play: { position: 1, bpm: 124.6, camelot_key: "8A", genre: null } }),
        record({
          play: {
            position: 2,
            bpm: null,
            camelot_key: null,
            genre: { raw: "House", normalized: "house", taxonomy_version: 1, subgenre: "deep house" },
          },
        }),
      ],
      null,
    );
    expect(identity.bpm).toBe(125);
    expect(identity.camelotKey).toBe("8A");
    expect(identity.genre).toBe("house");
    expect(identity.subgenre).toBe("deep house");
  });

  it("names an absent field Unknown rather than leaving it blank (FR-2/AD-11)", () => {
    const identity = buildTrackIdentity([record({})], null);
    expect(identity.bpm).toBeNull();
    expect(identity.camelotKey).toBeNull();
    expect(identity.genre).toBeNull();
    expect(identity.libraryAddedAtMs).toBeNull();
  });

  it("treats a BPM of exactly 0 as corrupted, not a real reading (D-8)", () => {
    // No track plays at 0 BPM — a 0 reading is bad data, and rendering it
    // as "0" would be the fabricated zero D-8 bans everywhere else on this
    // page.
    const identity = buildTrackIdentity([record({ play: { position: 1, bpm: 0 } })], null);
    expect(identity.bpm).toBeNull();
  });

  it("treats an empty or whitespace-only title/artist as absent (Non-negotiable 9)", () => {
    const identity = buildTrackIdentity(
      [record({ play: { position: 1, title: "   ", artist: "" } })],
      null,
    );
    expect(identity.title).toBe("Unknown");
    expect(identity.artist).toBe("Unknown");
  });

  it("moves genre and subgenre together, never pairing across a taxonomy (AD-12)", () => {
    const identity = buildTrackIdentity(
      [
        record({
          play: {
            position: 1,
            genre: { raw: "House", normalized: "house", taxonomy_version: 1, subgenre: "deep house" },
          },
        }),
        record({
          play: { position: 2, genre: { raw: "Techno", normalized: "techno", taxonomy_version: 1 } },
        }),
      ],
      null,
    );
    expect(identity.genre).toBe("techno");
    // NOT "deep house" carried over from the older, differently-genred play.
    expect(identity.subgenre).toBeNull();
  });

  it("falls back to the roster for a track that has never been played (D-38)", () => {
    const roster: LibraryRosterEntry = {
      track_id: "abc123",
      title: "Owned Only",
      artist: "Nobody",
      added_at: "2026-05-01T00:00:00.000Z",
      is_baseline: true,
      absent_at: null,
    };
    const identity = buildTrackIdentity([], roster);
    expect(identity.title).toBe("Owned Only");
    expect(identity.inRoster).toBe(true);
    expect(identity.libraryAddedAtMs).toBe(Date.parse("2026-05-01T00:00:00.000Z"));
  });

  // AC-6, and the one thing it names explicitly: the add date must never be
  // defaulted to the first play. "When did I get this" and "when did I first
  // play it" are different questions.
  it("does NOT default a missing add date to the first play", () => {
    const identity = buildTrackIdentity(
      [record({ play: { position: 1, started_at: "2026-06-01T22:00:00.000Z", library_added_at: null } })],
      null,
    );
    expect(identity.libraryAddedAtMs).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-7 — play history
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildTrackHistory (AC-7)", () => {
  it("counts plays, distinct sets, and the first and last play", () => {
    const model = buildTrackHistory([
      record({ setId: "a", play: { position: 1, started_at: "2026-06-01T22:00:00.000Z" } }),
      record({ setId: "a", play: { position: 9, started_at: "2026-06-01T23:30:00.000Z" } }),
      record({ setId: "b", play: { position: 3, started_at: "2026-07-01T22:00:00.000Z" } }),
    ]);
    expect(model.timesPlayed).toBe(3);
    expect(model.sets).toHaveLength(2);
    expect(model.firstPlayedMs).toBe(Date.parse("2026-06-01T22:00:00.000Z"));
    expect(model.lastPlayedMs).toBe(Date.parse("2026-07-01T22:00:00.000Z"));
  });

  it("counts two spins in one night on that night's row", () => {
    const model = buildTrackHistory([
      record({ setId: "a", play: { position: 1, started_at: "2026-06-01T22:00:00.000Z" } }),
      record({ setId: "a", play: { position: 2, started_at: "2026-06-01T22:05:00.000Z" } }),
    ]);
    expect(model.sets[0].playCount).toBe(2);
  });

  it("labels a set through formatSessionLabel, never the raw uuid", () => {
    const model = buildTrackHistory([record({ setId: "872d5614-9894-5803-80f5-aa1dd4177944" })]);
    expect(model.sets[0].label).toBe("SET 975");
    expect(model.sets[0].setId).toBe("872d5614-9894-5803-80f5-aa1dd4177944");
  });

  // Two "Untitled set" rows are reachable and would collide on a label key —
  // failure mode 8 on this epic's list. `setId` is what keys them.
  it("keeps two unlabelled sets as two distinct rows", () => {
    const model = buildTrackHistory([
      record({ setId: "a", setLabel: null }),
      record({ setId: "b", setLabel: null }),
    ]);
    expect(model.sets).toHaveLength(2);
    expect(new Set(model.sets.map((s) => s.setId)).size).toBe(2);
    expect(model.sets.every((s) => s.label === "Untitled set")).toBe(true);
  });

  it("counts an undated play but leaves first/last alone (D-8, never a guessed date)", () => {
    const model = buildTrackHistory([
      record({ setId: "a", play: { position: 1, started_at: null } }),
      record({ setId: "b", play: { position: 1, started_at: "2026-06-01T22:00:00.000Z" } }),
    ]);
    expect(model.undatedPlayCount).toBe(1);
    expect(model.timesPlayed).toBe(2);
    expect(model.firstPlayedMs).toBe(Date.parse("2026-06-01T22:00:00.000Z"));
  });

  it("returns null first/last rather than 0 when nothing carried a time", () => {
    const model = buildTrackHistory([record({ play: { position: 1, started_at: null } })]);
    expect(model.firstPlayedMs).toBeNull();
    expect(model.lastPlayedMs).toBeNull();
  });

  it("sorts sets most-recent-first with undated ones last", () => {
    const model = buildTrackHistory([
      record({ setId: "old", setStartedAt: "2026-01-01T22:00:00.000Z" }),
      record({ setId: "undated", setStartedAt: null }),
      record({ setId: "new", setStartedAt: "2026-08-01T22:00:00.000Z" }),
    ]);
    expect(model.sets.map((s) => s.setId)).toEqual(["new", "old", "undated"]);
  });

  it("summary branches on the same predicate the visible state does", () => {
    const empty = buildTrackHistory([]);
    expect(hasPlayHistory(empty)).toBe(false);
    // Gate-blind: names the region rather than stating a figure the UI withheld.
    expect(trackHistorySummary(empty)).toBe("Play history");
    expect(trackHistorySummary(buildTrackHistory([record({})]))).toBe(
      "Played 1 time across 1 set.",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-8 — the clock strip (D-32)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildClockStrip (AC-8, D-32)", () => {
  // `vitest.config.ts` pins TZ=UTC, so this proves the EPOCH MATH and nothing
  // about the rendered hour — that is verified in the browser pass. The model
  // shipping numbers rather than strings is what makes that split possible.
  it("ships epoch ms and never a formatted hour", () => {
    const model = buildClockStrip([
      record({ play: { position: 1, started_at: "2026-06-01T23:00:00.000Z" } }),
      record({ play: { position: 2, started_at: "2026-06-01T22:00:00.000Z" } }),
    ]);
    expect(model.startedAtMs).toEqual([
      Date.parse("2026-06-01T22:00:00.000Z"),
      Date.parse("2026-06-01T23:00:00.000Z"),
    ]);
    expect(model.startedAtMs.every((v) => typeof v === "number")).toBe(true);
  });

  it("counts an unparseable time out rather than placing it at zero", () => {
    const model = buildClockStrip([
      record({ play: { position: 1, started_at: "not a date" } }),
      record({ play: { position: 2, started_at: null } }),
    ]);
    expect(model.startedAtMs).toEqual([]);
    expect(model.undatedPlayCount).toBe(2);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-9 / AC-11 — ride time (D-33)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildRideTime (AC-9, D-33)", () => {
  const withDurations = (durations: (number | null)[]) =>
    buildRideTime(durations.map((played_ms, i) => record({ play: { position: i + 1, played_ms } })));

  it("takes the median, not the mean — one false start does not move it", () => {
    // Mean would be 92s; median is the typical spin.
    const model = withDurations([20_000, 180_000, 185_000, 190_000]);
    expect(model.n).toBe(4);
    expect(model.medianMs).toBe(182_500);
  });

  it("takes the middle value at odd n", () => {
    expect(withDurations([100_000, 200_000, 300_000]).medianMs).toBe(200_000);
  });

  it("returns null rather than a fabricated 0 when nothing carried a duration", () => {
    const model = withDurations([null, null]);
    expect(model.medianMs).toBeNull();
    expect(model.n).toBe(0);
    expect(hasRideTime(model)).toBe(false);
  });

  it("excludes non-positive durations with the missing ones", () => {
    const model = withDurations([0, -5, 120_000]);
    expect(model.n).toBe(1);
    expect(model.excludedCount).toBe(2);
  });

  // AC-11's n=1 form: one observation is not a distribution.
  it("at n=1 renders the single duration and never says 'typically'", () => {
    const model = withDurations([222_000]);
    expect(model.n).toBe(1);
    expect(model.medianMs).toBe(222_000);
    const summary = rideTimeSummary(model);
    expect(summary).toBe("Played once, for 3m 42s.");
    expect(summary).not.toContain("ypically");
  });

  it("states the n above n=1", () => {
    expect(rideTimeSummary(withDurations([100_000, 200_000]))).toContain("across 2 plays");
  });

  it("names the region rather than a figure when the gate is closed", () => {
    expect(rideTimeSummary(withDurations([null]))).toBe("Ride time");
  });
});

describe("rideTimeDisclosure (AC-9; Story 4.7 R-2)", () => {
  const model = (durations: (number | null)[]) =>
    buildRideTime(durations.map((played_ms, i) => record({ play: { position: i + 1, played_ms } })));

  it("returns null when nothing was excluded — never '0 plays'", () => {
    expect(rideTimeDisclosure(model([120_000]))).toBeNull();
  });

  // The single most-repeated defect in this epic: the count dropping to 0 in
  // precisely the case the disclosure exists for.
  it("still states the count when EVERY play is missing a duration", () => {
    const note = rideTimeDisclosure(model([null, null, null]));
    expect(note).toContain("3 plays");
    expect(note).not.toContain("0 plays");
  });

  it("pluralizes rather than rendering '1 plays'", () => {
    expect(rideTimeDisclosure(model([null, 120_000]))).toContain("1 play carries");
  });
});

describe("formatRideTime picks the scale a ride time is read at (D-33)", () => {
  it("uses bare seconds under a minute", () => {
    expect(formatRideTime(48_000)).toBe("48s");
  });

  // `formatDuration` would round this to "4m" and throw away exactly the digits
  // that separate a played record from a cut one.
  it("keeps the seconds above a minute, zero-padded", () => {
    expect(formatRideTime(222_000)).toBe("3m 42s");
    expect(formatRideTime(185_000)).toBe("3m 05s");
  });

  it("handles the pathological hour-long ride", () => {
    expect(formatRideTime(3_845_000)).toBe("1h 04m 05s");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-10 — mix neighbours (D-31)
   ═══════════════════════════════════════════════════════════════════════════ */

function neighbour(set_id: string, position: number, title: string, artist: string | null, track_id: string | null = null): MixNeighbourRow {
  return { set_id, position, title, artist, track_id };
}

describe("buildMixNeighbours (AC-10, D-31)", () => {
  const anchors = [
    record({ setId: "s1", play: { position: 5 } }),
    record({ setId: "s2", play: { position: 9 } }),
  ];

  it("splits position ± 1 into before and after", () => {
    const model = buildMixNeighbours(
      anchors,
      [neighbour("s1", 4, "Before", "A"), neighbour("s1", 6, "After", "B")],
      anchors,
    );
    expect(model.before.map((e) => e.title)).toEqual(["Before"]);
    expect(model.after.map((e) => e.title)).toEqual(["After"]);
  });

  // The read over-fetches a cross product on purpose (PostgREST cannot express
  // exact pairs); this is the filter that makes it exact.
  it("never crosses a set boundary — s2's position 4 is not s1's neighbour", () => {
    const model = buildMixNeighbours(anchors, [neighbour("s2", 4, "Wrong Set", "A")], anchors);
    expect(hasMixNeighbours(model)).toBe(false);
  });

  it("orders by recurrence, with a total tie-break", () => {
    const model = buildMixNeighbours(
      [
        record({ setId: "s1", play: { position: 5 } }),
        record({ setId: "s2", play: { position: 9 } }),
        record({ setId: "s3", play: { position: 2 } }),
      ],
      [
        neighbour("s1", 4, "Twice", "A"),
        neighbour("s2", 8, "Twice", "A"),
        neighbour("s3", 1, "Once", "B"),
      ],
      anchors,
    );
    expect(model.before.map((e) => [e.title, e.count])).toEqual([
      ["Twice", 2],
      ["Once", 1],
    ]);
  });

  it("keeps the track itself as a real answer when it played back to back", () => {
    const back2back = [
      record({ setId: "s1", play: { position: 5 } }),
      record({ setId: "s1", play: { position: 6 } }),
    ];
    const model = buildMixNeighbours(
      back2back,
      [neighbour("s1", 6, "Deep End", "Hardrive"), neighbour("s1", 5, "Deep End", "Hardrive")],
      back2back,
    );
    expect(model.after.some((e) => e.title === "Deep End")).toBe(true);
    expect(model.before.some((e) => e.title === "Deep End")).toBe(true);
  });

  it("never asks for position 0 — the column is 1-based", () => {
    const first = [record({ setId: "s1", play: { position: 1 } })];
    const model = buildMixNeighbours(first, [neighbour("s1", 0, "Impossible", "A")], first);
    expect(model.before).toEqual([]);
  });

  it("names an untitled neighbour Unknown rather than rendering a blank row", () => {
    const model = buildMixNeighbours(anchors, [neighbour("s1", 4, "", null)], anchors);
    expect(model.before[0].title).toBe("Unknown");
    expect(model.before[0].artist).toBe("Unknown");
  });

  it("carries a neighbour's own trackId so it can link (D-26)", () => {
    const model = buildMixNeighbours(
      anchors,
      [neighbour("s1", 4, "Linked", "A", "id-1"), neighbour("s2", 8, "Unlinked", "B", null)],
      anchors,
    );
    expect(model.before.find((e) => e.title === "Linked")?.trackId).toBe("id-1");
    expect(model.before.find((e) => e.title === "Unlinked")?.trackId).toBeNull();
  });

  it("names the region rather than a figure when nothing was adjacent", () => {
    expect(mixNeighboursSummary(buildMixNeighbours(anchors, [], anchors))).toBe("Mix neighbours");
  });
});

describe("buildNeighbourAnchors + its disclosure (Non-negotiable 5)", () => {
  const manySets = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      record({ setId: `s${i}`, setStartedAt: `2026-0${(i % 9) + 1}-01T22:00:00.000Z`, play: { position: 3 } }),
    );

  it("keeps every set when the cap does not bite", () => {
    const anchors = buildNeighbourAnchors(manySets(5));
    expect(new Set(anchors.map((a) => a.setId)).size).toBe(5);
  });

  it("keeps the MOST RECENT sets when the cap bites", () => {
    // `plays` arrives oldest-first from the seam, so the newest sets are last.
    const anchors = buildNeighbourAnchors(manySets(MIX_NEIGHBOUR_SET_LIMIT + 5));
    const kept = new Set(anchors.map((a) => a.setId));
    expect(kept.size).toBe(MIX_NEIGHBOUR_SET_LIMIT);
    expect(kept.has(`s${MIX_NEIGHBOUR_SET_LIMIT + 4}`)).toBe(true);
    expect(kept.has("s0")).toBe(false);
  });

  it("discloses the cap only when it bites, and says which end was kept", () => {
    const plays = manySets(MIX_NEIGHBOUR_SET_LIMIT + 3);
    const model = buildMixNeighbours(plays, [], plays);
    const note = mixNeighboursDisclosure(model);
    expect(note).toContain("3 older sets");
    expect(note).toContain("most recent");

    const small = manySets(2);
    expect(mixNeighboursDisclosure(buildMixNeighbours(small, [], small))).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Non-negotiable 6 — no ranking vocabulary in any string this story adds
   ═══════════════════════════════════════════════════════════════════════════ */

describe("no ranking vocabulary (DESIGN.md:199)", () => {
  it("keeps every generated string clear of it", () => {
    const plays = [
      record({ setId: "a", play: { position: 5, started_at: "2026-06-01T22:00:00.000Z", played_ms: 200_000 } }),
      record({ setId: "b", play: { position: 9, started_at: "2026-07-01T22:00:00.000Z", played_ms: null } }),
    ];
    const strings = [
      trackHistorySummary(buildTrackHistory(plays)),
      rideTimeSummary(buildRideTime(plays)),
      rideTimeDisclosure(buildRideTime(plays)),
      mixNeighboursSummary(buildMixNeighbours(plays, [neighbour("a", 4, "X", "Y")], plays)),
    ].filter((s): s is string => s !== null);

    for (const s of strings) {
      expect(s.toLowerCase()).not.toMatch(/\b(best|winner|top|rank|ranked|#\d)\b/);
    }
  });
});
