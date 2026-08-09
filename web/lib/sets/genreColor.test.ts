import { describe, expect, it } from "vitest";
import {
  CATCH_ALL_COLOR,
  CATCH_ALL_GENRE,
  FOLD_COLOR,
  GENRE_SLOT_COUNT,
  buildGenreColorAssignment,
  genreColorFor,
  selectGenreBands,
} from "./genreColor";
import { buildStyleEvolution } from "./styleEvolution";
import type { SetRecord } from "./types";

function set(overrides: {
  external_id: string;
  started_at: string | null;
  confidence?: number;
  genreBuckets?: Array<{ genre: string; play_count: number }>;
}): SetRecord {
  return {
    external_id: overrides.external_id,
    started_at: overrides.started_at,
    ended_at: overrides.started_at,
    plays: [],
    derived: {
      most_played_tracks: [],
      most_played_artists: [],
      genre_breakdown: { buckets: overrides.genreBuckets ?? [], no_genre_count: 0 },
      bpm_distribution: { count: 0, min: 0, max: 0, mean: 0, median: 0 },
      camelot_mixing_stats: { compatible_transitions: 0, incompatible_transitions: 0, excluded_no_key: 0 },
      set_length_sec: null,
      track_count: 0,
      energy_arc: [],
      confidence: { value: overrides.confidence ?? 1.0, track_count: 0, long_gap_count: 0 },
    },
  } as SetRecord;
}

describe("buildGenreColorAssignment (Story 4.8 AC-3/AC-4 — G-1)", () => {
  it("assigns the same color to the same genre name regardless of which top-N set a view shows", () => {
    // Two different "views" of overlapping genre populations — the failure
    // mode AC-3 names is a color that depends on a genre's rank WITHIN the
    // current view. The assignment is built once from the full population.
    const full = buildGenreColorAssignment([
      { breakdown: [{ name: "techno", count: 50 }, { name: "house", count: 30 }, { name: "trance", count: 10 }] },
      { breakdown: [{ name: "dnb", count: 8 }, { name: "ambient", count: 4 }] },
    ]);
    // techno is rank 1 in the full population…
    expect(genreColorFor(full, "techno")).toBe("var(--chart-cat-1)");
    // …and stays cat-1 no matter which subset of genres any view renders,
    // because consumers look colors up by NAME in this one map.
    expect(genreColorFor(full, "dnb")).toBe("var(--chart-cat-4)");
    expect(genreColorFor(full, "ambient")).toBe("var(--chart-cat-5)");
  });

  it("is identical when built from `including` vs a reveal-filtered subset never happens: consumers build from including only", () => {
    // The stability contract: one model → one assignment. Verify through the
    // real builder that month × including is granularity- and
    // reveal-independent input: month and week partition the same dated
    // population, so both yield the same totals.
    const sets = [
      set({ external_id: "a", started_at: "2026-06-05T20:00:00Z", genreBuckets: [{ genre: "techno", play_count: 3 }] }),
      set({
        external_id: "b",
        started_at: "2026-06-19T20:00:00Z",
        confidence: 0.5,
        genreBuckets: [{ genre: "house", play_count: 9 }],
      }),
    ];
    const model = buildStyleEvolution(sets);
    const fromMonth = buildGenreColorAssignment(model.month.including.map((p) => p.genreDiversity));
    const fromWeek = buildGenreColorAssignment(model.week.including.map((p) => p.genreDiversity));
    expect(fromMonth).toEqual(fromWeek);
    // house outranks techno in the including partition (9 > 3) — and that
    // ranking holds even though the default (excluding) VIEW hides the
    // low-confidence set that carries house. The reveal toggle therefore
    // cannot recolor: both views read the same map.
    expect(genreColorFor(fromMonth, "house")).toBe("var(--chart-cat-1)");
    expect(genreColorFor(fromMonth, "techno")).toBe("var(--chart-cat-2)");
  });

  it("gives the literal Other genre its own reserved color, never a named slot and never the fold neutral", () => {
    const a = buildGenreColorAssignment([
      { breakdown: [{ name: CATCH_ALL_GENRE, count: 100 }, { name: "techno", count: 1 }] },
    ]);
    expect(genreColorFor(a, CATCH_ALL_GENRE)).toBe(CATCH_ALL_COLOR);
    expect(a.ranked).not.toContain(CATCH_ALL_GENRE);
    // The dominant catch-all did NOT consume slot 1 — techno gets it.
    expect(genreColorFor(a, "techno")).toBe("var(--chart-cat-1)");
  });

  it("folds ranks past the named slots to the neutral", () => {
    const many = Array.from({ length: GENRE_SLOT_COUNT + 2 }, (_, i) => ({
      name: `g${i}`,
      count: 100 - i,
    }));
    const a = buildGenreColorAssignment([{ breakdown: many }]);
    expect(genreColorFor(a, `g${GENRE_SLOT_COUNT - 1}`)).toBe(`var(--chart-cat-${GENRE_SLOT_COUNT})`);
    expect(genreColorFor(a, `g${GENRE_SLOT_COUNT}`)).toBe(FOLD_COLOR);
    expect(genreColorFor(a, "never-seen")).toBe(FOLD_COLOR);
  });

  it("breaks count ties by name, deterministically across runs", () => {
    const a = buildGenreColorAssignment([
      { breakdown: [{ name: "zeta", count: 5 }, { name: "alpha", count: 5 }] },
    ]);
    const b = buildGenreColorAssignment([
      { breakdown: [{ name: "alpha", count: 5 }, { name: "zeta", count: 5 }] },
    ]);
    expect(a.ranked).toEqual(["alpha", "zeta"]);
    expect(a).toEqual(b);
  });
});

describe("selectGenreBands (D-3, code review 2026-08-08)", () => {
  const assignment = {
    ranked: Array.from({ length: GENRE_SLOT_COUNT + 2 }, (_, i) => `g${i}`),
    colors: {},
  };
  const totals = (entries: Array<[string, number]>) => new Map(entries);

  it("does not spend a band on a rostered genre with no plays in this view", () => {
    // g0 outranks everything globally but is absent here; before D-3 its
    // slot was sliced first and then filtered away, so the cap silently
    // dropped to 2 and g3 lost its band to the fold.
    const picked = selectGenreBands(assignment, totals([["g1", 5], ["g2", 4], ["g3", 3]]), 3);
    expect(picked).toEqual(["g1", "g2", "g3"]);
  });

  it("chooses by view-local count but returns them in global rank order", () => {
    const picked = selectGenreBands(assignment, totals([["g0", 1], ["g1", 9], ["g2", 8]]), 2);
    expect(picked).toEqual(["g1", "g2"]); // g0 loses on view count, not rank
  });

  it("never selects a genre outside the color roster — it has no hue to draw in", () => {
    const outside = `g${GENRE_SLOT_COUNT}`;
    const picked = selectGenreBands(assignment, totals([[outside, 999], ["g0", 1]]), 6);
    expect(picked).toEqual(["g0"]);
    expect(genreColorFor(assignment, outside)).toBe(FOLD_COLOR);
  });

  it("is stable under a view that only shrinks — the reveal cannot reorder what stays", () => {
    const wide = selectGenreBands(assignment, totals([["g0", 9], ["g1", 7], ["g2", 5]]), 6);
    const narrow = selectGenreBands(assignment, totals([["g0", 4], ["g1", 3]]), 6);
    expect(wide).toEqual(["g0", "g1", "g2"]);
    expect(narrow).toEqual(["g0", "g1"]);
    // Order of the survivors is identical — selection may change, sequence
    // and (via genreColorFor) hue may not.
    expect(wide.filter((n) => narrow.includes(n))).toEqual(narrow);
  });
});
