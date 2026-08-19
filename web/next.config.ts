import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { withBotId } from "botid/next/config";
import {
  POSTHOG_ASSET_HOST,
  POSTHOG_ASSET_PATH,
  POSTHOG_INGEST_HOST,
  POSTHOG_PROXY_PATH,
} from "./lib/posthog/config";

const nextConfig: NextConfig = {
  // Consume the workspace sync contract (@curfew/shared) directly from source.
  // IMPORTANT: this is the Vercel cloud app — keep default SSR/ISR output.
  // Do NOT set `output: 'export'` here (that constraint is only for a
  // Tauri-hosted frontend, which web/ is not).
  transpilePackages: ["@curfew/shared"],
  // Story 3.10 (AC-1, D-4): the avatar renders the OAuth provider photo via
  // next/image. Google serves user photos from the lh3–lh6 CDN hosts. Apple
  // typically returns no photo at all (the monogram fallback covers it) —
  // add an Apple CDN pattern only if a real photo URL is ever observed.
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "lh4.googleusercontent.com" },
      { protocol: "https", hostname: "lh5.googleusercontent.com" },
      { protocol: "https", hostname: "lh6.googleusercontent.com" },
    ],
  },
  // `/pricing` is not a page, and Story 6.3 was closed by ruling rather than
  // built (Arjun, 2026-08-18). A pricing page exists to compare tiers; Curfew
  // has one plan, so the page would be a card restating a price the landing's
  // closing beat already shows at `display-lg` with the same CTA — which is
  // 6.3's AC-1/AC-2 as written. A fifth surface stating one price is a fifth
  // place to miss on the next price change.
  //
  // It redirects rather than 404s because `/pricing` is a URL people type
  // whether or not it was ever linked, and the answer they want is on `/`.
  // 308, not 307: this is a permanent product decision, and the method never
  // needs preserving on a GET.
  async redirects() {
    return [{ source: "/pricing", destination: "/#pricing", permanent: true }];
  },

  // Proxies PostHog through this origin, the same trade BotID's rewrites and
  // Sentry's `tunnelRoute: "/monitoring"` already make below. The reasoning
  // and the choice of `/relay` live in lib/posthog/config.ts.
  //
  // withBotId() APPENDS its two rewrites to whatever this returns (it awaits
  // the existing `rewrites` and spreads it), so returning an array here is
  // additive, not a replacement — the bot-protection challenge keeps working.
  //
  // Asset rule FIRST: `/relay/static/:path*` has to match before the catch-all
  // `/relay/:path*` can swallow it, or the session-replay recorder gets
  // fetched from the ingest host, which doesn't serve it.
  async rewrites() {
    return [
      {
        source: `${POSTHOG_ASSET_PATH}/:path*`,
        destination: `${POSTHOG_ASSET_HOST}/static/:path*`,
      },
      {
        source: `${POSTHOG_PROXY_PATH}/:path*`,
        destination: `${POSTHOG_INGEST_HOST}/:path*`,
      },
    ];
  },
};

// withBotId adds the rewrites that proxy BotID's challenge script through this
// origin. Routing it through our own domain (rather than a third-party host) is
// what keeps the check working with Cloudflare proxying DNS in front of Vercel —
// see instrumentation-client.ts for the protected paths.
//
// withSentryConfig wraps the result rather than the bare config so BotID's
// rewrites are already present in what Sentry receives — reversing the nesting
// would let Sentry's own webpack/tunnel handling be applied to a config that
// does not yet contain those rewrites.
export default withSentryConfig(withBotId(nextConfig), {
  org: "curfew",
  project: "web",

  // Source-map upload runs only where SENTRY_AUTH_TOKEN exists (Vercel's
  // Production and Preview envs). Local `next build` has no token; without this
  // the upload step errors and fails an otherwise fine build, so it is skipped
  // rather than made a hard requirement of building the app at all.
  silent: !process.env.CI,
  sourcemaps: {
    // Upload maps to Sentry, then delete them from the deployed output. Leaving
    // them served publicly would hand anyone the app's unminified source; this
    // keeps readable stack traces in Sentry without that trade.
    deleteSourcemapsAfterUpload: true,
  },

  // Proxies Sentry's ingest through this origin. Same reasoning as BotID's
  // rewrites above: a request to a third-party host is the thing ad blockers
  // reliably drop, and a dropped error report is indistinguishable from no
  // error having happened.
  tunnelRoute: "/monitoring",

  // No `disableLogger` here on purpose. It is the option Sentry's docs and
  // wizard still hand you, but it is deprecated *and* explicitly unsupported
  // under Turbopack — which Next 16 uses for builds — so setting it does
  // nothing except emit a deprecation warning on every build. Its replacement
  // (`webpack.treeshake.removeDebugLogging`) is equally webpack-only. Revisit
  // if this app ever builds with webpack again.
});
