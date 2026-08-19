import { describe, expect, it } from "vitest";
import { buildUtilizationIndex, partitionSetsByConfidence } from "./libraryUtilization";
import {
  buildTrackSearchIndex,
  filterTrackSearchRows,
  hasSearchableTracks,
  isOwned,
  trackSearchHaystacks,
  trackSearchNoMatchCopy,
  visibleTrackSearchRows,
  TS_ADDED_AT_MS,
  TS_ALL_PLAY_COUNT,
  TS_ARTIST,
  TS_PLAY_COUNT,
  TS_TITLE,
  TS_TRACK_ID,
} from "./trackSearch";
import type { LibraryRosterEntry } from "./libraryRoster";
import type { SetRecord, SyncPlay } from "./types";

/* ── Fixtures ───────────────────────────────────────────────────────────── */

function play(overrides: Partial<SyncPlay> & { position: number }): SyncPlay {
  return {
    title: null,
    artist: null,
    started_at: "2026-06-01T22:00:00.000Z",
    bpm: null,
    genre: null,
    camelot_key: null,
    in_library: true,
    ...overrides,
  };
}

function set(overrides: {
  external_id: string;
  trackCount?: number;
  confidence?: number;
  plays: SyncPlay[];
}): SetRecord {
  const plays = overrides.plays.map((p, i) => ({ ...p, position: i + 1 }));
  const trackCount = overrides.trackCount ?? 40;
  return {
    external_id: overrides.external_id,
    started_at: "2026-06-01T21:00:00.000Z",
    ended_at: "2026-06-02T02:00:00.000Z",
    plays,
    session_label: null,
    derived: {
      most_played_tracks: [],
      most_played_artists: [],
      genre_breakdown: { buckets: [], no_genre_count: 0 },
      bpm_distribution: { count: 0, min: 0, max: 0, mean: 0, median: 0 },
      camelot_mixing_stats: {
        compatible_transitions: 0,
        incompatible_transitions: 0,
        excluded_no_key: 0,
      },
      set_length_sec: null,
      track_count: trackCount,
      energy_arc: [],
      confidence: { value: overrides.confidence ?? 1.0, track_count: trackCount, long_gap_count: 0 },
    },
  } as unknown as SetRecord;
}

function roster(overrides: Partial<LibraryRosterEntry> & { track_id: string }): LibraryRosterEntry {
  return {
    title: "Owned Track",
    artist: "Owner",
    added_at: "2026-05-01T00:00:00.000Z",
    is_baseline: true,
    absent_at: null,
    ...overrides,
  };
}

/** Builds the index the way `page.tsx` does, from one set population. */
function indexFrom(sets: SetRecord[], entries: LibraryRosterEntry[] = []) {
  const { surviving } = partitionSetsByConfidence(sets);
  return buildTrackSearchIndex(
    buildUtilizationIndex(surviving),
    buildUtilizationIndex(sets),
    entries,
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   AC-1 / AC-2 — played ∪ owned, each result saying which it is (D-25)
   ═══════════════════════════════════════════════════════════════════════════ */

describe("buildTrackSearchIndex covers both populations (D-25)", () => {
  const sets = [
    set({
      external_id: "s1",
      plays: [
        play({ position: 1, title: "Deep End", artist: "Hardrive", track_id: "id-deep" }),
        play({ position: 2, title: "Deep End", artist: "Hardrive", track_id: "id-deep" }),
      ],
    }),
  ];

  it("carries a played track with its counts", () => {
    const index = indexFrom(sets);
    expect(index.playedCount).toBe(1);
    const row = index.rows[0];
    expect(row[TS_TITLE]).toBe("Deep End");
    expect(row[TS_PLAY_COUNT]).toBe(2);
    expect(isOwned(row)).toBe(false);
  });

  it("carries an owned-but-never-played track with its add date", () => {
    const index = indexFrom([], [roster({ track_id: "id-owned" })]);
    expect(index.ownedCount).toBe(1);
    const row = index.rows[0];
    expect(isOwned(row)).toBe(true);
    expect(row[TS_ADDED_AT_MS]).toBe(Date.parse("2026-05-01T00:00:00.000Z"));
  });

  // A track the DJ owns AND has played is ONE result, not two rows saying
  // different things about the same record.
  it("dedupes on track_id across the two populations", () => {
    const index = indexFrom(sets, [roster({ track_id: "id-deep", title: "Deep End" })]);
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0][TS_PLAY_COUNT]).toBe(2);
  });

  it("keeps a played track with no identity, unlinkable rather than absent (D-26)", () => {
    const index = indexFrom([
      set({ external_id: "s1", plays: [play({ position: 1, title: "No Artist", track_id: null })] }),
    ]);
    expect(index.rows[0][TS_TRACK_ID]).toBeNull();
    expect(index.rows[0][TS_TITLE]).toBe("No Artist");
  });

  it("names a missing artist Unknown rather than leaving it blank (AD-11)", () => {
    const index = indexFrom([], [roster({ track_id: "id-1", artist: null })]);
    expect(index.rows[0][TS_ARTIST]).toBe("Unknown");
  });

  it("drops a roster row with a blank title rather than keying a phantom track", () => {
    const index = indexFrom([], [roster({ track_id: "id-1", title: "   " })]);
    expect(index.rows).toHaveLength(0);
  });

  it("carries a null add date rather than guessing one (AC-6)", () => {
    const index = indexFrom([], [roster({ track_id: "id-1", added_at: null })]);
    expect(index.rows[0][TS_ADDED_AT_MS]).toBeNull();
  });

  it("orders played tracks before owned ones, both with a total tie-break", () => {
    const index = indexFrom(
      [
        set({
          external_id: "s1",
          plays: [
            play({ position: 1, title: "Twice", artist: "A", track_id: "id-2" }),
            play({ position: 2, title: "Twice", artist: "A", track_id: "id-2" }),
            play({ position: 3, title: "Once", artist: "B", track_id: "id-1" }),
          ],
        }),
      ],
      [roster({ track_id: "id-z", title: "Zebra" }), roster({ track_id: "id-a", title: "Apple" })],
    );
    expect(index.rows.map((r) => r[TS_TITLE])).toEqual(["Twice", "Once", "Apple", "Zebra"]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-12 — the exclude-visibly contract on the search surface
   ═══════════════════════════════════════════════════════════════════════════ */

describe("the two count pairs (AC-12)", () => {
  // A track played twice in a real set and three times at a soundcheck.
  const sets = [
    set({
      external_id: "real",
      trackCount: 40,
      plays: [
        play({ position: 1, title: "Deep End", artist: "Hardrive", track_id: "id-deep" }),
        play({ position: 2, title: "Deep End", artist: "Hardrive", track_id: "id-deep" }),
      ],
    }),
    set({
      external_id: "soundcheck",
      trackCount: 2,
      plays: [
        play({ position: 1, title: "Deep End", artist: "Hardrive", track_id: "id-deep" }),
        play({ position: 2, title: "Soundcheck Only", artist: "Nobody", track_id: "id-only" }),
      ],
    }),
  ];

  it("carries surviving counts and whole-population counts separately", () => {
    const index = indexFrom(sets);
    const deep = index.rows.find((r) => r[TS_TITLE] === "Deep End");
    expect(deep?.[TS_PLAY_COUNT]).toBe(2);
    expect(deep?.[TS_ALL_PLAY_COUNT]).toBe(3);
  });

  // The bug `isOwned` keys on `allPlayCount` to avoid: a track played ONLY in
  // soundchecks has a surviving playCount of 0, and reading state off that
  // field would relabel a track the DJ HAS played as one they merely own.
  it("still calls a soundcheck-only track PLAYED, not owned", () => {
    const index = indexFrom(sets);
    const only = index.rows.find((r) => r[TS_TITLE] === "Soundcheck Only");
    expect(only?.[TS_PLAY_COUNT]).toBe(0);
    expect(only?.[TS_ALL_PLAY_COUNT]).toBe(1);
    expect(isOwned(only!)).toBe(false);
  });

  it("hides a soundcheck-only track by default and returns it on reveal", () => {
    const index = indexFrom(sets);
    const hidden = visibleTrackSearchRows(index.rows, false).map((r) => r[TS_TITLE]);
    const shown = visibleTrackSearchRows(index.rows, true).map((r) => r[TS_TITLE]);
    expect(hidden).not.toContain("Soundcheck Only");
    expect(shown).toContain("Soundcheck Only");
  });

  it("never hides an owned track, which no set population can affect", () => {
    const index = indexFrom(sets, [roster({ track_id: "id-owned" })]);
    expect(visibleTrackSearchRows(index.rows, false).map((r) => r[TS_TITLE])).toContain(
      "Owned Track",
    );
  });

  it("does not reorder under the reveal", () => {
    const index = indexFrom(sets);
    const order = index.rows.map((r) => r[TS_TITLE]);
    expect(visibleTrackSearchRows(index.rows, true).map((r) => r[TS_TITLE])).toEqual(order);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D-29/D-39 — the filter contract, mirroring SetListPanel exactly
   ═══════════════════════════════════════════════════════════════════════════ */

describe("filterTrackSearchRows (D-29)", () => {
  const index = indexFrom(
    [
      set({
        external_id: "s1",
        plays: [
          play({ position: 1, title: "Deep End", artist: "Hardrive", track_id: "id-1" }),
          play({ position: 2, title: "Percolator", artist: "Cajmere", track_id: "id-2" }),
        ],
      }),
    ],
    [roster({ track_id: "id-3", title: "Deep Inside", artist: "Hardrive" })],
  );
  const hay = trackSearchHaystacks(index.rows);

  it("requires EVERY whitespace token to hit the haystack", () => {
    expect(filterTrackSearchRows(index.rows, hay, "deep hardrive").map((r) => r[TS_TITLE])).toEqual([
      "Deep End",
      "Deep Inside",
    ]);
    expect(filterTrackSearchRows(index.rows, hay, "deep cajmere")).toEqual([]);
  });

  it("is case-insensitive and matches the artist as well as the title", () => {
    expect(filterTrackSearchRows(index.rows, hay, "CAJMERE").map((r) => r[TS_TITLE])).toEqual([
      "Percolator",
    ]);
  });

  it("matches nothing on an empty or whitespace-only query, never everything", () => {
    expect(filterTrackSearchRows(index.rows, hay, "")).toEqual([]);
    expect(filterTrackSearchRows(index.rows, hay, "   ")).toEqual([]);
  });

  it("collapses repeated whitespace rather than emitting an empty token", () => {
    expect(filterTrackSearchRows(index.rows, hay, "  deep   end  ").map((r) => r[TS_TITLE])).toEqual(
      ["Deep End"],
    );
  });

  it("preserves the index's order", () => {
    expect(filterTrackSearchRows(index.rows, hay, "e").map((r) => r[TS_TITLE])).toEqual(
      index.rows.filter((r) => `${r[TS_TITLE]} ${r[TS_ARTIST]}`.toLowerCase().includes("e")).map((r) => r[TS_TITLE]),
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   AC-13 and the cap
   ═══════════════════════════════════════════════════════════════════════════ */

describe("hasSearchableTracks (AC-13)", () => {
  it("is false only when Curfew knows of no track in EITHER population", () => {
    expect(hasSearchableTracks(indexFrom([], []))).toBe(false);
    // D-38's cold start: a synced roster and zero sets is a working search.
    expect(hasSearchableTracks(indexFrom([], [roster({ track_id: "id-1" })]))).toBe(true);
  });
});

describe("trackSearchNoMatchCopy (Non-negotiable 4; Story 4.7 R-2 shape)", () => {
  it("returns null when a visible row exists", () => {
    expect(trackSearchNoMatchCopy(3, 1)).toBeNull();
  });

  it("states Curfew has no record when there is truly no match", () => {
    expect(trackSearchNoMatchCopy(0, 0)).toBe(
      "No track here matches that. Curfew has no play and no library entry under that name.",
    );
  });

  it("never claims zero when a match exists but is hidden by the reveal", () => {
    const note = trackSearchNoMatchCopy(1, 0);
    expect(note).not.toBeNull();
    expect(note).not.toMatch(/no play and no library entry/);
    expect(note).toContain("1 track matches");
    expect(note).toContain("reveal");
  });

  it("pluralizes for more than one hidden match", () => {
    const note = trackSearchNoMatchCopy(2, 0);
    expect(note).toContain("2 tracks match");
    expect(note).toContain("them");
  });
});
