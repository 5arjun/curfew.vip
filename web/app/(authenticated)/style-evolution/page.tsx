import { getRecentSets } from "@/lib/sets";
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
  const sets = await getRecentSets();
  const model = buildStyleEvolution(sets);

  return (
    <main className="se">
      <SilkBackdrop />
      <header className="se-header">
        <h1 className="se-title">Style Evolution</h1>
        <p className="se-subtitle">How your BPM range, genre mix, and key usage have moved, month over month.</p>
      </header>

      {/* AC-3/D-5: gated on ALL synced sets, pre-exclusion — a DJ with real
          spread across months who happens to have mostly low-confidence sets
          still sees the trend, never this misleading "not enough yet." */}
      {model.monthsSpannedAll < 2 ? <InsufficientHistory /> : <StyleEvolutionView model={model} />}
    </main>
  );
}
