"use client";

import { usePathname } from "next/navigation";
import { MeshDrift } from "./MeshDrift";
import { AUTH_PALETTE } from "./MarketingMesh";

// The onboarding corridor's mesh, tinted per step (Arjun, 2026-08-15: "make
// the background of the welcome and link-agent different colors"). Same
// pattern as MarketingMesh — one MeshDrift, palette swapped by pathname as
// a uniform update, no canvas remount between corridor steps.
//
// Room assignment tells the corridor's own story: /subscribe and
// /phone-required keep the ember the DJ just signed in under (they are the
// two form-ish steps, and /subscribe is now the first thing after the login
// card — the room should not change under it); /welcome warms to spark-gold
// (almost there); /link-agent runs the glacial default — the landing's own
// ramp, the color of the product the agent is about to fill.
//
// /subscribe therefore needs no branch of its own: it takes AUTH_PALETTE via
// the same fallback /phone-required does. Named here anyway, because "the
// list doesn't mention it" and "it falls through on purpose" look identical
// in this file and only one of them is true.
const WELCOME_PALETTE = [
  "--landing-welcome-atmos",
  "--landing-welcome-deep",
  "--landing-welcome-accent",
  "--landing-welcome-floor",
];

export function OnboardingMesh({ className }: { className?: string }) {
  const pathname = usePathname();
  const palette = pathname.startsWith("/welcome")
    ? WELCOME_PALETTE
    : pathname.startsWith("/link-agent")
      ? undefined
      : AUTH_PALETTE;
  return <MeshDrift className={className} palette={palette} />;
}
