// Shared Sentry options for the three runtimes web/ initialises separately
// (browser, Node server, edge). Sentry's own scaffold duplicates these values
// across three near-identical config files; keeping them here means the DSN and
// the sampling/PII decisions below can't drift between runtimes — a drift that
// would show up as "errors from the server appear but browser errors don't",
// which is slow to notice and slower to diagnose.
//
// The DSN is inlined rather than read from an env var on purpose. A Sentry DSN
// is a public credential — it ships in the client bundle by design and only
// grants event *ingestion*, never read access — so treating it as a secret buys
// nothing while costing a provisioning step that, if forgotten on a new
// environment, silently disables error reporting. Same reasoning already applied
// to the inlined URLs in the agent's release workflows.
export const SENTRY_DSN =
  "https://b4544b4f3e40d635d571b336584d5740@o4511838008508416.ingest.us.sentry.io/4511921727340544";

// Only report from real deployments. Without this every `next dev` crash and
// every local test run posts to the same project, and the signal that matters
// after launch — a real DJ hitting a real bug — is buried in development noise.
export const SENTRY_ENABLED = process.env.NODE_ENV === "production";

export const sentryCommonOptions = {
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  // Errors are the point of this integration; tracing is a bonus that consumes
  // the same quota. 10% keeps a usable performance sample without letting a
  // traffic spike exhaust the plan and start dropping the error events.
  tracesSampleRate: 0.1,
  // Deliberately left at Sentry's default of `false`. Turning it on would attach
  // IP addresses and request headers to every event, which is broader than what
  // `app/(marketing)/privacy/page.tsx` tells DJs is collected. If a future
  // debugging need argues for it, the privacy page changes first.
  sendDefaultPii: false,
};
