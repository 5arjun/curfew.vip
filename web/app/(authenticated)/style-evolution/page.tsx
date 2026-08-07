import { getLibraryAddEvents, getRecentSets } from "@/lib/sets";
import { buildLibraryConversion } from "@/lib/sets/libraryConversion";
import { buildStyleEvolution } from "@/lib/sets/styleEvolution";
import { SilkBackdrop } from "@/app/components/dashboard/SilkBackdrop";
import { InsufficientHistory } from "@/app/components/style-evolution/InsufficientHistory";
import { StyleEvolutionView } from "@/app/components/style-evolution/StyleEvolutionView";

// Style Evolution (Story 4.1) — supersedes the Story 3.5 throwaway stub.
// Reads through the SAME data-access seam as the dashboard (`getRecentSets`,
// `web/lib/sets/index.ts:36-38`) — despite the "recent" name it already
// returns the DJ's full synced history, so no new data-access function is
// needed. Server component computes the pure model (Task 1) and hands it to
// a client sub-component that owns the chip-toggle + chart + reveal
// interactivity (Task 7) — the dashboard's own server-page/client-component
// split.
export default async function StyleEvolutionPage() {
  const [sets, addEvents] = await Promise.all([getRecentSets(), getLibraryAddEvents()]);
  const model = buildStyleEvolution(sets);
  // Story 4.2 (FR-10, D-6): computed here in `web/`, as a pure function over
  // already-fetched records — the same convention every other stat in
  // `lib/sets/*` follows. The clock comes from the data seam (`readAtMs`,
  // mirroring `getAgentStatus`) rather than being read in render: the cohort
  // math must be handed the time, never read it (Story 4.1's review lesson —
  // a clock read inside a "pure" function is what made that suite
  // machine-dependent), and `react-hooks/purity` rejects it here besides.
  const library = buildLibraryConversion(addEvents.events, sets, addEvents.readAtMs);

  return (
    <main className="se">
      <SilkBackdrop />
      <header className="se-header">
        <h1 className="se-title">Style Evolution</h1>
        <p className="se-subtitle">
          How your BPM range, genre mix, key usage, and library digging have moved, month over month.
        </p>
      </header>

      {/* AC-3/D-5: gated on ALL synced sets, pre-exclusion — a DJ with real
          spread across months who happens to have mostly low-confidence sets
          still sees the trend, never this misleading "not enough yet."
          Story 4.2's library chip carries its OWN insufficient state inside
          the view (it can be empty while these three are full), so this
          page-level gate is unchanged. */}
      {model.monthsSpannedAll < 2 ? (
        <InsufficientHistory />
      ) : (
        <StyleEvolutionView model={model} library={library} />
      )}
    </main>
  );
}
