import * as Sentry from "@sentry/nextjs";
import { initBotId } from "botid/client/core";

import { ensurePostHog } from "./lib/posthog/client";
import { sentryCommonOptions } from "./lib/sentry-shared";

// BotID runs an invisible client-side challenge and makes the verdict readable
// server-side via checkBotId(). It is an application-layer check, not a network
// one, so it keeps working with Cloudflare proxying DNS in front of Vercel —
// unlike Vercel's IP-keyed firewall rules, which only ever see Cloudflare's edge.
//
// Paths here are the URLs the browser POSTs to, which for a Server Action is the
// page that invokes it — NOT the module path of the action. Both signUp and
// signIn live on /login, so the single entry below covers the whole credential
// surface (fake-account signup and credential stuffing alike).
//
// Every protected path must have a matching checkBotId() call on the server, or
// the challenge is issued and then never read.
initBotId({
  protect: [
    {
      // app/(marketing)/login — the route group is not part of the URL.
      path: "/login",
      method: "POST",
    },
  ],
});

// Browser-side Sentry init. This file is Next.js's single client instrumentation
// entry point, so Sentry shares it with BotID above rather than getting one of
// its own — Sentry's setup wizard would have overwritten this file wholesale,
// which is why it was wired by hand.
//
// Order matters only in that initBotId() runs first: its challenge should be in
// flight as early as possible, and Sentry.init is not a prerequisite for it.
Sentry.init(sentryCommonOptions);

// PostHog (product analytics + session replay) starts LAST and off the
// critical path, because it is the only one of the three whose value doesn't
// depend on being early. BotID's challenge should be in flight immediately and
// Sentry has to be up before the first error can be thrown; a pageview that
// lands a few hundred milliseconds late is still the same pageview.
//
// Idle rather than immediate specifically for the landing route, which is
// where prospective DJs arrive and which already spends its main-thread budget
// on a WebGL mesh and several MP4s. The `timeout` is the ceiling: a busy page
// still starts PostHog within 3s rather than never. See lib/posthog/client.ts.
if (typeof window !== "undefined") {
  const start = () => void ensurePostHog();
  // `typeof` rather than `"requestIdleCallback" in window`: the DOM lib types
  // the method as always present, so an `in` check narrows the else branch to
  // `never` and stops the build. Safari before 17 really does lack it, so the
  // fallback has to survive typechecking.
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(start, { timeout: 3000 });
  } else {
    window.setTimeout(start, 1500);
  }
}

// Instruments App Router client-side navigations. Without it, errors thrown
// during a soft navigation are attributed to whatever route was loaded first,
// so a crash on /settings reached from /dashboard reports as a /dashboard error
// and the stack trace points somewhere the bug isn't.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
