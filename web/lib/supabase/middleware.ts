import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PHONE_ON_FILE_COOKIE, isPhoneGatedPath, phoneOnFile } from "./phone-gate";
import { isSubscriptionGatedPath, readSubscriptionStatus } from "./subscription-gate";
import { hasWebAccess } from "@/lib/billing/access";
import { billingEnabled } from "@/lib/billing/checkout";

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

    // Subscription access gate (Story 7.5, AD-19). Runs SECOND, after the
    // phone gate above — a phone-less DJ should land on /phone-required
    // before ever learning about billing, matching the existing onboarding
    // sequence (phone -> welcome -> link-agent; billing is a Settings-initiated
    // action, never a forced onboarding step).
    //
    // Three deliberate differences from the phone gate it sits beside:
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
    //    would lock out a DJ who has already paid again. A later optimization
    //    needs a short TTL or webhook-driven invalidation — not this shape.
    // 2. **Fails closed.** `readSubscriptionStatus` collapses read errors to
    //    `null`, which `hasWebAccess` denies. The phone gate fails open for
    //    the request; a paywall must not.
    // 3. **Its own read**, never folded into the phone gate's `djs` query.
    //
    // Unchanged from the phone gate, and load-bearing (AD-19): the scope is a
    // narrow prefix allow-list checked inside this block — never a widened
    // proxy.ts matcher and never an `/api/:path*` pattern. That is precisely
    // how a paywall written for the dashboard could net the AD-4 set-sync
    // endpoint by accident. The agent is never gated by subscription_status.
    //
    // Fourth condition, added after 7.5 shipped: the paywall exists exactly
    // where Checkout exists. An environment that cannot sell a subscription
    // must not restrict access for the lack of one — otherwise a DJ is sent
    // to /subscription-required, told to visit /settings, and finds nothing
    // there, because BillingSection is behind this same `billingEnabled`.
    // That closed loop was live on curfew.vip: production carries no Price
    // ids and no BILLING_LIVE, so every real account was gated out with no
    // way to pay. Binding both to one predicate means the paywall switches
    // on in the same deploy that makes the Subscribe CTA appear (Story 7.6
    // Task 5) — it can never be enabled without a way out of it.
    //
    // Spelled-out properties, not `process.env` passed whole: proxy.ts
    // exports no `runtime`, so this runs on Edge, where Next inlines
    // `process.env.FOO` literals at build time. Dynamic indexing inside
    // billingEnabled would read undefined there and silently disable the
    // gate everywhere, which is the failure this line must not have.
    const sellsSubscriptions = billingEnabled({
      STRIPE_PRICE_ID_MONTHLY: process.env.STRIPE_PRICE_ID_MONTHLY,
      STRIPE_PRICE_ID_ANNUAL: process.env.STRIPE_PRICE_ID_ANNUAL,
      VERCEL_ENV: process.env.VERCEL_ENV,
      BILLING_LIVE: process.env.BILLING_LIVE,
    });

    if (sellsSubscriptions && userId && isSubscriptionGatedPath(request.nextUrl.pathname)) {
      const status = await readSubscriptionStatus(supabase, userId);
      if (!hasWebAccess(status)) {
        const url = request.nextUrl.clone();
        url.pathname = "/subscription-required";
        url.search = "";
        // Carry any refreshed auth cookies over, exactly as above.
        const redirectResponse = NextResponse.redirect(url);
        supabaseResponse.cookies
          .getAll()
          .forEach((cookie) => redirectResponse.cookies.set(cookie));
        return redirectResponse;
      }
    }
  } catch {
    // no-op — see comment above
  }

  return supabaseResponse;
}
