import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Password-recovery callback (Story 3.10, AC-8 / D-5) — the landing half of
// Settings' "Send reset link". The recovery email links through GoTrue's
// hosted verify endpoint, which redirects here with a `code` (PKCE flow —
// the code verifier cookie was set when the server action called
// resetPasswordForEmail, so the exchange must happen in this same browser).
// A route handler, not a page: exchangeCodeForSession must persist the
// session cookie, which a server component render is not allowed to do.
//
// Success → /reset-password (the single new-password field). Failure — an
// expired/used link, or the link opened in a different browser than the one
// that requested it — → the login page's existing calm failure state. No
// phone-gate concern: /reset-password is outside the gated route set, and
// setting the password comes first anyway.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  let exchanged = false;
  if (code) {
    const supabase = await createClient();
    // Caught (not the redirect()s below — redirect() throws by design) so a
    // network hiccup lands on the calm failure redirect, not a raw 500 —
    // same discipline as auth/confirm and auth/callback.
    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      exchanged = !error;
    } catch {
      exchanged = false;
    }
  }

  if (exchanged) {
    redirect("/reset-password");
  }

  redirect("/login?error=confirmation-failed");
}
