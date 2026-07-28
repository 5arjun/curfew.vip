import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { needsPhone } from "@/lib/supabase/phone-gate";

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
  let phoneRequired = false;
  if (!error && code) {
    const supabase = await createClient();
    try {
      const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      exchanged = !exchangeError;
      // needsPhone() catches its own errors and returns false (the
      // least-blocking path — Story 2.3c Task 5.4), so it never flips
      // `exchanged` back to false via this shared catch.
      if (exchanged && data.user) {
        phoneRequired = await needsPhone(supabase, data.user.id);
      }
    } catch {
      exchanged = false;
    }
  }

  if (exchanged) {
    redirect(phoneRequired ? "/phone-required" : "/");
  }

  redirect("/login?error=confirmation-failed");
}
