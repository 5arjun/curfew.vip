import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUBSCRIPTION_ATTACHED } from "@/lib/billing/checkout";
import { BillingSection } from "./BillingSection";

// RENDER ASSERTIONS for BillingSection's two halves (Story 7.2 AC-6, Story
// 7.4 AC-1/AC-3). No jsdom needed — BillingSection, SubscribeActions, and
// ManageBillingActions all use only `useState`, no hook reads
// `window.matchMedia` during initial render (see floor-disclosure.test.tsx's
// documented lesson: confirm this rather than assume any client component is
// SSR-unsafe).
//
// BillingSection calls billingEnabled(process.env) directly — there is no
// injectable env prop — so exercising the enabled path needs real env vars
// stubbed for the duration of each test. VERCEL_ENV/BILLING_LIVE are stubbed
// too: billingEnabled short-circuits on a production-like env, so leaving
// them ambient would make these tests pass or fail on where they ran.

const OVER_STATUSES = ["canceled", "unpaid", "incomplete_expired"];

beforeEach(() => {
  vi.stubEnv("STRIPE_PRICE_ID_MONTHLY", "price_monthly_test");
  vi.stubEnv("STRIPE_PRICE_ID_ANNUAL", "price_annual_test");
  vi.stubEnv("VERCEL_ENV", "development");
  vi.stubEnv("BILLING_LIVE", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("BillingSection — Subscribe half", () => {
  it("renders Subscribe, not Manage, when the DJ never subscribed", () => {
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus={null} statusUnknown={false} />,
    );
    expect(html).toContain("Not subscribed");
    expect(html).not.toContain("Manage billing");
  });

  it("renders Subscribe, not Manage, for an empty-string status", () => {
    const html = renderToStaticMarkup(<BillingSection subscriptionStatus="" statusUnknown={false} />);
    expect(html).toContain("Not subscribed");
    expect(html).not.toContain("Manage billing");
  });

  it.each(OVER_STATUSES)("renders Subscribe, not Manage, for terminal status %s", (status) => {
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus={status} statusUnknown={false} />,
    );
    expect(html).toContain("Not subscribed");
    expect(html).not.toContain("Manage billing");
  });
});

describe("BillingSection — Manage half", () => {
  // Driven off the exported constant, not a retyped copy of it.
  it.each(SUBSCRIPTION_ATTACHED)(
    "renders Manage, not Subscribe, for attached status %s",
    (status) => {
      const html = renderToStaticMarkup(
        <BillingSection subscriptionStatus={status} statusUnknown={false} />,
      );
      expect(html).toContain("Manage billing");
      expect(html).not.toContain("Not subscribed");
    },
  );

  // The branch this story newly opened: offersSubscribeCta's else is wider
  // than SUBSCRIPTION_ATTACHED, so a status Stripe ships later renders Manage
  // with its own value formatted as the plan. Pinned deliberately — if this
  // ever becomes the wrong call, the test should be what argues about it.
  it("renders Manage for an unrecognized future status, showing it formatted", () => {
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus="trial_expired" statusUnknown={false} />,
    );
    expect(html).toContain("Manage billing");
    expect(html).toContain("Trial expired");
    expect(html).not.toContain("Not subscribed");
  });
});

describe("BillingSection — existing guards still hold", () => {
  it("renders nothing when the djs read failed (statusUnknown)", () => {
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus="active" statusUnknown={true} />,
    );
    expect(html).toBe("");
  });

  // Stubbed to undefined rather than calling vi.unstubAllEnvs(): unstubbing
  // restores the ambient environment, so a developer or CI step exporting the
  // Price ids would silently turn this into a false pass.
  it("renders nothing when billing is disabled (no Price env vars)", () => {
    vi.stubEnv("STRIPE_PRICE_ID_MONTHLY", undefined);
    vi.stubEnv("STRIPE_PRICE_ID_ANNUAL", undefined);
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus="active" statusUnknown={false} />,
    );
    expect(html).toBe("");
  });

  it("renders nothing in production until BILLING_LIVE is 1", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus="active" statusUnknown={false} />,
    );
    expect(html).toBe("");
  });
});
