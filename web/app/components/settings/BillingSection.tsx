import { billingEnabled, offersSubscribeCta } from "@/lib/billing/checkout";
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

export function BillingSection({
  subscriptionStatus,
  statusUnknown,
}: {
  /** Stripe's status verbatim, or null if the DJ never subscribed. */
  subscriptionStatus: string | null;
  /** True when the `djs` read failed — the status is UNKNOWN, not absent. */
  statusUnknown: boolean;
}) {
  // Environment gate first — it's the cheapest check and the least about this
  // particular DJ. Production stays silent until Curfew's Stripe sandbox is
  // claimed and live keys exist (see `billingEnabled`), so pushing this to
  // curfew.vip ships nothing user-visible.
  if (!billingEnabled(process.env)) return null;

  // A failed read is not a confirmed "no subscription". Pitching Subscribe to
  // someone who may already be paying is the worse of the two wrong answers,
  // so an unknown status renders nothing — the same discipline the Account
  // section's phone row applies when it shows "—" instead of "Not on file".
  if (statusUnknown) return null;

  const offersSubscribe = offersSubscribeCta(subscriptionStatus);

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
              <span className="st-row-value">
                {formatSubscriptionStatus(subscriptionStatus as string)}
              </span>
              <p className="st-row-note">Manage your plan or cancel anytime via Stripe.</p>
            </div>
          </div>
          <ManageBillingActions />
        </>
      )}
    </section>
  );
}
