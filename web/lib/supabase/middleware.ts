import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PHONE_ON_FILE_COOKIE, isPhoneGatedPath, phoneOnFile } from "./phone-gate";
import { isSubscriptionGatedPath, readBillingGate } from "./subscription-gate";
import { hasWebAccess } from "@/lib/billing/access";
import { billingEnabled } from "@/lib/billing/checkout";
import { everSubscribed } from "@/lib/onboarding/corridor";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  // proxy.ts's matcher covers nearly every route in the app, so missing env
  // vars (fresh clone, no web/.env.local yet) or a Supabase-side hiccup must
  // not crash every page — fall through unauthenticated/unrefreshed instead.
  if (!supabaseUrl || !supabaseKey) {
    return supabaseResponse;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      auth: { experimental: { passkey: true } },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims() verifies the JWT signature locally (no network round-trip)
  // and is Supabase's current recommendation for this refresh step, replacing
  // the older getUser()/getSession() calls (verified against live docs, 2026-07-26).
  // Caught rather than left to propagate: this runs on nearly every route via
  // proxy.ts's matcher, so a transient failure here must not take down the
  // whole app — the request falls through unrefreshed and retries next time.
  try {
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;

    // ─── Gate order: billing, THEN phone (Arjun's ruling, 2026-08-16) ─────
    //
    // This is the reverse of the order these two ran in from Story 7.5 until
    // today, and the swap is the ruling, not a refactor. The old order encoded
    // a product fact that has now changed — the comment below used to read "a
    // phone-less DJ should land on /phone-required before ever learning about
    // billing... billing is a Settings-initiated action, never a forced
    // onboarding step." Billing IS a forced onboarding step now, and it is the
    // FIRST one: sign in, pay, then the phone number, then the agent. The
    // corridor's order lives in lib/onboarding/corridor.ts; this file just has
    // to agree with it, because a DJ who deep-links to /dashboard meets these
    // gates instead of those pages, and the two must not send them to
    // different screens.

    // Subscription access gate (Story 7.5, AD-19).
    //
    // Three properties carried over unchanged from when this ran second, all
    // still load-bearing:
    //
    // 1. **No cookie cache — this reads on every request to a gated path.**
    //    Not an oversight, and PHONE_ON_FILE_COOKIE must not be copied here.
    //    `phoneOnFile` only ever moves missing -> present within a DJ's
    //    lifetime, so caching "present" for a session is sound.
    //    `subscription_status` is bidirectionally mutable WHILE a session is
    //    open: a webhook (Story 7.3) can flip active -> past_due for dunning,
    //    or canceled -> active the moment a DJ resubscribes through the
    //    Portal. AC-4 requires reactivation to restore the dashboard
    //    immediately; a cached "no access" surviving until the browser closes
    //    would lock out a DJ who has already paid again. This is also why
    //    CHECKOUT_PENDING_COOKIE is deliberately NOT consulted here — the
    //    corridor's pages honor that marker, but the paywall answers to the
    //    database alone, so no cookie can open a dashboard.
    // 2. **Fails closed.** A read error denies. The phone gate fails open for
    //    the request; a paywall must not.
    // 3. **Its own read**, never folded into the phone gate's `djs` query.
    //
    // Unchanged and load-bearing (AD-19): the scope is a narrow prefix
    // allow-list checked inside this block — never a widened proxy.ts matcher
    // and never an `/api/:path*` pattern. That is precisely how a paywall
    // written for the dashboard could net the AD-4 set-sync endpoint by
    // accident. The agent is never gated by subscription_status.
    //
    // The paywall exists exactly where Checkout exists. An environment that
    // cannot sell a subscription must not restrict access for the lack of one
    // — otherwise a DJ is sent away from the dashboard and finds nothing to
    // buy at the other end. That closed loop was live on curfew.vip once
    // (production carried no Price ids and no BILLING_LIVE, so every real
    // account was gated out with no way to pay); binding both to one predicate
    // means the paywall switches on in the same deploy that makes Checkout
    // appear.
    //
    // Spelled-out properties, not `process.env` passed whole.
    //
    // The original reason was that proxy.ts runs on Edge, where Next inlines
    // `process.env.FOO` literals at build time, so dynamic indexing inside
    // billingEnabled would read undefined and silently disable the gate. That
    // premise expired with Next 16: proxy.ts now compiles to the NODE runtime
    // (verified 2026-08-18 — built with marker env values and none were
    // inlined; these reads survive as dynamic `process.env` lookups in
    // `.next/server/chunks/`, and `middleware.js` ships CommonJS `require()`
    // plus a `.nft.json` file trace, neither of which an Edge bundle has).
    // Values now arrive from Vercel's runtime injection at request time.
    //
    // Kept spelled out anyway: it costs nothing, it survives a future move
    // back to Edge, and it keeps the read sites greppable. What changed is the
    // justification, not the code — so don't "simplify" this to a whole
    // `process.env` pass on the assumption that the old hazard is gone for
    // good.
    const sellsSubscriptions = billingEnabled({
      STRIPE_PRICE_ID_MONTHLY: process.env.STRIPE_PRICE_ID_MONTHLY,
      STRIPE_PRICE_ID_ANNUAL: process.env.STRIPE_PRICE_ID_ANNUAL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      BILLING_LIVE: process.env.BILLING_LIVE,
    });

    if (sellsSubscriptions && userId && isSubscriptionGatedPath(request.nextUrl.pathname)) {
      const billing = await readBillingGate(supabase, userId);
      if (!hasWebAccess(billing.status)) {
        // Two destinations, because "no access" covers two different people.
        // A DJ who has never subscribed is mid-signup and belongs on the
        // corridor step that sells (/subscribe). A DJ who subscribed before
        // belongs on /subscription-required, whose copy — "Your archive is
        // intact... nothing was lost... Reactivate" — is written for exactly
        // them and reads as nonsense to someone who signed up minutes ago.
        // A FAILED read takes the /subscription-required branch too: it does
        // not sell, so an unknown status can never pitch a second
        // subscription to someone already paying for one.
        const url = request.nextUrl.clone();
        url.pathname =
          billing.readFailed ||
          everSubscribed({
            subscriptionStatus: billing.status,
            stripeCustomerId: billing.stripeCustomerId,
          })
            ? "/subscription-required"
            : "/subscribe";
        url.search = "";
        // Carry any refreshed auth cookies over — dropping them would force
        // a second refresh on the very next request.
        const redirectResponse = NextResponse.redirect(url);
        supabaseResponse.cookies
          .getAll()
          .forEach((cookie) => redirectResponse.cookies.set(cookie));
        return redirectResponse;
      }
    }

    // Phone-on-file gate (Story 3.10, AC-19 / D-9): the third, lazy
    // enforcement layer behind auth/confirm and auth/callback's doorway
    // checks — it catches the bypass paths (plain signIn, passkey,
    // abandon-/phone-required-and-return). Cookie-marked so the cost is one
    // djs.phone read per SESSION, not per request. Only ever runs for an
    // authenticated caller on a gated path; login-gating stays out of scope.
    //
    // Two review patches (2026-08-05): the cookie VALUE is the verified
    // user's id — a pass minted for DJ A must not carry to DJ B in the same
    // browser (sign-out also deletes it, see signOut()); and only a
    // CONFIRMED phone mints it — a failed read fails open for THIS request
    // alone ("unknown" sets no cookie), so a transient DB error can't
    // exempt a phone-less DJ for the rest of the session.
    if (
      userId &&
      isPhoneGatedPath(request.nextUrl.pathname) &&
      request.cookies.get(PHONE_ON_FILE_COOKIE)?.value !== userId
    ) {
      const phone = await phoneOnFile(supabase, userId);
      if (phone === "missing") {
        const url = request.nextUrl.clone();
        url.pathname = "/phone-required";
        url.search = "";
        // Carry any refreshed auth cookies over — dropping them would force
        // a second refresh on the very next request.
        const redirectResponse = NextResponse.redirect(url);
        supabaseResponse.cookies
          .getAll()
          .forEach((cookie) => redirectResponse.cookies.set(cookie));
        return redirectResponse;
      }
      if (phone === "present") {
        // Session cookie (no maxAge): the next session re-verifies against
        // the DB, which keeps the DB the source of truth.
        supabaseResponse.cookies.set(PHONE_ON_FILE_COOKIE, userId, {
          path: "/",
          sameSite: "lax",
          httpOnly: true,
        });
      }
    }

  } catch {
    // no-op — see comment above
  }

  return supabaseResponse;
}
