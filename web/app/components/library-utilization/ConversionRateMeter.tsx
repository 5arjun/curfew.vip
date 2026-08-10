import {
  liveConversionRateSummary,
  liveWindowPhrase,
  type ConversionWindow,
  type LiveConversionRate,
} from "@/lib/sets/libraryConversion";
import { AnimateNumber } from "@/app/components/ui/AnimateNumber";
import { LedPips } from "@/app/components/ui/LedPips";

/** LED pip count for the meter (AC-2) — matches `StatsColumn`'s harmonic hero,
 *  the shipped UX-DR11 reference this story reuses rather than reinvents. */
const PIP_COUNT = 10;

/**
 * The conversion-rate LED-pip meter (Story 4.3, AC-1/AC-2/AC-3/AC-4).
 *
 * `rates` carries every selectable window's result **precomputed** (page.tsx
 * builds all of `CONVERSION_WINDOWS` up front); `window` selects which one to
 * read — matching this codebase's established D-13 discipline (`TrendChart`'s
 * window toggle): no recompute happens on selection, only a lookup.
 *
 * **Story 4.7, AC-3:** this component no longer owns the window control or
 * its persisted selection — it used to render its own `LiveWindowDropdown`
 * and call `useLiveWindowSelection()` directly, on a scale independent of
 * the trend chart this story moves onto the same page. `LibraryUtilizationView`
 * now owns the ONE shared selection and renders the ONE shared dropdown
 * above both this meter and the moved trend, passing `window` down as a
 * plain prop — so the two can never disagree on screen.
 *
 * AC-3's window definition is stated twice, deliberately: once in the visible
 * readout sentence, once in `aria-label` via {@link liveConversionRateSummary}
 * — the same "one generator, three duties" discipline
 * `libraryConversionSummary` already established, so the caption and its
 * accessible text-equivalent can never drift apart (Story 4.1's review
 * lesson).
 *
 * `unidentifiableDisclosure` (Story 4.11 AC-6) is a SEPARATE honesty debt
 * from `undatedDisclosure`'s: that one covers tracks that ARE in the
 * denominator but have no known add date; this one covers catalogue rows
 * that never reached the denominator at all (no title/artist, no identity
 * to record under). They stay two separate sentences, never merged into one
 * — they describe different failure shapes, and merging them would blur
 * which gap a DJ is actually reading about.
 *
 * **This meter now renders only the second of the two** (Story 4.5 review;
 * re-applied when 4.5 merged 4.7). It used to build its own
 * `undatedDisclosure` here; that count is window-independent and identical
 * across every module on this page, so three modules each rendering it
 * produced the same sentence two or three times over — and after 4.7 sat
 * this meter directly beside the trend, whose disclosure opens on that very
 * clause, the repetition would have been side by side. `page.tsx` now states
 * it once, beneath everything it covers.
 *
 * The two debts did not get the same treatment, and the rule is duplication
 * rather than window-independence (both are window-independent): the undated
 * count is shared by every module here and so belongs to the page, while
 * this one has exactly one consumer — it describes the denominator THIS
 * component owns, so it stays anchored to it, which is what 4.11 AC-6 asked
 * for. Nothing to de-duplicate, nothing to hoist.
 */
export function ConversionRateMeter({
  rates,
  window,
  unidentifiableDisclosure,
}: {
  rates: Record<ConversionWindow, LiveConversionRate>;
  window: ConversionWindow;
  unidentifiableDisclosure?: string | null;
}) {
  const rate = rates[window];
  const summary = liveConversionRateSummary(rate);
  // `floor`, not `round`: a 96% rate must show 9 lit pips, not a false-full
  // 10 — the percentage readout right next to it is the tie-breaker a DJ
  // would notice disagreeing (Story 4.3 review). True 100% is the only way
  // to reach all `PIP_COUNT` pips lit.
  const litPips = rate.rate == null ? 0 : Math.floor(rate.rate * PIP_COUNT);

  return (
    // `role="group"`, not `<section>` (Story 4.9; deferred-work R-10). The
    // accessible name is this module's FINDING, which is worth announcing —
    // but as one of eight modules on the page it must not also be a landmark.
    // Eight landmarks makes the landmark list useless for navigating; a real
    // `<h2>`/`<h3>` outline is what serves that, and now exists.
    <div className="lu-module dz-shell" role="group" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      <h3 className="lu-stat-label">Conversion rate</h3>
      {rate.added > 0 ? (
        <>
          <LedPips litCount={litPips} totalCount={PIP_COUNT} />
          <p className="lu-stat-readout" aria-hidden="true">
            <span className="lu-stat-value">
              <AnimateNumber value={Math.round((rate.rate ?? 0) * 100)} suffix="%" />
            </span>{" "}
            of tracks added in the last {liveWindowPhrase(rate.window)} have
            been played in a set
          </p>
          {rate.lowConfidence && (
            <p className="lu-disclosure">
              Only {rate.added} {rate.added === 1 ? "track" : "tracks"} added in this window — early read
            </p>
          )}
        </>
      ) : (
        <p className="lu-stat-empty" aria-hidden="true">
          No tracks added in the last {liveWindowPhrase(rate.window)}.
        </p>
      )}
      {unidentifiableDisclosure && <p className="lu-disclosure">{unidentifiableDisclosure}</p>}
    </div>
  );
}
