import { describe, expect, it } from "vitest";
import { formatDuration, formatElapsed, formatSessionLabel, formatSetDate, formatTrackCount, topGenres } from "./format";

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
});

describe("formatSetDate", () => {
  it("produces an uppercase mono-style date, or an em dash", () => {
    expect(formatSetDate(null)).toBe("—");
    expect(formatSetDate("not-a-date")).toBe("—");
    // Structure is timezone-independent: WEEKDAY · D MON YYYY, all uppercase.
    expect(formatSetDate("2026-06-21T21:26:45.000Z")).toMatch(/^[A-Z]{3} · \d{1,2} [A-Z]{3} 2026$/);
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
