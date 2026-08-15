"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import {
  useMediaQuery,
  useMetalColors,
  usePrefersReducedMotion,
} from "@/app/components/ui/metal-hooks";

// The bar wears the liquid metal now (Arjun, 2026-08-14: "the nav bar at the
// top, lets give it that metallic look... the same pill animation style as the
// 'start your archive' button"). Same construction as FloatingNav's rail rim —
// shader ring under a dark glass plate inset 2px — and the rail's long-thin-
// surface params (repetition 1.5, distortion 0.2), not the button's, because a
// ~600px pill shows the same periodic-beads artefact the rail did. Speed runs
// the CTA's state machine minus the click burst: idle 0.35 → hover 1.0.
// Mounted only at sheet-free widths (≥761px), so a phone never pays the WebGL
// context — its pill keeps the plain glass. That makes this the landing's
// sixth context on desktop (mesh + ribbon + three CTAs + this) of the
// browser's ~16; the placement note in MetalButton.tsx records it.
const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false },
);

// The Landing's nav (Arjun, 2026-08-14). A floating glass pill, and one idea:
// the hero's wordmark is the nav's wordmark. On load the bar carries only its
// links; as the reader scrolls, the mark travels up out of the hero, the links
// slide over to make room, and it docks. There are never two wordmarks on
// screen — the hero's own is hidden the moment this component takes over, and
// the mark you watch travel is this one, standing exactly where the hero's was.
//
// How the travel is driven, and why it is built this way:
//
//   * The mark is measured, not animated by keyframes. On mount and on resize
//     the bar is forced to its docked width, the docked rect is read, and the
//     hero mark's rect is read alongside it. The difference is the whole
//     animation — a translate and a scale, interpolated by scroll. Nothing is
//     hardcoded, so the hero's clamp()'d size and the bar's own metrics can
//     both change without retuning anything here.
//   * The slot's WIDTH is what moves the links over, and it is driven by an
//     UNREGISTERED custom property updated from a rAF. A registered @property
//     would be the obvious choice and it does not work: Lightning CSS drops
//     setProperty on registered properties in this stack (Next 16 + Tailwind
//     v4). See ref-property-setproperty-bug.
//   * `--lp-dock` defaults to 1 in CSS, so with JS off — or before this mounts
//     — the bar renders in its final, docked state with the logo in place.
//     Nothing about the page's first paint depends on this file running.
//
// Under prefers-reduced-motion the travel does not happen at all: the mark is
// simply docked from the start and the hero keeps its own wordmark, which is
// the ordinary two-wordmark arrangement every other landing page has. UX-DR16
// is not in force here (D-2 exempts this page), but "still" has to mean still.

/** Scroll distance the travel is spread over, as a fraction of the viewport. */
const DOCK_FRACTION = 0.32;

type Travel = { dx: number; dy: number; scale: number };

export function LandingNav() {
  const headerRef = useRef<HTMLElement>(null);
  const markRef = useRef<HTMLAnchorElement>(null);
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(false);
  const reduced = usePrefersReducedMotion();
  const colors = useMetalColors();
  const metal = useMediaQuery("(min-width: 761px)");
  const panelId = useId();
  const pathname = usePathname();
  const speed = reduced ? 0 : hot ? 1 : 0.35;

  useEffect(() => {
    const header = headerRef.current;
    const mark = markRef.current;
    if (!header || !mark) return;

    // The hero's own wordmark is the start of the flight path. On a marketing
    // route without a hero there is simply nothing to fly from, and the bar
    // stays docked — which is already its default state. `pathname` is a
    // dependency because this component outlives client navigation (it is
    // mounted in the marketing layout): without it, leaving / for /faq or
    // /features kept the travel measured against a hero that no longer
    // existed, and the mark rendered flown-out over the new page's top.
    const hero = document.querySelector<HTMLElement>(".lp-wordmark");
    if (!hero || reduced) return;

    let travel: Travel | null = null;
    let dock = -1;
    let frame = 0;

    const apply = (next: number) => {
      if (next === dock) return;
      dock = next;
      header.style.setProperty("--lp-dock", next.toFixed(4));
      if (!travel) return;
      const away = 1 - next;
      mark.style.transform =
        `translate(${(travel.dx * away).toFixed(2)}px, ${(travel.dy * away).toFixed(2)}px)` +
        ` scale(${(1 + (travel.scale - 1) * away).toFixed(4)})`;
    };

    const read = () => {
      const distance = Math.max(1, window.innerHeight * DOCK_FRACTION);
      return Math.min(1, Math.max(0, window.scrollY / distance));
    };

    const measure = () => {
      // Measured at dock 0, NOT at dock 1, and the difference is a real bug
      // that showed up 46px wide: the pill is centre-aligned, so collapsing
      // the slot moves the mark's own untransformed position right by half
      // the slot's width. Both the mark's base and its target move with dock,
      // and both move linearly, so the two lerps cancel down to a single
      // offset measured against the collapsed state — at dock d the mark needs
      // exactly (1 - d) of it. Measuring against the docked state instead
      // leaves half a slot of error at the top of the page, where it is most
      // visible. The transform is cleared first or the rect includes it.
      mark.style.transform = "none";
      header.style.setProperty("--lp-dock", "0");
      const base = mark.getBoundingClientRect();
      const start = hero.getBoundingClientRect();
      travel =
        base.width > 0 && start.width > 0
          ? {
              dx: start.left - base.left,
              dy: start.top - base.top,
              scale: start.width / base.width,
            }
          : null;
      dock = -1;
      apply(read());
    };

    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(() => {
          frame = 0;
          apply(read());
        });
      }
    };

    measure();
    // data-travel is written to the DOM rather than held in state, and it is
    // deliberately absent from the JSX below: it says "this effect is live and
    // owns the mark", which is a fact about the DOM, not about a render. React
    // never manages the attribute, so no re-render can quietly clear it — and
    // its absence is exactly the no-JS case, where the hero keeps its own
    // wordmark because nothing is going to fly it anywhere.
    header.dataset.travel = "true";
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", measure);
      delete header.dataset.travel;
      header.style.removeProperty("--lp-dock");
      mark.style.transform = "";
    };
  }, [reduced, pathname]);

  // Escape closes the sheet, and so does growing back to a width that has no
  // sheet — otherwise the disclosure stays "open" invisibly and the next
  // narrow viewport inherits it. So does a tap anywhere else: a small menu over
  // a page you were reading should get out of the way when you reach past it,
  // and on a phone there is no Escape key to reach for.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // pointerdown, not click: the dismissal should begin the moment the finger
    // lands, not when it lifts. The header contains both the trigger and the
    // sheet, so one containment test covers "did they reach past the menu".
    const onPointerDown = (event: PointerEvent) => {
      const header = headerRef.current;
      if (header && !header.contains(event.target as Node)) setOpen(false);
    };
    const wide = window.matchMedia("(min-width: 761px)");
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const links = (
    <>
      <Link className="lp-nav-link" href="/features" onClick={() => setOpen(false)}>
        Features
      </Link>
      {/* A real link as of 2026-08-15 — the page it was waiting for exists. */}
      <Link className="lp-nav-link" href="/faq" onClick={() => setOpen(false)}>
        FAQ
      </Link>
    </>
  );

  return (
    <header className="lp-nav" ref={headerRef}>
      <nav
        className="lp-nav-bar"
        aria-label="Main"
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
      >
        {metal && colors && (
          <span aria-hidden className="lp-nav-rim">
            <LiquidMetal
              style={{ width: "100%", height: "100%" }}
              colorBack={colors.back}
              colorTint={colors.tint}
              speed={speed}
              repetition={1.5}
              softness={0.6}
              shiftRed={0.3}
              shiftBlue={0.3}
              distortion={0.2}
              contour={0}
              angle={45}
              scale={8}
              offsetX={0.1}
              offsetY={-0.1}
              shape="none"
            />
          </span>
        )}
        <span aria-hidden className="lp-nav-plate" />
        <span className="lp-nav-slot">
          {/* The mark is the way home (Arjun, 2026-08-15) — a link, not an
              emblem. It stays clickable mid-flight; the travel only moves it. */}
          <Link className="lp-nav-mark" ref={markRef} href="/" aria-label="Curfew — home">
            {/* The ink is a child because the mark is masked: a mask clips
                everything the element paints, focus ring included, so the
                ring lives on the link and the mask on this span. */}
            <span className="lp-nav-mark-ink" aria-hidden="true" />
          </Link>
        </span>

        <div className="lp-nav-links">{links}</div>

        <div className="lp-nav-actions">
          <Link className="lp-nav-link lp-nav-login" href="/login">
            Log in
          </Link>
          {/* Product first, paywall after: Join goes straight to the signup
              side of /login rather than to a plan comparison. The subscription
              story belongs on its own surface, after a DJ has seen one of
              their own nights come back. */}
          <Link className="lp-nav-join" href="/login?intent=join">
            Join
          </Link>
          <button
            type="button"
            className="lp-nav-menu"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? "Close menu" : "Open menu"}
            onClick={() => setOpen((value) => !value)}
          >
            <span className="lp-nav-menu-bar" />
            <span className="lp-nav-menu-bar" />
          </button>
        </div>
      </nav>

      {/* `inert` rather than `hidden`. Both take the panel out of the tab order
          and out of the accessibility tree, but `hidden` also removes its box —
          and a box that does not exist cannot animate away. The panel is laid
          out at all times now and hidden by state; landing.css has the path. */}
      <div
        className="lp-nav-sheet"
        id={panelId}
        data-open={open ? "true" : "false"}
        inert={!open}
      >
        {links}
        <Link className="lp-nav-link" href="/login" onClick={() => setOpen(false)}>
          Log in
        </Link>
      </div>
    </header>
  );
}
