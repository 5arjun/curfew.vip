"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";

// Liquid-metal hero CTA (Story 3.6 Task 11, AC-14). A designated hero/CTA — a
// WebGL liquid-metal shader (@paper-design/shaders-react) pooled behind a label.
//
// ⚠️ WebGL-CONTEXT-LIMITED (~16 live contexts per page, browser-enforced). This
// is used at 1–2 HERO MOMENTS ONLY — never a general <Button> variant, never
// mapped across a list. Spreading it would silently exhaust the page's GL
// contexts and blank later canvases.
//
// Adaptations from the circulating reference component:
//  • 'use client' + `dynamic(ssr:false)` — WebGL cannot render on the server.
//  • prefers-reduced-motion → the shader FREEZES (`speed={0}`) and the click
//    ripple is dropped entirely.
//  • colours are TOKENIZED: the shader's hex parser can't read a CSS var(), so
//    the two metal tokens are read from :root at runtime and passed as hex.
//  • the reference injected a <style> into document.head at runtime; those styles
//    now live in globals.css (`.liquid-metal-*`), token-only.

const LiquidMetal = dynamic(
  () => import("@paper-design/shaders-react").then((m) => m.LiquidMetal),
  { ssr: false },
);

// Both hooks read a browser-only value with no React-owned state, so
// useSyncExternalStore is the idiomatic form (a server snapshot for SSR, a
// client snapshot after mount) — no synchronous setState-in-effect.

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

/** Reads the tokenized metal material from :root at runtime (see tokens.css). */
function useMetalColors(): { back: string; tint: string } | null {
  // The material never changes at runtime, so subscribe is a no-op; the snapshot
  // is a stable "back|tint" string React compares by value.
  const snapshot = useSyncExternalStore(
    () => () => {},
    () => {
      const cs = getComputedStyle(document.documentElement);
      return `${cs.getPropertyValue("--metal-back").trim()}|${cs.getPropertyValue("--metal-tint").trim()}`;
    },
    () => "|",
  );
  const [back, tint] = snapshot.split("|");
  return back && tint ? { back, tint } : null;
}

export interface LiquidMetalButtonProps {
  children: ReactNode;
  /** Render as a link (a hero CTA usually navigates). Falls back to a button otherwise. */
  href?: string;
  onClick?: () => void;
  className?: string;
  "aria-label"?: string;
}

export function LiquidMetalButton({ children, href, onClick, className, ...rest }: LiquidMetalButtonProps) {
  const reduced = usePrefersReducedMotion();
  const colors = useMetalColors();
  const rippleRef = useRef<HTMLSpanElement>(null);

  const spawnRipple = (event: React.MouseEvent<HTMLElement>) => {
    if (reduced) return; // drop the ripple under reduced motion
    const host = rippleRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const ripple = document.createElement("span");
    ripple.className = "liquid-metal-ripple";
    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    host.appendChild(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  };

  const content = (
    <>
      {/* Fallback Ember gradient shows before the shader mounts / if WebGL is
          unavailable, so the CTA never renders as a bare rectangle. */}
      <span className="liquid-metal-fill" aria-hidden="true">
        {colors && (
          <LiquidMetal
            style={{ width: "100%", height: "100%" } as CSSProperties}
            colorBack={colors.back}
            colorTint={colors.tint}
            speed={reduced ? 0 : 0.35}
            repetition={3}
            softness={0.2}
            shape="metaballs"
          />
        )}
      </span>
      <span ref={rippleRef} className="liquid-metal-ripple-host" aria-hidden="true" />
      <span className="liquid-metal-label">
        <Sparkles size={16} strokeWidth={1.75} aria-hidden="true" />
        {children}
      </span>
    </>
  );

  const cls = ["liquid-metal-button", className].filter(Boolean).join(" ");

  if (href) {
    return (
      <Link href={href} className={cls} onClick={onClick} onMouseDown={spawnRipple} {...rest}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={cls} onClick={onClick} onMouseDown={spawnRipple} {...rest}>
      {content}
    </button>
  );
}
