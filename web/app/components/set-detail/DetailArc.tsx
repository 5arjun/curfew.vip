"use client";

import { animate } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { arcTextEquivalent } from "@/lib/sets/energyArc";
import { heroArcGeometry } from "@/lib/sets/heroArc";
import type { SetRecord } from "@/lib/sets/types";
import type { ScopeFrame } from "./model";

// Section C (spec §3a-C): the 3.6 arc renderer reused in thumbnail mode — the
// SAME smooth-chrome geometry the dashboard hero draws (heroArcGeometry);
// Story 3.8 upgrades this same component to full annotated + chart-summary
// mode, never a fork.
//
// AC-9 — the arc's DOMAIN follows the scope: Dancefloor draws only the
// detected window, Whole night the full night, and the flip MORPHS (the
// dancefloor zooms/expands outward to reveal the full night; reverse
// collapses). Implemented by animating the SVG viewBox between the two
// domains: one full-night path, the svg's own viewport does the clipping, and
// `non-scaling-stroke` keeps the line weight constant through the zoom.
// Reduced motion: hard cut (no tween).
const VIEW = { width: 1000, height: 260, padding: 18 };

export function DetailArc({ set, frame }: { set: SetRecord; frame: ScopeFrame }) {
  const geo = useMemo(
    () => heroArcGeometry(set.derived.energy_arc, frame.segment, VIEW),
    [set.derived.energy_arc, frame.segment],
  );

  const band = geo.band;
  const zoomed = frame.scope === "dancefloor" && band != null && band.width > 0;
  const targetX = zoomed ? (band as { x: number }).x : 0;
  const targetWidth = zoomed ? (band as { width: number }).width : VIEW.width;

  // The JSX viewBox stays frozen at its mount-time value (React never patches
  // it again), and from then on the animation below owns the attribute — no
  // fight between the renderer and the tween.
  const [initialViewBox] = useState(() => `${targetX} 0 ${targetWidth} ${VIEW.height}`);
  const svgRef = useRef<SVGSVGElement>(null);
  const domain = useRef({ x: targetX, width: targetWidth });

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const setViewBox = (x: number, width: number) => {
      domain.current = { x, width };
      el.setAttribute("viewBox", `${x} 0 ${width} ${VIEW.height}`);
    };
    const from = { ...domain.current };
    if (from.x === targetX && from.width === targetWidth) return;
    // Read the preference at flip time (not via useReducedMotion, whose value
    // can lag a runtime settings change) — AC-9: reduced motion is a hard
    // cut, never a morph.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setViewBox(targetX, targetWidth);
      return;
    }
    const controls = animate(0, 1, {
      duration: 0.6,
      ease: [0.17, 1, 0.33, 1],
      onUpdate: (t) => {
        setViewBox(
          from.x + (targetX - from.x) * t,
          from.width + (targetWidth - from.width) * t,
        );
      },
    });
    return () => controls.stop();
  }, [targetX, targetWidth]);

  const label = arcTextEquivalent(set.derived.energy_arc, frame.segment);

  if (geo.count < 2) {
    // Chart-summary text fallback (AC-35) — intentional, never a broken chart.
    return (
      <div className="sd-arc sd-arc-fallback dz-shell" role="img" aria-label={label}>
        <span className="dz-dots" aria-hidden="true" />
        <p className="sd-arc-fallback-copy">
          {geo.count === 1 ? "Single track — no arc to draw." : "No tempo data — no arc to draw."}
        </p>
      </div>
    );
  }

  return (
    <div className="sd-arc dz-shell" role="img" aria-label={label}>
      <span className="dz-dots" aria-hidden="true" />
      <svg
        ref={svgRef}
        className="sd-arc-svg"
        viewBox={initialViewBox}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="sd-arc-stroke" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="var(--color-abyss-accent)" />
            <stop offset="0.5" stopColor="var(--metal-abyss-tint)" />
            <stop offset="1" stopColor="var(--color-abyss-accent)" />
          </linearGradient>
          <linearGradient id="sd-arc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-abyss-accent-glow)" />
            <stop offset="1" stopColor="var(--color-abyss-scrim-fade)" />
          </linearGradient>
        </defs>

        <path d={geo.area} className="sd-arc-area" fill="url(#sd-arc-fill)" />
        <path
          d={geo.path}
          className="sd-arc-line"
          stroke="url(#sd-arc-stroke)"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
