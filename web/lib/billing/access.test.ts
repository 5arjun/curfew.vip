import { describe, expect, it } from "vitest";
import { hasWebAccess } from "./access";

// AC-1: which subscription statuses may use the web dashboard. The gate that
// consumes this (the middleware block + its redirect) lives in middleware.ts;
// this predicate is the testable access decision.
describe("hasWebAccess", () => {
  it("allows exactly the two paid-and-current statuses", () => {
    expect(hasWebAccess("active")).toBe(true);
    expect(hasWebAccess("trialing")).toBe(true);
  });

  it("denies the never-subscribed cases", () => {
    expect(hasWebAccess(null)).toBe(false);
    expect(hasWebAccess(undefined)).toBe(false);
    expect(hasWebAccess("")).toBe(false);
  });

  it("denies every other status Stripe currently ships", () => {
    // Deliberately NARROWER than checkout.ts's SUBSCRIPTION_ATTACHED, which
    // counts past_due/incomplete/paused as "a subscription exists, so don't
    // re-offer Checkout". A past_due DJ correctly still sees Manage billing in
    // Settings while correctly losing the dashboard until payment recovers.
    expect(hasWebAccess("past_due")).toBe(false);
    expect(hasWebAccess("canceled")).toBe(false);
    expect(hasWebAccess("unpaid")).toBe(false);
    expect(hasWebAccess("incomplete")).toBe(false);
    expect(hasWebAccess("incomplete_expired")).toBe(false);
    expect(hasWebAccess("paused")).toBe(false);
  });

  it("denies an unrecognized status — a future Stripe value is not access", () => {
    expect(hasWebAccess("some_status_stripe_ships_later")).toBe(false);
    expect(hasWebAccess("ACTIVE")).toBe(false);
    expect(hasWebAccess(" active")).toBe(false);
  });
});
