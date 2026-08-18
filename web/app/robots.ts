import type { MetadataRoute } from "next";
import { DISALLOWED_PREFIXES, SITE_URL } from "@/lib/seo";

// Launch checklist §1.6. Before this file, `https://curfew.vip/robots.txt`
// returned 200 — but what it served was **Cloudflare's injected
// content-signals block** (DNS is Cloudflare-proxied), not anything this repo
// controlled: comment lines about AI-training signals, no crawl directives and
// no `Sitemap:` line at all. So nothing stated what should be indexed, and
// nothing kept crawlers out of /dashboard, /settings, /welcome, /subscribe,
// /link-agent or /subscription-required.
//
// ⚠️ VERIFY AFTER DEPLOY that this route actually wins. Cloudflare injects its
// block when the origin serves no robots.txt of its own; with one present it
// should pass through, but "should" is not "does" and the failure is silent —
// the file looks fine locally and never reaches a crawler. Fetch
// https://curfew.vip/robots.txt and look for the Sitemap line below. If
// Cloudflare is still overriding, the fix is in the Cloudflare dashboard
// (Settings → content signals), not in this file.
//
// Note that a disallow is a request, not a control. The real guarantee is the
// `noindex` meta tag on each private layout — see NOINDEX in lib/seo.ts.

export default function robots(): MetadataRoute.Robots {
  // Preview deployments must never be indexed: they are the same content on a
  // different origin, which is the textbook way to end up competing with
  // yourself in a search index. Vercel sets VERCEL_ENV on every deployment;
  // "production" is the only value that gets a crawlable robots.txt.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Spread from the same list `NOINDEX` guards and the sitemap is the
        // complement of — one place to add a route, not three.
        disallow: [...DISALLOWED_PREFIXES],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
