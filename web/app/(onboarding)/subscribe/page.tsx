import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { hasWebAccess } from "@/lib/billing/access";
import { billingEnabled } from "@/lib/billing/checkout";
import {
  CHECKOUT_PENDING_COOKIE,
  everSubscribed,
  readSetupState,
  setupStepLabel,
} from "@/lib/onboarding/corridor";
import { createClient } from "@/lib/supabase/server";
import { ConfirmingSubscription } from "./confirming";
import { PlanActions } from "./plan-actions";

// /subscribe — the first step of setup as of Arjun's ruling, 2026-08-16:
// Curfew is paid at signup, so the card comes before the phone number and
// before the agent. See lib/onboarding/corridor.ts for the order and what the
// order cost.
//
// Server-guarded like every other corridor page, and the guards below are the
// whole of this screen's logic — four exits, each to the one page that is true
// for that DJ:
//
//   signed out ................. /login
//   environment can't sell ..... /phone-required   (the step doesn't exist here)
//   already has access ......... onward down the corridor
//   subscribed before .......... /subscription-required  (that page's audience)
//
// The fourth is the one worth naming. Until today every DJ without access —
// the DJ who signed up a minute ago and the DJ whose card expired last month —
// landed on /subscription-required and read copy written for the second one:
// "Your archive is intact... nothing was lost... Reactivate." Splitting the two
// destinations is what makes that sentence true again for the person it was
// written for, and gives the new DJ a page that actually sells.
export default async function SubscribePage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  // Bound to `billingEnabled` for the reason Story 7.6 Task 0 exists: a step
  // that forces a DJ to subscribe in an environment with no Price ids would
  // show them a screen with two dead buttons and no way past it. Preview and
  // local dev are that environment. They skip the step; they do not meet a
  // broken one.
  const sellsSubscriptions = billingEnabled(process.env);
  if (!sellsSubscriptions) {
    redirect("/phone-required");
  }

  const state = await readSetupState(supabase, data.user.id);

  // Paid and confirmed — the corridor continues. Not straight to /dashboard:
  // the phone step and the agent instructions are still ahead, and /welcome's
  // own guard forwards to the dashboard if this DJ's agent has already
  // reported in.
  if (hasWebAccess(state.subscriptionStatus)) {
    redirect(state.phone === "missing" ? "/phone-required" : "/welcome");
  }

  const checkoutPending =
    (await cookies()).get(CHECKOUT_PENDING_COOKIE)?.value === data.user.id;

  // A lapsed subscriber isn't in setup — they finished it once. /subscription-
  // required is their page, and it routes them to Settings where both the
  // Subscribe CTA and the Portal live. Checked AFTER the pending marker so a
  // DJ mid-checkout is never mistaken for one, and skipped entirely on a
  // failed read (`everSubscribed` would read a null row as "new").
  if (!checkoutPending && !state.readFailed && everSubscribed(state)) {
    redirect("/subscription-required");
  }

  return (
    <main className="lp-main lp-auth lp-auth--solo lp-auth--ob">
      <div className="lp-auth-card lp-ob-card" data-shown="true">
        <p className="lp-feat-eyebrow">{setupStepLabel("subscribe", sellsSubscriptions)}</p>
        <h1 className="lp-auth-title">Start the archive.</h1>

        {checkoutPending ? (
          <ConfirmingSubscription />
        ) : (
          <>
            <p className="lp-body lp-auth-tag">
              One plan, everything in it. Every set you play from tonight on, kept — and yours to
              keep reading back long after the night is over.
            </p>

            <PlanActions />
          </>
        )}
      </div>
    </main>
  );
}
