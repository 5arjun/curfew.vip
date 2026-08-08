"use client";

import { useCallback, useId, useMemo, useRef, useState } from "react";
import { camelotWheelSummary, type CamelotWheelModel } from "@/lib/sets/styleEvolution";
import { CursorChip, useCursorChipTarget } from "@/app/components/ui/CursorChip";
import { TrendChartErrorBoundary } from "./TrendChart";

// Camelot wheel (Story 4.8, AC-7/8/10/11/12) — the Key section's hero: 12
// spokes × 2 rings, each cell's INTENSITY driven by aggregate play count
// across the DJ's surviving sets. The geometry is the one DJs already carry
// in their heads — adjacent-compatible positions (±1 with the 12↔1 wrap,
// same-number other-ring) are literally adjacent cells, which is the whole
// point of drawing it radially.
//
// Ring convention (commented per Task 5): the INNER ring is A (minor), the
// OUTER ring is B (major) — the same inner/outer split the real Camelot
// wheel and this app's own `--camelot-*` token comment use ("inner/minor A
// ring slightly deeper, outer/major B ring brighter").
//
// Cell hue: the existing `--camelot-{n}{a|b}` tokens, 1:1 with the 24 cells
// — never a new literal (no-hardcoded-colors.test.ts enforces this).
// Intensity is `fillOpacity` over the token. A zero-count cell renders EMPTY
// (hairline outline only), never at minimum intensity — D-8's gap rule in
// radial form.
//
// Intensity direction (Arjun, 2026-08-08 walkthrough: "darker shades should
// indicate more usage"): on this DARK surface the ink-density metaphor
// inverts — a literally-darker cell recedes into the background and reads as
// LESS. So the ramp runs washed-out→vivid: barely-there for a key touched
// once, full-strength color for the busiest key. The exponent spreads the
// low end apart, because real key usage is near-uniform and a linear ramp
// made every cell look the same (the walkthrough complaint). The explainer
// tooltip and the hover chip state the reading in words.
//
// Hover (same walkthrough): each cell is a mouse hover target that reads
// "8A · 34 plays · 11% of keyed plays" via the house CursorChip — mouse-only
// enrichment following the grouped bars' aria-hidden precedent. The Chart
// Summary caption remains the accessible text-equivalent (AC-11), nothing
// is operable, so no keyboard path is owed and the G-6 non-interactive
// ruling stands for target-size purposes (nothing to activate).
//
// G-8, non-negotiable: every polar→cartesian coordinate below goes through
// `Math.cos`/`Math.sin` — transcendental, implementation-approximated math
// that is legal to differ at the ULP level between Node's V8 and the
// browser's. Story 4.7 lost a session to exactly this as an SSR/hydration
// mismatch. EVERY coordinate is therefore rounded to fixed decimals
// (`.toFixed(2)`) before it reaches the DOM, and every interpolated opacity
// to `.toFixed(4)`, matching TrendChart's documented discipline.

// 384, not 360: the clock-number labels sit at LABEL_R just outside the rim,
// and at 360 the "12"/"6" glyphs clipped at the viewBox edge (measured in
// the 1440px walkthrough).
const SIZE = 384;
const CENTER = SIZE / 2;
/** Outer (B) ring radii. */
const OUTER_R = { outer: 168, inner: 120 };
/** Inner (A) ring radii — a 5-unit air gap between the rings. */
const INNER_R = { outer: 115, inner: 67 };
/** Clock-number label radius, just outside the rim. */
const LABEL_R = 178;
/** Angular air between neighbouring cells, degrees. */
const CELL_GAP_DEG = 2.5;
/** A cell with at least one play never drops below this opacity — visible
 *  as "touched", far from the busiest cell's full strength; zero-count
 *  cells skip the fill entirely (D-8), so the floor never fabricates. */
const MIN_LIVE_OPACITY = 0.12;
/** Ramp exponent — spreads the low end of a near-uniform distribution so
 *  "second-favourite" and "favourite" stop looking identical. */
const RAMP_EXPONENT = 1.4;

/** Camelot clock position → SVG angle (radians). 12 sits at the top, and
 *  numbers increase clockwise — the layout every hardware/software wheel
 *  uses, so neighbours here are exactly `camelotCompatible`'s ±1 pairs. */
function angleFor(number: number, offsetDeg: number): number {
  return (((number % 12) * 30 - 90 + offsetDeg) * Math.PI) / 180;
}

/** Annular-sector path for one cell, every coordinate pre-rounded (G-8). */
function cellPath(number: number, radii: { outer: number; inner: number }): string {
  const half = 15 - CELL_GAP_DEG / 2;
  const a0 = angleFor(number, -half);
  const a1 = angleFor(number, half);
  const pt = (r: number, a: number) => `${(CENTER + r * Math.cos(a)).toFixed(2)} ${(CENTER + r * Math.sin(a)).toFixed(2)}`;
  return [
    `M ${pt(radii.outer, a0)}`,
    `A ${radii.outer} ${radii.outer} 0 0 1 ${pt(radii.outer, a1)}`,
    `L ${pt(radii.inner, a1)}`,
    `A ${radii.inner} ${radii.inner} 0 0 0 ${pt(radii.inner, a0)}`,
    "Z",
  ].join(" ");
}

export function CamelotWheel({ wheel }: { wheel: CamelotWheelModel }) {
  // THE one Chart Summary string (visible caption + aria text-equivalent +
  // render-failure fallback) — AC-11's text-equivalent.
  const caption = camelotWheelSummary(wheel);

  return (
    <TrendChartErrorBoundary caption={caption} resetKey={`wheel:${wheel.totalKeyed}`}>
      <CamelotWheelPlot wheel={wheel} caption={caption} />
    </TrendChartErrorBoundary>
  );
}

function CamelotWheelPlot({ wheel, caption }: { wheel: CamelotWheelModel; caption: string }) {
  const cells = useMemo(
    () =>
      wheel.cells.map((cell) => {
        const radii = cell.letter === "A" ? INNER_R : OUTER_R;
        const t = wheel.maxCount > 0 ? cell.count / wheel.maxCount : 0;
        return {
          key: `${cell.number}${cell.letter}`,
          count: cell.count,
          d: cellPath(cell.number, radii),
          fill: `var(--camelot-${cell.number}${cell.letter.toLowerCase()})`,
          // Zero-count cells render EMPTY (outline only) — D-8. Live cells
          // ramp washed-out → vivid (see the intensity-direction note above).
          opacity:
            cell.count === 0
              ? null
              : (MIN_LIVE_OPACITY + (1 - MIN_LIVE_OPACITY) * Math.pow(t, RAMP_EXPONENT)).toFixed(4),
        };
      }),
    [wheel],
  );

  const numberLabels = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const number = i + 1;
        const a = angleFor(number, 0);
        return {
          number,
          x: (CENTER + LABEL_R * Math.cos(a)).toFixed(2),
          y: (CENTER + LABEL_R * Math.sin(a)).toFixed(2),
        };
      }),
    [],
  );

  const tipId = useId();
  const [tipOpen, setTipOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const chipTargetRef = useCursorChipTarget();
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const onCellMove = useCallback(
    (key: string, e: React.MouseEvent) => {
      chipTargetRef.current = { x: e.clientX, y: e.clientY };
      setHoverKey(key);
    },
    [chipTargetRef],
  );
  const clearHover = useCallback(() => setHoverKey(null), []);

  const hoverDetail = useMemo(() => {
    if (hoverKey == null) return null;
    const cell = cells.find((c) => c.key === hoverKey);
    if (!cell) return null;
    if (cell.count === 0) return `${cell.key} · never played`;
    const pct = Math.round((cell.count / wheel.totalKeyed) * 100);
    return `${cell.key} · ${cell.count} ${cell.count === 1 ? "play" : "plays"} · ${pct}% of keyed plays`;
  }, [hoverKey, cells, wheel.totalKeyed]);

  if (wheel.totalKeyed === 0) {
    return (
      <div className="se-chart se-chart-fallback dz-shell" role="img" aria-label={caption}>
        <span className="dz-dots" aria-hidden="true" />
        <p className="se-chart-caption">{caption}</p>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="se-chart se-chart-full dz-shell">
      <span className="dz-dots" aria-hidden="true" />

      <div className="se-chart-head">
        <p className="se-chart-title">Camelot Wheel</p>
        <p className="se-chart-subtitle">
          Where your keys live
          <span className="se-chart-info">
            <button
              type="button"
              className="se-chart-info-btn"
              aria-label="How to read the Camelot wheel"
              aria-describedby={tipId}
              aria-expanded={tipOpen}
              onClick={() => setTipOpen((open) => !open)}
              onBlur={() => setTipOpen(false)}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
                <circle className="se-chart-info-ring" cx="8" cy="8" r="7" />
                <circle className="se-chart-info-dot" cx="8" cy="4.6" r="0.95" />
                <path className="se-chart-info-stem" d="M8 7.1v4.6" />
              </svg>
            </button>
            <span role="tooltip" id={tipId} className="se-chart-info-tip">
              Every track&rsquo;s key maps to one wedge: 1&ndash;12 around the clock, minor keys (A) on the inner
              ring, major (B) on the outer. The more you play a key, the more vivid its wedge — an empty outline
              means you&rsquo;ve never played it. Neighbouring wedges, and the same number across rings, mix in key:
              a bright cluster is your harmonic home turf.
            </span>
          </span>
        </p>
      </div>

      <div className="se-wheel-plot" role="img" aria-label={caption}>
        <svg className="se-wheel-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {cells.map((cell) => (
            <path
              key={cell.key}
              d={cell.d}
              className="se-wheel-cell"
              data-hot={hoverKey === cell.key ? true : undefined}
              fill={cell.opacity == null ? "none" : cell.fill}
              fillOpacity={cell.opacity ?? undefined}
              onMouseEnter={(e) => onCellMove(cell.key, e)}
              onMouseMove={(e) => onCellMove(cell.key, e)}
              onMouseLeave={clearHover}
            />
          ))}
          {numberLabels.map((label) => (
            <text key={label.number} className="se-wheel-number" x={label.x} y={label.y}>
              {label.number}
            </text>
          ))}
        </svg>
      </div>

      <p className="se-chart-caption">{caption}</p>

      <CursorChip
        target={chipTargetRef}
        boundsRef={rootRef}
        visible={hoverDetail != null}
        contentKey={hoverKey}
        offsetY={-44}
        compact
      >
        {hoverDetail != null && <p className="cursor-chip-mono">{hoverDetail}</p>}
      </CursorChip>
    </div>
  );
}
