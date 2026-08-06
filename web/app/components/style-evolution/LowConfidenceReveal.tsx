"use client";

// Low-confidence reveal affordance (Task 5, AC-2) — reference implementation
// of the dashboard archive's own pattern (SetListPanel.tsx /
// `.dz-list-hidden-note`), which deferred-work.md:61 names as the future fix
// for its own soundcheck-set leak. A single page-level row, "hidden" never
// "excluded"/"removed" (AC-2's exact register). Recomputation is free — the
// parent already computed both the excluding and including series up front
// (styleEvolution.ts) and simply swaps which one it renders; this component
// only owns visibility.
//
// Two-way toggle (added post-launch-review, 2026-08-06, Arjun: there was no
// way back to hidden without a full page reload). Still no persistence
// (unlike the chip's localStorage, Task 4) — D-4: resets to hidden on every
// page load either way, so the `revealed` flag the parent passes down stays
// a plain, unstored `useState(false)`; this only adds a path back to that
// same default within the same session.

export function LowConfidenceReveal({
  hiddenCount,
  revealed,
  onReveal,
  onHide,
}: {
  hiddenCount: number;
  revealed: boolean;
  onReveal: () => void;
  onHide: () => void;
}) {
  if (hiddenCount === 0) return null;

  return (
    <p className="se-hidden-note">
      {revealed ? (
        <>
          Showing {hiddenCount} low-confidence {hiddenCount === 1 ? "session" : "sessions"} —{" "}
          <button type="button" className="se-hidden-toggle" onClick={onHide}>
            hide them
          </button>
        </>
      ) : (
        <>
          {hiddenCount} low-confidence {hiddenCount === 1 ? "session" : "sessions"} hidden —{" "}
          <button type="button" className="se-hidden-toggle" onClick={onReveal}>
            show them
          </button>
        </>
      )}
    </p>
  );
}
