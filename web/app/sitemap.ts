import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, SITE_URL } from "@/lib/seo";

// Launch checklist §1.6: `https://curfew.vip/sitemap.xml` was a 404, so there
// was no statement anywhere of what this site wants indexed.
//
// The route list lives in lib/seo.ts because it is the same list robots.ts is
// the complement of. `lastModified` is deliberately absent — see the comment
// on PUBLIC_ROUTES for why a build-time date would be a lie Google ignores.

export default function sitemap(): MetadataRoute.Sitemap {
  // The home entry drops its trailing slash, because that is what Next emits
  // for `/`'s own canonical tag (verified in the build output:
  // `<link rel="canonical" href="https://curfew.vip"/>`). A sitemap entry one
  // character different from the canonical the page declares is the cheapest
  // possible way to look like two pages.
  return PUBLIC_ROUTES.map(({ path, priority }) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    priority,
  }));
}
