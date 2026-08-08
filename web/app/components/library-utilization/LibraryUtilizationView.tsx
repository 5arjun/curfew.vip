"use client";

import type { ConversionWindow, LibraryConversionModel, LiveConversionRate } from "@/lib/sets/libraryConversion";
import { ConversionRateMeter } from "./ConversionRateMeter";
import { ConversionWindowDropdown, useConversionWindowSelection } from "./ConversionWindowDropdown";
import { LibraryConversionTrend } from "./LibraryConversionTrend";

/**
 * Library Utilization's client sub-component (Story 4.7, AC-3) — the
 * dashboard/Style-Evolution server-page/client-sub-component split this
 * codebase already follows. Owns the ONE conversion-window selection shared
 * by the meter (Story 4.3) and the moved library-conversion trend (Story
 * 4.2): a single `ConversionWindowDropdown` here, not one per module, is
 * what makes AC-3's "visibly share one window selection" true rather than
 * aspirational — two independently-selectable dropdowns reading the same
 * persisted key would still let a render race show two different numbers
 * for one instant, and would read as two controls even when they agree.
 *
 * The conversion pair is grouped under one heading rather than stacked in
 * arrival order — the meter (a live snapshot) and the trend (its history)
 * are one story, not two unrelated modules; Story 4.9 is expected to add
 * further Library Utilization components below this pair.
 */
export function LibraryUtilizationView({
  rates,
  library,
  unidentifiableDisclosure,
}: {
  rates: Record<ConversionWindow, LiveConversionRate>;
  library: LibraryConversionModel;
  /** Story 4.11 AC-6 — passed straight through to the meter, which owns the
   *  denominator this disclosure is about. Threaded rather than read here so
   *  the page stays the one place that touches the roster seam. */
  unidentifiableDisclosure?: string | null;
}) {
  const [window, setWindow] = useConversionWindowSelection();

  return (
    <section className="lu-conversion" aria-label="Conversion">
      <div className="lu-conversion-head">
        <p className="lu-stat-label">Conversion</p>
        <ConversionWindowDropdown value={window} onChange={setWindow} />
      </div>
      <div className="lu-conversion-body">
        <ConversionRateMeter
          rates={rates}
          window={window}
          unidentifiableDisclosure={unidentifiableDisclosure}
        />
        <LibraryConversionTrend library={library} window={window} />
      </div>
    </section>
  );
}
