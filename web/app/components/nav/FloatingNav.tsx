"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, type MouseEvent } from "react";
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

// Hover glow (Arjun's 21st.dev hover-glow-button reference, @easemize):
// a large radial wash of aqua that floods the item from the cursor position —
// the reference's "lamp lighting the surface" effect, in that component's
// cyan-on-void palette (Arjun prefers it to the brand rose here; the colour
// lives in --color-nav-glow-* so a flip back to rose is one token). The first
// implementation's mistake was scale, not concept: a 36px dot at 20% alpha
// read as a gimmicky glint; the reference uses a gradient roughly the size
// of the whole control at meaningful intensity. Cursor position is written
// to CSS vars directly on the element (no React state — a re-render per
// mousemove is pointless churn for a purely decorative layer), and the
// glow fades in/out via group-hover opacity so entry/exit stays smooth.
// The glow trails the cursor on a slight delay: --glow-x/y are registered as
// interpolable <length-percentage> properties and transitioned in globals.css
// (.floating-nav-link), so each mousemove update eases into place rather than
// snapping — the follow-lag Arjun asked for, done in CSS not JS.
function handleGlowMove(event: MouseEvent<HTMLAnchorElement>) {
  const el = event.currentTarget;
  const rect = el.getBoundingClientRect();
  el.style.setProperty("--glow-x", `${event.clientX - rect.left}px`);
  el.style.setProperty("--glow-y", `${event.clientY - rect.top}px`);
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const ItemIcon = item.icon;

  return (
    <Link
      href={item.href}
      onMouseMove={handleGlowMove}
      aria-current={active ? "page" : undefined}
      aria-label={item.label}
      className={cn(
        // Cell radius stays concentric with the dock's --radius-2xl outer
        // radius: inner = outer − the container's 6px padding.
        "floating-nav-link group relative flex min-h-11 min-w-11 shrink-0 items-center justify-center overflow-hidden rounded-[calc(var(--radius-2xl)-6px)] px-3 outline-none",
        // colour/scale transitions + the glow follow-lag live in globals.css
        // (.floating-nav-link) so one rule owns the transition list.
        "active:scale-[0.97] motion-reduce:active:scale-100",
        "focus-visible:shadow-[0_0_0_2px_var(--color-primary),0_0_0_6px_var(--color-primary-glow)]",
        // Active is a neutral raised chip (subtle white overlay), not the old
        // pink-glow fill — a filled pastel block read as a consumer default.
        // The active icon reads white too (Arjun): selection is carried by the
        // fill-weight glyph + the label reveal, not a pink tint.
        active
          ? "bg-[var(--color-nav-chip-active)] text-on-surface"
          : "text-outline hover:bg-[var(--color-nav-chip-hover)] hover:text-[var(--color-nav-hover-text)]",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity [transition-duration:var(--motion-duration-base)] [transition-timing-function:var(--motion-ease-standard)] group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(120px circle at var(--glow-x, 50%) var(--glow-y, 50%), var(--color-nav-glow-strong), var(--color-nav-glow-fade) 70%)",
        }}
      />
      {/* weight="bold" (was "regular") per Arjun's dock revision — a heavier
          stroke to match the dock references; active stays "fill" per AC-2. */}
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
      className="floating-nav-dock fixed bottom-6 left-1/2 z-50 flex w-max -translate-x-1/2 items-center gap-1 p-1.5"
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
