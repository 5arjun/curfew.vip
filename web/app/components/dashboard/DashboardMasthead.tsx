// Dashboard masthead (Story 3.6 redesign) — the fixed brand line above the one
// scroll region. Carries the page's single <h1> (the product name; sections are
// h2). A calm right-side status conveys the product's core promise — capture is
// always on, sets arrive by themselves — without an error/action tone.
export function DashboardMasthead() {
  return (
    <header className="dashboard-header">
      <div className="masthead-brand">
        <h1 className="masthead-wordmark">CURFEW</h1>
        <p className="masthead-tagline text-label-sm">AFTER-HOURS ARCHIVE</p>
      </div>
      <p className="masthead-status text-label-sm" aria-label="Capture is on; sets arrive automatically">
        <span className="masthead-status-dot" aria-hidden="true" />
        CAPTURE ON
      </p>
    </header>
  );
}
