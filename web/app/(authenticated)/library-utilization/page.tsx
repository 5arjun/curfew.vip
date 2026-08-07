import { getLibraryAddEvents, getRecentSets } from "@/lib/sets";
import {
  buildLibraryConversion,
  buildLiveConversionRate,
  CONVERSION_WINDOWS,
  firstPlayByTrack,
} from "@/lib/sets/libraryConversion";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import { LibraryUtilizationView } from "@/app/components/library-utilization/LibraryUtilizationView";

// Library Utilization (Story 4.3, AC-5; Story 4.7, AC-3) — supersedes the
// Story 3.5 throwaway stub. Reads through the SAME data-access seam
// `style-evolution/page.tsx` uses (`getRecentSets`, `getLibraryAddEvents`).
//
// Story 4.7 AC-3 moved Style Evolution's library-conversion TREND here
// (`buildLibraryConversion`), alongside Story 4.3's LIVE meter
// (`buildLiveConversionRate`) — same underlying add-events/sets, two
// deliberately different computations (see `libraryConversion.ts`'s own
// doc comments on why the live meter is not a read of the cohort model).
// Both share ONE conversion-window selection (`LibraryUtilizationView`).
//
// Unlike the trend's OWN insufficient-history state (rendered inside
// `LibraryConversionTrend`), this page has no page-level gate: the meter is
// a live snapshot that already renders "zero tracks added" honestly on its
// own, and the trend's insufficient state is scoped to itself, not the page.
export default async function LibraryUtilizationPage() {
  const [sets, addEvents] = await Promise.all([getRecentSets(), getLibraryAddEvents()]);
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

  return (
    <main className="lu">
      <SilkBackdrop />
      <header className="lu-header">
        <h1 className="lu-title">Library Utilization</h1>
        <p className="lu-subtitle">How much of your library actually makes it to the dancefloor.</p>
      </header>

      <LibraryUtilizationView rates={rates} library={library} />
    </main>
  );
}
