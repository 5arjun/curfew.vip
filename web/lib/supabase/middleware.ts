import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
    await supabase.auth.getClaims();
  } catch {
    // no-op — see comment above
  }

  return supabaseResponse;
}
