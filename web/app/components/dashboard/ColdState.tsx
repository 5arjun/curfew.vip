// Cold dashboard (Story 3.6 AC-2, cool-direction redesign). The day-one screen
// for every new user — a first-class state, not a fallback. After-Hours Archive
// voice: calm, positive, no error tone, no CTA (sets arrive on their own — there
// is nothing to set up). Now cinematic: a static ice-glow atmosphere behind a
// "standing by" console line, so the empty archive still feels alive and
// premium rather than blank. Motion is a single slow status pulse (reduced-motion
// stills it); no full-screen oscillation (Apple reduced-motion guidance).
export function ColdState() {
  return (
    <section className="dashboard-cold" aria-label="No sets yet">
      <div className="dashboard-cold-atmos" aria-hidden="true" />
      <p className="text-label-sm dashboard-cold-eyebrow">
        <span className="dashboard-cold-dot" aria-hidden="true" />
        STANDING BY
      </p>
      <h1 className="text-display-xl dashboard-cold-title">The archive is quiet.</h1>
      <p className="text-body-lg dashboard-cold-body">
        Your sets land here on their own, the morning after you play — the whole night, read
        back to you. Nothing to add, nothing to sync by hand. Play a record tonight and the
        first one will be waiting.
      </p>
    </section>
  );
}
