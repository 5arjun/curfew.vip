import {
  hasEnoughRotation,
  rotationSizeSummary,
  type RotationSizeModel,
} from "@/lib/sets/libraryUtilization";
import { InsufficientHistory } from "@/app/components/style-evolution/InsufficientHistory";

/**
 * This module's OWN insufficient-history copy (AC-9).
 *
 * Not reused from another module, deliberately — Story 4.3 Task 4 and Story
 * 4.5 both ruled on this question, and 4.5's review found a gate counting
 * *adds* while its copy told the DJ to go *play* tracks. The gate here counts
 * SETS INSIDE THE 60-DAY WINDOW, so the sentence talks about playing a set,
 * and it names the same 60 days the gate uses.
 */
const ROTATION_INSUFFICIENT_COPY =
  "Nothing in the last 60 days yet. Play a set and this fills in with how wide you're digging.";

/**
 * Rotation size (Story 4.9, AC-7) — distinct tracks against total plays across
 * a trailing 60-day window, e.g. "340 plays, 180 unique".
 *
 * **Rendered by `page.tsx` directly, NOT inside `LibraryUtilizationView`
 * (D-21).** Two independent reasons, either one sufficient:
 *   1. Its window is FIXED at 60 days — AC-7's literal text. Following the
 *      shared conversion dropdown would leave this tile violating its own AC
 *      at the 14-day selection, and would put a control above a figure it must
 *      not move (`page.tsx`'s render block, same rule as `TimeToFirstPlay`).
 *   2. `LibraryUtilizationView` is the conversion pair's own section, headed
 *      `<h2>Conversion</h2>`, so nesting a play-side stat there would file it
 *      under a heading that does not describe it — wrong in the heading
 *      outline a screen-reader user navigates by, which is where R-10 moved
 *      this concern. (This reason previously cited an `aria-label="Conversion"`
 *      landmark; the same story that wrote this comment DELETED that label as
 *      part of R-10's fix, so the justification was false on arrival. Reason 1
 *      was always sufficient on its own.)
 *
 * It states its own window in its own copy for the same reason: a fixed window
 * that does not say so is indistinguishable, on screen, from one that follows
 * the dropdown and is broken.
 *
 * Shell copied from `TimeToFirstPlay` exactly — `.lu-module dz-shell` +
 * `dz-dots`, **every branch inside the shell**. That rule exists because the
 * first shipped version of 4.5's module returned a bare `<InsufficientHistory>`
 * in place of the whole section, dropping the label and the width cap.
 */
export function RotationSize({ model }: { model: RotationSizeModel }) {
  const ready = hasEnoughRotation(model);

  // Below the gate the module states no figure, so the accessible name must
  // not state one either (AC-9's trap, from Story 4.5's browser pass). The
  // summary generator is gate-blind by design and already falls back to naming
  // the region; `InsufficientHistory`'s own `role="status"` carries the copy.
  const summary = rotationSizeSummary(model);

  return (
    <div className="lu-module dz-shell" role="group" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      <div className="lu-stat-head">
        <h3 className="lu-stat-label">Rotation size</h3>
      </div>

      {!ready ? (
        <InsufficientHistory copy={ROTATION_INSUFFICIENT_COPY} />
      ) : (
        <>
          {/* aria-hidden: `summary` on the section already states both figures,
              and leaving these exposed had screen readers announce the same
              numbers twice in two registers (Story 4.5's review, twice). */}
          <p className="lu-stat-readout" aria-hidden="true">
            <span className="lu-stat-value">{model.totalPlays}</span>{" "}
            {model.totalPlays === 1 ? "play" : "plays"}, {model.distinctTracks} unique
          </p>
          {/* AC-7/D-21: the window is fixed, and saying so is what stops it
              reading as a figure the dropdown above forgot to move. */}
          <p className="lu-disclosure" aria-hidden="true">
            Across the last {model.windowDays} days · {model.setCount}{" "}
            {model.setCount === 1 ? "set" : "sets"}
          </p>
        </>
      )}
    </div>
  );
}
