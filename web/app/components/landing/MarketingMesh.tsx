"use client";

import { usePathname } from "next/navigation";
import { MeshDrift } from "./MeshDrift";

// The one mesh, tinted per marketing surface. Mounted at the (marketing)
// layout so the WebGL context survives client navigation between / and
// /features — the palette swap is a uniform update inside MeshDrift's effect,
// not a context teardown. Token names, not hex: the values live in tokens.css
// with the rest of the --landing-* block.
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
      palette={pathname.startsWith("/features") ? FEATURES_PALETTE : undefined}
    />
  );
}
