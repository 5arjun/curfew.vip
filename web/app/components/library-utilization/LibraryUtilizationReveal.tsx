"use client";

import { useState, type ReactNode } from "react";
import { LowConfidenceReveal } from "@/app/components/style-evolution/LowConfidenceReveal";
import type { TrackSearchIndex } from "@/lib/sets/trackSearch";
import { TrackSearch } from "./TrackSearch";

/**
 * The reveal row's descriptor for this page (D-20(iii)).
 *
 * `LowConfidenceReveal` renders "N low-confidence sessions hidden" by default,
 * which is true on Style Evolution's bare predicate and **false here**: the
 * compound predicate also hides short sessions that scored a perfectly
 * confident 1.0. Shipping the default would state a count whose noun is wrong.
 *
 * Declared here rather than imported from `@/lib/sets/libraryUtilization`: this
 * is a `"use client"` module, and importing one string from an 832-line server
 * module pulls it (and `listModel`/`rightColumn`/`format` behind it) toward the
 * client bundle unless the bundler tree-shakes it away. This component is the
 * constant's only consumer, so there is nothing to share.
 */
const LU_HIDDEN_SETS_DESCRIPTOR = "short or low-confidence";

/**
 * The page-level exclude-visibly affordance for `/library-utilization` (Story
 * 4.9, AC-10; D-20).
 *
 * **This component owns exactly one boolean and nothing else.** Both subtrees
 * arrive fully prerendered as props — one computed from the surviving set
 * population, one from every set — so revealing is a swap, never a recompute.
 * That is the same D-13 discipline `CONVERSION_WINDOWS` already follows on this
 * page and the same shape `styleEvolution.ts` uses for its own reveal: the
 * expensive work happens once, server-side, up front.
 *
 * **Why a wrapper taking two subtrees rather than a `"use client"` boundary
 * around the modules.** Story 4.9 adds five stateless server modules to this
 * page. Dragging all of them across the client boundary for one boolean is the
 * exact cost `page.tsx`'s render block already argues against for
 * `TimeToFirstPlay` — so the boolean gets its own thin client component and
 * every module stays a server component. `children`-shaped props are React's
 * supported way to do that: the subtrees are serialized as RSC payloads, not
 * re-executed here.
 *
 * **Scope.** The control sits above everything it governs and governs
 * everything below it — the Story 4.3 meter, the Story 4.2/4.7 trend, Story
 * 4.5's time-to-first-play and all five of Story 4.9's modules read the one
 * population this toggle selects. A reveal that governed only some of them
 * would be a control misdescribing its own scope, which is the failure
 * `page.tsx:156-177` already rules against in the other direction.
 *
 * Unpersisted `useState(false)` per D-4 — resets to hidden on every page load,
 * matching Style Evolution exactly. Story 4.10's AC-11 reuses this contract, so
 * it is built as a page-level primitive rather than welded to Story 4.9's five
 * modules.
 */
export function LibraryUtilizationReveal({
  hiddenCount,
  excluding,
  including,
  search,
}: {
  /** Sets the compound predicate hid. `0` renders no control at all. */
  hiddenCount: number;
  /**
   * Story 4.10's track search, rendered from THIS component's one boolean
   * (AC-12) rather than owning a second.
   *
   * **Why the search field is a slot here and not a sibling in `page.tsx`.**
   * Search results carry play and set counts, so they are governed by the same
   * exclusion everything else on this page is — and the first build gave
   * `TrackSearch` its own `LibraryUtilizationReveal`. That put TWO controls on
   * screen ~200px apart, both reading "16 short or low-confidence sessions
   * hidden — show them", which is the identical-sentence-twice failure Story
   * 4.5's review already ruled against for `undatedDisclosure` (caught in this
   * story's own browser pass, not by any gate).
   *
   * A slot is what resolves it: the boolean stays singular, the ONE control
   * still sits above everything it governs, and the two surfaces can no longer
   * disagree about which population they are describing. The field renders
   * BELOW the control for that reason — the control must not appear to own a
   * figure it sits underneath.
   *
   * `TrackSearchIndex` is plain serializable data (tuple rows and two counts),
   * so this stays a prop rather than becoming a render callback, which a server
   * component could not pass anyway.
   */
  search?: TrackSearchIndex | null;
  /** The page body computed from the surviving population — the default view. */
  excluding: ReactNode;
  /**
   * The same body computed from every set, shown while revealed.
   *
   * `null` when `hiddenCount === 0`: with no control rendered, `revealed` can
   * never become true, so building this subtree would be a second full pass
   * over every metric and a second copy of the markup in the RSC payload, to
   * render something unreachable. The caller decides — see `page.tsx`.
   */
  including: ReactNode;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <>
      {hiddenCount > 0 && (
        <div className="lu-reveal">
          <LowConfidenceReveal
            hiddenCount={hiddenCount}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
            onHide={() => setRevealed(false)}
            descriptor={LU_HIDDEN_SETS_DESCRIPTOR}
          />
        </div>
      )}
      {search != null && <TrackSearch index={search} revealed={revealed} />}
      {revealed ? including : excluding}
    </>
  );
}
