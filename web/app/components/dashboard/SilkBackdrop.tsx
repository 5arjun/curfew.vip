"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

// Silk page background (D2) — React Bits `Silk` (app/components/Silk.jsx,
// verbatim from the registry), mounted full-bleed behind the dashboard with
// Arjun's exact sample props (speed 5, scale 1, noiseIntensity 0.3,
// rotation 0.4) and the Abyss silk tint (D11) in place of the sample mauve.
//
// The shader parses a hex string, not a CSS var(), so the tint is read from
// :root at runtime — same pattern as the liquid-metal materials. WebGL can't
// SSR, hence dynamic(ssr: false); .dz-silk paints the base token until the
// canvas is up. prefers-reduced-motion freezes the silk (speed 0): the
// pattern still renders, it just stops flowing.
const Silk = dynamic(() => import("@/app/components/Silk.jsx"), { ssr: false });

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/** Reads the Abyss silk tint token from :root at runtime (see tokens.css). */
function useSilkColor(): string | null {
  const color = useSyncExternalStore(
    () => () => {},
    () => getComputedStyle(document.documentElement).getPropertyValue("--color-abyss-silk").trim(),
    () => "",
  );
  return color || null;
}

export function SilkBackdrop() {
  const reduced = usePrefersReducedMotion();
  const color = useSilkColor();

  return (
    <div className="dz-silk" aria-hidden="true">
      {color && (
        <Silk speed={reduced ? 0 : 5} scale={1} color={color} noiseIntensity={0.3} rotation={0.4} />
      )}
    </div>
  );
}
