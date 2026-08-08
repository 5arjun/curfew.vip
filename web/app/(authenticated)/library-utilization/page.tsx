import { getLibraryAddEvents, getLibraryRoster, getRecentSets } from "@/lib/sets";
import {
  buildLibraryConversion,
  buildLiveConversionRate,
  buildTimeToFirstPlay,
  CONVERSION_WINDOWS,
  firstPlayByTrack,
  playsByTrack,
  undatedDisclosure,
  unreconciledDateCount,
} from "@/lib/sets/libraryConversion";
import { unidentifiableTracksDisclosure } from "@/lib/sets/libraryRoster";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import { LibraryUtilizationView } from "@/app/components/library-utilization/LibraryUtilizationView";
import { TimeToFirstPlay } from "@/app/components/library-utilization/TimeToFirstPlay";

// Library Utilization (Story 4.3, AC-5; Story 4.5; Story 4.7, AC-3) —
// supersedes the Story 3.5 throwaway stub. Reads through the SAME data-access
// seam `style-evolution/page.tsx` uses (`getRecentSets`,
// `getLibraryAddEvents`), plus `getLibraryRoster` (Story 4.11) for the
// disclosure below.
//
// Story 4.7 AC-3 moved Style Evolution's library-conversion TREND here
// (`buildLibraryConversion`), alongside Story 4.3's LIVE meter
// (`buildLiveConversionRate`) — same underlying add-events/sets, two
// deliberately different computations (see `libraryConversion.ts`'s own
// doc comments on why the live meter is not a read of the cohort model).
// Both share ONE conversion-window selection (`LibraryUtilizationView`).
//
// **The page has two tiers, and the split is the conversion window.**
// `LibraryUtilizationView` is a client component whose whole reason to exist
// is owning that ONE shared selection; everything it renders is governed by
// the dropdown in its head. Story 4.5's time-to-first-play is measured over
// the lifetime population with no trailing window at all, so it sits OUTSIDE
// that view as a sibling here — see the render block below for why that
// placement is the load-bearing part, not an arrangement detail.
//
// Unlike the trend's OWN insufficient-history state (rendered inside
// `LibraryConversionTrend`), this page has no page-level gate: the meter is
// a live snapshot that already renders "zero tracks added" honestly on its
// own, the trend's insufficient state is scoped to itself, and Story 4.5's
// module renders its own two gates inside its own shell.
export default async function LibraryUtilizationPage() {
  const [sets, addEvents, roster] = await Promise.all([
    getRecentSets(),
    getLibraryAddEvents(),
    getLibraryRoster(),
  ]);
  // Story 4.11 AC-6: measured 27.7% (252/910) of Arjun's real catalogue rows
  // excluded for having no resolvable title/artist at all — well above the
  // ~5% materiality bar, so this renders, not silently omitted. (The 272/930
  // this comment carried until now predates 4.11's own review, which dropped
  // the 20 video files from both counts; the committed fixture has always
  // said 252/910.)
  const unidentifiableDisclosure = unidentifiableTracksDisclosure(
    roster.excludedNoIdentityCount,
    roster.totalCatalogueRows,
  );
  // Decision E-1: the LIVE current-window rate, not a read of the Story 4.2
  // cohort model — see `buildLiveConversionRate`'s own doc comment. The clock
  // comes from the data seam (`readAtMs`), never read in render (Story 4.1's
  // review lesson; `react-hooks/purity` rejects `Date.now()` here besides).
  //
  // Every selectable window is precomputed here, up front — the dropdown
  // just looks one up, matching D-13's "no work happens on click" discipline
  // the trend's own window toggle established. `firstPlay` is built once and
  // shared across all three windows (Story 4.3 review) rather than each
  // `buildLiveConversionRate` call re-diffing `sets`.
  const firstPlay = firstPlayByTrack(sets);
  const rates = Object.fromEntries(
    CONVERSION_WINDOWS.map((window) => [
      window,
      buildLiveConversionRate(addEvents.events, sets, addEvents.readAtMs, window, firstPlay),
    ]),
  ) as Record<(typeof CONVERSION_WINDOWS)[number], ReturnType<typeof buildLiveConversionRate>>;
  const library = buildLibraryConversion(addEvents.events, sets, addEvents.readAtMs);

  // Story 4.5, AC-1/AC-2: the population boundary ("tracks added on or after
  // the DJ's subscription start") needs no extra filter here — see the
  // story's Context & Authority section. `addEvents.events` can only ever
  // contain go-forward adds (Story 4.2's D-1 baseline-then-diff design), so
  // it is already the qualifying population.
  //
  // NOTE (Story 4.5 review): that guarantee holds for DATED rows only. The
  // agent emits undated tracks unconditionally (`capture.rs`'s baseline
  // partition can only compare a date it has), so an undated row may predate
  // observation — which is why they are excluded from the math and disclosed
  // as a count rather than being trusted into the population.
  //
  // Needs its OWN play index, not the `firstPlay` map above: this metric asks
  // for the first play at-or-after each track's add date, a question a global
  // earliest-play value answers wrongly for any track played both before and
  // after its add (see `playsByTrack`). The clock comes from the data seam
  // (`readAtMs`), never read in render.
  const playIndex = playsByTrack(sets);
  const timeToFirstPlay = buildTimeToFirstPlay(addEvents.events, sets, addEvents.readAtMs, playIndex);

  // Rendered ONCE for the page, not once per module (Story 4.5 review). The
  // meter and this story's module read the same `addEvents.events` and
  // `noAddDateCount` is window-independent, so leaving each to render its own
  // produced the identical sentence twice, 200px apart, reading as a bug.
  // That dedup is now MORE load-bearing than when it was ruled, not less:
  // Story 4.7 put the meter and the trend side by side in one row, so the
  // meter's own copy would have sat inches from the trend's — which opens with
  // the same "N tracks have no known add date" clause — rather than a screen
  // away. `ConversionRateMeter` accordingly no longer builds its own.
  //
  // The trend KEEPS its own, and that is not an inconsistency: its disclosure
  // also carries `pendingCohortCount`, which is genuinely window-dependent, so
  // it belongs inside the window-governed section where it changes with the
  // dropdown. This note carries only clauses that do not.
  //
  // Carries the unreconciled-date count too (Story 4.5 review, findings 1+3):
  // tracks whose plays all predate their add date, and tracks with a
  // future-dated add. Both were excluded from every figure the module states
  // and named nowhere — the first also passed the population gate, so a DJ
  // with 20 tracks, 6 debuts and 14 of these saw a module reporting on 6 and
  // mentioning nothing. Deliberately NOT folded into `noAddDateCount`: those
  // tracks have a date, it just can't be reconciled.
  //
  // `window: 0` is deliberate and safe: the argument is interpolated ONLY into
  // the `pendingCohortCount` clause, which is pinned to 0 here because neither
  // module this note covers has cohorts. No "0-day window" string can reach a
  // DJ. Story 4.7's collapse of the two window scales into one
  // `CONVERSION_WINDOWS` did not disturb that — the parameter is still a plain
  // `number`, precisely so a window-independent caller can opt out like this.
  //
  // Invisible on the committed fixture (both counts are 0) and live on real
  // data now that Story 4.6 has landed.
  const undatedNote = undatedDisclosure(
    {
      noAddDateCount: timeToFirstPlay.noAddDateCount,
      unreconciledDateCount: unreconciledDateCount(timeToFirstPlay),
      pendingCohortCount: 0,
    },
    0,
  );

  return (
    <main className="lu">
      <SilkBackdrop />
      <header className="lu-header">
        <h1 className="lu-title">Library Utilization</h1>
        <p className="lu-subtitle">How much of your library actually makes it to the dancefloor.</p>
      </header>

      <LibraryUtilizationView
        rates={rates}
        library={library}
        unidentifiableDisclosure={unidentifiableDisclosure}
      />

      {/* OUTSIDE `LibraryUtilizationView`, deliberately — this is the merge's
          real decision, so it is written down rather than left to look like
          arrival order.

          That view renders one `<section className="lu-conversion">` with the
          shared window dropdown in its head and the meter and trend in its
          body. Everything inside that landmark is governed by the dropdown.
          Time-to-first-play is measured over the lifetime population and has
          no trailing window, so nesting it there would put a window-independent
          figure under a control that visibly does not move it — the same
          "two modules disagreeing on screen" failure 4.7's AC-3 exists to
          prevent, just inverted: not two controls for one number, but one
          control appearing to own a number it does not.

          Being a sibling of the section, not a child of it, is what makes the
          scoping legible rather than merely documented. It also keeps this a
          SERVER component: `LibraryUtilizationView` is `"use client"` only
          because it owns window state, and a module with no state and no
          interactivity has no reason to be dragged across that boundary.

          Below the pair rather than above it, per `LibraryUtilizationView`'s
          own note that further modules are expected to grow below it. */}
      <TimeToFirstPlay model={timeToFirstPlay} />

      {/* Last, so it sits under everything it speaks for — the meter (which no
          longer renders its own) and the module directly above. */}
      {undatedNote && <p className="lu-disclosure">{undatedNote}</p>}
    </main>
  );
}
