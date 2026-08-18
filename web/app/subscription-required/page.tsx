import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MeshDrift } from "@/app/components/landing/MeshDrift";
import { AUTH_PALETTE } from "@/app/components/landing/MarketingMesh";
import { createClient } from "@/lib/supabase/server";
import { readSubscriptionStatus } from "@/lib/supabase/subscription-gate";
import { hasWebAccess } from "@/lib/billing/access";
import { NOINDEX } from "@/lib/seo";
import { clashDisplay } from "../fonts";
import "../landing.css";

// Where the middleware's subscription gate lands a DJ whose subscription
// isn't active (Story 7.5, AD-19).
//
// Top-level, NOT inside (onboarding) or (authenticated) — the same shape
// /reset-password takes: a utility route that is neither a step in the
// onboarding corridor nor itself gated. Being ungated is load-bearing, not
// incidental: the gate's own destination must never be gated by the gate.
// It brings its own lp-root/landing.css shell for the same reason
// /reset-password brings its own — a top-level route has no group layout to
// inherit one from — and reuses /phone-required's solo-card composition and
// the ember room a DJ signs in under. No new CSS.
//
// Server-guarded, same doorway pattern as /phone-required: a signed-out
// visitor goes to /login, and a DJ who DOES have access goes to /dashboard
// rather than reading a paywall notice that no longer applies to them. That
// second guard is what makes a stale bookmark or a back-navigation after
// reactivating land somewhere true (AC-4).

export const metadata: Metadata = {
  title: "Curfew — subscription",
  description: "Your Curfew subscription is inactive.",
  // Top-level, so it inherits no group layout's noindex — it needs its own
  // (launch checklist §1.6).
  ...NOINDEX,
};

export default async function SubscriptionRequiredPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) {
    redirect("/login");
  }

  if (hasWebAccess(await readSubscriptionStatus(supabase, data.user.id))) {
    redirect("/dashboard");
  }

  return (
    <div className={`${clashDisplay.variable} lp-root`}>
      <MeshDrift className="lp-mesh" palette={AUTH_PALETTE} />
      <main className="lp-main lp-auth lp-auth--solo">
        <div className="lp-auth-card" data-shown="true">
          <h1 className="lp-auth-title">Subscription inactive.</h1>
          <p className="lp-body lp-auth-tag">
            Your archive is intact. The agent kept capturing every set regardless — nothing was
            lost, and nothing needs restoring. Reactivate and the dashboard returns with everything
            still in it.
          </p>

          {/* The page's only interactive element. Deliberately a link to
              Settings, not a second Checkout/Portal trigger — Story 7.2/7.4's
              Subscribe and Manage CTAs already live there, and two entry
              points into billing is one too many. `lp-auth-continue` is the
              existing full-width card-closing link the signed-in login card
              already ends on. */}
          <Link href="/settings" className="lp-auth-continue">
            Go to Settings
          </Link>
        </div>
      </main>
    </div>
  );
}
