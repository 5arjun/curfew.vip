import {
  hasEnoughTimeToFirstPlayDebuts,
  hasEnoughTimeToFirstPlayTracks,
  playedCountOf,
  timeToFirstPlaySummary,
  type TimeToFirstPlayModel,
} from "@/lib/sets/libraryConversion";
import { formatElapsed } from "@/lib/sets/format";
import { InsufficientHistory } from "@/app/components/style-evolution/InsufficientHistory";

/**
 * Time-to-first-play's own insufficient-history copy (AC-4), in the same
 * positive, console-voice register as `LIBRARY_INSUFFICIENT_COPY` (that
 * string is deliberately NOT reused here — it explains the conversion
 * cohort's 90-day wait, a different condition from this metric's "not
 * enough qualifying tracks yet," and reusing mismatched copy would be its
 * own honesty bug — Story 4.3 Task 4's ruling on the identical question).
 *
 * Phrased against tracks **added**, because that is what the gate actually
 * counts. The first shipped version said "once a few more of those tracks get
 * their first spin, this fills in" while gating on adds — telling a DJ whose
 * four qualifying tracks had all already played to go play them (Story 4.5
 * review).
 */
const TIME_TO_FIRST_PLAY_INSUFFICIENT_COPY =
  "Curfew is watching what you add from here on. Once a few more tracks land in your library, this fills in.";

/**
 * The time-to-first-play module (Story 4.5, AC-1/AC-2/AC-3/AC-4/AC-5) —
 * Library Utilization's second module, alongside the Story 4.3 conversion
 * meter.
 *
 * No shipped UX-DR wireframe covers this component's shape — this story's
 * Context & Authority section documents that as a dev-time design call, not
 * a spec gap. The average reads through the same `.lu-stat-*` classes the
 * conversion meter already established (`library-utilization.css`) rather
 * than adding a divergent visual language for one more module on the same
 * page.
 *
 * **Every branch renders inside the module shell.** The first shipped version
 * returned a bare `<InsufficientHistory>` in place of the whole section,
 * which dropped the "Time to first play" label and the `.lu-module` 440px
 * cap — leaving the day-one state (every DJ, by D-1's design) as an
 * unattributed full-width block under a 440px meter (Story 4.5 review).
 *
 * Two gates, not one (AC-4): {@link hasEnoughTimeToFirstPlayTracks} decides
 * whether there is a population worth a module at all, and
 * {@link hasEnoughTimeToFirstPlayDebuts} decides whether enough tracks have
 * actually debuted for an average to mean anything. A DJ with 500 qualifying
 * tracks and one debut clears the first and fails the second.
 */
export function TimeToFirstPlay({ model }: { model: TimeToFirstPlayModel }) {
  const summary = timeToFirstPlaySummary(model);
  const playedCount = playedCountOf(model);
  const showAverage = hasEnoughTimeToFirstPlayDebuts(model);

  return (
    <section className="lu-module dz-shell" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      <div className="lu-stat-head">
        <p className="lu-stat-label">Time to first play</p>
      </div>

      {!hasEnoughTimeToFirstPlayTracks(model) ? (
        <InsufficientHistory copy={TIME_TO_FIRST_PLAY_INSUFFICIENT_COPY} />
      ) : showAverage ? (
        <>
          {/* Still scoped to the tracks that actually debuted (a bare
              "average from add to first spin" would tell a sighted user the
              number covered the whole library, while the accessible name
              correctly scoped it — 55% of the population has never played on
              real data), but the scope now rides on a short "across N debuts"
              rather than a clause. "from add to first spin" is dropped
              outright: the module label directly above already says it, and
              the readout was wrapping to three lines at 375px (Arjun,
              2026-08-07). */}
          <p className="lu-stat-readout" aria-hidden="true">
            <span className="lu-stat-value">{formatElapsed(model.averageElapsedMs as number)}</span> average across{" "}
            {playedCount} debuts
          </p>
          {model.neverPlayedCount > 0 && (
            /* aria-hidden: `summary` already states this count on the section
               itself, so leaving it exposed had screen readers announce the
               same population twice in two registers. */
            <p className="lu-disclosure" aria-hidden="true">
              {model.neverPlayedCount} still unplayed
              {model.neverPlayedAverageAgeMs !== null &&
                `, averaging ${formatElapsed(model.neverPlayedAverageAgeMs)} on the shelf`}
            </p>
          )}
        </>
      ) : (
        <p className="lu-stat-empty" aria-hidden="true">
          {model.neverPlayedCount > 0
            ? `${model.neverPlayedCount} ${model.neverPlayedCount === 1 ? "track has" : "tracks have"} been added but not played yet.`
            : "No tracks have debuted yet."}
        </p>
      )}
    </section>
  );
}
