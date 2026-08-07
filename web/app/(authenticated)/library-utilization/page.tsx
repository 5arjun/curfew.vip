import { getLibraryAddEvents, getRecentSets } from "@/lib/sets";
import { buildLiveConversionRate, LIVE_CONVERSION_WINDOWS } from "@/lib/sets/libraryConversion";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import { ConversionRateMeter } from "@/app/components/library-utilization/ConversionRateMeter";

// Library Utilization (Story 4.3, AC-5) — supersedes the Story 3.5 throwaway
// stub. Reads through the SAME data-access seam `style-evolution/page.tsx`
// uses (`getRecentSets`, `getLibraryAddEvents`); this route's first real
// content, so no per-page conventions to match beyond that data-seam pattern.
//
// Unlike Style Evolution's trend chart, the meter needs no page-level
// insufficient-history gate: it is a live snapshot, not a multi-point trend,
// so "zero tracks added in the window" is just one more state the meter
// itself already renders honestly (`ConversionRateMeter`'s own empty branch)
// rather than a condition sparse enough to misrepresent.
export default async function LibraryUtilizationPage() {
  const [sets, addEvents] = await Promise.all([getRecentSets(), getLibraryAddEvents()]);
  // Decision E-1: the LIVE current-window rate, not a read of the Story 4.2
  // cohort model — see `buildLiveConversionRate`'s own doc comment. The clock
  // comes from the data seam (`readAtMs`), never read in render (Story 4.1's
  // review lesson; `react-hooks/purity` rejects `Date.now()` here besides).
  //
  // Every selectable window is precomputed here, up front — the dropdown
  // (Arjun, 2026-08-07) just looks one up, matching D-13's "no work happens
  // on click" discipline the trend chart's own window toggle established.
  const rates = Object.fromEntries(
    LIVE_CONVERSION_WINDOWS.map((window) => [
      window,
      buildLiveConversionRate(addEvents.events, sets, addEvents.readAtMs, window),
    ]),
  ) as Record<(typeof LIVE_CONVERSION_WINDOWS)[number], ReturnType<typeof buildLiveConversionRate>>;

  return (
    <main className="lu">
      <SilkBackdrop />
      <header className="lu-header">
        <h1 className="lu-title">Library Utilization</h1>
        <p className="lu-subtitle">How much of your library actually makes it to the dancefloor.</p>
      </header>

      <ConversionRateMeter rates={rates} />
    </main>
  );
}
