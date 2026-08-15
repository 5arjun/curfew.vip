"use client";

import { usePathname } from "next/navigation";
import { MeshDrift } from "./MeshDrift";

// The one mesh, tinted per marketing surface. Mounted at the (marketing)
// layout so the WebGL context survives client navigation between routes —
// the palette swap is a uniform update inside MeshDrift's effect, not a
// context teardown. Token names, not hex: the values live in tokens.css
// with the rest of the --landing-* block.
//
// Room assignment: / and /login run the glacial ramp (the login page is the
// landing's own front door — its CTAs land there); /features and /faq run
// the ultraviolet ramp (the catalogue and its reference sheet are one room).
const FEATURES_PALETTE = [
  "--landing-features-atmos",
  "--landing-features-deep",
  "--landing-features-accent",
  "--landing-features-floor",
];

export function MarketingMesh({ className }: { className?: string }) {
  const pathname = usePathname();
  return (
    <MeshDrift
      className={className}
      palette={
        pathname.startsWith("/features") || pathname.startsWith("/faq")
          ? FEATURES_PALETTE
          : undefined
      }
    />
  );
}
