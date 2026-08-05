import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PHONE_ON_FILE_COOKIE, isPhoneGatedPath, needsPhone } from "./phone-gate";

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
    // needsPhone() swallows its own errors and returns false, so a failed
    // read FAILS OPEN (least-blocking) — same discipline as its two
    // existing callers.
    if (
      userId &&
      isPhoneGatedPath(request.nextUrl.pathname) &&
      !request.cookies.has(PHONE_ON_FILE_COOKIE)
    ) {
      if (await needsPhone(supabase, userId)) {
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
      // Session cookie (no maxAge): the next session re-verifies against
      // the DB, which keeps the DB the source of truth.
      supabaseResponse.cookies.set(PHONE_ON_FILE_COOKIE, "1", {
        path: "/",
        sameSite: "lax",
        httpOnly: true,
      });
    }
  } catch {
    // no-op — see comment above
  }

  return supabaseResponse;
}
