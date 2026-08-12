import {
  hasEnoughOneAndDone,
  oneAndDoneSummary,
  ONE_AND_DONE_VISIBLE_ROWS,
  trackKey,
  type OneAndDoneModel,
} from "@/lib/sets/libraryUtilization";
import { formatDayDate } from "@/lib/sets/format";
import { InsufficientHistory } from "@/app/components/style-evolution/InsufficientHistory";
import { TrackRowList } from "./TrackRowList";

/**
 * This module's OWN insufficient-history copy (AC-9) — and there are **two**
 * of them, because `rows.length === 0` has two causes that mean opposite
 * things.
 *
 * Every track came round again, versus nothing has been played at all. One
 * string cannot describe both: on an empty account the first reading asserts a
 * fact about a population that does not exist ("every track you've played has
 * come round again" — to a DJ who has played nothing), and production is empty
 * today, so that was the sentence every user saw. This is the same
 * gate-counts-one-thing-while-the-copy-describes-another defect Story 4.5's
 * review found (a gate counting *adds* beside copy telling the DJ to go
 * *play*), which is why the module-specific-copy rule exists at all.
 */
const ONE_AND_DONE_NO_PLAYS_COPY =
  "Nothing here yet. Once you've played a few sets, anything you try once and move on from lands here.";

const ONE_AND_DONE_ALL_REPEATED_COPY =
  "Nothing here yet — every track you've played has come round again. Anything you try once and move on from lands here.";

/**
 * One-and-done (Story 4.9, AC-6) — tracks played exactly once: the actionable
 * mirror of AC-5's workhorses.
 *
 * **Reads as a complement to Story 4.4's aging shelf, not a duplicate of it.**
 * Both are "neglect" lists (FR-12) sharing this page, so the distinction is
 * recorded here rather than left to be inferred: *this* list is about tracks
 * the DJ **did** play and dropped; the shelf is about tracks **never reached
 * at all**. Same theme, opposite sides of the first play. This one is paired
 * with the workhorses list it mirrors, which is why it does not sit next to
 * the shelf despite the shared theme.
 *
 * Ordered most-recently-played first — the track tried last week is the one
 * worth another look. The date is on the row because "once, in March" and
 * "once, on Friday" are different prompts.
 */
export function OneAndDone({ model }: { model: OneAndDoneModel }) {
  const ready = hasEnoughOneAndDone(model);
  const summary = oneAndDoneSummary(model);

  return (
    <div className="lu-module dz-shell" role="group" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      <div className="lu-stat-head">
        <h3 className="lu-stat-label">Played once</h3>
      </div>

      {!ready ? (
        <InsufficientHistory
          copy={
            model.identifiedTrackCount === 0
              ? ONE_AND_DONE_NO_PLAYS_COPY
              : ONE_AND_DONE_ALL_REPEATED_COPY
          }
        />
      ) : (
        <>
          {/* The "Tracks you reached for once and haven't come back to" line is
              GONE (Arjun, 2026-08-12) — see `Workhorses.tsx` for the reasoning,
              which is the same here: already `aria-hidden`, already restated by
              the heading and by the date in the value column. */}
          <TrackRowList
            rows={model.rows.map((row) => ({
              // Through D-18's helper, not an ad-hoc `title + " " + artist`:
              // that form collides across a title/artist boundary shift
              // ("Deep Inside"/"Hardrive" vs "Deep"/"Inside Hardrive"), giving
              // duplicate React keys — the exact collision `trackKey`'s
              // JSON encoding exists to prevent and `libraryUtilization.test.ts`
              // already pins for the model.
              key: trackKey(row.title, row.artist),
              title: row.title,
              artist: row.artist,
              // Story 4.10 AC-3/AC-4 (D-26) — see `Workhorses.tsx`'s note.
              trackId: row.trackId,
              // `-Infinity` means no play carried a parseable time. An em dash
              // says "unknown" without inventing a date, which is the same
              // "never omitted, never guessed" contract AD-11 asks for.
              value: Number.isFinite(row.lastPlayedMs)
                ? formatDayDate(new Date(row.lastPlayedMs).toISOString())
                : "—",
            }))}
            visibleRows={ONE_AND_DONE_VISIBLE_ROWS}
          />
          {/* Same D-19 treatment as Workhorses. Most-recent-first ordering
              makes the cap benign here — the rows worth acting on are the ones
              kept — but it still has to say so. */}
          {model.truncated && (
            <p className="lu-disclosure" aria-hidden="true">
              Your {model.rows.length} most recent, of {model.totalRowCount}
            </p>
          )}
        </>
      )}
    </div>
  );
}
