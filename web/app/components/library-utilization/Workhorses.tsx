import {
  hasEnoughWorkhorses,
  trackKey,
  workhorsesSummary,
  WORKHORSES_VISIBLE_ROWS,
  type WorkhorsesModel,
} from "@/lib/sets/libraryUtilization";
import { InsufficientHistory } from "@/app/components/style-evolution/InsufficientHistory";
import { TrackRowList } from "./TrackRowList";

/**
 * This module's OWN insufficient-history copy (AC-9). The gate counts TRACKS
 * THAT APPEARED IN MORE THAN ONE SET, and the sentence describes that same
 * quantity rather than borrowing a neighbour's string.
 */
const WORKHORSES_INSUFFICIENT_COPY =
  "Nothing has crossed between sets yet. As tracks start turning up on more than one night, they collect here.";

/**
 * Workhorses (Story 4.9, AC-5) — tracks ranked by **the number of sets they
 * appeared in**, not by play count.
 *
 * **This is a different question from the dashboard's most-played card, and
 * the two must never be reconciled.** Most-played ranks by play count, over
 * the last 10 non-low-confidence sets, scoped to each set's detected
 * dancefloor segment. This ranks by distinct-set count, over the whole
 * surviving population, across whole sets. Most-played answers "what did I
 * hammer lately"; this answers "what do I actually lean on". The full
 * side-by-side lives on `buildWorkhorses` itself, so it survives into code
 * review rather than only into the story file.
 *
 * Play count is shown but never ranks — it is context for the set count beside
 * it, and printing it is what makes the difference from most-played legible
 * instead of merely documented.
 */
export function Workhorses({ model }: { model: WorkhorsesModel }) {
  const ready = hasEnoughWorkhorses(model);
  const summary = workhorsesSummary(model);

  return (
    <div className="lu-module dz-shell" role="group" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      <div className="lu-stat-head">
        <h3 className="lu-stat-label">Workhorses</h3>
      </div>

      {!ready ? (
        <InsufficientHistory copy={WORKHORSES_INSUFFICIENT_COPY} />
      ) : (
        <>
          {/* aria-hidden: the section's `aria-label` already states the count
              and names the lead track, and leaving this exposed announced the
              same figure twice in two registers (Story 4.5's review, twice).
              Every other module on this page already does it this way. */}
          <p className="lu-stat-empty" aria-hidden="true">
            Tracks you keep coming back to, by how many sets they turn up in.
          </p>
          <TrackRowList
            rows={model.rows.map((row) => ({
              // Through D-18's helper. The previous form embedded a raw NUL
              // byte as the separator, which made this whole file BINARY to
              // git — invisible in `git diff`, `git log -p`, PR review and
              // `grep -r`, while every gate stayed green.
              key: trackKey(row.title, row.artist),
              title: row.title,
              artist: row.artist,
              value: `${row.setCount} sets · ${row.plays} plays`,
            }))}
            visibleRows={WORKHORSES_VISIBLE_ROWS}
            moreLabel={(n) => `Show the other ${n}`}
          />
          {/* D-19's rule, applied to the row cap: a silent truncation of a list
              the DJ reads as "everything" is the failure. Stated only when the
              cap actually bites. */}
          {model.truncated && (
            <p className="lu-disclosure" aria-hidden="true">
              Your {model.rows.length} most-carried tracks, of {model.totalRowCount}
            </p>
          )}
        </>
      )}
    </div>
  );
}
