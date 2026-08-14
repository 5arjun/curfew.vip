"use client";

import { useEffect, useRef, useState } from "react";
import { useMediaQuery, usePrefersReducedMotion } from "@/app/components/ui/metal-hooks";
import { clockAt, nightDate } from "./arc-curve";

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

/**
 * Video that plays only while it is on screen. Under reduced motion it never
 * plays at all and the poster stands in — a looping product demo is exactly the
 * kind of thing that setting exists to stop.
 */
function BeatVideo({
  src,
  poster,
  className,
  active = true,
  shown,
}: {
  src: string;
  poster: string;
  className?: string;
  /** Stepper frames are all mounted; only the current one should be running. */
  active?: boolean;
  shown?: boolean;
}) {
  const [ref, inView] = useInView<HTMLVideoElement>(0.25);
  const reduced = usePrefersReducedMotion();
  // 7.5 MB of H.264 encoded at 1600px, to be displayed at ~348. Phones get the
  // poster; the beats read fine as stills and the bandwidth is indefensible.
  const narrow = useMediaQuery("(max-width: 639px)");
  const still = reduced || narrow;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (inView && active && !still) void node.play().catch(() => {});
    else node.pause();
  }, [inView, active, still, ref]);

  return (
    <video
      ref={ref}
      className={className}
      data-shown={shown === undefined ? undefined : shown ? "true" : "false"}
      src={still ? undefined : src}
      poster={poster}
      muted
      loop
      playsInline
      preload="metadata"
      aria-hidden="true"
    />
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
        src="/landing/set-detail.mp4"
        poster="/landing/set-detail-poster.jpg"
      />
      {/* A slate, not a label (Arjun, 2026-08-14: "'Set detail · 3h 17m · 44
          tracks' seems out of place"). It was naming the screen you are
          already looking at, in the product's own UI vocabulary, over footage
          whose whole job is to speak for itself. What replaces it says nothing
          about the software: it is the night's own date and hours — the same
          set the ribbon above was built from — stamped like the head of an
          archive reel. If it still reads as one thing too many, deleting it
          entirely is what the storyboard originally called for. */}
      <p className="lp-cover-tag">
        {nightDate()} · {clockAt(0)} → {clockAt(1)}
      </p>
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
          src="/landing/dashboard.mp4"
          poster="/landing/dashboard-poster.jpg"
        />
        <div className="lp-diptych-copy" ref={copy}>
          <h2 className="lp-h2">You don&rsquo;t do anything.</h2>
          <p className="lp-body">
            A small app on your machine reads Serato&rsquo;s own history the moment you close the
            laptop. No plugin, no upload, no ritual. Play the way you already play.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Beat 05 — the pinned capability stepper ──────────────────────────────── */
type StepMedia =
  | { type: "video"; src: string; poster: string }
  | { type: "image"; src: string };

type Step = { n: string; title: string; body: string; media: StepMedia };

const STEPS: Step[] = [
  {
    n: "01",
    title: "The night",
    body: "Every track, in order, against the clock. The set as it actually happened, not as you remember it.",
    media: {
      type: "video",
      src: "/landing/set-detail.mp4",
      poster: "/landing/set-detail-poster.jpg",
    },
  },
  {
    // Wants V3 (the segment editor drag) — the most important shot still
    // outstanding. Standing in with the dashboard film.
    n: "02",
    title: "The dancefloor",
    body: "Curfew guesses where the floor was. You drag the edges until it\u2019s right.",
    media: { type: "video", src: "/landing/dashboard.mp4", poster: "/landing/dashboard-poster.jpg" },
  },
  {
    n: "03",
    title: "The drift",
    body: "What you played this month against what you played last. Not better. Different \u2014 and now visible.",
    media: { type: "image", src: "/landing/style-evolution.jpg" },
  },
  {
    n: "04",
    title: "The library",
    body: "The records you own and never reach for, named.",
    media: { type: "image", src: "/landing/library.jpg" },
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
    <section className="lp-stepper" ref={section}>
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
        </div>
        <div className="lp-stepper-media">
          {STEPS.map((step, i) =>
            step.media.type === "video" ? (
              <BeatVideo
                key={step.n}
                className="lp-stepper-frame"
                src={step.media.src}
                poster={step.media.poster}
                active={i === active}
                shown={i === active}
              />
            ) : (
              <img
                key={step.n}
                className="lp-stepper-frame"
                src={step.media.src}
                alt=""
                data-shown={i === active ? "true" : "false"}
              />
            ),
          )}
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

/* ── Beat 07 — the details ────────────────────────────────────────────────── */
export function Triptych() {
  const [ref, inView] = useInView<HTMLElement>(0.25);
  return (
    <section className="lp-triptych" ref={ref} data-shown={inView ? "true" : "false"}>
      <img src="/landing/genre-key.jpg" alt="" className="lp-triptych-img" />
      <img src="/landing/style-evolution.jpg" alt="" className="lp-triptych-img" />
      <img src="/landing/library.jpg" alt="" className="lp-triptych-img" />
      <p className="lp-stamp lp-triptych-tag">The details are the point</p>
    </section>
  );
}

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
        <button type="button" className="lp-cta">
          Start your archive
        </button>
      </div>
      <footer className="lp-footer">
        <span>Curfew</span>
        <span>Privacy · Terms</span>
      </footer>
    </section>
  );
}
