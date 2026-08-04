"use client";

import { animate } from "framer-motion";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { heroArcGeometry } from "@/lib/sets/heroArc";
import type { SetRecord } from "@/lib/sets/types";
import type { ScopeFrame } from "./model";

// The Tempo module's sparkline (3.8 review round 1): the same one-path +
// animated-viewBox morph the detail arc uses, at thumbnail scale — the scope
// flip ZOOMS the mini line between whole night and the dancefloor band instead
// of hard-swapping to a re-scoped polyline (which read as a jump). One
// full-night monotone path; `non-scaling-stroke` holds the weight; reduced
// motion hard-cuts, same as the big arc.
const VIEW = { width: 100, height: 24, padding: 3 };

export function TempoSpark({ set, frame }: { set: SetRecord; frame: ScopeFrame }) {
  const geo = useMemo(
    () => heroArcGeometry(set.derived.energy_arc, frame.segment, VIEW),
    [set.derived.energy_arc, frame.segment],
  );

  const band = geo.band;
  const zoomed = frame.scope === "dancefloor" && band != null;
  const targetX = zoomed ? band.x : 0;
  const targetWidth = zoomed ? band.width : VIEW.width;

  const [initialDomain] = useState(() => ({ x: targetX, width: targetWidth }));
  const svgRef = useRef<SVGSVGElement | null>(null);
  const domain = useRef({ x: targetX, width: targetWidth });

  useLayoutEffect(() => {
    const setViewBox = (x: number, width: number) => {
      domain.current = { x, width };
      svgRef.current?.setAttribute("viewBox", `${x} 0 ${width} ${VIEW.height}`);
    };
    const from = { ...domain.current };
    if (from.x === targetX && from.width === targetWidth) return;
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

  if (geo.count < 2) return null;

  return (
    <svg
      ref={svgRef}
      className="sd-bpm-spark"
      viewBox={`${initialDomain.x} 0 ${initialDomain.width} ${VIEW.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={geo.path} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
