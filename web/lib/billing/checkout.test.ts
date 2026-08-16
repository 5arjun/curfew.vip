import { describe, expect, it } from "vitest";
import {
  SUBSCRIPTION_ATTACHED,
  billingEnabled,
  offersSubscribeCta,
  parseInterval,
  resolvePriceId,
} from "./checkout";

// The Checkout route's two pure decisions, tested away from Stripe and away
// from Next: which Price id an interval resolves to, and whether the Settings
// Billing slot should offer Checkout at all. Everything else in the route is
// a network call or an auth read (Story 7.2 Task 4.1 — this codebase has no
// Route Handler test harness, and this story deliberately doesn't invent one).

const ENV = {
  STRIPE_PRICE_ID_MONTHLY: "price_monthly_test",
  STRIPE_PRICE_ID_ANNUAL: "price_annual_test",
};

describe("parseInterval", () => {
  it("accepts the two shipped intervals", () => {
    expect(parseInterval("monthly")).toBe("monthly");
    expect(parseInterval("annual")).toBe("annual");
  });

  it("rejects everything else, including near-misses and non-strings", () => {
    for (const bad of [
      "yearly", // the marketing word for `annual` — not the wire value
      "month",
      "MONTHLY", // no case-folding: the client sends a literal, not free text
      "",
      " monthly ",
      null,
      undefined,
      42,
      ["monthly"],
      { interval: "monthly" },
    ]) {
      expect(parseInterval(bad)).toBeNull();
    }
  });
});

describe("resolvePriceId", () => {
  it("maps each interval to its configured Price id", () => {
    expect(resolvePriceId("monthly", ENV)).toBe("price_monthly_test");
    expect(resolvePriceId("annual", ENV)).toBe("price_annual_test");
  });

  it("throws on an unrecognized interval", () => {
    expect(() => resolvePriceId("yearly", ENV)).toThrow(/interval/i);
    expect(() => resolvePriceId(null, ENV)).toThrow(/interval/i);
  });

  it("throws on a missing Price id rather than sending `undefined` to Stripe", () => {
    // A blank env var is the realistic misconfiguration (a `.env` line with
    // no value), so it must fail the same way a wholly absent one does —
    // otherwise Checkout Session creation fails at Stripe with an opaque
    // error instead of here with a nameable one.
    expect(() => resolvePriceId("monthly", { ...ENV, STRIPE_PRICE_ID_MONTHLY: undefined })).toThrow(
      /STRIPE_PRICE_ID_MONTHLY/,
    );
    expect(() => resolvePriceId("annual", { ...ENV, STRIPE_PRICE_ID_ANNUAL: "" })).toThrow(
      /STRIPE_PRICE_ID_ANNUAL/,
    );
  });
});

describe("billingEnabled", () => {
  it("is on in preview and development once Prices are configured", () => {
    expect(billingEnabled({ ...ENV, VERCEL_ENV: "preview" })).toBe(true);
    expect(billingEnabled({ ...ENV, VERCEL_ENV: "development" })).toBe(true);
    expect(billingEnabled({ ...ENV })).toBe(true); // local, no VERCEL_ENV
  });

  it("is off wherever Prices are missing", () => {
    expect(billingEnabled({ STRIPE_PRICE_ID_ANNUAL: "price_a" })).toBe(false);
    expect(billingEnabled({ STRIPE_PRICE_ID_MONTHLY: "price_m" })).toBe(false);
    expect(billingEnabled({})).toBe(false);
  });

  it("stays off in production until BILLING_LIVE is explicitly set", () => {
    // The danger this guards: production already carries SANDBOX Stripe keys
    // from the Vercel Marketplace integration. A Checkout backed by those looks
    // real and charges nothing, so a visitor could believe they subscribed.
    expect(billingEnabled({ ...ENV, VERCEL_ENV: "production" })).toBe(false);
    expect(billingEnabled({ ...ENV, VERCEL_ENV: "production", BILLING_LIVE: "0" })).toBe(false);
    expect(billingEnabled({ ...ENV, VERCEL_ENV: "production", BILLING_LIVE: "true" })).toBe(false);
    expect(billingEnabled({ ...ENV, VERCEL_ENV: "production", BILLING_LIVE: "1" })).toBe(true);
  });

  it("will not let BILLING_LIVE alone paper over missing Prices", () => {
    expect(billingEnabled({ VERCEL_ENV: "production", BILLING_LIVE: "1" })).toBe(false);
  });

  it("also governs the dashboard paywall, not just the Subscribe CTA", () => {
    // Second consumer, added after Story 7.5 shipped: `updateSession()` in
    // lib/supabase/middleware.ts runs its subscription gate only when this
    // returns true. Widening this predicate therefore widens the PAYWALL, not
    // only the CTA — the two are deliberately one decision so a DJ can never
    // be restricted in an environment that has no way to sell them a way out.
    //
    // The production-without-BILLING_LIVE case below is the exact shape that
    // was live on curfew.vip and locked every real account out of /dashboard.
    expect(billingEnabled({ ...ENV, VERCEL_ENV: "production" })).toBe(false);
    expect(billingEnabled({ VERCEL_ENV: "production" })).toBe(false);
  });
});

describe("offersSubscribeCta", () => {
  it("offers Checkout when no subscription has ever existed", () => {
    expect(offersSubscribeCta(null)).toBe(true);
    expect(offersSubscribeCta(undefined)).toBe(true);
  });

  it("offers Checkout again once a subscription is terminally over", () => {
    expect(offersSubscribeCta("canceled")).toBe(true);
    expect(offersSubscribeCta("unpaid")).toBe(true);
    expect(offersSubscribeCta("incomplete_expired")).toBe(true);
  });

  it("stays silent while a subscription is live or still in flight", () => {
    // active/trialing/past_due are AC-6 + Task 3.2's named set. `incomplete`
    // and `paused` are the same shape of fact — a Stripe subscription object
    // is already attached — so offering Checkout would mint a SECOND one.
    expect([...SUBSCRIPTION_ATTACHED].sort()).toEqual([
      "active",
      "incomplete",
      "past_due",
      "paused",
      "trialing",
    ]);
    for (const status of SUBSCRIPTION_ATTACHED) {
      expect(offersSubscribeCta(status)).toBe(false);
    }
  });

  it("stays silent on a status Stripe has not shipped yet", () => {
    // Fail closed: `subscription_status` is a verbatim Stripe passthrough by
    // AD-19, so a status added after this ships must not be read as "no
    // subscription" and pushed into a duplicate Checkout. Silence is the safe
    // wrong answer here; a duplicate subscription is the unsafe one.
    expect(offersSubscribeCta("some_future_stripe_status")).toBe(false);
  });
});
