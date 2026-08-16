import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { RELEVANT_EVENT_TYPES, extractBillingFields, resolveSubscriptionId } from "./webhook";

// The webhook's pure helpers (Story 7.3), tested away from Stripe and away
// from Next — same discipline as Story 7.2's `checkout.test.ts`. Everything
// else in the route is a network call, a signature check, or an RPC write
// (this codebase has no Route Handler test harness — Story 7.2 Task 4.1).
//
// Fixtures are plain objects cast to the relevant Stripe type, carrying only
// the fields each helper actually reads — not full, valid Stripe objects.

function fakeEvent(type: string, object: unknown): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event;
}

describe("RELEVANT_EVENT_TYPES", () => {
  it("is exactly the four event types this webhook handles", () => {
    expect([...RELEVANT_EVENT_TYPES].sort()).toEqual(
      [
        "checkout.session.completed",
        "customer.subscription.deleted",
        "customer.subscription.updated",
        "invoice.payment_failed",
      ].sort(),
    );
  });
});

describe("resolveSubscriptionId", () => {
  it("reads `subscription` off a Checkout Session (string id)", () => {
    const event = fakeEvent("checkout.session.completed", { subscription: "sub_123" });
    expect(resolveSubscriptionId(event)).toBe("sub_123");
  });

  it("reads `subscription` off a Checkout Session (expanded object)", () => {
    const event = fakeEvent("checkout.session.completed", { subscription: { id: "sub_123" } });
    expect(resolveSubscriptionId(event)).toBe("sub_123");
  });

  it("reads `id` off a customer.subscription.updated event — the object IS the Subscription", () => {
    const event = fakeEvent("customer.subscription.updated", { id: "sub_456" });
    expect(resolveSubscriptionId(event)).toBe("sub_456");
  });

  it("reads `id` off a customer.subscription.deleted event", () => {
    const event = fakeEvent("customer.subscription.deleted", { id: "sub_789" });
    expect(resolveSubscriptionId(event)).toBe("sub_789");
  });

  it("reads `parent.subscription_details.subscription` off invoice.payment_failed, not the removed top-level `subscription` field", () => {
    const event = fakeEvent("invoice.payment_failed", {
      subscription: "sub_WRONG_top_level_field_no_longer_exists",
      parent: { subscription_details: { subscription: "sub_correct" } },
    });
    expect(resolveSubscriptionId(event)).toBe("sub_correct");
  });

  it("reads the expanded subscription object on invoice.payment_failed", () => {
    const event = fakeEvent("invoice.payment_failed", {
      parent: { subscription_details: { subscription: { id: "sub_correct" } } },
    });
    expect(resolveSubscriptionId(event)).toBe("sub_correct");
  });

  it("returns null when invoice.payment_failed carries no parent.subscription_details", () => {
    const event = fakeEvent("invoice.payment_failed", {});
    expect(resolveSubscriptionId(event)).toBeNull();
  });

  it("returns null for an event type this webhook doesn't handle", () => {
    const event = fakeEvent("charge.succeeded", { id: "ch_123" });
    expect(resolveSubscriptionId(event)).toBeNull();
  });
});

describe("extractBillingFields", () => {
  function fakeSubscription(overrides: Record<string, unknown> = {}): Stripe.Subscription {
    return {
      id: "sub_123",
      status: "active",
      customer: "cus_123",
      metadata: { dj_id: "dj-uuid-1" },
      items: { data: [{ current_period_end: 1_800_000_000 }] },
      ...overrides,
    } as unknown as Stripe.Subscription;
  }

  it("reads dj_id from metadata", () => {
    expect(extractBillingFields(fakeSubscription()).dj_id).toBe("dj-uuid-1");
  });

  it("returns null dj_id when metadata carries none", () => {
    expect(extractBillingFields(fakeSubscription({ metadata: {} })).dj_id).toBeNull();
  });

  it("returns null dj_id for a whitespace-only value, not the whitespace itself", () => {
    expect(extractBillingFields(fakeSubscription({ metadata: { dj_id: "   " } })).dj_id).toBeNull();
  });

  it("reads status verbatim — a thin Stripe passthrough (AD-19), not reinterpreted", () => {
    expect(extractBillingFields(fakeSubscription({ status: "past_due" })).status).toBe("past_due");
  });

  it("reads the customer id from a string customer", () => {
    expect(extractBillingFields(fakeSubscription({ customer: "cus_abc" })).stripe_customer_id).toBe(
      "cus_abc",
    );
  });

  it("reads the customer id from an expanded customer object", () => {
    expect(
      extractBillingFields(fakeSubscription({ customer: { id: "cus_abc" } })).stripe_customer_id,
    ).toBe("cus_abc");
  });

  it("reads the subscription id", () => {
    expect(extractBillingFields(fakeSubscription({ id: "sub_xyz" })).stripe_subscription_id).toBe(
      "sub_xyz",
    );
  });

  it("reads current_period_end from items.data[0], not a top-level field, converting Unix seconds to an ISO string", () => {
    const subscription = fakeSubscription({
      items: { data: [{ current_period_end: 1_800_000_000 }] },
      // A top-level field, if present, must be ignored — it no longer exists
      // on the real SDK type, but a malformed fixture should still prove the
      // code reads the item-level field, not this one.
      current_period_end: 1,
    });
    expect(extractBillingFields(subscription).current_period_end).toBe(
      new Date(1_800_000_000 * 1000).toISOString(),
    );
  });
});
