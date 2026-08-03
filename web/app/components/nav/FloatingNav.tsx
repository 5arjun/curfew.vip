"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useRef, type MouseEvent } from "react";
import { House, TrendUp, VinylRecord, UserCircle, type Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: Icon;
};

// Story 3.5 Task 3.2: these four route slugs are this story's naming
// decision — Story 3.6, Epic 4's dashboard/style-evolution/library-utilization
// page stories, and Story 3.10's Profile/Settings page must land at these
// exact paths.
const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: House },
  { href: "/style-evolution", label: "Style Evolution", icon: TrendUp },
  { href: "/library-utilization", label: "Library Utilization", icon: VinylRecord },
  // Interim treatment (Task 3.6): UserCircle stands in for the real circular
  // photo avatar Story 3.10 (AC-1) ships once avatar-image infra exists —
  // that story swaps the icon, it does not restructure the nav.
  { href: "/settings", label: "Settings", icon: UserCircle },
];

export function isActiveNavItem(pathname: string, href: string): boolean {
  return pathname === href;
}

// Hover glow (Arjun's 21st.dev hover-glow-button reference, @easemize): a soft
// radial spotlight of aqua that FOLLOWS the cursor within the hovered item, in
// that component's cyan-on-void palette (Arjun prefers it to the brand rose
// here; the colour lives in --color-nav-glow-* so a flip back to rose is a
// token change). The gradient is small (52px) relative to the ~44px item so the
// bright core is a distinct blob that visibly tracks the pointer, not a wash
// that floods the whole cell uniformly — the earlier 120px radius was the
// "flat, doesn't track" bug Arjun caught.
//
// Why this is JS-driven (rAF lerp) and NOT the CSS-only approach the reference
// artifact uses: the artifact trails the cursor by transitioning registered
// @property <length-percentage> vars (--glow-x/y) in CSS. That works in a plain
// HTML page, but in THIS build (Next 16 + Tailwind v4 / Lightning CSS) runtime
// `element.style.setProperty()` on a *registered* @property custom property is
// silently ignored — the value stays pinned at the property's initial (50%), so
// the glow never leaves centre. (Verified in-browser: unregistered vars accept
// runtime values fine; the dock's keyframe-driven --nav-shine-angle is
// unaffected because it never goes through setProperty.) So we drive the glow
// with UNregistered --gx/--gy vars, which do reflect runtime writes, and get
// the follow-lag from a per-frame lerp in JS instead of a CSS property
// transition. Position is written straight to the element's style (no React
// state — a re-render per frame is pointless churn for a decorative layer); the
// glow fades in/out via group-hover opacity so entry/exit stays smooth.

// Per-frame catch-up fraction for the follow-lag: each frame the glow moves
// this share of the remaining distance to the cursor (~0.2 ≈ a 160ms settle at
// 60fps, matching the reference's transition beat). 1 = snap (reduced-motion).
const GLOW_EASE = 0.2;

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const ItemIcon = item.icon;

  // Glow follow-lag state (see handleGlowMove note above for why this is a JS
  // rAF lerp on unregistered --gx/--gy rather than a CSS @property transition).
  // Refs, not state: the loop mutates position ~60x/sec and must not re-render.
  const linkRef = useRef<HTMLAnchorElement>(null);
  const target = useRef({ x: 0, y: 0 }); // where the cursor is
  const pos = useRef({ x: 0, y: 0 }); // where the glow currently is (trails target)
  const raf = useRef<number | null>(null);
  const hovering = useRef(false);

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    },
    [],
  );

  function write(x: number, y: number) {
    const el = linkRef.current;
    if (!el) return;
    el.style.setProperty("--gx", `${x}px`);
    el.style.setProperty("--gy", `${y}px`);
  }

  function tick() {
    const ease = prefersReducedMotion() ? 1 : GLOW_EASE;
    const t = target.current;
    const p = pos.current;
    p.x += (t.x - p.x) * ease;
    p.y += (t.y - p.y) * ease;
    write(p.x, p.y);
    const settled = Math.abs(t.x - p.x) < 0.5 && Math.abs(t.y - p.y) < 0.5;
    if (hovering.current || !settled) {
      raf.current = requestAnimationFrame(tick);
    } else {
      write(t.x, t.y); // land exactly on target, then idle
      raf.current = null;
    }
  }

  function pointIn(event: MouseEvent<HTMLAnchorElement>) {
    const r = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - r.left, y: event.clientY - r.top };
  }

  function handleEnter(event: MouseEvent<HTMLAnchorElement>) {
    // Start the glow directly under the cursor (target === pos) so it lights up
    // in place rather than flying in from the item's centre on hover-in.
    const pt = pointIn(event);
    target.current = pt;
    pos.current = { ...pt };
    write(pt.x, pt.y);
    hovering.current = true;
    if (raf.current == null) raf.current = requestAnimationFrame(tick);
  }

  function handleMove(event: MouseEvent<HTMLAnchorElement>) {
    target.current = pointIn(event);
    if (raf.current == null) raf.current = requestAnimationFrame(tick);
  }

  function handleLeave() {
    // Stop tracking; the loop eases to a rest and cancels itself while the
    // glow's opacity fades out via group-hover.
    hovering.current = false;
  }

  return (
    <Link
      ref={linkRef}
      href={item.href}
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      className={cn(
        // Cell radius stays concentric with the dock's --radius-2xl outer
        // radius: inner = outer − the container's 2px padding.
        "floating-nav-link group relative flex min-h-11 min-w-11 shrink-0 items-center justify-center overflow-hidden rounded-[calc(var(--radius-2xl)-2px)] px-3 outline-none",
        // colour/scale transitions + the glow follow-lag live in globals.css
        // (.floating-nav-link) so one rule owns the transition list.
        "active:scale-[0.97] motion-reduce:active:scale-100",
        "focus-visible:shadow-[0_0_0_2px_var(--color-primary),0_0_0_6px_var(--color-primary-glow)]",
        // Active is a neutral raised chip (subtle white overlay), not the old
        // pink-glow fill — a filled pastel block read as a consumer default.
        // Only the chip background lives on the link. Icon COLOUR is set on the
        // <svg> itself (below), not here: globals.css ships an unlayered
        // `a { color: inherit }` reset, and unlayered rules beat Tailwind's
        // layered colour utilities, so any `text-*` on the <a> is dead — it'd
        // pin every icon to inherited white and the hover tint would never
        // fire. The <svg> escapes that reset, so its own utilities win.
        active
          ? "bg-[var(--color-nav-chip-active)]"
          : "hover:bg-[var(--color-nav-chip-hover)]",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity [transition-duration:var(--motion-duration-base)] [transition-timing-function:var(--motion-ease-standard)] group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(90px circle at var(--gx, 50%) var(--gy, 50%), var(--color-nav-glow-strong) 0%, var(--color-nav-glow-mid) 38%, var(--color-nav-glow-fade) 78%)",
        }}
      />
      {/* weight="bold" (was "regular") per Arjun's dock revision — a heavier
          stroke to match the dock references; active stays "fill" per AC-2. */}
      {/* Icon colour (idle / active / hover) is set in globals.css via the
          unlayered .floating-nav-link colour rules; the icon inherits it. See
          the note there for why the Tailwind text-* utility route doesn't win. */}
      <ItemIcon size={20} weight={active ? "fill" : "bold"} className="relative" />
      {/* Active-item label reveal: only the current route's label is shown,
          keeping the pill compact at every viewport (the prior all-labels
          layout overflowed phones — see Story 3.5 Task 4 notes). The 0fr→1fr
          grid-column transition animates the reveal without measuring text
          width. Hidden below sm entirely (icon-only mobile); aria-label above
          carries the accessible name in both cases. */}
      <span
        aria-hidden
        className={cn(
          "relative hidden sm:grid",
          "transition-[grid-template-columns] [transition-duration:var(--motion-duration-base)] [transition-timing-function:var(--motion-ease-out)]",
          "motion-reduce:transition-none",
          active ? "grid-cols-[1fr]" : "grid-cols-[0fr]",
        )}
      >
        <span className="overflow-hidden">
          <span
            className={cn(
              "block whitespace-nowrap pl-2 text-[13px] font-medium",
              "transition-opacity [transition-duration:var(--motion-duration-base)] [transition-timing-function:var(--motion-ease-out)]",
              active ? "opacity-100" : "opacity-0",
            )}
          >
            {item.label}
          </span>
        </span>
      </span>
    </Link>
  );
}

export function FloatingNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      // Dock revision (Arjun, 2026-08-01): squarer rounded-rect + opaque
      // surface + conic border shine, all carried by .floating-nav-dock in
      // globals.css (the backdrop-blur glass treatment went with the 90%-
      // alpha background — an opaque dock has nothing to blur).
      className="floating-nav-dock fixed bottom-6 left-1/2 z-50 flex w-max -translate-x-1/2 items-center gap-0.5 p-0.2"
    >
      {NAV_ITEMS.map((item, index) => (
        <Fragment key={item.href}>
          {/* Hairline divider between the three destinations and
              Profile/Settings — the dock reference's grouping, matching the
              IA where Settings is the avatar's own row, not a destination. */}
          {index === NAV_ITEMS.length - 1 && (
            <span aria-hidden className="bg-outline-variant mx-1 h-6 w-px shrink-0" />
          )}
          <NavLink item={item} active={isActiveNavItem(pathname, item.href)} />
        </Fragment>
      ))}
    </nav>
  );
}
