import { getLibraryAddEvents, getRecentSets } from "@/lib/sets";
import {
  buildLiveConversionRate,
  buildTimeToFirstPlay,
  firstPlayByTrack,
  playsByTrack,
  undatedDisclosure,
  LIVE_CONVERSION_WINDOWS,
} from "@/lib/sets/libraryConversion";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import { ConversionRateMeter } from "@/app/components/library-utilization/ConversionRateMeter";
import { TimeToFirstPlay } from "@/app/components/library-utilization/TimeToFirstPlay";

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
  // `firstPlay` is built once and shared across all three windows (Story 4.3
  // review) rather than each `buildLiveConversionRate` call re-diffing `sets`.
  const firstPlay = firstPlayByTrack(sets);
  const rates = Object.fromEntries(
    LIVE_CONVERSION_WINDOWS.map((window) => [
      window,
      buildLiveConversionRate(addEvents.events, sets, addEvents.readAtMs, window, firstPlay),
    ]),
  ) as Record<(typeof LIVE_CONVERSION_WINDOWS)[number], ReturnType<typeof buildLiveConversionRate>>;

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

  // Rendered ONCE for the page, not once per module (Story 4.5 review). Both
  // modules read the same `addEvents.events` and `noAddDateCount` is
  // window-independent, so leaving each to render its own produced the
  // identical sentence twice, 200px apart, reading as a bug. Invisible on the
  // committed fixture (the count is 0) and live once Story 4.6 lands.
  const undatedNote = undatedDisclosure(
    { noAddDateCount: timeToFirstPlay.noAddDateCount, pendingCohortCount: 0 },
    0,
  );

  return (
    <main className="lu">
      <SilkBackdrop />
      <header className="lu-header">
        <h1 className="lu-title">Library Utilization</h1>
        <p className="lu-subtitle">How much of your library actually makes it to the dancefloor.</p>
      </header>

      <ConversionRateMeter rates={rates} />
      <TimeToFirstPlay model={timeToFirstPlay} />
      {undatedNote && <p className="lu-disclosure">{undatedNote}</p>}
    </main>
  );
}
