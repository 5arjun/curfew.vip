import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { billingEnabled } from "@/lib/billing/checkout";
import {
  CHECKOUT_PENDING_COOKIE,
  mustSubscribeFirst,
  readSetupState,
  setupStepLabel,
} from "@/lib/onboarding/corridor";
import { createClient } from "@/lib/supabase/server";
import { PhoneForm } from "./phone-form";

// Server-guarded (Task 3.2 explicitly allows this) so the redirect for a
// signed-out or already-phone-on-file visitor happens before any markup
// ships, matching the server-side gating both auth routes already use — no
// blank-page flash, no dependency on client JS running successfully.
// Not skippable per EXPERIENCE.md's State Patterns "Phone number required"
// row — no cancel/skip control anywhere on this page.
//
// Onboarding pass (2026-08-15): joined the (onboarding) shell — same URL,
// now the ember room and the auth card instead of a bare <main>. A visitor
// who already has a phone goes to /dashboard (the app home), not the
// marketing landing; the flow's next step after a successful save is
// /welcome (actions.ts).
//
// Billing pass (2026-08-16): no longer the first step. /subscribe runs ahead
// of it, so this page now checks that before it checks its own subject —
// which is the corridor's order, and the reverse of the order middleware.ts
// used to enforce. The step eyebrow is computed for the same reason: it reads
// "step 2 of 3" where billing is live and "step 1 of 2" where it isn't.
export default async function PhoneRequiredPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  const sellsSubscriptions = billingEnabled(process.env);
  const state = await readSetupState(supabase, data.user.id);
  const checkoutPending =
    (await cookies()).get(CHECKOUT_PENDING_COOKIE)?.value === data.user.id;

  if (mustSubscribeFirst({ sellsSubscriptions, checkoutPending, state })) {
    redirect("/subscribe");
  }

  if (state.phone !== "missing") {
    redirect("/dashboard");
  }

  return (
    <main className="lp-main lp-auth lp-auth--solo lp-auth--ob">
      <div className="lp-auth-card" data-shown="true">
        <p className="lp-feat-eyebrow">{setupStepLabel("phone", sellsSubscriptions)}</p>
        <h1 className="lp-auth-title">Add a phone number.</h1>
        <p className="lp-body lp-auth-tag">
          If your archive ever needs attention, a person can reach you.
        </p>

        <PhoneForm />
      </div>
    </main>
  );
}
