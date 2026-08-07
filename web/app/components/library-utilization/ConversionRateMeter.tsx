import {
  liveConversionRateSummary,
  liveWindowPhrase,
  undatedDisclosure,
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
 */
export function ConversionRateMeter({
  rates,
  window,
}: {
  rates: Record<ConversionWindow, LiveConversionRate>;
  window: ConversionWindow;
}) {
  const rate = rates[window];
  const summary = liveConversionRateSummary(rate);
  // AC-4: the SAME undated-track disclosure 4.2's trend chart uses, with
  // `pendingCohortCount: 0` — this meter has no cohorts, so that clause never
  // fires (see `undatedDisclosure`'s own doc comment).
  const disclosure = undatedDisclosure(
    { noAddDateCount: rate.noAddDateCount, pendingCohortCount: 0 },
    rate.window,
  );
  // `floor`, not `round`: a 96% rate must show 9 lit pips, not a false-full
  // 10 — the percentage readout right next to it is the tie-breaker a DJ
  // would notice disagreeing (Story 4.3 review). True 100% is the only way
  // to reach all `PIP_COUNT` pips lit.
  const litPips = rate.rate == null ? 0 : Math.floor(rate.rate * PIP_COUNT);

  return (
    <section className="lu-module dz-shell" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      <p className="lu-stat-label">Conversion rate</p>
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
      {disclosure && <p className="lu-disclosure">{disclosure}</p>}
    </section>
  );
}
