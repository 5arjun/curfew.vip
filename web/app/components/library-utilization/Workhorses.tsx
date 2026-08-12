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
          {/* The "Tracks you keep coming back to, by how many sets they turn up
              in" line is GONE (Arjun, 2026-08-12). It was already `aria-hidden`
              — the module's `aria-label` carries the same finding — so it was
              costing a line of prose above every list on this page to restate a
              heading ("Workhorses") beside a value column that literally reads
              "N sets · M plays". Nothing was lost with it. */}
          <TrackRowList
            rows={model.rows.map((row) => ({
              // Through D-18's helper. The previous form embedded a raw NUL
              // byte as the separator, which made this whole file BINARY to
              // git — invisible in `git diff`, `git log -p`, PR review and
              // `grep -r`, while every gate stayed green.
              key: trackKey(row.title, row.artist),
              title: row.title,
              artist: row.artist,
              // Story 4.10 AC-3/AC-4 (D-26): `null` renders the title as plain
              // text rather than a dead link, and is counted once at page level
              // by `unlinkableTracksDisclosure` — never per row.
              trackId: row.trackId,
              value: `${row.setCount} sets · ${row.plays} plays`,
            }))}
            visibleRows={WORKHORSES_VISIBLE_ROWS}
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
