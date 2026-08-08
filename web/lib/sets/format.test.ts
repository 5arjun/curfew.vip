import { describe, expect, it } from "vitest";
import { formatDuration, formatSessionLabel, formatSetDate, formatTrackCount, topGenres } from "./format";

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
  it("produces an uppercase mono-style date, or an em dash", () => {
    expect(formatSetDate(null)).toBe("—");
    expect(formatSetDate("not-a-date")).toBe("—");
    // Structure is timezone-independent: WEEKDAY · D MON YYYY, all uppercase.
    expect(formatSetDate("2026-06-21T21:26:45.000Z")).toMatch(/^[A-Z]{3} · \d{1,2} [A-Z]{3} 2026$/);
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
