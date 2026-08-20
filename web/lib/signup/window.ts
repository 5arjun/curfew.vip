// "Is this sign-in the one that created the account?"
//
// Both auth routes (/auth/callback for Google and Apple, /auth/confirm for
// email) run on EVERY sign-in, not just the first. Anything that should fire
// once per account rather than once per login has to answer this question, and
// the only signal available at that point is how old `created_at` is.
//
// This lives on its own because it now has two consumers — the PostHog
// `signup_completed` capture and the Resend contact write — and they must
// agree. Two copies of this arithmetic is two definitions of "new account"
// that drift apart, and the drift would be invisible: analytics would report
// one signup count while the mailing list grew at a different rate, both
// looking perfectly healthy on their own dashboard.
//
// The window is a DAY, not minutes: on the email path `created_at` is stamped
// when the form is submitted, but the route doesn't run until the DJ opens the
// confirmation mail, which can easily be an hour later and sometimes the next
// morning. The known cost is that a confirmation opened more than 24h after
// signing up goes unreported — rare, and much the better failure than treating
// every login as a new account.
export const SIGNUP_REPORTABLE_FOR_MS = 24 * 60 * 60 * 1000;

// Deliberately total: an absent, unparseable, or future-dated `created_at` all
// answer `false`. A caller can then treat this as the single gate to check —
// there is no second failure mode to remember. Future-dated is `false` rather
// than `true` because clock skew that makes an account look not-yet-created is
// not evidence that it is new; it is evidence that the timestamp is unusable.
export function isFreshSignup(createdAt: string | undefined): boolean {
  if (!createdAt) return false;

  const age = Date.now() - Date.parse(createdAt);
  return Number.isFinite(age) && age >= 0 && age <= SIGNUP_REPORTABLE_FOR_MS;
}
