import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
// stubbed for the duration of each test.

const ATTACHED_STATUSES = ["active", "trialing", "past_due", "incomplete", "paused"];
const OVER_STATUSES = ["canceled", "unpaid", "incomplete_expired"];

beforeEach(() => {
  vi.stubEnv("STRIPE_PRICE_ID_MONTHLY", "price_monthly_test");
  vi.stubEnv("STRIPE_PRICE_ID_ANNUAL", "price_annual_test");
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

  it.each(OVER_STATUSES)("renders Subscribe, not Manage, for terminal status %s", (status) => {
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus={status} statusUnknown={false} />,
    );
    expect(html).toContain("Not subscribed");
    expect(html).not.toContain("Manage billing");
  });
});

describe("BillingSection — Manage half", () => {
  it.each(ATTACHED_STATUSES)("renders Manage, not Subscribe, for attached status %s", (status) => {
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus={status} statusUnknown={false} />,
    );
    expect(html).toContain("Manage billing");
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

  it("renders nothing when billing is disabled (no Price env vars)", () => {
    vi.unstubAllEnvs();
    const html = renderToStaticMarkup(
      <BillingSection subscriptionStatus="active" statusUnknown={false} />,
    );
    expect(html).toBe("");
  });
});
