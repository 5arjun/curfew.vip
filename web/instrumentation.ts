// Next.js server instrumentation hook. register() runs once per server process
// before the first request; the NEXT_RUNTIME check keeps each runtime loading
// only its own Sentry.init, since importing the Node config into the edge
// bundle would pull in Node built-ins that don't exist there.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Required for App Router server errors to reach Sentry at all. Next.js catches
// errors thrown in Server Components itself and renders the error boundary; the
// exception never propagates anywhere Sentry.init could observe it, so without
// this export a crash in a Server Component is invisible in the dashboard while
// client-side errors arrive normally — the confusing half-working state this
// line exists to prevent.
export const onRequestError = Sentry.captureRequestError;
