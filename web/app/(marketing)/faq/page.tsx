import type { Metadata } from "next";
import { FaqBody, FaqClose, FaqHero } from "@/app/components/landing/FaqBeats";

// /faq (Arjun, 2026-08-15) — the page the nav's FAQ label was waiting for
// (LandingNav's own comment: "a label until there is a page"). Content and
// the disclosure components live in FaqBeats.tsx; the shared marketing layout
// brings the nav, the mesh (ultraviolet ramp here, like /features — see
// MarketingMesh.tsx) and landing.css.

export const metadata: Metadata = {
  title: "Curfew — asked, answered",
  description:
    "What Curfew reads, what leaves your laptop (the record of the set — never your music files), and what the one plan costs. Straight answers.",
};

export default function FaqPage() {
  return (
    <main className="lp-main lp-faq">
      <FaqHero />
      <FaqBody />
      <FaqClose />
    </main>
  );
}
