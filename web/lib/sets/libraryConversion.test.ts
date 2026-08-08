import { describe, expect, it } from "vitest";
import {
  buildLibraryConversion,
  buildLiveConversionRate,
  buildTimeToFirstPlay,
  convertedWithinWindow,
  CONVERSION_WINDOWS,
  DEFAULT_CONVERSION_WINDOW,
  firstPlayAtOrAfter,
  hasEnoughCohorts,
  hasEnoughTimeToFirstPlayDebuts,
  hasEnoughTimeToFirstPlayTracks,
  isCohortComplete,
  isEarlyReadAverage,
  isLowConfidenceCohort,
  libraryConversionSummary,
  liveConversionRateSummary,
  LOW_CONFIDENCE_COHORT_SIZE,
  MIN_TIME_TO_FIRST_PLAY_DEBUTS,
  MIN_TIME_TO_FIRST_PLAY_TRACKS,
  playedCountOf,
  playsByTrack,
  timeToFirstPlaySummary,
  TIME_TO_FIRST_PLAY_EARLY_READ_DEBUTS,
  undatedDisclosure,
  unreconciledDateCount,
  type ConversionWindow,
  type LibraryAddEvent,
  type LibraryConversionModel,
} from "./libraryConversion";

/** The default (60-day) series — what every test below reads unless it is
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

describe("the conversion window (D-8; scale unified with the live meter, Story 4.7 AC-3)", () => {
  const addedMs = new Date(2026, 0, 1).getTime();

  it("counts a play on day 59 and on day 60 (the default window), but not day 61", () => {
    expect(convertedWithinWindow(addedMs, addedMs + 59 * DAY_MS)).toBe(true);
    expect(convertedWithinWindow(addedMs, addedMs + 60 * DAY_MS)).toBe(true);
    expect(convertedWithinWindow(addedMs, addedMs + 61 * DAY_MS)).toBe(false);
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

    expect(firstPlayAtOrAfter(playsByTrack(sets).get("t"), addMs)).toBe(addMs + 300 * DAY_MS);
    expect(at(buildLibraryConversion([added("t", addedIso)], sets, NOW)).cohorts[0].converted).toBe(0);
  });

  it("ignores plays that carry no track_id or no timestamp", () => {
    const sets = [
      set([
        play({ track_id: undefined, started_at: localIso(2026, 1, 2) }),
        play({ track_id: "t", started_at: null }),
      ]),
    ];
    expect(playsByTrack(sets).size).toBe(0);
    expect(at(buildLibraryConversion([added("t", localIso(2026, 1, 1))], sets, NOW)).cohorts[0].converted).toBe(
      0,
    );
  });
});

describe("cohort-recency honesty (D-9)", () => {
  it("measures completeness from the END of the month, not its start", () => {
    // A track added March 31st has not had its 60 days until ~May 30th.
    const marchEndPlus60 = new Date(2026, 2, 31, 23, 59, 59, 999).getTime() + 60 * DAY_MS;
    expect(isCohortComplete("2026-03", marchEndPlus60 - 1, 60)).toBe(false);
    expect(isCohortComplete("2026-03", marchEndPlus60, 60)).toBe(true);
    // The naive "start of month + 60d" reading would have called it complete
    // here, scoring every late-March purchase a failure it never had time to
    // avoid.
    expect(isCohortComplete("2026-03", new Date(2026, 2, 1).getTime() + 60 * DAY_MS, 60)).toBe(false);
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
    expect(disclosureFor(model)).toContain("still inside the 60-day window");
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
      "1 track has no known add date, and 1 recent month is still inside the 60-day window — not counted here.",
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
      "6 of the 10 tracks added in March made it into a set within 60 days (60%) — up from 40% in January.",
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
      "52 of the 100 tracks added in March made it into a set within 60 days (52%) — about the same as January.",
    );
  });

  it("names the single cohort when only one has completed", () => {
    expect(libraryConversionSummary(modelFrom([["2026-01", 8, 2]]), DEFAULT_CONVERSION_WINDOW)).toBe(
      "2 of the 8 tracks added in January made it into a set within 60 days (25%).",
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
    ).toBe("No cohorts have finished their 60-day window yet.");
  });
});

describe("the conversion-window toggle (D-13; scale unified with the live meter, Story 4.7 AC-3)", () => {
  it("precomputes every selectable window in one pass", () => {
    const model = buildLibraryConversion([added("a", localIso(2026, 1, 1))], [], NOW);
    expect(Object.keys(model.windows).map(Number).sort((a, b) => a - b)).toEqual([14, 30, 60]);
    for (const w of CONVERSION_WINDOWS) expect(model.windows[w].window).toBe(w);
  });

  it("defaults to 60 — the shared scale the meter and the trend now agree on (Story 4.7 AC-3)", () => {
    expect(DEFAULT_CONVERSION_WINDOW).toBe(60);
    expect(CONVERSION_WINDOWS[0]).toBe(60);
  });

  it("scores a track differently per window, from the SAME play", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    // Played on day 45: inside 60, outside 30 and 14.
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs + 45 * DAY_MS).toISOString() })])];
    const model = buildLibraryConversion([added("t", addedIso)], sets, NOW);

    expect(model.windows[60].cohorts[0].converted).toBe(1);
    expect(model.windows[30].cohorts[0].converted).toBe(0);
    expect(model.windows[14].cohorts[0].converted).toBe(0);
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
        play({ track_id: "mid", started_at: new Date(addMs + 20 * DAY_MS).toISOString() }),
        play({ track_id: "slow", started_at: new Date(addMs + 45 * DAY_MS).toISOString() }),
      ]),
    ];
    const model = buildLibraryConversion(
      [added("fast", addedIso), added("mid", addedIso), added("slow", addedIso)],
      sets,
      NOW,
    );

    expect(model.windows[60].cohorts[0].rate).toBeCloseTo(1);
    expect(model.windows[30].cohorts[0].rate).toBeCloseTo(2 / 3);
    expect(model.windows[14].cohorts[0].rate).toBeCloseTo(1 / 3);
    expect(model.windows[60].cohorts[0].rate).toBeGreaterThanOrEqual(model.windows[30].cohorts[0].rate);
    expect(model.windows[30].cohorts[0].rate).toBeGreaterThanOrEqual(model.windows[14].cohorts[0].rate);
  });

  it("a shorter window completes MORE cohorts, so the line reaches closer to today", () => {
    const now = new Date(2026, 3, 20).getTime(); // April 20
    const model = buildLibraryConversion(
      [
        added("jan", localIso(2026, 1, 10)),
        added("feb", localIso(2026, 2, 10)),
        added("mar", localIso(2026, 3, 10)),
      ],
      [],
      now,
    );

    // Jan closes 60 days after Jan 31 (~Apr 1); Feb (~Apr 29) and Mar
    // (~May 30) have not.
    expect(model.windows[60].cohorts.map((c) => c.bucket)).toEqual(["2026-01"]);
    // At 14 days, Jan (~Feb 14), Feb (~Mar 14), and Mar (~Apr 14) have all closed.
    expect(model.windows[14].cohorts.map((c) => c.bucket)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(model.windows[14].pendingCohortCount).toBeLessThan(model.windows[60].pendingCohortCount);
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

    expect(libraryConversionSummary(model, 60)).toContain("within 60 days");
    expect(libraryConversionSummary(model, 30)).toContain("within 30 days");
    expect(libraryConversionSummary(model, 14)).toContain("within 14 days");
  });

  it("names the selected window in the pending-cohort disclosure too", () => {
    // May 5 — inside BOTH the 60-day and the 14-day window still measured
    // from April's month-end (~Jun 29 and ~May 14 respectively), so the
    // April cohort is genuinely pending under either selection.
    const now = new Date(2026, 4, 5).getTime();
    const model = buildLibraryConversion([added("a", localIso(2026, 4, 1))], [], now);
    expect(disclosureFor(model, 60)).toContain("60-day window");
    expect(disclosureFor(model, 14)).toContain("14-day window");
  });

  it("gates insufficient-history per window, not globally", () => {
    const now = new Date(2026, 3, 20).getTime(); // April 20
    const model = buildLibraryConversion(
      [added("jan", localIso(2026, 1, 10)), added("feb", localIso(2026, 2, 10))],
      [],
      now,
    );
    // Only Jan has closed at 60 — one cohort is not a trend.
    expect(hasEnoughCohorts(model, 60)).toBe(false);
    // Both have closed at 14.
    expect(hasEnoughCohorts(model, 14)).toBe(true);
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
  it("counts a track added and played inside the window, defaulting to DEFAULT_CONVERSION_WINDOW", () => {
    const addedIso = localIso(2026, 5, 1);
    const addMs = new Date(addedIso).getTime();
    const now = addMs + 10 * DAY_MS;
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs + 5 * DAY_MS).toISOString() })])];

    const rate = buildLiveConversionRate([added("t", addedIso)], sets, now);

    expect(rate).toMatchObject({
      window: DEFAULT_CONVERSION_WINDOW,
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

  it("adds an unreconciled-dates clause without touching the undated one", () => {
    // Findings 1+3: two exclusion classes, ONE clause, and deliberately not
    // folded into "no known add date" — these tracks HAVE a date.
    expect(
      undatedDisclosure({ noAddDateCount: 2, unreconciledDateCount: 3, pendingCohortCount: 0 }, 0),
    ).toBe("2 tracks have no known add date, and 3 tracks have add dates Curfew can't reconcile — not counted here.");
    expect(undatedDisclosure({ noAddDateCount: 0, unreconciledDateCount: 1, pendingCohortCount: 0 }, 0)).toBe(
      "1 track has an add date Curfew can't reconcile — not counted here.",
    );
  });

  it("stays null for callers that never pass an unreconciled count (4.2/4.3 unaffected)", () => {
    expect(undatedDisclosure({ noAddDateCount: 0, pendingCohortCount: 0 }, 60)).toBeNull();
  });

  it.each(CONVERSION_WINDOWS)("accepts every selectable live window (%i days)", (window) => {
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

  it("reflects the 2-weeks window (14 days) as '2 weeks', matching the visible caption", () => {
    // Story 4.3 review: the aria-label (this summary) and the visible caption
    // must say the SAME thing for the 14-day window, or a screen-reader user
    // hears "14 days" while a sighted user reads "2 weeks" — a real drift the
    // review caught. Both now go through `liveWindowPhrase`.
    const addedIso = localIso(2026, 5, 1);
    const now = new Date(addedIso).getTime() + 5 * DAY_MS;
    const rate = buildLiveConversionRate([added("t", addedIso)], [], now, 14);
    expect(liveConversionRateSummary(rate)).toContain("last 2 weeks");
    expect(liveConversionRateSummary(rate)).not.toContain("14 days");
  });
});


describe("time-to-first-play (Story 4.5, AC-1/AC-2/AC-3/AC-5)", () => {
  // A fixed "now" well after every fixture date below, so the clock-skew
  // guard never fires except where a test means it to.
  const NOW = new Date(localIso(2026, 6, 1)).getTime();

  it("computes elapsed time for a track played after its add date", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs + 3 * DAY_MS).toISOString() })])];

    const model = buildTimeToFirstPlay([added("t", addedIso)], sets, NOW);

    expect(model.entries).toEqual([{ trackId: "t", addedMs: addMs, status: "played", elapsedMs: 3 * DAY_MS }]);
    expect(model.averageElapsedMs).toBe(3 * DAY_MS);
    expect(model.neverPlayedCount).toBe(0);
  });

  it("uses the earliest play AT OR AFTER the add date, not the globally earliest play", () => {
    // The regression this test exists for: a track played both before and
    // after its add date has a real, computable debut. Reading the global
    // minimum classified it as never-played and discarded the debut — 18 such
    // tracks on the committed fixture (Story 4.5 review).
    const addedIso = localIso(2026, 1, 10);
    const addMs = new Date(addedIso).getTime();
    const sets = [
      set([
        play({ track_id: "t", started_at: new Date(addMs - 30 * DAY_MS).toISOString() }),
        play({ track_id: "t", started_at: new Date(addMs + 5 * DAY_MS).toISOString() }),
        play({ track_id: "t", started_at: new Date(addMs + 40 * DAY_MS).toISOString() }),
      ]),
    ];

    const model = buildTimeToFirstPlay([added("t", addedIso)], sets, NOW);

    expect(model.entries).toEqual([{ trackId: "t", addedMs: addMs, status: "played", elapsedMs: 5 * DAY_MS }]);
    expect(model.neverPlayedCount).toBe(0);
    expect(model.averageElapsedMs).toBe(5 * DAY_MS);
  });

  it("classifies a track whose ONLY plays predate its add date distinctly, never as never-played", () => {
    const addedIso = localIso(2026, 1, 10);
    const addMs = new Date(addedIso).getTime();
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs - DAY_MS).toISOString() })])];

    const model = buildTimeToFirstPlay([added("t", addedIso)], sets, NOW);

    expect(model.entries).toEqual([{ trackId: "t", addedMs: addMs, status: "played-before-add" }]);
    expect(model.playedBeforeAddCount).toBe(1);
    // AC-3 honesty: saying "hasn't been played yet" about a track the DJ
    // demonstrably played is a false statement, not a conservative one.
    expect(model.neverPlayedCount).toBe(0);
    expect(model.averageElapsedMs).toBeNull();
  });

  it("counts a play exactly AT the add date as an instant debut, not an inconsistency", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const sets = [set([play({ track_id: "t", started_at: new Date(addMs).toISOString() })])];

    const model = buildTimeToFirstPlay([added("t", addedIso)], sets, NOW);

    expect(model.entries).toEqual([{ trackId: "t", addedMs: addMs, status: "played", elapsedMs: 0 }]);
  });

  it("represents a qualifying track never played distinctly, not as zero (AC-3)", () => {
    const addedIso = localIso(2026, 1, 1);
    const model = buildTimeToFirstPlay([added("t", addedIso)], [], NOW);

    expect(model.entries).toEqual([{ trackId: "t", addedMs: new Date(addedIso).getTime(), status: "never-played" }]);
    expect(model.neverPlayedCount).toBe(1);
  });

  it("reports how long the never-played population has been waiting", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();

    const model = buildTimeToFirstPlay([added("t", addedIso)], [], addMs + 10 * DAY_MS);

    expect(model.neverPlayedAverageAgeMs).toBe(10 * DAY_MS);
  });

  it("drops a future-dated add as clock skew, matching buildLiveConversionRate", () => {
    const model = buildTimeToFirstPlay([added("t", localIso(2026, 9, 1))], [], NOW);

    expect(model.entries).toEqual([]);
    expect(model.neverPlayedCount).toBe(0);
    expect(model.noAddDateCount).toBe(0);
  });

  it("excludes an undated track from entries and the median, counting it in noAddDateCount (AC-5)", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const sets = [set([play({ track_id: "dated", started_at: new Date(addMs + DAY_MS).toISOString() })])];

    const model = buildTimeToFirstPlay([added("dated", addedIso), added("undated", null)], sets, NOW);

    expect(model.entries).toHaveLength(1);
    expect(model.noAddDateCount).toBe(1);
  });

  it("averages across an odd number of played tracks", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const sets = [
      set([
        play({ track_id: "a", started_at: new Date(addMs + 1 * DAY_MS).toISOString() }),
        play({ track_id: "b", started_at: new Date(addMs + 5 * DAY_MS).toISOString() }),
        play({ track_id: "c", started_at: new Date(addMs + 9 * DAY_MS).toISOString() }),
      ]),
    ];
    const events = [added("a", addedIso), added("b", addedIso), added("c", addedIso)];

    expect(buildTimeToFirstPlay(events, sets, NOW).averageElapsedMs).toBe(5 * DAY_MS);
  });

  it("averages across an even number of played tracks", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const sets = [
      set([
        play({ track_id: "a", started_at: new Date(addMs + 1 * DAY_MS).toISOString() }),
        play({ track_id: "b", started_at: new Date(addMs + 3 * DAY_MS).toISOString() }),
      ]),
    ];
    const events = [added("a", addedIso), added("b", addedIso)];

    expect(buildTimeToFirstPlay(events, sets, NOW).averageElapsedMs).toBe(2 * DAY_MS);
  });

  it("reports the MEAN, not the median, on a right-skewed distribution", () => {
    // Guards the 2026-08-07 mean-over-median ruling against a silent revert:
    // the two agree on symmetric data (the odd/even cases above pass either
    // way), so only a skewed fixture can tell them apart. Debuts at 1, 1, 1,
    // 1 and 96 days — median 1 day, mean 20.
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const days = [1, 1, 1, 1, 96];
    const events = days.map((_, i) => added(`t${i}`, addedIso));
    const sets = [
      set(
        days.map((d, i) => play({ track_id: `t${i}`, started_at: new Date(addMs + d * DAY_MS).toISOString() })),
      ),
    ];

    const model = buildTimeToFirstPlay(events, sets, NOW);

    expect(model.averageElapsedMs).toBe(20 * DAY_MS);
    expect(timeToFirstPlaySummary(model)).toContain("an average of 3 weeks");
  });

  it("returns a null average with zero qualifying entries", () => {
    expect(buildTimeToFirstPlay([], [], NOW)).toMatchObject({
      entries: [],
      averageElapsedMs: null,
      neverPlayedCount: 0,
      neverPlayedAverageAgeMs: null,
      playedBeforeAddCount: 0,
      futureDatedCount: 0,
      noAddDateCount: 0,
    });
  });

  it("COUNTS a future-dated add rather than dropping it uncounted (finding 3)", () => {
    // The row must reconcile SOMEWHERE. Before this it was in no bucket at
    // all: not entries, not noAddDateCount, not never-played, not
    // played-before-add — it simply ceased to exist.
    const future = new Date(NOW + 10 * DAY_MS).toISOString();
    const model = buildTimeToFirstPlay([added("f", future)], [], NOW);

    expect(model.entries).toEqual([]);
    expect(model.futureDatedCount).toBe(1);
    expect(model.noAddDateCount).toBe(0);
    expect(model.neverPlayedCount).toBe(0);
    expect(model.playedBeforeAddCount).toBe(0);
    expect(unreconciledDateCount(model)).toBe(1);
  });

  it("folds played-before-add and future-dated into ONE unreconciled count", () => {
    const pbaIso = localIso(2026, 1, 10);
    const pbaMs = new Date(pbaIso).getTime();
    const sets = [set([play({ track_id: "pba", started_at: new Date(pbaMs - 5 * DAY_MS).toISOString() })])];
    const model = buildTimeToFirstPlay(
      [added("pba", pbaIso), added("f", new Date(NOW + DAY_MS).toISOString())],
      sets,
      NOW,
    );

    expect(model.playedBeforeAddCount).toBe(1);
    expect(model.futureDatedCount).toBe(1);
    expect(unreconciledDateCount(model)).toBe(2);
  });

  it("de-dupes a redelivered add-event rather than double-counting", () => {
    const addedIso = localIso(2026, 1, 1);
    expect(buildTimeToFirstPlay([added("t", addedIso), added("t", addedIso)], [], NOW).entries).toHaveLength(1);
  });

  it("prefers a DATED redelivery over an undated one, whichever arrives first", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();

    // Undated first — the first shipped version kept it and permanently
    // undated the track (Story 4.5 review).
    const model = buildTimeToFirstPlay([added("t", null), added("t", addedIso)], [], NOW);

    expect(model.noAddDateCount).toBe(0);
    expect(model.entries).toEqual([{ trackId: "t", addedMs: addMs, status: "never-played" }]);
  });

  it("keeps the EARLIEST add date when two dated redeliveries disagree", () => {
    const early = localIso(2026, 1, 1);
    const late = localIso(2026, 3, 1);
    const earlyMs = new Date(early).getTime();
    const sets = [set([play({ track_id: "t", started_at: new Date(earlyMs + 90 * DAY_MS).toISOString() })])];

    // Later-date-wins would understate the elapsed time; matches Story 4.3's
    // earliest-wins ruling at the agent layer.
    const model = buildTimeToFirstPlay([added("t", late), added("t", early)], sets, NOW);

    expect(model.entries).toEqual([{ trackId: "t", addedMs: earlyMs, status: "played", elapsedMs: 90 * DAY_MS }]);
  });

  it("gates the MODULE on total qualifying population (AC-4)", () => {
    const addedIso = localIso(2026, 1, 1);
    const below = Array.from({ length: MIN_TIME_TO_FIRST_PLAY_TRACKS - 1 }, (_, i) => added(`t${i}`, addedIso));
    const at = Array.from({ length: MIN_TIME_TO_FIRST_PLAY_TRACKS }, (_, i) => added(`t${i}`, addedIso));

    expect(hasEnoughTimeToFirstPlayTracks(buildTimeToFirstPlay(below, [], NOW))).toBe(false);
    expect(hasEnoughTimeToFirstPlayTracks(buildTimeToFirstPlay(at, [], NOW))).toBe(true);
  });

  it("gates the AVERAGE separately, on tracks that actually debuted (AC-4)", () => {
    // The regression this test exists for: a large population with a single
    // debut cleared the old single gate and rendered an average from n=1.
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const events = Array.from({ length: 20 }, (_, i) => added(`t${i}`, addedIso));
    const sets = [set([play({ track_id: "t0", started_at: new Date(addMs + 42 * DAY_MS).toISOString() })])];

    const model = buildTimeToFirstPlay(events, sets, NOW);

    expect(hasEnoughTimeToFirstPlayTracks(model)).toBe(true);
    expect(hasEnoughTimeToFirstPlayDebuts(model)).toBe(false);
    expect(playedCountOf(model)).toBe(1);
  });

  it("clears the debut gate at exactly MIN_TIME_TO_FIRST_PLAY_DEBUTS", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const events = Array.from({ length: MIN_TIME_TO_FIRST_PLAY_DEBUTS }, (_, i) => added(`t${i}`, addedIso));
    const sets = [
      set(
        events.map((_, i) =>
          play({ track_id: `t${i}`, started_at: new Date(addMs + (i + 1) * DAY_MS).toISOString() }),
        ),
      ),
    ];

    expect(hasEnoughTimeToFirstPlayDebuts(buildTimeToFirstPlay(events, sets, NOW))).toBe(true);
  });

  it("accepts a precomputed plays index instead of re-deriving it from sets", () => {
    const addedIso = localIso(2026, 1, 1);
    const addMs = new Date(addedIso).getTime();
    const precomputed = new Map([["t", [addMs + 4 * DAY_MS]]]);

    const model = buildTimeToFirstPlay([added("t", addedIso)], [], NOW, precomputed);

    expect(model.entries).toEqual([{ trackId: "t", addedMs: addMs, status: "played", elapsedMs: 4 * DAY_MS }]);
  });
});

describe("playsByTrack", () => {
  it("returns every play per track, ascending, skipping unusable rows", () => {
    const t0 = new Date(localIso(2026, 1, 3)).getTime();
    const t1 = new Date(localIso(2026, 1, 1)).getTime();
    const sets = [
      set([
        play({ track_id: "a", started_at: new Date(t0).toISOString() }),
        play({ track_id: "a", started_at: new Date(t1).toISOString() }),
        play({ track_id: null, started_at: new Date(t0).toISOString() }),
      ]),
    ];

    const index = playsByTrack(sets);

    expect(index.get("a")).toEqual([t1, t0]);
    expect(index.size).toBe(1);
  });
});

describe("firstPlayAtOrAfter", () => {
  it("finds the first play at or after the boundary, and reports none when all precede it", () => {
    const times = [10, 20, 30, 40];

    expect(firstPlayAtOrAfter(times, 25)).toBe(30);
    expect(firstPlayAtOrAfter(times, 30)).toBe(30); // inclusive
    expect(firstPlayAtOrAfter(times, 5)).toBe(10);
    expect(firstPlayAtOrAfter(times, 41)).toBeUndefined();
    expect(firstPlayAtOrAfter([], 1)).toBeUndefined();
    expect(firstPlayAtOrAfter(undefined, 1)).toBeUndefined();
  });
});

// Post-merge integration review. Story 4.5 established that reading a track's
// GLOBAL earliest play answers the wrong question, and rewired its own metric
// to `playsByTrack` — but the two conversion metrics kept reading the global
// minimum, so a track played once before its add and again after was counted
// as never converted. On the committed fixture that put the 2025-07 cohort at
// 36% instead of 51% and 2025-11 at 50% instead of 100%, and made this page
// contradict itself: `buildTimeToFirstPlay` reported the debut while the meter
// beside it called the same track unconverted.
describe("a play BEFORE the add plus a real debut after it (integration review)", () => {
  const NOW = new Date(localIso(2026, 6, 1)).getTime();
  const addedIso = localIso(2026, 1, 10);
  const addMs = new Date(addedIso).getTime();

  /** One track played 5 days BEFORE it was added, then genuinely debuted 3 days after. */
  const sets = [
    set([play({ track_id: "t", started_at: new Date(addMs - 5 * DAY_MS).toISOString() })]),
    set([play({ track_id: "t", started_at: new Date(addMs + 3 * DAY_MS).toISOString() })]),
  ];
  const events = [added("t", addedIso)];

  it("counts as converted in the cohort trend", () => {
    const cohort = at(buildLibraryConversion(events, sets, NOW)).cohorts[0];
    expect(cohort).toMatchObject({ added: 1, converted: 1 });
  });

  it("counts as played in the live rate", () => {
    const live = buildLiveConversionRate(events, sets, addMs + 10 * DAY_MS, 60);
    expect(live).toMatchObject({ added: 1, played: 1, rate: 1 });
  });

  it("agrees with the time-to-first-play module about the same track", () => {
    const ttfp = buildTimeToFirstPlay(events, sets, NOW);
    const live = buildLiveConversionRate(events, sets, addMs + 10 * DAY_MS, 60);

    // The debut Story 4.5 measures and the conversion the meter counts are the
    // same event; neither may see it without the other.
    expect(ttfp.entries[0]).toMatchObject({ status: "played", elapsedMs: 3 * DAY_MS });
    expect(live.played).toBe(1);
  });

  it("still refuses a track played ONLY before it was added", () => {
    const onlyBefore = [set([play({ track_id: "t", started_at: new Date(addMs - 5 * DAY_MS).toISOString() })])];

    expect(at(buildLibraryConversion(events, onlyBefore, NOW)).cohorts[0].converted).toBe(0);
    expect(buildLiveConversionRate(events, onlyBefore, addMs + 10 * DAY_MS, 60).played).toBe(0);
  });
});

describe("time-to-first-play summary (AC-2, AC-3, AC-4)", () => {
  const NOW = new Date(localIso(2026, 6, 1)).getTime();
  const addedIso = localIso(2026, 1, 1);
  const addMs = new Date(addedIso).getTime();

  /** `count` tracks that debuted `days` after being added, plus `unplayed` that never did. */
  function modelWith(count: number, days: number, unplayed = 0) {
    const events = [
      ...Array.from({ length: count }, (_, i) => added(`p${i}`, addedIso)),
      ...Array.from({ length: unplayed }, (_, i) => added(`u${i}`, addedIso)),
    ];
    const sets = [
      set(
        Array.from({ length: count }, (_, i) =>
          play({ track_id: `p${i}`, started_at: new Date(addMs + days * DAY_MS).toISOString() }),
        ),
      ),
    ];
    return buildTimeToFirstPlay(events, sets, NOW);
  }

  it("states the debut count, the average and the never-played count together", () => {
    expect(timeToFirstPlaySummary(modelWith(5, 3, 1))).toBe(
      "5 tracks have debuted, an average of 3 days after being added — 1 other hasn't been played yet. Only 5 debuts so far — early read.",
    );
  });

  it("omits the never-played clause when every qualifying track has debuted", () => {
    expect(timeToFirstPlaySummary(modelWith(5, 3))).toBe(
      "5 tracks have debuted, an average of 3 days after being added. Only 5 debuts so far — early read.",
    );
  });

  it("never interpolates a bare adverbial phrase — a sub-day average reads as a noun phrase", () => {
    // The regression this test exists for: "a median of same day to debut".
    const summary = timeToFirstPlaySummary(modelWith(5, 0));
    expect(summary).toBe("5 tracks have debuted, an average of under a minute after being added. Only 5 debuts so far — early read.");
    expect(summary).not.toContain("same day");
  });

  it("reports the waiting population, never a thin average, below the debut floor", () => {
    const model = modelWith(1, 30, 9);
    expect(hasEnoughTimeToFirstPlayTracks(model)).toBe(true);
    expect(timeToFirstPlaySummary(model)).toBe(
      "9 tracks have been added but not played yet — averaging 5 months on the shelf.",
    );
  });

  it("says nothing has debuted yet when nothing has played at all", () => {
    expect(timeToFirstPlaySummary(buildTimeToFirstPlay([], [], NOW))).toBe("No tracks have debuted yet.");
  });

  it("never claims nothing debuted when the population is tracks the DJ PLAYED (finding 1)", () => {
    // Five tracks whose only plays predate their add date. The population gate
    // passes, so the module renders; the old fallback then asserted "No tracks
    // have debuted yet" about five tracks the DJ demonstrably played.
    const events = Array.from({ length: 5 }, (_, i) => added(`t${i}`, addedIso));
    const sets = [
      set(
        Array.from({ length: 5 }, (_, i) =>
          play({ track_id: `t${i}`, started_at: new Date(addMs - 30 * DAY_MS).toISOString() }),
        ),
      ),
    ];
    const model = buildTimeToFirstPlay(events, sets, NOW);

    expect(hasEnoughTimeToFirstPlayTracks(model)).toBe(true);
    expect(model.neverPlayedCount).toBe(0);
    expect(timeToFirstPlaySummary(model)).toBe(
      "5 tracks have add dates Curfew can't reconcile, so there are no debut times to report yet.",
    );
  });

  it("hedges the average as an early read at or below the measured stability floor", () => {
    const model = modelWith(TIME_TO_FIRST_PLAY_EARLY_READ_DEBUTS, 3);
    expect(isEarlyReadAverage(model)).toBe(true);
    expect(timeToFirstPlaySummary(model)).toContain(
      `Only ${TIME_TO_FIRST_PLAY_EARLY_READ_DEBUTS} debuts so far — early read`,
    );
  });

  it("drops the hedge once the sample clears the floor", () => {
    const model = modelWith(TIME_TO_FIRST_PLAY_EARLY_READ_DEBUTS + 1, 3);
    expect(isEarlyReadAverage(model)).toBe(false);
    expect(timeToFirstPlaySummary(model)).toBe(
      `${TIME_TO_FIRST_PLAY_EARLY_READ_DEBUTS + 1} tracks have debuted, an average of 3 days after being added.`,
    );
  });

  it("keeps the hedge in the SAME string the aria-label reads, not only the component", () => {
    // The one-generator rule: a hedge a sighted user sees and a screen-reader
    // user does not would be this module's third aria/visible drift.
    const summary = timeToFirstPlaySummary(modelWith(5, 3));
    expect(summary).toContain("an average of 3 days");
    expect(summary).toContain("early read");
  });
});
