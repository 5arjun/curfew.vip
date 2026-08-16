// Portal's one pure decision (Story 7.4): presentational formatting of
// Stripe's verbatim subscription status for the Manage row. This is
// punctuation only, not a second state machine — AD-19's "never locally
// reinterpreted" rule governs the value written to `subscription_status`,
// not how it's capitalized for display. The underlying string stays
// Stripe's own value; only its spacing/casing changes.

/**
 * Formats a Stripe subscription status for display, e.g. `"past_due"` ->
 * `"Past due"`, `"trialing"` -> `"Trialing"`. Replaces every `_` with a
 * space and capitalizes only the first character — no per-word title-casing,
 * so multi-word statuses read as a normal sentence fragment rather than a
 * Heading Case label.
 */
export function formatSubscriptionStatus(status: string): string {
  const spaced = status.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
