// Story 5.3 Task 4.3 — the DJ's own writes to `segments`.
//
// Unit-level against a postgrest-shaped mock, deliberately NOT a second run of
// the pgTAP suite from the web side: whether the database ENFORCES ordering,
// overlap, set-consistency and the MVP type guard is proven in
// `supabase/tests/segments_write_path_test.sql`, against a real Postgres, and
// re-asserting it here would only prove the mock agrees with itself. What these
// cases own is the half pgTAP cannot see — which columns each write actually
// sends, and whether a rejection survives the trip back as a distinguishable
// reason rather than a shrug.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import {
  adjustSegmentBoundary,
  confirmSegment,
  createManualSegment,
  deleteSegment,
  SegmentWriteError,
} from "./segmentWrites";

type Failure = { message: string } | null;

/**
 * Mirrors postgrest-js's real split, the same discipline `index.test.ts`
 * documents: `from()` exposes only the verb methods and is NOT thenable, and
 * only a verb yields the filter builder that is. A one-object mock where
 * everything returns itself would let `from("segments").eq(...)` — with no
 * verb at all — pass here while failing against the real client.
 */
function mockSupabase(
  options: {
    error?: Failure;
    userId?: string | null;
    userError?: boolean;
    /** Whether the UPDATE's `.select()` echoes back a matched row — `false`
     * simulates the RLS-filtered/nonexistent-id case, where postgrest returns
     * `error: null, data: []` rather than an error (see `assertRowMatched`). */
    matched?: boolean;
  } = {},
) {
  const calls = {
    tables: [] as string[],
    updates: [] as unknown[],
    inserts: [] as unknown[],
    deletes: 0,
    eq: [] as unknown[][],
  };

  const makeFilterBuilder = () => {
    const result = {
      error: options.error ?? null,
      data: options.matched === false ? [] : [{ id: "matched-row" }],
    };
    const fb = {
      eq: vi.fn((...args: unknown[]) => {
        calls.eq.push(args);
        return fb;
      }),
      select: vi.fn(() => fb),
      then: (resolve: (value: typeof result) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return fb;
  };

  const from = vi.fn((table: string) => {
    calls.tables.push(table);
    return {
      update: vi.fn((patch: unknown) => {
        calls.updates.push(patch);
        return makeFilterBuilder();
      }),
      insert: vi.fn((row: unknown) => {
        calls.inserts.push(row);
        return makeFilterBuilder();
      }),
      delete: vi.fn(() => {
        calls.deletes += 1;
        return makeFilterBuilder();
      }),
    };
  });

  const getUser = vi.fn(async () => ({
    data: { user: options.userId === null ? null : { id: options.userId ?? "dj-1" } },
    error: options.userError ? { message: "no session" } : null,
  }));

  vi.mocked(createClient).mockResolvedValue({ from, auth: { getUser } } as never);
  return { calls, getUser };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("confirmSegment", () => {
  it("sets confirmed and NOTHING else — provenance must survive confirmation (D-18)", async () => {
    const { calls } = mockSupabase();
    await confirmSegment("seg-1");

    expect(calls.tables).toEqual(["segments"]);
    expect(calls.updates).toEqual([{ confirmed: true }]);
    // `source` is not merely left alone, it is unreachable — absent from the
    // column-scoped UPDATE grant. Sending it would fail the write outright.
    expect(calls.updates[0]).not.toHaveProperty("source");
    expect(calls.eq).toEqual([["id", "seg-1"]]);
  });

  it("throws rather than reporting success when the id matches no row", async () => {
    // A zero-row UPDATE is not a Postgres error — a stale or deleted id would
    // otherwise resolve quietly, and the editor would retire its controls as
    // if the write landed. Code review finding, 2026-08-11.
    mockSupabase({ matched: false });
    await expect(confirmSegment("gone")).rejects.toMatchObject({ reason: "not-permitted" });
  });
});

describe("adjustSegmentBoundary", () => {
  it("sends only the boundary that moved", async () => {
    const { calls } = mockSupabase();
    await adjustSegmentBoundary("seg-1", { lastPlayId: "play-9" });
    expect(calls.updates).toEqual([{ last_play_id: "play-9" }]);
  });

  it("sends BOTH boundaries in one statement when both moved", async () => {
    // Load-bearing rather than tidy: two sequential updates would leave the row
    // transiently reversed, and the D-29 trigger would reject the first write
    // rather than the DJ's actual intent.
    const { calls } = mockSupabase();
    await adjustSegmentBoundary("seg-1", { firstPlayId: "play-2", lastPlayId: "play-9" });
    expect(calls.updates).toEqual([{ first_play_id: "play-2", last_play_id: "play-9" }]);
  });

  it("does not touch the network when neither boundary moved", async () => {
    // An empty `update({})` is rejected by postgrest outright, so a no-op nudge
    // — arrowing left at the very first track — would surface to the DJ as a
    // write failure rather than as nothing happening.
    const { calls } = mockSupabase();
    await adjustSegmentBoundary("seg-1", {});
    expect(calls.tables).toEqual([]);
    expect(calls.updates).toEqual([]);
  });

  it("throws rather than reporting success when the id matches no row", async () => {
    mockSupabase({ matched: false });
    await expect(
      adjustSegmentBoundary("gone", { lastPlayId: "play-9" }),
    ).rejects.toMatchObject({ reason: "not-permitted" });
  });
});

describe("createManualSegment", () => {
  it("writes ('manual', true) dancefloor with a DERIVED dj_id", async () => {
    const { calls } = mockSupabase({ userId: "dj-real" });
    await createManualSegment("set-1", "play-1", "play-4");

    expect(calls.inserts).toEqual([
      {
        set_id: "set-1",
        // Read from the session, never accepted from the caller: RLS would
        // reject a forged one anyway, but deriving it makes the failure
        // impossible rather than merely caught.
        dj_id: "dj-real",
        // D-33/D-32: this story ships dancefloor only, and the DB agrees — so
        // there is no type parameter to get wrong.
        type: "dancefloor",
        // D-18 rules ('manual', false) out with a CHECK: a DJ drawing their own
        // boundary IS the confirmation.
        source: "manual",
        confirmed: true,
        first_play_id: "play-1",
        last_play_id: "play-4",
      },
    ]);
  });

  it("refuses to write at all when there is no authenticated DJ", async () => {
    const { calls } = mockSupabase({ userId: null });
    await expect(createManualSegment("set-1", "play-1", "play-4")).rejects.toMatchObject({
      reason: "not-permitted",
    });
    expect(calls.inserts).toEqual([]);
  });
});

describe("deleteSegment", () => {
  it("deletes by id", async () => {
    const { calls } = mockSupabase();
    await deleteSegment("seg-1");
    expect(calls.deletes).toBe(1);
    expect(calls.eq).toEqual([["id", "seg-1"]]);
  });
});

// The reason this whole taxonomy exists (Task 4.2). The trigger raises four
// DIFFERENT messages rather than a bare constraint code so the editor can tell
// a DJ which rule they hit; every one of these strings is the literal text in
// `20260811120000_add_segments_write_path.sql`, so this suite fails if that
// migration's wording drifts out from under the mapping.
describe("rejection reasons", () => {
  const cases: Array<[string, string]> = [
    ["segment boundaries reversed (first position 5 > last position 3)", "boundaries-reversed"],
    ["segment boundary references a play outside its own set", "boundary-outside-set"],
    ["segment overlaps an existing dancefloor segment for this set", "overlaps-another-segment"],
    [
      "only dancefloor segments can be written (MVP guard, Story 5.3 D-32)",
      "type-not-supported",
    ],
    ['permission denied for table segments', "not-permitted"],
    ["new row violates row-level security policy for table \"segments\"", "not-permitted"],
    [
      'new row for relation "segments" violates check constraint "segments_manual_confirmed_check"',
      "invalid-state",
    ],
    ["some future failure nobody has seen", "unknown"],
  ];

  for (const [message, reason] of cases) {
    it(`maps "${message.slice(0, 44)}…" to ${reason}`, async () => {
      mockSupabase({ error: { message } });
      await expect(confirmSegment("seg-1")).rejects.toBeInstanceOf(SegmentWriteError);
      await expect(confirmSegment("seg-1")).rejects.toMatchObject({ reason });
    });
  }

  it("throws rather than resolving quietly — a mutation has no truthful silent fallback", async () => {
    // The one place this file deliberately diverges from the read seam's
    // calm-empty discipline, for `deleteSet`'s reason: swallowing a failed
    // write reports a change that did not happen.
    mockSupabase({ error: { message: "segment overlaps an existing dancefloor segment for this set" } });
    await expect(adjustSegmentBoundary("seg-1", { lastPlayId: "play-9" })).rejects.toThrow();
    await expect(deleteSegment("seg-1")).rejects.toThrow();
  });
});
