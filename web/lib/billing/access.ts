// The web paywall's one decision (Story 7.5, AD-19): may this DJ use the
// dashboard right now? Kept out of the middleware so it's testable without a
// request or a Supabase client in hand — the same file-separation discipline
// portal.ts already keeps relative to checkout.ts.
//
// AD-19 hard invariant, restated because this is the file most likely to be
// "helpfully" reused later: this predicate governs THE WEB EXPERIENCE ONLY.
// The agent's local capture (parse -> local SQLite -> sync-queue) and the
// idempotent set-sync endpoint are never gated by subscription_status. Nothing
// in agent/ imports this, and nothing may start to.

/**
 * Statuses that grant dashboard access — AC-1's literal wording, exactly two.
 *
 * Deliberately NARROWER than checkout.ts's `SUBSCRIPTION_ATTACHED`, and not a
 * reuse of it: that list answers "does Settings show Manage instead of
 * Subscribe" and so counts `past_due`/`incomplete`/`paused` as attached. This
 * one answers "can this DJ use the dashboard today". A `past_due` DJ correctly
 * sees Manage billing in Settings (to fix their card) while correctly losing
 * the dashboard until payment recovers. The two predicates disagreeing on
 * those three statuses is the point, not a bug to reconcile.
 */
const WEB_ACCESS_STATUSES = new Set(["active", "trialing"]);

/**
 * Whether `subscription_status` permits the gated web routes.
 *
 * Allow-list, never a deny-list. `subscription_status` is a verbatim Stripe
 * passthrough (AD-19) and Stripe may ship statuses after this code does, so an
 * unrecognized value must read as "no access" rather than fall through to
 * access. `null`/`undefined`/`""` — never subscribed — are the common case and
 * land in the same bucket. Exact match only: no trimming, no case-folding, for
 * the same reason `parseInterval` doesn't — the value comes from our own
 * webhook writing Stripe's literal string, so anything else is a bug.
 */
export function hasWebAccess(status: string | null | undefined): boolean {
  if (status === null || status === undefined) return false;
  return WEB_ACCESS_STATUSES.has(status);
}
