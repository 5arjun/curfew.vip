"use client";

import { useEffect, useRef, useState } from "react";
import { ArcRibbon } from "@/app/components/landing/ArcRibbon";
import {
  Closing,
  CoverMedia,
  Diptych,
  LandingActions,
  Stepper,
} from "@/app/components/landing/Beats";

// Landing beats 00-02 (Story 6.1). The remaining beats (03-10) are storyboarded
// in _bmad-output/implementation-artifacts/6-1-landing-page-design.md and land
// as the captures arrive; this route exists so the ribbon can be built and
// judged against real scroll before the rest of the page is committed.
//
// PROMOTED TO `/` (Arjun, 2026-08-14), ahead of pointing curfew.vip at this
// project — a domain whose front door is a scaffold page is not wired up. The
// Story 1.1 scaffold that used to hold this route (app/page.tsx) is deleted:
// its job was to prove web/ consumes @curfew/shared through a real import, and
// lib/sets/{types,libraryConversion,libraryRoster}.ts each do that now against
// production code paths, so the proof outlived the proof-of-concept.

// Two statements, not three (Arjun, 2026-08-14). "This is one night. Yours."
// was the third and it is gone: with the stage shortened there is no room for a
// line that restates what the ribbon is already showing, and holding a reader
// on two sentences for 300vh is what made the beat feel slow. The two that
// remain are the argument — a set has a shape, and you have never seen yours.
//
// The turn is pinned to the bead, not to a taste number (Arjun, 2026-08-14:
// "stay until the orb on the ribbon reaches the middle, then switch"). Both
// renderers walk the bead on `(p - 0.3) / 0.62` (ArcRibbon.tsx layoutFromSvg,
// ArcRibbonCanvas.tsx), so walk = 0.5 — the midpoint of the night — falls at
// p = 0.3 + 0.62/2 = 0.61. If that walk window is ever retuned, this number
// moves with it; it is the same constant read from the other end.
const STAGES = [
  { at: 0.0, lines: ["Every set has a shape."] },
  { at: 0.61, lines: ["You have never seen yours."] },
];

function useStage(section: React.RefObject<HTMLElement | null>) {
  const [stage, setStage] = useState(-1);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const node = section.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / travel));
      // The exit dissolve. Without it the stage releases mid-composition — the
      // genre strip, half a tracklist and two axis labels scrolling off as
      // stranded furniture — and the next beat opens against that debris. The
      // last stretch of travel fades the whole sticky layer to nothing, so the
      // beat ends on a held breath of the mesh instead of a chop. Scroll-linked
      // (an UNREGISTERED property, per ref-property-setproperty-bug), so there
      // is no transition to lag behind the wheel.
      // Finishes at 0.96, not right at release: the cover beat now rises into
      // the stage's last screenful (its negative margin, landing.css), and the
      // frame should be arriving over a ghost, not over a still-lit scene.
      const exit = Math.min(1, Math.max(0, (p - 0.86) / 0.1));
      node.style.setProperty("--lp-stage-fade", (1 - exit * exit * (3 - 2 * exit)).toFixed(4));
      // The vinyl turns 1:1 with the wheel — degrees per pixel, not per unit of
      // stage progress, so the platter feels geared to the hand and the rate
      // survives any retiming of the stage's height. It outlives the hero's
      // 0.14 gate on purpose: the rail blinks off there, but a disc dying at
      // the first wheel-click would read as broken, so it spins on while it
      // dissolves, gone before the ribbon owns the frame. (Unregistered vars,
      // per ref-property-setproperty-bug.)
      node.style.setProperty("--lp-vinyl-spin", `${(p * travel * 0.4).toFixed(2)}deg`);
      const rest = Math.min(1, Math.max(0, (p - 0.14) / 0.2));
      node.style.setProperty("--lp-vinyl-fade", (1 - rest * rest * (3 - 2 * rest)).toFixed(4));
      let next = -1;
      // The hero holds the stage to itself until the ribbon starts inflating.
      if (p > 0.14) {
        next = 0;
        for (let i = 0; i < STAGES.length; i += 1) if (p >= STAGES[i].at) next = i;
      }
      setStage((current) => (current === next ? current : next));
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
  }, [section]);
  return stage;
}

// The decks Curfew can read, stated in the hero rather than discovered three
// beats later (Arjun, 2026-08-15: the Serato-only fact was buried in beat 04's
// body copy, and a Rekordbox DJ had no way to know they were being told to
// wait, not told no). Serato and Rekordbox are the real wordmarks
// (public/brand/*.svg, masked like the Curfew mark); Traktor has no public
// vector, so it is set typographically — uppercase Inter at logo weight — until
// a real mark replaces it.
const PLATFORMS = [
  { id: "serato", name: "Serato", live: true },
  { id: "rekordbox", name: "Rekordbox", live: false },
  { id: "traktor", name: "Traktor", live: false },
] as const;

function SupportRail({ shown }: { shown: boolean }) {
  return (
    <aside
      className="lp-support"
      data-shown={shown ? "true" : "false"}
      aria-label="DJ software Curfew works with"
    >
      <p className="lp-support-head">Works with</p>
      <ul className="lp-support-list">
        {PLATFORMS.map((platform) => (
          <li key={platform.id} className="lp-support-row" data-live={platform.live}>
            {platform.id === "traktor" ? (
              <span className="lp-support-logo lp-support-logo--traktor">Traktor</span>
            ) : (
              <span
                className={`lp-support-logo lp-support-logo--${platform.id}`}
                role="img"
                aria-label={platform.name}
              />
            )}
            <span className="lp-support-status">
              <span className="lp-support-dot" aria-hidden="true" />
              {platform.live ? "Supported" : "Coming soon"}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/** Word-by-word rise. The split is per word, not per character — at display
 *  sizes a character split reads as an effect, a word split reads as writing. */
function Split({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <>
      {text.split(" ").map((word, i) => (
        <span className="lp-word" key={`${word}-${i}`}>
          <span className="lp-word-inner" style={{ animationDelay: `${delay + i * 60}ms` }}>
            {word}
          </span>
        </span>
      ))}
    </>
  );
}

export default function LandingPage() {
  const stage = useRef<HTMLElement>(null);
  const active = useStage(stage);

  return (
    <main className="lp-main">
      <section className="lp-stage" ref={stage}>
        <div className="lp-stage-sticky">
          <ArcRibbon section={stage} />

          {/* The platter: half a record hanging off the right edge of the
              opening frame, the works-with rail's backdrop. Decorative — the
              rail carries the information, this carries the room — so it is
              hidden from AT and takes no pointer. Spin and exit are scroll-
              linked vars written by useStage. Two elements because the mask
              that dissolves the disc into the scene must hold still in screen
              space while the disc turns inside it: the outer frame carries
              mask/filter/fade, the inner carries the image and the rotation. */}
          <div className="lp-vinyl" aria-hidden="true">
            <div className="lp-vinyl-disc" />
          </div>

          <div className="lp-hero" data-shown={active < 0 ? "true" : "false"}>
            {/* The wordmark, not the word: same PNG-as-mask treatment the nav
                rail uses, so the brand reads identically on both sides of the
                login. The accessible name lives on the element. */}
            <p className="lp-eyebrow">
              <span className="lp-wordmark" role="img" aria-label="Curfew" />
            </p>
            <h1 className="lp-headline">
              <span className="lp-headline-quote">
                <Split text="It went well." />
              </span>
              <em className="lp-headline-turn">
                <Split text="Compared to what?" delay={420} />
              </em>
            </h1>
            <p className="lp-sub">
              Curfew reads the sets you play and gives you the only baseline that means
              anything - your own.
            </p>
            {/* The page's only CTA used to be 3,000px down, at the close
                (Arjun, 2026-08-14). A reader who is already sold has nowhere to
                act until they have scrolled the whole film. The secondary is a
                link because it genuinely navigates — to /features, the full
                feature reference — so it works without JS and takes focus and
                middle-click like a link should. */}
            <LandingActions className="lp-hero-actions" />
            <p className="lp-cue">
              <span>Scroll</span>
              <span className="lp-cue-line" />
            </p>
          </div>

          {/* A sibling of the hero, not a child: the hero's box is capped at
              62rem and left-anchored, and this belongs on the viewport's right
              gutter — the empty half of the opening frame. It fades on the
              hero's own gate so the two leave together. */}
          <SupportRail shown={active < 0} />

          <div className="lp-captions">
            {STAGES.map((s, i) => (
              <p key={s.at} className="lp-caption" data-shown={active === i ? "true" : "false"}>
                {s.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </p>
            ))}
          </div>
          {/* The provenance strip ("44 tracks · 99–130 BPM · dancefloor 11–38")
              is CUT (Arjun, 2026-08-14). It was a third text layer competing
              with the caption and the tracklist for the same moment, and it
              stated in numbers what the shape above it was already showing.
              The tracklist column still carries the night's count and span. */}
        </div>
      </section>

      <CoverMedia />
      <Diptych />
      <Stepper />
      <Closing />
    </main>
  );
}
