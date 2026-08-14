"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useMediaQuery, usePrefersReducedMotion } from "@/app/components/ui/metal-hooks";
import { arc, clockAt, getArcCurve, getAxisTicks, SAMPLES, toSvgPath } from "./arc-curve";
import type { Projected } from "./ArcRibbonCanvas";

// Wrapper around the WebGL ribbon (Story 6.1). Owns everything the canvas
// should not: where scroll progress comes from, what renders when WebGL is a
// bad idea, and all the text — POI labels, the time axis, the tracklist and the
// BPM readout are real DOM, positioned (where they need to track the geometry)
// by the canvas each frame, so they stay selectable and readable by assistive
// tech instead of being baked into a texture.
//
// Nothing here re-renders on scroll. Every per-frame update is a direct style
// or textContent mutation on a ref'd node — 44 tracklist rows re-rendering at
// 60fps would be the one thing guaranteed to make this page feel bad.

const ArcRibbonCanvas = dynamic(() => import("./ArcRibbonCanvas"), { ssr: false });

const RIBBON_TOKENS = [
  "--landing-ribbon-deep",
  "--landing-ribbon-accent",
  "--landing-ribbon-crest",
  "--landing-ribbon-floor",
];

const GENRE_TOKENS = [
  "--chart-cat-1",
  "--chart-cat-2",
  "--chart-cat-3",
  "--chart-cat-4",
  "--chart-cat-5",
  "--chart-cat-6",
  "--chart-cat-7",
  "--chart-cat-8",
  "--chart-cat-other",
];

type NavigatorWithMemory = Navigator & { deviceMemory?: number };

/**
 * ONE FLAG PER QUESTION (2026-08-14). This used to be a single `useLowPower`
 * that gated the canvas AND the axis AND the tracklist AND the readout AND the
 * bead — three unrelated questions collapsed into one boolean. The result was a
 * mobile beat 02 with nothing in it but a static curve and 320vh of scroll.
 *
 * "Can this device run the 3D ribbon?" and "should this page show the night's
 * furniture?" are different questions. The furniture is DOM; it works fine
 * against the SVG. Only the POI markers genuinely need the canvas, because they
 * are positioned by projecting 3D points to screen space.
 */
function useCanRender3D(): boolean {
  const narrow = useMediaQuery("(max-width: 639px)");
  const scarceMemory = useSyncExternalStore(
    () => () => {},
    () => {
      const memory = (navigator as NavigatorWithMemory).deviceMemory;
      return typeof memory === "number" && memory < 4;
    },
    () => false,
  );
  return !narrow && !scarceMemory;
}

type Colors = {
  deep: string;
  accent: string;
  crest: string;
  floor: string;
  genre: Record<string, string>;
};

/**
 * Reads every colour the shaders need from :root at runtime. Same contract as
 * useMetalColors/useSilkColor: a shader parses hex, not var(). Joined into one
 * string because getSnapshot must return a stable value across calls — a fresh
 * object literal would loop.
 */
function useArcColors(): Colors | null {
  const names = useMemo(() => [...RIBBON_TOKENS, ...GENRE_TOKENS], []);
  const snapshot = useSyncExternalStore(
    () => () => {},
    () => {
      const root = getComputedStyle(document.documentElement);
      return names.map((name) => root.getPropertyValue(name).trim()).join("|");
    },
    () => names.map(() => "").join("|"),
  );
  return useMemo(() => {
    const values = snapshot.split("|");
    if (values.some((value) => !value)) return null;
    const genre: Record<string, string> = {};
    GENRE_TOKENS.forEach((token, i) => {
      genre[token] = values[RIBBON_TOKENS.length + i];
    });
    return { deep: values[0], accent: values[1], crest: values[2], floor: values[3], genre };
  }, [snapshot]);
}

/**
 * Scroll progress across the sticky stage: 0 when its top reaches the viewport
 * top, 1 when its last screenful has been scrolled through. `onChange` fires on
 * the same rAF, which is how the tracklist and BPM readout stay in step without
 * a second scroll listener or any React state.
 */
function useSectionProgress(
  section: React.RefObject<HTMLElement | null>,
  onChange?: (p: number) => void,
) {
  const value = useRef(0);
  const handler = useRef(onChange);

  useEffect(() => {
    handler.current = onChange;
  }, [onChange]);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const node = section.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      value.current = travel <= 0 ? 0 : Math.min(1, Math.max(0, -rect.top / travel));
      handler.current?.(value.current);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [section]);

  return useCallback(() => value.current, []);
}

/**
 * The 2D counterpart to the canvas's projection pass. Positions the same
 * furniture — axis ticks and the bead — from the SVG's measured box instead of
 * a camera, and writes the SAME contract (a px transform on the node), so the
 * DOM layer does not care which renderer is behind it.
 *
 * Also drives the reveal: the SVG's path group is scaled on Y from a flat line
 * to the night's shape, so the horizon opening that the whole beat is built on
 * happens on mobile too. It cannot depend on WebGL — it is the page's argument.
 */
function layoutFromSvg(
  p: number,
  els: {
    ribbon: HTMLDivElement | null;
    svg: SVGSVGElement | null;
    shape: SVGGElement | null;
    bead: HTMLDivElement | null;
    axis: (HTMLDivElement | null)[];
  },
  ticks: { t: number }[],
) {
  const { ribbon, svg } = els;
  if (!ribbon || !svg) return;

  const amp = easeOutCubic(smoothstep(0, 0.36, p));
  const box = svg.getBoundingClientRect();
  const host = ribbon.getBoundingClientRect();
  const left = box.left - host.left;
  const top = box.top - host.top;
  const baseline = top + box.height;

  if (els.shape) els.shape.style.transform = `scaleY(${amp.toFixed(4)})`;

  for (let i = 0; i < ticks.length; i += 1) {
    const node = els.axis[i];
    if (!node) continue;
    node.style.transform = `translate3d(${(left + ticks[i].t * box.width).toFixed(1)}px, ${baseline.toFixed(1)}px, 0)`;
    node.dataset.shown = amp > 0.55 ? "true" : "false";
  }

  if (els.bead) {
    const walk = Math.min(1, Math.max(0, (p - 0.3) / 0.62));
    const { heights } = getArcCurve();
    const column = Math.round(walk * (SAMPLES - 1));
    const y = top + box.height * (1 - heights[column] * amp);
    els.bead.style.transform = `translate3d(${(left + walk * box.width).toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    els.bead.dataset.shown = p > 0.3 ? "true" : "false";
  }
}

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Which track the scroll position is "standing on" once the shape exists. */
function trackIndexFor(p: number): number {
  const walk = (p - 0.3) / 0.62;
  return Math.min(arc.points.length - 1, Math.max(0, Math.floor(walk * arc.points.length)));
}

export function ArcRibbon({ section }: { section: React.RefObject<HTMLElement | null> }) {
  const reduced = usePrefersReducedMotion();
  const canRender3D = useCanRender3D();
  const colors = useArcColors();
  const axisTicks = useMemo(() => getAxisTicks(), []);

  const poiNodes = useRef<(HTMLDivElement | null)[]>([]);
  const axisNodes = useRef<(HTMLDivElement | null)[]>([]);
  const rowNodes = useRef<(HTMLLIElement | null)[]>([]);
  const bpmNode = useRef<HTMLSpanElement>(null);
  const readoutNode = useRef<HTMLDivElement>(null);
  const listNode = useRef<HTMLOListElement>(null);
  const windowNode = useRef<HTMLDivElement>(null);
  const nowNode = useRef<HTMLParagraphElement>(null);
  /** Whichever set-panel is mounted — the desktop column or the phone's "now"
   *  line. Both are hidden until the scroll has started drawing the night. */
  const panelNode = useRef<HTMLElement | null>(null);
  const ribbonNode = useRef<HTMLDivElement>(null);
  const svgNode = useRef<SVGSVGElement>(null);
  const shapeNode = useRef<SVGGElement>(null);
  const beadNode = useRef<HTMLDivElement>(null);
  const activeIndex = useRef(-1);

  const useCanvas = canRender3D && colors !== null;

  const onScroll = useCallback((p: number) => {
    const next = p > 0.28 ? trackIndexFor(p) : -1;
    if (next === activeIndex.current) return;
    rowNodes.current[activeIndex.current]?.removeAttribute("data-active");
    activeIndex.current = next;
    rowNodes.current[next]?.setAttribute("data-active", "true");
    if (readoutNode.current) readoutNode.current.dataset.shown = next >= 0 ? "true" : "false";
    if (listNode.current) listNode.current.dataset.shown = next >= 0 ? "true" : "false";
    if (panelNode.current) panelNode.current.dataset.shown = next >= 0 ? "true" : "false";
    if (bpmNode.current && next >= 0) {
      bpmNode.current.textContent = String(Math.round(arc.points[next].bpm));
    }
    // The compact form of the tracklist: one line, the track you are standing
    // on. A 24ch column has nowhere to live next to the arc on a phone.
    if (nowNode.current && next >= 0) {
      nowNode.current.textContent = arc.points[next].title;
    }
    // Walk the column so the current track stays centred and you always see
    // what came before and after — a clipped static list would just lose the
    // end of the night.
    if (listNode.current && windowNode.current && next >= 0) {
      const rowHeight = rowNodes.current[0]?.offsetHeight ?? 0;
      const offset = windowNode.current.clientHeight / 2 - (next + 0.5) * rowHeight;
      listNode.current.style.transform = `translateY(${offset.toFixed(1)}px)`;
    }
  }, []);

  const onProgress = useCallback(
    (p: number) => {
      onScroll(p);
      if (useCanvas) return;
      layoutFromSvg(
        p,
        {
          ribbon: ribbonNode.current,
          svg: svgNode.current,
          shape: shapeNode.current,
          bead: beadNode.current,
          axis: axisNodes.current,
        },
        axisTicks,
      );
    },
    [onScroll, useCanvas, axisTicks],
  );

  const progress = useSectionProgress(section, onProgress);

  const onProject = useCallback((poi: Projected[], axis: Projected[]) => {
    const apply = (nodes: (HTMLElement | null)[], points: Projected[]) => {
      for (let i = 0; i < points.length; i += 1) {
        const node = nodes[i];
        if (!node) continue;
        const point = points[i];
        node.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`;
        node.dataset.shown = point.visible ? "true" : "false";
      }
    };
    apply(poiNodes.current, poi);
    apply(axisNodes.current, axis);
  }, []);

  return (
    <div className="lp-ribbon" ref={ribbonNode} data-mode={useCanvas ? "gl" : "svg"}>
      {/* Painted before the canvas exists and kept as the only render on small
          or low-memory devices. Same curve, same numbers — see arc-curve.ts. */}
      <svg
        className="lp-ribbon-svg"
        ref={svgNode}
        data-hidden={useCanvas ? "true" : "false"}
        viewBox={`0 0 ${SAMPLES} 120`}
        preserveAspectRatio="none"
        role="presentation"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="lp-arc-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" className="lp-arc-stop-top" />
            <stop offset="100%" className="lp-arc-stop-bottom" />
          </linearGradient>
        </defs>
        {/* Scaled on Y from the baseline by the scroll pass above: flat line
            first, then the night. Same reveal as the 3D ribbon, no WebGL. */}
        <g ref={shapeNode} className="lp-arc-shape">
          <path className="lp-arc-area" d={toSvgPath(SAMPLES, 120, true)} fill="url(#lp-arc-fill)" />
          <path className="lp-arc-line" d={toSvgPath(SAMPLES, 120, false)} />
        </g>
      </svg>

      {useCanvas && (
        <ArcRibbonCanvas
          colors={colors}
          progress={progress}
          reduced={reduced}
          onProject={onProject}
        />
      )}

      {/* Time axis — positioned by whichever renderer is active (projection in
          3D, measured SVG box in 2D), so it exists on every device. */}
      <div className="lp-axis-layer" aria-hidden="true">
        {axisTicks.map((tick, i) => (
          <div
            key={tick.t}
            className="lp-axis-tick"
            data-shown="false"
            data-edge={tick.t === 0 ? "start" : tick.t === 1 ? "end" : "mid"}
            ref={(node) => {
              axisNodes.current[i] = node;
            }}
          >
            <span className="lp-axis-mark" />
            <span className="lp-axis-label">{tick.label}</span>
          </div>
        ))}
      </div>

      {/* The bead is the canvas's job in 3D; in 2D it is a DOM dot placed from
          the same curve data. */}
      {!useCanvas && <div className="lp-bead" data-shown="false" ref={beadNode} aria-hidden="true" />}

      <div className="lp-readout" data-shown="false" ref={readoutNode} aria-hidden="true">
        <span className="lp-readout-value" ref={bpmNode}>
          —
        </span>
        <span className="lp-readout-unit">BPM</span>
      </div>

      {useCanvas ? (
        <>
          <div className="lp-poi-layer" aria-hidden="true">
            {/* The closing marker is dropped: the ribbon now runs under the
                tracklist column, so a label at t=1 would sit beneath it. The
                axis already labels 2:26 AM at that exact x, and the column
                header states the night's span, so nothing is lost. */}
            {arc.poi
              .filter((poi) => poi.t <= 0.9)
              .map((poi, i) => (
              <div
                key={poi.id}
                className="lp-poi"
                data-shown="false"
                data-alt={i % 2 === 0 ? "up" : "down"}
                data-anchor={poi.t > 0.9 ? "end" : "start"}
                style={{ transitionDelay: `${i * 70}ms` }}
                ref={(node) => {
                  poiNodes.current[i] = node;
                }}
              >
                <span className="lp-poi-dot" />
                <span className="lp-poi-stem" />
                <span className="lp-poi-text">
                  {poi.label && <em className="lp-poi-label">{poi.label}</em>}
                  <span className="lp-poi-caption">{poi.caption}</span>
                </span>
              </div>
              ))}
          </div>

          <aside
            className="lp-tracklist"
            aria-label="The set, in order"
            data-shown="false"
            ref={(node) => {
              panelNode.current = node;
            }}
          >
            <p className="lp-tracklist-head">
              {arc.points.length} tracks · {clockAt(0)} — {clockAt(1)}
            </p>
            <div className="lp-tracklist-window" ref={windowNode}>
              <ol className="lp-tracklist-rows" data-shown="false" ref={listNode}>
              {arc.points.map((point, i) => (
                <li
                  key={`${point.position}-${point.title}`}
                  className="lp-tl-row"
                  ref={(node) => {
                    rowNodes.current[i] = node;
                  }}
                >
                  <span className="lp-tl-time">{clockAt(point.t)}</span>
                  <span className="lp-tl-title">{point.title}</span>
                </li>
                ))}
              </ol>
            </div>
          </aside>
        </>
      ) : (
        /* Phone form of the tracklist: the night's span, and the one track you
           are standing on. The full column has nowhere to live beside the arc. */
        <div
          className="lp-now"
          aria-hidden="true"
          data-shown="false"
          ref={(node) => {
            panelNode.current = node;
          }}
        >
          <p className="lp-now-head">
            {arc.points.length} tracks · {clockAt(0)} — {clockAt(1)}
          </p>
          <p className="lp-now-title" ref={nowNode} />
        </div>
      )}
    </div>
  );
}
