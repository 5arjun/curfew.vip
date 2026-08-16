import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { billingEnabled } from "@/lib/billing/checkout";
import { CHECKOUT_PENDING_COOKIE, nextSetupStep, readSetupState } from "@/lib/onboarding/corridor";
import { createClient } from "@/lib/supabase/server";

// OAuth callback (Google/Apple), separate from confirm/route.ts (email-OTP).
// A provider redirect only ever produces a `code` (success) or `error`
// (user cancelled consent / provider error) param — no token_hash fallback
// applies here, unlike the email-confirmation route.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const error = searchParams.get("error");

  // Supabase call is caught (not the redirect()s below — redirect() works by
  // throwing, so it must stay outside this block or its own throw would be
  // swallowed here) so a network hiccup falls through to the calm failure
  // redirect instead of surfacing a raw 500. Same discipline as
  // confirm/route.ts (2.3a Review Findings).
  let exchanged = false;
  let destination = "/dashboard";
  if (!error && code) {
    const supabase = await createClient();
    try {
      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      exchanged = !exchangeError;
      // readSetupState() catches its own errors and reports `readFailed`, and
      // nextSetupStep() treats that as "don't block" (the least-blocking path
      // — Story 2.3c Task 5.4), so neither ever flips `exchanged` back to
      // false via this shared catch.
      if (exchanged && data.user) {
        destination = nextSetupStep({
          sellsSubscriptions: billingEnabled(process.env),
          checkoutPending:
            (await cookies()).get(CHECKOUT_PENDING_COOKIE)?.value === data.user.id,
          state: await readSetupState(supabase, data.user.id),
        });
      }
    } catch {
      exchanged = false;
    }
  }

  // Into the app, not back onto the marketing landing — same change as
  // confirm/route.ts. Where in the app is the corridor's call, not this
  // route's: as of 2026-08-16 a first-time signup goes to /subscribe (Curfew
  // is paid at signup), then the phone step, then the agent; a returning
  // sign-in lands on the dashboard. See lib/onboarding/corridor.ts.
  if (exchanged) {
    redirect(destination);
  }

  redirect("/login?error=confirmation-failed");
}
