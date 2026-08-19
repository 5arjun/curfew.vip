import Link from "next/link";
import {
  hasEnoughSimilarityHistory,
  setSimilaritySummary,
  type SetSimilarityModel,
  type SimilarityAxis,
} from "@/lib/sets/libraryUtilization";
import { InsufficientHistory } from "@/app/components/style-evolution/InsufficientHistory";
import { InfoTip } from "@/app/components/ui/InfoTip";

/**
 * This module's OWN insufficient-history copy (AC-9) — **two** of them, because
 * `hasEnoughSimilarityHistory` has two independent failure modes and only one
 * of them is "you need another set".
 *
 * The gate is `shownSetCount >= 2 && ranked.length > 0`. A DJ can clear the
 * first half and fail the second: with 2+ surviving sets where one has no
 * identified tracks, every pair is skipped as unknown-not-zero and `ranked`
 * empties. Telling that DJ to go play another night is telling them to do
 * something they have already done — the gate-versus-sentence mismatch AC-9
 * and the Story 4.5 ruling are cited for in this very file.
 */
const SIMILARITY_TOO_FEW_SETS_COPY =
  "Two sets is the minimum for a comparison. Once there's another night to hold this one against, the overlap shows up here.";

const SIMILARITY_NOTHING_TO_COMPARE_COPY =
  "No overlap to show yet. There aren't enough named tracks in these sets to compare them. As more of your plays come through with track names, this fills in.";

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * Set similarity (Story 4.9, AC-4) — pairwise track overlap across recent sets
 * as a matrix, the aggregate non-time-series display that reads off a small
 * history, unlike the trend lines.
 *
 * **Three accessibility decisions, all load-bearing (Task 7):**
 *
 * 1. *Intensity is never carried by opacity alone* (UX-DR21, WCAG 2.2
 *    SC 1.4.1). Every populated cell prints its own percentage as text. The
 *    visual ramp is a redundant encoding, not the encoding.
 *
 * 2. *The grid's CELLS are `aria-hidden`, and the section's accessible name is
 *    the text equivalent.* A 10×10 table announced cell by cell is 100
 *    announcements to find one fact. (This read "the grid is `aria-hidden`"
 *    until 2026-08-10, when the axes became links and the attribute had to move
 *    down to the cells — see the note below.) `setSimilaritySummary` — the most-alike pair and its share,
 *    in words — is what `EXPERIENCE.md`'s chart rule actually asks for, and it
 *    is present at every width. Note the ranked list is NOT a second accessible
 *    copy: it is `display: none` above 620px, so on desktop neither the grid
 *    nor the list is in the accessibility tree and the summary carries the
 *    requirement alone. (An earlier version of this comment called the list
 *    "the accessible content", which was true only at phone widths.)
 *
 * 3. *It degrades to a ranked "most alike" list at phone widths* (**D-22**),
 *    via CSS only, so the module stays a server component. A 10×10 grid cannot
 *    give every cell 24×24 (SC 2.5.8) inside `.lu`'s gutters at 320px — expect
 *    the list to BE the phone experience rather than an edge case. Same
 *    problem Story 4.8 AC-11 solved once for the Camelot wheel.
 *
 * The Stitch mock's treatment for this module — `overflow-x: auto` over a
 * `min-w-[600px]` grid (`code.html:305-306`) — is **rejected**, deliberately
 * and not by oversight: a horizontally-scrolling region at 320px is exactly
 * the overflow AC-11 forbids, and it leaves the cells below 24×24 anyway.
 * `EXPERIENCE.md:31` gives the spine precedence over the mocks, and the mock
 * predates the Ice Cyan / Abyss redesign besides.
 *
 * No cell is interactive, so there is no keyboard path to provide — the data a
 * hover tooltip would have carried is printed in the cell instead.
 *
 * **The AXES are interactive as of 2026-08-10 (Arjun), and that moved the
 * `aria-hidden` boundary.** Each axis now links into `/set/[id]`, and the grid
 * could not stay wholly `aria-hidden` around them: focusable content inside an
 * `aria-hidden` subtree is the classic trap — a keyboard user tabs to a control
 * a screen reader cannot announce. So the attribute moved DOWN, off the grid
 * and onto the cells and the corner, which is also a strict improvement: an
 * assistive-tech user now gets ten navigable set links instead of nothing,
 * while the 100 cell percentages stay out of the tree exactly as decision (2)
 * above requires.
 *
 * The COLUMN headers are the same ten destinations as the row axis, so they are
 * `aria-hidden` and `tabIndex={-1}`: clickable with a mouse where the DJ's
 * instinct points, but not a second set of ten tab stops to the same places.
 * The row axis is the keyboard and screen-reader path.
 */
export function SetSimilarity({ model }: { model: SetSimilarityModel }) {
  const ready = hasEnoughSimilarityHistory(model);
  const summary = setSimilaritySummary(model);

  return (
    <div className="lu-module lu-module-wide dz-shell" role="group" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      {/* The explainer (Arjun, 2026-08-12: "add a tooltip they can hover over
          that shows how that similarity is actually calculated"). A percentage
          in a matrix is the one figure on this page a DJ cannot reverse-engineer
          from what is on screen — 40% of WHICH set, counted how, over what — and
          two reasonable readings of "40% similar" give different numbers.
          So it states the formula, names the denominator, and says out loud what
          a blank cell means, which is the part that actually confuses (a blank
          is unknown, not zero — see `Row` below).

          Reuses Style Evolution's `.se-chart-info` explainer verbatim, chrome
          and behaviour: hover AND keyboard focus AND a tap-toggle, because
          hover-only strands both keyboard and touch. Verbatim rather than
          re-styled — it is already the one "what does this mean" affordance in
          this app, and a second dialect of it would be the thing to justify. */}
      <div className="lu-stat-head">
        <h3 className="lu-stat-label">
          Set similarity
          {/* `align="start"`: this trigger sits four words in from the card's
              left edge, so the default right-pinned panel grew leftward off
              the card and under the nav rail (Arjun, 2026-08-18). */}
          <InfoTip label="How set similarity is calculated" align="start">
            Each cell counts the tracks two sets have in common, divided by the number of distinct
            identified tracks across both, so two identical sets read 100%, and two with nothing in
            common read 0%. A track counts once per set no matter how often you played it, and tracks
            Curfew couldn&rsquo;t identify are left out of both halves. A blank cell means one of the
            two sets had no identified tracks at all, which is unknown rather than zero.
          </InfoTip>
        </h3>
      </div>

      {!ready ? (
        <InsufficientHistory
          copy={
            model.shownSetCount < 2
              ? SIMILARITY_TOO_FEW_SETS_COPY
              : SIMILARITY_NOTHING_TO_COMPARE_COPY
          }
        />
      ) : (
        <>
          <div
            className="lu-sim-grid"
            style={{ "--lu-sim-columns": model.shownSetCount + 1 } as React.CSSProperties}
          >
            {/* Corner spacer, then the column headers. */}
            <span className="lu-sim-corner" aria-hidden="true" />
            {/* Keyed by POSITION, not by label. The label is a display string
                that is not guaranteed unique at its source — an unlabelled set
                falls back to the literal "Untitled set" — and two of those gave
                duplicate React keys on both axes. `buildSetSimilarity` now
                disambiguates the labels too, so this is the second of two
                guards rather than the only one. */}
            {model.axes.map((axis, col) => (
              <AxisLink key={`col-${col}`} axis={axis} className="lu-sim-axis-col" duplicate />
            ))}

            {model.axes.map((axis, row) => (
              <Row key={`row-${row}`} axis={axis} cells={model.matrix[row]} row={row} />
            ))}
          </div>

          {/* D-22's degraded form. Rendered unconditionally and shown by CSS
              only below the width at which the grid's cells can each meet
              24×24 — `display: none` also removes it from the accessibility
              tree, so it is never a duplicate announcement of the grid. */}
          <ol className="lu-sim-ranked">
            {model.ranked.slice(0, 5).map((pair) => (
              <li key={`${pair.a}-${pair.b}`} className="lu-sim-ranked-row">
                {/* The phone-width path to the same two sets. The grid is
                    `display: none` here, so these are the only axis links in
                    the accessibility tree at this width — never a duplicate. */}
                <span className="lu-row-title">
                  <RankedLink axis={model.axes[pair.a]} /> &amp;{" "}
                  <RankedLink axis={model.axes[pair.b]} />
                </span>
                <span className="lu-row-value">{pct(pair.share)} shared</span>
              </li>
            ))}
          </ol>

          {/* D-19: a silent top-10 truncation reads as "this is all your
              history", so the cap is stated whenever it actually bites. */}
          {model.truncated && (
            <p className="lu-disclosure" aria-hidden="true">
              Your {model.shownSetCount} most recent sets, of {model.survivingSetCount}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/**
 * One axis label, linking into `/set/[id]`.
 *
 * The visible text is the DATE; the accessible name carries the date AND the
 * session label, so a link announced out of context still identifies which
 * night it goes to and stays recognisable against `SetDetail`'s own header.
 *
 * `duplicate` marks the column headers — the same ten destinations as the row
 * axis, and they render as **plain, non-interactive text**, not a link.
 * `aria-hidden` on a focusable element (an `<a href>`, even with
 * `tabIndex={-1}`) is a real WCAG trap — `tabIndex={-1}` only removes
 * sequential Tab-key stops, the element is still focusable by other means, so
 * it stays reachable while unannounced. A `<span>` has no such path, so
 * `aria-hidden` on it is the safe, standard way to keep the row axis as the
 * one screen-reader/keyboard route to these ten destinations without a second,
 * silently-focusable one. The trade is real: the column headers lose the
 * mouse-click affordance the row axis keeps.
 */
function AxisLink({
  axis,
  className,
  duplicate = false,
}: {
  axis: SimilarityAxis;
  className: string;
  duplicate?: boolean;
}) {
  if (duplicate) {
    return (
      <span className={`lu-sim-axis ${className}`} aria-hidden="true">
        {axis.dayLabel}
      </span>
    );
  }
  return (
    <Link
      className={`lu-sim-axis lu-sim-axis-link ${className}`}
      href={`/set/${encodeURIComponent(axis.setId)}`}
      aria-label={`${axis.dayLabel}, ${axis.label}`}
    >
      {axis.dayLabel}
    </Link>
  );
}

/** The ranked list's own link — same destination, same accessible name. */
function RankedLink({ axis }: { axis: SimilarityAxis }) {
  return (
    <Link
      className="lu-sim-ranked-link"
      href={`/set/${encodeURIComponent(axis.setId)}`}
      aria-label={`${axis.dayLabel}, ${axis.label}`}
    >
      {axis.dayLabel}
    </Link>
  );
}

function Row({
  axis,
  cells,
  row,
}: {
  axis: SimilarityAxis;
  cells: (number | null)[];
  row: number;
}) {
  return (
    <>
      <AxisLink axis={axis} className="lu-sim-axis-row" />
      {cells.map((share, col) =>
        share === null ? (
          // The diagonal, and any pair where a set had no identified tracks.
          // Blank rather than "0%" — `0 ÷ 0` is unknown, not zero (D-8).
          <span key={`${row}-${col}`} className="lu-sim-cell lu-sim-cell-empty" aria-hidden="true" />
        ) : (
          <span
            key={`${row}-${col}`}
            className="lu-sim-cell"
            // The ramp below runs a LIGHT cyan up to full opacity, and the
            // cell's percentage is near-white — so the denser the cell, the
            // closer the two got, until a high-overlap pair printed white on
            // `#7fd8f2` at about 1.4:1 (Arjun, 2026-08-18: "the %'s on this are
            // hard to read"). It was also the failure the ramp's own
            // pseudo-element exists to prevent, arriving from the other
            // direction: that fix stopped the TEXT being faded, not the ground
            // under it being brightened.
            //
            // The answer lives entirely in the stylesheet, deliberately: the
            // foreground stays ONE colour at every density and the halo under
            // it grows with `--lu-sim-intensity`. A `data-dense` flip to dark
            // ink was tried here first and reverted — it switched sides well
            // before the two readings actually cross, so it improved the
            // bright end by making the middle of the ramp worse. The numbers
            // are recorded on `.lu-sim-cell-value` in `library-utilization.css`.
            //
            // `aria-hidden` sits HERE rather than on the grid, since the axes
            // became links — see this module's doc comment. Without it the
            // 100 cell percentages re-enter the accessibility tree, which is
            // exactly what decision (2) exists to prevent.
            aria-hidden="true"
            // Intensity rides `opacity` on a token-coloured fill. The colour
            // guard (`no-hardcoded-colors.test.ts`) rejects `color-mix()`,
            // `rgba()`, `hsl()`, `oklch` AND the bare words `transparent` /
            // `currentColor` — i.e. every natural way to build a ramp — so the
            // ramp had to be planned around opacity before it was written, not
            // discovered at the gate. A floor of 0.08 keeps a 0% cell visible
            // as a cell rather than a hole in the grid.
            //
            // The variable is consumed by `.lu-sim-cell::before`, NOT by the
            // cell — see that rule. The percentage below has to sit in its own
            // element for the same reason: a bare text node here would be
            // composited with whatever carries the opacity.
            style={{ "--lu-sim-intensity": 0.08 + share * 0.92 } as React.CSSProperties}
          >
            <span className="lu-sim-cell-value">{pct(share)}</span>
          </span>
        ),
      )}
    </>
  );
}
