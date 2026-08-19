import {
  hasEnoughTimeToFirstPlayDebuts,
  hasEnoughTimeToFirstPlayTracks,
  isEarlyReadAverage,
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
 * Library Utilization's module below the Story 4.7 conversion pair.
 *
 * **Rendered by `page.tsx` directly, NOT inside `LibraryUtilizationView`.**
 * That view is a client component whose purpose is owning the one conversion
 * window the meter and the trend share; this metric is measured over the
 * lifetime population with no trailing window, so putting it under that
 * dropdown would imply a control governs a figure it does not move. See
 * `page.tsx`'s render block for the full reasoning — it is a deliberate
 * composition decision, not arrival order.
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
 * which dropped the "Time to first play" label and the `.lu-module` width
 * cap — leaving the day-one state (every DJ, by D-1's design) as an
 * unattributed full-width block under a much narrower meter (Story 4.5
 * review). That cap now comes from `.lu > .lu-module`: Story 4.7 retired the
 * blanket `.lu-module` rule once the meter moved into a 340px grid column,
 * which left this module — the one still parented by `.lu` — uncapped.
 *
 * Two gates, not one (AC-4): {@link hasEnoughTimeToFirstPlayTracks} decides
 * whether there is a population worth a module at all, and
 * {@link hasEnoughTimeToFirstPlayDebuts} decides whether enough tracks have
 * actually debuted for an average to mean anything. A DJ with 500 qualifying
 * tracks and one debut clears the first and fails the second.
 */
export function TimeToFirstPlay({ model }: { model: TimeToFirstPlayModel }) {
  const playedCount = playedCountOf(model);
  const showAverage = hasEnoughTimeToFirstPlayDebuts(model);
  const enoughTracks = hasEnoughTimeToFirstPlayTracks(model);

  // Below the population gate the module deliberately states no figure, so the
  // accessible name must not state one either. `timeToFirstPlaySummary` is
  // gate-blind by design (it describes the data, not the rendering decision),
  // and using it here had the section announce "3 tracks have been added but
  // not played yet — averaging 10 months on the shelf" while the visible
  // module said only "not enough yet" — an accessible name making a claim the
  // UI had explicitly declined to make (browser pass, 2026-08-07). The label
  // falls back to naming the region; `InsufficientHistory`'s own `role="status"`
  // already carries the explanatory copy to AT.
  const summary = enoughTracks ? timeToFirstPlaySummary(model) : "Time to first play";

  return (
    // `role="group"`, not `<section>` (Story 4.9; deferred-work R-10) — see
    // `ConversionRateMeter` for the reasoning. The accessible name is retained
    // exactly; only its landmark status is dropped.
    // `.lu-strip` (Arjun, 2026-08-18): this module is now the full width of the
    // page rather than half of a row whose other half is the 447px aging shelf,
    // so its content lays out along the row instead of down a column three
    // lines deep in a card six times that tall. Same treatment, same class, as
    // the conversion meter at the top of the page — the two are the page's only
    // one-figure-and-a-sentence modules. See `page.tsx`'s "First play" block.
    <div className="lu-module lu-strip dz-shell" role="group" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      <div className="lu-stat-head">
        <h3 className="lu-stat-label">Time to first play</h3>
      </div>

      {!enoughTracks ? (
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
          {/* The mean is typically off by a factor of two at the debut gate of
              5, and still ~40% out at 30 — measured, see
              TIME_TO_FIRST_PLAY_EARLY_READ_DEBUTS. Rather than raise the gate
              (which would hide the module from every DJ for months), the
              average carries the SAME "early read" hedge the conversion meter
              200px above already uses below its own confidence floor. Same
              class, same copy shape, same voice. aria-hidden because `summary`
              carries the identical sentence. */}
          {isEarlyReadAverage(model) && (
            <p className="lu-disclosure" aria-hidden="true">
              Only {playedCount} {playedCount === 1 ? "debut" : "debuts"} so far — early read
            </p>
          )}
        </>
      ) : (
        <p className="lu-stat-empty" aria-hidden="true">
          {model.neverPlayedCount > 0
            ? `${model.neverPlayedCount} ${model.neverPlayedCount === 1 ? "track has" : "tracks have"} been added but not played yet${
                // Carries the shelf age the `aria-label` states, so the two
                // branches say the same thing (browser pass, 2026-08-07).
                model.neverPlayedAverageAgeMs !== null
                  ? ` — averaging ${formatElapsed(model.neverPlayedAverageAgeMs)} on the shelf`
                  : ""
              }.`
            : // Never "No tracks have debuted yet" when the population is made
              // of tracks the DJ demonstrably played — mirrors the generator.
              timeToFirstPlaySummary(model)}
        </p>
      )}
    </div>
  );
}
