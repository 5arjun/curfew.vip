"use client";

import { useEffect, useRef, useState } from "react";
import { LandingActions, useInView } from "./Beats";

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

type Q = { id: string; q: string; a: string[] };
type Section = { id: string; title: string; qs: Q[] };

const SECTIONS: Section[] = [
  {
    id: "the-basics",
    title: "The basics",
    qs: [
      {
        id: "who-is-curfew-for",
        q: "Who is Curfew for?",
        a: [
          "Working DJs who play real rooms in Serato — clubs, weddings, corporate nights, private events, bars, radio. If you finish a set wondering how the night actually went, Curfew is built for you.",
          "It fits wedding and private-event DJs especially well: long nights where cocktail hour, dinner and the real dancefloor blur together are exactly what Curfew was built to pull apart.",
        ],
      },
      {
        id: "what-is-curfew",
        q: "What is Curfew?",
        a: [
          "Curfew is an archive of your DJ sets that builds itself. It connects to Serato through a small desktop app — the Curfew agent — and every night you play shows up on your dashboard: the full tracklist in order against the clock, the arc of the night, and how the set sits against the nights before it.",
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
          "No. Curfew picks the night up on its own once the set ends. Nothing runs inside Serato, nothing touches your decks, and there is no button to remember mid-set.",
        ],
      },
      {
        id: "old-sets",
        q: "Will my old sets show up, or only new ones?",
        a: [
          "Your archive starts the day you join. Curfew files every set you play from then on; nights from before Curfew are not imported.",
          "The value compounds from night one — after a month you can already see a month of your own history moving.",
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
          "From Serato, and from the tags already on the tracks in your library — artist, title, BPM, key, genre. When a set ends, Curfew has the night: what you played, in what order, at what time.",
          "Curfew never listens to audio and never needs the music files themselves.",
        ],
      },
      {
        id: "dancefloor-detection",
        q: "What is the dancefloor detection engine?",
        a: [
          "A night is longer than its dancefloor. If you play weddings or private events you know the shape: cocktail hour, dinner, speeches — and then the part everyone came for. Club nights have their own version: the empty first hour, the pack-down.",
          "The dancefloor detection engine finds the stretch that actually mattered and draws that window on the set, so your stats are measured on the real dancefloor — not on the dinner hour.",
        ],
      },
      {
        id: "dancefloor-wrong",
        q: "What if the engine gets the dancefloor wrong?",
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
          "No. Your music and your library never leave your laptop.",
          "What syncs is the record of the set: track titles, times, keys, BPMs, and the stats built from them. Nothing else.",
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
          "A small app that sits in your menu bar on macOS, or the system tray on Windows. It keeps your archive up to date on its own and stays out of the way. Builds are signed, and it updates itself.",
        ],
      },
      {
        id: "slow-serato-down",
        q: "Does it run during my set, or slow Serato down?",
        a: [
          "It never attaches to Serato and never touches audio. Its work happens after the night, not during it — while you play, it stays out of the way.",
        ],
      },
      {
        id: "usb-library",
        q: "My library lives on a USB drive — does that work?",
        a: [
          "Yes. Tell the agent where your library lives and it works from there. If the drive is unplugged the agent says so plainly, and picks up where it left off when the drive comes back.",
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
          "The subscription keeps the archive running: it covers database, server and hosting costs, plus the engineering and support behind the agent and the site.",
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
