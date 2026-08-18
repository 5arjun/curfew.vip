import { describe, expect, it } from "vitest";
import {
  formatClock,
  formatDuration,
  formatElapsed,
  formatSessionLabel,
  formatSetDate,
  formatTimeRange,
  formatTrackCount,
  topGenres,
} from "./format";

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(21359)).toBe("5h 56m"); // set 975: 5h 55.98m → 56m
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(3300)).toBe("55m");
    expect(formatDuration(0)).toBe("0m"); // a 1-play soundcheck
  });

  it("carries a 60-minute rounding up into the hour", () => {
    expect(formatDuration(3599)).toBe("1h"); // 59.98m → 60m → 1h 0m
  });

  it("returns an em dash for null", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatTrackCount", () => {
  it("pluralizes", () => {
    expect(formatTrackCount(178)).toBe("178 tracks");
    expect(formatTrackCount(1)).toBe("1 track");
    expect(formatTrackCount(0)).toBe("0 tracks");
  });
});

describe("formatSessionLabel", () => {
  it("prefixes the external id", () => {
    expect(formatSessionLabel("975")).toBe("SET 975");
  });

  // Story 4.6 code review: the cloud read path passes a raw
  // `sessions.session_identity`, not the fixture's bare Serato id.
  it("unwraps a serato4 session identity to the Serato session number", () => {
    expect(formatSessionLabel("serato4:975")).toBe("SET 975");
    expect(formatSessionLabel("serato4:17577")).toBe("SET 17577");
  });

  it("shortens a legacy hash identity rather than printing the whole opaque key", () => {
    expect(formatSessionLabel("legacy:a3f2c1d9e8b74650")).toBe("SET A3F2C1D9");
  });

  it("shortens a bare uuid, so a missing session_label never renders 36 chars", () => {
    expect(formatSessionLabel("872d5614-9894-5803-80f5-aa1dd4177944")).toBe("SET 872D5614");
  });
});

describe("formatSetDate", () => {
  // Story 7.7: the zone is an explicit argument now, so these assert the DJ's
  // date rather than the process's. The suite is TZ-pinned to UTC
  // (`vitest.config.ts:18`), which is exactly why a defaulted zone would make
  // the cross-zone case below unprovable.
  const LA = "America/Los_Angeles";

  it("produces an uppercase mono-style date, or an em dash", () => {
    expect(formatSetDate(null, LA)).toBe("—");
    expect(formatSetDate("not-a-date", LA)).toBe("—");
    // Structure: WEEKDAY · D MON YYYY, all uppercase.
    expect(formatSetDate("2026-06-21T21:26:45.000Z", LA)).toMatch(
      /^[A-Z]{3} · \d{1,2} [A-Z]{3} 2026$/,
    );
  });

  it("dates a late-night gig by the DJ's day, not the server's", () => {
    // 06:00Z on the 21st is 23:00 on the 20th in Los Angeles. The whole story
    // in one assertion: same instant, two days, and the DJ's is the right one.
    const instant = "2026-06-21T06:00:00.000Z";
    expect(formatSetDate(instant, "UTC")).toBe("SUN · 21 JUN 2026");
    expect(formatSetDate(instant, LA)).toBe("SAT · 20 JUN 2026");
  });

  it("keeps the day number and the month name in the same zone", () => {
    // The failure this guards: reading the day off `getDate()` (process zone)
    // while the month name came from a zone-aware formatter would produce
    // "1 JUL" for a set that the same function calls 30 June.
    const instant = "2026-07-01T04:00:00.000Z"; // 21:00 on Jun 30 in LA
    expect(formatSetDate(instant, LA)).toBe("TUE · 30 JUN 2026");
  });
});

describe("formatClock and formatTimeRange (Story 7.7)", () => {
  it("renders the clock the DJ read off the booth", () => {
    // A 10:14 PM Los Angeles set rendered "5:14 AM" server-side before this
    // story — not a time anyone plays a club set at.
    expect(formatClock("2026-06-22T05:14:00.000Z", "America/Los_Angeles")).toBe("10:14 PM");
    expect(formatClock("2026-06-22T05:14:00.000Z", "UTC")).toBe("5:14 AM");
  });

  it("renders both ends of a range in the same zone", () => {
    expect(
      formatTimeRange("2026-06-22T05:14:00.000Z", "2026-06-22T08:52:00.000Z", "America/Los_Angeles"),
    ).toBe("10:14 PM – 1:52 AM");
  });

  it("still degrades to an em dash on missing input", () => {
    expect(formatClock(null, "America/Los_Angeles")).toBe("—");
    expect(formatTimeRange(null, null, "America/Los_Angeles")).toBe("—");
  });
});

describe("formatElapsed", () => {
  const MIN_MS = 60 * 1000;
  const HOUR_MS = 60 * MIN_MS;
  const DAY_MS = 24 * HOUR_MS;

  it("reads as 'under a minute' below a minute", () => {
    expect(formatElapsed(0)).toBe("under a minute");
    expect(formatElapsed(MIN_MS - 1)).toBe("under a minute");
  });

  // Story 4.5 review: the sub-day tiers are the point. Without them 86.5% of
  // real debuts collapsed into one bucket and the module said nothing.
  it("formats minutes below an hour", () => {
    expect(formatElapsed(MIN_MS)).toBe("1 minute");
    expect(formatElapsed(40 * MIN_MS)).toBe("40 minutes");
  });

  it("promotes to hours rather than reading '60 minutes'", () => {
    expect(formatElapsed(59.7 * MIN_MS)).toBe("1 hour");
    expect(formatElapsed(HOUR_MS)).toBe("1 hour");
    expect(formatElapsed(5 * HOUR_MS)).toBe("5 hours");
  });

  it("promotes to days rather than reading '24 hours'", () => {
    expect(formatElapsed(23.7 * HOUR_MS)).toBe("1 day");
    expect(formatElapsed(1 * DAY_MS)).toBe("1 day");
    expect(formatElapsed(3 * DAY_MS)).toBe("3 days");
  });

  it("switches to weeks at 14 days", () => {
    expect(formatElapsed(13 * DAY_MS)).toBe("13 days");
    expect(formatElapsed(13.5 * DAY_MS)).toBe("2 weeks");
    expect(formatElapsed(14 * DAY_MS)).toBe("2 weeks");
    expect(formatElapsed(21 * DAY_MS)).toBe("3 weeks");
  });

  it("switches to months at 60 days", () => {
    expect(formatElapsed(59 * DAY_MS)).toBe("8 weeks");
    expect(formatElapsed(60 * DAY_MS)).toBe("2 months");
    expect(formatElapsed(120 * DAY_MS)).toBe("4 months");
  });

  it("switches to years at 365 days", () => {
    expect(formatElapsed(364 * DAY_MS)).toBe("12 months");
    expect(formatElapsed(365 * DAY_MS)).toBe("1 year");
    expect(formatElapsed(2 * 365 * DAY_MS)).toBe("2 years");
  });

  it("floors negative and NaN input, but maps Infinity to the LARGEST bucket", () => {
    expect(formatElapsed(-5)).toBe("under a minute");
    expect(formatElapsed(NaN)).toBe("under a minute");
    // Story 4.5 review: mapping an unbounded duration to the smallest bucket
    // failed in the most misleading possible direction.
    expect(formatElapsed(Infinity)).toBe("over a year");
  });

  it("always returns a noun phrase, so callers can interpolate it after 'a median of'", () => {
    for (const ms of [0, MIN_MS, HOUR_MS, DAY_MS, 20 * DAY_MS, 100 * DAY_MS, 400 * DAY_MS]) {
      expect(`a median of ${formatElapsed(ms)} after being added`).not.toContain("of same day");
    }
  });
});

describe("topGenres", () => {
  it("ranks by play count desc with a first-seen tie-break, capped at max", () => {
    const breakdown = {
      buckets: [
        { genre: "House", play_count: 3 },
        { genre: "Hip-Hop", play_count: 10 },
        { genre: "Techno", play_count: 3 },
        { genre: "Pop", play_count: 1 },
      ],
      no_genre_count: 5,
    };
    expect(topGenres(breakdown, 3)).toEqual(["Hip-Hop", "House", "Techno"]);
  });

  it("returns an empty list when a set is entirely untagged", () => {
    expect(topGenres({ buckets: [], no_genre_count: 40 })).toEqual([]);
  });
});
