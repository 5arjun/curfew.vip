"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { MetalButton } from "@/app/components/dashboard/MetalButton";
import { useMediaQuery, usePrefersReducedMotion } from "@/app/components/ui/metal-hooks";

// Beats 03-10 (Story 6.1). MOCKUP PASS, 2026-08-13: assembled from the assets
// that exist today so the whole page can be judged end to end. Everything here
// is real product footage or real product stills — nothing is a grey box — but
// three shots are still outstanding (V1 the arc draw, V3 the segment editor,
// V9 the agent tray) and the beats that want them are noted inline.

function useInView<T extends HTMLElement>(threshold = 0.35) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView] as const;
}

/**
 * "Has this element come within a screenful of the viewport yet?" — a latch,
 * not a state: it never goes back to false, because it gates the `src`
 * attribute and un-setting one mid-scroll would throw away the buffer.
 *
 * Separate from `useInView` on purpose. Playback wants "is it actually on
 * screen"; fetching wants "will it be, shortly", far enough ahead that the film
 * is decoding before the poster is even in frame. One observer cannot answer
 * both without a rootMargin that would start the films playing off-screen.
 */
function useApproaching(ref: React.RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNear(true);
      },
      { rootMargin: "100% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
}

/**
 * Copy that outruns the film beside it (Arjun, 2026-08-14). The film holds
 * still in the flow and the text travels bottom → top across the whole time the
 * section is on screen, so the two read as separate planes rather than one
 * pasted-together frame.
 *
 * Written straight to `style.transform` on a rAF, never through React state: a
 * component that re-renders on every scroll frame is the one reliable way to
 * make a page like this feel bad. Off under prefers-reduced-motion, and off
 * below the stacking breakpoint where the copy is no longer over the film at
 * all — parallax between two things in the same column is just drift.
 */
function useParallax<T extends HTMLElement>(
  section: React.RefObject<HTMLElement | null>,
  distance: number,
) {
  // The hook owns the ref rather than taking one: writing through a ref passed
  // in as an argument is a hook-argument mutation, which the React compiler
  // rejects — and rightly, since the caller could not know the hook was
  // driving that node's transform behind its back.
  const node = useRef<T>(null);
  const reduced = usePrefersReducedMotion();
  const layered = useMediaQuery("(min-width: 861px)");

  useEffect(() => {
    const still = reduced || !layered;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const host = section.current;
      if (!host || !node.current) return;
      if (still) {
        node.current.style.transform = "";
        return;
      }
      const rect = host.getBoundingClientRect();
      // 0 the instant the section's top clears the bottom of the viewport,
      // 1 as its bottom leaves the top — the full time it is visible.
      const span = rect.height + window.innerHeight;
      const p = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / span));
      node.current.style.transform = `translate3d(0, ${((0.5 - p) * 2 * distance).toFixed(1)}px, 0)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    // One pass to clear any transform left behind, then nothing: a reduced-
    // motion reader should not be paying for a scroll listener either.
    if (still) return;
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [reduced, layered, section, distance]);

  return node;
}

type ConnectionWithSaveData = Navigator & { connection?: { saveData?: boolean } };

/**
 * Every film ships twice. `foo.mp4` is 1600×900 at 60fps, ~3.4 MB; `foo-720.mp4`
 * is the same take at 720×405 and 30fps, ~660 KB — five times lighter, and
 * still twice the CSS pixels a phone displays it at. Derived rather than passed
 * so a beat cannot name one and forget the other; run
 * `scripts/encode-landing-film.sh <master>` to produce the companion.
 */
function phoneCut(src: string): string {
  return src.replace(/\.mp4$/, "-720.mp4");
}

/**
 * Video that plays only while it is on screen. Under reduced motion it never
 * plays at all and the poster stands in — a looping product demo is exactly the
 * kind of thing that setting exists to stop.
 *
 * PHONES PLAY THE FILM NOW (Arjun, 2026-08-14: "the videos do not play, they
 * just look like screenshots when i open the site on mobile"). They looked like
 * screenshots because they were: `narrow` fed the same flag as `reduced`, so a
 * phone was served the poster and no `src` at all. The reason given was
 * bandwidth — "7.5 MB of H.264 encoded at 1600px, to be displayed at ~348" —
 * and it was a fair objection to shipping the desktop master. It is not an
 * argument for a still. Three answers, in order:
 *
 *   1. a phone-sized encode (above), 660 KB rather than 3.4 MB;
 *   2. no `src` until the beat is within a screenful, so the three films are
 *      three separate small fetches spread across the scroll, never a burst at
 *      load — the hero and the ribbon get the connection to themselves;
 *   3. Save-Data still gets the poster, because a reader who has asked for less
 *      data has said something about their connection that a byte count cannot.
 */
function BeatVideo({
  src,
  poster,
  className,
  active = true,
  shown,
  start = 0,
}: {
  src: string;
  poster: string;
  className?: string;
  /** Stepper frames are all mounted; only the current one should be running. */
  active?: boolean;
  shown?: boolean;
  /** Where to enter the take, as a fraction of its duration. */
  start?: number;
}) {
  const [ref, inView] = useInView<HTMLVideoElement>(0.25);
  const near = useApproaching(ref);
  const reduced = usePrefersReducedMotion();
  const narrow = useMediaQuery("(max-width: 640px)");
  const saveData = useSyncExternalStore(
    () => () => {},
    () => (navigator as ConnectionWithSaveData).connection?.saveData === true,
    () => false,
  );
  const still = reduced || saveData;
  const file = narrow ? phoneCut(src) : src;

  // Enter the take partway in (Arjun, 2026-08-14: "for 01-02, start from
  // halfway through the video"). Seeking needs a duration, which is not known
  // at mount, so it waits on loadedmetadata — and it fires once per source
  // rather than on every loop, so the film still cycles the whole way round
  // after the first pass instead of jumping back to the midpoint forever.
  useEffect(() => {
    const node = ref.current;
    if (!node || !start || still) return;
    let done = false;
    const seek = () => {
      if (done || !Number.isFinite(node.duration) || node.duration === 0) return;
      done = true;
      node.currentTime = node.duration * start;
    };
    seek();
    node.addEventListener("loadedmetadata", seek);
    return () => node.removeEventListener("loadedmetadata", seek);
  }, [ref, start, still, file]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // play() rejects if the element has no source yet, which is the normal
    // state until the beat is approached — the catch is not incidental.
    if (inView && active && !still) void node.play().catch(() => {});
    else node.pause();
  }, [inView, active, still, ref]);

  return (
    <video
      ref={ref}
      className={className}
      data-shown={shown === undefined ? undefined : shown ? "true" : "false"}
      src={still || !near ? undefined : file}
      poster={poster}
      muted
      loop
      playsInline
      /* By the time a src exists at all the beat is one screenful away, so on a
         phone — where the file is 660 KB — buffer the whole thing and have it
         running before it is looked at. Not on desktop: that is the 3.4 MB
         master, and "auto" across four of them is 13 MB of eager download to
         save a stutter that streaming already covers. */
      preload={narrow ? "auto" : "metadata"}
      aria-hidden="true"
    />
  );
}

/**
 * The page's call to action, in the three places it now appears: the hero, the
 * pinned stepper, and the close. One component so the wording and the metal
 * never drift apart between them.
 *
 * The primary IS the dashboard's "Enter Set" pill (Arjun, 2026-08-14:
 * "reference the 'Enter Set' button on the dashboard and how that is
 * styled/animated"), not a copy of it — same <MetalButton mode="text">, so the
 * landing CTA and the in-product CTA share one shader, one speed state machine
 * (idle 0.35 → hover 1.0 → click burst 2.4) and one press physics. A CSS
 * imitation was the first attempt and it could not have the animation at all.
 * `.mtl-*` is global (globals.css @imports dashboard.css), so this costs no
 * new stylesheet; only the pill's size is overridden, through its own
 * --mtl-* custom properties.
 *
 * The secondary stays plain: an <a>, not a button, because it genuinely
 * navigates to beat 05 — so it works with JS off and keeps middle-click and
 * focus order. It is also what keeps the WebGL budget honest; see the
 * placement note in MetalButton.tsx.
 */
export function LandingActions({
  className,
  secondary = true,
}: {
  className?: string;
  secondary?: boolean;
}) {
  return (
    <div className={["lp-actions", className].filter(Boolean).join(" ")}>
      <MetalButton mode="text" label="Start your archive" className="lp-metal-cta" />
      {secondary && (
        <a className="lp-ghost-cta" href="#features">
          See features
        </a>
      )}
    </div>
  );
}

/* ── Beat 03 — the handoff ─────────────────────────────────────────────────
   The ribbon's last frame should mask-wipe into this. Waiting on V1 (the arc
   drawing itself in, camera-free); until then this is the V2 sweep, which
   carries its own auto-zoom and so cannot yet be scrubbed against scroll. */
export function CoverMedia() {
  const [ref, inView] = useInView<HTMLElement>(0.2);
  return (
    <section className="lp-cover" ref={ref} data-shown={inView ? "true" : "false"}>
      <BeatVideo
        className="lp-cover-media"
        src="/landing/set-detail-3.mp4"
        poster="/landing/set-detail-3-poster.jpg"
      />
      {/* An invitation, not a slate (Arjun, 2026-08-14). This position has now
          held three things: the product's own UI vocabulary ("Set detail · 3h
          17m · 44 tracks"), then the night's date and hours stamped like an
          archive reel. Both described the footage. Two words that ask the
          reader forward do more over a shot that already speaks for itself.
          It carries its own ground — the same scrim + backdrop-blur treatment
          beat 04's copy uses — because a phrase this size has to survive
          whatever frame the film happens to be on. */}
      <p className="lp-cover-tag">See everything</p>
    </section>
  );
}

/* ── Beat 04 — capture ──────────────────────────────────────────────────────
   NOT a diptych any more (Arjun, 2026-08-13). The left panel was the
   AI-generated booth photograph, and dropping it costs nothing: the beat's
   claim is "the machine does the work," which the film says on its own and the
   photograph never said. One large film, the copy layered over its left edge —
   the class name stays so the beat keeps its number. */
export function Diptych() {
  const [ref, inView] = useInView<HTMLElement>(0.3);
  const copy = useParallax<HTMLDivElement>(ref, 150);
  return (
    <section className="lp-diptych" ref={ref} data-shown={inView ? "true" : "false"}>
      <div className="lp-diptych-stage">
        {/* Wants V9 (the agent tray catching a set). Standing in with the
            dashboard film until that shot exists. */}
        <BeatVideo
          className="lp-diptych-film"
          src="/landing/dashboard-3.mp4"
          poster="/landing/dashboard-3-poster.jpg"
        />
        <div className="lp-diptych-copy" ref={copy}>
          <h2 className="lp-h2">You don&rsquo;t do anything.</h2>
          <p className="lp-body">
            Curfew reads Serato the moment you finish the set. No plugin, no upload, no ritual.
            Play the way you already play.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Beat 05 — the pinned capability stepper ──────────────────────────────── */
// TWO FILMS ACROSS FOUR STEPS (Arjun, 2026-08-14). The media is keyed off the
// step rather than owned by it, because a step that owns its own <video> is a
// step that remounts the element every time the index changes — and a remount
// restarts playback at frame 0. Steps 01→02 are one continuous take of set
// detail and 03→04 one of style evolution, so each film keeps running
// underneath while the copy changes against scroll.
type Film = { src: string; poster: string; start?: number };

const FILMS: Film[] = [
  // 01-02 — the set-detail screen, recorded 2026-08-14. This also retires the
  // V3 (segment-editor drag) placeholder: step 02 now shows the real thing.
  // Entered at the midpoint, where the take is already inside the tracklist
  // rather than still settling onto the screen (Arjun, 2026-08-14). Beat 03
  // plays the SAME file from its head, so the two are not redundant.
  { src: "/landing/set-detail-3.mp4", poster: "/landing/set-detail-3-poster.jpg", start: 0.5 },
  // 03-04 — style evolution, recorded 2026-08-14. NOTE: this take never leaves
  // the Style Evolution screen, so step 04 ("The library") plays footage of a
  // different feature. Flagged to Arjun; `library.jpg` is still in
  // public/landing if step 04 should go back to its own still.
  { src: "/landing/style-evolution.mp4", poster: "/landing/style-evolution-poster.jpg" },
];

type Step = { n: string; title: string; body: string; film: number };

const STEPS: Step[] = [
  {
    n: "01",
    title: "The night",
    body: "Every track, in order, against the clock. The set as it actually happened, not as you remember it.",
    film: 0,
  },
  {
    n: "02",
    title: "The dancefloor",
    body: "Curfew\u2019s dancefloor detection engine estimates when your real dancefloor is. You can edit and the engine will learn.",
    film: 0,
  },
  {
    n: "03",
    title: "The drift",
    body: "What you played tonight versus your sets in the past. Learn to evolve as a DJ.",
    film: 1,
  },
  {
    n: "04",
    title: "The library",
    // "The records you own and never reach for, named." replaced (Arjun,
    // 2026-08-14, "I’m not the biggest fan"). What was wrong with it: it
    // described a data structure — a named list — when what the feature
    // actually trades on is money already spent. The replacement keeps the
    // page's shape: second person, a flat statement, then the turn.
    body: "You keep buying music. Curfew shows you what never leaves the shelf.",
    film: 1,
  },
];

export function Stepper() {
  const section = useRef<HTMLElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const node = section.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / travel));
      const next = Math.min(STEPS.length - 1, Math.floor(p * STEPS.length));
      setActive((current) => (current === next ? current : next));
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
    // The hero's "See features" anchor lands here — the stepper IS the feature
    // tour, so the link goes to the thing rather than to a list about it.
    <section className="lp-stepper" id="features" ref={section}>
      <div className="lp-stepper-sticky">
        <div className="lp-stepper-copy">
          <span className="lp-stepper-n">{STEPS[active].n}</span>
          <h2 className="lp-h2">{STEPS[active].title}</h2>
          <p className="lp-body">{STEPS[active].body}</p>
          <ol className="lp-stepper-dots" aria-hidden="true">
            {STEPS.map((step, i) => (
              <li key={step.n} data-active={i === active ? "true" : "false"} />
            ))}
          </ol>
          {/* The second of three placements (Arjun, 2026-08-14). The stepper is
              where the page finishes making its case, and it is pinned for four
              screenfuls — the longest stretch on the page with nowhere to act.
              No "See features" here: you are standing in them. */}
          <LandingActions className="lp-stepper-actions" secondary={false} />
        </div>
        <div className="lp-stepper-media">
          {/* Keyed by film, not by step: crossing 01→02 leaves the same element
              mounted and playing, so only 02→03 is an actual cut. */}
          {FILMS.map((film, i) => (
            <BeatVideo
              key={film.src}
              className="lp-stepper-frame"
              src={film.src}
              poster={film.poster}
              start={film.start}
              active={STEPS[active].film === i}
              shown={STEPS[active].film === i}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Beat 06 — CUT (Arjun, 2026-08-14) ────────────────────────────────────────
   "Never best. Never ranked. Never against another DJ. / Only against you, last
   month." is gone from the page at Arjun's call. Recorded here rather than
   silently deleted because it was not decoration: it is a PRD constraint, and
   §3 beat 06 argued it was the most differentiating sentence the page had. The
   page now states the no-comparison principle nowhere. If it should come back,
   it is one component in git history — and beat 05's step 03 copy ("Not
   better. Different") is the only surviving trace of the idea. */

/* ── Beat 07 — CUT (Arjun, 2026-08-14) ────────────────────────────────────────
   The three-still panel ("The details are the point") is gone: it showed three
   screens the stepper had just shown as film, under a caption that asserted
   what the beat above had already demonstrated. The page now runs steps →
   close. Its three stills (genre-key.jpg, style-evolution.jpg, library.jpg)
   are still in public/landing and unreferenced — left there deliberately,
   since step 04's film is the open question. */

/* ── Beat 10 — close ──────────────────────────────────────────────────────── */
export function Closing() {
  const [ref, inView] = useInView<HTMLElement>(0.3);
  return (
    <section className="lp-closing" ref={ref} data-shown={inView ? "true" : "false"}>
      {/* Wants P7 — the empty room, house lights up. The page's thesis image,
          and the one frame that has to be a real photograph. */}
      <div className="lp-closing-inner">
        {/* The mark, not the word (Arjun, 2026-08-14) — the same wordmark the
            hero opens on, so the page closes on the thing it opened with. */}
        <h2 className="lp-closing-title">
          <span className="lp-wordmark lp-wordmark--closing" role="img" aria-label="Curfew" />
        </h2>
        <p className="lp-closing-price">
          $6<span>/month</span>
        </p>
        <p className="lp-body lp-closing-body">One plan. Cancel whenever.</p>
        <LandingActions className="lp-closing-actions" secondary={false} />
      </div>
      <footer className="lp-footer">
        <span>Curfew</span>
        <span>Privacy · Terms</span>
      </footer>
    </section>
  );
}
