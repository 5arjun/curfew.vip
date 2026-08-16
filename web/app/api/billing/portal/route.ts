import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import { billingEnabled, offersSubscribeCta } from "@/lib/billing/checkout";
import { createClient } from "@/lib/supabase/server";

// Customer Portal session creation (Story 7.4, AD-18). The sibling of Story
// 7.2's Checkout route: that one creates a subscription, this one hands an
// already-subscribed DJ a Stripe-hosted link to manage or cancel it. No
// subscription-lifecycle UI is hand-built here (AC-3) — the Portal itself is
// the entire surface, this route only mints the session that opens it.
//
// A change/cancel made in the Portal arrives back as the exact same
// `customer.subscription.updated`/`.deleted` events Story 7.3's webhook
// already handles — this route writes nothing to `djs` itself.

// Pinned to Node, matching the other two billing routes (`checkout`,
// `webhook`) — not load-bearing here the way it is for the webhook's raw-body
// signature check, but keeps the three sibling billing routes symmetric.
export const runtime = "nodejs";

export async function POST() {
  // Same gate as the Checkout route, checked first: whether billing exists in
  // this environment is not a fact about the caller. Belt-and-braces here —
  // Checkout itself is billingEnabled()-gated, so no DJ can hold a
  // stripe_customer_id where this would otherwise matter — but keeps all
  // three billing routes self-defending the same way.
  if (!billingEnabled(process.env)) {
    return NextResponse.json({ error: "Billing unavailable" }, { status: 503 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // RLS owner-SELECT scopes this to the caller's own row. Read here rather
  // than trusting anything threaded from the page, same as the Checkout
  // route's own re-read.
  const { data: dj, error: djError } = await supabase
    .from("djs")
    .select("stripe_customer_id, subscription_status")
    .eq("id", user.id)
    .maybeSingle<{ stripe_customer_id: string | null; subscription_status: string | null }>();

  // A failed read is not a confirmed "nothing to manage" — same discipline as
  // the Checkout route's djError handling.
  if (djError) {
    return NextResponse.json({ error: "Billing unavailable" }, { status: 502 });
  }

  // Server-side mirror of BillingSection's Manage-branch gate: the client not
  // rendering the button is a display decision, not enforcement. Requires
  // both a Stripe Customer to attach the session to and a subscription state
  // Story 7.2's own vocabulary considers "attached" (active/trialing/
  // past_due/incomplete/paused) — offersSubscribeCta already encodes that
  // list's inverse, so a status that offers Checkout is never here.
  if (!dj?.stripe_customer_id || offersSubscribeCta(dj.subscription_status)) {
    return NextResponse.json({ error: "No subscription to manage" }, { status: 404 });
  }

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";

  try {
    const session = await getStripe().billingPortal.sessions.create({
      customer: dj.stripe_customer_id,
      return_url: `${origin}/settings`,
    });

    // Unlike Checkout's Session.url (string | null), BillingPortal's
    // Session.url is typed non-nullable — a successful create() always
    // returns a usable URL, verified against the installed SDK.
    return NextResponse.json({ url: session.url });
  } catch {
    // Calm failure, same discipline as the Checkout route: never leak
    // Stripe's own error text to the client.
    return NextResponse.json({ error: "Billing unavailable" }, { status: 502 });
  }
}
