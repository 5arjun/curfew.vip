import { describe, expect, it } from "vitest";
import { formatSubscriptionStatus } from "./portal";

// The Manage row's one pure decision (Story 7.4 Task 2.2): presentational
// formatting only, away from Stripe and away from Next.

describe("formatSubscriptionStatus", () => {
  it("formats every SUBSCRIPTION_ATTACHED status", () => {
    expect(formatSubscriptionStatus("active")).toBe("Active");
    expect(formatSubscriptionStatus("trialing")).toBe("Trialing");
    expect(formatSubscriptionStatus("past_due")).toBe("Past due");
    expect(formatSubscriptionStatus("incomplete")).toBe("Incomplete");
    expect(formatSubscriptionStatus("paused")).toBe("Paused");
  });

  it("capitalizes only the first character, not every word", () => {
    expect(formatSubscriptionStatus("past_due")).not.toBe("Past Due");
  });

  it("handles a single word with no underscore", () => {
    expect(formatSubscriptionStatus("canceled")).toBe("Canceled");
  });
});
