"use client";

import { useMemo } from "react";
import { camelotWheelSummary, type CamelotWheelModel } from "@/lib/sets/styleEvolution";
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
// G-6 ruling (recorded in the story's Completion Notes): cells are
// NON-INTERACTIVE. SC 2.5.8 governs pointer targets and a static graphic
// has none, so no keyboard path and no non-radial phone fallback is owed;
// the AC-11 text-equivalent (`camelotWheelSummary`, naming the top keys and
// their share) is the one reading surface, serving as visible caption, aria
// label, and render fallback alike.
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
/** A cell with at least one play never drops below this opacity — the
 *  floor keeps a 1-play cell visible next to a 50-play one; zero-count
 *  cells skip the fill entirely (D-8), so the floor never fabricates. */
const MIN_LIVE_OPACITY = 0.28;

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
        return {
          key: `${cell.number}${cell.letter}`,
          d: cellPath(cell.number, radii),
          fill: `var(--camelot-${cell.number}${cell.letter.toLowerCase()})`,
          // Zero-count cells render EMPTY (outline only) — D-8. Live cells
          // scale from the floor to full by count. Integer/integer ratio,
          // rounded anyway for the fixed-decimal discipline.
          opacity:
            cell.count === 0 || wheel.maxCount === 0
              ? null
              : (MIN_LIVE_OPACITY + (1 - MIN_LIVE_OPACITY) * (cell.count / wheel.maxCount)).toFixed(4),
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

  if (wheel.totalKeyed === 0) {
    return (
      <div className="se-chart se-chart-fallback dz-shell" role="img" aria-label={caption}>
        <span className="dz-dots" aria-hidden="true" />
        <p className="se-chart-caption">{caption}</p>
      </div>
    );
  }

  return (
    <div className="se-chart se-chart-full dz-shell">
      <span className="dz-dots" aria-hidden="true" />

      <div className="se-chart-head">
        <p className="se-chart-title">Camelot Wheel</p>
        <p className="se-chart-subtitle">Plays by key across your sets · inner ring A, outer ring B</p>
      </div>

      <div className="se-wheel-plot" role="img" aria-label={caption}>
        <svg className="se-wheel-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          {cells.map((cell) => (
            <path
              key={cell.key}
              d={cell.d}
              className="se-wheel-cell"
              fill={cell.opacity == null ? "none" : cell.fill}
              fillOpacity={cell.opacity ?? undefined}
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
    </div>
  );
}
