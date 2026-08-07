// Insufficient-history state (Task 6, AC-3) — gated on `monthsSpanned(allSets)
// < 2`, computed PRE-exclusion (D-5): a DJ with real spread across months who
// happens to have mostly low-confidence sets still sees the trend (with the
// reveal affordance available), never this misleading "not enough yet."
// Exact copy from EXPERIENCE.md:91 — static, console-voice, not apologetic;
// no computed "N more sets" count (no other screen in this codebase computes
// a live version of that number).
// Story 4.2 (AC-3): the library-conversion chip has its OWN insufficient
// state, because it can be empty on a page whose other three metrics are
// full. `copy` is optional and the default is byte-identical to what shipped
// in 4.1 — the page-level gate keeps rendering exactly what it always did.
export function InsufficientHistory({
  copy = "Two more sets and Style Evolution has something to show you.",
}: {
  copy?: string;
}) {
  return (
    <div className="se-empty dz-shell" role="status">
      <span className="dz-dots" aria-hidden="true" />
      <p className="se-empty-copy">{copy}</p>
    </div>
  );
}

/**
 * The library-conversion trend's insufficient-history copy (Story 4.2 AC-3;
 * moved to `/library-utilization` by Story 4.7 AC-3), in the same positive,
 * console-voice register as the line above (EXPERIENCE.md:91).
 *
 * Deliberately explains the wait rather than just reporting it: on day one
 * after this ships EVERY DJ sees this state, by construction — the agent takes
 * a silent baseline of the existing library and only counts tracks added from
 * then on (D-1), and a cohort needs its full window before it can be scored
 * (D-9). "Not enough data" with no reason reads as a bug; naming the clock
 * reads as a promise.
 *
 * Takes the window rather than hardcoding it (code review, 2026-08-07): this
 * was a fixed string promising "their 90 days", and Story 4.7's AC-3 scale
 * reconciliation retired 90 entirely (windows are now 60/30/14, default 60) —
 * so the one piece of copy whose whole job is naming the clock was naming a
 * clock that no longer exists at any selectable setting. The wait genuinely
 * changes with the selection, so the sentence has to as well.
 */
export function libraryInsufficientCopy(window: number): string {
  return `Curfew is watching what you add from here on. Once two months of new tracks have had their ${window} days, this fills in.`;
}
