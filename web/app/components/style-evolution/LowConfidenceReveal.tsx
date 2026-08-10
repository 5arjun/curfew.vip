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
  descriptor = "low-confidence",
}: {
  hiddenCount: number;
  revealed: boolean;
  onReveal: () => void;
  onHide: () => void;
  /**
   * What the hidden sessions have in common, as an adjective phrase (Story
   * 4.9, D-20(iii)). The default describes Style Evolution's bare
   * `confidence.value < 1.0` predicate accurately and is what shipped.
   *
   * `/library-utilization` overrides it, because it hides on `listModel`'s
   * COMPOUND predicate — which also excludes short sessions that scored a
   * perfectly confident `1.0`. Leaving the default there would have stated a
   * count whose noun was wrong: the sentence would have called a six-play,
   * fully-classifiable soundcheck "low-confidence" when the reason it was
   * hidden is that it was short. A count is only honest if its noun is.
   */
  descriptor?: string;
}) {
  if (hiddenCount === 0) return null;

  const sessions = hiddenCount === 1 ? "session" : "sessions";

  return (
    <p className="se-hidden-note">
      {revealed ? (
        <>
          Showing {hiddenCount} {descriptor} {sessions} —{" "}
          <button type="button" className="se-hidden-toggle" onClick={onHide}>
            hide them
          </button>
        </>
      ) : (
        <>
          {hiddenCount} {descriptor} {sessions} hidden —{" "}
          <button type="button" className="se-hidden-toggle" onClick={onReveal}>
            show them
          </button>
        </>
      )}
    </p>
  );
}
