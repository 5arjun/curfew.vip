import {
  hasEnoughRepeatHistory,
  repeatTrackRateSummary,
  type RepeatTrackRateModel,
} from "@/lib/sets/libraryUtilization";
import { InsufficientHistory } from "@/app/components/style-evolution/InsufficientHistory";

/**
 * This module's OWN insufficient-history copy (AC-9).
 *
 * The gate counts SETS WITH A PREDECESSOR, so the sentence talks about playing
 * another set — the gate and the sentence describe the same quantity, which is
 * the rule Story 4.5's review produced after finding a gate counting *adds*
 * beside copy telling the DJ to go *play*.
 */
const REPEAT_INSUFFICIENT_COPY =
  "One night can't repeat itself. Play another set and this starts telling you how much carries over.";

/**
 * Repeat-track rate (Story 4.9, AC-2/AC-3) — the "am I playing the same thing
 * every night" counterpart to the aging shelf's neglect signal.
 *
 * The quantity is fixed by **D-17** and stated precisely rather than left as
 * "a rate": the unweighted mean of each set's carryover share against its own
 * up-to-5 predecessors, with the number of nights it averaged over shown
 * beside it. See `buildRepeatTrackRate` for why unweighted, why the oldest set
 * is excluded rather than scored 0%, and why this ruling and D-20's predicate
 * ship together or not at all.
 *
 * The sample size is on screen, not just in the accessible name, because a
 * mean over one night and a mean over forty are different claims and the
 * percentage alone cannot tell them apart.
 */
export function RepeatTrackRate({ model }: { model: RepeatTrackRateModel }) {
  const ready = hasEnoughRepeatHistory(model);
  // Gate-blind by design; below the gate it falls back to naming the region so
  // the accessible name never states a figure the visible UI declined to.
  const summary = repeatTrackRateSummary(model);

  return (
    <div className="lu-module dz-shell" role="group" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      <div className="lu-stat-head">
        <h3 className="lu-stat-label">Repeat tracks</h3>
      </div>

      {!ready ? (
        <InsufficientHistory copy={REPEAT_INSUFFICIENT_COPY} />
      ) : (
        <>
          {/* aria-hidden throughout: `summary` carries the identical sentence,
              and exposing both announced the same figures twice. */}
          <p className="lu-stat-readout" aria-hidden="true">
            <span className="lu-stat-value">{Math.round((model.rate as number) * 100)}%</span> of a
            typical night has played recently
          </p>
          {/* "up to N", never "the N sets before each one": `windowSets` is the
              window CEILING, not a count of sets that exist. At the
              exactly-2-surviving-sets boundary AC-2's gate is written to admit,
              there is exactly 1 predecessor, and naming 5 describes a history
              the DJ does not have. */}
          <p className="lu-disclosure" aria-hidden="true">
            Measured against the up to {model.windowSets} sets before each one, across{" "}
            {model.measuredSetCount} {model.measuredSetCount === 1 ? "night" : "nights"}
          </p>
        </>
      )}
    </div>
  );
}
