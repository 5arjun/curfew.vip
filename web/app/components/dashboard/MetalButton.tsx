"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

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
// ⚠️ WebGL-context-limited, same rule as ui/liquid-metal-button.tsx: the two
// sanctioned dashboard placements are the hero arrow (icon mode) and the
// expanded set card's "Enter Set" pill (text mode). Never map it over a list.
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

/** Reads the cold-chrome material tokens from :root at runtime (see tokens.css). */
function useMetalColors(): { back: string; tint: string } | null {
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

  // The ref's speed state machine: idle 0.6 → hover 1.0 → click 2.4 for 300ms.
  const speed = reduced ? 0 : burst ? 2.4 : isHovered ? 1 : 0.6;

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    setBurst(true);
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setBurst(false), 300);

    if (!reduced) {
      const rect = e.currentTarget.getBoundingClientRect();
      const ripple = { x: e.clientX - rect.left, y: e.clientY - rect.top, id: rippleId.current++ };
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
                  repetition={6}
                  softness={0.5}
                  shiftRed={0.3}
                  shiftBlue={0.3}
                  distortion={0}
                  contour={0}
                  angle={45}
                  scale={1}
                  offsetX={0}
                  offsetY={0}
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
