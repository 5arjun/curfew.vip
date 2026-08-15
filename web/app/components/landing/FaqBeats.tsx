"use client";

import { useEffect, useRef, useState } from "react";
import { LandingActions, useInView } from "./Beats";

// /faq (Arjun, 2026-08-15: "easy to view, navigate, and understand... avoid
// using ambiguous terminology"). Sectioned questions under a rail of anchors,
// each answer a plain-language disclosure. Every claim below is checked
// against what is actually built — Serato-only, history backfill (3.3b), the
// raw-data wire guarantee (2.7), export/deletion on request not self-serve
// (2.11), one plan at the two real prices — so the page can stay flat and
// declarative without hedging.
//
// The section rail mirrors the stepper’s rail idiom: a hairline with the
// current section lit. Position is tracked from scroll, not clicks, so the
// rail reads as "where you are", never as tabs.

type Q = { id: string; q: string; a: string[] };
type Section = { id: string; title: string; qs: Q[] };

const SECTIONS: Section[] = [
  {
    id: "the-basics",
    title: "The basics",
    qs: [
      {
        id: "what-is-curfew",
        q: "What is Curfew?",
        a: [
          "Curfew is an archive of your DJ sets that builds itself. A small desktop app — the Curfew agent — reads the session records Serato already writes, and every night you play shows up on your dashboard: the full tracklist in order against the clock, the arc of the night, and how the set sits against everything you have played before.",
          "You never file anything, upload anything, or press record. You play; the archive keeps.",
        ],
      },
      {
        id: "what-do-i-need",
        q: "What do I need to use it?",
        a: [
          "Two things: Serato DJ on a Mac or Windows laptop, and the Curfew agent installed on that laptop. No hardware, no plugin inside Serato, nothing to export.",
          "If you play on other software — Rekordbox, Traktor, Engine DJ — Curfew cannot read your sets yet. Serato is what it speaks today.",
        ],
      },
      {
        id: "change-how-i-play",
        q: "Do I have to change how I play?",
        a: [
          "No. The agent works after the fact: when a set ends, it reads the session record Serato has already written. Nothing runs inside Serato, nothing touches your decks, and there is no button to remember mid-set.",
        ],
      },
      {
        id: "old-sets",
        q: "Will my old sets show up, or only new ones?",
        a: [
          "Both. On first run the agent reads the play history Serato already keeps on your laptop, so the nights you played before Curfew existed come back too. For most DJs that is years of sets, in the archive the same day you install it.",
        ],
      },
    ],
  },
  {
    id: "your-sets",
    title: "Your sets",
    qs: [
      {
        id: "where-data-comes-from",
        q: "Where does the data come from?",
        a: [
          "From Serato’s own records. Serato writes a session file for every set you play; the agent reads those files, plus the tags already on the tracks in your library — artist, title, BPM, key, genre.",
          "Curfew never listens to audio and never needs the music files themselves. It reads what your software already wrote down.",
        ],
      },
      {
        id: "dancefloor-detection",
        q: "What is dancefloor detection?",
        a: [
          "Most session records include the soundcheck, the empty first hour, the pack-down. Curfew’s engine estimates when the real dancefloor was — the stretch of the night your stats should be measured against — and draws that window on the set where you can see it.",
        ],
      },
      {
        id: "dancefloor-wrong",
        q: "What if it gets the dancefloor wrong?",
        a: [
          "Drag the edges. Your correction stands — the night’s stats recalculate against it — and the engine learns from what you fixed for next time. It is an estimate you can always overrule, never a verdict.",
        ],
      },
      {
        id: "no-internet",
        q: "What happens if I play somewhere with no internet?",
        a: [
          "The set is captured on your laptop the moment it ends, and syncs on its own when you are back online. Nothing about a night is lost to a bad connection.",
        ],
      },
      {
        id: "compared-to-other-djs",
        q: "Does Curfew compare me to other DJs?",
        a: [
          "No — deliberately. Nothing in Curfew ranks you, scores you against anyone, or shows your sets to another DJ. The only baseline is your own history: what you played tonight, against what you used to play.",
        ],
      },
    ],
  },
  {
    id: "your-data",
    title: "Your data",
    qs: [
      {
        id: "music-files-uploaded",
        q: "Do my music files get uploaded?",
        a: [
          "No. Your audio files and your library never leave your laptop — the agent’s sync messages are built so they cannot carry a file or a file path, and a test in the codebase fails if anyone ever tries to add one.",
          "What syncs is the derived record of a set: track titles, times, keys, BPMs, and the stats built from them.",
        ],
      },
      {
        id: "who-can-see-sets",
        q: "Who can see my sets?",
        a: [
          "You. Sets are private to your account. There are no public profiles, no feed, and no leaderboard putting your nights in front of anyone else.",
        ],
      },
      {
        id: "export-or-delete",
        q: "Can I get my data out, or delete everything?",
        a: [
          "Yes, both — on request. Ask, and your archive comes back to you in a portable format; ask, and Curfew deletes the account and every row of data it owns. The agent’s own local database lives on your laptop and goes with the app.",
          "A self-serve control is coming. Until then a request is handled by a person, not a queue.",
        ],
      },
    ],
  },
  {
    id: "the-agent",
    title: "The agent",
    qs: [
      {
        id: "what-is-the-agent",
        q: "What exactly is the agent?",
        a: [
          "A small app that sits in your menu bar on macOS, or the system tray on Windows. It watches for finished sets, reads them, syncs the derived record, and stays out of the way. Builds are signed, and it updates itself.",
        ],
      },
      {
        id: "slow-serato-down",
        q: "Does it run during my set, or slow Serato down?",
        a: [
          "It never attaches to Serato and never touches audio. It waits for Serato to finish writing a session, then reads the file — its work happens after the night, not during it.",
        ],
      },
      {
        id: "usb-library",
        q: "My library lives on a USB drive — does that work?",
        a: [
          "Yes. Point the agent at the drive’s _Serato_ folder and it reads from there. If the drive is unplugged the agent says so plainly, and picks up where it left off when the drive comes back.",
        ],
      },
    ],
  },
  {
    id: "the-plan",
    title: "The plan",
    qs: [
      {
        id: "what-does-it-cost",
        q: "What does Curfew cost?",
        a: [
          "One plan: $6.99 a month billed yearly, or $7.99 month to month. Every feature is in it — there are no tiers, and nothing sits behind a higher price.",
        ],
      },
      {
        id: "why-paid",
        q: "Why is Curfew paid?",
        a: [
          "Because the plan is the product. The subscription pays for the agent, the sync, and the archive — which means your playing history is never the thing being sold.",
        ],
      },
      {
        id: "what-if-i-cancel",
        q: "What happens if I cancel?",
        a: [
          "You stop paying — no lock-in, no wind-down call. Your data stays yours either way: export or deletion, on request, exactly as above.",
        ],
      },
    ],
  },
];

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
      <footer className="lp-footer lp-feat-footer">
        <span>Curfew</span>
        <span>Privacy · Terms</span>
      </footer>
    </section>
  );
}
