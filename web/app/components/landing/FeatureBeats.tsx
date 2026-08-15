"use client";

import { BeatVideo, LandingActions, useInView } from "./Beats";
import { MarketingFooter } from "./MarketingFooter";

// /features (Arjun, 2026-08-14): the feature reference. Editorial rows — film
// on one side, name + claim + fact-list on the other, alternating — under a
// "Fully automatic" opener whose whole job is to say that Curfew reads Serato
// sessions and the library's own tags, so none of what follows costs the DJ
// any work. Same vocabulary as the landing beats (BeatVideo, lp-h2/lp-body,
// data-shown reveals), one register calmer: the landing is a film, this page
// is the catalogue.
//
// The fourth row has no film yet — Arjun is recording the library-utilization
// take. Until it exists the row runs BARE: full-width copy, facts in three
// columns, no media frame. Deliberately not a stand-in image: the only
// candidate (library.jpg) turned out to be a stray browser screenshot of an
// old landing build — visible URL bar, visible dock — committed as if it were
// a product still (2026-08-14; genre-key.jpg and style-evolution.jpg were the
// same capture, all three deleted). When the film lands, add { src, poster }
// to the entry below and the row becomes a normal one.

// "Reads Serato", not the mechanism behind it (Arjun, 2026-08-15: "I'm
// trying to avoid spilling to the user how we actually get this data") —
// the same rule holds across this page and the FAQ.
const CHIPS = [
  "Reads Serato",
  "Reads your tags",
  "No plugin",
  "No upload",
  "Nothing to maintain",
];

type Feature = {
  n: string;
  name: string;
  claim: string;
  facts: string[];
  film?: { src: string; poster: string };
};

// Value bullets, not spec bullets (Arjun, 2026-08-15: "list bullets that
// show the value in Curfew and what they can do with it", 4-5 per part).
// Every line is a built feature wearing its benefit: the dancefloor engine
// and its edit-and-learn loop, the genre share stream and Camelot wheel,
// the offline queue, the aging shelf and prep crate, time-to-first-play.
const FEATURES: Feature[] = [
  {
    n: "01",
    name: "The set",
    claim: "Every night comes back as it actually happened — not as you remember it.",
    facts: [
      "Every track in order, against the clock — the whole night on one screen",
      "The night’s arc: energy, keys and BPM as the hours move",
      "The dancefloor detection engine marks the stretch that mattered — drag to correct it, and it learns",
      "Stats measured on the real dancefloor, not the soundcheck",
      "Step back into any night, months later, exactly as you played it",
    ],
    film: { src: "/landing/set-detail-3.mp4", poster: "/landing/set-detail-3-poster.jpg" },
  },
  {
    n: "02",
    name: "Style evolution",
    claim: "What you played tonight, against every night before it.",
    facts: [
      "Watch your sound move month by month — genres, keys, tempo",
      "See your genre mix shift set by set, and when a new sound enters the rotation",
      "Your keys on a real Camelot wheel — where your harmonic comfort zone sits",
      "Catch the drift while it’s happening, not a year later",
    ],
    film: { src: "/landing/style-evolution.mp4", poster: "/landing/style-evolution-poster.jpg" },
  },
  {
    n: "03",
    name: "The archive",
    claim: "Every set files itself the night you play it.",
    facts: [
      "Curfew reads Serato when the set ends — no export, no ritual",
      "Your whole history in one place, newest night on top",
      "Jump to any set or track with one search",
      "No signal at the gig? The set is captured on the spot and syncs when you’re back",
      "A crashed laptop can’t take your history with it",
    ],
    film: { src: "/landing/dashboard-3.mp4", poster: "/landing/dashboard-3-poster.jpg" },
  },
  {
    n: "04",
    name: "The library",
    claim: "You keep buying music. Curfew shows you what never leaves the shelf.",
    facts: [
      "See what you own against what you actually play",
      "The records you bought and never reached for, surfaced",
      "Send forgotten records to a prep crate and give them a night out",
      "Know your workhorses — the tracks that earn a slot every set",
      "How long new music waits before its first play",
    ],
  },
];

export function FeatureHero() {
  const [ref, inView] = useInView<HTMLElement>(0.2);
  return (
    <header className="lp-feat-hero" ref={ref} data-shown={inView ? "true" : "false"}>
      <p className="lp-feat-eyebrow">Features</p>
      <h1 className="lp-feat-title">Fully automatic.</h1>
      <p className="lp-sub lp-feat-sub">
        Curfew reads Serato and your library&rsquo;s own tags. No plugin, no upload, no manual work
        — you play the way you already play, and the archive builds itself.
      </p>
      <ul className="lp-feat-chips" aria-label="How Curfew stays automatic">
        {CHIPS.map((chip) => (
          <li key={chip}>{chip}</li>
        ))}
      </ul>
    </header>
  );
}

function FeatureRow({ feature, flip }: { feature: Feature; flip: boolean }) {
  const [ref, inView] = useInView<HTMLElement>(0.25);
  return (
    <section
      className={feature.film ? "lp-feat-row" : "lp-feat-row lp-feat-row--bare"}
      ref={ref}
      data-shown={inView ? "true" : "false"}
      data-flip={flip ? "true" : "false"}
    >
      {feature.film && (
        <div className="lp-feat-media">
          <BeatVideo
            className="lp-feat-film"
            src={feature.film.src}
            poster={feature.film.poster}
          />
        </div>
      )}
      <div className="lp-feat-copy">
        <span className="lp-feat-n" aria-hidden="true">
          {feature.n}
        </span>
        <h2 className="lp-h2">{feature.name}</h2>
        <p className="lp-body">{feature.claim}</p>
        <ul className="lp-feat-facts">
          {feature.facts.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function FeatureRows() {
  return (
    <>
      {FEATURES.map((feature, i) => (
        <FeatureRow key={feature.n} feature={feature} flip={i % 2 === 1} />
      ))}
    </>
  );
}

export function FeatureClose() {
  const [ref, inView] = useInView<HTMLElement>(0.3);
  return (
    <section className="lp-feat-close" ref={ref} data-shown={inView ? "true" : "false"}>
      <h2 className="lp-feat-title">Your archive starts tonight.</h2>
      {/* No "See features" here — you are on it. */}
      <LandingActions className="lp-feat-close-actions" secondary={false} />
      <p className="lp-feat-price">$6.99/month, billed yearly</p>
      <MarketingFooter className="lp-feat-footer" />
    </section>
  );
}
