import { createClient as createIsolatedClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { extractAgentTokens } from "@/lib/agent-session";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/service";

// Mints a SECOND, independent Supabase session for the desktop agent, so the
// agent and the browser stop sharing one refresh-token rotation family.
//
// Until 2026-08-20 `link-handoff.tsx` handed the agent the browser's own
// `session.refresh_token`. Supabase rotates the refresh token on every use,
// and both parties refresh independently — supabase-js auto-refreshes while a
// tab is open, the agent refreshes on its sync-queue drain cadence — so
// whichever refreshed second presented a spent token and was rejected. When
// the agent lost that race it cleared the keychain entry (`auth/client.rs`'s
// `RefreshRejected` arm) and unlinked itself; when the browser lost, the DJ
// was logged out of the website. Confirmed in the prod auth logs as
// `refresh_token_already_used` ("Possible abuse attempt"), 2026-08-20 15:28Z.
//
// Two sessions cannot race because rotation is per-session: each has its own
// row in `auth.sessions` and its own token family. Verified against prod
// before building this — DJs there already hold 3-4 concurrent sessions that
// coexist, which is also what rules out the one setting that would have made
// this fix a different bug (single-session-per-user, which evicts prior
// sessions on sign-in; it is off).
//
// The deep-link contract is untouched on purpose: same three query params,
// same shapes. That means every 0.1.x agent already installed is fixed the
// moment this deploys, which matters because agent auto-updates take ~6 hours
// and can't be rolled back.

// Pinned to Node, not Edge: same reasoning as the billing routes, and this
// route reads `SUPABASE_SECRET_KEY` at request time.
export const runtime = "nodejs";

// A response body that IS credentials. Belt-and-braces against any layer in
// front of this route deciding a 200 JSON body is cacheable.
const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST() {
  // Auth from the DJ's cookies, and it's the only auth check this route
  // needs: /link-agent is behind the same guard. 401 rather than a redirect —
  // the caller is a `fetch`, and a 302 to /login would arrive as opaque HTML.
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401, headers: NO_STORE });
  }

  // `generateLink` identifies the DJ by email, so an account without one has
  // no path through here. Every account has a confirmed email today (email is
  // the login identifier; phone is collected separately at /phone-required),
  // so this is a guard against a future sign-up route, not a live branch —
  // but it must not be an unhandled `undefined` reaching the admin API.
  const email = user.email;
  if (!email) {
    return NextResponse.json(
      { error: "Linking unavailable" },
      { status: 409, headers: NO_STORE },
    );
  }

  try {
    // Service-role, because minting a session for a DJ is by definition
    // something the DJ's own key can't do. `magiclink` sends no email — it
    // returns the link's components for a custom flow, and this flow never
    // uses `action_link`, only `hashed_token`. Unlike the endpoints that DO
    // send email, `/auth/v1/admin/generate_link` carries no rate-limit quota
    // (checked against the auth rate-limit table, 2026-08-20).
    const { data: link, error: linkError } = await getSupabaseAdmin().auth.admin.generateLink({
      type: "magiclink",
      email,
    });

    const hashedToken = link?.properties?.hashed_token;
    if (linkError || !hashedToken) {
      return NextResponse.json(
        { error: "Linking unavailable" },
        { status: 502, headers: NO_STORE },
      );
    }

    // Redeemed server-side on a THROWAWAY client — the whole point of the
    // fix. `persistSession: false` keeps the new session out of any storage,
    // and because this is `@supabase/supabase-js` rather than
    // `@supabase/ssr`, it has no cookie adapter at all: it cannot write over
    // the DJ's browser session cookie the way `createClient()` from
    // `lib/supabase/server.ts` would. `autoRefreshToken: false` stops the
    // server from starting a timer to rotate a token it is about to hand
    // away — that would resurrect the exact race this removes.
    //
    // Anon key, not the secret one: redeeming an OTP is an ordinary
    // unauthenticated operation, and the elevated key has no business on a
    // call that doesn't need it.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, see web/README.md#Environment",
      );
    }

    const isolated = createIsolatedClient(supabaseUrl, supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    });

    const { data: verified, error: verifyError } = await isolated.auth.verifyOtp({
      type: "magiclink",
      token_hash: hashedToken,
    });

    const tokens = extractAgentTokens(verified?.session);
    if (verifyError || !tokens) {
      return NextResponse.json(
        { error: "Linking unavailable" },
        { status: 502, headers: NO_STORE },
      );
    }

    // Only the two tokens. Sensitive, and about to be sensitive somewhere
    // else too — the client puts them straight into a custom-scheme URL, the
    // same exposure the browser's own tokens had before this change. Never
    // logged, here or in the failure branches above: the errors that reach
    // this route can quote token material back at you.
    return NextResponse.json(tokens, { headers: NO_STORE });
  } catch {
    // Calm, uniform failure, same discipline as the billing routes: a
    // Supabase outage, a bad key, or a disabled email provider all surface as
    // one generic 502. GoTrue's own error text names internal configuration.
    return NextResponse.json({ error: "Linking unavailable" }, { status: 502, headers: NO_STORE });
  }
}
