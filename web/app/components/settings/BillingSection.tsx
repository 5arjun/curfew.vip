import { billingEnabled, billingManageEnabled, offersSubscribeCta } from "@/lib/billing/checkout";
import { formatSubscriptionStatus } from "@/lib/billing/portal";
import { SubscribeActions } from "./SubscribeActions";
import { ManageBillingActions } from "./ManageBillingActions";

// Billing section (Story 7.2 AC-6, Story 7.4 AC-1/AC-3) — the Settings slot
// D-1 reserved between Account and Agent. Fills both of its two states: the
// Subscribe CTA for a DJ who isn't subscribed, and a Customer Portal link to
// manage or cancel for one who is.
//
// Server-rendered off a status the page already read, so the section can
// decide not to exist at all — the same "a section with nothing true to say
// does not render" rule the rest of this page follows (AC-3, Story 3.10).
//
// The Manage half is the ELSE of offersSubscribeCta, which is wider than the
// five SUBSCRIPTION_ATTACHED statuses: an unrecognized status Stripe ships
// later also renders Manage, with its raw value formatted as the plan. That's
// the intended direction (an unknown status most likely means a subscription
// exists), but it means this row can display a string no one has seen before.

export function BillingSection({
  subscriptionStatus,
  statusUnknown,
}: {
  /** Stripe's status verbatim, or null if the DJ never subscribed. */
  subscriptionStatus: string | null;
  /** True when the `djs` read failed — the status is UNKNOWN, not absent. */
  statusUnknown: boolean;
}) {
  // A failed read is not a confirmed "no subscription". Pitching Subscribe to
  // someone who may already be paying is the worse of the two wrong answers,
  // so an unknown status renders nothing — the same discipline the Account
  // section's phone row applies when it shows "—" instead of "Not on file".
  if (statusUnknown) return null;

  // Both halves below need a definite string. `offersSubscribeCta` returns
  // true for null/undefined/"", so the Manage branch is unreachable without a
  // status today — but that is a coupling across two modules TypeScript cannot
  // see, and formatSubscriptionStatus(null) would throw. With no error.tsx
  // anywhere in web/app, that throw takes out the whole Settings page rather
  // than this one card, so narrow here instead of asserting `as string`.
  const status = subscriptionStatus ?? "";
  const offersSubscribe = offersSubscribeCta(status);

  // The env gate follows the branch rather than preceding it (Story 7.6 Task
  // 1), because the two halves answer to two different gates. Selling needs
  // `billingEnabled` — Price ids, plus an explicit BILLING_LIVE in production.
  // Managing needs only `billingManageEnabled` — a Stripe key — so pausing
  // sales leaves an existing subscriber's cancel path intact instead of
  // stranding them under copy that promises "Cancel whenever."
  //
  // A section with nothing true to say still does not render (Story 3.10 AC-3).
  if (offersSubscribe ? !billingEnabled(process.env) : !billingManageEnabled(process.env)) {
    return null;
  }

  return (
    <section className="st-card dz-shell" aria-labelledby="st-billing-label">
      <h2 id="st-billing-label" className="st-section-label">
        Billing
      </h2>
      {offersSubscribe ? (
        <>
          <div className="st-row">
            <span className="st-row-label">Plan</span>
            <div className="st-row-cell">
              <span className="st-row-value">Not subscribed</span>
              <p className="st-row-note">
                One plan, everything in it. Cancel whenever.
              </p>
            </div>
          </div>
          <SubscribeActions />
        </>
      ) : (
        <>
          <div className="st-row">
            <span className="st-row-label">Plan</span>
            <div className="st-row-cell">
              <span className="st-row-value">{formatSubscriptionStatus(status)}</span>
              <p className="st-row-note">Manage your plan or cancel anytime via Stripe.</p>
            </div>
          </div>
          <ManageBillingActions />
        </>
      )}
    </section>
  );
}
