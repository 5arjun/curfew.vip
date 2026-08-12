"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * The house "what does this mean?" explainer — the `.se-chart-info` affordance
 * Story 4.7 built for Style Evolution's chart subtitles, lifted into `ui/` so a
 * SERVER component can use it (Arjun, 2026-08-12, for Set Similarity).
 *
 * **Why it exists as its own component rather than as inline JSX.** The pattern
 * needs one piece of state — `tipOpen`, toggled on click — and that state is
 * not optional: CSS `:hover` reaches a mouse and `:focus-visible` reaches a
 * keyboard, but neither reaches a touch user, who has no third state to be in.
 * Inlining it into `SetSimilarity` would have dragged that whole module across
 * the client boundary for one boolean, which is the exact cost
 * `library-utilization/page.tsx` argues against at length for `TimeToFirstPlay`
 * and which `LibraryUtilizationReveal` exists to avoid. A leaf client component
 * is the standard answer: the button is the only thing that ships.
 *
 * Chrome and behaviour are the existing `.se-chart-info` rules VERBATIM, not a
 * re-style. It is already the one explainer affordance in this app; a second
 * dialect of it would be the thing needing justification.
 *
 * `useId` rather than a caller-supplied id: the pages that use this render some
 * subtrees twice (`LibraryUtilizationReveal` prerenders both populations), so a
 * hand-written id would be duplicated in the document.
 */
export function InfoTip({
  label,
  children,
}: {
  /** The button's accessible name — a question, e.g. "How X is calculated". */
  label: string;
  /** The explanation. Plain text or inline markup; it lands in a `role="tooltip"`. */
  children: ReactNode;
}) {
  const tipId = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className="se-chart-info">
      <button
        type="button"
        className="se-chart-info-btn"
        aria-label={label}
        aria-describedby={tipId}
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        onBlur={() => setOpen(false)}
      >
        {/* Paint lives in CSS, not in attributes — the no-hardcoded-colors guard
            reads the inherit-paint keyword as a named colour literal, so every
            glyph in this app is tokenised there rather than inline. */}
        <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <circle className="se-chart-info-ring" cx="8" cy="8" r="7" />
          <circle className="se-chart-info-dot" cx="8" cy="4.6" r="0.95" />
          <path className="se-chart-info-stem" d="M8 7.1v4.6" />
        </svg>
      </button>
      <span role="tooltip" id={tipId} className="se-chart-info-tip">
        {children}
      </span>
    </span>
  );
}
