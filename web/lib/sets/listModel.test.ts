// Story 5.2 (Task 5.3): the two segment-source behaviors the v0 retirement has
// to preserve exactly, neither of which had a test before — `buildSetRows` had
// no test file at all, which is how the swap from a computed cut to a fetched
// one could have changed every card's numbers without anything failing.
import { describe, expect, it } from "vitest";
import { buildSetRows, floorDisclosureLabel } from "./listModel";
import { segmentStats } from "./dancefloor";
import type { DancefloorSegment } from "./dancefloor";
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

/**
 * The card reads a segment purely as a time window, so these cases still state
 * only the window. Story 5.3 added row identity to the read shape for the
 * EDITOR's sake; it is filled in here from the bounds so the type is satisfied
 * without pretending these synthetic segments correspond to database rows.
 */
function withIdentity(s: { start: string; end: string }): DancefloorSegment {
  return { ...s, id: `seg:${s.start}`, firstPlayId: `first:${s.start}`, lastPlayId: `last:${s.end}`, confirmed: false };
}

function set(segments: Array<{ start: string; end: string }>): SetRecord {
  return {
    external_id: "set-1",
    started_at: at(0),
    ended_at: at(110),
    plays: PLAYS,
    segments: segments.map(withIdentity),
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

  it("takes the longest of several segments as the card's one dancefloor stat (D-24)", () => {
    const [row] = buildSetRows([
      set([
        { start: at(0), end: at(20) },
        { start: at(60), end: at(110) },
      ]),
    ]);

    // The 50-minute Techno run wins over the 20-minute House one. The single
    // floorCount/genreChips stat still makes this pick (Set Detail's picker,
    // not the card, is where a DJ chooses a different one) — but
    // floorSegmentCount (below) is what stops that pick from being silent.
    expect(row.floorCount).toBe(6);
    expect(row.genreChips).toEqual(["Techno"]);
  });
});

describe("floorDisclosureLabel (Story 5.4, AC #4)", () => {
  it("says nothing at 0 or 1 segments — no disclosure owed for the common case", () => {
    expect(floorDisclosureLabel(0)).toBeNull();
    expect(floorDisclosureLabel(1)).toBeNull();
  });

  it("discloses the rest, correctly pluralized", () => {
    expect(floorDisclosureLabel(2)).toBe("+1 more floor");
    expect(floorDisclosureLabel(3)).toBe("+2 more floors");
  });
});

describe("floorSegmentCount (Story 5.4, AC #4)", () => {
  it("is 0 for a set with no dancefloor segments", () => {
    const [row] = buildSetRows([set([])]);
    expect(row.floorSegmentCount).toBe(0);
  });

  it("is 1 for a set with exactly one dancefloor segment — the common case, no disclosure owed", () => {
    const [row] = buildSetRows([set([{ start: at(60), end: at(110) }])]);
    expect(row.floorSegmentCount).toBe(1);
  });

  it("counts every real segment on a several-dancefloor set, not just the one the card picks", () => {
    const [row] = buildSetRows([
      set([
        { start: at(0), end: at(20) },
        { start: at(60), end: at(110) },
      ]),
    ]);
    expect(row.floorSegmentCount).toBe(2);
  });
});

describe("set rows resolve dates and search in the set's own zone (Story 7.7)", () => {
  function setAt(startedAt: string, timezone: string | null): SetRecord {
    return {
      external_id: "s1",
      started_at: startedAt,
      ended_at: startedAt,
      plays: [],
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
        set_length_sec: 3600,
        track_count: 40,
        energy_arc: [],
        confidence: { value: 1.0, track_count: 40, long_gap_count: 0 },
        timezone,
      },
    } as unknown as SetRecord;
  }

  // 01:00Z on Jul 1 is 21:00 on Jun 30 in New York — EDT is UTC-4 in summer,
  // not UTC-5, which is exactly the kind of arithmetic a fixed stored offset
  // gets wrong half the year and a zone name never does (Decision 1).
  const LAST_NIGHT_OF_JUNE = "2026-07-01T01:00:00.000Z";

  it("dates and keys a late-June gig as June", () => {
    const [row] = buildSetRows([setAt(LAST_NIGHT_OF_JUNE, "America/New_York")]);
    expect(row.dayKey).toBe("2026-06-30");
    expect(row.dateLabel).toBe("Tue, Jun 30");
    expect(row.startClock).toBe("9:00 PM");
  });

  // AC-3 calls this out specifically: `searchDate` is BEHAVIOUR, not a label.
  // Rendered in the process zone, this set's search text said "July", so a DJ
  // typing "june" could not find their own June gig.
  it("lets the DJ find a June gig by typing 'june'", () => {
    const [row] = buildSetRows([setAt(LAST_NIGHT_OF_JUNE, "America/New_York")]);
    expect(row.haystack).toContain("june");
    expect(row.haystack).not.toContain("july");
  });

  it("still searches by the fallback zone when the set carries none", () => {
    const [row] = buildSetRows([setAt(LAST_NIGHT_OF_JUNE, null)], "America/New_York");
    expect(row.haystack).toContain("june");
  });

  it("falls back to UTC — and finds July — when no zone is known at all", () => {
    // The honest pre-7.7 answer, not a bug to fix: AD-3 keeps zone-less
    // payloads valid forever, and the fallback is counted for disclosure.
    const [row] = buildSetRows([setAt(LAST_NIGHT_OF_JUNE, null)], null);
    expect(row.dayKey).toBe("2026-07-01");
    expect(row.haystack).toContain("july");
  });
});
