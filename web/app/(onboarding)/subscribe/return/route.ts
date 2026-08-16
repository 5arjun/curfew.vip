import { NextResponse, type NextRequest } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import {
  CHECKOUT_PENDING_COOKIE,
  CHECKOUT_PENDING_MAX_AGE,
} from "@/lib/onboarding/corridor";
import { createClient } from "@/lib/supabase/server";

// Stripe's `success_url` for the onboarding entry point — the hop between
// "the card went through" and the rest of setup.
//
// It exists because of one gap in Story 7.3's design that only becomes
// user-visible now that Checkout sits INSIDE the corridor: `subscription_status`
// is written solely by the webhook (AD-19), and the browser's redirect back
// from Stripe races that webhook. When Checkout was a Settings action the race
// was harmless — you landed on Settings, which sells nothing you'd buy twice.
// Landing mid-corridor is different: the very next guard asks "has this DJ
// subscribed?", reads a status the webhook hasn't written yet, and would send
// someone who just paid back to a page offering to charge them again.
//
// So this route asks the one source that is authoritative BEFORE the webhook —
// Stripe itself — and records the answer in a cookie the corridor's guards
// honor. It deliberately does NOT write `djs`: AD-19 gives the webhook sole
// ownership of the billing columns, and a second writer racing it is exactly
// the class of bug that ownership rule exists to prevent. The cookie is a
// display fact with a 30-minute life, not a billing fact.
//
// Pinned to Node for the same reason the Checkout and webhook routes are: the
// Stripe SDK's crypto isn't Edge-safe.
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  // No session, nothing to confirm and no one to confirm it for.
  if (!auth.user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const sessionId = new URL(request.url).searchParams.get("session_id");

  // Arriving with no session id means this wasn't a Stripe redirect — a typed
  // URL, a stale bookmark, a crawler. Back to the step, no marker minted.
  if (!sessionId) {
    return NextResponse.redirect(new URL("/subscribe", request.url));
  }

  // Three outcomes, and the middle one is the reason this isn't a boolean.
  //
  // - Stripe answers "complete" AND the session is this DJ's -> confirmed.
  // - Stripe answers anything else -> a real "not paid". Back to /subscribe
  //   with no marker; the CTAs are correct to be there.
  // - Stripe doesn't answer at all (outage, or a restricted key without
  //   `checkout.sessions:read`) -> UNKNOWN, and unknown is treated as
  //   confirmed here. That looks generous until you price the two mistakes:
  //   wrongly continuing costs a spinner and a public download link, while
  //   wrongly refusing re-pitches Checkout to a DJ whose card was already
  //   charged. The dashboard paywall reads the database and never this
  //   cookie, so the generous branch cannot leak access — see
  //   CHECKOUT_PENDING_COOKIE's note. A missing key permission must not be
  //   able to cause a double charge.
  let confirmed: boolean;
  try {
    const session = await getStripe().checkout.sessions.retrieve(sessionId);
    confirmed = session.status === "complete" && session.client_reference_id === auth.user.id;
  } catch {
    confirmed = true;
  }

  if (!confirmed) {
    return NextResponse.redirect(new URL("/subscribe", request.url));
  }

  // Straight on to the next corridor step. No polling for the webhook first:
  // the two screens between here and the dashboard (the phone form, then the
  // agent instructions) take a human many seconds to clear, which is far
  // longer than the webhook needs — the corridor's own shape absorbs the race
  // that a spinner would otherwise have to.
  const response = NextResponse.redirect(new URL("/phone-required", request.url));

  // Keyed to the user id, exactly as PHONE_ON_FILE_COOKIE is and for the same
  // reason: a marker minted for DJ A must not carry to DJ B in the same
  // browser.
  response.cookies.set(CHECKOUT_PENDING_COOKIE, auth.user.id, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    maxAge: CHECKOUT_PENDING_MAX_AGE,
  });

  return response;
}
