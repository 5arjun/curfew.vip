"use client";

import {
  liveConversionRateSummary,
  undatedDisclosure,
  type LiveConversionRate,
  type LiveWindow,
} from "@/lib/sets/libraryConversion";
import { AnimateNumber } from "@/app/components/ui/AnimateNumber";
import { LedPips } from "@/app/components/ui/LedPips";
import { LiveWindowDropdown, useLiveWindowSelection } from "./LiveWindowDropdown";

/** LED pip count for the meter (AC-2) — matches `StatsColumn`'s harmonic hero,
 *  the shipped UX-DR11 reference this story reuses rather than reinvents. */
const PIP_COUNT = 10;

/**
 * The conversion-rate LED-pip meter (Story 4.3, AC-1/AC-2/AC-3/AC-4) —
 * Library Utilization's first real content.
 *
 * `rates` carries every selectable window's result **precomputed** (page.tsx
 * builds all of `LIVE_CONVERSION_WINDOWS` up front) — the dropdown just picks
 * one, matching this codebase's established D-13 discipline (`TrendChart`'s
 * window toggle): no recompute happens on selection, only a lookup. `"use
 * client"` is required for the dropdown's own state, unlike this story's
 * original single-window version.
 *
 * AC-3's window definition is stated twice, deliberately: once in the visible
 * readout sentence, once in `aria-label` via {@link liveConversionRateSummary}
 * — the same "one generator, three duties" discipline
 * `libraryConversionSummary` already established, so the caption and its
 * accessible text-equivalent can never drift apart (Story 4.1's review
 * lesson).
 */
export function ConversionRateMeter({ rates }: { rates: Record<LiveWindow, LiveConversionRate> }) {
  const [window, setWindow] = useLiveWindowSelection();
  const rate = rates[window];
  const summary = liveConversionRateSummary(rate);
  // AC-4: the SAME undated-track disclosure 4.2's trend chart uses, with
  // `pendingCohortCount: 0` — this meter has no cohorts, so that clause never
  // fires (see `undatedDisclosure`'s own doc comment).
  const disclosure = undatedDisclosure(
    { noAddDateCount: rate.noAddDateCount, pendingCohortCount: 0 },
    rate.window,
  );
  const litPips = rate.rate == null ? 0 : Math.round(rate.rate * PIP_COUNT);

  return (
    <section className="lu-module dz-shell" aria-label={summary}>
      <span className="dz-dots" aria-hidden="true" />
      <div className="lu-stat-head">
        <p className="lu-stat-label">Conversion rate</p>
        <LiveWindowDropdown value={window} onChange={setWindow} />
      </div>
      {rate.added > 0 ? (
        <>
          <LedPips litCount={litPips} totalCount={PIP_COUNT} />
          <p className="lu-stat-readout" aria-hidden="true">
            <span className="lu-stat-value">
              <AnimateNumber value={Math.round((rate.rate ?? 0) * 100)} suffix="%" />
            </span>{" "}
            of tracks added in the last {rate.window === 14 ? "2 weeks" : `${rate.window} days`} have
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
          No tracks added in the last {rate.window === 14 ? "2 weeks" : `${rate.window} days`}.
        </p>
      )}
      {disclosure && <p className="lu-disclosure">{disclosure}</p>}
    </section>
  );
}
