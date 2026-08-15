import type { Metadata } from "next";
import { LandingNav } from "@/app/components/landing/LandingNav";
import { MarketingMesh } from "@/app/components/landing/MarketingMesh";
import { clashDisplay } from "../fonts";
import "../landing.css";

// Marketing route group (Story 6.1). Separate from the authenticated layout so
// the display face and the Landing's motion budget stay on this side of the
// line — UX-DR16's "logged-in surfaces stay still" half is still in force, and
// D-2 only overrides the Landing's own restraint.

export const metadata: Metadata = {
  title: "Curfew — compared to what?",
  description:
    "Curfew reads the sets you play and gives you the only baseline that means anything: your own.",
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${clashDisplay.variable} lp-root`}>
      {/* One fixed atmosphere behind every beat, mounted at the layout rather
          than inside the hero so it survives the whole scroll on one WebGL
          context. Full-bleed film beats cover it; the hero, the stepper and
          the close let it through. MarketingMesh swaps the palette per route
          (/features runs the ultraviolet ramp) without remounting the canvas. */}
      <MarketingMesh className="lp-mesh" />
      <LandingNav />
      {children}
    </div>
  );
}
