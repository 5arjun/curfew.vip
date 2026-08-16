import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import { withBotId } from "botid/next/config";

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
