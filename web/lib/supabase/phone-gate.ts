import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Middleware phone-on-file gate (Story 3.10, AC-19 / D-9, spec §4) ──────
//
// The cookie that marks "this session's DJ has a phone on file" so the
// middleware does ONE djs.phone read per session, not per request. Spoofable
// by design and acceptably so: AR-10 is a contactability invariant, not a
// security boundary — the DB stays source of truth, the cookie only skips a
// prompt. (A phone_on_file JWT claim via a custom auth hook is the noted
// airtight upgrade path.)
export const PHONE_ON_FILE_COOKIE = "curfew_phone_on_file";

/**
 * The gated surface: the `(authenticated)` route group's five screens plus
 * `/link-agent` (a top-level route, not in the group — the spec includes it
 * explicitly). Everything else is exempt — `/phone-required` itself,
 * `/login`, `/auth/*`, `/reset-password`, the public landing, and static
 * assets (already excluded by proxy.ts's matcher). A new route added to the
 * (authenticated) group must be added here too.
 *
 * Pure so the gate's scope is testable without a request in hand.
 */
const GATED_PREFIXES = [
  "/dashboard",
  "/style-evolution",
  "/library-utilization",
  "/set",
  "/settings",
  // Story 4.10's `/track/[track_id]`. Added WITH the route, not after it: the
  // omission is invisible to every gate — lint, typecheck, tests and build all
  // stay green while the new route silently bypasses the phone-on-file check
  // (D-35). `/set` is the precedent immediately above; a prefix covers the
  // dynamic segment because `isPhoneGatedPath` matches on `${prefix}/`.
  "/track",
  "/link-agent",
];

export function isPhoneGatedPath(pathname: string): boolean {
  return GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Tri-state phone read (code-review patch, 2026-08-05): the middleware must
 * tell a CONFIRMED phone apart from a failed read — fail-open was ruled
 * per-request, and only "present" may mint the session-long pass cookie.
 * "unknown" covers read errors and a missing djs row alike.
 */
export type PhoneOnFile = "present" | "missing" | "unknown";

export async function phoneOnFile(
  supabase: SupabaseClient,
  userId: string,
): Promise<PhoneOnFile> {
  try {
    const { data, error } = await supabase
      .from("djs")
      .select("phone")
      .eq("id", userId)
      .single();

    if (error || !data) return "unknown";
    return data.phone ? "present" : "missing";
  } catch {
    return "unknown";
  }
}

// `needsPhone()` lived here until 2026-08-16 and is deliberately gone rather
// than left as an unused export. It wrapped `phoneOnFile(...) === "missing"`
// for the two auth routes and the corridor pages, all five of which now read
// `readSetupState` (lib/onboarding/corridor.ts) instead — one query for phone
// AND billing, because the corridor has to decide between them in one pass.
// Keeping the wrapper would have kept a doc comment naming callers that no
// longer call it, which is how a file starts lying about its own use.
// `phoneOnFile` above is unchanged and is still the middleware gate's read.
