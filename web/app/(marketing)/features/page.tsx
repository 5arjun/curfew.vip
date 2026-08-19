import type { Metadata } from "next";
import { FeatureClose, FeatureHero, FeatureRows } from "@/app/components/landing/FeatureBeats";
import { pageMetadata } from "@/lib/seo";

// /features (Arjun, 2026-08-14) — the feature reference the landing's
// "See features" CTAs and the nav's Features link land on. Content and the
// row components live in FeatureBeats.tsx; the shared marketing layout brings
// the nav, the mesh (ultraviolet ramp on this route — MarketingMesh.tsx) and
// landing.css.

export const metadata: Metadata = pageMetadata({
  title: "Curfew · fully automatic",
  description:
    "Curfew reads Serato's session files and your library's own tags. No plugin, no upload, no manual work. The archive builds itself.",
  path: "/features",
});

export default function FeaturesPage() {
  return (
    <main className="lp-main lp-features">
      <FeatureHero />
      <FeatureRows />
      <FeatureClose />
    </main>
  );
}
