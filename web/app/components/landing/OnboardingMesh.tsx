"use client";

import { usePathname } from "next/navigation";
import { MeshDrift } from "./MeshDrift";
import { AUTH_PALETTE } from "./MarketingMesh";

// The onboarding corridor's mesh, tinted per step (Arjun, 2026-08-15: "make
// the background of the welcome and link-agent different colors"). Same
// pattern as MarketingMesh — one MeshDrift, palette swapped by pathname as
// a uniform update, no canvas remount between corridor steps.
//
// Room assignment tells the corridor's own story: /phone-required keeps the
// ember the DJ just signed in under; /welcome warms to spark-gold (almost
// there); /link-agent runs the glacial default — the landing's own ramp,
// the color of the product the agent is about to fill.
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
