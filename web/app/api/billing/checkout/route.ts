import { headers } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import { billingEnabled, offersSubscribeCta, parseInterval, resolvePriceId } from "@/lib/billing/checkout";
import { createClient } from "@/lib/supabase/server";

// Checkout Session creation (Story 7.2, AD-18). The DJ's card never touches
// this app: this route mints a Stripe-hosted Checkout Session and hands back
// its URL, and the client sends the browser there. No payment UI, no Stripe.js,
// no Elements — `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is deliberately unused by
// this flow.
//
// This route only ever CREATES a session. It writes nothing to `djs` —
// `stripe_customer_id`, `subscription_status` and friends are written solely by
// `apply_subscription_event`, called from Story 7.3's webhook as `service_role`
// (AD-19). Client-facing code never writes billing columns, so the DJ is not
// subscribed when this route returns 200; they're subscribed when Stripe says
// so.

// Pinned to Node, not Edge (AD-18): the Stripe SDK's crypto isn't Edge-safe.
// Story 7.3's webhook needs the same pin for signature verification.
export const runtime = "nodejs";

// Stable Dashboard label for this checkout flow, so sessions started from
// Settings stay distinguishable from any later entry point (a Pricing page,
// Story 6.3). Stable on purpose — a per-request value would make the Dashboard
// comparison it exists for meaningless.
const INTEGRATION_IDENTIFIER = "curfew-settings-subscribe-hqvbnjxt";

export async function POST(request: NextRequest) {
  // Same gate as the Settings CTA, so a hidden button and a live endpoint can
  // never disagree. Checked before auth: whether Checkout exists in this
  // environment is not a fact about the caller.
  if (!billingEnabled(process.env)) {
    return NextResponse.json({ error: "Checkout unavailable" }, { status: 503 });
  }

  // Auth first, and it's the only auth check this route needs: Checkout is
  // unreachable pre-auth by construction (AD-10). 401 rather than a redirect —
  // the caller is a `fetch` from the Settings CTA, and a 302 to /login would
  // arrive as opaque HTML it can't act on.
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Untrusted body. A malformed JSON payload is the same class of answer as a
  // bad interval, so both land on one flat 400.
  const body: unknown = await request.json().catch(() => null);
  const interval = parseInterval(
    typeof body === "object" && body !== null ? (body as Record<string, unknown>).interval : null,
  );
  if (!interval) {
    return NextResponse.json({ error: "Unknown billing interval" }, { status: 400 });
  }

  // Existing Stripe Customer, if Story 7.3's webhook has already recorded one,
  // plus the current subscription status. Reusing the customer keeps one DJ to
  // one Stripe Customer (AC-4); the status re-check below is server-side
  // enforcement of the same rule BillingSection applies client-side. RLS
  // owner-SELECT already scopes this read to the caller; the explicit `.eq` is
  // belt-and-braces on a billing row.
  const { data: dj, error: djError } = await supabase
    .from("djs")
    .select("stripe_customer_id, subscription_status")
    .eq("id", user.id)
    .maybeSingle<{ stripe_customer_id: string | null; subscription_status: string | null }>();

  // A failed read is not a confirmed "no subscription" — same discipline as
  // profile.ts's djsReadFailed. Proceeding here risks minting a duplicate
  // Stripe Customer (AC-4) or a second live subscription for an already-paying
  // DJ, so a read failure is a hard stop, not a silent degrade.
  if (djError) {
    return NextResponse.json({ error: "Checkout unavailable" }, { status: 502 });
  }

  // Server-side mirror of BillingSection's offersSubscribeCta gate: the client
  // hiding the CTA is a display decision, not enforcement. Without this check
  // a stale tab or a replayed request could create a second live subscription
  // for a DJ who's already active/trialing/past_due/incomplete/paused.
  if (!offersSubscribeCta(dj?.subscription_status)) {
    return NextResponse.json({ error: "Already subscribed" }, { status: 409 });
  }

  // Same origin derivation as lib/account/actions.ts: a same-origin POST
  // carries the browser's Origin header, which is the real host.
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: resolvePriceId(interval, process.env), quantity: 1 }],
      // Both linkages, because they survive different things: the session
      // carries `client_reference_id`/`metadata` for `checkout.session.*`
      // events, while `subscription_data.metadata` is what rides onto the
      // Subscription object itself and so is the only one still present on
      // `customer.subscription.updated`/`deleted` — the renewal, dunning and
      // cancellation events Story 7.3 must also attribute to a DJ.
      client_reference_id: user.id,
      metadata: { dj_id: user.id },
      // No `trial_period_days` — Arjun's call, 2026-08-15: no free trial for
      // now. Billing starts at checkout. `subscription_data` stays for the
      // metadata alone (see the note above); if a trial returns later it is a
      // one-line addition here, not a rework.
      subscription_data: {
        metadata: { dj_id: user.id },
      },
      // Reuse or mint — never write the resulting id back from here (AD-19).
      ...(dj?.stripe_customer_id ? { customer: dj.stripe_customer_id } : {}),
      // No `payment_method_types`: omitting it lets Stripe serve whatever
      // methods are enabled in the Dashboard, which is both the recommended
      // integration and strictly better conversion than hardcoding `card`.
      success_url: `${origin}/settings`,
      cancel_url: `${origin}/settings`,
      integration_identifier: INTEGRATION_IDENTIFIER,
    });

    if (!session.url) {
      // Documented as string|null. Without a URL there is nowhere to send the
      // DJ, so this is a failure, not a 200 with an empty body.
      return NextResponse.json({ error: "Checkout unavailable" }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch {
    // Calm failure, same discipline as auth/callback/route.ts: a Stripe
    // outage, a bad key, or an unconfigured Price id all surface as one
    // generic 502. Stripe's own error text can name internal ids and
    // configuration, so it never reaches the client.
    return NextResponse.json({ error: "Checkout unavailable" }, { status: 502 });
  }
}
