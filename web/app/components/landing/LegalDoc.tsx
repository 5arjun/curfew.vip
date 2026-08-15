import type { ReactNode } from "react";
import { MarketingFooter } from "./MarketingFooter";

// The reading-page shell /terms and /privacy share: the FAQ's hero + rail +
// sections vocabulary, minus the FAQ's JavaScript. These pages are static
// server components on purpose — a policy page should be indexable and
// readable with nothing running — so every data-shown is pinned "true" (the
// reveal transitions only animate on change) and the rail is plain anchors
// with no scroll-tracked lit segment.
export type LegalSection = {
  id: string;
  title: string;
  body: ReactNode;
};

export function LegalDoc({
  eyebrow,
  title,
  sub,
  updated,
  sections,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <main className="lp-main lp-faq">
      <header className="lp-faq-hero" data-shown="true">
        <p className="lp-feat-eyebrow">{eyebrow}</p>
        <h1 className="lp-feat-title">{title}</h1>
        <p className="lp-sub lp-faq-sub">{sub}</p>
        <p className="lp-legal-updated">{updated}</p>
      </header>

      <div className="lp-faq-body">
        <nav className="lp-faq-rail" aria-label="Sections">
          {sections.map((section) => (
            <a key={section.id} className="lp-faq-rail-link" href={`#${section.id}`}>
              {section.title}
            </a>
          ))}
        </nav>

        <div className="lp-faq-sections">
          {sections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="lp-faq-section lp-legal-section"
              data-shown="true"
            >
              <h2 className="lp-faq-h">{section.title}</h2>
              {section.body}
            </section>
          ))}
        </div>
      </div>

      <MarketingFooter className="lp-feat-footer" />
    </main>
  );
}

// Paragraph and list helpers so the two documents read identically without
// each page respelling the class stack.
export function LegalP({ children }: { children: ReactNode }) {
  return <p className="lp-body lp-faq-p">{children}</p>;
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="lp-feat-facts lp-legal-facts">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
