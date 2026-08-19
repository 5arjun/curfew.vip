import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import { RELEVANT_EVENT_TYPES, extractBillingFields, resolveSubscriptionId } from "@/lib/billing/webhook";
import { captureServer } from "@/lib/posthog/server";
import { getSupabaseAdmin } from "@/lib/supabase/service";

// The Stripe webhook (Story 7.3, AD-18). This is the ONLY writer of `djs`'s
// billing columns (AD-19) — the Checkout route (Story 7.2) only ever CREATES
// a Session, it never writes `stripe_customer_id`/`subscription_status`/etc.
// A DJ is subscribed when Stripe says so, via this route, never earlier.
//
// This route's only auth check is Stripe's own signature (AC-1) — there is
// no DJ session on a server-to-server Stripe call, so there is deliberately
// no `billingEnabled()` gate here either (see Dev Notes): with no
// `STRIPE_WEBHOOK_SECRET` configured (true in Production until Story 7.6),
// the signature check below fails closed before any event is ever parsed.

// Pinned to Node, not Edge (AD-18): Stripe's signature verification needs
// Node's synchronous crypto. Matches Story 7.2's checkout route pin.
export const runtime = "nodejs";

function resolveWebhookSecret(env: {
  STRIPE_WEBHOOK_SECRET?: string;
  [key: string]: string | undefined;
}): string {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET, see web/README.md#Environment");
  }
  return secret;
}

export async function POST(request: NextRequest) {
  const signature = (await headers()).get("stripe-signature");

  // The raw, unparsed bytes — `constructEvent` verifies the exact signed
  // body; a body that's been JSON-parsed and would-be-reserialized no longer
  // matches the signature (AC-1).
  const rawBody = await request.text();

  let event;
  try {
    if (!signature) {
      throw new Error("Missing stripe-signature header");
    }
    event = getStripe().webhooks.constructEvent(rawBody, signature, resolveWebhookSecret(process.env));
  } catch (err) {
    console.error("billing/webhook: signature verification failed", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // Any event type this endpoint isn't subscribed to (or a type Stripe adds
  // later to an existing subscription list) is a calm no-op, not an error —
  // erroring here would just start a pointless retry storm.
  if (!RELEVANT_EVENT_TYPES.includes(event.type)) {
    return NextResponse.json({ received: true });
  }

  const subscriptionId = resolveSubscriptionId(event);
  if (!subscriptionId) {
    // Defensive — shouldn't happen given Checkout is always subscription-mode
    // (Story 7.2), but a webhook handler must never 500 on a shape it merely
    // didn't expect.
    console.error("billing/webhook: no resolvable subscription id", event.type, event.id);
    return NextResponse.json({ received: true });
  }

  // Re-fetch the canonical Subscription rather than trusting the raw event
  // payload (AC-3), for all four event types uniformly — see Dev Notes on
  // why `checkout.session.completed` also goes through this, not a fast path.
  let subscription;
  try {
    subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  } catch (err) {
    // Transient (network, Stripe outage) — worth a Stripe retry, unlike the
    // calm no-ops above.
    console.error("billing/webhook: failed to re-fetch subscription", subscriptionId, err);
    return NextResponse.json({ error: "Failed to fetch subscription" }, { status: 500 });
  }

  const fields = extractBillingFields(subscription);
  if (!fields.dj_id) {
    // No `metadata.dj_id` on the Subscription — cannot attribute this event
    // to any DJ. Retrying will never populate a value that was never set.
    console.error("billing/webhook: subscription has no dj_id in metadata", subscription.id, event.id);
    return NextResponse.json({ received: true });
  }

  // The event's own timestamp, not the subscription's `created` — what
  // `apply_subscription_event`'s ordering guard expects, and also what makes
  // an exact-duplicate redelivery (AC-3's `event.id` dedupe) a safe no-op.
  const eventCreatedAt = new Date(event.created * 1000).toISOString();

  const { error } = await getSupabaseAdmin().rpc("apply_subscription_event", {
    dj_id: fields.dj_id,
    status: fields.status,
    stripe_customer_id: fields.stripe_customer_id,
    stripe_subscription_id: fields.stripe_subscription_id,
    current_period_end: fields.current_period_end,
    event_created_at: eventCreatedAt,
  });

  if (error) {
    // P0002: `dj_id` matches no `djs` row (e.g. the DJ hard-deleted their
    // account after subscribing) — permanent, not transient. A 200 here is
    // correct because Stripe would otherwise retry a non-2xx response for up
    // to ~3 days on an event that can never succeed.
    if (error.code === "P0002") {
      console.error("billing/webhook: no djs row for dj_id", fields.dj_id, event.id);
      return NextResponse.json({ received: true });
    }
    // Any other RPC error (network, Supabase outage, a genuine bug) — worth
    // a Stripe retry, since it might be transient.
    console.error("billing/webhook: apply_subscription_event failed", error, event.id);
    return NextResponse.json({ error: "Failed to apply subscription event" }, { status: 500 });
  }

  // Zero rows updated (the ordering guard's own no-op) is success too — the
  // RPC raises nothing in that case, so not throwing IS the signal.

  // Report the conversion from HERE rather than from the browser on the
  // /subscribe return: this is the only place that knows Stripe actually
  // charged, and it fires whether or not the DJ's tab survived the redirect.
  // Awaited (not fire-and-forget) because the function may be frozen the
  // instant this handler returns, which would drop the queued event.
  //
  // The `event.id` dedupe key makes a Stripe redelivery idempotent, which
  // matters because the RPC's ordering guard deliberately makes redelivery a
  // no-op rather than an error — so this line genuinely does run more than
  // once for the same underlying change.
  //
  // Never gates the response: captureServer() swallows its own failures, so a
  // PostHog outage cannot turn into a Stripe retry storm.
  await captureServer(
    fields.dj_id,
    "subscription_status_changed",
    { status: fields.status, stripe_event_type: event.type },
    event.id,
  );

  return NextResponse.json({ received: true });
}
