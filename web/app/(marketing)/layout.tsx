import type { Metadata } from "next";
import { bricolageGrotesque } from "../fonts";
import "../landing.css";

// Marketing route group (Story 6.1). Separate from the authenticated layout so
// the display face and the Landing's motion budget stay on this side of the
// line — UX-DR16's "logged-in surfaces stay still" half is still in force, and
// D-2 only overrides the Landing's own restraint.

export const metadata: Metadata = {
  title: "Curfew — compared to what?",
  description:
    "Curfew reads the sets you already played and gives you the only baseline that means anything: your own.",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${bricolageGrotesque.variable} lp-root`}>{children}</div>;
}
