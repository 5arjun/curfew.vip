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
  // The Manage half's own gate since Story 7.6's split — stubbed explicitly for
  // the same reason the Price ids are: leaving it ambient would make the Manage
  // tests pass or fail on whether the runner happened to export a Stripe key.
  vi.stubEnv("STRIPE_RESTRICTED_KEY", "rk_test_stub");
  vi.stubEnv("STRIPE_SECRET_KEY", "");
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
  it("renders no Subscribe half when billing is disabled (no Price env vars)", () => {
    vi.stubEnv("STRIPE_PRICE_ID_MONTHLY", undefined);
    vi.stubEnv("STRIPE_PRICE_ID_ANNUAL", undefined);
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus={null} statusUnknown={false} />,
    );
    expect(html).toBe("");
  });

  it("renders no Subscribe half in production until BILLING_LIVE is 1", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus={null} statusUnknown={false} />,
    );
    expect(html).toBe("");
  });
});

// The regression Story 7.6 Task 1 closes. Before the split, ONE gate covered
// both halves, so a production environment with sales paused — or simply not
// yet configured — rendered nothing for a DJ who was already paying, leaving
// them no self-serve cancel under copy that promises "Cancel whenever."
// Reachable in practice because the webhook, the only writer of
// stripe_customer_id, is deliberately ungated.
describe("BillingSection — the sell gate no longer strands a subscriber", () => {
  const productionSalesOff = () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("BILLING_LIVE", "");
    vi.stubEnv("STRIPE_PRICE_ID_MONTHLY", undefined);
    vi.stubEnv("STRIPE_PRICE_ID_ANNUAL", undefined);
  };

  it.each(SUBSCRIPTION_ATTACHED)(
    "still renders Manage for %s in production with sales off",
    (status) => {
      productionSalesOff();
      const html = renderToStaticMarkup(
        <BillingSection subscriptionStatus={status} statusUnknown={false} />,
      );
      expect(html).toContain("Manage billing");
      expect(html).not.toContain("Not subscribed");
    },
  );

  it("renders nothing for a non-subscriber in that same environment", () => {
    productionSalesOff();
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus={null} statusUnknown={false} />,
    );
    expect(html).toBe("");
  });

  it("renders nothing at all when no Stripe key is configured either", () => {
    // The manage gate's own floor: without a key the Portal call cannot
    // succeed, so offering the button would only produce a 502.
    productionSalesOff();
    vi.stubEnv("STRIPE_RESTRICTED_KEY", undefined);
    vi.stubEnv("STRIPE_SECRET_KEY", undefined);
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus="active" statusUnknown={false} />,
    );
    expect(html).toBe("");
  });
});
