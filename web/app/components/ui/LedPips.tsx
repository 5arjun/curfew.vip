/**
 * The shipped LED-pip pattern (UX-DR11) — filled/empty pips reading a
 * proportion at a glance. First built for Set Detail's harmonic hero
 * (`StatsColumn.tsx`); extracted here (Story 4.3, Task 3) so the
 * conversion-rate meter can reuse the identical visual rather than a second,
 * divergent "LED pip" look. Styles live in `set-detail.css`
 * (`.sd-pips`/`.sd-pip[data-lit]`), imported globally via `globals.css` —
 * reused verbatim, not duplicated or reinvented per caller.
 */
export function LedPips({
  litCount,
  totalCount,
  className,
}: {
  /** How many pips render lit, left to right. Clamped to `[0, totalCount]` — a
   *  caller's rounding should never produce more lit pips than exist. */
  litCount: number;
  totalCount: number;
  /** Extra class(es) appended to `sd-pips`, for a caller-specific layout tweak. */
  className?: string;
}) {
  const lit = Math.max(0, Math.min(litCount, totalCount));
  return (
    <div className={className ? `sd-pips ${className}` : "sd-pips"} aria-hidden="true">
      {Array.from({ length: totalCount }, (_, i) => (
        <span key={i} className="sd-pip" data-lit={i < lit || undefined} />
      ))}
    </div>
  );
}

export default LedPips;
