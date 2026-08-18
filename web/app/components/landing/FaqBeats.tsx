"use client";

import { useEffect, useRef, useState } from "react";
import { LandingActions, useInView } from "./Beats";
import { SECTIONS, type Q, type Section } from "./faq-content";
import { MarketingFooter } from "./MarketingFooter";

// /faq (Arjun, 2026-08-15: "easy to view, navigate, and understand... avoid
// using ambiguous terminology"). Sectioned questions under a rail of anchors,
// each answer a plain-language disclosure.
//
// Two content rules, both Arjun's (2026-08-15):
//   * No mechanism spillage. The page never says HOW Curfew gets the data —
//     no session files, no folder names, no wire-contract talk. "Curfew
//     reads Serato" is the whole public story.
//   * The archive starts at purchase. Curfew files sets from the day a DJ
//     joins onward; nights from before are not imported. The old backfill
//     claim is gone — do not resurrect it from git history.
//
// The section rail mirrors the stepper’s rail idiom: a hairline with the
// current section lit. Position is tracked from scroll, not clicks, so the
// rail reads as "where you are", never as tabs.


export function FaqHero() {
  const [ref, inView] = useInView<HTMLElement>(0.2);
  return (
    <header className="lp-faq-hero" ref={ref} data-shown={inView ? "true" : "false"}>
      <p className="lp-feat-eyebrow">FAQ</p>
      <h1 className="lp-feat-title">Asked, answered.</h1>
      <p className="lp-sub lp-faq-sub">
        Everything DJs ask before they join, in plain words. Short questions, straight answers, no
        fine print doing the real talking.
      </p>
    </header>
  );
}

export function FaqBody() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [active, setActive] = useState(SECTIONS[0].id);
  const bodyRef = useRef<HTMLDivElement>(null);

  function toggle(id: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Deep links: /faq#music-files-uploaded opens that question and lands on
  // it. Once, at mount — after that the hash is history, not state. The open
  // happens a frame later rather than in the effect body (the compiler’s
  // set-state-in-effect rule), and the scroll a frame after that, so the
  // item is measured at its opened size before the viewport moves to it.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const match = SECTIONS.flatMap((s) => s.qs).find((q) => q.id === id);
    if (!match) return;
    const frame = requestAnimationFrame(() => {
      setOpen((current) => new Set(current).add(id));
      requestAnimationFrame(() => {
        document.getElementById(id)?.scrollIntoView();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // The rail tracks reading position: the active section is the last one
  // whose top has crossed the upper third of the viewport. Scroll-derived
  // like the stepper, not an IntersectionObserver per section — one cheap
  // read, no threshold tuning, correct at both ends of the page.
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const host = bodyRef.current;
      if (!host) return;
      const line = window.innerHeight * 0.33;
      let current = SECTIONS[0].id;
      for (const section of SECTIONS) {
        const node = document.getElementById(section.id);
        if (node && node.getBoundingClientRect().top <= line) current = section.id;
      }
      setActive((previous) => (previous === current ? previous : current));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  return (
    <div className="lp-faq-body" ref={bodyRef}>
      <nav className="lp-faq-rail" aria-label="Question sections">
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            className="lp-faq-rail-link"
            href={`#${section.id}`}
            aria-current={active === section.id ? "true" : undefined}
          >
            {section.title}
          </a>
        ))}
      </nav>

      <div className="lp-faq-sections">
        {SECTIONS.map((section) => (
          <FaqSection key={section.id} section={section} open={open} onToggle={toggle} />
        ))}
      </div>
    </div>
  );
}

function FaqSection({
  section,
  open,
  onToggle,
}: {
  section: Section;
  open: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const [ref, inView] = useInView<HTMLElement>(0.05);
  return (
    <section
      className="lp-faq-section"
      id={section.id}
      ref={ref}
      data-shown={inView ? "true" : "false"}
    >
      <h2 className="lp-faq-h">{section.title}</h2>
      {section.qs.map((q) => (
        <FaqItem key={q.id} q={q} isOpen={open.has(q.id)} onToggle={() => onToggle(q.id)} />
      ))}
    </section>
  );
}

function FaqItem({ q, isOpen, onToggle }: { q: Q; isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="lp-faq-item" id={q.id} data-open={isOpen ? "true" : "false"}>
      <h3 className="lp-faq-q">
        <button
          type="button"
          id={`${q.id}-q`}
          aria-expanded={isOpen}
          aria-controls={`${q.id}-a`}
          onClick={onToggle}
        >
          <span>{q.q}</span>
          {/* A plus that folds to a minus — collapse is the inverse of the
              gesture that opened it, so the mark says which half comes next. */}
          <span className="lp-faq-mark" aria-hidden="true">
            <span />
            <span />
          </span>
        </button>
      </h3>
      {/* Collapsed by track size (0fr → 1fr), never by `display`, so both the
          open and the close have a path. `inert` keeps a closed answer out of
          the tab order and the accessibility tree while its box animates. */}
      <div
        id={`${q.id}-a`}
        className="lp-faq-a"
        role="region"
        aria-labelledby={`${q.id}-q`}
        inert={!isOpen}
      >
        <div className="lp-faq-a-inner">
          {q.a.map((paragraph) => (
            <p key={paragraph} className="lp-body lp-faq-p">
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

export function FaqClose() {
  const [ref, inView] = useInView<HTMLElement>(0.3);
  return (
    <section className="lp-feat-close" ref={ref} data-shown={inView ? "true" : "false"}>
      <h2 className="lp-feat-title">That&rsquo;s everything. Tonight counts.</h2>
      <LandingActions className="lp-feat-close-actions" secondary={false} />
      <p className="lp-feat-price">$6.99/month, billed yearly</p>
      <MarketingFooter className="lp-feat-footer" />
    </section>
  );
}
