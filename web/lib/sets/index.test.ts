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
import { deleteSet, getLibraryAddEvents, getLibraryRoster, getRecentSets, getSetById } from "./index";
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
    order: [] as unknown[][],
    range: [] as unknown[][],
    limit: [] as unknown[],
    deletes: 0,
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

  const from = vi.fn(() => ({
    select: vi.fn((columns?: string) => {
      calls.select.push(columns);
      return makeFilterBuilder();
    }),
    delete: vi.fn(() => {
      calls.deletes += 1;
      return makeFilterBuilder();
    }),
  }));

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
describe("getLibraryRoster (Story 4.11 / Story 4.6 AC-3)", () => {
  it("returns the empty shape, never fixture data", async () => {
    expect(await getLibraryRoster()).toEqual({
      entries: [],
      excludedNoIdentityCount: 0,
      totalCatalogueRows: 0,
    });
  });

  // The regression this file exists to prevent: the guard is not "the numbers
  // are small", it is "the numbers are not one person's library".
  it("does not report another DJ's measured catalogue counts", async () => {
    const roster = await getLibraryRoster();
    expect(roster.excludedNoIdentityCount).not.toBe(252);
    expect(roster.totalCatalogueRows).not.toBe(910);
  });

  // The whole point of returning zeros rather than plausible-looking numbers:
  // AC-6's sentence must not render at all when we cannot measure it.
  it("yields no disclosure, so AC-6's line does not render on unknown data", async () => {
    const roster = await getLibraryRoster();
    expect(
      unidentifiableTracksDisclosure(roster.excludedNoIdentityCount, roster.totalCatalogueRows),
    ).toBeNull();
  });

  it("needs no Supabase client, so it cannot throw on a brand-new account", async () => {
    vi.mocked(createClient).mockReset();
    await expect(getLibraryRoster()).resolves.toBeDefined();
    expect(createClient).not.toHaveBeenCalled();
  });
});
