import type { Metadata } from "next";
import Link from "next/link";
import { OnboardingMesh } from "@/app/components/landing/OnboardingMesh";
import { NOINDEX } from "@/lib/seo";
import { clashDisplay } from "../fonts";
import "../landing.css";

// The onboarding corridor — /phone-required, /welcome, /link-agent — the
// screens between "account exists" and "first set on the dashboard". These
// were bare top-level pages with inline styles; now they share one shell.
// It is deliberately NOT the marketing layout: a signed-in DJ mid-setup
// should not see a nav selling Features / Join. Just the wordmark (a way
// home), the mesh (tinted per step — OnboardingMesh owns the room
// assignments), and the card. Route paths are unchanged by the group, so
// phone-gate.ts's GATED_PREFIXES still matches /link-agent, and every page
// here keeps its own server guard.

// Noindexed with the rest of the corridor (launch checklist §1.6) — these are
// mid-signup screens, meaningless out of context and thin content in Google's
// sense. Same defence-in-depth argument as the (authenticated) group's layout.
export const metadata: Metadata = {
  title: "Curfew — set up",
  description: "Finish setting up your Curfew account.",
  ...NOINDEX,
};

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${clashDisplay.variable} lp-root`}>
      <OnboardingMesh className="lp-mesh" />
      <header className="lp-ob-head">
        <Link href="/" className="lp-ob-home" aria-label="Curfew home">
          <span className="lp-wordmark lp-ob-mark" aria-hidden="true" />
        </Link>
      </header>
      {children}
    </div>
  );
}
