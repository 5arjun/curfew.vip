"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { House, TrendUp, VinylRecord, UserCircle, type Icon } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  useMediaQuery,
  useMetalColors,
  usePrefersReducedMotion,
} from "@/app/components/ui/metal-hooks";
import { CursorChip, useCursorChipTarget } from "@/app/components/ui/CursorChip";

// Desktop = the vertical liquid-metal rail on the left (Arjun, 2026-08-03:
// the bottom dock overlapped dashboard content); below it, the original
// bottom dock. 900.02px mirrors dashboard.css's 900px viewport-lock release
// so the rail and the dashboard's rail-clearance padding switch together.
const RAIL_QUERY = "(min-width: 900.02px)";

// The rail wears the same liquid-metal material as the hero arrow / Enter Set
// pill (Arjun's ask: "same border animation") — shader ring behind a dark
// plate inset 2px, the ref's exact shader params, state-reactive speed
// (idle 0.6 → hover 1.0). Third sanctioned placement of the WebGL material,
// alongside MetalButton's two; still never mapped over a list.
const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false },
);

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

function prefersReducedMotionNow() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function NavLink({
  item,
  active,
  onChip,
}: {
  item: NavItem;
  active: boolean;
  /** Rail label chip (item 4): report hover/focus so the nav can float the
      shared CursorChip with this item's label; `at` pins it for keyboard
      focus, where there's no cursor to follow. */
  onChip?: (label: string | null, at?: { x: number; y: number }) => void;
}) {
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
    const ease = prefersReducedMotionNow() ? 1 : GLOW_EASE;
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
    onChip?.(item.label);
  }

  function handleMove(event: MouseEvent<HTMLAnchorElement>) {
    target.current = pointIn(event);
    if (raf.current == null) raf.current = requestAnimationFrame(tick);
  }

  function handleLeave() {
    // Stop tracking; the loop eases to a rest and cancels itself while the
    // glow's opacity fades out via group-hover.
    hovering.current = false;
    onChip?.(null);
  }

  const focusChip = useRef(false);

  function handleFocus(event: FocusEvent<HTMLAnchorElement>) {
    // Keyboard parity for the label chip: no cursor to follow, so pin it off
    // the item's right edge (only for :focus-visible — a click focus already
    // has the hover chip up and would double-fire).
    if (!event.currentTarget.matches(":focus-visible")) return;
    const r = event.currentTarget.getBoundingClientRect();
    focusChip.current = true;
    onChip?.(item.label, { x: r.right, y: r.top + r.height / 2 });
  }

  function handleBlur() {
    // Only clear what focus showed — a click's blur must not kill the hover
    // chip that's legitimately up on the newly hovered item.
    if (!focusChip.current) return;
    focusChip.current = false;
    onChip?.(null);
  }

  return (
    <Link
      ref={linkRef}
      href={item.href}
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      className={cn(
        // Cell radius stays concentric with the dock's --radius-2xl outer
        // radius: inner = outer − the container's 2px padding. (No
        // overflow-hidden: the glow span clips itself via its own inherited
        // radius.)
        "floating-nav-link group relative flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-[calc(var(--radius-2xl)-2px)] px-3 outline-none",
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
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] opacity-0 transition-opacity [transition-duration:var(--motion-duration-base)] [transition-timing-function:var(--motion-ease-standard)] group-hover:opacity-100"
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
      {/* Active-item label reveal — the bottom DOCK's treatment (≥sm, <rail):
          only the current route's label is shown, keeping the pill compact at
          every viewport. The 0fr→1fr grid-column transition animates the
          reveal without measuring text width. The rail hides this entirely
          (labels become the hover tooltip below). */}
      <span
        aria-hidden
        className={cn(
          "nav-label-reveal relative hidden sm:grid",
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
  const rail = useMediaQuery(RAIL_QUERY);
  const reduced = usePrefersReducedMotion();
  const colors = useMetalColors();
  const [hovered, setHovered] = useState(false);

  // Rail labels ride the shared CursorChip (item 4 — the calendar day-chip
  // treatment, exactly): ONE chip follows the cursor across the rail, its body
  // crossfading between item labels. Cursor coords come from nav-level
  // mousemove (moves over items bubble here); NavLink's onChip sets which
  // label is up. Rail-only, like the shader — the dock keeps its inline
  // active-label reveal and never mounts the chip.
  const chipTargetRef = useCursorChipTarget();
  const [chipLabel, setChipLabel] = useState<string | null>(null);
  const handleChip = (label: string | null, at?: { x: number; y: number }) => {
    if (at) chipTargetRef.current = at;
    setChipLabel(label);
  };

  // MetalButton's speed state machine, minus the click burst (a nav rail has
  // no single "the" click): idle 0.35 → hover 1.0; frozen for reduced motion.
  const speed = reduced ? 0 : hovered ? 1 : 0.35;

  const destinations = NAV_ITEMS.slice(0, -1);
  const settings = NAV_ITEMS[NAV_ITEMS.length - 1];

  return (
    <nav
      aria-label="Primary"
      // Base classes are the bottom dock (kept below the rail breakpoint);
      // globals.css's rail block re-lays this exact element as the left rail.
      // Positioning (bottom-6 / left-1/2 / -translate-x-1/2) moved into
      // globals.css: Lightning CSS folds a rail-side `translate: none` into
      // the transform shorthand and DELETES it, so the utility's -50% could
      // never be cancelled — the dock's centering is scoped to the non-rail
      // media range instead (see the dock-positioning note there).
      className="floating-nav-dock fixed z-50 flex w-max items-center gap-0.5 p-0.2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onMouseMove={
        rail
          ? (e) => {
              chipTargetRef.current = { x: e.clientX, y: e.clientY };
            }
          : undefined
      }
    >
      {/* Liquid-metal rim (rail only): shader ring under a dark plate inset
          2px — the .mtl layer sandwich, flattened (no 3D press physics; the
          rail is a surface, not a button). Mounted only at rail widths so the
          dock never pays a WebGL context. */}
      {rail && colors && (
        <span aria-hidden className="nav-rail-rim">
          {/* Deviation from the reference params (which MetalButton keeps):
              the ref's repetition={4} distortion={0} was tuned for a ~46px
              button, and on this ~860px-tall rail its stripe cycles cross the
              thin rim as visibly periodic beads (Arjun: "looks so repeated").
              Fewer cycles + a little noise distortion + softer transitions
              make the highlights run as long, irregular streaks — natural
              metal — while shiftRed/Blue keep the chromatic identity.
              Picked live from a 6-variant sweep (metal-A..C3). */}
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
      <span aria-hidden className="nav-rail-plate" />

      {/* Brand (rail only): the CURFEW wordmark as a book-spine at the rail's
          top — masked and filled with the cold-chrome gradient so the metal
          IS the branding. Links home per convention. */}
      <Link href="/dashboard" aria-label="Curfew" className="nav-brand">
        <span aria-hidden className="nav-brand-mark" />
      </Link>

      <div className="nav-rail-items">
        {destinations.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={isActiveNavItem(pathname, item.href)}
            onChip={rail ? handleChip : undefined}
          />
        ))}
      </div>

      {/* Hairline divider between the three destinations and Profile/Settings
          — the dock reference's grouping, matching the IA where Settings is
          the avatar's own row, not a destination. */}
      <span aria-hidden className="nav-divider" />
      <NavLink
        item={settings}
        active={isActiveNavItem(pathname, settings.href)}
        onChip={rail ? handleChip : undefined}
      />

      {/* The label chip (rail only; single-line body, so a shallower rise than
          the calendar's default -72). Viewport-clamped — the rail hugs the
          left edge, so up-and-right always has room. */}
      {rail && (
        <CursorChip
          target={chipTargetRef}
          visible={chipLabel != null}
          contentKey={chipLabel}
          offsetY={-56}
        >
          {chipLabel && <p className="cursor-chip-title">{chipLabel}</p>}
        </CursorChip>
      )}
    </nav>
  );
}
