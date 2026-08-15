"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMetalColors, usePrefersReducedMotion } from "@/app/components/ui/metal-hooks";

// The dashboard's liquid-metal material (D8/D9) — a full-fidelity port of the
// inspo liquid-metal button, with ALL its physics preserved: the ref's exact
// shader params; state-reactive speed (idle 0.6 → hover 1.0 → click burst
// 2.4, settling after 300ms); the 3D layer stack (shader ring → dark pill
// inset 2px forming the metal rim → label → hitbox, via preserve-3d +
// translateZ); press-down (translateY 1px + scale 0.98 + inset shadow); a
// 0.6s radial ripple at the cursor; and the multi-layer stacked drop shadows
// that tighten on hover. Adaptations (PLAN.md-sanctioned): Abyss cold-chrome
// tint via the --metal-abyss-* tokens (the shader parses hex, not var(), so
// they're read from :root at runtime); the ref's raw `new ShaderMount(...)`
// call targets an older library API whose texture/sizing defaults no longer
// hold, so the SAME shader mounts through the maintained <LiquidMetal>
// wrapper with the ref's exact param values, speed driven by state; the
// ref's inline styles + runtime <style> injection live in dashboard.css
// (.mtl-*), token-only; reduced motion freezes the shader (speed 0) and
// drops the ripple.
//
// ⚠️ WebGL-context-limited, same rule as ui/liquid-metal-button.tsx: the
// sanctioned placements are the hero arrow (icon mode), the expanded set
// card's "Enter Set" pill (text mode), and the nav rail's rim (FloatingNav,
// Arjun 2026-08-03). Never map it over a list.
//
// Added 2026-08-14 (Arjun): the landing page's CTA, in all three of its
// placements — hero, stepper, close — via <LandingActions>, and (later the
// same day, Arjun again) the landing nav bar's rim in LandingNav.tsx, built on
// the FloatingNav rail-rim pattern and gated to ≥761px. With the mesh and the
// arc ribbon that puts the landing at 6 contexts of the browser's ~16 on
// desktop. That IS the ceiling for the page: the "See features" secondary is
// deliberately CSS-only (chrome ring + sheen, no shader), and any further
// landing CTA should reuse LandingActions rather than mount another shader.
const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false },
);

export interface MetalButtonProps {
  mode: "icon" | "text";
  /** Visible label in text mode; the accessible name in both modes. */
  label: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}

interface Ripple {
  x: number;
  y: number;
  id: number;
}

export function MetalButton({ mode, label, href, onClick, className }: MetalButtonProps) {
  const reduced = usePrefersReducedMotion();
  const colors = useMetalColors();
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [burst, setBurst] = useState(false);
  const [ripples, setRipples] = useState<Ripple[]>([]);
  const rippleId = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  // The ref's speed state machine: idle 0.35 → hover 1.0 → click 2.4 for 300ms.
  const speed = reduced ? 0 : burst ? 2.4 : isHovered ? 1 : 0.35;

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    setBurst(true);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setBurst(false), 300);

    if (!reduced) {
      const rect = e.currentTarget.getBoundingClientRect();
      // Keyboard-triggered clicks (Enter/Space) are synthetic MouseEvents with
      // detail === 0 (no real click count) — clientX/clientY are browser-dependent
      // for these, so center the ripple on the button instead.
      const isKeyboardActivated = e.detail === 0;
      const ripple = {
        x: isKeyboardActivated ? rect.width / 2 : e.clientX - rect.left,
        y: isKeyboardActivated ? rect.height / 2 : e.clientY - rect.top,
        id: rippleId.current++,
      };
      setRipples((prev) => [...prev, ripple]);
      setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== ripple.id)), 600);
    }

    onClick?.();
  };

  const hitProps = {
    className: "mtl-hit",
    onClick: handleClick,
    onMouseEnter: () => setIsHovered(true),
    onMouseLeave: () => {
      setIsHovered(false);
      setIsPressed(false);
    },
    onMouseDown: () => setIsPressed(true),
    onMouseUp: () => setIsPressed(false),
    "aria-label": label,
  };

  const rippleSpans: ReactNode = ripples.map((r) => (
    <span key={r.id} className="mtl-ripple" style={{ left: `${r.x}px`, top: `${r.y}px` }} />
  ));

  return (
    <div className={["mtl", `mtl--${mode}`, className].filter(Boolean).join(" ")}>
      <div className="mtl-persp">
        <div
          className="mtl-stack"
          data-pressed={isPressed || undefined}
          data-hover={isHovered || undefined}
        >
          <div className="mtl-face" aria-hidden="true">
            {mode === "icon" ? <ArrowRight size={16} strokeWidth={2} /> : <span>{label}</span>}
          </div>
          <div className="mtl-pill-layer">
            <div className="mtl-pill" />
          </div>
          <div className="mtl-shadow-layer">
            <div className="mtl-shader">
              {colors && (
                <LiquidMetal
                  style={{ width: "100%", height: "100%" }}
                  colorBack={colors.back}
                  colorTint={colors.tint}
                  speed={speed}
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
              )}
            </div>
          </div>
          {href ? (
            <Link href={href} {...hitProps}>
              {rippleSpans}
            </Link>
          ) : (
            <button type="button" {...hitProps}>
              {rippleSpans}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
