import type { NextConfig } from "next";
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
export default withBotId(nextConfig);
