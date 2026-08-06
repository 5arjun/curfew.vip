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

// Shared by auth/callback/route.ts (OAuth) and auth/confirm/route.ts
// (email+password) — both gate their "account becomes usable" redirect on
// whether this DJ has a phone on file yet (Story 2.3c AC-1). Errors are
// swallowed and treated as "no phone needed" — the least-blocking path
// (Task 5.4); callers still don't need their own extra try/catch around
// this call as a result.
export async function needsPhone(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  return (await phoneOnFile(supabase, userId)) === "missing";
}
