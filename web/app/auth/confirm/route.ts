import { type EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Email-confirmation callback. Supabase's default local email template links
// to GoTrue's own hosted /auth/v1/verify endpoint, which — for a PKCE-flow
// signUp() (supabase-js's default) — redirects back here with a `code` query
// param, requiring exchangeCodeForSession(). Verified directly against the
// running local stack, 2026-07-26: the Mailpit-captured link's redirect
// landed on this route as `?code=<uuid>`, not `?token_hash=&type=`. The
// token_hash/verifyOtp path is kept as a fallback for a customized email
// template that links `token_hash`/`type` straight to the app instead of
// through GoTrue's hosted verify redirect.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  const supabase = await createClient();

  // Supabase calls are caught (not the redirect()s below — redirect() works
  // by throwing, so it must stay outside this block or its own throw would
  // be swallowed here) so a network hiccup falls through to the calm failure
  // redirect instead of surfacing a raw 500.
  let confirmed = false;
  try {
    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      confirmed = !error;
    } else if (tokenHash && type) {
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      confirmed = !error;
    }
  } catch {
    confirmed = false;
  }

  if (confirmed) {
    redirect("/");
  }

  redirect("/login?error=confirmation-failed");
}
