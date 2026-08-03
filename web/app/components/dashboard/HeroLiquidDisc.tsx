"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore, type CSSProperties } from "react";

// The hero's liquid-metal material element (Story 3.6 redesign, AC-14) — a large
// cold-chrome disc that reads as a premium after-hours artifact hanging over the
// night's arc. Purely decorative (aria-hidden), so it is the ONE bold, visible
// liquid-metal moment on the dashboard without stealing the keyboard path.
//
// WebGL-context-limited (~16/page, browser-enforced): this is a SINGLE context.
// It is never mapped across a list. Under prefers-reduced-motion the shader
// FREEZES (speed 0). Colour is the cool `--metal-cool-*` material (tokens.css);
// the shader's hex parser can't read a var(), so the two tokens are read from
// :root at runtime and handed over as hex — same technique as the shared
// LiquidMetalButton. A token-driven radial gradient (globals.css `.hero-disc`)
// shows until the shader mounts / where WebGL is unavailable, so it is never a
// bare circle.

const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false },
);

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

/** Reads the tokenized cold-chrome material from :root at runtime (tokens.css). */
function useCoolMetal(): { back: string; tint: string } | null {
  const snapshot = useSyncExternalStore(
    () => () => {},
    () => {
      const cs = getComputedStyle(document.documentElement);
      return `${cs.getPropertyValue("--metal-cool-back").trim()}|${cs.getPropertyValue("--metal-cool-tint").trim()}`;
    },
    () => "|",
  );
  const [back, tint] = snapshot.split("|");
  return back && tint ? { back, tint } : null;
}

export function HeroLiquidDisc({ className }: { className?: string }) {
  const reduced = usePrefersReducedMotion();
  const colors = useCoolMetal();

  return (
    <div className={["hero-disc", className].filter(Boolean).join(" ")} aria-hidden="true">
      <div className="hero-disc-shader">
        {colors && (
          <LiquidMetal
            style={{ width: "100%", height: "100%" } as CSSProperties}
            colorBack={colors.back}
            colorTint={colors.tint}
            speed={reduced ? 0 : 0.5}
            repetition={3}
            softness={0.3}
            shape="metaballs"
          />
        )}
      </div>
      <span className="hero-disc-rim" />
    </div>
  );
}
