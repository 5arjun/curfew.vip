import type { Metadata } from "next";
import Link from "next/link";
import { MarketingFooter } from "@/app/components/landing/MarketingFooter";

// /contact — one address, three doors. support@curfew.vip is the canonical
// inbox everywhere (Settings' export/delete mailtos already point at it);
// the subject lines here match the ones Settings uses so requests land
// pre-sorted. Static server component, same reading-room shell as the legal
// pages (ultraviolet ramp — MarketingMesh.tsx).
//
// First hero ("A person answers." / "no chatbot maze") was cut as corny
// (Arjun, 2026-08-15) — the page now just says where mail goes and what
// it's for, no posture about what it isn't.

export const metadata: Metadata = {
  title: "Curfew — contact",
  description: "How to reach Curfew: support, data requests, and questions before you join.",
};

const DOORS = [
  {
    title: "Support",
    body: "Something broken, something confusing, a set that didn't land where it should — say what happened and when.",
    label: "support@curfew.vip",
    href: "mailto:support@curfew.vip",
  },
  {
    title: "Your data",
    body: "Export everything, or delete the account and everything in it. Both on request, handled by a person.",
    label: "Request an export",
    href: "mailto:support@curfew.vip?subject=Data%20export%20request",
  },
  {
    title: "Before you join",
    body: "Most questions about the plan, the agent, and what leaves your laptop are already answered in plain words.",
    label: "Read the FAQ",
    href: "/faq",
  },
] as const;

export default function ContactPage() {
  return (
    <main className="lp-main lp-faq">
      <header className="lp-faq-hero" data-shown="true">
        <p className="lp-feat-eyebrow">Contact</p>
        <h1 className="lp-feat-title">Write to us.</h1>
        <p className="lp-sub lp-faq-sub">
          One address for everything — questions before you join, problems with a set, your data.
          Mail goes straight to the people building Curfew.
        </p>
      </header>

      <div className="lp-contact-grid">
        {DOORS.map((door) => (
          <section key={door.title} className="lp-contact-card">
            <h2 className="lp-faq-h lp-contact-h">{door.title}</h2>
            <p className="lp-body lp-contact-body">{door.body}</p>
            {door.href.startsWith("mailto:") ? (
              <a className="lp-contact-link" href={door.href}>
                {door.label}
              </a>
            ) : (
              <Link className="lp-contact-link" href={door.href}>
                {door.label}
              </Link>
            )}
          </section>
        ))}
      </div>

      <MarketingFooter className="lp-feat-footer" />
    </main>
  );
}
