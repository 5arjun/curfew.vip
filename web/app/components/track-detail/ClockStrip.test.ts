import { describe, expect, it } from "vitest";
import { clockSummary } from "./ClockStrip";

/**
 * `clockSummary` is the one string in Story 4.10 that lives entirely outside
 * `lib/sets/*`. It was exported and tested directly here rather than only
 * through a DOM assertion, following the house rule that pure logic gets a
 * direct unit test.
 *
 * The original reason was sharper: `ClockStrip` was a Client Component whose
 * server render only ever produced a pre-hydration placeholder, so
 * `prop-threading.test.tsx` never exercised the bucket math at all. Story 7.7
 * moved the bucketing to the server (each play counted in its own set's zone),
 * so that suite now does reach it — see the zone assertions there. This file
 * still owns the summary string's own edge cases, which is what it was always
 * really for.
 */

function buckets(counts: Partial<Record<number, number>>): number[] {
  const arr = new Array<number>(24).fill(0);
  for (const [hour, count] of Object.entries(counts)) arr[Number(hour)] = count ?? 0;
  return arr;
}

describe("clockSummary", () => {
  it("returns the bare label when every bucket is empty", () => {
    expect(clockSummary(buckets({}), 0)).toBe("Clock");
  });

  it("names the busiest hour and the total, singular", () => {
    expect(clockSummary(buckets({ 21: 1 }), 1)).toBe("Of 1 timed play, 1 landed in the 9pm hour.");
  });

  it("names the busiest hour and the total, plural", () => {
    expect(clockSummary(buckets({ 21: 4, 2: 1 }), 5)).toBe(
      "Of 5 timed plays, 4 landed in the 9pm hour.",
    );
  });

  it("breaks a tie toward the earlier hour of the night (NIGHT_START order)", () => {
    // 11pm and 1am tie; 11pm comes first in the 6pm→6pm night.
    expect(clockSummary(buckets({ 23: 2, 1: 2 }), 4)).toContain("11pm hour");
  });

  it("uses no ranking vocabulary (DESIGN.md:199, Non-negotiable 6)", () => {
    const s = clockSummary(buckets({ 21: 4, 2: 1 }), 5).toLowerCase();
    expect(s).not.toMatch(/\b(best|winner|top|rank|ranked|#\d|more than any other)\b/);
    expect(s).not.toContain("more than any other");
  });
});
