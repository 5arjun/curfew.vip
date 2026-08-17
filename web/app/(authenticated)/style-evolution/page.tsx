import { getDjTimezone, getRecentSets } from "@/lib/sets";
import { buildStyleEvolution } from "@/lib/sets/styleEvolution";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import { StyleEvolutionView } from "@/app/components/style-evolution/StyleEvolutionView";

// Style Evolution (Story 4.1; sectioned per Story 4.7). Reads through the
// SAME data-access seam as the dashboard (`getRecentSets`,
// `web/lib/sets/index.ts:36-38`) — despite the "recent" name it already
// returns the DJ's full synced history, so no new data-access function is
// needed. Server component computes the pure model and hands it to a client
// sub-component that owns the granularity/reveal controls + the three
// always-visible sections + the summary tile row (Task 7, Story 4.1;
// restructured Story 4.7).
//
// Story 4.7 AC-3: the library/digging metric (Story 4.2) moved to
// `/library-utilization` — this page no longer reads `getLibraryAddEvents`
// or computes `buildLibraryConversion` at all.
//
// Story 4.7 AC-8: there is no longer a page-level gate here. The old
// `monthsSpannedAll < 2 ? <InsufficientHistory /> : <StyleEvolutionView />`
// blanked the ENTIRE page for a DJ with one month of history — including the
// summary tiles, which are aggregate and read honestly off a single set.
// `StyleEvolutionView` now always renders; the narrower gate lives inside it,
// scoped to the three trend sections only.
// Story 7.7 code review (2026-08-17): this page was the ONE bucketing surface
// that never fetched `djs.timezone`. `buildStyleEvolution`'s `djTimezone`
// defaults to `null` so a fixture-backed test can omit it, which is also why
// the omission typechecked and why the UTC-pinned suite stayed green — a DJ on
// a pre-7.7 agent still had their 11pm New Year's Eve gig filed under January
// here, on the one page whose whole subject is month-over-month movement.
// `Promise.all` rather than two awaits: the two reads are independent, and this
// is the shape every other converted page uses.
export default async function StyleEvolutionPage() {
  const [sets, djTimezone] = await Promise.all([getRecentSets(), getDjTimezone()]);
  const model = buildStyleEvolution(sets, djTimezone);

  return (
    <main className="se">
      <SilkBackdrop />
      <header className="se-header">
        <h1 className="se-title">Style Evolution</h1>
        <p className="se-subtitle">How your BPM range, genre mix, and key usage have moved, month over month.</p>
      </header>

      <StyleEvolutionView model={model} />
    </main>
  );
}
