// Story 7.7. Zone-explicit by construction (AC-7).
//
// **Read this before adding a test here.** `web/vitest.config.ts:18` pins
// `TZ: "UTC"` for the whole suite, and that pin overrides the shell — verified
// at story time, `TZ=Pacific/Kiritimati npx vitest run styleEvolution.test.ts`
// still reported 103 passed, while the same suite through a config with the pin
// removed produced 4 real failures. The pin was added deliberately, it makes
// the run reproducible, and it stays.
//
// The consequence for this file: a test that sets or reads `process.env.TZ` is
// either a no-op under the pin, or a landmine for whoever removes it. Every
// test below passes the zone in as an argument instead. That is also the only
// way to prove the thing this story is actually about — that the answer depends
// on the DJ's zone and not on the process's.
//
// A test at midday UTC proves nothing here. The three cases that do:
//   - local midnight — one instant, two different civil days
//   - a month boundary — the NYE case, the one measured in production
//   - a DST transition — the reason Decision 1 chose a zone name over an offset
import { describe, expect, it } from "vitest";

import {
  civilInZone,
  civilMonthEndMs,
  civilMonthStartMs,
  countZoneFallbacks,
  FALLBACK_ZONE,
  localDayKey,
  localHour,
  localMonthKey,
  localWeekKey,
  parseMonthKey,
  resolveSetZone,
  zoneOffsetMs,
} from "./civilTime";
import type { SetRecord } from "./types";

const LA = "America/Los_Angeles";
const NY = "America/New_York";

describe("civilInZone", () => {
  it("reads one instant as two different civil days depending on the zone", () => {
    // 2026-06-21T05:30:00Z — already Sunday in UTC, still Saturday evening in LA.
    const ms = Date.parse("2026-06-21T05:30:00Z");

    expect(civilInZone(ms, "UTC")).toEqual({
      year: 2026,
      month: 6,
      day: 21,
      hour: 5,
      minute: 30,
    });
    expect(civilInZone(ms, LA)).toEqual({
      year: 2026,
      month: 6,
      day: 20,
      hour: 22,
      minute: 30,
    });
  });

  it("returns midnight as hour 0, never 24 (hourCycle h23)", () => {
    // 07:00Z on 2026-06-21 is exactly midnight in LA (UTC-7 in June).
    expect(civilInZone(Date.parse("2026-06-21T07:00:00Z"), LA)).toEqual({
      year: 2026,
      month: 6,
      day: 21,
      hour: 0,
      minute: 0,
    });
  });

  it("degrades an unknown zone to UTC rather than throwing", () => {
    // The zone crossed a wire from a machine we do not control. A corrupt value
    // must render a dashboard, not a 500.
    const ms = Date.parse("2026-06-21T05:30:00Z");
    expect(() => civilInZone(ms, "Mars/Olympus_Mons")).not.toThrow();
    expect(civilInZone(ms, "Mars/Olympus_Mons")).toEqual(civilInZone(ms, "UTC"));
  });

  it("returns null for a non-finite instant", () => {
    expect(civilInZone(Number.NaN, LA)).toBeNull();
  });
});

describe("localDayKey", () => {
  it("files a late-night gig under the night the DJ played it (local midnight)", () => {
    // 23:00 local on the 20th in LA = 06:00Z on the 21st. UTC says the 21st;
    // the DJ says they played Saturday the 20th, and the DJ is right.
    const ms = "2026-06-21T06:00:00.000Z";
    expect(localDayKey(ms, "UTC")).toBe("2026-06-21");
    expect(localDayKey(ms, LA)).toBe("2026-06-20");
  });

  it("returns the empty key for missing and unparsable input", () => {
    expect(localDayKey(null, LA)).toBe("");
    expect(localDayKey(undefined, LA)).toBe("");
    expect(localDayKey("not a date", LA)).toBe("");
  });
});

describe("localMonthKey", () => {
  it("keeps an 11pm New Year's Eve set in December — the production case", () => {
    // The exact failure measured on prod at story time: a 23:00-local NYE gig
    // filed under January 2026 for a DJ who played it in December 2025.
    const nye = "2026-01-01T04:00:00.000Z"; // 23:00 on 2025-12-31 in NY
    expect(localMonthKey(nye, "UTC")).toBe("2026-01");
    expect(localMonthKey(nye, NY)).toBe("2025-12");
    expect(localDayKey(nye, NY)).toBe("2025-12-31");
  });
});

describe("localWeekKey", () => {
  it("puts a Sunday-in-UTC / Saturday-in-LA gig in the correct week", () => {
    // 2026-06-21 is a Sunday; 2026-06-20 is a Saturday. Their Mondays differ:
    // Sunday the 21st belongs to the week starting Monday the 15th, and
    // Saturday the 20th does too — so pick an instant where they diverge.
    // 2026-06-22T05:00:00Z is Monday in UTC, still Sunday 22:00 in LA.
    const ms = "2026-06-22T05:00:00.000Z";
    expect(localWeekKey(ms, "UTC")).toBe("2026-06-22"); // Monday's own week
    expect(localWeekKey(ms, LA)).toBe("2026-06-15"); // still the previous week
  });

  it("returns the Monday itself for a Monday", () => {
    expect(localWeekKey("2026-06-15T12:00:00.000Z", "UTC")).toBe("2026-06-15");
  });

  it("returns the preceding Monday for a Sunday", () => {
    expect(localWeekKey("2026-06-21T12:00:00.000Z", "UTC")).toBe("2026-06-15");
  });

  it("crosses a month boundary backwards without leaving the year", () => {
    // Wednesday 2026-07-01 belongs to the week starting Monday 2026-06-29.
    expect(localWeekKey("2026-07-01T12:00:00.000Z", "UTC")).toBe("2026-06-29");
  });
});

describe("DST transitions", () => {
  // This is the reason Decision 1 chose an IANA zone name over a fixed UTC
  // offset. A stored `-07:00` would be silently wrong for half the year, and
  // wrong in a way no test at a single instant would catch.
  it("resolves the same zone to different offsets in summer and winter", () => {
    const summer = Date.parse("2026-07-01T12:00:00Z");
    const winter = Date.parse("2026-01-01T12:00:00Z");
    expect(zoneOffsetMs(summer, LA)).toBe(-7 * 3600_000); // PDT
    expect(zoneOffsetMs(winter, LA)).toBe(-8 * 3600_000); // PST
  });

  it("buckets correctly on the spring-forward night", () => {
    // 2026-03-08, US DST starts: 02:00 local jumps to 03:00. A set running
    // across it must still be one night.
    const before = "2026-03-08T09:30:00.000Z"; // 01:30 PST
    const after = "2026-03-08T10:30:00.000Z"; // 03:30 PDT
    expect(localDayKey(before, LA)).toBe("2026-03-08");
    expect(localDayKey(after, LA)).toBe("2026-03-08");
    expect(localHour(before, LA)).toBe(1);
    expect(localHour(after, LA)).toBe(3); // 02:00 never happened
  });

  it("buckets correctly on the fall-back night, when one local hour repeats", () => {
    // 2026-11-01, US DST ends: 02:00 local repeats. Both 01:30s are the same
    // civil day, which is all the bucketing needs to agree on.
    const first = "2026-11-01T08:30:00.000Z"; // 01:30 PDT
    const second = "2026-11-01T09:30:00.000Z"; // 01:30 PST, an hour later
    expect(localDayKey(first, LA)).toBe("2026-11-01");
    expect(localDayKey(second, LA)).toBe("2026-11-01");
    expect(localHour(first, LA)).toBe(1);
    expect(localHour(second, LA)).toBe(1);
  });

  it("puts a set played the evening before spring-forward on the previous day", () => {
    const ms = "2026-03-08T06:00:00.000Z"; // 22:00 PST on the 7th
    expect(localDayKey(ms, "UTC")).toBe("2026-03-08");
    expect(localDayKey(ms, LA)).toBe("2026-03-07");
  });
});

describe("civil month bounds", () => {
  it("starts a month at local midnight, not UTC midnight", () => {
    // June 2026 in LA begins at 07:00Z on the 1st (UTC-7).
    expect(civilMonthStartMs(2026, 6, LA)).toBe(Date.parse("2026-06-01T07:00:00Z"));
    expect(civilMonthStartMs(2026, 6, "UTC")).toBe(Date.parse("2026-06-01T00:00:00Z"));
  });

  it("ends a month one ms before the next one starts", () => {
    expect(civilMonthEndMs(2026, 6, LA)).toBe(civilMonthStartMs(2026, 7, LA) - 1);
  });

  it("rolls December over to the following January", () => {
    expect(civilMonthEndMs(2026, 12, NY)).toBe(civilMonthStartMs(2027, 1, NY) - 1);
  });

  it("gets a month boundary right across a DST change", () => {
    // November 2026 in LA starts in PDT (UTC-7) and ends in PST (UTC-8), so the
    // month is 24 hours + 1 hour long. The naive `Date.UTC` difference misses
    // this by exactly the DST hour.
    const start = civilMonthStartMs(2026, 11, LA);
    const end = civilMonthEndMs(2026, 11, LA);
    expect(start).toBe(Date.parse("2026-11-01T07:00:00Z")); // still PDT
    expect(end).toBe(Date.parse("2026-12-01T08:00:00Z") - 1); // now PST
  });

  it("round-trips a month key", () => {
    expect(parseMonthKey("2026-06")).toEqual({ year: 2026, month: 6 });
    expect(parseMonthKey("2026-13")).toBeNull();
    expect(parseMonthKey("nope")).toBeNull();
  });
});

describe("resolveSetZone", () => {
  it("prefers the set's own captured zone", () => {
    expect(resolveSetZone(LA, NY)).toEqual({ zone: LA, source: "set" });
  });

  it("falls back to the DJ's zone when the set has none", () => {
    // An old agent, or any set captured before this story.
    expect(resolveSetZone(null, NY)).toEqual({ zone: NY, source: "dj" });
    expect(resolveSetZone(undefined, NY)).toEqual({ zone: NY, source: "dj" });
  });

  it("falls back to UTC when neither is known — never throws, never gates", () => {
    // AD-3 makes a zone-less payload valid forever, not a migration state.
    // AD-19 forbids gating in this direction. So: an answer, and a disclosure.
    expect(resolveSetZone(null, null)).toEqual({ zone: FALLBACK_ZONE, source: "fallback" });
  });

  it("treats an empty string as absent rather than as a zone", () => {
    expect(resolveSetZone("", NY).source).toBe("dj");
    expect(resolveSetZone("", "").source).toBe("fallback");
  });
});

describe("countZoneFallbacks", () => {
  const setWith = (timezone: string | null): SetRecord =>
    ({ derived: { timezone } }) as unknown as SetRecord;

  it("counts every set not bucketed on its own captured zone", () => {
    const sets = [setWith(LA), setWith(null), setWith(null), setWith(NY)];
    expect(countZoneFallbacks(sets, NY)).toBe(2);
  });

  it("counts a set as disclosed even when the DJ zone covers it", () => {
    // The disclosure is "we guessed", not "we had nothing at all" — a DJ-level
    // zone is still a guess about where that particular gig happened.
    expect(countZoneFallbacks([setWith(null)], NY)).toBe(1);
  });

  it("is zero when every set carries its own zone", () => {
    expect(countZoneFallbacks([setWith(LA), setWith(NY)], null)).toBe(0);
  });
});
