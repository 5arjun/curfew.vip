import type Stripe from "stripe";

// Webhook's pure decisions (Story 7.3), kept out of the Route Handler so
// they're testable without a live Stripe key or a `Request` — same
// factory/pure-helper split as `stripe.ts`/`checkout.ts`. The handler owns
// signature verification, the re-fetch network call, and the RPC write;
// this file owns the two shape-reads that can be wrong in a way a test can
// catch.

/**
 * The four event types this webhook is subscribed to and actually handles
 * (AD-18/AD-19's §3.7 sequence diagrams). Any other `event.type` this
 * endpoint receives is a no-op, not an error — see the route handler.
 */
export const RELEVANT_EVENT_TYPES: readonly Stripe.Event["type"][] = [
  "checkout.session.completed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
];

/**
 * One field read per event type, locating the Subscription to re-fetch —
 * never a value trusted for anything beyond that lookup (AC-3 requires the
 * canonical re-fetch below, not this raw payload field).
 *
 * `invoice.payment_failed` reads `parent.subscription_details.subscription`,
 * not the old top-level `Invoice.subscription` — verified against the
 * installed SDK (`stripe@22.5.0`): Stripe restructured invoices onto a
 * `parent` object and the top-level field no longer exists.
 */
export function resolveSubscriptionId(event: Stripe.Event): string | null {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      return typeof session.subscription === "string"
        ? session.subscription
        : (session.subscription?.id ?? null);
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      return subscription.id ?? null;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscription = invoice.parent?.subscription_details?.subscription;
      return typeof subscription === "string" ? subscription : (subscription?.id ?? null);
    }
    default:
      // Defensive: the route only calls this for RELEVANT_EVENT_TYPES, but a
      // webhook handler must never throw on a shape it merely didn't expect.
      return null;
  }
}

export type BillingFields = {
  /** `null` when the re-fetched Subscription carries no `metadata.dj_id` —
   *  the caller must no-op, not error, since retrying can never populate a
   *  value that was never set. */
  dj_id: string | null;
  status: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  /** ISO string — `apply_subscription_event`'s param is `timestamptz`. */
  current_period_end: string;
};

/**
 * Reads the canonical, re-fetched Subscription (AC-3) into the shape
 * `apply_subscription_event` expects. Always called on the re-fetched
 * object, never the raw event payload — see Dev Notes on why even
 * `checkout.session.completed` goes through this re-fetch.
 */
export function extractBillingFields(subscription: Stripe.Subscription): BillingFields {
  const djId = subscription.metadata?.dj_id;
  // Curfew's Checkout Session always creates exactly one line item (Story
  // 7.2), so `items.data[0]` is unambiguous — do not read the removed
  // top-level `Subscription.current_period_end`.
  const currentPeriodEndSeconds = subscription.items.data[0].current_period_end;

  return {
    dj_id: typeof djId === "string" && djId.trim() !== "" ? djId : null,
    status: subscription.status,
    stripe_customer_id:
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
    stripe_subscription_id: subscription.id,
    current_period_end: new Date(currentPeriodEndSeconds * 1000).toISOString(),
  };
}
