"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { usePrefersReducedMotion } from "@/app/components/ui/metal-hooks";

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
  const markRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const reduced = usePrefersReducedMotion();
  const panelId = useId();

  useEffect(() => {
    const header = headerRef.current;
    const mark = markRef.current;
    if (!header || !mark) return;

    // The hero's own wordmark is the start of the flight path. On a marketing
    // route without a hero there is simply nothing to fly from, and the bar
    // stays docked — which is already its default state.
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
  }, [reduced]);

  // Escape closes the sheet, and so does growing back to a width that has no
  // sheet — otherwise the disclosure stays "open" invisibly and the next
  // narrow viewport inherits it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const wide = window.matchMedia("(min-width: 761px)");
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const links = (
    <>
      <Link className="lp-nav-link" href="/#features" onClick={() => setOpen(false)}>
        Features
      </Link>
      {/* Not a link on purpose: the FAQ has not been written yet (Arjun,
          2026-08-14, "leave the faq not wired"). A nav item that navigates
          nowhere is worse than one that plainly does not navigate — this is a
          label until there is a page, at which point it becomes a <Link>. */}
      <span className="lp-nav-link lp-nav-link--pending">FAQ</span>
    </>
  );

  return (
    <header className="lp-nav" ref={headerRef}>
      <nav className="lp-nav-bar" aria-label="Main">
        <span className="lp-nav-slot">
          <span className="lp-nav-mark" ref={markRef} role="img" aria-label="Curfew" />
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

      <div className="lp-nav-sheet" id={panelId} data-open={open ? "true" : "false"} hidden={!open}>
        {links}
        <Link className="lp-nav-link" href="/login" onClick={() => setOpen(false)}>
          Log in
        </Link>
      </div>
    </header>
  );
}
