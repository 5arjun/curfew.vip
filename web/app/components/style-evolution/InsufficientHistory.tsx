// Insufficient-history state (Task 6, AC-3) — gated on `monthsSpanned(allSets)
// < 2`, computed PRE-exclusion (D-5): a DJ with real spread across months who
// happens to have mostly low-confidence sets still sees the trend (with the
// reveal affordance available), never this misleading "not enough yet."
// Exact copy from EXPERIENCE.md:91 — static, console-voice, not apologetic;
// no computed "N more sets" count (no other screen in this codebase computes
// a live version of that number).
export function InsufficientHistory() {
  return (
    <div className="se-empty dz-shell" role="status">
      <span className="dz-dots" aria-hidden="true" />
      <p className="se-empty-copy">Two more sets and Style Evolution has something to show you.</p>
    </div>
  );
}
