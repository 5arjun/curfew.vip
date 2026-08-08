"use client";

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { useState } from "react";
import {
  AGING_THRESHOLD_DAYS,
  RECENT_DOWNLOAD_DAYS,
  SHELF_ROW_CAP,
  agingShelfState,
  agingShelfSummary,
  type AgingShelfModel,
  type AgingShelfSort,
} from "@/lib/sets/agingShelf";
import { InsufficientHistory } from "@/app/components/style-evolution/InsufficientHistory";

/**
 * The "not yet possible" wait (AC-4), in the same positive, console-voice
 * register `libraryInsufficientCopy` established — and deliberately NOT
 * `InsufficientHistory`'s own default, which promises "two more sets and Style
 * Evolution has something to show you": the wrong page and the wrong wait.
 *
 * **It names the clock**, because "not enough data" with no reason reads as a
 * bug while naming the wait reads as a promise. And it says NOTHING about
 * whether tracks are getting played — that is the entire point of this state
 * existing (Context §4): under {@link AGING_THRESHOLD_DAYS} days of
 * observation no track can structurally qualify, so `EXPERIENCE.md`'s
 * "Everything you've bought is getting played." would be an affirmative false
 * claim to every DJ in their first three months, which is every DJ at launch.
 *
 * It also does NOT state elapsed subscription time. Decision B's copy rule is
 * binding: "since you joined" is a self-installed churn button.
 */
const NOT_YET_POSSIBLE_COPY = `Curfew is watching your library from here on. Once a track has gone ${AGING_THRESHOLD_DAYS} days without a play, it surfaces here.`;

/**
 * The day-one state (Context §4) — no agent has ever synced a roster, so there
 * is no library to have an opinion about. A different fact from an empty shelf,
 * and never collapsed into one: the same contract every other module on this
 * page honors for a brand-new account (Story 4.6 AC-3).
 */
const NOTHING_SYNCED_COPY =
  "Once Curfew has synced your library, the tracks going unplayed collect here.";

/**
 * The genuinely-clear state (AC-5) — `EXPERIENCE.md`'s aging-shelf-empty copy,
 * VERBATIM. Positive-framed, not gamified. It renders only where it is true:
 * observation of at least {@link AGING_THRESHOLD_DAYS} days AND zero qualifying
 * tracks. Everywhere else it would be a claim about a library Curfew has not
 * watched long enough to judge.
 */
const EVERYTHING_PLAYED_COPY = "Everything you've bought is getting played.";

/** How the active sort direction is said out loud — in the sort chips' own
 *  "Date · newest first" register, so the two controls read as one family. */
const SORT_LABEL: Record<AgingShelfSort, string> = {
  longest: "longest first",
  shortest: "shortest first",
};

/** "1 track" / "N tracks" — the shelf says this in four places. */
function trackCount(n: number): string {
  return `${n} ${n === 1 ? "track" : "tracks"}`;
}

/**
 * The aging shelf (Story 4.4, FR-12, UX-DR12) — Library Utilization's module
 * below Story 4.5's time-to-first-play.
 *
 * **Rendered by `page.tsx` directly, NOT inside `LibraryUtilizationView`**, for
 * the same reason `TimeToFirstPlay` is: that view is a client component whose
 * purpose is owning the one conversion window the meter and the trend share,
 * and this shelf has no trailing window at all. Nesting it there would put a
 * window-independent list under a control that visibly does not move it — the
 * inverse of the failure 4.7's AC-3 exists to prevent.
 *
 * **The rows are read-only, and that is a ruling** (Context §1, Arjun
 * 2026-08-08). UX-DR12 specifies a per-row "add to prep crate" action; it is
 * out of MVP because there is no cloud→agent command channel anywhere in this
 * system. Do not add a substitute affordance in its place — no dismiss, no
 * star, no "mark as reviewed". The sort control is this module's ONLY
 * interactive element, and the shelf is the report.
 *
 * **The sort is NOT persisted, deliberately** — a departure from the two
 * `useSyncExternalStore` + `localStorage` window controls on this page, which
 * is the house convention for a *window*. A window is a parameter of the
 * analysis: it changes what the numbers mean, so a DJ who tightens to 14 days
 * wants that to stick. A sort direction is a transient view of one fixed list
 * and changes nothing about what is true — and persisting it means a DJ who
 * once flipped to shortest-unplayed returns weeks later to a shelf whose top
 * row is the LEAST neglected track, an inverted default with nothing on screen
 * explaining it. Not persisting also avoids becoming the third copy of that
 * boilerplate, which `deferred-work.md` names as the point at which its
 * "not worth extracting at two copies" ruling should be re-checked rather than
 * silently deepened.
 *
 * A `"use client"` component solely because of that one `useState`. Everything
 * else — the whole model — is computed on the server and passed in.
 */
export function AgingShelf({ model }: { model: AgingShelfModel }) {
  const [sort, setSort] = useState<AgingShelfSort>("longest");

  const rows = model.rows[sort];

  // The four-state decision lives in the model (AC-4/AC-5, Context §4), not as
  // a ternary here — `agingShelfSummary` branches on the SAME function, which
  // is what makes the accessible name and the visible state structurally
  // unable to drift. 4.5's review found a section announcing a figure the UI
  // had explicitly declined to state; this module has three states where that
  // could recur (AC-13).
  const state = agingShelfState(model);
  // `sort` is passed, not omitted: the cap clause names WHICH end of the shelf
  // is listed, and the two ends share no rows. Leaving it out announced the
  // longest-unplayed 100 while the visible list showed the shortest — caught
  // in this story's browser pass.
  const summary = agingShelfSummary(model, sort);

  return (
    <section className="lu-module dz-shell" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      {/* No shelf-specific head class any more: the 34px chip leaves the
          320px header plenty of room, where the 139px `<select>` it replaced
          wrapped the label onto two lines and needed a wrap rule. */}
      <div className="lu-stat-head">
        {/* A real `<h2>`, not the `<p className="lu-stat-label">` the three
            modules above use. `deferred-work.md`'s open UI finding is that
            `/library-utilization` has NO `<h2>` at all, so heading-nav skips
            every module on the page; this is the first one it can reach.
            Deliberately not a blanket fix of the other three — R-10 (whether
            these module `<section>`s should become `<div role="group">`) is
            still unruled, and changing four components under an unruled
            finding is a different piece of work. Noted in Completion Notes
            rather than deepened silently. */}
        <h2 className="lu-stat-label">Aging shelf</h2>
        {state === "rows" && (
          /* A click-to-toggle icon chip in the Spotlight search's language
             (`SpotlightSearch`'s sort chips), NOT a dropdown — Arjun,
             2026-08-08. Same mechanics as those chips: one button carrying its
             own direction, `aria-label` naming the CURRENT state rather than
             the action, icon `aria-hidden`, and the state living in a plain
             `useState`.

             Deliberately NO `aria-pressed`, which those chips do carry: there
             they mark which of two sort KEYS is active, so "pressed" has a
             referent. This module has one key and two directions, so
             `aria-pressed` would have to mean "is ascending", which no screen
             reader would announce usefully — the label states the direction in
             words instead. `title` is added for the same reason a dropdown did
             not need one: an icon-only control has to be hoverable to be
             discoverable, and there is no search field here for the label to
             roll into the way the dashboard's does. */
          <button
            type="button"
            className="lu-shelf-sort"
            aria-label={`Days unplayed · ${SORT_LABEL[sort]}`}
            title={`Days unplayed · ${SORT_LABEL[sort]}`}
            onClick={() => setSort(sort === "longest" ? "shortest" : "longest")}
          >
            {sort === "longest" ? (
              <ArrowDownWideNarrow aria-hidden="true" />
            ) : (
              <ArrowUpNarrowWide aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {state === "rows" ? (
        <>
          {/* An ordered list because the order IS the content — this is a
              ranking by days unplayed, not an unordered collection. Rows carry
              no action and no link: they are read-only by ruling (AC-3).
              Not `aria-hidden`, unlike the sibling modules' readouts: the
              section's accessible name states the COUNT, and these rows are
              the track names themselves, which is content rather than a
              duplicate of it. */}
          <ol className="lu-shelf-list">
            {rows.map((row) => (
              <li className="lu-shelf-row" key={row.trackId}>
                <span className="lu-shelf-track">
                  <span className="lu-shelf-title">{row.title ?? "Untitled"}</span>
                  <span className="lu-shelf-artist">{row.artist ?? "Unknown artist"}</span>
                </span>
                {/* A plain day count, NOT `formatElapsed` — see this module's
                    note in the story's Dev Notes. That helper coarsens above
                    60 days to months and above a year to years, so a list
                    sorted BY days unplayed would render
                    "1 year / 1 year / 1 year / 11 months" and read as unsorted
                    or broken, precisely because the sort key is the value
                    being flattened. `formatElapsed` stays correct wherever a
                    coarse phrase is wanted; this is a call-site judgment, not
                    a defect in the helper. */}
                <span className="lu-shelf-days">
                  {row.daysUnplayed}
                  <span className="lu-shelf-days-unit"> days</span>
                </span>
              </li>
            ))}
          </ol>

          {/* AC-9 — the cap stated out loud. SM-C1's no-silent-caps contract:
              a truncated list that reads as the whole answer is the failure. */}
          {model.capped && (
            <p className="lu-disclosure">
              Showing the {sort === "longest" ? "longest" : "shortest"}-unplayed {SHELF_ROW_CAP} of{" "}
              {trackCount(model.qualifyingCount)}.
            </p>
          )}
        </>
      ) : state === "nothing-synced" ? (
        <InsufficientHistory copy={NOTHING_SYNCED_COPY} />
      ) : state === "not-yet-possible" ? (
        <InsufficientHistory copy={NOT_YET_POSSIBLE_COPY} />
      ) : (
        /* aria-hidden: `summary` states the all-clear on the section itself,
           so leaving this exposed announces the same fact twice. */
        <p className="lu-stat-empty" aria-hidden="true">
          {EVERYTHING_PLAYED_COPY}
        </p>
      )}

      {/* AC-7 — its own labelled block BELOW the list, never interleaved into
          the sorted rows and never counted into the aging total. These tracks
          have no add date and no observed play, so there is no clock to start:
          sorting them anywhere would be inventing a position, and omitting
          them would be the silent exclusion Architecture Spine OQ#2 forbids.
          Rendered as a count rather than a list — the DJ can act on "6% of my
          library has no add date", and listing them would put a second,
          differently-ordered track list under the first. */}
      {model.unknownAddDateCount > 0 && (
        <p className="lu-disclosure">
          {trackCount(model.unknownAddDateCount)} have no add date and no play on record, so there is
          no clock to run — not counted above.
        </p>
      )}

      {/* AC-6 — from RAW `added_at`, not the clamped clock: a real fact about
          the library rather than an inference about observation, which is why
          it renders even in the gated states above. `EXPERIENCE.md:97` places
          this nudge on the Dashboard as a banner; ruled here as a count line
          on this module (story Open Question #2) — a dashboard banner is a
          different page and unrequested scope, and a count line reverts
          cleanly if the banner is wanted instead. */}
      {model.recentlyDownloadedCount > 0 && (
        <p className="lu-disclosure">
          {trackCount(model.recentlyDownloadedCount)} added in the last {RECENT_DOWNLOAD_DAYS} days
          {model.recentlyDownloadedCount === 1 ? " hasn't" : " haven't"} been played yet.
        </p>
      )}

      {/* The fail-closed disclosure (AC-11). Without it the suppression is
          invisible: the shelf would simply be short, with nothing saying why,
          which is the "silently wrong list" shape this story exists to avoid.
          Reachable only when `getObservationStart` returned null — an RLS
          failure, a missing `djs` row, or a network fault. */}
      {model.observationSuppressed && model.suppressedNoPlayCount > 0 && (
        <p className="lu-disclosure">
          Curfew can&apos;t tell how long it has been watching your library right now, so{" "}
          {trackCount(model.suppressedNoPlayCount)} with no play on record are held back rather than
          aged from a date that might be wrong.
        </p>
      )}

      {/* Dates that don't survive contact with the clock — a future-dated add,
          or a play stamped in the future. Same clause and same register as the
          page's own `undatedDisclosure` line, deliberately: it is the identical
          fact about the identical rows, and this module reaching a different
          verdict from the one 200px above it is the disagreement
          `deferred-work.md`'s open three-way ruling is about. */}
      {model.unreconciledDateCount > 0 && (
        <p className="lu-disclosure">
          {trackCount(model.unreconciledDateCount)}{" "}
          {model.unreconciledDateCount === 1 ? "has a date" : "have dates"} Curfew can&apos;t
          reconcile — not counted here.
        </p>
      )}
    </section>
  );
}
