import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import { billingManageEnabled, offersSubscribeCta } from "@/lib/billing/checkout";
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
  // Environment gate, checked first: whether billing exists here is not a fact
  // about the caller, and keeps all three billing routes self-defending the
  // same way.
  //
  // The MANAGE gate, not the sell gate (Story 7.6 Task 1 — the split 7.4's
  // review deferred). Managing an existing subscription needs a Stripe key and
  // nothing else: no Price ids, because the Portal sells nothing, and no
  // BILLING_LIVE, because a DJ who already paid is past the "may we sell here?"
  // question. Sharing billingEnabled() here meant pausing sales also withdrew a
  // paying DJ's only self-serve cancel, under Settings copy promising "Cancel
  // whenever" — reachable because the webhook, the only writer of
  // stripe_customer_id, is itself ungated. See billingManageEnabled's note.
  if (!billingManageEnabled(process.env)) {
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
  // rendering the button is a display decision, not enforcement. Requires a
  // Stripe Customer to attach the session to, plus a status that doesn't offer
  // Checkout.
  //
  // Note what that second half actually admits: !offersSubscribeCta(s) is
  // WIDER than SUBSCRIPTION_ATTACHED, not equal to it. offersSubscribeCta
  // returns true only for null/undefined/"" and the three terminal statuses,
  // so every unrecognized string — including any status Stripe ships after
  // this code — lands here and gets a Portal session. That is the intended
  // failure direction (it inherits Story 7.2's "silence beats a duplicate
  // subscription" posture: an unknown status means a subscription object
  // probably exists, so managing it is safer than selling another), but it is
  // deliberately not the narrow SUBSCRIPTION_ATTACHED check it resembles.
  if (!dj?.stripe_customer_id || offersSubscribeCta(dj.subscription_status)) {
    return NextResponse.json({ error: "No subscription to manage" }, { status: 404 });
  }

  const origin = (await headers()).get("origin") ?? "http://localhost:3000";

  try {
    // No `configuration` id: a bare session opens the Portal's DEFAULT
    // configuration, which is what AC-1/AC-3 ask for (self-serve manage and
    // cancel, nothing hand-built). The catch: that default does not exist
    // until someone saves the Customer Portal settings once in the Stripe
    // Dashboard, per mode. Until they do, create() throws and the DJ gets an
    // ordinary-looking 502 that retrying never clears. The Portal's cancel and
    // payment-method features live in that Dashboard config, not in this file
    // — see web/README.md's Customer Portal note. Story 7.6 cutover step.
    const session = await getStripe().billingPortal.sessions.create({
      customer: dj.stripe_customer_id,
      return_url: `${origin}/settings`,
    });

    // Unlike Checkout's Session.url (string | null), BillingPortal's
    // Session.url is typed non-nullable — a successful create() always
    // returns a usable URL, verified against the installed SDK.
    return NextResponse.json({ url: session.url });
  } catch (error) {
    // Calm failure, same discipline as the Checkout route: never leak Stripe's
    // own error text to the client. But log it server-side — with Sentry
    // unprovisioned, this is the only trace, and the failures that land here
    // are mostly PERMANENT (missing Portal configuration, a customer id minted
    // in the other Stripe mode, a customer deleted in Stripe) while the client
    // presents all of them as retryable.
    console.error("[billing/portal] Portal session creation failed", error);
    return NextResponse.json({ error: "Billing unavailable" }, { status: 502 });
  }
}
