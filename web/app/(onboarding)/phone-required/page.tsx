import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { needsPhone } from "@/lib/supabase/phone-gate";
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
export default async function PhoneRequiredPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  if (!(await needsPhone(supabase, data.user.id))) {
    redirect("/dashboard");
  }

  return (
    <main className="lp-main lp-auth lp-auth--solo lp-auth--ob">
      <div className="lp-auth-card" data-shown="true">
        <p className="lp-feat-eyebrow">Set up — step 1 of 2</p>
        <h1 className="lp-auth-title">Add a phone number.</h1>
        <p className="lp-body lp-auth-tag">
          If your archive ever needs attention, a person can reach you.
        </p>

        <PhoneForm />
      </div>
    </main>
  );
}
