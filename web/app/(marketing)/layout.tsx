import type { Metadata } from "next";
import { LandingNav } from "@/app/components/landing/LandingNav";
import { MarketingMesh } from "@/app/components/landing/MarketingMesh";
import {
  jsonLdScriptProps,
  organizationJsonLd,
  pageMetadata,
  softwareApplicationJsonLd,
} from "@/lib/seo";
import { clashDisplay } from "../fonts";
import "../landing.css";

// Marketing route group (Story 6.1). Separate from the authenticated layout so
// the display face and the Landing's motion budget stay on this side of the
// line — UX-DR16's "logged-in surfaces stay still" half is still in force, and
// D-2 only overrides the Landing's own restraint.

// This object is the LANDING PAGE's metadata as much as it is the group's
// default. `(marketing)/page.tsx` is a "use client" component and a client
// component cannot export metadata — so `/`, the one title on this site that
// most needs to be good, can only be set from here. Every other route in the
// group overrides it (see each page's `pageMetadata()` call), which is what
// keeps that from being a trap.
//
// Title and description rewritten for §1.5. The old pair was `title: "Curfew"`
// — one word, no claim, the weakest possible result line for the site's most
// important query — and the tagline alone. Brand-first with an em dash, which
// is the house style every other page here already follows.
export const metadata: Metadata = pageMetadata({
  title: "Curfew — the DJ set archive that builds itself",
  description:
    "Curfew reads the sets you play in Serato and gives you the only baseline that means anything: your own. No plugin, no upload, nothing to file.",
  path: "/",
});

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${clashDisplay.variable} lp-root`}>
      {/* Structured data (launch checklist §1.5): who publishes the site, and
          what the product is. Mounted on the LAYOUT rather than on `/` for the
          same reason the metadata above is — the landing page is a client
          component and cannot host a server-rendered script. Every marketing
          route therefore carries it, which is correct rather than merely
          convenient: the same organisation publishes all of them and they all
          describe the same application, and the stable `@id`s mean a crawler
          reads one entity described repeatedly, not several. The `sameAs`
          links are the Instagram and X accounts (Arjun, 2026-08-18) — they are
          what tells Google those profiles and this site are one brand. */}
      <script {...jsonLdScriptProps(organizationJsonLd())} />
      <script {...jsonLdScriptProps(softwareApplicationJsonLd())} />
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
