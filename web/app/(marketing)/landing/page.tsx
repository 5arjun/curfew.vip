"use client";

import { useEffect, useRef, useState } from "react";
import { ArcRibbon } from "@/app/components/landing/ArcRibbon";
import { Closing, CoverMedia, Diptych, Stepper, Triptych } from "@/app/components/landing/Beats";
import { arc } from "@/app/components/landing/arc-curve";

// Landing beats 00-02 (Story 6.1). The remaining beats (03-10) are storyboarded
// in _bmad-output/implementation-artifacts/6-1-landing-page-design.md and land
// as the captures arrive; this route exists so the ribbon can be built and
// judged against real scroll before the rest of the page is committed.
//
// Lives at /landing rather than / while it is being built, so the Story 1.1
// scaffold page at app/page.tsx keeps working until this replaces it.

// Two statements, not three (Arjun, 2026-08-14). "This is one night. Yours."
// was the third and it is gone: with the stage shortened there is no room for a
// line that restates what the ribbon is already showing, and holding a reader
// on two sentences for 300vh is what made the beat feel slow. The two that
// remain are the argument — a set has a shape, and you have never seen yours.
const STAGES = [
  { at: 0.0, lines: ["Every set has a shape."] },
  { at: 0.46, lines: ["You have never seen yours."] },
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
              Curfew reads the sets you already played and gives you the only baseline that means
              anything - your own.
            </p>
            <p className="lp-cue">
              <span>Scroll</span>
              <span className="lp-cue-line" />
            </p>
          </div>

          <div className="lp-captions">
            {STAGES.map((s, i) => (
              <p key={s.at} className="lp-caption" data-shown={active === i ? "true" : "false"}>
                {s.lines.map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </p>
            ))}
          </div>

          <p className="lp-provenance" data-shown={active >= 1 ? "true" : "false"}>
            {arc.summary.trackCount} tracks · {arc.summary.bpmMin.toFixed(0)}–
            {arc.summary.bpmMax.toFixed(0)} BPM · dancefloor {arc.dancefloor.firstPosition}–
            {arc.dancefloor.lastPosition}
          </p>
        </div>
      </section>

      <CoverMedia />
      <Diptych />
      <Stepper />
      <Triptych />
      <Closing />
    </main>
  );
}
