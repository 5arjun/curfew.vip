"use client";

import { useSyncExternalStore } from "react";

// Shared hooks for the liquid-metal surfaces (MetalButton, FloatingNav's rail
// rim). Extracted from MetalButton.tsx unchanged when the nav rail became the
// third sanctioned placement of the material (Arjun, 2026-08-03).

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}

/** Reads the cold-chrome material tokens from :root at runtime (see tokens.css). */
export function useMetalColors(): { back: string; tint: string } | null {
  const snapshot = useSyncExternalStore(
    () => () => {},
    () => {
      const cs = getComputedStyle(document.documentElement);
      return `${cs.getPropertyValue("--metal-abyss-back").trim()}|${cs.getPropertyValue("--metal-abyss-tint").trim()}`;
    },
    () => "|",
  );
  const [back, tint] = snapshot.split("|");
  return back && tint ? { back, tint } : null;
}
