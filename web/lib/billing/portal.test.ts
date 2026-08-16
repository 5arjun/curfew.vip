import { describe, expect, it } from "vitest";
import { SUBSCRIPTION_ATTACHED } from "./checkout";
import { formatSubscriptionStatus } from "./portal";

// The Manage row's one pure decision (Story 7.4 Task 2.2): presentational
// formatting only, away from Stripe and away from Next.

const EXPECTED: Record<string, string> = {
  active: "Active",
  trialing: "Trialing",
  past_due: "Past due",
  incomplete: "Incomplete",
  paused: "Paused",
};

describe("formatSubscriptionStatus", () => {
  // Driven off the exported constant rather than a retyped copy — adding a
  // sixth attached status should fail here, not pass against a stale list.
  it.each(SUBSCRIPTION_ATTACHED)("formats attached status %s", (status) => {
    expect(formatSubscriptionStatus(status)).toBe(EXPECTED[status]);
  });

  it("covers every SUBSCRIPTION_ATTACHED status", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...SUBSCRIPTION_ATTACHED].sort());
  });

  it("capitalizes only the first character, leaving later words lowercase", () => {
    expect(formatSubscriptionStatus("past_due")).toBe("Past due");
    expect(formatSubscriptionStatus("incomplete_expired")).toBe("Incomplete expired");
  });

  it("handles a single word with no underscore", () => {
    expect(formatSubscriptionStatus("canceled")).toBe("Canceled");
  });

  // The Manage branch is wider than SUBSCRIPTION_ATTACHED: any status Stripe
  // ships after this code reaches this formatter verbatim.
  it("passes an unrecognized future status through, spaced and sentence-cased", () => {
    expect(formatSubscriptionStatus("trial_expired")).toBe("Trial expired");
  });

  it("does not throw on an empty string", () => {
    expect(formatSubscriptionStatus("")).toBe("");
  });
});
