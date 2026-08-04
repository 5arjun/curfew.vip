"use client";

import dynamic from "next/dynamic";
import type { CSSProperties, ReactNode } from "react";
import { useMetalColors, usePrefersReducedMotion } from "@/app/components/ui/metal-hooks";

// The liquid-metal rim material as a reusable wrapper (post-review, Arjun
// 2026-08-03): the FloatingNav rail-rim layer sandwich — shader ring under a
// dark plate inset 2px — generalized for Set Detail's small controls (scope
// toggle, veil back arrow, Week/Month + genre⇄subgenre mini-toggles).
// MetalButton's exact reference params (right for control scale). Each
// instance is one WebGL context — keep placements to a handful per screen,
// never mapped over a list (the standing LiquidMetal rule).
const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false },
);

export function MetalRim({
  radius = 14,
  className,
  children,
}: {
  radius?: number;
  className?: string;
  children: ReactNode;
}) {
  const colors = useMetalColors();
  const reduced = usePrefersReducedMotion();

  return (
    <div
      className={["sd-metal", className].filter(Boolean).join(" ")}
      style={{ "--sd-metal-radius": `${radius}px` } as CSSProperties}
    >
      {colors && (
        <span aria-hidden="true" className="sd-metal-rim">
          <LiquidMetal
            style={{ width: "100%", height: "100%" }}
            colorBack={colors.back}
            colorTint={colors.tint}
            speed={reduced ? 0 : 0.6}
            repetition={4}
            softness={0.5}
            shiftRed={0.3}
            shiftBlue={0.3}
            distortion={0}
            contour={0}
            angle={45}
            scale={8}
            offsetX={0.1}
            offsetY={-0.1}
            shape="none"
          />
        </span>
      )}
      <span aria-hidden="true" className="sd-metal-plate" />
      {children}
    </div>
  );
}
