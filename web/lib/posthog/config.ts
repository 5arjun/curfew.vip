// The two hosts PostHog is reached through, and the first-party paths this
// app reaches them by. Imported from BOTH next.config.ts (Node, at build
// time, to build the rewrites) and the browser bundle (to point posthog-js at
// those rewrites) — so it must stay free of imports and of anything that only
// exists in one of those two environments.
//
// WHY A PROXY AT ALL. A request to a third-party host is the thing ad blockers
// reliably drop, and dropped analytics is worse than no analytics: it doesn't
// go quiet, it goes *skewed*. Every DJ running uBlock silently vanishes from
// the funnel, so the conversion rate that survives describes only the subset
// of the audience that doesn't block trackers — and reads as fact. This is the
// third such proxy here, for the same reason as the other two: BotID's
// rewrites (next.config.ts) and Sentry's `tunnelRoute: "/monitoring"`.
//
// `/relay` rather than PostHog's documented `/ingest`: the documented path is
// itself now a pattern on the common blocklists, which gives back the problem
// the proxy exists to solve.
export const POSTHOG_PROXY_PATH = "/relay";
export const POSTHOG_ASSET_PATH = "/relay/static";

// The ingest host is whatever the project's env says (the Vercel integration
// sets it; US is PostHog's default for a new project). Assets come off a
// sibling CDN host — same region, `-assets` infixed — which is why this is
// derived rather than configured separately: two env vars that must agree is
// one env var that can disagree.
const RAW_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST?.replace(/\/+$/, "");

export const POSTHOG_INGEST_HOST = RAW_HOST || "https://us.i.posthog.com";

export const POSTHOG_ASSET_HOST = POSTHOG_INGEST_HOST.replace(
  /^https:\/\/(us|eu)\.i\.posthog\.com$/,
  "https://$1-assets.i.posthog.com",
);

// Absent key = PostHog stays entirely uninitialised (see lib/posthog/client.ts).
// That is the correct state for a dev checkout and for any preview built before
// the integration's env vars land, and it must never throw: analytics is the
// least important thing on the page.
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
