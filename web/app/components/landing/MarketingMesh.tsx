"use client";

import { usePathname } from "next/navigation";
import { MeshDrift } from "./MeshDrift";

// The one mesh, tinted per marketing surface. Mounted at the (marketing)
// layout so the WebGL context survives client navigation between routes —
// the palette swap is a uniform update inside MeshDrift's effect, not a
// context teardown. Token names, not hex: the values live in tokens.css
// with the rest of the --landing-* block.
//
// Room assignment: / runs the glacial ramp; /features and /faq run the
// ultraviolet ramp (the catalogue and its reference sheet are one room);
// /login runs its own ember ramp (Arjun, 2026-08-15: "make the color of the
// orbs in the background different on this page") — the warm register the
// auth surfaces already own through the Ember buttons.
const FEATURES_PALETTE = [
  "--landing-features-atmos",
  "--landing-features-deep",
  "--landing-features-accent",
  "--landing-features-floor",
];

const AUTH_PALETTE = [
  "--landing-auth-atmos",
  "--landing-auth-deep",
  "--landing-auth-accent",
  "--landing-auth-floor",
];

export function MarketingMesh({ className }: { className?: string }) {
  const pathname = usePathname();
  const palette =
    pathname.startsWith("/features") || pathname.startsWith("/faq")
      ? FEATURES_PALETTE
      : pathname.startsWith("/login")
        ? AUTH_PALETTE
        : undefined;
  return <MeshDrift className={className} palette={palette} />;
}
