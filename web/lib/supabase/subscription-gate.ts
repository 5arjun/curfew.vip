import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Middleware subscription access gate (Story 7.5, AD-19) ───────────────
//
// Sibling to phone-gate.ts, not a replacement: both gates run in
// updateSession(), phone first, this one second. Structurally the same shape —
// a narrow prefix allow-list, checked inside its own `if` block — and that
// shape is load-bearing. AD-19 names the alternative as the exact mistake to
// avoid: a blanket matcher written for the web paywall (`/api/:path*`, or a
// widened proxy.ts matcher) could net the AD-4 set-sync endpoint by accident,
// even though no line of Epic 7 code mentions "sync". A prefix list can't.
//
// Deliberately NO cookie cache here, unlike phone-gate.ts's
// PHONE_ON_FILE_COOKIE — see middleware.ts for why (subscription_status is
// bidirectionally mutable mid-session; a cached "no" would break AC-4).

/**
 * The gated surface: the dashboard/stats screens, AC-1's literal scope. This
 * is the phone gate's list MINUS `/settings` and `/link-agent`, and those two
 * omissions are decisions, not gaps:
 *
 * - **`/settings` is excluded** even though it IS phone-gated today. It hosts
 *   BillingSection (Story 7.2/7.4) — the Subscribe and Manage CTAs. Gating it
 *   would strand a lapsed DJ with no route back to paying, and the gate's own
 *   destination page links here.
 * - **`/link-agent` is excluded** because it's onboarding, not dashboard/stats,
 *   and AD-19 explicitly forbids gating anything the agent itself touches
 *   "for consistency" — a lapsed DJ's agent must keep working, which means
 *   they must keep being able to link one.
 *
 * A new dashboard/stats route added to the `(authenticated)` group belongs
 * here too. A new Settings-adjacent or agent-adjacent route does not.
 *
 * Pure so the gate's scope is testable without a request in hand.
 */
export const SUBSCRIPTION_GATED_PREFIXES = [
  "/dashboard",
  "/style-evolution",
  "/library-utilization",
  "/set",
  "/track",
];

export function isSubscriptionGatedPath(pathname: string): boolean {
  return SUBSCRIPTION_GATED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * This gate's own `subscription_status` read — deliberately not shared with,
 * and not folded into, the phone gate's `djs.phone` read. Each billing/onboarding
 * concern owns its query (the discipline Story 7.4 documented for the Portal
 * route's `stripe_customer_id` read); coupling them to save a round-trip would
 * make one concern's failure mode the other's.
 *
 * Fails CLOSED: a query error, a thrown client error, and a missing `djs` row
 * all return `null`, which `hasWebAccess` reads as no access. This is the
 * deliberate inverse of `phoneOnFile`'s fail-open tri-state. Contactability is
 * a nice-to-have, so skipping the phone nag on a hiccup is fine; AD-19 is a
 * paywall invariant, so a transient DB error must never hand out free access.
 * Collapsing "read failed" into the same `null` as "never subscribed" is
 * therefore safe here — both answers deny — and keeps the caller a single
 * `hasWebAccess(...)` check with no third state to forget.
 */
/**
 * The gate's read, widened (2026-08-16) to also answer WHICH no-access page a
 * denied DJ belongs on. `subscription_status` alone can't: it is `null` both
 * for a DJ who signed up a minute ago and for a DJ whose row predates any
 * Stripe contact, and those two want opposite pages — `/subscribe` sells,
 * `/subscription-required` doesn't. `stripe_customer_id` is the discriminator
 * (see `everSubscribed`), and it costs nothing extra: same row, same query.
 *
 * Fails CLOSED on both counts, and the second one is the subtle half. A read
 * error denies access, as it always has. It ALSO reports `readFailed`, and the
 * caller routes a failed read to `/subscription-required` — the page that does
 * not sell. Guessing "never subscribed" on a hiccup would pitch a fresh
 * subscription to a DJ who may already be paying for one, which is the one
 * mistake in this area that costs a real person real money.
 */
export type BillingGateState = {
  status: string | null;
  stripeCustomerId: string | null;
  readFailed: boolean;
};

export async function readBillingGate(
  supabase: SupabaseClient,
  userId: string,
): Promise<BillingGateState> {
  try {
    const { data, error } = await supabase
      .from("djs")
      .select("subscription_status, stripe_customer_id")
      .eq("id", userId)
      .single();

    if (error || !data) {
      return { status: null, stripeCustomerId: null, readFailed: true };
    }

    return {
      status: data.subscription_status ?? null,
      stripeCustomerId: data.stripe_customer_id ?? null,
      readFailed: false,
    };
  } catch {
    return { status: null, stripeCustomerId: null, readFailed: true };
  }
}

export async function readSubscriptionStatus(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("djs")
      .select("subscription_status")
      .eq("id", userId)
      .single();

    if (error || !data) return null;
    return data.subscription_status ?? null;
  } catch {
    return null;
  }
}
