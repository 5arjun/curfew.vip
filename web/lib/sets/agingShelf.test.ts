import { describe, expect, it } from "vitest";

import {
  AGING_THRESHOLD_DAYS,
  RECENT_DOWNLOAD_DAYS,
  SHELF_ROW_CAP,
  agingShelfState,
  agingShelfSummary,
  buildAgingShelf,
} from "./agingShelf";
import type { LibraryRosterEntry } from "./libraryRoster";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A fixed clock, so nothing here is machine-dependent (Story 4.1's review lesson). */
const NOW = Date.parse("2026-08-08T12:00:00.000Z");

/** `nowMs` minus N days, as an ISO string — how every fixture below states a date. */
const daysAgo = (days: number) => new Date(NOW - days * DAY_MS).toISOString();

function entry(over: Partial<LibraryRosterEntry> & { track_id: string }): LibraryRosterEntry {
  return {
    title: `title-${over.track_id}`,
    artist: `artist-${over.track_id}`,
    added_at: null,
    is_baseline: false,
    absent_at: null,
    ...over,
  };
}

/** Play index in `playsByTrack`'s shape: track id -> ascending play times. */
function plays(byTrack: Record<string, number[]>): Map<string, number[]> {
  return new Map(Object.entries(byTrack).map(([id, times]) => [id, [...times].sort((a, b) => a - b)]));
}

const NO_PLAYS = new Map<string, number[]>();

/** Observation started long enough ago that the clamp is a no-op for recent adds. */
const OBSERVING_2_YEARS = NOW - 730 * DAY_MS;

describe("buildAgingShelf — the clamp (Context §2, AC-1)", () => {
  it("measures an observed track from its LATEST play, with no clamp applied", () => {
    // Played 200 days ago and again 120 days ago. The clock runs from the
    // latest play, not the earliest — a track played twice is less neglected,
    // not more.
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(400) })],
      OBSERVING_2_YEARS,
      NOW,
      plays({ t1: [NOW - 200 * DAY_MS, NOW - 120 * DAY_MS] }),
    );

    expect(model.rows.longest).toHaveLength(1);
    expect(model.rows.longest[0].daysUnplayed).toBe(120);
    expect(model.rows.longest[0].basis).toBe("observed-play");
  });

  // The whole Decision B fix. A veteran's 2019 track would otherwise read
  // "2,400 days unplayed" purely because Curfew was not there to watch it.
  it("clamps the no-play branch to observationStartMs when added_at is older", () => {
    const observationStart = NOW - 300 * DAY_MS;
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(2400) })],
      observationStart,
      NOW,
      NO_PLAYS,
    );

    expect(model.rows.longest[0].daysUnplayed).toBe(300);
    expect(model.rows.longest[0].basis).toBe("add-date");
  });

  it("leaves the no-play branch on raw added_at when the add is newer than observation start", () => {
    // A post-install add: `added_at >= observationStart`, so `max()` is a no-op.
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(120) })],
      NOW - 300 * DAY_MS,
      NOW,
      NO_PLAYS,
    );

    expect(model.rows.longest[0].daysUnplayed).toBe(120);
  });

  // Context §2's explicit no-branch rule: `max()` handles both populations
  // uniformly, so `if (entry.is_baseline)` must appear nowhere in the model.
  it("produces identical results for is_baseline true and false at the same dates", () => {
    const build = (isBaseline: boolean) =>
      buildAgingShelf(
        [entry({ track_id: "t1", added_at: daysAgo(2400), is_baseline: isBaseline })],
        NOW - 300 * DAY_MS,
        NOW,
        NO_PLAYS,
      );

    expect(build(true)).toEqual(build(false));
    expect(build(true).rows.longest[0].daysUnplayed).toBe(300);
  });
});

describe("buildAgingShelf — fail-closed observation start (AC-11, Context §3)", () => {
  // The binding rule. A degradation to raw `added_at` here would ship the
  // exact pre-fix behaviour under a story that claims to have fixed it.
  it("suppresses the no-play branch entirely when observationStartMs is null", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "veteran", added_at: daysAgo(2400) })],
      null,
      NOW,
      NO_PLAYS,
    );

    expect(model.rows.longest).toEqual([]);
    expect(model.qualifyingCount).toBe(0);
    expect(model.observationSuppressed).toBe(true);
  });

  it("never falls back to raw added_at when suppressed — not even as a smaller number", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "veteran", added_at: daysAgo(2400) })],
      null,
      NOW,
      NO_PLAYS,
    );
    // 2400 is the pre-fix value; any row at all is the regression.
    expect(model.rows.longest.map((r) => r.daysUnplayed)).not.toContain(2400);
    expect(model.suppressedNoPlayCount).toBe(1);
  });

  it("keeps observed-play rows when suppressed — an observed play is a fact, not an inference", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "played", added_at: daysAgo(2400) }), entry({ track_id: "unplayed" })],
      null,
      NOW,
      plays({ played: [NOW - 500 * DAY_MS] }),
    );

    expect(model.rows.longest).toHaveLength(1);
    expect(model.rows.longest[0].trackId).toBe("played");
    expect(model.rows.longest[0].daysUnplayed).toBe(500);
  });
});

describe("buildAgingShelf — the 90-day threshold (AC-1)", () => {
  const at = (days: number) =>
    buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(days) })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

  it("excludes a track one day short of the threshold", () => {
    expect(at(89).qualifyingCount).toBe(0);
    expect(at(89).rows.longest).toEqual([]);
  });

  it("includes a track exactly at the threshold", () => {
    expect(at(90).qualifyingCount).toBe(1);
    expect(at(90).rows.longest[0].daysUnplayed).toBe(AGING_THRESHOLD_DAYS);
  });

  it("includes a track past the threshold", () => {
    expect(at(91).qualifyingCount).toBe(1);
    expect(at(91).rows.longest[0].daysUnplayed).toBe(91);
  });

  it("is 90 days, not three calendar months", () => {
    expect(AGING_THRESHOLD_DAYS).toBe(90);
  });
});

describe("buildAgingShelf — absent_at exclusion (AC-8)", () => {
  // The FIRST web-side coverage the soft-delete has ever had. The committed
  // fixture sets `absent_at: null` for all 653 entries by design, so nothing
  // anywhere exercised this before (deferred-work.md).
  it("excludes an absent track from the rows", () => {
    const model = buildAgingShelf(
      [
        entry({ track_id: "gone", added_at: daysAgo(400), absent_at: daysAgo(10) }),
        entry({ track_id: "here", added_at: daysAgo(400) }),
      ],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(model.rows.longest.map((r) => r.trackId)).toEqual(["here"]);
  });

  it("excludes an absent track from EVERY count, not just the list", () => {
    const absentOnly = [
      entry({ track_id: "gone", added_at: daysAgo(400), absent_at: daysAgo(10) }),
      // Absent AND recently downloaded, AND undated — would otherwise land in
      // three different counters.
      entry({ track_id: "gone2", added_at: daysAgo(5), absent_at: daysAgo(1) }),
      entry({ track_id: "gone3", absent_at: daysAgo(1) }),
    ];
    const model = buildAgingShelf(absentOnly, OBSERVING_2_YEARS, NOW, NO_PLAYS);

    expect(model.qualifyingCount).toBe(0);
    expect(model.recentlyDownloadedCount).toBe(0);
    expect(model.unknownAddDateCount).toBe(0);
    expect(model.presentTrackCount).toBe(0);
  });

  it("excludes an absent track even when it has observed plays", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "gone", absent_at: daysAgo(1) })],
      OBSERVING_2_YEARS,
      NOW,
      plays({ gone: [NOW - 500 * DAY_MS] }),
    );

    expect(model.rows.longest).toEqual([]);
    expect(model.presentTrackCount).toBe(0);
  });
});

describe("buildAgingShelf — unknown add-date (AC-7)", () => {
  it("classifies a track with no added_at and no plays as unknown-add-date", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: null })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(model.unknownAddDateCount).toBe(1);
    expect(model.unknownAddDate.map((r) => r.trackId)).toEqual(["t1"]);
  });

  it("never counts an unknown-add-date track into the aging total or the rows", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: null })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(model.qualifyingCount).toBe(0);
    expect(model.rows.longest).toEqual([]);
    expect(model.rows.shortest).toEqual([]);
  });

  it("treats an unparsable added_at as unknown rather than dropping or defaulting it", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: "not-a-date" })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(model.unknownAddDateCount).toBe(1);
  });

  // An undated track the DJ has demonstrably played is not "unknown add date"
  // — its clock runs from the play, which is a fact.
  it("does NOT classify an undated track as unknown when it has an observed play", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: null })],
      OBSERVING_2_YEARS,
      NOW,
      plays({ t1: [NOW - 300 * DAY_MS] }),
    );

    expect(model.unknownAddDateCount).toBe(0);
    expect(model.rows.longest[0].daysUnplayed).toBe(300);
  });

  it("keeps unknown-add-date tracks even when observation start is suppressed", () => {
    // The classification does not depend on the clamp — it is a statement
    // about the track's own data, not about how long Curfew has been watching.
    const model = buildAgingShelf([entry({ track_id: "t1" })], null, NOW, NO_PLAYS);
    expect(model.unknownAddDateCount).toBe(1);
  });
});

describe("buildAgingShelf — recently downloaded (AC-6)", () => {
  it("counts a track added inside the 30-day window with no observed play", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(5) })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(model.recentlyDownloadedCount).toBe(1);
    expect(RECENT_DOWNLOAD_DAYS).toBe(30);
  });

  it("excludes a track added inside the window that HAS been played", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(5) })],
      OBSERVING_2_YEARS,
      NOW,
      plays({ t1: [NOW - 2 * DAY_MS] }),
    );

    expect(model.recentlyDownloadedCount).toBe(0);
  });

  it("excludes a track added outside the window", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(31) })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(model.recentlyDownloadedCount).toBe(0);
  });

  // AC-6 is explicit: RAW `added_at`, not the clamped clock. It is a real fact
  // about the DJ's library, not an inference about observation — so it survives
  // the fail-closed suppression that removes the rows.
  it("is computed from raw added_at, so it still reports when observation start is suppressed", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(5) })],
      null,
      NOW,
      NO_PLAYS,
    );

    expect(model.recentlyDownloadedCount).toBe(1);
    expect(model.rows.longest).toEqual([]);
  });

  // A brand-new install clamps everything to a few days, but the DJ's tracks
  // were genuinely downloaded when they were downloaded.
  it("is unaffected by a recent observation start clamping the same track", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(5) })],
      NOW - 2 * DAY_MS,
      NOW,
      NO_PLAYS,
    );

    expect(model.recentlyDownloadedCount).toBe(1);
  });
});

describe("buildAgingShelf — sort and cap (AC-2, AC-9)", () => {
  /** `count` tracks aging 100, 101, 102 … days, added in that order. */
  const ladder = (count: number) =>
    Array.from({ length: count }, (_, i) => entry({ track_id: `t${i}`, added_at: daysAgo(100 + i) }));

  it("defaults to longest-unplayed first", () => {
    const model = buildAgingShelf(ladder(3), OBSERVING_2_YEARS, NOW, NO_PLAYS);
    expect(model.rows.longest.map((r) => r.daysUnplayed)).toEqual([102, 101, 100]);
  });

  it("sorts in both directions", () => {
    const model = buildAgingShelf(ladder(3), OBSERVING_2_YEARS, NOW, NO_PLAYS);
    expect(model.rows.shortest.map((r) => r.daysUnplayed)).toEqual([100, 101, 102]);
  });

  it("caps at SHELF_ROW_CAP while reporting the full qualifying count", () => {
    const model = buildAgingShelf(ladder(150), OBSERVING_2_YEARS, NOW, NO_PLAYS);

    expect(SHELF_ROW_CAP).toBe(100);
    expect(model.rows.longest).toHaveLength(100);
    expect(model.qualifyingCount).toBe(150);
    expect(model.capped).toBe(true);
  });

  // The trap the story names explicitly: a reversed slice of the SAME capped
  // 100 is a different, silently wrong list. Ascending must surface the
  // genuinely shortest-aging 100, which share no rows with the longest 100
  // here (150 rows, cap 100 — the middle 50 appear in both, the extremes in
  // exactly one).
  it("sorts BEFORE capping, so ascending surfaces the shortest-aging rows and not a reversed slice", () => {
    const model = buildAgingShelf(ladder(150), OBSERVING_2_YEARS, NOW, NO_PLAYS);

    // Longest: 249 down to 150. Shortest: 100 up to 199.
    expect(model.rows.longest[0].daysUnplayed).toBe(249);
    expect(model.rows.longest.at(-1)?.daysUnplayed).toBe(150);
    expect(model.rows.shortest[0].daysUnplayed).toBe(100);
    expect(model.rows.shortest.at(-1)?.daysUnplayed).toBe(199);

    // The proof it is not a reversal: the shortest list contains rows the
    // longest list never saw.
    const longestIds = new Set(model.rows.longest.map((r) => r.trackId));
    expect(model.rows.shortest.some((r) => !longestIds.has(r.trackId))).toBe(true);
  });

  it("reports capped false when everything fits", () => {
    const model = buildAgingShelf(ladder(3), OBSERVING_2_YEARS, NOW, NO_PLAYS);
    expect(model.capped).toBe(false);
  });

  // Without a tie-break the cap picks an arbitrary subset of a tied population
  // and two identical requests can disagree — the same total-order discipline
  // `getRecentSets` needed for its `started_at` collisions.
  it("breaks ties on track_id so the order is total and the cap is deterministic", () => {
    const tied = [
      entry({ track_id: "c", added_at: daysAgo(100) }),
      entry({ track_id: "a", added_at: daysAgo(100) }),
      entry({ track_id: "b", added_at: daysAgo(100) }),
    ];
    const model = buildAgingShelf(tied, OBSERVING_2_YEARS, NOW, NO_PLAYS);

    expect(model.rows.longest.map((r) => r.trackId)).toEqual(["a", "b", "c"]);
    expect(model.rows.shortest.map((r) => r.trackId)).toEqual(["a", "b", "c"]);
  });
});

describe("buildAgingShelf — rows carry Tier A only (Context §5, AC-3)", () => {
  it("carries title, artist and the day count, and nothing else", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", title: "Strings of Life", artist: "Rhythim Is Rhythim", added_at: daysAgo(400) })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(model.rows.longest[0]).toEqual({
      trackId: "t1",
      title: "Strings of Life",
      artist: "Rhythim Is Rhythim",
      daysUnplayed: 400,
      basis: "add-date",
    });
  });
});

describe("buildAgingShelf — future-dated dates (deferred-work.md, unruled)", () => {
  // The three-way disposition is still open. Per Task 2: count it into the
  // unreconciled disclosure rather than dropping it silently.
  it("counts a future-dated added_at as unreconciled rather than dropping it", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: new Date(NOW + 10 * DAY_MS).toISOString() })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(model.unreconciledDateCount).toBe(1);
    expect(model.rows.longest).toEqual([]);
    expect(model.qualifyingCount).toBe(0);
  });

  it("counts a future-dated last play as unreconciled rather than rendering a negative day count", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(400) })],
      OBSERVING_2_YEARS,
      NOW,
      plays({ t1: [NOW + 10 * DAY_MS] }),
    );

    expect(model.unreconciledDateCount).toBe(1);
    expect(model.rows.longest).toEqual([]);
  });

  it("never emits a negative daysUnplayed", () => {
    const model = buildAgingShelf(
      [
        entry({ track_id: "future-add", added_at: new Date(NOW + 5 * DAY_MS).toISOString() }),
        entry({ track_id: "future-play", added_at: daysAgo(400) }),
        entry({ track_id: "normal", added_at: daysAgo(400) }),
      ],
      OBSERVING_2_YEARS,
      NOW,
      plays({ "future-play": [NOW + 5 * DAY_MS] }),
    );

    for (const row of [...model.rows.longest, ...model.rows.shortest]) {
      expect(row.daysUnplayed).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("buildAgingShelf — the three terminal states (AC-4, AC-5, Context §4)", () => {
  it("reports an empty roster as nothing-synced, distinct from a clear shelf", () => {
    const model = buildAgingShelf([], OBSERVING_2_YEARS, NOW, NO_PLAYS);
    expect(model.presentTrackCount).toBe(0);
    expect(model.observationDays).toBe(730);
  });

  it("reports observationDays so the component can tell the wait from the all-clear", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(10) })],
      NOW - 40 * DAY_MS,
      NOW,
      NO_PLAYS,
    );

    expect(model.observationDays).toBe(40);
    expect(model.canJudge).toBe(false);
    expect(model.qualifyingCount).toBe(0);
  });

  it("reports canJudge once observation reaches the threshold", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(10) })],
      NOW - 90 * DAY_MS,
      NOW,
      NO_PLAYS,
    );

    expect(model.observationDays).toBe(90);
    expect(model.canJudge).toBe(true);
  });

  // Structural, per Context §4: both branches are bounded below by the clamp,
  // so under 90 days of observation nothing can qualify — which is exactly why
  // "Everything you've bought is getting played" would be a false claim.
  it("cannot produce a qualifying row under 90 days of observation", () => {
    const model = buildAgingShelf(
      [
        entry({ track_id: "veteran", added_at: daysAgo(2400) }),
        entry({ track_id: "old", added_at: daysAgo(500) }),
      ],
      NOW - 30 * DAY_MS,
      NOW,
      NO_PLAYS,
    );

    expect(model.qualifyingCount).toBe(0);
  });

  // Suppression is not the same fact as a short observation window, but the
  // copy consequence is identical: we cannot claim everything is getting
  // played, because we do not know.
  it("reports canJudge false when observation start is suppressed", () => {
    const model = buildAgingShelf([entry({ track_id: "t1" })], null, NOW, NO_PLAYS);
    expect(model.canJudge).toBe(false);
    expect(model.observationDays).toBeNull();
  });
});

describe("agingShelfState — the four terminal states (AC-4, AC-5, Context §4)", () => {
  const build = (
    entries: LibraryRosterEntry[],
    observationStartMs: number | null,
    now = NOW,
  ) => agingShelfState(buildAgingShelf(entries, observationStartMs, now, NO_PLAYS));

  it("reports nothing-synced for an empty roster", () => {
    expect(build([], OBSERVING_2_YEARS)).toBe("nothing-synced");
  });

  // The failure Context §4 exists to prevent: this must NOT be "all-clear",
  // because "Everything you've bought is getting played" is an affirmative
  // false claim to every DJ in their first three months — which is every DJ at
  // launch.
  it("reports not-yet-possible under 90 days of observation, never all-clear", () => {
    const state = build([entry({ track_id: "t1", added_at: daysAgo(10) })], NOW - 30 * DAY_MS);
    expect(state).toBe("not-yet-possible");
    expect(state).not.toBe("all-clear");
  });

  it("reports not-yet-possible at 89 days and all-clear at 90", () => {
    const entries = [entry({ track_id: "t1", added_at: daysAgo(1) })];
    expect(build(entries, NOW - 89 * DAY_MS)).toBe("not-yet-possible");
    expect(build(entries, NOW - 90 * DAY_MS)).toBe("all-clear");
  });

  it("reports not-yet-possible when the observation anchor is suppressed", () => {
    // We do not know how long Curfew has been watching, so we cannot claim
    // everything is getting played. Fail-closed in copy, not just in the math.
    expect(build([entry({ track_id: "t1", added_at: daysAgo(10) })], null)).toBe(
      "not-yet-possible",
    );
  });

  it("reports all-clear only with enough observation AND nothing qualifying", () => {
    expect(build([entry({ track_id: "t1", added_at: daysAgo(10) })], OBSERVING_2_YEARS)).toBe(
      "all-clear",
    );
  });

  it("reports rows when tracks qualify", () => {
    expect(build([entry({ track_id: "t1", added_at: daysAgo(400) })], OBSERVING_2_YEARS)).toBe(
      "rows",
    );
  });

  // A synced set whose `started_at` predates signup can produce rows while
  // `canJudge` is false. Rendering "not yet possible" above a list of real rows
  // would be the module contradicting itself on screen.
  it("prefers rows over the wait state when both could apply", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1" })],
      NOW - 10 * DAY_MS,
      NOW,
      plays({ t1: [NOW - 400 * DAY_MS] }),
    );

    expect(model.canJudge).toBe(false);
    expect(model.qualifyingCount).toBe(1);
    expect(agingShelfState(model)).toBe("rows");
  });

  // The distinction the day-one contract turns on: a DJ with a real library
  // and nothing aging is a different fact from a DJ with no library at all.
  it("never reports nothing-synced for a roster that has present tracks", () => {
    expect(build([entry({ track_id: "t1", added_at: daysAgo(10) })], OBSERVING_2_YEARS)).not.toBe(
      "nothing-synced",
    );
  });

  it("reports nothing-synced when every roster entry is soft-deleted", () => {
    // AC-8 removes them from `presentTrackCount`, so a DJ whose whole library
    // went absent sees the day-one shape rather than an all-clear about tracks
    // they no longer own.
    expect(
      build([entry({ track_id: "gone", added_at: daysAgo(400), absent_at: daysAgo(1) })], OBSERVING_2_YEARS),
    ).toBe("nothing-synced");
  });
});

describe("agingShelfSummary (AC-13)", () => {
  it("names the list and its size", () => {
    const model = buildAgingShelf(
      [
        entry({ track_id: "t1", added_at: daysAgo(400) }),
        entry({ track_id: "t2", added_at: daysAgo(300) }),
      ],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(agingShelfSummary(model)).toBe(
      "Aging shelf: 2 tracks haven't been played in 90 days or more.",
    );
  });

  it("uses the singular for one track", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(400) })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(agingShelfSummary(model)).toBe(
      "Aging shelf: 1 track hasn't been played in 90 days or more.",
    );
  });

  // 4.5's review found a section announcing a figure the UI had explicitly
  // declined to state. In a gated state the accessible name must not claim a
  // number, because the visible module states none.
  it("claims no number in the not-yet-possible state", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(10) })],
      NOW - 30 * DAY_MS,
      NOW,
      NO_PLAYS,
    );

    expect(agingShelfSummary(model)).toBe("Aging shelf");
  });

  it("claims no number when observation start is suppressed", () => {
    const model = buildAgingShelf([entry({ track_id: "t1" })], null, NOW, NO_PLAYS);
    expect(agingShelfSummary(model)).toBe("Aging shelf");
  });

  it("states the all-clear only when observation is long enough to judge it", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(10) })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(agingShelfSummary(model)).toBe("Aging shelf: nothing has gone unplayed for 90 days.");
  });

  it("names the day-one state rather than claiming an all-clear over an empty roster", () => {
    const model = buildAgingShelf([], OBSERVING_2_YEARS, NOW, NO_PLAYS);
    expect(agingShelfSummary(model)).toBe("Aging shelf");
  });

  // AC-9: the cap must be stated out loud wherever the figure is stated,
  // including to assistive tech — a screen-reader user hearing "100 tracks"
  // over a 4,000-track shelf is the silent-truncation failure with extra steps.
  it("states the cap alongside the qualifying count when the list is truncated", () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      entry({ track_id: `t${i}`, added_at: daysAgo(100 + i) }),
    );
    const model = buildAgingShelf(many, OBSERVING_2_YEARS, NOW, NO_PLAYS);

    expect(agingShelfSummary(model)).toBe(
      "Aging shelf: 150 tracks haven't been played in 90 days or more; the longest-unplayed 100 are listed.",
    );
  });

  // Caught in this story's browser pass, not by the suite: flipping the sort
  // left the visible disclosure reading "the shortest-unplayed 100" while the
  // section's accessible name still announced "the longest-unplayed 100".
  // The two capped lists share no rows at the extremes, so that is a WRONG
  // ANSWER to a screen-reader user, not a stale wording — the same
  // accessible-name-disagrees-with-visible-state failure 4.5's review found.
  it("names the sorted end that is actually listed, not always the longest", () => {
    const many = Array.from({ length: 150 }, (_, i) =>
      entry({ track_id: `t${i}`, added_at: daysAgo(100 + i) }),
    );
    const model = buildAgingShelf(many, OBSERVING_2_YEARS, NOW, NO_PLAYS);

    expect(agingShelfSummary(model, "shortest")).toContain("the shortest-unplayed 100 are listed");
    expect(agingShelfSummary(model, "shortest")).not.toContain("longest");
    expect(agingShelfSummary(model, "longest")).toContain("the longest-unplayed 100 are listed");
  });

  // Below the cap there is no truncation to name, so the sort must not leak a
  // clause claiming one.
  it("names no sorted end when the list is not truncated", () => {
    const model = buildAgingShelf(
      [entry({ track_id: "t1", added_at: daysAgo(400) })],
      OBSERVING_2_YEARS,
      NOW,
      NO_PLAYS,
    );

    expect(agingShelfSummary(model, "shortest")).toBe(
      "Aging shelf: 1 track hasn't been played in 90 days or more.",
    );
  });
});

describe("buildAgingShelf — determinism and purity", () => {
  it("never mutates the entries it is given (D-6)", () => {
    const entries = [entry({ track_id: "t1", added_at: daysAgo(400) })];
    const snapshot = JSON.parse(JSON.stringify(entries));
    buildAgingShelf(entries, OBSERVING_2_YEARS, NOW, NO_PLAYS);
    expect(entries).toEqual(snapshot);
  });

  it("never mutates the shared play index — three other modules read it", () => {
    const index = plays({ t1: [NOW - 300 * DAY_MS, NOW - 100 * DAY_MS] });
    const snapshot = new Map([...index].map(([k, v]) => [k, [...v]]));
    buildAgingShelf([entry({ track_id: "t1" })], OBSERVING_2_YEARS, NOW, index);
    expect(index).toEqual(snapshot);
  });

  it("returns the same model for the same inputs", () => {
    const entries = [
      entry({ track_id: "b", added_at: daysAgo(400) }),
      entry({ track_id: "a", added_at: daysAgo(400) }),
    ];
    expect(buildAgingShelf(entries, OBSERVING_2_YEARS, NOW, NO_PLAYS)).toEqual(
      buildAgingShelf(entries, OBSERVING_2_YEARS, NOW, NO_PLAYS),
    );
  });
});
