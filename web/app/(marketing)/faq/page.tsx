import type { Metadata } from "next";
import { FaqBody, FaqClose, FaqHero } from "@/app/components/landing/FaqBeats";
import { SECTIONS } from "@/app/components/landing/faq-content";
import { faqJsonLd, jsonLdScriptProps, pageMetadata } from "@/lib/seo";

// /faq (Arjun, 2026-08-15) — the page the nav's FAQ label was waiting for
// (LandingNav's own comment: "a label until there is a page"). Content and
// the disclosure components live in FaqBeats.tsx; the shared marketing layout
// brings the nav, the mesh (ultraviolet ramp here, like /features — see
// MarketingMesh.tsx) and landing.css.

export const metadata: Metadata = pageMetadata({
  title: "Curfew — asked, answered",
  description:
    "What Curfew reads, what leaves your laptop (the record of the set — never your music files), and what the one plan costs. Straight answers.",
  path: "/faq",
});

export default function FaqPage() {
  return (
    <main className="lp-main lp-faq">
      {/* FAQPage structured data (launch checklist §1.5), built from the same
          SECTIONS array FaqBody renders. That shared array is the whole point:
          Google requires the marked-up answer to be the answer visible on the
          page, and 18 questions maintained in two places would not stay that
          way. It is also why the content moved out of FaqBeats.tsx — that file
          is "use client", and a plain value imported from a client module into
          a server component arrives as a client reference, not as data.

          The answers are joined with a space because each is authored as
          paragraphs; schema.org wants one text per question. */}
      <script {...jsonLdScriptProps(faqJsonLd(SECTIONS))} />
      <FaqHero />
      <FaqBody />
      <FaqClose />
    </main>
  );
}
