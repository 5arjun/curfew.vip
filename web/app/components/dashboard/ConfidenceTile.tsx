// Confidence tile (D10, Q13 resolved-for-now): the latest set's dancefloor-
// detection confidence as a hero-grade numeral with a one-line explainer.
// The % sharpens as the DJ corrects detected boundaries — that editor is
// future work (Story 5.1); this tile is its doorway. Flagged "refine later"
// by Arjun — semantics may be revisited before polish. Server component.
export function ConfidenceTile({ pct }: { pct: number | null }) {
  return (
    <section className="dz-shell dz-card conf" aria-label="Dancefloor detection confidence">
      <span className="dz-dots" aria-hidden="true" />
      <p className="conf-value">{pct != null ? `${pct}%` : "—"}</p>
      <p className="conf-label">dancefloor detection · latest set</p>
      <p className="conf-hint">Sharpens as you correct the floor&apos;s edges.</p>
    </section>
  );
}
