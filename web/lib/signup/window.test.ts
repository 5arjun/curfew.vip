import { afterEach, describe, expect, it, vi } from "vitest";

import { SIGNUP_REPORTABLE_FOR_MS, isFreshSignup } from "./window";

// Pinned so "now" is a fact of the test rather than of the machine — the whole
// predicate is arithmetic against Date.now().
const NOW = Date.parse("2026-08-20T12:00:00.000Z");

function at(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

describe("isFreshSignup", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function freezeClock() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  }

  it("accepts an account created moments ago", () => {
    freezeClock();
    expect(isFreshSignup(at(0))).toBe(true);
    expect(isFreshSignup(at(30_000))).toBe(true);
  });

  it("accepts the slow email confirmation this window exists for", () => {
    freezeClock();
    // Signed up last night, opened the confirmation mail this morning.
    expect(isFreshSignup(at(11 * 60 * 60 * 1000))).toBe(true);
  });

  it("accepts the boundary exactly and rejects one millisecond past it", () => {
    freezeClock();
    expect(isFreshSignup(at(SIGNUP_REPORTABLE_FOR_MS))).toBe(true);
    expect(isFreshSignup(at(SIGNUP_REPORTABLE_FOR_MS + 1))).toBe(false);
  });

  it("rejects a returning DJ — the case both callers must not double-count", () => {
    freezeClock();
    expect(isFreshSignup(at(3 * 24 * 60 * 60 * 1000))).toBe(false);
    expect(isFreshSignup(at(400 * 24 * 60 * 60 * 1000))).toBe(false);
  });

  it("rejects an absent timestamp", () => {
    freezeClock();
    expect(isFreshSignup(undefined)).toBe(false);
    expect(isFreshSignup("")).toBe(false);
  });

  it("rejects an unparseable timestamp rather than throwing", () => {
    freezeClock();
    expect(isFreshSignup("not a date")).toBe(false);
    expect(isFreshSignup("2026-13-45T99:99:99Z")).toBe(false);
  });

  it("rejects a future timestamp — skew is not evidence of newness", () => {
    freezeClock();
    expect(isFreshSignup(at(-60_000))).toBe(false);
  });
});
