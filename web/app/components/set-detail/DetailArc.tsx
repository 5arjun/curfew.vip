"use client";

import { animate } from "framer-motion";
import {
  Component,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { arcTextEquivalent, type ArcPoint } from "@/lib/sets/energyArc";
import { formatClock } from "@/lib/sets/format";
import { arcInSegment, heroArcGeometry } from "@/lib/sets/heroArc";
import {
  bpmSummary,
  camelotCompatible,
  parseCamelot,
  type CamelotKey,
} from "@/lib/sets/setDetail";
import type { SetRecord, SyncPlay } from "@/lib/sets/types";
import { CursorChip, useCursorChipTarget } from "@/app/components/ui/CursorChip";
import type { Focus, ScopeFrame } from "./model";

// Section C, FULL MODE (Story 3.8 — the in-place upgrade of the 3.7 slot-C
// renderer, never a fork, D-8): the same heroArcGeometry domain + viewBox
// morph machinery, now drawing the monotone-cubic chrome curve with a median
// baseline, sparse edge ticks, hover name chips, click-to-jump
// (DR-2 setFocus — 3.7's one focus mechanism), a Camelot key-timeline strip
// morphing in lockstep, and the ONE chart-summary caption (visible + aria +
// error-boundary fallback, D-12).
//
// AC-9 / D-18 — the scope flip MORPHS by animating the SVG viewBox between
// the two domains (one full-night path; the svg viewport clips;
// `non-scaling-stroke` keeps line weight constant). All annotations are HTML
// positioned from arc geometry: they fade out during the morph and back in
// after, so they never fight the viewBox tween. Reduced motion: hard cut.
const VIEW = { width: 1000, height: 260, padding: 18 };
/** Key-strip viewBox height — its own SVG, sharing the arc's x-domain. */
const STRIP_H = 28;

/* ── Pure helpers ─────────────────────────────────────────────────────── */

/** Segment bounds and `plays.started_at` — read-model ISO strings. Arc points
 * are epoch seconds and go through `arcEpochMs` instead; see its doc comment. */
const EPOCH = (iso: string) => new Date(iso).getTime();

interface TimedPlay {
  play: SyncPlay;
  t: number;
  x: number;
}

interface StripSeg {
  play: SyncPlay;
  x: number;
  w: number;
  key: CamelotKey | null;
  /** Index into the pre-filter chronological `timed` list — lets seam-building
   * tell a truly-adjacent pair from two plays with a dropped segment between
   * them (duplicate `started_at`), instead of pairing whatever survived the
   * filter as if it were always consecutive. */
  origIndex: number;
}

interface StripSeam {
  x: number;
  state: "smooth" | "clash" | "nokey";
}

type ArcHover =
  // Review round 2: the PLOT reads as a chart — hover shows the curve's time +
  // BPM under the cursor. Track identity lives on the key strip's hover.
  | { kind: "point"; clock: string; bpm: number }
  | { kind: "strip"; play: SyncPlay; keyLabel: string | null }
  | { kind: "median" };

/* ── Error boundary (D-16) — render failure swaps in the caption block ── */

class ArcErrorBoundary extends Component<
  { caption: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="sd-arc-fallback-copy sd-arc-error">
          <p className="sd-arc-caption">{this.props.caption}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ── The component ────────────────────────────────────────────────────── */

// D-16's error-boundary fallback must cover the geometry/strip computation
// too, not just the JSX below it — those run as useMemo/hooks in a
// component's OWN render, which is the boundary's parent scope, not a
// descendant it can intercept. So the boundary lives here, one level up,
// wrapping every hook that could throw; only the cheap, low-risk caption
// input (a plain array filter) is computed outside it.
export function DetailArc({
  set,
  zone,
  frame,
  setFocus,
}: {
  set: SetRecord;
  /** The set's own IANA zone, resolved once by the page (Story 7.7). */
  zone: string;
  frame: ScopeFrame;
  setFocus: (focus: Focus | null) => void;
}) {
  // Scope-reactive caption input (D-13): the dancefloor caption reads only the
  // window's points; whole-night reads them all. Recomputes with the flip.
  const scopedArc = useMemo<ArcPoint[]>(
    () =>
      arcInSegment(
        set.derived.energy_arc,
        frame.scope === "dancefloor" ? frame.segment : null,
      ),
    [set.derived.energy_arc, frame.scope, frame.segment],
  );

  // THE one chart-summary string (D-12): visible caption, aria
  // text-equivalent, and error-boundary fallback below.
  const caption = arcTextEquivalent(scopedArc, frame.scope);

  return (
    <ArcErrorBoundary caption={caption}>
      <DetailArcChart
        set={set}
        zone={zone}
        frame={frame}
        setFocus={setFocus}
        scopedArc={scopedArc}
        caption={caption}
      />
    </ArcErrorBoundary>
  );
}

function DetailArcChart({
  set,
  zone,
  frame,
  setFocus,
  scopedArc,
  caption,
}: {
  set: SetRecord;
  /** The set's own IANA zone, resolved once by the page (Story 7.7). */
  zone: string;
  frame: ScopeFrame;
  setFocus: (focus: Focus | null) => void;
  scopedArc: ArcPoint[];
  caption: string;
}) {
  const geo = useMemo(
    () => heroArcGeometry(set.derived.energy_arc, frame.segment, VIEW),
    [set.derived.energy_arc, frame.segment],
  );

  const band = geo.band;

  // Story 5.3 (D-34): the band mirrors the boundary being edited, live.
  //
  // The arc is a REFLECTION, never a second drag target — one source of truth
  // (the tracklist), one mirror (this). Reusing `heroArcGeometry` rather than
  // deriving x-positions here is the same discipline: the mirrored band and the
  // committed one are laid out by identical math, so they cannot disagree about
  // where a given moment sits on the arc.
  //
  // The ZOOM deliberately stays on the committed band. Letting the viewport
  // follow the draft would make the whole arc lurch on every arrow press, which
  // is harder to read the boundary against, not easier.
  const editGeo = useMemo(
    () =>
      frame.editingBounds
        ? heroArcGeometry(set.derived.energy_arc, frame.editingBounds, VIEW)
        : null,
    [set.derived.energy_arc, frame.editingBounds],
  );
  const liveBand = editGeo?.band ?? band;
  const bandEditing = editGeo?.band != null;

  const zoomed = frame.scope === "dancefloor" && band != null;
  const targetX = zoomed ? band.x : 0;
  const targetWidth = zoomed ? band.width : VIEW.width;

  // D-4: an in-scope honesty check — a "Dancefloor" scope whose window has
  // fewer than 2 plottable points must say so, never silently draw the whole
  // night under a Dancefloor scope line.
  const inScopeSparse = frame.scope === "dancefloor" && scopedArc.length < 2;
  const showChart = geo.count >= 2 && !inScopeSparse;

  // Timed plays with their viewBox x — the nearest-point hit model (D-9) and
  // the DR-2 click-to-jump mapping both read this. Scoped to `frame.plays`
  // when zoomed, so a click near the zoomed edge can never resolve to (and
  // jump to) a track outside the visible dancefloor window — the scope is a
  // hard boundary everywhere else in this feature (toggle, caption, median).
  const timedPlays = useMemo<TimedPlay[]>(
    () =>
      (zoomed ? frame.plays : set.plays)
        .filter(
          (p): p is SyncPlay & { started_at: string } => p.started_at != null && p.bpm != null,
        )
        .map((p) => ({ play: p, t: EPOCH(p.started_at), x: 0 }))
        .sort((a, b) => a.t - b.t)
        .map((tp) => ({ ...tp, x: geo.mapX(tp.t) })),
    [zoomed, frame.plays, set.plays, geo],
  );

  // Median baseline (D-6) — the active scope's resting pulse. Whole-set reads
  // the derived cache; dancefloor recomputes client-side from the scoped slice.
  const median = useMemo(() => {
    if (frame.scope === "whole") return set.derived.bpm_distribution.median;
    const summary = bpmSummary(frame.plays);
    return summary.count > 0 ? summary.median : null;
  }, [frame.scope, frame.plays, set.derived.bpm_distribution.median]);
  const medianY = median != null ? geo.mapY(median) : null;

  // (The on-curve ★ peak mark was REMOVED in review round 1 — Arjun: the star
  // didn't convey the right point. The shared arcPeakPosition lives on: the
  // tracklist's ★ PEAK impact node still consumes frame.peakPosition.)

  // Key timeline strip (D-1, spec §3b): one segment per timed play across its
  // played window (next play's start, or the real capture where it's the last
  // play), tinted by its --camelot-* token. Self-hides on an all-no-key set.
  const strip = useMemo<{ segs: StripSeg[]; seams: StripSeam[] } | null>(() => {
    const timed = set.plays
      .filter((p): p is SyncPlay & { started_at: string } => p.started_at != null)
      .sort((a, b) => EPOCH(a.started_at) - EPOCH(b.started_at));
    if (timed.length < 2) return null;
    if (!timed.some((p) => p.camelot_key && parseCamelot(p.camelot_key))) return null;

    const segs: StripSeg[] = [];
    const seams: StripSeam[] = [];
    for (let i = 0; i < timed.length; i++) {
      const start = EPOCH(timed[i].started_at);
      let end: number | null;
      if (i < timed.length - 1) {
        end = EPOCH(timed[i + 1].started_at);
      } else if (timed[i].played_ms != null) {
        end = start + (timed[i].played_ms as number);
      } else if (set.ended_at != null) {
        end = EPOCH(set.ended_at);
      } else {
        end = null; // no honest window for the last play — disclosed by absence
      }
      if (end == null || end <= start) continue;
      const x = geo.mapX(start);
      segs.push({
        play: timed[i],
        x,
        w: geo.mapX(end) - x,
        key: timed[i].camelot_key ? parseCamelot(timed[i].camelot_key as string) : null,
        origIndex: i,
      });
    }
    for (let i = 0; i < segs.length - 1; i++) {
      const a = segs[i];
      const b = segs[i + 1];
      // A gap (a dropped duplicate-`started_at` play between them) means
      // these two were never actually consecutive — draw "nokey" rather than
      // a smooth/clash verdict between tracks with an undisclosed gap.
      const adjacent = b.origIndex === a.origIndex + 1;
      seams.push({
        x: b.x,
        state:
          adjacent && a.key && b.key
            ? camelotCompatible(a.key, b.key)
              ? "smooth"
              : "clash"
            : "nokey",
      });
    }
    return { segs, seams };
  }, [set.plays, set.ended_at, geo]);

  // Edge ticks (D-7): scope start · end. The dancefloor window itself is
  // HIGHLIGHTED in the plot (review round 3 — a wash + edge lines in the svg,
  // morphing with the viewBox; the ⌐ DANCEFLOOR ¬ text label never read).
  const tickStart = zoomed ? frame.segment?.start : timedPlays[0]?.play.started_at;
  const tickEnd = zoomed
    ? frame.segment?.end
    : timedPlays[timedPlays.length - 1]?.play.started_at;

  /* ── viewBox morph (3.7 machinery, untouched in spirit) — now driving the
     arc svg AND the key strip in lockstep, and flagging `morphing` so the
     HTML annotation layer fades out for the ride (D-18). ─────────────── */

  const [initialDomain] = useState(() => ({ x: targetX, width: targetWidth }));
  const [hover, setHover] = useState<ArcHover | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stripRef = useRef<SVGSVGElement | null>(null);
  const domain = useRef({ x: targetX, width: targetWidth });

  // The svg subtree can unmount/remount around the fallback branches while
  // the tween owns the attribute — sync a fresh element to the live domain.
  const syncArcRef = useCallback((el: SVGSVGElement | null) => {
    svgRef.current = el;
    el?.setAttribute("viewBox", `${domain.current.x} 0 ${domain.current.width} ${VIEW.height}`);
  }, []);
  const syncStripRef = useCallback((el: SVGSVGElement | null) => {
    stripRef.current = el;
    el?.setAttribute("viewBox", `${domain.current.x} 0 ${domain.current.width} ${STRIP_H}`);
  }, []);

  useLayoutEffect(() => {
    if (!showChart) return;
    const setViewBox = (x: number, width: number) => {
      domain.current = { x, width };
      svgRef.current?.setAttribute("viewBox", `${x} 0 ${width} ${VIEW.height}`);
      stripRef.current?.setAttribute("viewBox", `${x} 0 ${width} ${STRIP_H}`);
    };
    // The morph flag is a DOM concern (it only drives CSS fades + pointer
    // gating), managed imperatively like the viewBox itself — no React state,
    // no cascading render mid-tween.
    const setMorphAttr = (on: boolean) => {
      const root = rootRef.current;
      if (!root) return;
      if (on) root.setAttribute("data-morphing", "true");
      else root.removeAttribute("data-morphing");
    };
    const from = { ...domain.current };
    if (from.x === targetX && from.width === targetWidth) return;
    // Read the preference at flip time (not via useReducedMotion, whose value
    // can lag a runtime settings change) — AC-9: reduced motion is a hard
    // cut, never a morph (and no annotation fade to wait out).
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setViewBox(targetX, targetWidth);
      return;
    }
    setMorphAttr(true);
    const controls = animate(0, 1, {
      duration: 0.6,
      ease: [0.17, 1, 0.33, 1],
      onUpdate: (t) => {
        setViewBox(
          from.x + (targetX - from.x) * t,
          from.width + (targetWidth - from.width) * t,
        );
      },
      onComplete: () => {
        setMorphAttr(false);
        // A hover captured before the flip points at the old domain — drop it.
        setHover(null);
      },
    });
    return () => {
      controls.stop();
      setMorphAttr(false);
    };
  }, [targetX, targetWidth, showChart]);

  /* ── Hover + click-to-jump (D-2/D-9/D-17, DR-2) ───────────────────── */

  const chipTargetRef = useCursorChipTarget();
  const hitRef = useRef<HTMLDivElement>(null);
  // The little ball riding the curve under the cursor (review round 2) —
  // positioned imperatively per mousemove, no per-frame React state.
  const ballRef = useRef<HTMLSpanElement>(null);

  const hideBall = useCallback(() => {
    ballRef.current?.removeAttribute("data-on");
  }, []);

  const nearestPlay = useCallback(
    (clientX: number): TimedPlay | null => {
      const el = hitRef.current;
      if (!el || timedPlays.length === 0) return null;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return null;
      const vbX =
        domain.current.x + ((clientX - rect.left) / rect.width) * domain.current.width;
      let best = timedPlays[0];
      let bestDist = Math.abs(best.x - vbX);
      for (let i = 1; i < timedPlays.length; i++) {
        const dist = Math.abs(timedPlays[i].x - vbX);
        if (dist < bestDist) {
          bestDist = dist;
          best = timedPlays[i];
        }
      }
      return best;
    },
    [timedPlays],
  );

  const jumpTo = useCallback(
    (play: SyncPlay) => {
      // DR-2 — 3.7's ONE focus mechanism, reused verbatim: single-select,
      // "Focused: X ✕" pill, dim-don't-hide, window scroll-to-match.
      setFocus({
        key: `play-${play.position}`,
        label: play.title ?? "Unknown track",
        positions: [play.position],
      });
      // A tap has no mouseleave — without this the chip strands on mobile
      // (D-17's immediate jump scrolls the page out from under it).
      setHover(null);
      hideBall();
    },
    [setFocus, hideBall],
  );

  const onPlotMove = useCallback(
    (e: React.MouseEvent) => {
      chipTargetRef.current = { x: e.clientX, y: e.clientY };
      const el = hitRef.current;
      if (!el || geo.curve.length === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      // Median proximity wins (its identifying hover, D-6) — the dashed line
      // needs no ball, it IS a y-reading.
      if (medianY != null) {
        const medianPy = (medianY / VIEW.height) * rect.height;
        if (Math.abs(e.clientY - rect.top - medianPy) < 9) {
          hideBall();
          setHover((prev) => (prev?.kind === "median" ? prev : { kind: "median" }));
          return;
        }
      }

      const vbX =
        domain.current.x + ((e.clientX - rect.left) / rect.width) * domain.current.width;
      // Round 3 fix: y comes from the DRAWN cubic's own evaluator (shared
      // Fritsch–Carlson tangents) — the previous chord-lerp between smoothed
      // points visibly floated off the bowed segments.
      const clampedX = Math.max(
        geo.curve[0].x,
        Math.min(vbX, geo.curve[geo.curve.length - 1].x),
      );
      const yOnCurve = geo.yAtX(clampedX);

      // Ball on the line at the cursor's x — imperative transform, chip-style.
      const ball = ballRef.current;
      if (ball) {
        const px = ((clampedX - domain.current.x) / domain.current.width) * rect.width;
        const py = (yOnCurve / VIEW.height) * rect.height;
        ball.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
        ball.setAttribute("data-on", "true");
      }

      // Chip = the curve's reading at that instant. State only changes when
      // the DISPLAYED minute/BPM changes, so mousemove stays cheap.
      const clock = formatClock(new Date(geo.timeAtX(clampedX)).toISOString(), zone);
      const bpm = Math.round(geo.bpmAtY(yOnCurve));
      setHover((prev) =>
        prev?.kind === "point" && prev.clock === clock && prev.bpm === bpm
          ? prev
          : { kind: "point", clock, bpm },
      );
    },
    // `zone` is in here because the hover chip's clock is formatted in it
    // (Story 7.7). Omitting it would pin the readout to whichever zone was
    // current when the callback was first created.
    [chipTargetRef, geo, medianY, hideBall, zone],
  );

  const onPlotClick = useCallback(
    (e: React.MouseEvent) => {
      const tp = nearestPlay(e.clientX);
      if (tp) jumpTo(tp.play); // mobile tap included: jump immediately (D-17)
    },
    [nearestPlay, jumpTo],
  );

  const clearHover = useCallback(() => {
    setHover(null);
    hideBall();
  }, [hideBall]);

  /* ── Render ───────────────────────────────────────────────────────── */

  // Sparse whole set (AC-23): the 3.7 text fallback stands; the strip hides
  // with it. The container aria stays the one generator's string.
  if (geo.count < 2) {
    return (
      <div className="sd-arc sd-arc-fallback dz-shell" role="img" aria-label={caption}>
        <span className="dz-dots" aria-hidden="true" />
        <p className="sd-arc-fallback-copy">
          {geo.count === 1 ? "Single track, so no arc to draw." : "No tempo data, so no arc to draw."}
        </p>
      </div>
    );
  }

  // D-4 (AC-24): dancefloor scope, window without enough plottable points —
  // the in-scope chart-summary fallback, never a dishonest whole-night draw.
  if (inScopeSparse) {
    return (
      <div className="sd-arc sd-arc-fallback dz-shell" role="img" aria-label={caption}>
        <span className="dz-dots" aria-hidden="true" />
        <p className="sd-arc-fallback-copy">{caption}</p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="sd-arc sd-arc-full dz-shell" role="img" aria-label={caption}>
      <span className="dz-dots" aria-hidden="true" />
      <>
        <div className="sd-arc-plot">
          <svg
            ref={syncArcRef}
            className="sd-arc-svg"
            viewBox={`${initialDomain.x} 0 ${initialDomain.width} ${VIEW.height}`}
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

            {/* The dancefloor-window highlight: a quiet wash + soft edge
                lines, in viewBox space so it morphs with the zoom. CSS fades
                it out under data-scope="dancefloor" (the window IS the view). */}
            {liveBand && (
              <g className="sd-arc-band" data-editing={bandEditing || undefined} aria-hidden="true">
                <rect
                  x={liveBand.x.toFixed(2)}
                  y={0}
                  width={liveBand.width.toFixed(2)}
                  height={VIEW.height}
                  className="sd-arc-band-wash"
                />
                <line
                  x1={liveBand.x.toFixed(2)}
                  y1={0}
                  x2={liveBand.x.toFixed(2)}
                  y2={VIEW.height}
                  className="sd-arc-band-edge"
                  vectorEffect="non-scaling-stroke"
                />
                <line
                  x1={(liveBand.x + liveBand.width).toFixed(2)}
                  y1={0}
                  x2={(liveBand.x + liveBand.width).toFixed(2)}
                  y2={VIEW.height}
                  className="sd-arc-band-edge"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}

            <path d={geo.area} className="sd-arc-area" fill="url(#sd-arc-fill)" />
            {medianY != null && (
              <line
                x1={VIEW.padding}
                y1={medianY}
                x2={VIEW.width - VIEW.padding}
                y2={medianY}
                className="sd-arc-median"
                vectorEffect="non-scaling-stroke"
              />
            )}
            <path
              d={geo.path}
              className="sd-arc-line"
              stroke="url(#sd-arc-stroke)"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* The cursor ball riding the curve — sibling of the hit plane so
              the plane's events never re-target while it moves. */}
          <span ref={ballRef} className="sd-arc-cursor-dot" aria-hidden="true" />

          {/* Generous hit plane (D-9): the whole plot is the target. Median
              proximity is resolved inside onPlotMove — no nested hit band. */}
          <div
            ref={hitRef}
            className="sd-arc-hit"
            onMouseMove={onPlotMove}
            onMouseLeave={clearHover}
            onClick={onPlotClick}
          />
        </div>

        {strip && (
          <svg
            ref={syncStripRef}
            className="sd-arc-strip"
            viewBox={`${initialDomain.x} 0 ${initialDomain.width} ${STRIP_H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {strip.segs.map((seg) => (
              <rect
                key={seg.play.position}
                className="sd-arc-strip-seg"
                x={seg.x.toFixed(2)}
                y={4}
                width={seg.w.toFixed(2)}
                height={STRIP_H - 8}
                style={
                  seg.key
                    ? {
                        fill: `var(--camelot-${seg.key.number}${seg.key.letter.toLowerCase()})`,
                      }
                    : undefined
                }
                data-nokey={seg.key == null || undefined}
                onMouseEnter={(e) => {
                  chipTargetRef.current = { x: e.clientX, y: e.clientY };
                  setHover({
                    kind: "strip",
                    play: seg.play,
                    keyLabel: seg.key ? `${seg.key.number}${seg.key.letter}` : null,
                  });
                }}
                onMouseMove={(e) => {
                  chipTargetRef.current = { x: e.clientX, y: e.clientY };
                }}
                onMouseLeave={clearHover}
                onClick={() => jumpTo(seg.play)}
              />
            ))}
            {strip.seams.map(
              (seam, i) =>
                seam.state !== "nokey" && (
                  <line
                    key={i}
                    className={`sd-arc-seam sd-arc-seam--${seam.state}`}
                    x1={seam.x.toFixed(2)}
                    y1={2}
                    x2={seam.x.toFixed(2)}
                    y2={STRIP_H - 2}
                    vectorEffect="non-scaling-stroke"
                  />
                ),
            )}
          </svg>
        )}

        <div className="sd-arc-footer sd-arc-fade">
          <div className="sd-arc-ticks">
            <span className="sd-arc-tick">{formatClock(tickStart ?? null, zone)}</span>
            <span className="sd-arc-tick">{formatClock(tickEnd ?? null, zone)}</span>
          </div>
          <p className="sd-arc-caption">{caption}</p>
        </div>
      </>

      <CursorChip
        target={chipTargetRef}
        visible={hover != null}
        contentKey={
          hover == null
            ? null
            : hover.kind === "median"
              ? "median"
              : hover.kind === "point"
                ? "point" // stable key: the readout updates live, no crossfade churn
                : `s-${hover.play.position}`
        }
        offsetY={-44}
        compact
      >
        {hover && (
          <p className="cursor-chip-mono">
            {hover.kind === "median"
              ? `Median · ${Math.round(median ?? 0)} BPM`
              : hover.kind === "point"
                ? `${hover.clock} · ${hover.bpm} BPM`
                : hover.keyLabel
                  ? `${hover.keyLabel} · ${hover.play.title ?? "Unknown track"}`
                  : (hover.play.title ?? "Unknown track")}
          </p>
        )}
      </CursorChip>
    </div>
  );
}
