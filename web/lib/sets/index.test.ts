import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Story 4.6, Task 6: no test-mocking convention existed for this seam before
// this story (confirmed by grep during story creation) — this file
// establishes it. `@/lib/supabase/server` is imported lazily inside each
// function body (`await import(...)`), which `vi.mock` intercepts exactly
// like a static import.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import {
  deleteSet,
  getLibraryAddEvents,
  getLibraryRoster,
  getMixNeighbours,
  getObservationStart,
  getRecentSets,
  getSetById,
  getTrackPlays,
  getTrackRosterEntry,
} from "./index";
import { unidentifiableTracksDisclosure } from "./libraryRoster";

type Result = { data: unknown; error: unknown };

/**
 * Two-tier stand-in mirroring postgrest-js's ACTUAL shape, which the first
 * version of this mock did not (Story 4.6 code review): `from()` returns a
 * `PostgrestQueryBuilder` exposing only `select`/`delete`/`insert`/`update`,
 * and it is NOT thenable and has no `eq`. Only `select()`/`delete()` yield a
 * filter builder, which is thenable and carries the filter/modifier methods.
 *
 * Modelling that split matters: a one-object mock where everything returns
 * itself would let `from("sets").eq(...)` — with no `select` at all — or
 * `await from("sets")` pass here while failing against the real client.
 *
 * Pass an array of results to serve one per awaited query, which is how the
 * `getLibraryAddEvents` paging tests below drive successive pages.
 */
function mockSupabase(results: Result | Result[]) {
  const queue = Array.isArray(results) ? [...results] : null;
  const nextResult = (): Result =>
    queue ? (queue.shift() ?? { data: [], error: null }) : (results as Result);

  const calls = {
    select: [] as (string | undefined)[],
    eq: [] as unknown[][],
    is: [] as unknown[][],
    // Story 4.10: `in` is a distinct postgrest-js method again, not an alias —
    // it renders `column=in.(a,b,c)` where `eq` renders a single comparison.
    // `getMixNeighbours` is built on the two-`.in()` cross product (D-31), so a
    // test asserting that shape cannot be allowed to pass against `eq`.
    in: [] as unknown[][],
    order: [] as unknown[][],
    range: [] as unknown[][],
    limit: [] as unknown[],
    deletes: 0,
    tables: [] as string[],
  };

  function makeFilterBuilder() {
    let settled: Promise<Result> | null = null;
    // Resolved lazily and once, so the queued result is consumed when the
    // query is actually awaited — not when the chain is built.
    const settle = () => (settled ??= Promise.resolve(nextResult()));

    const fb = {
      eq: vi.fn((...args: unknown[]) => {
        calls.eq.push(args);
        return fb;
      }),
      // `is` is a distinct postgrest-js method from `eq`, not an alias: `eq`
      // renders `column=eq.null` (a literal string comparison that matches
      // nothing) where `is` renders `column=is.null`. Modelled separately so a
      // test asserting the null-filter cannot pass against the wrong one.
      is: vi.fn((...args: unknown[]) => {
        calls.is.push(args);
        return fb;
      }),
      in: vi.fn((...args: unknown[]) => {
        calls.in.push(args);
        return fb;
      }),
      order: vi.fn((...args: unknown[]) => {
        calls.order.push(args);
        return fb;
      }),
      limit: vi.fn((n: unknown) => {
        calls.limit.push(n);
        return fb;
      }),
      range: vi.fn((...args: unknown[]) => {
        calls.range.push(args);
        return fb;
      }),
      maybeSingle: vi.fn(() => settle()),
      then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) =>
        settle().then(resolve, reject),
    };
    return fb;
  }

  const from = vi.fn((table: string) => {
    calls.tables.push(table);
    return {
      select: vi.fn((columns?: string) => {
        calls.select.push(columns);
        return makeFilterBuilder();
      }),
      delete: vi.fn(() => {
        calls.deletes += 1;
        return makeFilterBuilder();
      }),
    };
  });

  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, calls };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DERIVED = {
  most_played_tracks: [],
  most_played_artists: [],
  genre_breakdown: { buckets: [], no_genre_count: 0 },
  bpm_distribution: { count: 0, min: 0, max: 0, mean: 0, median: 0 },
  camelot_mixing_stats: { compatible_transitions: 0, incompatible_transitions: 0, excluded_no_key: 0 },
  set_length_sec: 100,
  track_count: 1,
  energy_arc: [],
  confidence: { value: 1, track_count: 1, long_gap_count: 0 },
};

/** Every column the reconstruction depends on, written out independently of the
 * module's own constant on purpose: asserting against the exported string would
 * be tautological and could not catch a column being dropped from it. */
const REQUIRED_SET_COLUMNS = ["id", "started_at", "ended_at", "derived"];
const REQUIRED_PLAY_COLUMNS = [
  // Story 5.3 Task 1.1: a play's OWN uuid. The segment write path builds
  // `first_play_id`/`last_play_id` out of it, so an editor that cannot read it
  // cannot write a boundary at all — and its absence degrades to a calm empty
  // render, exactly the silence the rest of this list exists to catch.
  "id",
  "position",
  "title",
  "artist",
  "started_at",
  "bpm",
  "genre_raw",
  "genre_normalized",
  "subgenre",
  "taxonomy_version",
  "camelot_key",
  "in_library",
  "played_ms",
  "library_added_at",
  "track_id",
];

describe("the sets+plays select string", () => {
  // The seam's riskiest failure mode has no type safety behind it: the Supabase
  // client is constructed without a `<Database>` generic, so `tsc` validates
  // zero column names, and a wrong one degrades to a calm empty render that is
  // silent in production. Drift protection, since the query itself was verified
  // against a live PostgREST during Story 4.6's code review.
  it("requests every column the reconstruction reads, plus the plays and sessions embeds", async () => {
    const { calls } = mockSupabase({ data: [], error: null });
    await getRecentSets();

    const select = calls.select[0] ?? "";
    for (const column of REQUIRED_SET_COLUMNS) {
      expect(select).toMatch(new RegExp(`\\b${column}\\b`));
    }
    // Nested embeds, not flat columns — `plays` is to-many (an array),
    // `sessions` is to-one (an object) via `sets.session_id`.
    expect(select).toMatch(/plays\(/);
    expect(select).toMatch(/sessions\(\s*session_identity\s*\)/);
    // Story 5.2: the dancefloor cut is fetched, not recomputed. `segments`
    // carries TWO foreign keys to `plays`, so each boundary embed MUST name its
    // FK constraint — without the hint PostgREST cannot disambiguate and errors,
    // which this seam would swallow into a calm empty render.
    expect(select).toMatch(/segments\(/);
    expect(select).toMatch(/plays!segments_first_play_id_fkey\(\s*started_at\s*\)/);
    expect(select).toMatch(/plays!segments_last_play_id_fkey\(\s*started_at\s*\)/);
    // Story 5.3 Task 1.2: the segment's own identity, as PLAIN columns
    // alongside those two embeds — not instead of them. The embeds resolve the
    // ISO bounds every existing consumer reads; these three are what an UPDATE
    // or DELETE addresses the row by, and what a boundary adjust writes into.
    // Scoped to the `segments(...)` embed so a same-named column on `sets` or
    // `plays` cannot satisfy this assertion by accident.
    const segmentsEmbed = select.match(/segments\(([^)]*(?:\([^)]*\)[^)]*)*)\)/)?.[1] ?? "";
    for (const column of ["id", "first_play_id", "last_play_id", "type", "source", "confirmed"]) {
      expect(segmentsEmbed).toMatch(new RegExp(`\\b${column}\\b`));
    }
    for (const column of REQUIRED_PLAY_COLUMNS) {
      expect(select).toMatch(new RegExp(`\\b${column}\\b`));
    }
  });
});

describe("getRecentSets", () => {
  it("AC-3: returns [] for a DJ with no synced sets, never throwing", async () => {
    mockSupabase({ data: [], error: null });
    await expect(getRecentSets()).resolves.toEqual([]);
  });

  it("AC-4: a Supabase read failure renders as [], logged in dev, never thrown", async () => {
    mockSupabase({ data: null, error: { message: "connection refused" } });
    await expect(getRecentSets()).resolves.toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("AC-4: an unexpected throw (e.g. missing env) renders as [], never propagating", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("Missing NEXT_PUBLIC_SUPABASE_URL"));
    await expect(getRecentSets()).resolves.toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  // PostgREST silently caps an unbounded response at `max_rows` (1000) with
  // HTTP 200 and error: null, so the bound has to be explicit and server-side —
  // sorting client-side only works on a complete, ordered fetch.
  it("orders and limits server-side so max_rows can never truncate arbitrarily", async () => {
    const { calls } = mockSupabase({ data: [], error: null });
    await getRecentSets();

    expect(calls.order[0]).toEqual(["started_at", { ascending: false }]);
    expect(calls.order[1]).toEqual(["id", { ascending: false }]);
    expect(calls.limit[0]).toBeTypeOf("number");
    expect(calls.limit[0] as number).toBeLessThan(1000);
  });

  it("reconstructs a SetRecord from sets+plays rows, sorted newest-first regardless of query order", async () => {
    mockSupabase({
      data: [
        {
          id: "set-older",
          started_at: "2026-08-01T00:00:00.000Z",
          ended_at: "2026-08-01T01:00:00.000Z",
          derived: DERIVED,
          sessions: { session_identity: "serato4:975" },
          plays: [
            {
              id: "play-uuid-2",
              position: 2,
              title: "Second",
              artist: "Artist B",
              started_at: null,
              bpm: null,
              genre_raw: null,
              genre_normalized: null,
              subgenre: null,
              taxonomy_version: null,
              camelot_key: null,
              in_library: true,
              played_ms: null,
              library_added_at: null,
              track_id: null,
            },
            {
              id: "play-uuid-1",
              position: 1,
              title: "First",
              artist: "Artist A",
              started_at: "2026-08-01T00:00:00.000Z",
              bpm: 128,
              genre_raw: "House",
              genre_normalized: "House",
              subgenre: "Deep House",
              taxonomy_version: 2,
              camelot_key: "8A",
              in_library: true,
              played_ms: 60000,
              library_added_at: null,
              track_id: "trackid1",
            },
          ],
        },
        {
          id: "set-newer",
          started_at: "2026-08-05T00:00:00.000Z",
          ended_at: "2026-08-05T01:00:00.000Z",
          derived: DERIVED,
          sessions: { session_identity: "serato4:979" },
          plays: [],
        },
      ],
      error: null,
    });

    const sets = await getRecentSets();

    // Newest-first, independent of the mocked (deliberately reversed) query order.
    expect(sets.map((s) => s.external_id)).toEqual(["set-newer", "set-older"]);

    const older = sets[1];
    // sets.id IS external_id — no separate column.
    expect(older.external_id).toBe("set-older");
    // The session identity rides along for display; external_id stays the uuid/PK.
    expect(older.session_label).toBe("serato4:975");
    // Plays reordered by `position`, not left in query order.
    expect(older.plays.map((p) => p.position)).toEqual([1, 2]);
    // Story 5.3 Task 1.1/1.5: each play's own uuid survives reconstruction, and
    // rides the SAME reorder — the write path pairs an id with the row the DJ
    // pointed at, so an id that stayed in query order while its play moved
    // would write the wrong boundary with no error anywhere.
    expect(older.plays.map((p) => p.id)).toEqual(["play-uuid-1", "play-uuid-2"]);
    expect(older.plays[0].title).toBe("First");
    // A play with no genre columns reconstructs as genre: null, not a partial object.
    expect(older.plays[1].genre).toBeNull();
    // A play with genre columns reconstructs the full genre object, subgenre included.
    expect(older.plays[0].genre).toEqual({
      raw: "House",
      normalized: "House",
      taxonomy_version: 2,
      subgenre: "Deep House",
    });
    // derived is a plain jsonb passthrough, no reassembly.
    expect(older.derived).toEqual(DERIVED);
  });

  // ---- Story 5.2: the fetched dancefloor segments -------------------------

  /**
   * One embedded `segments` row as PostgREST returns it.
   *
   * Story 5.3 Task 1.2 added the three plain identity columns alongside the two
   * boundary embeds. They are derived from `start`/`end` here only so the
   * helper stays a one-liner at each call site; nothing about the read path
   * relates an id to a timestamp.
   */
  const segmentRow = (
    type: string,
    start: string | null,
    end: string | null,
    source = "suggested",
    confirmed = false,
    id = `seg-${start ?? "none"}`,
  ) => ({
    id,
    type,
    source,
    confirmed,
    first_play_id: `play-first-${start ?? "none"}`,
    last_play_id: `play-last-${end ?? "none"}`,
    first_play: start === null ? null : { started_at: start },
    last_play: end === null ? null : { started_at: end },
  });

  const setRowWithSegments = (segments: unknown[]) => ({
    id: "set-seg",
    started_at: "2026-08-05T00:00:00.000Z",
    ended_at: "2026-08-05T04:00:00.000Z",
    derived: DERIVED,
    sessions: { session_identity: "serato4:975" },
    plays: [],
    segments,
  });

  it("resolves each segments row's boundary plays into ISO bounds, several per set", async () => {
    mockSupabase({
      data: [
        setRowWithSegments([
          segmentRow("dancefloor", "2026-08-05T00:30:00.000Z", "2026-08-05T01:00:00.000Z"),
          segmentRow("dancefloor", "2026-08-05T02:00:00.000Z", "2026-08-05T03:30:00.000Z"),
        ]),
      ],
      error: null,
    });

    const sets = await getRecentSets();
    // Zero, one, or SEVERAL (FR-28/D-15) — the read model never collapses them.
    // Each carries its own identity as of Story 5.3 (Task 1.2/1.3): the ISO
    // bounds are what the arc and the stats scope by, the three ids are what an
    // edit addresses and rewrites.
    expect(sets[0].segments).toEqual([
      {
        id: "seg-2026-08-05T00:30:00.000Z",
        firstPlayId: "play-first-2026-08-05T00:30:00.000Z",
        lastPlayId: "play-last-2026-08-05T01:00:00.000Z",
        confirmed: false,
        start: "2026-08-05T00:30:00.000Z",
        end: "2026-08-05T01:00:00.000Z",
      },
      {
        id: "seg-2026-08-05T02:00:00.000Z",
        firstPlayId: "play-first-2026-08-05T02:00:00.000Z",
        lastPlayId: "play-last-2026-08-05T03:30:00.000Z",
        confirmed: false,
        start: "2026-08-05T02:00:00.000Z",
        end: "2026-08-05T03:30:00.000Z",
      },
    ]);
  });

  it("keeps a DJ-confirmed segment, not only the algorithm's own suggestions", async () => {
    // The embed is deliberately unfiltered on `source`: once Story 5.3 lets a DJ
    // confirm or draw a boundary, those rows are the truest answer available and
    // must not be filtered out in favour of a stale suggestion.
    mockSupabase({
      data: [
        setRowWithSegments([
          segmentRow(
            "dancefloor",
            "2026-08-05T01:00:00.000Z",
            "2026-08-05T02:00:00.000Z",
            "manual",
            true,
          ),
        ]),
      ],
      error: null,
    });

    const sets = await getRecentSets();
    expect(sets[0].segments).toHaveLength(1);
  });

  it("drops non-dancefloor types and rows whose boundary play has no start time", async () => {
    mockSupabase({
      data: [
        setRowWithSegments([
          // Story 5.3's human labels have no consumer here yet, and silently
          // rendering a dinner break as the dancefloor cut is worse than omitting it.
          segmentRow("dinner", "2026-08-05T00:30:00.000Z", "2026-08-05T01:00:00.000Z"),
          // No time bound to scope by — dropped rather than half-rendered (AD-11).
          segmentRow("dancefloor", "2026-08-05T02:00:00.000Z", null),
        ]),
      ],
      error: null,
    });

    const sets = await getRecentSets();
    expect(sets[0].segments).toEqual([]);
  });

  it("a set with no segments reconstructs as segments: [] — the whole-set fallback source", async () => {
    mockSupabase({ data: [setRowWithSegments([])], error: null });
    const sets = await getRecentSets();
    expect(sets[0].segments).toEqual([]);
  });

  it("a null segments embed (RLS-filtered) reconstructs as [] rather than throwing", async () => {
    mockSupabase({ data: [{ ...setRowWithSegments([]), segments: null }], error: null });
    const sets = await getRecentSets();
    expect(sets[0].segments).toEqual([]);
  });

  it("a set with zero plays reconstructs as plays: [] (the embed's real empty shape)", async () => {
    mockSupabase({
      data: [
        {
          id: "set-empty",
          started_at: "2026-08-05T00:00:00.000Z",
          ended_at: "2026-08-05T01:00:00.000Z",
          derived: DERIVED,
          sessions: { session_identity: "serato4:1" },
          plays: [],
        },
      ],
      error: null,
    });

    const sets = await getRecentSets();
    expect(sets).toHaveLength(1);
    expect(sets[0].plays).toEqual([]);
  });

  it("breaks started_at ties on external_id so the order is total, not request-dependent", async () => {
    const sameTime = "2026-08-05T00:00:00.000Z";
    mockSupabase({
      data: ["set-a", "set-c", "set-b"].map((id) => ({
        id,
        started_at: sameTime,
        ended_at: sameTime,
        derived: DERIVED,
        sessions: { session_identity: `serato4:${id}` },
        plays: [],
      })),
      error: null,
    });

    const sets = await getRecentSets();
    expect(sets.map((s) => s.external_id)).toEqual(["set-c", "set-b", "set-a"]);
  });

  // `derived` is cast, never validated, and consumers dereference it deeply
  // (`listModel.ts` reads `set.derived.confidence.value`), so an incomplete blob
  // would throw in the CALLER — outside this module's try/catch — and 500 the
  // whole dashboard. One bad row must cost only that row.
  it("drops a set whose derived blob is too incomplete to render, keeping the rest", async () => {
    mockSupabase({
      data: [
        {
          id: "set-ok",
          started_at: "2026-08-05T00:00:00.000Z",
          ended_at: "2026-08-05T01:00:00.000Z",
          derived: DERIVED,
          sessions: { session_identity: "serato4:1" },
          plays: [],
        },
        {
          id: "set-broken",
          started_at: "2026-08-04T00:00:00.000Z",
          ended_at: "2026-08-04T01:00:00.000Z",
          derived: {}, // the column's own default
          sessions: { session_identity: "serato4:2" },
          plays: [],
        },
      ],
      error: null,
    });

    const sets = await getRecentSets();
    expect(sets.map((s) => s.external_id)).toEqual(["set-ok"]);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });
});

describe("getSetById", () => {
  it("AC-3: returns null for a set that does not exist (new account, wrong id, or not this DJ's)", async () => {
    mockSupabase({ data: null, error: null });
    await expect(getSetById("nonexistent")).resolves.toBeNull();
  });

  it("AC-4: a Supabase read failure renders as null, logged in dev, never thrown", async () => {
    mockSupabase({ data: null, error: { message: "broken RLS" } });
    await expect(getSetById("set-1")).resolves.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("AC-4: an unexpected throw renders as null, never propagating", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("boom"));
    await expect(getSetById("set-1")).resolves.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  // `sets.id` is a uuid column, so a non-uuid route param is a Postgres 22P02
  // ("invalid input syntax for type uuid") surfaced as a PostgREST 400 — an
  // error result, not an empty one. Verified against a live stack during the
  // code review. It must still render as a calm 404.
  it("renders a non-uuid id as not-found rather than surfacing the Postgres 22P02", async () => {
    mockSupabase({
      data: null,
      error: { code: "22P02", message: 'invalid input syntax for type uuid: "not-a-uuid"' },
    });
    await expect(getSetById("not-a-uuid")).resolves.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("returns null for a set whose derived blob is too incomplete to render", async () => {
    mockSupabase({
      data: {
        id: "set-broken",
        started_at: "2026-08-01T00:00:00.000Z",
        ended_at: "2026-08-01T01:00:00.000Z",
        derived: {},
        sessions: { session_identity: "serato4:975" },
        plays: [],
      },
      error: null,
    });
    await expect(getSetById("set-broken")).resolves.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("reconstructs the single set, filtering on sets.id (the external_id)", async () => {
    const { calls } = mockSupabase({
      data: {
        id: "set-1",
        started_at: "2026-08-01T00:00:00.000Z",
        ended_at: "2026-08-01T01:00:00.000Z",
        derived: DERIVED,
        sessions: { session_identity: "serato4:975" },
        plays: [],
      },
      error: null,
    });

    const set = await getSetById("set-1");

    expect(calls.eq[0]).toEqual(["id", "set-1"]);
    expect(set?.external_id).toBe("set-1");
    expect(set?.session_label).toBe("serato4:975");
  });

  it("tolerates a missing sessions embed by reporting a null session_label", async () => {
    mockSupabase({
      data: {
        id: "set-1",
        started_at: "2026-08-01T00:00:00.000Z",
        ended_at: "2026-08-01T01:00:00.000Z",
        derived: DERIVED,
        sessions: null,
        plays: [],
      },
      error: null,
    });

    const set = await getSetById("set-1");
    expect(set?.session_label).toBeNull();
  });
});

describe("deleteSet", () => {
  it("AC-5: issues a real delete filtered on sets.id, scoped by RLS rather than an application-level dj_id check", async () => {
    const { from, calls } = mockSupabase({ data: null, error: null });

    await deleteSet("set-1");

    expect(from).toHaveBeenCalledWith("sets");
    expect(calls.deletes).toBe(1);
    expect(calls.eq[0]).toEqual(["id", "set-1"]);
  });

  // Deliberately NOT the calm fallback the three reads use: swallowing this let
  // `actions.ts` redirect to `?deleted=1` and tell the DJ a set was deleted
  // that was still there, and left DeleteModal's error branch unreachable.
  it("throws on a Supabase delete error rather than reporting a delete that did not happen", async () => {
    mockSupabase({ data: null, error: { message: "permission denied" } });
    await expect(deleteSet("set-1")).rejects.toThrow(/permission denied/);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("propagates an unexpected throw (e.g. missing env) instead of silently succeeding", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("boom"));
    await expect(deleteSet("set-1")).rejects.toThrow(/boom/);
  });
});

describe("getLibraryAddEvents", () => {
  it("AC-3: returns an empty events list plus the read clock for a DJ with no add-events yet", async () => {
    mockSupabase({ data: [], error: null });
    const snapshot = await getLibraryAddEvents();
    expect(snapshot.events).toEqual([]);
    expect(typeof snapshot.readAtMs).toBe("number");
  });

  it("AC-4: a Supabase read failure renders as an empty snapshot, logged in dev, never thrown", async () => {
    mockSupabase({ data: null, error: { message: "connection refused" } });
    const snapshot = await getLibraryAddEvents();
    expect(snapshot.events).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("AC-4: an unexpected throw renders as an empty snapshot, never propagating", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("boom"));
    const snapshot = await getLibraryAddEvents();
    expect(snapshot.events).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("passes through track_id/added_at rows unchanged", async () => {
    mockSupabase({
      data: [
        { track_id: "trackid1", added_at: "2026-08-01T00:00:00.000Z" },
        { track_id: "trackid2", added_at: null },
      ],
      error: null,
    });

    const snapshot = await getLibraryAddEvents();
    expect(snapshot.events).toEqual([
      { track_id: "trackid1", added_at: "2026-08-01T00:00:00.000Z" },
      { track_id: "trackid2", added_at: null },
    ]);
  });

  it("orders by track_id and pages by range, so max_rows cannot silently cap the denominator", async () => {
    const { calls } = mockSupabase({ data: [], error: null });
    await getLibraryAddEvents();

    expect(calls.order[0]).toEqual(["track_id", { ascending: true }]);
    expect(calls.range[0]).toEqual([0, 999]);
  });

  // The bug this replaced: 1202 rows in the table returned exactly 1000 over
  // REST, HTTP 200, error: null — so every conversion rate divided by a
  // truncated denominator with nothing to detect it.
  it("keeps paging past a full page and concatenates every page", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      track_id: `page1-${i}`,
      added_at: null,
    }));
    const lastPage = [
      { track_id: "page2-0", added_at: null },
      { track_id: "page2-1", added_at: null },
    ];
    const { calls } = mockSupabase([
      { data: fullPage, error: null },
      { data: lastPage, error: null },
    ]);

    const snapshot = await getLibraryAddEvents();

    expect(snapshot.events).toHaveLength(1002);
    expect(calls.range).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(snapshot.events.at(-1)).toEqual({ track_id: "page2-1", added_at: null });
  });

  it("stops paging on a short page rather than issuing a needless extra request", async () => {
    const { calls } = mockSupabase([
      { data: [{ track_id: "only", added_at: null }], error: null },
      { data: [{ track_id: "never-read", added_at: null }], error: null },
    ]);

    const snapshot = await getLibraryAddEvents();
    expect(snapshot.events).toEqual([{ track_id: "only", added_at: null }]);
    expect(calls.range).toHaveLength(1);
  });

  // A partial denominator is the exact failure the paging exists to prevent, so
  // it must never become the fallback value.
  it("returns empty, not the pages already collected, when a later page fails", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      track_id: `page1-${i}`,
      added_at: null,
    }));
    mockSupabase([
      { data: fullPage, error: null },
      { data: null, error: { message: "connection reset" } },
    ]);

    const snapshot = await getLibraryAddEvents();
    expect(snapshot.events).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });
});

// Post-merge integration review. This seam served `library-roster.fixture.json`
// — built from ONE developer's real Serato library — and its two scan-level
// scalars have a live consumer (Story 4.3's meter, via
// `unidentifiableTracksDisclosure`), so every DJ was told "252 of your tracks
// are missing a title or artist tag" as a fact about their own library. Story
// 4.11 justified the fixture as "pending Story 4.6's Supabase read-path swap"
// but merged one commit AFTER that swap landed. Nothing tested this function.
//
// Story 4.4 makes `entries` a real Supabase read (AC-10). The two scan-level
// scalars stay 0 and the fixture-regression tests below stay exactly as they
// were: the swap fixes the half that HAS a carrier, and asserting the other
// half is still zero is what stops a future "make it consistent" pass
// inventing one.
describe("getLibraryRoster (Story 4.11 / Story 4.6 AC-3 / Story 4.4 AC-10)", () => {
  it("AC-10: returns the empty shape for a DJ with nothing synced, never fixture data", async () => {
    mockSupabase({ data: [], error: null });
    expect(await getLibraryRoster()).toEqual({
      entries: [],
      excludedNoIdentityCount: 0,
      totalCatalogueRows: 0,
    });
  });

  // The regression this file exists to prevent: the guard is not "the numbers
  // are small", it is "the numbers are not one person's library".
  it("does not report another DJ's measured catalogue counts", async () => {
    mockSupabase({ data: [], error: null });
    const roster = await getLibraryRoster();
    expect(roster.excludedNoIdentityCount).not.toBe(252);
    expect(roster.totalCatalogueRows).not.toBe(910);
  });

  // The whole point of returning zeros rather than plausible-looking numbers:
  // AC-6's sentence must not render at all when we cannot measure it. Still
  // true after the entries swap — the two scalars have no cloud carrier, so
  // reading real rows must not be mistaken for being able to measure them.
  it("yields no disclosure even when entries are real, so AC-6's line does not render on unknown data", async () => {
    mockSupabase({
      data: [
        {
          track_id: "t1",
          title: "A",
          artist: "B",
          added_at: null,
          is_baseline: false,
          absent_at: null,
        },
      ],
      error: null,
    });
    const roster = await getLibraryRoster();
    expect(roster.entries).toHaveLength(1);
    expect(
      unidentifiableTracksDisclosure(roster.excludedNoIdentityCount, roster.totalCatalogueRows),
    ).toBeNull();
  });

  it("reads library_roster and requests every Tier A column the shelf renders", async () => {
    const { from, calls } = mockSupabase({ data: [], error: null });
    await getLibraryRoster();

    expect(from).toHaveBeenCalledWith("library_roster");
    // Written out independently of the module's own constant on purpose —
    // asserting against the exported string would be tautological.
    for (const column of ["track_id", "title", "artist", "added_at", "is_baseline", "absent_at"]) {
      expect(calls.select[0]).toContain(column);
    }
  });

  // Tier B stays parked (Context §5). A shelf where some rows carry BPM/key and
  // most do not reads as broken data rather than a deliberate scope, and the
  // roster table has no such columns to give.
  it("requests no Tier B columns", async () => {
    const { calls } = mockSupabase({ data: [], error: null });
    await getLibraryRoster();
    for (const column of ["bpm", "camelot_key", "genre"]) {
      expect(calls.select[0]).not.toContain(column);
    }
  });

  // AC-8. Server-side, not a post-filter: it is what makes the paging cap count
  // PRESENT tracks rather than burning pages on deleted ones, and
  // `library_roster_dj_id_absent_at_idx` exists for exactly this predicate.
  it("AC-8: filters absent_at server-side with `is`, not `eq`", async () => {
    const { calls } = mockSupabase({ data: [], error: null });
    await getLibraryRoster();
    expect(calls.is).toEqual([["absent_at", null]]);
    expect(calls.eq).toEqual([]);
  });

  it("orders by track_id and pages by range, so max_rows cannot silently cap the roster", async () => {
    const { calls } = mockSupabase({ data: [], error: null });
    await getLibraryRoster();

    expect(calls.order[0]).toEqual(["track_id", { ascending: true }]);
    expect(calls.range[0]).toEqual([0, 999]);
  });

  it("keeps paging past a full page and concatenates every page", async () => {
    const entry = (id: string) => ({
      track_id: id,
      title: id,
      artist: "artist",
      added_at: null,
      is_baseline: false,
      absent_at: null,
    });
    const fullPage = Array.from({ length: 1000 }, (_, i) => entry(`page1-${i}`));
    const { calls } = mockSupabase([
      { data: fullPage, error: null },
      { data: [entry("page2-0")], error: null },
    ]);

    const roster = await getLibraryRoster();

    expect(roster.entries).toHaveLength(1001);
    expect(calls.range).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(roster.entries.at(-1)?.track_id).toBe("page2-0");
  });

  it("stops paging on a short page rather than issuing a needless extra request", async () => {
    const { calls } = mockSupabase([
      {
        data: [
          {
            track_id: "only",
            title: "t",
            artist: "a",
            added_at: null,
            is_baseline: false,
            absent_at: null,
          },
        ],
        error: null,
      },
      { data: [], error: null },
    ]);

    const roster = await getLibraryRoster();
    expect(roster.entries).toHaveLength(1);
    expect(calls.range).toHaveLength(1);
  });

  // A truncated roster renders a confidently short shelf — the same failure
  // `getLibraryAddEvents` pages against, so it gets the same fallback: empty,
  // never the pages already collected.
  it("AC-10: returns empty, not the pages already collected, when a later page fails", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, i) => ({
      track_id: `page1-${i}`,
      title: "t",
      artist: "a",
      added_at: null,
      is_baseline: false,
      absent_at: null,
    }));
    mockSupabase([
      { data: fullPage, error: null },
      { data: null, error: { message: "connection reset" } },
    ]);

    const roster = await getLibraryRoster();
    expect(roster.entries).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("AC-10: a Supabase read failure renders as the empty shape, logged in dev, never thrown", async () => {
    mockSupabase({ data: null, error: { message: "connection refused" } });
    const roster = await getLibraryRoster();
    expect(roster.entries).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("AC-10: an unexpected throw renders as the empty shape, never propagating", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("boom"));
    const roster = await getLibraryRoster();
    expect(roster.entries).toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });
});

// Story 4.4, Context §3 + AC-11. The one anchor for the "days unplayed" clamp.
describe("getObservationStart (Story 4.4, Context §3)", () => {
  it("reads djs.created_at as epoch ms", async () => {
    const { from, calls } = mockSupabase({
      data: { created_at: "2026-01-01T00:00:00.000Z" },
      error: null,
    });

    const startMs = await getObservationStart();

    expect(from).toHaveBeenCalledWith("djs");
    expect(calls.select[0]).toContain("created_at");
    expect(startMs).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  // The fail-closed contract (AC-11). Every one of these must return `null` so
  // the model SUPPRESSES the add-date branch. Returning a number here — any
  // number — would let the shelf age tracks off raw `added_at`, which is the
  // exact pre-fix behaviour this story exists to remove.
  it("AC-11: returns null when the row is missing (RLS filtered, or no djs row)", async () => {
    mockSupabase({ data: null, error: null });
    expect(await getObservationStart()).toBeNull();
  });

  it("AC-11: returns null on a read error, logged in dev, never thrown", async () => {
    mockSupabase({ data: null, error: { message: "permission denied" } });
    expect(await getObservationStart()).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("AC-11: returns null on an unexpected throw, never propagating", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("boom"));
    expect(await getObservationStart()).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
  });

  it("AC-11: returns null on an unparsable created_at rather than NaN", async () => {
    mockSupabase({ data: { created_at: "not-a-date" }, error: null });
    expect(await getObservationStart()).toBeNull();
  });

  it("AC-11: returns null on a null created_at rather than the epoch", async () => {
    // `djs.created_at` is `not null default now()`, so this is unreachable
    // through the schema — but `new Date(null).getTime()` is 0, not NaN, and a
    // 0 here would clamp every track to 1970 and quietly restore raw-added_at
    // behaviour. Guarded rather than assumed.
    mockSupabase({ data: { created_at: null }, error: null });
    expect(await getObservationStart()).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Story 4.10 — the three track-detail reads (D-30, D-31, D-38)
   ═══════════════════════════════════════════════════════════════════════════ */

/** One `TRACK_PLAYS_SELECT` row, with a renderable parent set. */
function trackPlayRow(overrides: Record<string, unknown> = {}) {
  return {
    set_id: "set-1",
    position: 4,
    title: "Deep End",
    artist: "Hardrive",
    started_at: "2026-06-01T22:00:00.000Z",
    bpm: 124,
    genre_raw: "House",
    genre_normalized: "house",
    subgenre: "deep house",
    taxonomy_version: 1,
    camelot_key: "8A",
    in_library: true,
    played_ms: 210_000,
    library_added_at: "2026-05-01T00:00:00.000Z",
    track_id: "id-deep",
    sets: {
      id: "set-1",
      started_at: "2026-06-01T21:00:00.000Z",
      ended_at: "2026-06-02T02:00:00.000Z",
      derived: {
        confidence: { value: 1, track_count: 40, long_gap_count: 0 },
        bpm_distribution: { count: 1, min: 124, max: 124, mean: 124, median: 124 },
        genre_breakdown: { buckets: [], no_genre_count: 0 },
        track_count: 40,
      },
      sessions: { session_identity: "serato4:975" },
    },
    ...overrides,
  };
}

describe("getTrackPlays (D-30)", () => {
  it("reads plays filtered by track_id, ordered and explicitly bounded", async () => {
    const { calls } = mockSupabase({ data: [trackPlayRow()], error: null });
    await getTrackPlays("id-deep");

    expect(calls.tables).toContain("plays");
    expect(calls.eq).toContainEqual(["track_id", "id-deep"]);
    // Bounded, because PostgREST truncates at `max_rows` with HTTP 200 and
    // `error: null` — a silent truncation this seam is structurally blind to.
    expect(calls.limit[0]).toBe(500);
    // Ordered SERVER-side, so the bound keeps the oldest plays — the end
    // "first played" is read from. An unordered limit would hand back an
    // arbitrary slice and AC-7's first play would describe a subset.
    expect(calls.order).toContainEqual(["started_at", { ascending: true }]);
  });

  // Written out independently rather than asserted against the exported
  // constant, which would be tautological — the test would pass if a column
  // were deleted from both.
  it("selects every column the detail page renders, plus the set embed", () => {
    const { calls } = mockSupabase({ data: [], error: null });
    return getTrackPlays("id-deep").then(() => {
      const select = calls.select[0] ?? "";
      for (const column of [
        "set_id",
        "position",
        "title",
        "artist",
        "started_at",
        "bpm",
        "genre_raw",
        "genre_normalized",
        "subgenre",
        "taxonomy_version",
        "camelot_key",
        "in_library",
        "played_ms",
        "library_added_at",
        "track_id",
      ]) {
        expect(select).toContain(column);
      }
      // `sessions(session_identity)` is what keeps `SET 975` out of being the
      // raw uuid; `derived` is what `isLowConfidenceSet` reads.
      expect(select).toContain("sets(id, started_at, ended_at, derived, sessions(session_identity))");
    });
  });

  it("reshapes a row into a TrackPlayRecord, session identity carried raw", async () => {
    mockSupabase({ data: [trackPlayRow()], error: null });
    const [record] = await getTrackPlays("id-deep");
    expect(record.setId).toBe("set-1");
    expect(record.setLabel).toBe("serato4:975");
    expect(record.play.position).toBe(4);
    expect(record.play.genre).toEqual({
      raw: "House",
      normalized: "house",
      taxonomy_version: 1,
      subgenre: "deep house",
    });
  });

  it("is empty for a brand-new account", async () => {
    mockSupabase({ data: [], error: null });
    await expect(getTrackPlays("id-deep")).resolves.toEqual([]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("falls back calmly on a read error, logging exactly once", async () => {
    mockSupabase({ data: null, error: { message: "boom" } });
    await expect(getTrackPlays("id-deep")).resolves.toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back calmly on an unexpected throw", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("nope") as never);
    await expect(getTrackPlays("id-deep")).resolves.toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  // Per-row, so one malformed set drops its own plays rather than emptying the
  // history — and `isLowConfidenceSet` dereferences `derived.confidence.value`
  // without a guard, so an incomplete blob would throw in the CALLER.
  it("drops a play whose set has an unrenderable derived blob, keeping the rest", async () => {
    mockSupabase({
      data: [
        trackPlayRow(),
        trackPlayRow({ set_id: "set-2", sets: { id: "set-2", started_at: null, ended_at: null, derived: {}, sessions: null } }),
      ],
      error: null,
    });
    const records = await getTrackPlays("id-deep");
    expect(records).toHaveLength(1);
    expect(records[0].setId).toBe("set-1");
  });

  it("drops a play whose set embed is null rather than throwing", async () => {
    mockSupabase({ data: [trackPlayRow({ sets: null })], error: null });
    await expect(getTrackPlays("id-deep")).resolves.toEqual([]);
  });
});

describe("getMixNeighbours (D-31)", () => {
  it("asks for the cross product of set ids and position ± 1", async () => {
    const { calls } = mockSupabase({ data: [], error: null });
    await getMixNeighbours([
      { setId: "s1", position: 5 },
      { setId: "s2", position: 9 },
    ]);

    expect(calls.in).toContainEqual(["set_id", ["s1", "s2"]]);
    expect(calls.in).toContainEqual(["position", [4, 6, 8, 10]]);
    expect(calls.limit[0]).toBe(1000);
  });

  // The cross product over-fetches by construction; this is the filter that
  // makes it exact. Without it, s2's position 4 would read as s1's neighbour.
  it("filters the over-fetch down to the exact (set_id, position) pairs", async () => {
    mockSupabase({
      data: [
        { set_id: "s1", position: 4, title: "Right", artist: "A", track_id: "id-1" },
        { set_id: "s2", position: 4, title: "Wrong Set", artist: "B", track_id: "id-2" },
      ],
      error: null,
    });
    const rows = await getMixNeighbours([
      { setId: "s1", position: 5 },
      { setId: "s2", position: 9 },
    ]);
    expect(rows.map((r) => r.title)).toEqual(["Right"]);
  });

  it("never asks for position 0 — the column is 1-based", async () => {
    const { calls } = mockSupabase({ data: [], error: null });
    await getMixNeighbours([{ setId: "s1", position: 1 }]);
    expect(calls.in).toContainEqual(["position", [2]]);
  });

  it("touches no network at all for an empty anchor list", async () => {
    const { from } = mockSupabase({ data: [], error: null });
    await expect(getMixNeighbours([])).resolves.toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("falls back calmly on a read error, logging exactly once", async () => {
    mockSupabase({ data: null, error: { message: "boom" } });
    await expect(getMixNeighbours([{ setId: "s1", position: 5 }])).resolves.toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back calmly on an unexpected throw", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("nope") as never);
    await expect(getMixNeighbours([{ setId: "s1", position: 5 }])).resolves.toEqual([]);
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("getTrackRosterEntry (D-38)", () => {
  it("filters absent_at with `is`, not `eq`", async () => {
    const { calls } = mockSupabase({ data: null, error: null });
    await getTrackRosterEntry("id-owned");
    expect(calls.tables).toContain("library_roster");
    expect(calls.eq).toContainEqual(["track_id", "id-owned"]);
    // `eq` would render `absent_at=eq.null` — a literal string comparison
    // matching nothing, which would make every owned track look removed.
    expect(calls.is).toContainEqual(["absent_at", null]);
    expect(calls.eq).not.toContainEqual(["absent_at", null]);
  });

  it("selects the roster's Tier A columns", async () => {
    const { calls } = mockSupabase({ data: null, error: null });
    await getTrackRosterEntry("id-owned");
    for (const column of ["track_id", "title", "artist", "added_at", "is_baseline", "absent_at"]) {
      expect(calls.select[0]).toContain(column);
    }
  });

  it("returns the entry when the DJ still owns the track", async () => {
    mockSupabase({
      data: {
        track_id: "id-owned",
        title: "Owned",
        artist: "Owner",
        added_at: "2026-05-01T00:00:00.000Z",
        is_baseline: true,
        absent_at: null,
      },
      error: null,
    });
    await expect(getTrackRosterEntry("id-owned")).resolves.toMatchObject({ track_id: "id-owned" });
  });

  it("returns null for not-in-roster without logging — that is a normal answer", async () => {
    mockSupabase({ data: null, error: null });
    await expect(getTrackRosterEntry("id-owned")).resolves.toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("falls back calmly on a read error, logging exactly once", async () => {
    mockSupabase({ data: null, error: { message: "boom" } });
    await expect(getTrackRosterEntry("id-owned")).resolves.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back calmly on an unexpected throw", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("nope") as never);
    await expect(getTrackRosterEntry("id-owned")).resolves.toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
  });
});
