import { describe, expect, it } from "vitest";
import {
  buildLibraryConversion,
  buildLiveConversionRate,
  convertedWithinWindow,
  CONVERSION_WINDOWS,
  DEFAULT_CONVERSION_WINDOW,
  DEFAULT_LIVE_WINDOW,
  firstPlayByTrack,
  hasEnoughCohorts,
  isCohortComplete,
  isLowConfidenceCohort,
  libraryConversionSummary,
  liveConversionRateSummary,
  LIVE_CONVERSION_WINDOWS,
  LOW_CONFIDENCE_COHORT_SIZE,
  undatedDisclosure,
  type ConversionWindow,
  type LibraryAddEvent,
  type LibraryConversionModel,
} from "./libraryConversion";

/** The default (90-day) series — what every test below reads unless it is
 *  specifically about the D-13 window toggle. */
const at = (m: LibraryConversionModel, w: ConversionWindow = DEFAULT_CONVERSION_WINDOW) =>
  m.windows[w];

/** `undatedDisclosure` now takes the two counts directly (Story 4.3, so
 *  {@link LiveConversionRate} can reuse it too) — this projects them off a
 *  {@link LibraryConversionModel} the way `StyleEvolutionView` does. */
const disclosureFor = (m: LibraryConversionModel, w: ConversionWindow = DEFAULT_CONVERSION_WINDOW) =>
  undatedDisclosure({ noAddDateCount: m.noAddDateCount, pendingCohortCount: at(m, w).pendingCohortCount }, w);
import type { SetRecord, SyncPlay } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local-time ISO for a given local calendar moment — these tests are about
 *  LOCAL month bucketing, so they must not hand in UTC strings and hope. */
function localIso(y: number, m: number, d: number, h = 12): string {
  return new Date(y, m - 1, d, h).toISOString();
}

function play(overrides: Partial<SyncPlay>): SyncPlay {
  return {
    position: 1,
    title: "T",
    artist: "A",
    started_at: null,
    bpm: null,
    genre: null,
    camelot_key: null,
    in_library: true,
    ...overrides,
  };
}

function set(plays: SyncPlay[]): SetRecord {
  return {
    external_id: `set-${plays.map((p) => p.track_id ?? "x").join("-")}`,
    started_at: localIso(2026, 1, 1),
    ended_at: localIso(2026, 1, 1, 14),
    plays,
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
      track_count: plays.length,
      energy_arc: [],
      confidence: { value: 1, track_count: plays.length, long_gap_count: 0 },
    },
  };
}

function added(trackId: string, iso: string | null): LibraryAddEvent {
  return { track_id: trackId, added_at: iso };
}

/** Well past every cohort used below, so nothing is pending unless a test says so. */
const NOW = new Date(2027, 5, 1).getTime();

describe("cohort bucketing", () => {
  it("buckets add-events by the LOCAL month they were added", () => {
    const model = buildLibraryConversion(
      [
        added("a", localIso(2026, 1, 5)),
        added("b", localIso(2026, 1, 28)),
        added("c", localIso(2026, 2, 3)),
      ],
      [],
      NOW,
    );

    expect(at(model).cohorts.map((c) => c.bucket)).toEqual(["2026-01", "2026-02"]);
    expect(at(model).cohorts[0].added).toBe(2);
    expect(at(model).cohorts[1].added).toBe(1);
  });

  it("orders cohorts ascending across a year boundary", () => {
    const model = buildLibraryConversion(
      [
        added("c", localIso(2026, 2, 1)),
        added("a", localIso(2025, 11, 1)),
        added("b", localIso(2025, 12, 1)),
        added("d", localIso(2026, 1, 1)),
      ],
      [],
      NOW,
    );

    expect(at(model).cohorts.map((c) => c.bucket)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("de-dupes a redelivered add-event rather than double-counting the cohort", () => {
    const model = buildLibraryConversion(
      [added("a", localIso(2026, 1, 5)), added("a", localIso(2026, 1, 5))],
      [],
      NOW,
    );

    expect(at(model).cohorts[0].added).toBe(1);
    expect(model.totalTracked).toBe(1);
  });
});

describe("the 90-day conversion window (D-8)", () => {
  const addedMs = new Date(2026, 0, 1).getTime();

  it("counts a play on day 89 and on day 90, but not day 91", () => {
    expect(convertedWithinWindow(addedMs, addedMs + 89 * DAY_MS)).toBe(true);
    expect(convertedWithinWindow(addedMs, addedMs + 90 * DAY_MS)).toBe(true);
    expect(convertedWithinWindow(addedMs, addedMs + 91 * DAY_MS)).toBe(false);
  });

  it("counts a play on the add day itself", () => {
    expect(convertedWithinWindow(addedMs, addedMs)).toBe(true);
  });

  it("does not count a play from BEFORE the add date", () => {
    // A play predating the add-date is a catalogue inconsistency, not a
    // conversion — counting it would inflate the rate using data that says the
    // opposite of what the metric claims.
    expect(convertedWithinWindow(addedMs, addedMs - DAY_MS)).toBe(false);
  });

  it("treats a never-played track as unconverted, not as missing data", () => {
    expect(convertedWithinWindow(addedMs, undefined)).toBe(false);
  });

  it("computes a cohort rate from real plays end to end", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const sets = [
      set([
        play({ track_id: "converted", started_at: new Date(addMs + 10 * DAY_MS).toISOString() }),
        play({ track_id: "too-late", started_at: new Date(addMs + 200 * DAY_MS).toISOString() }),
      ]),
    ];

    const model = buildLibraryConversion(
      [added("converted", addedIso), added("too-late", addedIso), added("never", addedIso)],
      sets,
      NOW,
    );

    expect(at(model).cohorts).toHaveLength(1);
    expect(at(model).cohorts[0]).toMatchObject({ added: 3, converted: 1 });
    expect(at(model).cohorts[0].rate).toBeCloseTo(1 / 3);
  });

  it("uses a track's EARLIEST play, so a later replay cannot rescue a miss", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const sets = [
      set([play({ track_id: "t", started_at: new Date(addMs + 300 * DAY_MS).toISOString() })]),
      set([play({ track_id: "t", started_at: new Date(addMs + 400 * DAY_MS).toISOString() })]),
    ];

    expect(firstPlayByTrack(sets).get("t")).toBe(addMs + 300 * DAY_MS);
    expect(at(buildLibraryConversion([added("t", addedIso)], sets, NOW)).cohorts[0].converted).toBe(0);
  });

  it("ignores plays that carry no track_id or no timestamp", () => {
    const sets = [
      set([
        play({ track_id: undefined, started_at: localIso(2026, 1, 2) }),
        play({ track_id: "t", started_at: null }),
      ]),
    ];
    expect(firstPlayByTrack(sets).size).toBe(0);
    expect(at(buildLibraryConversion([added("t", localIso(2026, 1, 1))], sets, NOW)).cohorts[0].converted).toBe(
      0,
    );
  });
});

describe("cohort-recency honesty (D-9)", () => {
  it("measures completeness from the END of the month, not its start", () => {
    // A track added March 31st has not had its 90 days until ~June 29th.
    const marchEndPlus90 = new Date(2026, 2, 31, 23, 59, 59, 999).getTime() + 90 * DAY_MS;
    expect(isCohortComplete("2026-03", marchEndPlus90 - 1, 90)).toBe(false);
    expect(isCohortComplete("2026-03", marchEndPlus90, 90)).toBe(true);
    // The naive "start of month + 90d" reading would have called it complete
    // here, scoring every late-March purchase a failure it never had time to
    // avoid.
    expect(isCohortComplete("2026-03", new Date(2026, 2, 1).getTime() + 90 * DAY_MS, 90)).toBe(false);
  });

  it("omits a still-converting cohort entirely rather than plotting it low", () => {
    const now = new Date(2026, 4, 15).getTime(); // mid-May
    const model = buildLibraryConversion(
      [added("old", localIso(2025, 6, 1)), added("recent", localIso(2026, 4, 1))],
      [],
      now,
    );

    expect(at(model).cohorts.map((c) => c.bucket)).toEqual(["2025-06"]);
    expect(at(model).cohorts.some((c) => c.bucket === "2026-04")).toBe(false);
    expect(at(model).pendingCohortCount).toBe(1);
  });

  it("discloses pending cohorts rather than letting the line just stop", () => {
    const now = new Date(2026, 4, 15).getTime();
    const model = buildLibraryConversion(
      [added("a", localIso(2026, 3, 1)), added("b", localIso(2026, 4, 1))],
      [],
      now,
    );

    expect(at(model).pendingCohortCount).toBe(2);
    expect(disclosureFor(model)).toContain("still inside the 90-day window");
  });
});

describe("unknown-add-date disclosure (D-10 / AC-7)", () => {
  it("excludes undated tracks from the denominator AND counts them", () => {
    const model = buildLibraryConversion(
      [added("a", localIso(2026, 1, 1)), added("b", null), added("c", null)],
      [],
      NOW,
    );

    expect(model.noAddDateCount).toBe(2);
    // An undated track must never inflate a cohort's denominator.
    expect(at(model).cohorts[0].added).toBe(1);
    expect(model.totalTracked).toBe(3);
  });

  it("treats an unparsable add date as undated, never as a fabricated bucket", () => {
    const model = buildLibraryConversion([added("a", "not-a-date")], [], NOW);
    expect(model.noAddDateCount).toBe(1);
    expect(at(model).cohorts).toHaveLength(0);
  });

  it("says nothing at all when there is nothing to disclose", () => {
    const model = buildLibraryConversion([added("a", localIso(2026, 1, 1))], [], NOW);
    expect(disclosureFor(model)).toBeNull();
  });

  it("uses singular and plural phrasing correctly", () => {
    const one = buildLibraryConversion([added("a", null)], [], NOW);
    expect(disclosureFor(one)).toBe("1 track has no known add date — not counted here.");

    const two = buildLibraryConversion([added("a", null), added("b", null)], [], NOW);
    expect(disclosureFor(two)).toBe("2 tracks have no known add date — not counted here.");
  });

  it("joins both disclosures when both apply", () => {
    const now = new Date(2026, 4, 15).getTime();
    const model = buildLibraryConversion(
      [added("a", null), added("b", localIso(2026, 4, 1))],
      [],
      now,
    );
    expect(disclosureFor(model)).toBe(
      "1 track has no known add date, and 1 recent month is still inside the 90-day window — not counted here.",
    );
  });
});

describe("empty and insufficient states (AC-3)", () => {
  it("handles no events at all without throwing or fabricating a point", () => {
    const model = buildLibraryConversion([], [], NOW);
    expect(model.noAddDateCount).toBe(0);
    expect(model.totalTracked).toBe(0);
    for (const w of CONVERSION_WINDOWS) {
      expect(model.windows[w]).toEqual({ window: w, cohorts: [], pendingCohortCount: 0 });
    }
    expect(hasEnoughCohorts(model, DEFAULT_CONVERSION_WINDOW)).toBe(false);
  });

  it("needs two COMPLETED cohorts, not two months of add-events", () => {
    const now = new Date(2026, 4, 15).getTime();
    const oneComplete = buildLibraryConversion(
      [added("a", localIso(2025, 12, 1)), added("b", localIso(2026, 4, 1))],
      [],
      now,
    );
    expect(at(oneComplete).cohorts).toHaveLength(1);
    expect(hasEnoughCohorts(oneComplete, DEFAULT_CONVERSION_WINDOW)).toBe(false);

    const twoComplete = buildLibraryConversion(
      [added("a", localIso(2025, 11, 1)), added("b", localIso(2025, 12, 1))],
      [],
      now,
    );
    expect(hasEnoughCohorts(twoComplete, DEFAULT_CONVERSION_WINDOW)).toBe(true);
  });
});

describe("low-confidence cohort disclosure (deferred-work.md: 1-track cohort read as confidently as a 256-track one)", () => {
  it("flags a cohort strictly below the threshold", () => {
    expect(isLowConfidenceCohort(1)).toBe(true);
    expect(isLowConfidenceCohort(LOW_CONFIDENCE_COHORT_SIZE - 1)).toBe(true);
  });

  it("does not flag a cohort at or above the threshold", () => {
    expect(isLowConfidenceCohort(LOW_CONFIDENCE_COHORT_SIZE)).toBe(false);
    expect(isLowConfidenceCohort(256)).toBe(false);
  });

  it("treats zero as low-confidence rather than a special case", () => {
    expect(isLowConfidenceCohort(0)).toBe(true);
  });
});

describe("the chart summary (AC-2)", () => {
  function modelFrom(pairs: Array<[string, number, number]>) {
    // [monthKey, added, converted] — built through the real function so the
    // caption is never tested against a shape the builder cannot produce.
    const events: LibraryAddEvent[] = [];
    const plays: SyncPlay[] = [];
    let n = 0;
    for (const [bucket, addedCount, convertedCount] of pairs) {
      const [y, m] = bucket.split("-").map(Number);
      for (let i = 0; i < addedCount; i++) {
        const id = `t${n++}`;
        const iso = localIso(y, m, 1);
        events.push(added(id, iso));
        if (i < convertedCount) {
          plays.push(
            play({
              track_id: id,
              started_at: new Date(new Date(iso).getTime() + DAY_MS).toISOString(),
            }),
          );
        }
      }
    }
    return buildLibraryConversion(events, [set(plays)], NOW);
  }

  it("reports the latest cohort and the direction since the first", () => {
    const summary = libraryConversionSummary(modelFrom([
        ["2026-01", 10, 4],
        ["2026-03", 10, 6],
      ]), DEFAULT_CONVERSION_WINDOW);
    expect(summary).toBe(
      "6 of the 10 tracks added in March made it into a set within 90 days (60%) — up from 40% in January.",
    );
  });

  it("says 'down' when conversion fell", () => {
    expect(
      libraryConversionSummary(modelFrom([
          ["2026-01", 10, 8],
          ["2026-03", 10, 3],
        ]), DEFAULT_CONVERSION_WINDOW),
    ).toContain("down from 80% in January");
  });

  it("reads as steady rather than manufacturing a trend from noise", () => {
    expect(
      libraryConversionSummary(modelFrom([
          ["2026-01", 100, 50],
          ["2026-03", 100, 52],
        ]), DEFAULT_CONVERSION_WINDOW),
    ).toBe(
      "52 of the 100 tracks added in March made it into a set within 90 days (52%) — about the same as January.",
    );
  });

  it("names the single cohort when only one has completed", () => {
    expect(libraryConversionSummary(modelFrom([["2026-01", 8, 2]]), DEFAULT_CONVERSION_WINDOW)).toBe(
      "2 of the 8 tracks added in January made it into a set within 90 days (25%).",
    );
  });

  it("disambiguates months with the year once the axis spans more than one", () => {
    const summary = libraryConversionSummary(modelFrom([
        ["2025-03", 10, 2],
        ["2026-03", 10, 8],
      ]), DEFAULT_CONVERSION_WINDOW);
    expect(summary).toContain("March 2026");
    expect(summary).toContain("March 2025");
  });

  it("distinguishes 'nothing tracked' from 'nothing has finished converting'", () => {
    expect(libraryConversionSummary(buildLibraryConversion([], [], NOW), DEFAULT_CONVERSION_WINDOW)).toBe(
      "No library additions tracked yet.",
    );

    const now = new Date(2026, 4, 15).getTime();
    expect(
      libraryConversionSummary(buildLibraryConversion([added("a", localIso(2026, 4, 1))], [], now), DEFAULT_CONVERSION_WINDOW),
    ).toBe("No cohorts have finished their 90-day window yet.");
  });
});

describe("the conversion-window toggle (D-13)", () => {
  it("precomputes every selectable window in one pass", () => {
    const model = buildLibraryConversion([added("a", localIso(2026, 1, 1))], [], NOW);
    expect(Object.keys(model.windows).map(Number).sort()).toEqual([30, 60, 90]);
    for (const w of CONVERSION_WINDOWS) expect(model.windows[w].window).toBe(w);
  });

  it("defaults to 90 — the length FR-11 locked, so 4.3's meter cannot disagree", () => {
    expect(DEFAULT_CONVERSION_WINDOW).toBe(90);
    expect(CONVERSION_WINDOWS[0]).toBe(90);
  });

  it("scores a track differently per window, from the SAME play", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    // Played on day 75: inside 90, outside 60 and 30.
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs + 75 * DAY_MS).toISOString() })])];
    const model = buildLibraryConversion([added("t", addedIso)], sets, NOW);

    expect(model.windows[90].cohorts[0].converted).toBe(1);
    expect(model.windows[60].cohorts[0].converted).toBe(0);
    expect(model.windows[30].cohorts[0].converted).toBe(0);
    // The denominator is the window-independent half — shortening the window
    // must never change how many tracks were ADDED.
    for (const w of CONVERSION_WINDOWS) expect(model.windows[w].cohorts[0].added).toBe(1);
  });

  it("rates are monotonic: a shorter window can never score HIGHER", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const sets = [
      set([
        play({ track_id: "fast", started_at: new Date(addMs + 5 * DAY_MS).toISOString() }),
        play({ track_id: "mid", started_at: new Date(addMs + 45 * DAY_MS).toISOString() }),
        play({ track_id: "slow", started_at: new Date(addMs + 80 * DAY_MS).toISOString() }),
      ]),
    ];
    const model = buildLibraryConversion(
      [added("fast", addedIso), added("mid", addedIso), added("slow", addedIso)],
      sets,
      NOW,
    );

    expect(model.windows[90].cohorts[0].rate).toBeCloseTo(1);
    expect(model.windows[60].cohorts[0].rate).toBeCloseTo(2 / 3);
    expect(model.windows[30].cohorts[0].rate).toBeCloseTo(1 / 3);
    expect(model.windows[90].cohorts[0].rate).toBeGreaterThanOrEqual(model.windows[60].cohorts[0].rate);
    expect(model.windows[60].cohorts[0].rate).toBeGreaterThanOrEqual(model.windows[30].cohorts[0].rate);
  });

  it("a shorter window completes MORE cohorts, so the line reaches closer to today", () => {
    const now = new Date(2026, 4, 15).getTime(); // mid-May
    const model = buildLibraryConversion(
      [
        added("jan", localIso(2026, 1, 10)),
        added("feb", localIso(2026, 2, 10)),
        added("mar", localIso(2026, 3, 10)),
      ],
      [],
      now,
    );

    // Jan closes 90 days after Jan 31 (~May 1); Feb and Mar have not.
    expect(model.windows[90].cohorts.map((c) => c.bucket)).toEqual(["2026-01"]);
    // At 30 days, Feb (closes ~Mar 30) and Mar (closes ~Apr 30) both qualify.
    expect(model.windows[30].cohorts.map((c) => c.bucket)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(model.windows[30].pendingCohortCount).toBeLessThan(model.windows[90].pendingCohortCount);
  });

  it("names the selected window in the caption, never leaving it implicit", () => {
    const addedIso = localIso(2025, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs + 5 * DAY_MS).toISOString() })])];
    const model = buildLibraryConversion(
      [added("t", addedIso), added("u", localIso(2025, 6, 1))],
      sets,
      NOW,
    );

    expect(libraryConversionSummary(model, 90)).toContain("within 90 days");
    expect(libraryConversionSummary(model, 60)).toContain("within 60 days");
    expect(libraryConversionSummary(model, 30)).toContain("within 30 days");
  });

  it("names the selected window in the pending-cohort disclosure too", () => {
    const now = new Date(2026, 4, 15).getTime();
    const model = buildLibraryConversion([added("a", localIso(2026, 4, 1))], [], now);
    expect(disclosureFor(model, 90)).toContain("90-day window");
    expect(disclosureFor(model, 30)).toContain("30-day window");
  });

  it("gates insufficient-history per window, not globally", () => {
    const now = new Date(2026, 4, 15).getTime();
    const model = buildLibraryConversion(
      [added("jan", localIso(2026, 1, 10)), added("feb", localIso(2026, 2, 10))],
      [],
      now,
    );
    // Only Jan has closed at 90 — one cohort is not a trend.
    expect(hasEnoughCohorts(model, 90)).toBe(false);
    // Both have closed at 30.
    expect(hasEnoughCohorts(model, 30)).toBe(true);
  });

  it("leaves the undated count window-independent — undated is undated at every window", () => {
    const model = buildLibraryConversion(
      [added("a", null), added("b", null), added("c", localIso(2026, 1, 1))],
      [],
      NOW,
    );
    expect(model.noAddDateCount).toBe(2);
    for (const w of CONVERSION_WINDOWS) {
      expect(model.windows[w].cohorts[0].added).toBe(1);
    }
  });
});

describe("live conversion rate (Story 4.3, Decision E-1, AC-1/AC-3/AC-4)", () => {
  it("counts a track added and played inside the window, defaulting to DEFAULT_LIVE_WINDOW", () => {
    const addedIso = localIso(2026, 5, 1);
    const addMs = new Date(addedIso).getTime();
    const now = addMs + 10 * DAY_MS;
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs + 5 * DAY_MS).toISOString() })])];

    const rate = buildLiveConversionRate([added("t", addedIso)], sets, now);

    expect(rate).toMatchObject({
      window: DEFAULT_LIVE_WINDOW,
      added: 1,
      played: 1,
      rate: 1,
      noAddDateCount: 0,
    });
  });

  it("counts a track added but never played", () => {
    const addedIso = localIso(2026, 5, 1);
    const now = new Date(addedIso).getTime() + 10 * DAY_MS;

    const rate = buildLiveConversionRate([added("t", addedIso)], [], now, 60);

    expect(rate).toMatchObject({ added: 1, played: 0, rate: 0 });
  });

  it("excludes a track added outside the trailing window", () => {
    const now = new Date(2026, 5, 1).getTime();
    const tooOld = now - 61 * DAY_MS;

    const rate = buildLiveConversionRate([added("t", new Date(tooOld).toISOString())], [], now, 60);

    expect(rate).toMatchObject({ added: 0, played: 0, rate: null });
  });

  it("excludes an undated track from the denominator AND counts it in noAddDateCount (AC-4)", () => {
    const now = new Date(2026, 5, 1).getTime();

    const rate = buildLiveConversionRate(
      [added("dated", localIso(2026, 4, 20)), added("undated", null)],
      [],
      now,
      60,
    );

    expect(rate.added).toBe(1);
    expect(rate.noAddDateCount).toBe(1);
  });

  it("window-boundary: counts a track added exactly `window` days ago, excludes one day further back", () => {
    const now = new Date(2026, 5, 1).getTime();
    const onBoundary = new Date(now - 60 * DAY_MS).toISOString();
    const pastBoundary = new Date(now - 61 * DAY_MS).toISOString();

    const rate = buildLiveConversionRate(
      [added("on-boundary", onBoundary), added("past-boundary", pastBoundary)],
      [],
      now,
      60,
    );

    expect(rate.added).toBe(1);
  });

  it("does not count a play from BEFORE the add date, matching convertedWithinWindow's precedent", () => {
    const addedIso = localIso(2026, 5, 10);
    const addMs = new Date(addedIso).getTime();
    const now = addMs + 5 * DAY_MS;
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs - DAY_MS).toISOString() })])];

    const rate = buildLiveConversionRate([added("t", addedIso)], sets, now, 60);

    expect(rate).toMatchObject({ added: 1, played: 0 });
  });

  it("counts a play landing AFTER the window has closed — no upper bound unlike the cohort model", () => {
    // The add itself is still inside the trailing 60-day window as of `now`,
    // but the play happened more than 60 days after the add — the cohort
    // model's convertedWithinWindow would reject this; the live meter must not.
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const now = addMs + 59 * DAY_MS;
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs + 90 * DAY_MS).toISOString() })])];

    const rate = buildLiveConversionRate([added("t", addedIso)], sets, now, 60);

    expect(rate).toMatchObject({ added: 1, played: 1 });
  });

  it("de-dupes a redelivered add-event rather than double-counting", () => {
    const addedIso = localIso(2026, 5, 1);
    const now = new Date(addedIso).getTime() + 1 * DAY_MS;

    const rate = buildLiveConversionRate([added("t", addedIso), added("t", addedIso)], [], now, 60);

    expect(rate.added).toBe(1);
  });

  it("rate is null (never a fabricated 0%) when nothing was added in the window", () => {
    const rate = buildLiveConversionRate([], [], NOW, 60);
    expect(rate).toMatchObject({ added: 0, played: 0, rate: null });
  });

  it("flags low confidence below LOW_CONFIDENCE_COHORT_SIZE, reusing the cohort model's threshold", () => {
    const now = new Date(2026, 5, 1).getTime();
    const events = Array.from({ length: LOW_CONFIDENCE_COHORT_SIZE - 1 }, (_, i) =>
      added(`t${i}`, localIso(2026, 4, 20)),
    );

    const rate = buildLiveConversionRate(events, [], now, 60);

    expect(rate.added).toBe(LOW_CONFIDENCE_COHORT_SIZE - 1);
    expect(rate.lowConfidence).toBe(true);
    expect(isLowConfidenceCohort(rate.added)).toBe(true);
  });

  it("reuses undatedDisclosure for its own copy, with pendingCohortCount forced to 0", () => {
    const now = new Date(2026, 5, 1).getTime();
    const rate = buildLiveConversionRate([added("dated", localIso(2026, 4, 20)), added("undated", null)], [], now, 60);

    expect(undatedDisclosure({ noAddDateCount: rate.noAddDateCount, pendingCohortCount: 0 }, rate.window)).toBe(
      "1 track has no known add date — not counted here.",
    );
  });

  it.each(LIVE_CONVERSION_WINDOWS)("accepts every selectable live window (%i days)", (window) => {
    const addedIso = localIso(2026, 5, 1);
    const now = new Date(addedIso).getTime() + 1 * DAY_MS;
    const rate = buildLiveConversionRate([added("t", addedIso)], [], now, window);
    expect(rate).toMatchObject({ window, added: 1 });
  });
});

describe("live conversion rate summary (AC-2, AC-3)", () => {
  it("names the window and states counts, not just a bare percentage", () => {
    const addedIso = localIso(2026, 5, 1);
    const addMs = new Date(addedIso).getTime();
    const now = addMs + 10 * DAY_MS;
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs + 5 * DAY_MS).toISOString() })])];
    const rate = buildLiveConversionRate([added("t", addedIso), added("u", addedIso)], sets, now, 60);

    expect(liveConversionRateSummary(rate)).toBe(
      "1 of 2 tracks added in the last 60 days have been played in a set (50%).",
    );
  });

  it("says nothing was added, rather than a fabricated 0%, when the denominator is empty", () => {
    const rate = buildLiveConversionRate([], [], NOW, 60);
    expect(liveConversionRateSummary(rate)).toBe("No tracks added in the last 60 days.");
  });

  it("reflects a non-default window in its own copy", () => {
    const addedIso = localIso(2026, 5, 1);
    const now = new Date(addedIso).getTime() + 10 * DAY_MS;
    const rate = buildLiveConversionRate([added("t", addedIso)], [], now, 30);
    expect(liveConversionRateSummary(rate)).toContain("last 30 days");
  });

  it("reflects the 2-weeks window (14 days) in its own copy", () => {
    const addedIso = localIso(2026, 5, 1);
    const now = new Date(addedIso).getTime() + 5 * DAY_MS;
    const rate = buildLiveConversionRate([added("t", addedIso)], [], now, 14);
    expect(liveConversionRateSummary(rate)).toContain("last 14 days");
  });
});
